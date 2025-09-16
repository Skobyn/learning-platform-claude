import { prisma } from '@/lib/db';
import { auditService } from './auditService';
import UAParser from 'ua-parser-js';
import geoip from 'geoip-lite';
import { createHash, randomBytes } from 'crypto';
import DeviceDetector from 'node-device-detector';

export interface DeviceInfo {
  fingerprint: string;
  userAgent: string;
  browser?: {
    name?: string;
    version?: string;
  };
  os?: {
    name?: string;
    version?: string;
  };
  device?: {
    type?: string;
    brand?: string;
    model?: string;
  };
  location?: {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
    lat?: number;
    ll?: number[];
  };
  ipAddress: string;
  language?: string;
  screenResolution?: string;
  timezone?: string;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  fingerprint: string;
  name: string;
  deviceInfo: DeviceInfo;
  isTrusted: boolean;
  trustLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  lastUsedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

export interface DeviceTrustResult {
  isTrusted: boolean;
  trustLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  deviceId?: string;
  isNewDevice: boolean;
  riskFactors: string[];
  requiresApproval: boolean;
}

export interface DeviceRiskAssessment {
  score: number; // 0-100, higher is riskier
  factors: {
    newDevice: boolean;
    newLocation: boolean;
    newBrowser: boolean;
    vpnDetected: boolean;
    torDetected: boolean;
    highRiskCountry: boolean;
    suspiciousUserAgent: boolean;
    frequentLocationChanges: boolean;
  };
  recommendation: 'ALLOW' | 'CHALLENGE' | 'BLOCK';
}

class DeviceTrustService {
  private deviceDetector: DeviceDetector;
  private riskCountries: Set<string>;
  private suspiciousUserAgents: RegExp[];

  constructor() {
    this.deviceDetector = new DeviceDetector();

    // High-risk countries for fraud detection
    this.riskCountries = new Set([
      'CN', 'RU', 'NK', 'IR', 'IQ', 'AF', 'PK', 'BD', 'MM', 'LA'
    ]);

    // Suspicious user agent patterns
    this.suspiciousUserAgents = [
      /curl/i,
      /wget/i,
      /python/i,
      /bot/i,
      /crawler/i,
      /scraper/i,
      /headless/i,
      /phantom/i,
      /selenium/i
    ];
  }

  /**
   * Generate device fingerprint from request
   */
  generateDeviceFingerprint(req: any): string {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language') || '';
    const acceptEncoding = req.get('Accept-Encoding') || '';
    const connection = req.get('Connection') || '';
    const dnt = req.get('DNT') || '';
    const ipAddress = this.getClientIP(req);

    // Additional client hints if available
    const clientHints = {
      platform: req.get('Sec-CH-UA-Platform') || '',
      mobile: req.get('Sec-CH-UA-Mobile') || '',
      arch: req.get('Sec-CH-UA-Arch') || '',
      model: req.get('Sec-CH-UA-Model') || ''
    };

    const fingerprintData = [
      userAgent,
      acceptLanguage,
      acceptEncoding,
      connection,
      dnt,
      ipAddress,
      ...Object.values(clientHints)
    ].join('|');

    return createHash('sha256').update(fingerprintData).digest('hex');
  }

  /**
   * Extract device information from request
   */
  extractDeviceInfo(req: any): DeviceInfo {
    const userAgent = req.get('User-Agent') || '';
    const ipAddress = this.getClientIP(req);
    const fingerprint = this.generateDeviceFingerprint(req);

    // Parse user agent
    const uaParser = new UAParser(userAgent);
    const uaResult = uaParser.getResult();

    // Advanced device detection
    const deviceResult = this.deviceDetector.detect(userAgent);

    // Get geolocation
    const geoData = geoip.lookup(ipAddress);

    return {
      fingerprint,
      userAgent,
      browser: {
        name: uaResult.browser.name,
        version: uaResult.browser.version
      },
      os: {
        name: uaResult.os.name,
        version: uaResult.os.version
      },
      device: {
        type: deviceResult.device?.type,
        brand: deviceResult.device?.brand,
        model: deviceResult.device?.model
      },
      location: geoData ? {
        country: geoData.country,
        region: geoData.region,
        city: geoData.city,
        timezone: geoData.timezone,
        lat: geoData.ll?.[0],
        ll: geoData.ll
      } : undefined,
      ipAddress,
      language: req.get('Accept-Language')?.split(',')[0],
      timezone: req.get('X-Timezone') || req.body?.timezone
    };
  }

