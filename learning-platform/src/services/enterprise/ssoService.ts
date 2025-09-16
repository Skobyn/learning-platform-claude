import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { AuthProvider, SsoType } from '@prisma/client';
import {
  SAMLUser,
  OAuthUser,
  OAuthTokens,
  SSOProvider,
  SAMLConfig,
  OAuthConfig,
  SSOSession,
  SAMLError,
  EnterpriseAuthError
} from '@/types/enterprise';
import samlify from 'samlify';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

class SSOService {
  private samlProviders = new Map<string, any>();
  private oauthProviders = new Map<string, OAuthConfig>();

  /**
   * Initialize SAML Service Provider for an organization
   */
  async initializeSAMLProvider(providerId: string): Promise<void> {
    const provider = await prisma.ssoProvider.findUnique({
      where: { id: providerId },
      include: { samlConfig: true }
    });

    if (!provider || !provider.samlConfig) {
      throw new SAMLError('SAML provider not found or not configured');
    }

    const config = provider.samlConfig;

    // Initialize SAML Service Provider
    const sp = samlify.ServiceProvider({
      entityID: config.spEntityId,
      assertionConsumerService: [{
        Binding: samlify.Constants.namespace.binding.post,
        Location: config.spAssertionConsumerUrl,
      }],
      singleLogoutService: config.spSingleLogoutUrl ? [{
        Binding: samlify.Constants.namespace.binding.post,
        Location: config.spSingleLogoutUrl,
      }] : undefined,
      nameIDFormat: ['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
      authnRequestsSigned: config.wantAuthnRequestsSigned,
      wantAssertionsSigned: config.wantAssertionsSigned,
      signatureAlgorithm: config.signatureAlgorithm,
      privateKey: config.spPrivateKey,
      privateKeyPass: process.env.SAML_PRIVATE_KEY_PASS,
      signingCert: config.spCertificate,
    });

    // Initialize SAML Identity Provider
    const idp = samlify.IdentityProvider({
      entityID: config.idpEntityId,
      singleSignOnService: [{
        Binding: samlify.Constants.namespace.binding.post,
        Location: config.idpSsoUrl,
      }],
      singleLogoutService: config.idpSloUrl ? [{
        Binding: samlify.Constants.namespace.binding.post,
        Location: config.idpSloUrl,
      }] : undefined,
      signingCert: config.idpCertificate,
    });

    this.samlProviders.set(providerId, { sp, idp, config });
  }

  /**
   * Generate SAML Authentication Request
   */
  async generateSAMLAuthRequest(providerId: string, relayState?: string): Promise<string> {
    const provider = this.samlProviders.get(providerId);
    if (!provider) {
      await this.initializeSAMLProvider(providerId);
      return this.generateSAMLAuthRequest(providerId, relayState);
    }

    try {
      const { sp, idp } = provider;
      const { context } = sp.createLoginRequest(idp, 'post', relayState);
      return context;
    } catch (error) {
      throw new SAMLError('Failed to generate SAML auth request', error);
    }
  }

  /**
   * Process SAML Response
   */
  async processSAMLResponse(providerId: string, samlResponse: string, relayState?: string): Promise<SAMLUser> {
    const provider = this.samlProviders.get(providerId);
    if (!provider) {
      throw new SAMLError('SAML provider not initialized');
    }

    try {
      const { sp, idp, config } = provider;
      const { extract } = await sp.parseLoginResponse(idp, 'post', { body: { SAMLResponse: samlResponse, RelayState: relayState } });

      const attributes = this.mapSAMLAttributes(extract.attributes, config.attributeMapping);

      return {
        nameId: extract.nameID,
        sessionIndex: extract.sessionIndex,
        attributes,
        groups: attributes.groups ? (Array.isArray(attributes.groups) ? attributes.groups : [attributes.groups]) : []
      };
    } catch (error) {
      throw new SAMLError('Failed to process SAML response', error);
    }
  }

  /**
   * Generate SAML Logout Request
   */
  async generateSAMLLogoutRequest(providerId: string, nameId: string, sessionIndex?: string): Promise<string> {
    const provider = this.samlProviders.get(providerId);
    if (!provider) {
      throw new SAMLError('SAML provider not initialized');
    }

    try {
      const { sp, idp } = provider;
      const { context } = sp.createLogoutRequest(idp, 'post', {
        nameID: nameId,
        sessionIndex: sessionIndex
      });
      return context;
    } catch (error) {
      throw new SAMLError('Failed to generate SAML logout request', error);
    }
  }

  /**
   * Initialize OAuth Provider
   */
  async initializeOAuthProvider(providerId: string): Promise<void> {
    const provider = await prisma.ssoProvider.findUnique({
      where: { id: providerId },
      include: { oauthConfig: true }
    });

    if (!provider || !provider.oauthConfig) {
      throw new EnterpriseAuthError('OAuth provider not found or not configured', 'OAUTH_CONFIG_ERROR');
    }

    this.oauthProviders.set(providerId, provider.oauthConfig);
  }

  /**
   * Generate OAuth Authorization URL
   */
  async generateOAuthAuthUrl(providerId: string, state: string, redirectUri: string): Promise<string> {
    let config = this.oauthProviders.get(providerId);
    if (!config) {
      await this.initializeOAuthProvider(providerId);
      config = this.oauthProviders.get(providerId)!;
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      scope: config.scope.join(' '),
      redirect_uri: redirectUri,
      state: state,
    });

    return `${config.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange OAuth Code for Tokens
   */
  async exchangeOAuthCode(providerId: string, code: string, redirectUri: string): Promise<OAuthTokens> {
    const config = this.oauthProviders.get(providerId);
    if (!config) {
      throw new EnterpriseAuthError('OAuth provider not initialized', 'OAUTH_CONFIG_ERROR');
    }

    try {
      const response = await axios.post(config.tokenUrl, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      throw new EnterpriseAuthError('Failed to exchange OAuth code', 'OAUTH_TOKEN_ERROR', 400, error);
    }
  }

  /**
   * Get OAuth User Info
   */
  async getOAuthUserInfo(providerId: string, accessToken: string): Promise<OAuthUser> {
    const config = this.oauthProviders.get(providerId);
    if (!config) {
      throw new EnterpriseAuthError('OAuth provider not initialized', 'OAUTH_CONFIG_ERROR');
    }

    try {
      const response = await axios.get(config.userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      return this.mapOAuthAttributes(response.data, config.attributeMapping);
    } catch (error) {
      throw new EnterpriseAuthError('Failed to get OAuth user info', 'OAUTH_USERINFO_ERROR', 400, error);
    }
  }

  /**
   * Create SSO Session
   */
  async createSSOSession(
    userId: string,
    providerId: string,
    sessionData: Partial<SSOSession>
  ): Promise<SSOSession> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    const session = await prisma.ssoSession.create({
      data: {
        userId,
        providerId,
        sessionId,
        nameId: sessionData.nameId,
        sessionIndex: sessionData.sessionIndex,
        attributes: sessionData.attributes || {},
        accessToken: sessionData.accessToken ? this.encryptToken(sessionData.accessToken) : undefined,
        refreshToken: sessionData.refreshToken ? this.encryptToken(sessionData.refreshToken) : undefined,
        expiresAt,
      },
    });

    // Store session in Redis for quick access
    await redis.set(
      `sso_session:${sessionId}`,
      JSON.stringify(session),
      'EX',
      8 * 60 * 60 // 8 hours
    );

    return session;
  }

  /**
   * Get SSO Session
   */
  async getSSOSession(sessionId: string): Promise<SSOSession | null> {
    // Try Redis first
    const cachedSession = await redis.get(`sso_session:${sessionId}`);
    if (cachedSession) {
      return JSON.parse(cachedSession);
    }

    // Fall back to database
    const session = await prisma.ssoSession.findFirst({
      where: {
        sessionId,
        expiresAt: { gt: new Date() },
        terminatedAt: null,
      },
    });

    if (session) {
      // Cache in Redis
      await redis.set(
        `sso_session:${sessionId}`,
        JSON.stringify(session),
        'EX',
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
      );
    }

    return session;
  }

  /**
   * Terminate SSO Session
   */
  async terminateSSOSession(sessionId: string): Promise<void> {
    await prisma.ssoSession.updateMany({
      where: { sessionId },
      data: { terminatedAt: new Date() },
    });

    await redis.del(`sso_session:${sessionId}`);
  }

  /**
   * Get SSO Providers for Organization
   */
  async getSSOProviders(organizationId: string): Promise<SSOProvider[]> {
    return await prisma.ssoProvider.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        samlConfig: true,
        oauthConfig: true,
      },
    });
  }

  /**
   * Create SSO Provider
   */
  async createSSOProvider(data: {
    name: string;
    displayName: string;
    type: SsoType;
    organizationId: string;
    samlConfig?: Omit<SAMLConfig, 'id' | 'providerId'>;
    oauthConfig?: Omit<OAuthConfig, 'id' | 'providerId'>;
  }): Promise<SSOProvider> {
    return await prisma.$transaction(async (tx) => {
      const provider = await tx.ssoProvider.create({
        data: {
          name: data.name,
          displayName: data.displayName,
          type: data.type,
          organizationId: data.organizationId,
        },
      });

      if (data.samlConfig) {
        await tx.samlConfig.create({
          data: {
            ...data.samlConfig,
            providerId: provider.id,
          },
        });
      }

      if (data.oauthConfig) {
        await tx.oauthConfig.create({
          data: {
            ...data.oauthConfig,
            clientSecret: this.encryptToken(data.oauthConfig.clientSecret),
            providerId: provider.id,
          },
        });
      }

      return provider;
    });
  }

  /**
   * Update SSO Provider
   */
  async updateSSOProvider(
    providerId: string,
    data: {
      name?: string;
      displayName?: string;
      isActive?: boolean;
      samlConfig?: Partial<SAMLConfig>;
      oauthConfig?: Partial<OAuthConfig>;
    }
  ): Promise<SSOProvider> {
    return await prisma.$transaction(async (tx) => {
      const provider = await tx.ssoProvider.update({
        where: { id: providerId },
        data: {
          name: data.name,
          displayName: data.displayName,
          isActive: data.isActive,
        },
      });

      if (data.samlConfig) {
        await tx.samlConfig.upsert({
          where: { providerId },
          update: data.samlConfig,
          create: {
            ...data.samlConfig,
            providerId,
          } as any,
        });
      }

      if (data.oauthConfig) {
        const updateData = { ...data.oauthConfig };
        if (updateData.clientSecret) {
          updateData.clientSecret = this.encryptToken(updateData.clientSecret);
        }

        await tx.oauthConfig.upsert({
          where: { providerId },
          update: updateData,
          create: {
            ...updateData,
            providerId,
          } as any,
        });
      }

      // Clear cached provider
      this.samlProviders.delete(providerId);
      this.oauthProviders.delete(providerId);

      return provider;
    });
  }

  /**
   * Delete SSO Provider
   */
  async deleteSSOProvider(providerId: string): Promise<void> {
    await prisma.ssoProvider.delete({
      where: { id: providerId },
    });

    // Clear cached provider
    this.samlProviders.delete(providerId);
    this.oauthProviders.delete(providerId);
  }

  /**
   * Map SAML Attributes
   */
  private mapSAMLAttributes(attributes: Record<string, any>, mapping: Record<string, any>): Record<string, any> {
    const mapped: Record<string, any> = {};

    for (const [key, samlAttr] of Object.entries(mapping)) {
      if (samlAttr && attributes[samlAttr]) {
        mapped[key] = Array.isArray(attributes[samlAttr]) && attributes[samlAttr].length === 1
          ? attributes[samlAttr][0]
          : attributes[samlAttr];
      }
    }

    return mapped;
  }

  /**
   * Map OAuth Attributes
   */
  private mapOAuthAttributes(userInfo: Record<string, any>, mapping: Record<string, any>): OAuthUser {
    const mapped: Record<string, any> = { ...userInfo };

    for (const [key, oauthAttr] of Object.entries(mapping)) {
      if (oauthAttr && userInfo[oauthAttr]) {
        mapped[key] = userInfo[oauthAttr];
      }
    }

    return mapped;
  }

  /**
   * Encrypt sensitive tokens
   */
  private encryptToken(token: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipher(algorithm, key);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive tokens
   */
  private decryptToken(encryptedToken: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);

    const parts = encryptedToken.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Validate SSO Session
   */
  async validateSSOSession(sessionId: string): Promise<boolean> {
    const session = await this.getSSOSession(sessionId);
    return session !== null && session.expiresAt > new Date() && !session.terminatedAt;
  }

  /**
   * Refresh OAuth Token
   */
  async refreshOAuthToken(providerId: string, refreshToken: string): Promise<OAuthTokens> {
    const config = this.oauthProviders.get(providerId);
    if (!config) {
      throw new EnterpriseAuthError('OAuth provider not initialized', 'OAUTH_CONFIG_ERROR');
    }

    try {
      const response = await axios.post(config.tokenUrl, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      throw new EnterpriseAuthError('Failed to refresh OAuth token', 'OAUTH_REFRESH_ERROR', 400, error);
    }
  }
}

export const ssoService = new SSOService();
export default ssoService;