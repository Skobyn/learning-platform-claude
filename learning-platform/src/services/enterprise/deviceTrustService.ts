import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { TrustLevel } from '@prisma/client';
import {
  DeviceInfo,
  TrustedDevice,
  DeviceRegistration,
  DeviceTrustError,
  RiskAssessment,
  RiskFactor,
  RiskLevel
} from '@/types/enterprise';
import UAParser from 'ua-parser-js';
import crypto from 'crypto';
import geoip from 'geoip-lite';

class DeviceTrustService {
  private readonly DEVICE_FINGERPRINT_ALGORITHM = 'sha256';
  private readonly TRUST_SCORE_THRESHOLD = 75;
  private readonly HIGH_TRUST_THRESHOLD = 90;
  private readonly DEVICE_EXPIRY_DAYS = 90;

  /**
   * Generate device fingerprint from request data
   */
  generateDeviceFingerprint(data: {
    userAgent: string;
    acceptLanguage?: string;
    acceptEncoding?: string;
    screen?: { width: number; height: number };
    timezone?: string;
    plugins?: string[];
    fonts?: string[];
    canvas?: string;
  }): string {
    const components = [
      data.userAgent,
      data.acceptLanguage || '',
      data.acceptEncoding || '',
      data.screen ? `${data.screen.width}x${data.screen.height}` : '',
      data.timezone || '',
      (data.plugins || []).sort().join(','),
      (data.fonts || []).sort().join(','),
      data.canvas || ''
    ];

    const fingerprint = components.join('|');

    return crypto
      .createHash(this.DEVICE_FINGERPRINT_ALGORITHM)
      .update(fingerprint)
      .digest('hex');
  }

  /**
   * Parse device information from user agent and other data
   */
  parseDeviceInfo(userAgent: string, additionalData?: {
    ipAddress?: string;
    acceptLanguage?: string;
    screen?: { width: number; height: number };
    timezone?: string;
  }): DeviceInfo {
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    // Determine device type
    let deviceType: DeviceInfo['deviceType'] = 'UNKNOWN';
    if (result.device.type === 'mobile') {
      deviceType = 'MOBILE';
    } else if (result.device.type === 'tablet') {
      deviceType = 'TABLET';
    } else if (result.browser.name && result.os.name) {
      deviceType = 'DESKTOP';
    }

    return {
      userAgent,
      platform: result.os.name || 'Unknown',
      browser: result.browser.name || 'Unknown',
      os: result.os.name || 'Unknown',
      osVersion: result.os.version || 'Unknown',
      deviceType,
      screenResolution: additionalData?.screen
        ? `${additionalData.screen.width}x${additionalData.screen.height}`
        : undefined,
      timezone: additionalData?.timezone,
      language: additionalData?.acceptLanguage?.split(',')[0]
    };
  }