  /**
   * Check if device is trusted
   */
  async isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
    const device = await prisma.trustedDevice.findFirst({
      where: {
        userId,
        fingerprint,
        isTrusted: true,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });

    return !!device;
  }

  /**
   * Perform comprehensive device trust assessment
   */
  async assessDeviceTrust(userId: string, req: any): Promise<DeviceTrustResult> {
    const deviceInfo = this.extractDeviceInfo(req);
    const fingerprint = deviceInfo.fingerprint;

    // Check if device exists
    const existingDevice = await prisma.trustedDevice.findFirst({
      where: {
        userId,
        fingerprint,
        isActive: true
      }
    });

    const isNewDevice = !existingDevice;
    const isTrusted = existingDevice?.isTrusted || false;

    // Perform risk assessment
    const riskAssessment = await this.performRiskAssessment(userId, deviceInfo, isNewDevice);

    // Determine trust level
    const trustLevel = this.calculateTrustLevel(riskAssessment, existingDevice);

    // Check if approval is required
    const organizationSettings = await this.getOrganizationSettings(userId);
    const requiresApproval = this.shouldRequireApproval(
      riskAssessment,
      organizationSettings,
      isNewDevice
    );

    // Log device access attempt
    await auditService.logAuthenticationEvent({
      userId,
      event: 'device_access_attempt',
      provider: 'DEVICE_TRUST',
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      success: true,
      metadata: {
        fingerprint,
        isNewDevice,
        trustLevel,
        riskScore: riskAssessment.score,
        requiresApproval
      }
    });

    return {
      isTrusted,
      trustLevel,
      deviceId: existingDevice?.id,
      isNewDevice,
      riskFactors: this.extractRiskFactors(riskAssessment),
      requiresApproval
    };
  }

  /**
   * Register a new device
   */
  async registerDevice(
    userId: string,
    req: any,
    deviceName?: string,
    autoTrust: boolean = false
  ): Promise<TrustedDevice> {
    const deviceInfo = this.extractDeviceInfo(req);
    const fingerprint = deviceInfo.fingerprint;

    // Generate device name if not provided
    const name = deviceName || this.generateDeviceName(deviceInfo);

    // Perform risk assessment
    const riskAssessment = await this.performRiskAssessment(userId, deviceInfo, true);
    const trustLevel = this.calculateTrustLevel(riskAssessment, null);

    // Create device record
    const device = await prisma.trustedDevice.create({
      data: {
        userId,
        fingerprint,
        name,
        deviceInfo: deviceInfo as any,
        isTrusted: autoTrust,
        trustLevel,
        lastUsedAt: new Date(),
        isActive: true,
        // Set expiry based on organization policy
        expiresAt: this.calculateDeviceExpiry()
      }
    });

    // Log device registration
    await auditService.logAuthenticationEvent({
      userId,
      event: 'device_registered',
      provider: 'DEVICE_TRUST',
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      success: true,
      metadata: {
        deviceId: device.id,
        fingerprint,
        deviceName: name,
        autoTrust,
        riskScore: riskAssessment.score
      }
    });

    return device as TrustedDevice;
  }

  /**
   * Trust a device
   */
  async trustDevice(
    userId: string,
    deviceId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    const device = await prisma.trustedDevice.findFirst({
      where: {
        id: deviceId,
        userId,
        isActive: true
      }
    });

    if (!device) {
      return false;
    }

    await prisma.trustedDevice.update({
      where: { id: deviceId },
      data: {
        isTrusted: true,
        trustLevel: 'HIGH',
        lastUsedAt: new Date()
      }
    });

    // Log device trust
    await auditService.logAuthenticationEvent({
      userId,
      event: 'device_trusted',
      provider: 'DEVICE_TRUST',
      ipAddress,
      userAgent,
      success: true,
      metadata: {
        deviceId,
        deviceName: device.name
      }
    });

    return true;
  }

