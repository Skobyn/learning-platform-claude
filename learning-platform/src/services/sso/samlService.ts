import { Strategy as SamlStrategy, Profile, SamlConfig } from '@node-saml/passport-saml';
import passport from 'passport';
import { prisma } from '@/lib/db';
import { samlProviders, attributeMapping, SAMLProviderConfig } from '../../../config/saml/saml-config';
import { auditService } from '../auditService';
import { deviceTrustService } from '../deviceTrust';
import { createHash, randomBytes } from 'crypto';

export interface SAMLUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
  groups?: string[];
  employeeId?: string;
  organizationId?: string;
  provider: string;
  nameID: string;
  sessionIndex?: string;
  attributes: Record<string, any>;
}

export interface SAMLAuthResult {
  user: SAMLUser;
  isNewUser: boolean;
  requiresMFA: boolean;
  deviceTrusted: boolean;
  organizationSettings: any;
}

class SAMLService {
  private strategies: Map<string, SamlStrategy> = new Map();
  private providerConfigs: Map<string, SAMLProviderConfig> = new Map();

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize SAML providers and strategies
   */
  private async initializeProviders(): Promise<void> {
    try {
      // Load provider configurations from database
      const dbProviders = await prisma.ssoProvider.findMany({
        where: {
          type: 'SAML',
          isActive: true
        }
      });

      // Merge with default configurations
      for (const [providerName, config] of Object.entries(samlProviders)) {
        const dbProvider = dbProviders.find(p => p.name === providerName);

        if (dbProvider) {
          const mergedConfig: SAMLProviderConfig = {
            ...config,
            ...dbProvider.config as Partial<SAMLProviderConfig>,
            organizationId: dbProvider.organizationId
          };

          this.providerConfigs.set(providerName, mergedConfig);
          this.initializeStrategy(providerName, mergedConfig);
        } else if (config.isActive) {
          this.providerConfigs.set(providerName, config);
          this.initializeStrategy(providerName, config);
        }
      }
    } catch (error) {
      console.error('Error initializing SAML providers:', error);
    }
  }

  /**
   * Initialize passport strategy for a SAML provider
   */
  private initializeStrategy(providerName: string, config: SAMLProviderConfig): void {
    const strategy = new SamlStrategy(
      {
        ...config,
        passReqToCallback: true
      } as SamlConfig,
      async (req: any, profile: Profile, done: any) => {
        try {
          const result = await this.handleSAMLResponse(req, profile, providerName, config);
          return done(null, result);
        } catch (error) {
          console.error(`SAML authentication error for ${providerName}:`, error);
          return done(error);
        }
      }
    );

    passport.use(`saml-${providerName}`, strategy);
    this.strategies.set(providerName, strategy);
  }