  /**
   * Register a new device for user
   */
  async registerDevice(
    userId: string,
    registration: DeviceRegistration,
    ipAddress?: string
  ): Promise<TrustedDevice> {
    // Check if device already exists
    const existingDevice = await prisma.trustedDevice.findUnique({
      where: {
        userId_fingerprint: {
          userId,
          fingerprint: registration.fingerprint
        }
      }
    });

    if (existingDevice) {
      // Update existing device
      return await this.updateDevice(existingDevice.id, {
        name: registration.name,
        deviceInfo: registration.deviceInfo,
        lastUsedAt: new Date()
      });
    }

    // Perform risk assessment
    const riskAssessment = await this.assessDeviceRisk(userId, registration, ipAddress);

    // Determine initial trust level based on risk
    let trustLevel = TrustLevel.LOW;
    if (riskAssessment.score >= this.HIGH_TRUST_THRESHOLD) {
      trustLevel = TrustLevel.HIGH;
    } else if (riskAssessment.score >= this.TRUST_SCORE_THRESHOLD) {
      trustLevel = TrustLevel.MEDIUM;
    }

    // Get location info if IP provided
    let locationInfo = {};
    if (ipAddress) {
      const geo = geoip.lookup(ipAddress);
      if (geo) {
        locationInfo = {
          lastSeenIp: ipAddress,
          lastSeenCountry: geo.country,
          lastSeenCity: geo.city
        };
      }
    }

    // Create device record
    const device = await prisma.trustedDevice.create({
      data: {
        userId,
        fingerprint: registration.fingerprint,
        name: registration.name,
        deviceInfo: registration.deviceInfo,
        isTrusted: riskAssessment.level !== 'HIGH' && riskAssessment.level !== 'CRITICAL',
        trustLevel,
        expiresAt: new Date(Date.now() + this.DEVICE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        ...locationInfo
      }
    });

    // Log device registration
    await this.logDeviceEvent(userId, 'DEVICE_REGISTERED', {
      deviceId: device.id,
      fingerprint: registration.fingerprint,
      riskScore: riskAssessment.score,
      trustLevel
    });

    return device;
  }

  /**
   * Get trusted device by fingerprint
   */
  async getTrustedDevice(userId: string, fingerprint: string): Promise<TrustedDevice | null> {
    return await prisma.trustedDevice.findFirst({
      where: {
        userId,
        fingerprint,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });
  }

  /**
   * Get all trusted devices for user
   */
  async getUserTrustedDevices(userId: string): Promise<TrustedDevice[]> {
    return await prisma.trustedDevice.findMany({
      where: {
        userId,
        isActive: true
      },
      orderBy: { lastUsedAt: 'desc' }
    });
  }

  /**
   * Update device information
   */
  async updateDevice(
    deviceId: string,
    updates: {
      name?: string;
      deviceInfo?: DeviceInfo;
      isTrusted?: boolean;
      trustLevel?: TrustLevel;
      lastUsedAt?: Date;
      expiresAt?: Date;
    }
  ): Promise<TrustedDevice> {
    return await prisma.trustedDevice.update({
      where: { id: deviceId },
      data: updates
    });
  }

  /**
   * Trust a device (promote trust level)
   */
  async trustDevice(
    userId: string,
    deviceId: string,
    trustLevel: TrustLevel = TrustLevel.HIGH,
    extendExpiry: boolean = true
  ): Promise<TrustedDevice> {
    const updates: any = {
      isTrusted: true,
      trustLevel,
      trustedAt: new Date()
    };

    if (extendExpiry) {
      updates.expiresAt = new Date(Date.now() + this.DEVICE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    }

    const device = await prisma.trustedDevice.update({
      where: {
        id: deviceId,
        userId // Ensure user owns the device
      },
      data: updates
    });

    // Log device trusted
    await this.logDeviceEvent(userId, 'DEVICE_TRUSTED', {
      deviceId,
      trustLevel
    });

    return device;
  }

  /**
   * Revoke device trust
   */
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.trustedDevice.update({
      where: {
        id: deviceId,
        userId // Ensure user owns the device
      },
      data: {
        isTrusted: false,
        isActive: false,
        revokedAt: new Date()
      }
    });

    // Log device revoked
    await this.logDeviceEvent(userId, 'DEVICE_REVOKED', {
      deviceId
    });
  }

  /**
   * Assess device risk based on various factors
   */
  async assessDeviceRisk(
    userId: string,
    registration: DeviceRegistration,
    ipAddress?: string
  ): Promise<RiskAssessment> {
    const factors: RiskFactor[] = [];
    let totalScore = 100; // Start with maximum trust

    // Check if device fingerprint has been seen before (by other users)
    const fingerprintUsage = await prisma.trustedDevice.count({
      where: {
        fingerprint: registration.fingerprint,
        userId: { not: userId }
      }
    });

    if (fingerprintUsage > 0) {
      factors.push({
        type: 'shared_fingerprint',
        description: 'Device fingerprint used by other users',
        weight: -30,
        severity: 'HIGH' as RiskLevel
      });
      totalScore -= 30;
    }

    // Check user agent patterns
    const deviceInfo = registration.deviceInfo;
    if (deviceInfo.userAgent.includes('bot') || deviceInfo.userAgent.includes('crawler')) {
      factors.push({
        type: 'suspicious_user_agent',
        description: 'User agent suggests automated client',
        weight: -50,
        severity: 'CRITICAL' as RiskLevel
      });
      totalScore -= 50;
    }

    // Check for common/known platforms
    const knownPlatforms = ['Windows', 'macOS', 'Linux', 'iOS', 'Android'];
    if (!knownPlatforms.some(platform => deviceInfo.platform?.includes(platform))) {
      factors.push({
        type: 'unknown_platform',
        description: 'Unusual or unknown platform',
        weight: -20,
        severity: 'MEDIUM' as RiskLevel
      });
      totalScore -= 20;
    }

    // Geographic location assessment
    if (ipAddress) {
      const geo = geoip.lookup(ipAddress);
      if (geo) {
        // Check if location is common for this user
        const commonLocation = await this.isCommonLocationForUser(userId, geo.country);
        if (!commonLocation) {
          factors.push({
            type: 'unusual_location',
            description: `Login from unusual location: ${geo.city}, ${geo.country}`,
            weight: -25,
            severity: 'MEDIUM' as RiskLevel
          });
          totalScore -= 25;
        }

        // Check for high-risk countries (if configured)
        const highRiskCountries = await this.getHighRiskCountries();
        if (highRiskCountries.includes(geo.country)) {
          factors.push({
            type: 'high_risk_country',
            description: `Login from high-risk country: ${geo.country}`,
            weight: -40,
            severity: 'HIGH' as RiskLevel
          });
          totalScore -= 40;
        }
      }
    }

    // Time-based assessment
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      factors.push({
        type: 'unusual_time',
        description: 'Login during unusual hours',
        weight: -10,
        severity: 'LOW' as RiskLevel
      });
      totalScore -= 10;
    }

    // Ensure score is within bounds
    totalScore = Math.max(0, Math.min(100, totalScore));

    // Determine risk level
    let riskLevel: RiskLevel = 'LOW';
    if (totalScore < 50) {
      riskLevel = 'CRITICAL';
    } else if (totalScore < 70) {
      riskLevel = 'HIGH';
    } else if (totalScore < 85) {
      riskLevel = 'MEDIUM';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (factors.some(f => f.severity === 'CRITICAL')) {
      recommendations.push('Block device registration until manual review');
    }
    if (factors.some(f => f.severity === 'HIGH')) {
      recommendations.push('Require additional verification steps');
    }
    if (factors.some(f => f.type === 'unusual_location')) {
      recommendations.push('Send location verification email');
    }
    if (factors.some(f => f.type === 'unusual_time')) {
      recommendations.push('Require MFA verification');
    }

    return {
      score: totalScore,
      level: riskLevel,
      factors,
      recommendations
    };
  }

  /**
   * Check if device is trusted for user
   */
  async isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
    const device = await this.getTrustedDevice(userId, fingerprint);
    return device?.isTrusted && device?.trustLevel !== TrustLevel.LOW;
  }

  /**
   * Update device activity
   */
  async updateDeviceActivity(
    userId: string,
    fingerprint: string,
    ipAddress?: string
  ): Promise<void> {
    const updateData: any = {
      lastUsedAt: new Date()
    };

    // Update location if IP provided
    if (ipAddress) {
      const geo = geoip.lookup(ipAddress);
      if (geo) {
        updateData.lastSeenIp = ipAddress;
        updateData.lastSeenCountry = geo.country;
        updateData.lastSeenCity = geo.city;
      }
    }

    await prisma.trustedDevice.updateMany({
      where: {
        userId,
        fingerprint,
        isActive: true
      },
      data: updateData
    });
  }

  /**
   * Clean up expired devices
   */
  async cleanupExpiredDevices(): Promise<number> {
    const result = await prisma.trustedDevice.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        isActive: true
      },
      data: {
        isActive: false,
        revokedAt: new Date()
      }
    });

    return result.count;
  }

  /**
   * Get device trust statistics for organization
   */
  async getDeviceTrustStatistics(organizationId: string): Promise<{
    totalDevices: number;
    trustedDevices: number;
    highTrustDevices: number;
    revokedDevices: number;
    expiredDevices: number;
  }> {
    const userIds = await prisma.user.findMany({
      where: { organizationId },
      select: { id: true }
    }).then(users => users.map(u => u.id));

    const [
      totalDevices,
      trustedDevices,
      highTrustDevices,
      revokedDevices,
      expiredDevices
    ] = await Promise.all([
      prisma.trustedDevice.count({
        where: { userId: { in: userIds } }
      }),
      prisma.trustedDevice.count({
        where: {
          userId: { in: userIds },
          isTrusted: true,
          isActive: true
        }
      }),
      prisma.trustedDevice.count({
        where: {
          userId: { in: userIds },
          trustLevel: { in: [TrustLevel.HIGH, TrustLevel.VERIFIED] },
          isActive: true
        }
      }),
      prisma.trustedDevice.count({
        where: {
          userId: { in: userIds },
          isActive: false,
          revokedAt: { not: null }
        }
      }),
      prisma.trustedDevice.count({
        where: {
          userId: { in: userIds },
          expiresAt: { lt: new Date() }
        }
      })
    ]);

    return {
      totalDevices,
      trustedDevices,
      highTrustDevices,
      revokedDevices,
      expiredDevices
    };
  }

  /**
   * Check if location is common for user
   */
  private async isCommonLocationForUser(userId: string, country: string): Promise<boolean> {
    const recentLogins = await prisma.trustedDevice.count({
      where: {
        userId,
        lastSeenCountry: country,
        lastUsedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      }
    });

    return recentLogins > 0;
  }

  /**
   * Get high-risk countries list (from configuration)
   */
  private async getHighRiskCountries(): Promise<string[]> {
    // This could be stored in database or configuration
    return process.env.HIGH_RISK_COUNTRIES?.split(',') || [];
  }

  /**
   * Log device-related events
   */
  private async logDeviceEvent(
    userId: string,
    event: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          event,
          provider: 'DEVICE_TRUST',
          success: true,
          metadata,
          timestamp: new Date(),
          riskLevel: event.includes('REVOKED') ? 'MEDIUM' : 'LOW'
        }
      });
    } catch (error) {
      console.error('Failed to log device event:', error);
    }
  }

  /**
   * Get device fingerprint from request headers and client data
   */
  generateClientFingerprint(headers: Record<string, string>, clientData?: {
    screen?: { width: number; height: number };
    timezone?: string;
    language?: string;
    plugins?: string[];
    fonts?: string[];
    canvas?: string;
  }): string {
    return this.generateDeviceFingerprint({
      userAgent: headers['user-agent'] || '',
      acceptLanguage: headers['accept-language'] || clientData?.language,
      acceptEncoding: headers['accept-encoding'],
      screen: clientData?.screen,
      timezone: clientData?.timezone,
      plugins: clientData?.plugins,
      fonts: clientData?.fonts,
      canvas: clientData?.canvas
    });
  }
}

export const deviceTrustService = new DeviceTrustService();
export default deviceTrustService;