import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import { ManagementClient } from 'auth0';
import { Client as OktaClient } from '@okta/okta-sdk-nodejs';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { jwtUtils } from '@/lib/auth';
import { z } from 'zod';
import crypto from 'crypto';
import { MfaService } from './mfa.service';
import { ScimService } from './scim.service';

interface SSOProvider {
  id: string;
  name: string;
  type: 'saml' | 'oauth' | 'oidc';
  organizationId: string;
  config: SSOProviderConfig;
  isActive: boolean;
  roleMappings: RoleMapping[];
  settings: ProviderSettings;
}

interface SSOProviderConfig {
  // SAML Configuration
  saml?: {
    entryPoint: string;
    issuer: string;
    cert: string;
    privateCert?: string;
    signatureAlgorithm?: string;
    digestAlgorithm?: string;
    nameIDFormat?: string;
    wantAssertionsSigned?: boolean;
    wantAuthnResponseSigned?: boolean;
    acceptedClockSkewMs?: number;
  };

  // OAuth/OIDC Configuration
  oauth?: {
    clientId: string;
    clientSecret: string;
    authorizationURL: string;
    tokenURL: string;
    userInfoURL?: string;
    scope: string[];
    responseType?: string;
    grantType?: string;
  };

  // LDAP/AD Configuration
  ldap?: {
    url: string;
    bindDN: string;
    bindCredentials: string;
    searchBase: string;
    searchFilter: string;
    attributes: string[];
    tlsOptions?: any;
  };
}

interface RoleMapping {
  providerRole: string;
  internalRole: 'ADMIN' | 'INSTRUCTOR' | 'LEARNER';
  conditions?: string[];
}

interface ProviderSettings {
  jitProvisioning: boolean;
  autoActivateUsers: boolean;
  requireMFA: boolean;
  sessionTimeout: number;
  allowedDomains?: string[];
  attributeMappings: AttributeMapping;
  scimEnabled: boolean;
  auditLogging: boolean;
}

interface AttributeMapping {
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  department?: string;
  groups?: string;
}

const ssoConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['saml', 'oauth', 'oidc']),
  organizationId: z.string().cuid(),
  config: z.object({
    saml: z.object({
      entryPoint: z.string().url(),
      issuer: z.string(),
      cert: z.string(),
      privateCert: z.string().optional(),
      signatureAlgorithm: z.string().default('sha256'),
      digestAlgorithm: z.string().default('sha256'),
      nameIDFormat: z.string().default('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'),
      wantAssertionsSigned: z.boolean().default(true),
      wantAuthnResponseSigned: z.boolean().default(true),
      acceptedClockSkewMs: z.number().default(5000),
    }).optional(),
    oauth: z.object({
      clientId: z.string(),
      clientSecret: z.string(),
      authorizationURL: z.string().url(),
      tokenURL: z.string().url(),
      userInfoURL: z.string().url().optional(),
      scope: z.array(z.string()),
      responseType: z.string().default('code'),
      grantType: z.string().default('authorization_code'),
    }).optional(),
    ldap: z.object({
      url: z.string().url(),
      bindDN: z.string(),
      bindCredentials: z.string(),
      searchBase: z.string(),
      searchFilter: z.string(),
      attributes: z.array(z.string()),
    }).optional(),
  }),
  roleMappings: z.array(z.object({
    providerRole: z.string(),
    internalRole: z.enum(['ADMIN', 'INSTRUCTOR', 'LEARNER']),
    conditions: z.array(z.string()).optional(),
  })),
  settings: z.object({
    jitProvisioning: z.boolean().default(true),
    autoActivateUsers: z.boolean().default(true),
    requireMFA: z.boolean().default(false),
    sessionTimeout: z.number().default(28800), // 8 hours
    allowedDomains: z.array(z.string()).optional(),
    attributeMappings: z.object({
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      role: z.string().optional(),
      department: z.string().optional(),
      groups: z.string().optional(),
    }),
    scimEnabled: z.boolean().default(false),
    auditLogging: z.boolean().default(true),
  }),
});

