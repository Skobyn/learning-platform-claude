import * as saml from 'samlify';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as xmlCrypto from 'xml-crypto';
import * as xml2js from 'xml2js';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

interface SAMLConfiguration {
  entityId: string;
  ssoServiceUrl: string;
  sloServiceUrl?: string;
  certificate: string;
  privateKey?: string;
  nameIdFormat?: string;
  signatureAlgorithm?: string;
  digestAlgorithm?: string;
  authnRequestsSigned?: boolean;
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
  acceptedClockSkewMs?: number;
  attributeStatements?: AttributeStatement[];
}

interface AttributeStatement {
  name: string;
  friendlyName?: string;
  nameFormat?: string;
  required?: boolean;
  mapping?: string;
}

interface SAMLResponse {
  issuer: string;
  sessionIndex: string;
  nameId: string;
  nameIdFormat: string;
  attributes: Record<string, any>;
  conditions: {
    notBefore: Date;
    notOnOrAfter: Date;
    audience: string;
  };
  authnStatement: {
    authnInstant: Date;
    sessionNotOnOrAfter?: Date;
    authnContext: string;
  };
}

interface SAMLRequest {
  id: string;
  issueInstant: Date;
  destination: string;
  issuer: string;
  nameIdPolicy?: {
    format: string;
    allowCreate?: boolean;
  };
  requestedAuthnContext?: {
    comparison: string;
    classRefs: string[];
  };
}

const samlConfigSchema = z.object({
  entityId: z.string().min(1),
  ssoServiceUrl: z.string().url(),
  sloServiceUrl: z.string().url().optional(),
  certificate: z.string().min(1),
  privateKey: z.string().optional(),
  nameIdFormat: z.string().default('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'),
  signatureAlgorithm: z.string().default('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'),
  digestAlgorithm: z.string().default('http://www.w3.org/2001/04/xmlenc#sha256'),
  authnRequestsSigned: z.boolean().default(true),
  wantAssertionsSigned: z.boolean().default(true),
  wantAuthnResponseSigned: z.boolean().default(true),
  acceptedClockSkewMs: z.number().default(5000),
  attributeStatements: z.array(z.object({
    name: z.string(),
    friendlyName: z.string().optional(),
    nameFormat: z.string().optional(),
    required: z.boolean().default(false),
    mapping: z.string().optional(),
  })).default([]),
});

export class SAMLService {
  private serviceProvider: any;
  private identityProviders: Map<string, any> = new Map();

  constructor() {
    this.initializeServiceProvider();
  }