  /**
   * Handle SAML authentication response
   */
  private async handleSAMLResponse(
    req: any,
    profile: Profile,
    providerName: string,
    config: SAMLProviderConfig
  ): Promise<SAMLAuthResult> {
    const userAgent = req.get('User-Agent') || '';
    const ipAddress = req.ip || req.connection.remoteAddress || '';

    // Extract user attributes
    const samlUser = this.extractUserAttributes(profile, providerName);

    // Log authentication attempt
    await auditService.logAuthenticationEvent({
      userId: samlUser.email,
      event: 'saml_login_attempt',
      provider: providerName,
      ipAddress,
      userAgent,
      success: true,
      metadata: {
        nameID: samlUser.nameID,
        sessionIndex: samlUser.sessionIndex,
        organizationId: config.organizationId
      }
    });

    // Check organization settings
    const organizationSettings = await this.getOrganizationSettings(
      config.organizationId || samlUser.organizationId
    );

    // Validate IP whitelist if configured
    if (organizationSettings?.ipWhitelist?.length > 0) {
      const isWhitelisted = await this.validateIPWhitelist(ipAddress, organizationSettings.ipWhitelist);
      if (!isWhitelisted) {
        await auditService.logAuthenticationEvent({
          userId: samlUser.email,
          event: 'ip_whitelist_violation',
          provider: providerName,
          ipAddress,
          userAgent,
          success: false
        });
        throw new Error('Access denied: IP address not whitelisted');
      }
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: samlUser.email },
      include: {
        organization: true,
        mfaSettings: true,
        trustedDevices: true
      }
    });

    const isNewUser = !user;

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: samlUser.email,
          firstName: samlUser.firstName,
          lastName: samlUser.lastName,
          displayName: samlUser.displayName,
          department: samlUser.department,
          jobTitle: samlUser.jobTitle,
          employeeId: samlUser.employeeId,
          organizationId: config.organizationId || samlUser.organizationId,
          authProvider: 'SAML',
          authProviderId: samlUser.nameID,
          isActive: true,
          emailVerified: new Date(), // SAML users are pre-verified
          profile: {
            create: {
              bio: `${samlUser.jobTitle ? samlUser.jobTitle + ' at ' : ''}${samlUser.department || 'Organization'}`,
              avatar: this.generateAvatarURL(samlUser.email),
              preferences: {}
            }
          }
        },
        include: {
          organization: true,
          mfaSettings: true,
          trustedDevices: true
        }
      });
    } else {
      // Update existing user attributes
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: samlUser.firstName || user.firstName,
          lastName: samlUser.lastName || user.lastName,
          displayName: samlUser.displayName || user.displayName,
          department: samlUser.department || user.department,
          jobTitle: samlUser.jobTitle || user.jobTitle,
          lastLoginAt: new Date()
        },
        include: {
          organization: true,
          mfaSettings: true,
          trustedDevices: true
        }
      });
    }

    // Check device trust
    const deviceFingerprint = this.generateDeviceFingerprint(req);
    const deviceTrusted = await deviceTrustService.isDeviceTrusted(user.id, deviceFingerprint);

    // Determine MFA requirement
    const requiresMFA = this.requiresMFA(user, organizationSettings, deviceTrusted);

    // Store SAML session information
    await this.storeSAMLSession(user.id, {
      nameID: samlUser.nameID,
      sessionIndex: samlUser.sessionIndex,
      provider: providerName,
      attributes: samlUser.attributes
    });

    // Update user groups/roles if provided
    if (samlUser.groups?.length > 0) {
      await this.updateUserGroups(user.id, samlUser.groups, config.organizationId);
    }

    return {
      user: {
        ...samlUser,
        id: user.id
      },
      isNewUser,
      requiresMFA,
      deviceTrusted,
      organizationSettings
    };
  }

  /**
   * Extract user attributes from SAML profile
   */
  private extractUserAttributes(profile: Profile, providerName: string): SAMLUser {
    const attributes = profile.attributes || {};
    const getAttribute = (mappings: string[]) => {
      for (const mapping of mappings) {
        if (attributes[mapping]) {
          return Array.isArray(attributes[mapping])
            ? attributes[mapping][0]
            : attributes[mapping];
        }
      }
      return undefined;
    };

    return {
      id: '', // Will be set later
      email: profile.nameID || getAttribute(attributeMapping.email),
      firstName: getAttribute(attributeMapping.firstName),
      lastName: getAttribute(attributeMapping.lastName),
      displayName: getAttribute(attributeMapping.displayName),
      department: getAttribute(attributeMapping.department),
      jobTitle: getAttribute(attributeMapping.jobTitle),
      employeeId: getAttribute(attributeMapping.employeeId),
      organizationId: getAttribute(attributeMapping.organizationId),
      groups: this.extractGroups(attributes),
      provider: providerName,
      nameID: profile.nameID!,
      sessionIndex: profile.sessionIndex,
      attributes
    };
  }

  /**
   * Extract groups from SAML attributes
   */
  private extractGroups(attributes: Record<string, any>): string[] {
    const groups: string[] = [];

    for (const mapping of attributeMapping.groups) {
      if (attributes[mapping]) {
        const groupData = Array.isArray(attributes[mapping])
          ? attributes[mapping]
          : [attributes[mapping]];
        groups.push(...groupData);
      }
    }

    return [...new Set(groups)]; // Remove duplicates
  }

  /**
   * Generate device fingerprint for device trust
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
   * Store SAML session information
   */
  private async storeSAMLSession(userId: string, sessionData: any): Promise<void> {
    await prisma.userSession.upsert({
      where: {
        userId_provider: {
          userId,
          provider: 'SAML'
        }
      },
      update: {
        sessionData,
        lastAccessAt: new Date()
      },
      create: {
        userId,
        provider: 'SAML',
        sessionData,
        lastAccessAt: new Date(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours
      }
    });
  }

  /**
   * Update user groups based on SAML attributes
   */
  private async updateUserGroups(
    userId: string,
    groups: string[],
    organizationId?: string
  ): Promise<void> {
    if (!organizationId) return;

    // Map SAML groups to platform roles
    const roleMapping = await this.getGroupRoleMapping(organizationId);
    const roles = groups
      .map(group => roleMapping[group])
      .filter(Boolean);

    if (roles.length > 0) {
      // Update user roles
      await prisma.userRole.deleteMany({
        where: { userId, organizationId }
      });

      await prisma.userRole.createMany({
        data: roles.map(roleId => ({
          userId,
          roleId,
          organizationId
        }))
      });
    }
  }

  /**
   * Get organization settings
   */
  private async getOrganizationSettings(organizationId?: string): Promise<any> {
    if (!organizationId) return null;

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { settings: true }
    });

    return org?.settings || {};
  }

  /**
   * Validate IP against whitelist
   */
  private async validateIPWhitelist(ipAddress: string, whitelist: string[]): Promise<boolean> {
    // Implementation would check IP against CIDR ranges
    // For now, simple string matching
    return whitelist.some(allowedIP => {
      if (allowedIP.includes('/')) {
        // CIDR notation - would need proper CIDR matching
        return false; // Simplified for example
      }
      return allowedIP === ipAddress;
    });
  }

  /**
   * Get group to role mapping
   */
  private async getGroupRoleMapping(organizationId: string): Promise<Record<string, string>> {
    const mappings = await prisma.groupRoleMapping.findMany({
      where: { organizationId },
      include: { role: true }
    });

    return mappings.reduce((map, mapping) => {
      map[mapping.groupName] = mapping.roleId;
      return map;
    }, {} as Record<string, string>);
  }

  /**
   * Generate avatar URL
   */
  private generateAvatarURL(email: string): string {
    const hash = createHash('md5').update(email.toLowerCase()).digest('hex');
    return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=150`;
  }

  /**
   * Get SAML strategy for provider
   */
  public getStrategy(provider: string): SamlStrategy | undefined {
    return this.strategies.get(provider);
  }

  /**
   * Get provider configuration
   */
  public getProviderConfig(provider: string): SAMLProviderConfig | undefined {
    return this.providerConfigs.get(provider);
  }

  /**
   * Generate SAML metadata for service provider
   */
  public generateMetadata(provider: string): string | null {
    const strategy = this.strategies.get(provider);
    if (!strategy) return null;

    return strategy.generateServiceProviderMetadata(
      process.env.SAML_SP_CERT || '',
      process.env.SAML_SP_CERT || ''
    );
  }

  /**
   * Initiate SAML logout
   */
  public async initiateSAMLLogout(
    userId: string,
    provider: string
  ): Promise<string | null> {
    const session = await prisma.userSession.findFirst({
      where: {
        userId,
        provider: 'SAML'
      }
    });

    if (!session?.sessionData?.nameID || !session?.sessionData?.sessionIndex) {
      return null;
    }

    const strategy = this.strategies.get(provider);
    if (!strategy) return null;

    return strategy.generateLogoutRequest({
      nameID: session.sessionData.nameID,
      sessionIndex: session.sessionData.sessionIndex
    });
  }

  /**
   * Reload provider configurations
   */
  public async reloadProviders(): Promise<void> {
    this.strategies.clear();
    this.providerConfigs.clear();
    await this.initializeProviders();
  }
}

export const samlService = new SAMLService();
export default samlService;