  /**
   * Revoke device trust
   */
  async revokeDeviceTrust(
    userId: string,
    deviceId: string,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    const device = await prisma.trustedDevice.findFirst({
      where: {
        id: deviceId,
        userId,
        isActive: true
      }
    });

    if (!device) {
      return false;
    }

    await prisma.trustedDevice.update({
      where: { id: deviceId },
      data: {
        isTrusted: false,
        trustLevel: 'LOW',
        isActive: false
      }
    });

    // Log device trust revocation
    await auditService.logAuthenticationEvent({
      userId,
      event: 'device_trust_revoked',
      provider: 'DEVICE_TRUST',
      ipAddress,
      userAgent,
      success: true,
      metadata: {
        deviceId,
        deviceName: device.name,
        reason
      }
    });

    return true;
  }

  /**
   * Get user's trusted devices
   */
  async getUserTrustedDevices(userId: string): Promise<TrustedDevice[]> {
    const devices = await prisma.trustedDevice.findMany({
      where: {
        userId,
        isActive: true
      },
      orderBy: {
        lastUsedAt: 'desc'
      }
    });

    return devices as TrustedDevice[];
  }

  /**
   * Update device last used timestamp
   */
  async updateDeviceLastUsed(userId: string, fingerprint: string): Promise<void> {
    await prisma.trustedDevice.updateMany({
      where: {
        userId,
        fingerprint,
        isActive: true
      },
      data: {
        lastUsedAt: new Date()
      }
    });
  }

  /**
   * Perform risk assessment
   */
  private async performRiskAssessment(
    userId: string,
    deviceInfo: DeviceInfo,
    isNewDevice: boolean
  ): Promise<DeviceRiskAssessment> {
    let score = 0;
    const factors = {
      newDevice: isNewDevice,
      newLocation: false,
      newBrowser: false,
      vpnDetected: false,
      torDetected: false,
      highRiskCountry: false,
      suspiciousUserAgent: false,
      frequentLocationChanges: false
    };

    // New device risk
    if (isNewDevice) {
      score += 30;
      factors.newDevice = true;
    }

    // Location analysis
    if (deviceInfo.location?.country) {
      // Check against previous locations
      const recentDevices = await prisma.trustedDevice.findMany({
        where: {
          userId,
          isActive: true,
          lastUsedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        }
      });

      const previousCountries = new Set(
        recentDevices
          .map(d => (d.deviceInfo as any)?.location?.country)
          .filter(Boolean)
      );

      if (!previousCountries.has(deviceInfo.location.country)) {
        score += 20;
        factors.newLocation = true;
      }

      // High-risk country check
      if (this.riskCountries.has(deviceInfo.location.country)) {
        score += 25;
        factors.highRiskCountry = true;
      }

      // Frequent location changes
      if (previousCountries.size > 3) {
        score += 15;
        factors.frequentLocationChanges = true;
      }
    }

    // Browser analysis
    const userBrowsers = new Set(
      (await prisma.trustedDevice.findMany({
        where: { userId, isActive: true }
      })).map(d => (d.deviceInfo as any)?.browser?.name).filter(Boolean)
    );

    if (deviceInfo.browser?.name && !userBrowsers.has(deviceInfo.browser.name)) {
      score += 10;
      factors.newBrowser = true;
    }

    // Suspicious user agent
    if (this.suspiciousUserAgents.some(pattern => pattern.test(deviceInfo.userAgent))) {
      score += 40;
      factors.suspiciousUserAgent = true;
    }

    // VPN/Proxy detection (simplified)
    if (this.isVPNDetected(deviceInfo.ipAddress)) {
      score += 20;
      factors.vpnDetected = true;
    }

    // Tor detection
    if (this.isTorDetected(deviceInfo.ipAddress)) {
      score += 50;
      factors.torDetected = true;
    }

    // Determine recommendation
    let recommendation: 'ALLOW' | 'CHALLENGE' | 'BLOCK' = 'ALLOW';
    if (score >= 70) {
      recommendation = 'BLOCK';
    } else if (score >= 40) {
      recommendation = 'CHALLENGE';
    }

    return {
      score,
      factors,
      recommendation
    };
  }