  private initializeServiceProvider(): void {
    const spConfig = {
      entityID: process.env.SAML_SP_ENTITY_ID || `${process.env.NEXTAUTH_URL}/auth/saml/metadata`,
      assertionConsumerService: [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: `${process.env.NEXTAUTH_URL}/api/auth/saml/acs`,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: `${process.env.NEXTAUTH_URL}/api/auth/saml/acs`,
        },
      ],
      singleLogoutService: [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: `${process.env.NEXTAUTH_URL}/api/auth/saml/sls`,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: `${process.env.NEXTAUTH_URL}/api/auth/saml/sls`,
        },
      ],
      nameIDFormat: [
        saml.Constants.namespace.format.emailAddress,
        saml.Constants.namespace.format.transient,
        saml.Constants.namespace.format.persistent,
      ],
      signingCert: process.env.SAML_SP_CERT,
      privateKey: process.env.SAML_SP_PRIVATE_KEY,
      wantAssertionsSigned: true,
      wantLogoutResponseSigned: true,
      wantLogoutRequestSigned: true,
      wantAuthnResponseSigned: true,
      signatureAlgorithm: saml.Constants.algorithms.signature.RSA_SHA256,
    };

    this.serviceProvider = saml.ServiceProvider(spConfig);
  }

  // Identity Provider Management
  async createIdentityProvider(organizationId: string, config: SAMLConfiguration): Promise<string> {
    const validated = samlConfigSchema.parse(config);

    const idpId = crypto.randomUUID();

    // Create samlify Identity Provider
    const idpConfig = {
      entityID: validated.entityId,
      singleSignOnService: [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: validated.ssoServiceUrl,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: validated.ssoServiceUrl,
        },
      ],
      singleLogoutService: validated.sloServiceUrl ? [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: validated.sloServiceUrl,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: validated.sloServiceUrl,
        },
      ] : [],
      nameIDFormat: [validated.nameIdFormat],
      signingCert: validated.certificate,
      wantAuthnRequestsSigned: validated.authnRequestsSigned,
      messageSigningOrder: 'encrypt-then-sign',
    };

    const identityProvider = saml.IdentityProvider(idpConfig);
    this.identityProviders.set(idpId, identityProvider);

    // Store configuration in database
    await prisma.samlIdentityProvider.create({
      data: {
        id: idpId,
        organizationId,
        entityId: validated.entityId,
        ssoServiceUrl: validated.ssoServiceUrl,
        sloServiceUrl: validated.sloServiceUrl,
        certificate: validated.certificate,
        privateKey: this.encryptPrivateKey(validated.privateKey),
        nameIdFormat: validated.nameIdFormat,
        signatureAlgorithm: validated.signatureAlgorithm,
        digestAlgorithm: validated.digestAlgorithm,
        configuration: validated,
        attributeStatements: validated.attributeStatements,
        isActive: true,
        metadata: {
          createdAt: new Date(),
          lastUpdated: new Date(),
        },
      },
    });

    // Cache the IdP configuration
    await redis.setex(
      `saml:idp:${idpId}`,
      3600,
      JSON.stringify({ idpId, config: validated })
    );

    await this.createAuditLog('SAML_IDP_CREATED', {
      idpId,
      organizationId,
      entityId: validated.entityId,
    });

    return idpId;
  }

  async getIdentityProvider(idpId: string): Promise<any> {
    if (this.identityProviders.has(idpId)) {
      return this.identityProviders.get(idpId);
    }

    const idpConfig = await prisma.samlIdentityProvider.findUnique({
      where: { id: idpId, isActive: true },
    });

    if (!idpConfig) {
      throw new Error('Identity Provider not found');
    }

    const identityProvider = saml.IdentityProvider({
      entityID: idpConfig.entityId,
      singleSignOnService: [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: idpConfig.ssoServiceUrl,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: idpConfig.ssoServiceUrl,
        },
      ],
      singleLogoutService: idpConfig.sloServiceUrl ? [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: idpConfig.sloServiceUrl,
        },
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: idpConfig.sloServiceUrl,
        },
      ] : [],
      nameIDFormat: [idpConfig.nameIdFormat],
      signingCert: idpConfig.certificate,
      wantAuthnRequestsSigned: idpConfig.configuration.authnRequestsSigned,
    });

    this.identityProviders.set(idpId, identityProvider);
    return identityProvider;
  }

  // SAML Authentication Flow
  async createAuthRequest(idpId: string, returnUrl?: string): Promise<{ url: string; relayState: string }> {
    const identityProvider = await this.getIdentityProvider(idpId);

    const relayState = crypto.randomBytes(32).toString('hex');

    // Store relay state with metadata
    await redis.setex(`saml:relay:${relayState}`, 600, JSON.stringify({
      idpId,
      returnUrl,
      timestamp: Date.now(),
    }));

    try {
      const { context } = this.serviceProvider.createLoginRequest(identityProvider, 'redirect');

      // Log the authentication request
      await this.createAuditLog('SAML_AUTH_REQUEST_CREATED', {
        idpId,
        relayState,
        requestId: context.id,
      });

      return {
        url: context,
        relayState,
      };
    } catch (error) {
      console.error('Failed to create SAML auth request:', error);
      throw new Error('Failed to create authentication request');
    }
  }

  async handleAuthResponse(response: string, relayState?: string): Promise<SAMLResponse> {
    if (!relayState) {
      throw new Error('RelayState is required');
    }

    const relayData = await redis.get(`saml:relay:${relayState}`);
    if (!relayData) {
      throw new Error('Invalid or expired RelayState');
    }

    const { idpId } = JSON.parse(relayData);
    await redis.del(`saml:relay:${relayState}`);

    const identityProvider = await this.getIdentityProvider(idpId);

    try {
      const { extract } = await this.serviceProvider.parseLoginResponse(identityProvider, 'post', {
        body: { SAMLResponse: response, RelayState: relayState },
      });

      // Validate response
      await this.validateSAMLResponse(extract, idpId);

      const samlResponse: SAMLResponse = {
        issuer: extract.issuer,
        sessionIndex: extract.sessionIndex?.sessionIndex,
        nameId: extract.nameID,
        nameIdFormat: extract.nameIDFormat,
        attributes: this.extractAttributes(extract.attributes, idpId),
        conditions: {
          notBefore: new Date(extract.conditions?.notBefore),
          notOnOrAfter: new Date(extract.conditions?.notOnOrAfter),
          audience: extract.conditions?.audience,
        },
        authnStatement: {
          authnInstant: new Date(extract.authnStatement?.authnInstant),
          sessionNotOnOrAfter: extract.authnStatement?.sessionNotOnOrAfter ?
            new Date(extract.authnStatement.sessionNotOnOrAfter) : undefined,
          authnContext: extract.authnStatement?.authnContext,
        },
      };

      await this.createAuditLog('SAML_AUTH_RESPONSE_PROCESSED', {
        idpId,
        nameId: samlResponse.nameId,
        sessionIndex: samlResponse.sessionIndex,
        attributes: Object.keys(samlResponse.attributes),
      });

      return samlResponse;
    } catch (error) {
      await this.createAuditLog('SAML_AUTH_RESPONSE_FAILED', {
        idpId,
        error: error.message,
        relayState,
      });
      throw new Error(`SAML response validation failed: ${error.message}`);
    }
  }

  // SAML Logout
  async createLogoutRequest(idpId: string, nameId: string, sessionIndex?: string): Promise<string> {
    const identityProvider = await this.getIdentityProvider(idpId);

    try {
      const { context } = this.serviceProvider.createLogoutRequest(identityProvider, 'redirect', {
        nameID: nameId,
        sessionIndex,
      });

      await this.createAuditLog('SAML_LOGOUT_REQUEST_CREATED', {
        idpId,
        nameId,
        sessionIndex,
      });

      return context;
    } catch (error) {
      console.error('Failed to create SAML logout request:', error);
      throw new Error('Failed to create logout request');
    }
  }

  async handleLogoutResponse(response: string, relayState?: string): Promise<void> {
    if (!relayState) {
      throw new Error('RelayState is required for logout response');
    }

    const relayData = await redis.get(`saml:relay:${relayState}`);
    if (!relayData) {
      throw new Error('Invalid or expired RelayState');
    }

    const { idpId } = JSON.parse(relayData);
    await redis.del(`saml:relay:${relayState}`);

    const identityProvider = await this.getIdentityProvider(idpId);

    try {
      await this.serviceProvider.parseLogoutResponse(identityProvider, 'post', {
        body: { SAMLResponse: response, RelayState: relayState },
      });

      await this.createAuditLog('SAML_LOGOUT_RESPONSE_PROCESSED', {
        idpId,
        relayState,
      });
    } catch (error) {
      await this.createAuditLog('SAML_LOGOUT_RESPONSE_FAILED', {
        idpId,
        error: error.message,
        relayState,
      });
      throw new Error(`SAML logout response validation failed: ${error.message}`);
    }
  }

  // Metadata Generation
  async generateServiceProviderMetadata(): Promise<string> {
    try {
      const metadata = this.serviceProvider.getMetadata();
      return metadata;
    } catch (error) {
      console.error('Failed to generate SP metadata:', error);
      throw new Error('Failed to generate service provider metadata');
    }
  }

  async getIdentityProviderMetadata(idpId: string): Promise<string> {
    const identityProvider = await this.getIdentityProvider(idpId);

    try {
      const metadata = identityProvider.getMetadata();
      return metadata;
    } catch (error) {
      console.error('Failed to get IdP metadata:', error);
      throw new Error('Failed to get identity provider metadata');
    }
  }

  // Certificate Management
  async updateServiceProviderCertificate(certificate: string, privateKey: string): Promise<void> {
    // Validate certificate and private key
    await this.validateCertificateKeyPair(certificate, privateKey);

    // Update environment variables or configuration
    process.env.SAML_SP_CERT = certificate;
    process.env.SAML_SP_PRIVATE_KEY = privateKey;

    // Reinitialize service provider
    this.initializeServiceProvider();

    await this.createAuditLog('SAML_SP_CERTIFICATE_UPDATED', {
      certificateFingerprint: this.getCertificateFingerprint(certificate),
    });
  }

  async rotateCertificate(idpId: string, newCertificate: string): Promise<void> {
    const idpConfig = await prisma.samlIdentityProvider.findUnique({
      where: { id: idpId },
    });

    if (!idpConfig) {
      throw new Error('Identity Provider not found');
    }

    // Validate the new certificate
    await this.validateCertificate(newCertificate);

    // Update certificate in database
    await prisma.samlIdentityProvider.update({
      where: { id: idpId },
      data: {
        certificate: newCertificate,
        metadata: {
          ...idpConfig.metadata,
          lastCertificateUpdate: new Date(),
        },
      },
    });

    // Clear cache
    await redis.del(`saml:idp:${idpId}`);
    this.identityProviders.delete(idpId);

    await this.createAuditLog('SAML_IDP_CERTIFICATE_ROTATED', {
      idpId,
      oldFingerprint: this.getCertificateFingerprint(idpConfig.certificate),
      newFingerprint: this.getCertificateFingerprint(newCertificate),
    });
  }

  // Validation Methods
  private async validateSAMLResponse(extract: any, idpId: string): Promise<void> {
    const idpConfig = await prisma.samlIdentityProvider.findUnique({
      where: { id: idpId },
    });

    if (!idpConfig) {
      throw new Error('Identity Provider configuration not found');
    }

    // Check timing constraints
    const now = new Date();
    const notBefore = new Date(extract.conditions?.notBefore);
    const notOnOrAfter = new Date(extract.conditions?.notOnOrAfter);

    if (now < notBefore) {
      throw new Error('SAML assertion not yet valid');
    }

    if (now > notOnOrAfter) {
      throw new Error('SAML assertion has expired');
    }

    // Validate audience
    const audience = extract.conditions?.audience;
    const expectedAudience = process.env.SAML_SP_ENTITY_ID;
    if (audience !== expectedAudience) {
      throw new Error('Invalid audience in SAML assertion');
    }

    // Check for replay attacks
    const assertionId = extract.assertionID;
    const replayKey = `saml:assertion:${assertionId}`;
    const exists = await redis.get(replayKey);

    if (exists) {
      throw new Error('SAML assertion replay detected');
    }

    // Store assertion ID to prevent replay
    const expiryTime = Math.floor((notOnOrAfter.getTime() - Date.now()) / 1000);
    await redis.setex(replayKey, Math.max(expiryTime, 60), 'used');
  }

  private extractAttributes(rawAttributes: any, idpId: string): Record<string, any> {
    if (!rawAttributes) return {};

    const attributes: Record<string, any> = {};

    // Handle different attribute formats
    for (const [key, value] of Object.entries(rawAttributes)) {
      if (Array.isArray(value) && value.length === 1) {
        attributes[key] = value[0];
      } else {
        attributes[key] = value;
      }
    }

    return attributes;
  }

  private async validateCertificate(certificate: string): Promise<void> {
    try {
      // Remove header/footer if present
      const cleanCert = certificate.replace(/-----BEGIN CERTIFICATE-----/, '')
                                 .replace(/-----END CERTIFICATE-----/, '')
                                 .replace(/\s/g, '');

      // Try to parse the certificate
      const certBuffer = Buffer.from(cleanCert, 'base64');
      const crypto = require('crypto');

      // This is a basic validation - in production, you might want more thorough checks
      if (certBuffer.length < 100) {
        throw new Error('Certificate appears to be invalid');
      }
    } catch (error) {
      throw new Error(`Invalid certificate: ${error.message}`);
    }
  }

  private async validateCertificateKeyPair(certificate: string, privateKey: string): Promise<void> {
    try {
      // Validate certificate
      await this.validateCertificate(certificate);

      // Validate private key format
      if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
        throw new Error('Invalid private key format');
      }

      // Test signing capability
      const testData = 'test-signature-verification';
      const sign = crypto.createSign('SHA256');
      sign.update(testData);
      sign.end();

      const signature = sign.sign(privateKey, 'base64');

      // Verify signature
      const verify = crypto.createVerify('SHA256');
      verify.update(testData);
      verify.end();

      const isValid = verify.verify(certificate, signature, 'base64');
      if (!isValid) {
        throw new Error('Certificate and private key do not match');
      }
    } catch (error) {
      throw new Error(`Certificate/key validation failed: ${error.message}`);
    }
  }

  private getCertificateFingerprint(certificate: string): string {
    try {
      const cleanCert = certificate.replace(/-----BEGIN CERTIFICATE-----/, '')
                                 .replace(/-----END CERTIFICATE-----/, '')
                                 .replace(/\s/g, '');
      const certBuffer = Buffer.from(cleanCert, 'base64');
      return crypto.createHash('sha256').update(certBuffer).digest('hex');
    } catch (error) {
      return 'unknown';
    }
  }

  private encryptPrivateKey(privateKey?: string): string | null {
    if (!privateKey) return null;

    const algorithm = 'aes-256-gcm';
    const secretKey = process.env.SAML_ENCRYPTION_KEY || 'default-key-change-in-production';

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipher(algorithm, secretKey);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return encrypted;
  }

  private decryptPrivateKey(encryptedKey: string): string {
    const algorithm = 'aes-256-gcm';
    const secretKey = process.env.SAML_ENCRYPTION_KEY || 'default-key-change-in-production';

    const decipher = crypto.createDecipher(algorithm, secretKey);
    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private async createAuditLog(action: string, details: any): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: details.userId || 'system',
          action,
          resource: 'saml',
          details,
          timestamp: new Date(),
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'system',
        },
      });
    } catch (error) {
      console.error('Failed to create SAML audit log:', error);
    }
  }

  // Health Check and Diagnostics
  async healthCheck(): Promise<{ status: string; checks: any[] }> {
    const checks = [];

    // Check if SP certificate is valid
    try {
      if (process.env.SAML_SP_CERT) {
        await this.validateCertificate(process.env.SAML_SP_CERT);
        checks.push({ name: 'SP Certificate', status: 'ok' });
      } else {
        checks.push({ name: 'SP Certificate', status: 'missing' });
      }
    } catch (error) {
      checks.push({ name: 'SP Certificate', status: 'invalid', error: error.message });
    }

    // Check active IdPs
    const activeIdPs = await prisma.samlIdentityProvider.count({
      where: { isActive: true },
    });
    checks.push({ name: 'Active Identity Providers', status: 'ok', count: activeIdPs });

    // Check Redis connectivity
    try {
      await redis.ping();
      checks.push({ name: 'Redis Connection', status: 'ok' });
    } catch (error) {
      checks.push({ name: 'Redis Connection', status: 'failed', error: error.message });
    }

    const overallStatus = checks.every(check => check.status === 'ok') ? 'healthy' : 'unhealthy';

    return { status: overallStatus, checks };
  }
}

export const samlService = new SAMLService();
export default samlService;