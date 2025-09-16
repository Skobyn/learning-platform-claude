# Enterprise SSO/SAML Authentication Implementation

## Overview

This document provides a comprehensive overview of the enterprise-grade authentication system implemented for the learning platform. The system includes SAML 2.0, OAuth 2.0, multi-factor authentication (MFA), device trust management, IP whitelisting, and comprehensive audit logging.

## Features Implemented

### 1. SAML 2.0 Service Provider

**File:** `/src/services/sso/samlService.ts`
**Configuration:** `/config/saml/saml-config.ts`
**API Routes:** `/src/api/auth/saml/[...saml].ts`

**Supported Identity Providers:**
- Microsoft Azure AD / Entra ID
- Okta
- OneLogin
- Ping Identity
- Active Directory Federation Services (ADFS)

**Key Features:**
- Dynamic provider configuration
- Attribute mapping and user provisioning
- Group-based role assignment
- Single logout (SLO) support
- Metadata generation for IdP configuration
- Organization-specific SSO providers

### 2. OAuth 2.0 Integration

**File:** `/src/services/sso/oauthProviders.ts`
**API Routes:** `/src/api/auth/oauth/[provider].ts`

**Supported Providers:**
- Google OAuth 2.0
- Microsoft OAuth 2.0
- LinkedIn OAuth 2.0

**Key Features:**
- Automatic user provisioning
- Token refresh and management
- Account linking and unlinking
- Scope management
- CSRF protection with state parameters

### 3. Multi-Factor Authentication (MFA)

**File:** `/src/services/mfa/totpService.ts`

**Features:**
- Time-based One-Time Password (TOTP) support
- QR code generation for authenticator apps
- Backup codes for recovery
- Account lockout protection
- Admin functions for MFA management

**Supported Authenticator Apps:**
- Google Authenticator
- Microsoft Authenticator
- Authy
- 1Password
- Any RFC 6238 compliant TOTP app

### 4. Device Trust and Management

**File:** `/src/services/deviceTrust.ts`

**Features:**
- Device fingerprinting using multiple browser attributes
- Risk assessment based on device characteristics
- Trusted device management
- Location-based trust analysis
- VPN and Tor detection
- Device approval workflows

### 5. IP Whitelisting

**File:** `/src/middleware/ipWhitelist.ts`

**Features:**
- Organization-specific IP whitelisting
- Multiple rule types (single IP, IP range, CIDR, country, region)
- Automatic blocking after failed attempts
- Admin override capabilities
- Geolocation-based access control

### 6. Session Management

**File:** `/src/services/sessionManagement.ts`

**Features:**
- Device fingerprint validation
- IP address binding
- Session rotation
- Concurrent session limits
- Idle timeout management
- Session hijacking protection

### 7. Audit Logging

**File:** `/src/services/auditService.ts`

**Features:**
- Comprehensive authentication event logging
- Security alert generation
- Pattern analysis for threat detection
- Audit log export (CSV/JSON)
- Retention policy management
- Real-time security monitoring

## Database Schema Updates

The Prisma schema has been extended with comprehensive authentication models:

### New Models Added:

1. **Profile** - Separated user profile from core user data
2. **OrganizationSettings** - Organization-specific authentication policies
3. **MfaSetting** - Multi-factor authentication configuration
4. **TrustedDevice** - Device trust management
5. **OauthAccount** - OAuth account linking
6. **SsoProvider** - SSO provider configuration
7. **IpWhitelistRule** - IP access control rules
8. **AuditLog** - Security event logging
9. **SecurityAlert** - Automated security alerts
10. **PendingSession** - Temporary session storage for MFA flow
11. **GroupRoleMapping** - SAML group to role mapping
12. **UserRole** - Role-based access control

### Enhanced Models:

- **User** - Added SSO support fields, device trust, MFA settings
- **Organization** - Added multiple domains, SSO providers, IP rules
- **UserSession** - Enhanced with device fingerprinting and security metadata

## Security Configuration

### Environment Variables

Comprehensive environment configuration is provided in `.env.example`:

- Database connections
- SAML provider configurations
- OAuth client credentials
- MFA settings
- Security policies
- Feature flags

### Production Security Recommendations

1. **Certificate Management:**
   - Use proper SSL/TLS certificates for SAML
   - Rotate SAML signing certificates regularly
   - Store certificates securely (Azure Key Vault, AWS Secrets Manager)

2. **Session Security:**
   - Use secure session storage (Redis recommended)
   - Implement session rotation
   - Set appropriate cookie security flags

3. **Password Policies:**
   - Enforce strong password requirements
   - Implement password history
   - Set password expiration policies

4. **Rate Limiting:**
   - Implement API rate limiting
   - Protect against brute force attacks
   - Use CAPTCHA for suspicious activities

5. **Monitoring:**
   - Set up security alerts
   - Monitor failed login attempts
   - Track privilege escalations

