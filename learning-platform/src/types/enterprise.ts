// Enterprise SSO and Authentication Types
import { AuthProvider, SsoType, MfaMethod, TrustLevel, IpRuleType, RiskLevel, AlertType, AlertSeverity } from '@prisma/client';

// SAML Types
export interface SAMLUser {
  nameId: string;
  sessionIndex?: string;
  attributes: Record<string, any>;
  groups?: string[];
}

export interface SAMLConfig {
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl?: string;
  idpCertificate: string;
  spEntityId: string;
  spAssertionConsumerUrl: string;
  spSingleLogoutUrl?: string;
  spPrivateKey?: string;
  spCertificate?: string;
  attributeMapping: AttributeMapping;
  wantAssertionsSigned: boolean;
  wantAuthnRequestsSigned: boolean;
  signatureAlgorithm: string;
}

export interface AttributeMapping {
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
  employeeId?: string;
  groups?: string;
  [key: string]: string | undefined;
}

// OAuth Types
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string[];
  attributeMapping: AttributeMapping;
}

export interface OAuthUser {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  [key: string]: any;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

// SSO Provider Types
export interface SSOProvider {
  id: string;
  name: string;
  displayName: string;
  type: SsoType;
  organizationId: string;
  isActive: boolean;
  samlConfig?: SAMLConfig;
  oauthConfig?: OAuthConfig;
}

// MFA Types
export interface MFASetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFAVerification {
  token: string;
  backupCode?: boolean;
}

export interface MFASettings {
  isEnabled: boolean;
  method: MfaMethod;
  backupCodes: string[];
  lastUsedAt?: Date;
  failedAttempts: number;
  lastFailedAt?: Date;
}

// Device Trust Types
export interface DeviceInfo {
  userAgent: string;
  platform?: string;
  browser?: string;
  os?: string;
  osVersion?: string;
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET' | 'UNKNOWN';
  screenResolution?: string;
  timezone?: string;
  language?: string;
}

export interface TrustedDevice {
  id: string;
  fingerprint: string;
  name: string;
  deviceInfo: DeviceInfo;
  isTrusted: boolean;
  trustLevel: TrustLevel;
  lastUsedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

export interface DeviceRegistration {
  fingerprint: string;
  name: string;
  deviceInfo: DeviceInfo;
}

// IP Whitelist Types
export interface IpWhitelistRule {
  id: string;
  organizationId: string;
  name: string;
  ipAddress?: string;
  ipRange?: string;
  ruleType: IpRuleType;
  description?: string;
  isActive: boolean;
  metadata?: Record<string, any>;
}

export interface IpValidationResult {
  isAllowed: boolean;
  matchedRule?: IpWhitelistRule;
  location?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

// Session Management Types
export interface SessionData {
  userId: string;
  email: string;
  role: string;
  organizationId?: string;
  authProvider: AuthProvider;
  mfaVerified: boolean;
  deviceFingerprint: string;
  trustedDevice: boolean;
  ipAddress: string;
  userAgent: string;
  loginTime: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export interface SessionPolicy {
  sessionTimeout: number; // minutes
  maxConcurrentSessions: number;
  requireMFA: boolean;
  requireDeviceTrust: boolean;
  allowRememberMe: boolean;
  rememberMeDuration: number; // days
}

// Security Policy Types
export interface SecurityPolicy {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  isActive: boolean;

  // Password policies
  passwordMinLength: number;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordExpiryDays?: number;
  passwordHistoryCount: number;

  // MFA policies
  requireMFA: boolean;
  mfaGracePeriod: number; // days
  allowMFARemember: boolean;
  mfaRememberDuration: number; // days

  // Session policies
  sessionTimeout: number; // minutes
  maxConcurrentSessions: number;
  requireDeviceTrust: boolean;

  // IP restrictions
  enforceIPWhitelist: boolean;
  allowedCountries: string[];
  blockedCountries: string[];

  // SSO settings
  requireSSO: boolean;
  allowLocalAuth: boolean;
  ssoSessionTimeout: number; // minutes
}

// Audit and Security Types
export interface SecurityEvent {
  id: string;
  userId?: string;
  organizationId?: string;
  eventType: string;
  description: string;
  severity: RiskLevel;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  location?: Record<string, any>;
  metadata?: Record<string, any>;
  riskScore?: number;
  timestamp: Date;
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolution?: string;
}

export interface SecurityAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  userId?: string;
  organizationId?: string;
  description: string;
  metadata: Record<string, any>;
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

// Organization Settings Types
export interface OrganizationSecuritySettings {
  requireMFA: boolean;
  allowSelfRegistration: boolean;
  allowTrustedDeviceSkipMFA: boolean;
  sessionTimeout: number;
  maxConcurrentSessions: number;
  ipWhitelistEnabled: boolean;
  ipWhitelist: string[];
  passwordMinLength: number;
  passwordRequireNumbers: boolean;
  passwordRequireSymbols: boolean;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordExpiryDays?: number;
  enforceEmailVerification: boolean;
  allowPasswordReset: boolean;
}

// Risk Assessment Types
export interface RiskAssessment {
  score: number; // 0-100
  level: RiskLevel;
  factors: RiskFactor[];
  recommendations: string[];
}

export interface RiskFactor {
  type: string;
  description: string;
  weight: number;
  severity: RiskLevel;
}

// Authentication Flow Types
export interface AuthenticationRequest {
  email: string;
  password?: string;
  mfaToken?: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  provider?: AuthProvider;
  ssoData?: any;
}

export interface AuthenticationResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: string;
    organizationId?: string;
    requires2FA: boolean;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  mfaRequired?: boolean;
  deviceTrustRequired?: boolean;
  error?: string;
  redirectUrl?: string;
}

// SSO Session Types
export interface SSOSession {
  id: string;
  userId: string;
  providerId: string;
  sessionId: string;
  nameId?: string;
  sessionIndex?: string;
  attributes?: Record<string, any>;
  accessToken?: string;
  refreshToken?: string;
  expiresAt: Date;
  terminatedAt?: Date;
}

// Enterprise Dashboard Types
export interface DashboardMetrics {
  activeUsers: number;
  totalLogins: number;
  failedLogins: number;
  mfaUsers: number;
  ssoLogins: number;
  trustedDevices: number;
  securityAlerts: number;
  riskScore: number;
}

export interface LoginAnalytics {
  date: string;
  totalLogins: number;
  successfulLogins: number;
  failedLogins: number;
  ssoLogins: number;
  mfaLogins: number;
}

export interface SecurityMetrics {
  date: string;
  securityEvents: number;
  highRiskEvents: number;
  blockedIPs: number;
  suspiciousActivities: number;
}

// Error Types
export class EnterpriseAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: any
  ) {
    super(message);
    this.name = 'EnterpriseAuthError';
  }
}

export class SAMLError extends EnterpriseAuthError {
  constructor(message: string, details?: any) {
    super(message, 'SAML_ERROR', 400, details);
    this.name = 'SAMLError';
  }
}

export class MFAError extends EnterpriseAuthError {
  constructor(message: string, details?: any) {
    super(message, 'MFA_ERROR', 400, details);
    this.name = 'MFAError';
  }
}

export class DeviceTrustError extends EnterpriseAuthError {
  constructor(message: string, details?: any) {
    super(message, 'DEVICE_TRUST_ERROR', 403, details);
    this.name = 'DeviceTrustError';
  }
}

export class IPWhitelistError extends EnterpriseAuthError {
  constructor(message: string, details?: any) {
    super(message, 'IP_WHITELIST_ERROR', 403, details);
    this.name = 'IPWhitelistError';
  }
}