  /**
   * Calculate trust level based on risk assessment
   */
  private calculateTrustLevel(
    riskAssessment: DeviceRiskAssessment,
    existingDevice: any
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (existingDevice?.isTrusted && riskAssessment.score < 30) {
      return 'HIGH';
    }

    if (riskAssessment.score < 40) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Extract risk factors as string array
   */
  private extractRiskFactors(riskAssessment: DeviceRiskAssessment): string[] {
    const factors = [];

    if (riskAssessment.factors.newDevice) factors.push('New device');
    if (riskAssessment.factors.newLocation) factors.push('New location');
    if (riskAssessment.factors.newBrowser) factors.push('New browser');
    if (riskAssessment.factors.vpnDetected) factors.push('VPN detected');
    if (riskAssessment.factors.torDetected) factors.push('Tor detected');
    if (riskAssessment.factors.highRiskCountry) factors.push('High-risk country');
    if (riskAssessment.factors.suspiciousUserAgent) factors.push('Suspicious user agent');
    if (riskAssessment.factors.frequentLocationChanges) factors.push('Frequent location changes');

    return factors;
  }

  /**
   * Check if approval is required
   */
  private shouldRequireApproval(
    riskAssessment: DeviceRiskAssessment,
    organizationSettings: any,
    isNewDevice: boolean
  ): boolean {
    // Organization requires approval for all new devices
    if (organizationSettings?.requireApprovalForNewDevices && isNewDevice) {
      return true;
    }

    // High risk score requires approval
    if (riskAssessment.score >= 50) {
      return true;
    }

    // High-risk factors require approval
    if (riskAssessment.factors.torDetected || riskAssessment.factors.suspiciousUserAgent) {
      return true;
    }

    return false;
  }

  /**
   * Generate device name
   */
  private generateDeviceName(deviceInfo: DeviceInfo): string {
    const browser = deviceInfo.browser?.name || 'Unknown Browser';
    const os = deviceInfo.os?.name || 'Unknown OS';
    const device = deviceInfo.device?.type || 'device';
    const location = deviceInfo.location?.city || deviceInfo.location?.country || 'Unknown Location';

    return `${browser} on ${os} (${device}) from ${location}`;
  }

  /**
   * Calculate device expiry
   */
  private calculateDeviceExpiry(): Date | null {
    const trustPeriodDays = parseInt(process.env.DEVICE_TRUST_PERIOD_DAYS || '30');

    if (trustPeriodDays === 0) {
      return null; // Never expires
    }

    return new Date(Date.now() + trustPeriodDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Get organization settings
   */
  private async getOrganizationSettings(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          include: { settings: true }
        }
      }
    });

    return user?.organization?.settings || {};
  }

  /**
   * Get client IP address
   */
  private getClientIP(req: any): string {
    return req.ip ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : '') ||
           '';
  }

  /**
   * Simple VPN detection (placeholder)
   */
  private isVPNDetected(ipAddress: string): boolean {
    // In production, this would use a VPN detection service
    // For now, just check some common VPN IP ranges
    const vpnRanges = [
      '192.168.',
      '10.',
      '172.16.',
      '127.'
    ];

    return vpnRanges.some(range => ipAddress.startsWith(range));
  }

  /**
   * Simple Tor detection (placeholder)
   */
  private isTorDetected(ipAddress: string): boolean {
    // In production, this would check against Tor exit node lists
    // This is a placeholder implementation
    return false;
  }

  /**
   * Clean up expired devices
   */
  async cleanupExpiredDevices(): Promise<number> {
    const result = await prisma.trustedDevice.updateMany({
      where: {
        expiresAt: {
          lt: new Date()
        },
        isActive: true
      },
      data: {
        isActive: false,
        isTrusted: false
      }
    });

    return result.count;
  }
}

export const deviceTrustService = new DeviceTrustService();
export default deviceTrustService;