## Implementation Steps

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Update environment variables with your configuration
# Pay special attention to:
# - Database connections
# - SAML certificates
# - OAuth client credentials
# - Encryption keys
```

### 2. Database Migration

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (development)
npx prisma db push

# Or create and run migrations (production)
npx prisma migrate dev --name add-authentication-features
```

### 3. SSL Certificate Generation (for SAML)

```bash
# Generate private key
openssl genrsa -out saml-sp-key.pem 2048

# Generate certificate signing request
openssl req -new -key saml-sp-key.pem -out saml-sp-csr.pem

# Generate self-signed certificate (development)
openssl x509 -req -days 365 -in saml-sp-csr.pem -signkey saml-sp-key.pem -out saml-sp-cert.pem
```

### 4. Identity Provider Configuration

Configure your identity provider with:
- **Entity ID:** `urn:learning-platform:sp`
- **ACS URL:** `https://yourdomain.com/api/auth/saml/{provider}/callback`
- **SLS URL:** `https://yourdomain.com/api/auth/saml/{provider}/logout`
- **Metadata URL:** `https://yourdomain.com/api/auth/saml/{provider}/metadata`

### 5. OAuth Application Setup

#### Google OAuth:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI

#### Microsoft OAuth:
1. Go to [Azure Portal](https://portal.azure.com/)
2. Register new application in Azure AD
3. Configure redirect URLs
4. Generate client secret

#### LinkedIn OAuth:
1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Create new application
3. Configure OAuth settings
4. Get client credentials

## API Endpoints

### SAML Endpoints

- `GET /api/auth/saml/{provider}/login` - Initiate SAML login
- `POST /api/auth/saml/{provider}/callback` - SAML assertion consumer
- `GET /api/auth/saml/{provider}/logout` - Initiate SAML logout
- `GET /api/auth/saml/{provider}/metadata` - Service provider metadata

### OAuth Endpoints

- `GET /api/auth/oauth/{provider}?action=login` - Initiate OAuth login
- `GET /api/auth/oauth/{provider}?action=callback` - OAuth callback
- `POST /api/auth/oauth/{provider}?action=disconnect` - Disconnect OAuth account
- `POST /api/auth/oauth/{provider}?action=refresh` - Refresh OAuth token

### MFA Endpoints (to be implemented)

- `POST /api/auth/mfa/setup` - Setup MFA
- `POST /api/auth/mfa/verify` - Verify MFA token
- `POST /api/auth/mfa/disable` - Disable MFA
- `GET /api/auth/mfa/backup-codes` - Generate backup codes

## Testing

### Unit Tests

Create tests for:
- SAML response processing
- OAuth token handling
- MFA token validation
- Device fingerprinting
- Session management

### Integration Tests

Test scenarios:
- End-to-end SAML login flow
- OAuth provider integration
- MFA enrollment and verification
- Device trust workflows
- Session security

### Security Testing

Perform:
- Penetration testing
- SAML assertion manipulation tests
- Session hijacking tests
- MFA bypass attempts
- IP restriction tests

## Monitoring and Maintenance

### Metrics to Monitor

1. **Authentication Success Rates**
   - SAML login success/failure rates
   - OAuth provider success rates
   - MFA verification rates

2. **Security Events**
   - Failed login attempts
   - IP restriction violations
   - Device trust violations
   - Privilege escalations

3. **Performance Metrics**
   - Authentication response times
   - Session validation performance
   - Database query performance

### Maintenance Tasks

1. **Regular Tasks:**
   - Review audit logs
   - Update IP whitelist rules
   - Rotate encryption keys
   - Update SAML certificates

2. **Periodic Tasks:**
   - Security assessment
   - Performance optimization
   - Dependency updates
   - Backup validation

## Compliance

The implementation supports compliance with:

- **SOC 2 Type II** - Comprehensive audit logging and access controls
- **GDPR** - User consent and data protection features
- **HIPAA** - Healthcare data protection (with additional configuration)
- **FERPA** - Educational data protection
- **ISO 27001** - Information security management

## Troubleshooting

### Common Issues

1. **SAML Login Failures**
   - Check certificate validity
   - Verify IdP configuration
   - Review assertion mappings

2. **OAuth Issues**
   - Validate redirect URIs
   - Check client credentials
   - Review scope permissions

3. **MFA Problems**
   - Verify time synchronization
   - Check backup codes
   - Review user configuration

4. **Session Issues**
   - Check Redis connection
   - Review session configuration
   - Validate device fingerprints

### Debug Mode

Enable debugging with:
```bash
DEBUG=true
LOG_LEVEL=debug
```

### Support

For implementation support:
1. Review audit logs for error details
2. Check application logs
3. Verify environment configuration
4. Test with minimal configuration first

---

This implementation provides enterprise-grade security and authentication capabilities suitable for organizations requiring advanced access control, compliance, and security monitoring.