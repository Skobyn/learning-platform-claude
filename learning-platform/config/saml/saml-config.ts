import { SamlConfig } from '@node-saml/passport-saml';

// SAML Configuration for Enterprise SSO
export interface SAMLProviderConfig extends SamlConfig {
  name: string;
  displayName: string;
  organizationId?: string;
  isActive: boolean;
  metadata?: {
    contactPerson?: {
      technical?: {
        givenName: string;
        emailAddress: string;
      };
      support?: {
        givenName: string;
        emailAddress: string;
      };
    };
    organization?: {
      name: string;
      displayName: string;
      url: string;
    };
  };
}

// Default SAML Configuration Template
export const defaultSAMLConfig: Partial<SAMLProviderConfig> = {
  // Service Provider Configuration
  issuer: process.env.SAML_SP_ISSUER || 'urn:learning-platform:sp',
  callbackUrl: process.env.SAML_CALLBACK_URL || 'https://platform.example.com/auth/saml/callback',

  // Security Settings
  wantAssertionsSigned: true,
  wantAuthnResponseSigned: true,
  signatureAlgorithm: 'sha256',
  digestAlgorithm: 'sha256',

  // Certificate Settings (must be provided via environment)
  cert: process.env.SAML_IDP_CERT,
  privateCert: process.env.SAML_SP_PRIVATE_KEY,
  decryptionPvk: process.env.SAML_SP_PRIVATE_KEY,

  // Request Settings
  forceAuthn: false,
  skipRequestCompression: false,
  requestIdExpirationPeriodMs: 3600000, // 1 hour

  // Response Validation
  validateInResponseTo: true,
  requestIdExpirationPeriodMs: 28800000, // 8 hours

  // Logout Settings
  logoutUrl: process.env.SAML_LOGOUT_URL,
  logoutCallbackUrl: process.env.SAML_LOGOUT_CALLBACK_URL,

  // Attribute Mapping
  attributeConsumingServiceIndex: false,
  authnContext: ['urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'],
  identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',

  // Clock Tolerance
  acceptedClockSkewMs: 5000,

  isActive: true
};

// Pre-configured SAML providers for common identity providers
export const samlProviders: { [key: string]: SAMLProviderConfig } = {
  // Azure AD / Microsoft Entra ID
  azuread: {
    ...defaultSAMLConfig,
    name: 'azuread',
    displayName: 'Microsoft Azure AD',
    entryPoint: process.env.AZURE_SAML_ENTRY_POINT,
    cert: process.env.AZURE_SAML_CERT,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:persistent',
    authnContext: ['urn:oasis:names:tc:SAML:2.0:ac:classes:Password'],
    issuer: process.env.AZURE_SAML_ISSUER || 'urn:learning-platform:sp',
    metadata: {
      organization: {
        name: 'Learning Platform',
        displayName: 'Enterprise Learning Platform',
        url: 'https://platform.example.com'
      }
    }
  } as SAMLProviderConfig,

  // Okta
  okta: {
    ...defaultSAMLConfig,
    name: 'okta',
    displayName: 'Okta',
    entryPoint: process.env.OKTA_SAML_ENTRY_POINT,
    cert: process.env.OKTA_SAML_CERT,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    issuer: process.env.OKTA_SAML_ISSUER || 'urn:learning-platform:sp'
  } as SAMLProviderConfig,

  // OneLogin
  onelogin: {
    ...defaultSAMLConfig,
    name: 'onelogin',
    displayName: 'OneLogin',
    entryPoint: process.env.ONELOGIN_SAML_ENTRY_POINT,
    cert: process.env.ONELOGIN_SAML_CERT,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    issuer: process.env.ONELOGIN_SAML_ISSUER || 'urn:learning-platform:sp'
  } as SAMLProviderConfig,

  // Ping Identity
  pingidentity: {
    ...defaultSAMLConfig,
    name: 'pingidentity',
    displayName: 'Ping Identity',
    entryPoint: process.env.PING_SAML_ENTRY_POINT,
    cert: process.env.PING_SAML_CERT,
    identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    issuer: process.env.PING_SAML_ISSUER || 'urn:learning-platform:sp'
  } as SAMLProviderConfig,

  // ADFS
  adfs: {
    ...defaultSAMLConfig,
    name: 'adfs',
    displayName: 'Active Directory Federation Services',
    entryPoint: process.env.ADFS_SAML_ENTRY_POINT,
    cert: process.env.ADFS_SAML_CERT,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    authnContext: ['urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'],
    issuer: process.env.ADFS_SAML_ISSUER || 'urn:learning-platform:sp'
  } as SAMLProviderConfig
};

// Attribute mapping configuration
export const attributeMapping = {
  email: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email', 'mail'],
  firstName: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'firstName', 'givenName'],
  lastName: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', 'lastName', 'surname'],
  displayName: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', 'displayName', 'name'],
  department: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department', 'department'],
  jobTitle: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/title', 'jobTitle', 'title'],
  groups: ['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups', 'groups', 'memberOf'],
  employeeId: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/employeeid', 'employeeId'],
  upn: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn', 'upn'],
  organizationId: ['organizationId', 'tenantId', 'companyId']
};

// Security policies
export const securityPolicies = {
  // Session timeout in milliseconds
  sessionTimeout: 28800000, // 8 hours

  // Maximum concurrent sessions per user
  maxConcurrentSessions: 3,

  // Password requirements for fallback authentication
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    preventReuse: 12
  },

  // MFA requirements
  mfaPolicy: {
    required: true,
    gracePeriodDays: 7,
    backupCodesCount: 10
  },

  // Device trust settings
  deviceTrustPolicy: {
    trustPeriodDays: 30,
    requireApprovalForNewDevices: true,
    allowRememberDevice: true
  }
};

export default {
  samlProviders,
  defaultSAMLConfig,
  attributeMapping,
  securityPolicies
};