export class EnterpriseSSO {
  private mfaService: MfaService;
  private scimService: ScimService;
  private auth0Client?: ManagementClient;
  private oktaClient?: OktaClient;

  constructor() {
    this.mfaService = new MfaService();
    this.scimService = new ScimService();

    // Initialize external clients
    this.initializeClients();
  }

  private initializeClients(): void {
    // Auth0 Management API client
    if (process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET) {
      this.auth0Client = new ManagementClient({
        domain: process.env.AUTH0_DOMAIN,
        clientId: process.env.AUTH0_CLIENT_ID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        scope: 'read:users update:users create:users delete:users read:connections update:connections',
      });
    }

    // Okta client
    if (process.env.OKTA_DOMAIN && process.env.OKTA_TOKEN) {
      this.oktaClient = new OktaClient({
        orgUrl: `https://${process.env.OKTA_DOMAIN}.okta.com`,
        token: process.env.OKTA_TOKEN,
      });
    }
  }

  // SSO Provider Management
  async createSSOProvider(data: any): Promise<SSOProvider> {
    const validated = ssoConfigSchema.parse(data);

    // Encrypt sensitive configuration data
    const encryptedConfig = this.encryptSensitiveData(validated.config);

    const provider = await prisma.ssoProvider.create({
      data: {
        id: crypto.randomUUID(),
        name: validated.name,
        type: validated.type,
        organizationId: validated.organizationId,
        config: encryptedConfig,
        roleMappings: validated.roleMappings,
        settings: validated.settings,
        isActive: true,
        metadata: {
          createdAt: new Date(),
          lastUpdated: new Date(),
          version: '1.0',
        },
      },
    });

    // Create audit log
    await this.createAuditLog('SSO_PROVIDER_CREATED', {
      providerId: provider.id,
      organizationId: validated.organizationId,
      type: validated.type,
    });

    return provider as SSOProvider;
  }

  async updateSSOProvider(providerId: string, data: any): Promise<SSOProvider> {
    const validated = ssoConfigSchema.partial().parse(data);
    const encryptedConfig = validated.config ? this.encryptSensitiveData(validated.config) : undefined;

    const provider = await prisma.ssoProvider.update({
      where: { id: providerId },
      data: {
        ...validated,
        config: encryptedConfig,
        metadata: {
          lastUpdated: new Date(),
        },
      },
    });

    // Invalidate cached configurations
    await redis.del(`sso:provider:${providerId}`);

    await this.createAuditLog('SSO_PROVIDER_UPDATED', {
      providerId,
      changes: Object.keys(validated),
    });

    return provider as SSOProvider;
  }

  async deleteSSOProvider(providerId: string): Promise<void> {
    await prisma.ssoProvider.update({
      where: { id: providerId },
      data: { isActive: false },
    });

    await redis.del(`sso:provider:${providerId}`);

    await this.createAuditLog('SSO_PROVIDER_DELETED', { providerId });
  }

  async getSSOProviders(organizationId: string): Promise<SSOProvider[]> {
    const providers = await prisma.ssoProvider.findMany({
      where: {
        organizationId,
        isActive: true,
      },
    });

    return providers.map(provider => ({
      ...provider,
      config: this.decryptSensitiveData(provider.config),
    })) as SSOProvider[];
  }

