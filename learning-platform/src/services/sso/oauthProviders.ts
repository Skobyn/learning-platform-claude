import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import { prisma } from '@/lib/db';
import { auditService } from '../auditService';
import { deviceTrustService } from '../deviceTrust';
import { createHash } from 'crypto';

export interface OAuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  profilePicture?: string;
  provider: 'google' | 'microsoft' | 'linkedin';
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  profile: any;
}

export interface OAuthAuthResult {
  user: OAuthUser;
  isNewUser: boolean;
  requiresMFA: boolean;
  deviceTrusted: boolean;
  organizationSettings: any;
}

class OAuthService {
  private strategies: Map<string, any> = new Map();

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize OAuth providers
   */
  private initializeProviders(): void {
    this.initializeGoogleStrategy();
    this.initializeMicrosoftStrategy();
    this.initializeLinkedInStrategy();
  }

  /**
   * Initialize Google OAuth strategy
   */
  private initializeGoogleStrategy(): void {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.warn('Google OAuth credentials not configured');
      return;
    }

    const strategy = new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/oauth/google/callback',
        passReqToCallback: true,
        scope: ['profile', 'email']
      },
      async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          const result = await this.handleOAuthResponse(
            req,
            accessToken,
            refreshToken,
            profile,
            'google'
          );
          return done(null, result);
        } catch (error) {
          console.error('Google OAuth error:', error);
          return done(error);
        }
      }
    );

    passport.use('google', strategy);
    this.strategies.set('google', strategy);
  }

  /**
   * Initialize Microsoft OAuth strategy
   */
  private initializeMicrosoftStrategy(): void {
    if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
      console.warn('Microsoft OAuth credentials not configured');
      return;
    }

    const strategy = new MicrosoftStrategy(
      {
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: process.env.MICROSOFT_CALLBACK_URL || '/api/auth/oauth/microsoft/callback',
        tenant: process.env.MICROSOFT_TENANT || 'common',
        passReqToCallback: true,
        scope: ['user.read']
      },
      async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          const result = await this.handleOAuthResponse(
            req,
            accessToken,
            refreshToken,
            profile,
            'microsoft'
          );
          return done(null, result);
        } catch (error) {
          console.error('Microsoft OAuth error:', error);
          return done(error);
        }
      }
    );

    passport.use('microsoft', strategy);
    this.strategies.set('microsoft', strategy);
  }

  /**
   * Initialize LinkedIn OAuth strategy
   */
  private initializeLinkedInStrategy(): void {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      console.warn('LinkedIn OAuth credentials not configured');
      return;
    }

    const strategy = new LinkedInStrategy(
      {
        clientID: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        callbackURL: process.env.LINKEDIN_CALLBACK_URL || '/api/auth/oauth/linkedin/callback',
        passReqToCallback: true,
        scope: ['r_emailaddress', 'r_liteprofile']
      },
      async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          const result = await this.handleOAuthResponse(
            req,
            accessToken,
            refreshToken,
            profile,
            'linkedin'
          );
          return done(null, result);
        } catch (error) {
          console.error('LinkedIn OAuth error:', error);
          return done(error);
        }
      }
    );

    passport.use('linkedin', strategy);
    this.strategies.set('linkedin', strategy);
  }

  /**
   * Handle OAuth authentication response
   */
  private async handleOAuthResponse(
    req: any,
    accessToken: string,
    refreshToken: string,
    profile: any,
    provider: 'google' | 'microsoft' | 'linkedin'
  ): Promise<OAuthAuthResult> {
    const userAgent = req.get('User-Agent') || '';
    const ipAddress = req.ip || req.connection.remoteAddress || '';

    // Extract user data from OAuth profile
    const oauthUser = this.extractOAuthUserData(profile, provider, accessToken, refreshToken);

    // Log authentication attempt
    await auditService.logAuthenticationEvent({
      userId: oauthUser.email,
      event: 'oauth_login_attempt',
      provider,
      ipAddress,
      userAgent,
      success: true,
      metadata: {
        providerId: oauthUser.providerId,
        profileId: profile.id
      }
    });

    // Get organization settings based on email domain
    const emailDomain = oauthUser.email.split('@')[1];
    const organizationSettings = await this.getOrganizationByDomain(emailDomain);

    // Validate IP whitelist if configured
    if (organizationSettings?.ipWhitelist?.length > 0) {
      const isWhitelisted = await this.validateIPWhitelist(ipAddress, organizationSettings.ipWhitelist);
      if (!isWhitelisted) {
        await auditService.logAuthenticationEvent({
          userId: oauthUser.email,
          event: 'ip_whitelist_violation',
          provider,
          ipAddress,
          userAgent,
          success: false
        });
        throw new Error('Access denied: IP address not whitelisted');
      }
    }

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: oauthUser.email },
          {
            authProvider: provider.toUpperCase() as any,
            authProviderId: oauthUser.providerId
          }
        ]
      },
      include: {
        organization: true,
        mfaSettings: true,
        trustedDevices: true,
        oauthAccounts: true
      }
    });

    const isNewUser = !user;

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: oauthUser.email,
          firstName: oauthUser.firstName,
          lastName: oauthUser.lastName,
          displayName: oauthUser.displayName,
          authProvider: provider.toUpperCase() as any,
          authProviderId: oauthUser.providerId,
          organizationId: organizationSettings?.id,
          isActive: true,
          emailVerified: new Date(), // OAuth users are pre-verified
          profile: {
            create: {
              bio: `${provider.charAt(0).toUpperCase() + provider.slice(1)} user`,
              avatar: oauthUser.profilePicture || this.generateAvatarURL(oauthUser.email),
              preferences: {}
            }
          },
          oauthAccounts: {
            create: {
              provider: provider.toUpperCase() as any,
              providerId: oauthUser.providerId,
              accessToken: oauthUser.accessToken,
              refreshToken: oauthUser.refreshToken,
              profile: oauthUser.profile,
              expiresAt: this.calculateTokenExpiry(provider)
            }
          }
        },
        include: {
          organization: true,
          mfaSettings: true,
          trustedDevices: true,
          oauthAccounts: true
        }
      });
    } else {
      // Update existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: oauthUser.firstName || user.firstName,
          lastName: oauthUser.lastName || user.lastName,
          displayName: oauthUser.displayName || user.displayName,
          lastLoginAt: new Date()
        },
        include: {
          organization: true,
          mfaSettings: true,
          trustedDevices: true,
          oauthAccounts: true
        }
      });

      // Update or create OAuth account
      await prisma.oauthAccount.upsert({
        where: {
          userId_provider: {
            userId: user.id,
            provider: provider.toUpperCase() as any
          }
        },
        update: {
          accessToken: oauthUser.accessToken,
          refreshToken: oauthUser.refreshToken,
          profile: oauthUser.profile,
          expiresAt: this.calculateTokenExpiry(provider),
          lastUsedAt: new Date()
        },
        create: {
          userId: user.id,
          provider: provider.toUpperCase() as any,
          providerId: oauthUser.providerId,
          accessToken: oauthUser.accessToken,
          refreshToken: oauthUser.refreshToken,
          profile: oauthUser.profile,
          expiresAt: this.calculateTokenExpiry(provider)
        }
      });
    }

    // Check device trust
    const deviceFingerprint = this.generateDeviceFingerprint(req);
    const deviceTrusted = await deviceTrustService.isDeviceTrusted(user.id, deviceFingerprint);

    // Determine MFA requirement
    const requiresMFA = this.requiresMFA(user, organizationSettings, deviceTrusted);

    // Store OAuth session information
    await this.storeOAuthSession(user.id, provider, {
      accessToken: oauthUser.accessToken,
      refreshToken: oauthUser.refreshToken,
      providerId: oauthUser.providerId
    });

    return {
      user: {
        ...oauthUser,
        id: user.id
      },
      isNewUser,
      requiresMFA,
      deviceTrusted,
      organizationSettings
    };
  }

  /**
   * Extract user data from OAuth profile
   */
  private extractOAuthUserData(
    profile: any,
    provider: 'google' | 'microsoft' | 'linkedin',
    accessToken: string,
    refreshToken: string
  ): OAuthUser {
    switch (provider) {
      case 'google':
        return {
          id: '',
          email: profile.emails[0]?.value || '',
          firstName: profile.name?.givenName,
          lastName: profile.name?.familyName,
          displayName: profile.displayName,
          profilePicture: profile.photos[0]?.value,
          provider: 'google',
          providerId: profile.id,
          accessToken,
          refreshToken,
          profile: profile._json
        };

      case 'microsoft':
        return {
          id: '',
          email: profile.emails[0]?.value || profile._json?.mail || profile._json?.userPrincipalName,
          firstName: profile.name?.givenName || profile._json?.givenName,
          lastName: profile.name?.familyName || profile._json?.surname,
          displayName: profile.displayName || profile._json?.displayName,
          profilePicture: profile.photos[0]?.value,
          provider: 'microsoft',
          providerId: profile.id,
          accessToken,
          refreshToken,
          profile: profile._json
        };

      case 'linkedin':
        return {
          id: '',
          email: profile.emails[0]?.value || '',
          firstName: profile.name?.givenName,
          lastName: profile.name?.familyName,
          displayName: profile.displayName,
          profilePicture: profile.photos[0]?.value,
          provider: 'linkedin',
          providerId: profile.id,
          accessToken,
          refreshToken,
          profile: profile._json
        };

      default:
        throw new Error(`Unsupported OAuth provider: ${provider}`);
    }
  }

  /**
   * Generate device fingerprint
   */
  private generateDeviceFingerprint(req: any): string {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language') || '';
    const acceptEncoding = req.get('Accept-Encoding') || '';
    const connection = req.get('Connection') || '';
    const ipAddress = req.ip || req.connection.remoteAddress || '';

    const fingerprint = createHash('sha256')
      .update(`${userAgent}${acceptLanguage}${acceptEncoding}${connection}${ipAddress}`)
      .digest('hex');

    return fingerprint;
  }

  /**
   * Check if MFA is required
   */
  private requiresMFA(
    user: any,
    organizationSettings: any,
    deviceTrusted: boolean
  ): boolean {
    // Organization requires MFA
    if (organizationSettings?.requireMFA) {
      return true;
    }

    // User has MFA enabled
    if (user.mfaSettings?.isEnabled) {
      // Skip MFA for trusted devices if allowed
      if (organizationSettings?.allowTrustedDeviceSkipMFA && deviceTrusted) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Store OAuth session information
   */
  private async storeOAuthSession(
    userId: string,
    provider: string,
    sessionData: any
  ): Promise<void> {
    await prisma.userSession.upsert({
      where: {
        userId_provider: {
          userId,
          provider: provider.toUpperCase()
        }
      },
      update: {
        sessionData,
        lastAccessAt: new Date()
      },
      create: {
        userId,
        provider: provider.toUpperCase() as any,
        sessionData,
        lastAccessAt: new Date(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours
      }
    });
  }

  /**
   * Get organization by email domain
   */
  private async getOrganizationByDomain(domain: string): Promise<any> {
    const org = await prisma.organization.findFirst({
      where: {
        domains: {
          has: domain
        }
      },
      include: { settings: true }
    });

    return org?.settings || null;
  }

  /**
   * Validate IP against whitelist
   */
  private async validateIPWhitelist(ipAddress: string, whitelist: string[]): Promise<boolean> {
    return whitelist.some(allowedIP => {
      if (allowedIP.includes('/')) {
        // CIDR notation - simplified for example
        return false;
      }
      return allowedIP === ipAddress;
    });
  }

  /**
   * Calculate token expiry based on provider
   */
  private calculateTokenExpiry(provider: string): Date {
    const expiryMinutes = {
      google: 60, // Google tokens typically expire in 1 hour
      microsoft: 60, // Microsoft tokens typically expire in 1 hour
      linkedin: 60 // LinkedIn tokens typically expire in 1 hour
    };

    return new Date(Date.now() + (expiryMinutes[provider as keyof typeof expiryMinutes] || 60) * 60 * 1000);
  }

  /**
   * Generate avatar URL
   */
  private generateAvatarURL(email: string): string {
    const hash = createHash('md5').update(email.toLowerCase()).digest('hex');
    return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=150`;
  }

  /**
   * Get OAuth strategy
   */
  public getStrategy(provider: string): any {
    return this.strategies.get(provider);
  }

  /**
   * Refresh OAuth token
   */
  public async refreshToken(userId: string, provider: string): Promise<string | null> {
    const account = await prisma.oauthAccount.findFirst({
      where: {
        userId,
        provider: provider.toUpperCase() as any
      }
    });

    if (!account?.refreshToken) {
      return null;
    }

    try {
      // Implementation would depend on provider's refresh token endpoint
      // This is a simplified example
      const refreshedToken = await this.callProviderRefreshAPI(provider, account.refreshToken);

      if (refreshedToken) {
        await prisma.oauthAccount.update({
          where: { id: account.id },
          data: {
            accessToken: refreshedToken.access_token,
            refreshToken: refreshedToken.refresh_token || account.refreshToken,
            expiresAt: this.calculateTokenExpiry(provider)
          }
        });

        return refreshedToken.access_token;
      }
    } catch (error) {
      console.error(`Error refreshing ${provider} token:`, error);
    }

    return null;
  }

  /**
   * Call provider's refresh token API
   */
  private async callProviderRefreshAPI(provider: string, refreshToken: string): Promise<any> {
    // Implementation would make HTTP requests to each provider's token refresh endpoint
    // This is a placeholder for the actual implementation
    console.log(`Refreshing token for ${provider} with refresh token: ${refreshToken}`);
    return null;
  }

  /**
   * Revoke OAuth token
   */
  public async revokeToken(userId: string, provider: string): Promise<boolean> {
    const account = await prisma.oauthAccount.findFirst({
      where: {
        userId,
        provider: provider.toUpperCase() as any
      }
    });

    if (!account) {
      return false;
    }

    try {
      // Call provider's token revocation endpoint
      await this.callProviderRevokeAPI(provider, account.accessToken);

      // Delete the account record
      await prisma.oauthAccount.delete({
        where: { id: account.id }
      });

      return true;
    } catch (error) {
      console.error(`Error revoking ${provider} token:`, error);
      return false;
    }
  }

  /**
   * Call provider's token revocation API
   */
  private async callProviderRevokeAPI(provider: string, accessToken: string): Promise<void> {
    // Implementation would make HTTP requests to each provider's token revocation endpoint
    console.log(`Revoking token for ${provider}: ${accessToken}`);
  }
}

export const oauthService = new OAuthService();
export default oauthService;