  async getSSOProvider(providerId: string): Promise<SSOProvider | null> {
    const cacheKey = `sso:provider:${providerId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const provider = await prisma.ssoProvider.findUnique({
      where: { id: providerId, isActive: true },
    });

    if (!provider) return null;

    const decryptedProvider = {
      ...provider,
      config: this.decryptSensitiveData(provider.config),
    } as SSOProvider;

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(decryptedProvider));

    return decryptedProvider;
  }

  // Authentication Flow
  async initiateSSOLogin(providerId: string, returnUrl?: string): Promise<string> {
    const provider = await this.getSSOProvider(providerId);
    if (!provider) {
      throw new Error('SSO provider not found');
    }

    const state = crypto.randomBytes(32).toString('hex');
    await redis.setex(`sso:state:${state}`, 600, JSON.stringify({
      providerId,
      returnUrl,
      timestamp: Date.now(),
    }));

    switch (provider.type) {
      case 'saml':
        return this.generateSAMLRequest(provider, state);
      case 'oauth':
      case 'oidc':
        return this.generateOAuthRequest(provider, state);
      default:
        throw new Error('Unsupported provider type');
    }
  }

  async handleSSOCallback(state: string, response: any): Promise<{ user: any; tokens: any; redirectUrl?: string }> {
    const stateData = await redis.get(`sso:state:${state}`);
    if (!stateData) {
      throw new Error('Invalid or expired state');
    }

    const { providerId, returnUrl } = JSON.parse(stateData);
    await redis.del(`sso:state:${state}`);

    const provider = await this.getSSOProvider(providerId);
    if (!provider) {
      throw new Error('SSO provider not found');
    }

    // Validate response and extract user attributes
    const userAttributes = await this.validateSSOResponse(provider, response);

    // Apply role mappings
    const mappedRole = this.mapUserRole(userAttributes, provider.roleMappings);

    // JIT Provisioning or user lookup
    const user = await this.handleUserProvisioning(provider, userAttributes, mappedRole);

    // MFA check if required
    if (provider.settings.requireMFA && !user.mfaEnabled) {
      throw new Error('MFA required but not configured');
    }

    // Generate session tokens
    const tokens = this.generateSessionTokens(user, provider);

    // Create session
    await this.createSSOSession(user.id, provider.id, tokens.sessionId);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    await this.createAuditLog('SSO_LOGIN_SUCCESS', {
      userId: user.id,
      providerId,
      userAgent: response.userAgent,
      ipAddress: response.ipAddress,
    });

    return { user, tokens, redirectUrl: returnUrl };
  }

  // SAML Implementation
  private generateSAMLRequest(provider: SSOProvider, state: string): string {
    const samlConfig = provider.config.saml!;
    const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/sso/${provider.id}/callback`;

    // This would integrate with samlify library
    return `${samlConfig.entryPoint}?RelayState=${state}&SAMLRequest=...`;
  }

  private async validateSAMLResponse(provider: SSOProvider, response: any): Promise<any> {
    // SAML response validation using samlify
    // Verify signature, check assertions, extract attributes
    return {
      email: response.email,
      firstName: response.firstName,
      lastName: response.lastName,
      groups: response.groups || [],
    };
  }

  // OAuth Implementation
  private generateOAuthRequest(provider: SSOProvider, state: string): string {
    const oauthConfig = provider.config.oauth!;
    const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/sso/${provider.id}/callback`;

    const params = new URLSearchParams({
      client_id: oauthConfig.clientId,
      response_type: oauthConfig.responseType || 'code',
      scope: oauthConfig.scope.join(' '),
      redirect_uri: callbackUrl,
      state,
    });

    return `${oauthConfig.authorizationURL}?${params.toString()}`;
  }

  private async validateOAuthResponse(provider: SSOProvider, response: any): Promise<any> {
    const oauthConfig = provider.config.oauth!;

    // Exchange code for token
    const tokenResponse = await fetch(oauthConfig.tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        code: response.code,
        redirect_uri: response.redirectUri,
      }),
    });

    const tokens = await tokenResponse.json();

    // Get user info
    if (oauthConfig.userInfoURL) {
      const userResponse = await fetch(oauthConfig.userInfoURL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      return userResponse.json();
    }

    return tokens;
  }

  private async validateSSOResponse(provider: SSOProvider, response: any): Promise<any> {
    switch (provider.type) {
      case 'saml':
        return this.validateSAMLResponse(provider, response);
      case 'oauth':
      case 'oidc':
        return this.validateOAuthResponse(provider, response);
      default:
        throw new Error('Unsupported provider type');
    }
  }

  // User Provisioning (JIT)
  private async handleUserProvisioning(
    provider: SSOProvider,
    userAttributes: any,
    mappedRole: string
  ): Promise<any> {
    const { attributeMappings } = provider.settings;
    const email = userAttributes[attributeMappings.email];

    if (!email) {
      throw new Error('Email attribute not found in SSO response');
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user && provider.settings.jitProvisioning) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email,
          firstName: userAttributes[attributeMappings.firstName] || '',
          lastName: userAttributes[attributeMappings.lastName] || '',
          role: mappedRole as any,
          organizationId: provider.organizationId,
          isActive: provider.settings.autoActivateUsers,
          emailVerified: new Date(),
          hashedPassword: '', // SSO users don't have passwords
          ssoProviderId: provider.id,
          ssoUserId: userAttributes.id || userAttributes.sub,
        },
      });

      await this.createAuditLog('USER_PROVISIONED_VIA_SSO', {
        userId: user.id,
        providerId: provider.id,
        email,
      });
    } else if (!user) {
      throw new Error('User not found and JIT provisioning is disabled');
    }

    // Update user attributes if they've changed
    if (user && provider.settings.jitProvisioning) {
      const updatedData: any = {};
      if (userAttributes[attributeMappings.firstName] !== user.firstName) {
        updatedData.firstName = userAttributes[attributeMappings.firstName];
      }
      if (userAttributes[attributeMappings.lastName] !== user.lastName) {
        updatedData.lastName = userAttributes[attributeMappings.lastName];
      }

      if (Object.keys(updatedData).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updatedData,
        });
      }
    }

    return user;
  }

  // Role Mapping
  private mapUserRole(userAttributes: any, roleMappings: RoleMapping[]): string {
    const userGroups = userAttributes.groups || [];
    const userRole = userAttributes.role;

    for (const mapping of roleMappings) {
      // Check if user has the provider role
      if (userGroups.includes(mapping.providerRole) || userRole === mapping.providerRole) {
        // Check additional conditions if any
        if (mapping.conditions) {
          const conditionsMet = mapping.conditions.every(condition => {
            // Simple condition evaluation - could be enhanced
            return this.evaluateCondition(condition, userAttributes);
          });
          if (conditionsMet) {
            return mapping.internalRole;
          }
        } else {
          return mapping.internalRole;
        }
      }
    }

    // Default role
    return 'LEARNER';
  }

  private evaluateCondition(condition: string, userAttributes: any): boolean {
    // Simple condition evaluator - could be enhanced with a proper expression parser
    try {
      const [attribute, operator, value] = condition.split(' ');
      const userValue = userAttributes[attribute];

      switch (operator) {
        case '==':
          return userValue === value;
        case '!=':
          return userValue !== value;
        case 'contains':
          return userValue && userValue.includes(value);
        case 'in':
          return value.split(',').includes(userValue);
        default:
          return false;
      }
    } catch (error) {
      return false;
    }
  }

  // Session Management
  private generateSessionTokens(user: any, provider: SSOProvider): any {
    const sessionId = crypto.randomUUID();
    const accessToken = jwtUtils.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sessionId,
      provider: provider.id,
    }, '1h');

    const refreshToken = jwtUtils.sign({
      userId: user.id,
      sessionId,
      type: 'refresh',
    }, '7d');

    return {
      sessionId,
      accessToken,
      refreshToken,
      expiresIn: 3600,
    };
  }

  private async createSSOSession(userId: string, providerId: string, sessionId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    await prisma.ssoSession.create({
      data: {
        id: sessionId,
        userId,
        providerId,
        expiresAt,
        metadata: {
          userAgent: '',
          ipAddress: '',
          loginTime: new Date(),
        },
      },
    });

    // Store in Redis for quick access
    await redis.setex(`session:${sessionId}`, 28800, JSON.stringify({
      userId,
      providerId,
      loginTime: new Date(),
    }));
  }

  async validateSSOSession(sessionId: string): Promise<any> {
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    const session = await prisma.ssoSession.findUnique({
      where: { id: sessionId },
      include: { user: true, provider: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    return session;
  }

  async terminateSSOSession(sessionId: string): Promise<void> {
    await prisma.ssoSession.delete({
      where: { id: sessionId },
    });
    await redis.del(`session:${sessionId}`);
  }

  // Utility Methods
  private encryptSensitiveData(config: any): any {
    const secretKey = process.env.SSO_ENCRYPTION_KEY || 'default-key-change-in-production';
    const algorithm = 'aes-256-gcm';

    const encrypted = { ...config };

    if (config.saml?.privateCert) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipher(algorithm, secretKey);
      encrypted.saml.privateCert = cipher.update(config.saml.privateCert, 'utf8', 'hex') + cipher.final('hex');
    }

    if (config.oauth?.clientSecret) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipher(algorithm, secretKey);
      encrypted.oauth.clientSecret = cipher.update(config.oauth.clientSecret, 'utf8', 'hex') + cipher.final('hex');
    }

    return encrypted;
  }

  private decryptSensitiveData(config: any): any {
    const secretKey = process.env.SSO_ENCRYPTION_KEY || 'default-key-change-in-production';
    const algorithm = 'aes-256-gcm';

    const decrypted = { ...config };

    try {
      if (config.saml?.privateCert) {
        const decipher = crypto.createDecipher(algorithm, secretKey);
        decrypted.saml.privateCert = decipher.update(config.saml.privateCert, 'hex', 'utf8') + decipher.final('utf8');
      }

      if (config.oauth?.clientSecret) {
        const decipher = crypto.createDecipher(algorithm, secretKey);
        decrypted.oauth.clientSecret = decipher.update(config.oauth.clientSecret, 'hex', 'utf8') + decipher.final('utf8');
      }
    } catch (error) {
      console.error('Failed to decrypt sensitive data:', error);
    }

    return decrypted;
  }

  private async createAuditLog(action: string, details: any): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: details.userId || 'system',
          action,
          resource: 'sso',
          details,
          timestamp: new Date(),
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'system',
        },
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }
  }

  // External Provider Integration
  async syncAuth0Users(organizationId: string): Promise<void> {
    if (!this.auth0Client) {
      throw new Error('Auth0 client not configured');
    }

    try {
      const auth0Users = await this.auth0Client.getUsers();

      for (const auth0User of auth0Users) {
        await this.syncExternalUser('auth0', organizationId, auth0User);
      }
    } catch (error) {
      console.error('Failed to sync Auth0 users:', error);
      throw error;
    }
  }

  async syncOktaUsers(organizationId: string): Promise<void> {
    if (!this.oktaClient) {
      throw new Error('Okta client not configured');
    }

    try {
      const oktaUsers = await this.oktaClient.listUsers();

      for await (const oktaUser of oktaUsers) {
        await this.syncExternalUser('okta', organizationId, oktaUser);
      }
    } catch (error) {
      console.error('Failed to sync Okta users:', error);
      throw error;
    }
  }

  private async syncExternalUser(source: string, organizationId: string, externalUser: any): Promise<void> {
    const email = externalUser.email;
    if (!email) return;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (!existingUser) {
      // Create new user
      await prisma.user.create({
        data: {
          email,
          firstName: externalUser.given_name || externalUser.firstName || '',
          lastName: externalUser.family_name || externalUser.lastName || '',
          role: 'LEARNER',
          organizationId,
          isActive: true,
          emailVerified: new Date(),
          hashedPassword: '',
          externalId: externalUser.user_id || externalUser.id,
          externalSource: source,
        },
      });
    }
  }
}

export const enterpriseSSO = new EnterpriseSSO();
export default enterpriseSSO;