import { prisma } from '@/lib/db';
import { deviceTrustService } from './deviceTrust';
import { auditService } from './auditService';
import { createHash, randomBytes } from 'crypto';
import { encrypt, decrypt } from '@/lib/encryption';
import { NextRequest } from 'next/server';

export interface SessionData {
  userId: string;
  sessionId: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
  expiresAt: Date;
  lastActivityAt: Date;
  metadata: {
    browser?: string;
    os?: string;
    device?: string;
    location?: any;
    authProvider?: string;
    mfaVerified?: boolean;
    deviceTrusted?: boolean;
    riskLevel?: string;
  };
}

export interface SessionValidationResult {
  valid: boolean;
  session?: SessionData;
  reason?: string;
  requiresReauth?: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SessionSecurityConfig {
  maxConcurrentSessions: number;
  sessionTimeout: number; // minutes
  idleTimeout: number; // minutes
  rotateTokenInterval: number; // minutes
  requireDeviceFingerprint: boolean;
  trackLocationChanges: boolean;
  enforceIPBinding: boolean;
  allowSessionTransfer: boolean;
}

class SessionManagementService {
  private activeSessions: Map<string, SessionData> = new Map();
  private sessionSecrets: Map<string, string> = new Map();

  constructor() {
    // Cleanup expired sessions periodically
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Create a new session
   */
  async createSession(
    userId: string,
    req: NextRequest,
    authProvider?: string,
    mfaVerified: boolean = false
  ): Promise<SessionData> {
    const deviceInfo = deviceTrustService.extractDeviceInfo(req);
    const sessionId = this.generateSessionId();
    const deviceFingerprint = deviceInfo.fingerprint;

    // Get user and organization settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          include: { settings: true }
        }
      }
    });

    const config = this.getSessionConfig(user?.organization?.settings);

    // Check concurrent session limits
    await this.enforceConcurrentSessionLimits(userId, config.maxConcurrentSessions);

    // Check if device is trusted
    const deviceTrusted = await deviceTrustService.isDeviceTrusted(userId, deviceFingerprint);

    // Calculate session expiry
    const expiresAt = new Date(Date.now() + config.sessionTimeout * 60 * 1000);

    // Create session data
    const sessionData: SessionData = {
      userId,
      sessionId,
      deviceFingerprint,
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      isActive: true,
      expiresAt,
      lastActivityAt: new Date(),
      metadata: {
        browser: deviceInfo.browser?.name,
        os: deviceInfo.os?.name,
        device: deviceInfo.device?.type,
        location: deviceInfo.location,
        authProvider,
        mfaVerified,
        deviceTrusted,
        riskLevel: this.calculateSessionRiskLevel(deviceInfo, deviceTrusted, mfaVerified)
      }
    };

    // Store session in database
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        deviceFingerprint,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        provider: authProvider || 'LOCAL',
        sessionData: sessionData as any,
        isActive: true,
        expiresAt,
        lastAccessAt: new Date()
      }
    });

    // Store session in memory for fast access
    this.activeSessions.set(sessionId, sessionData);

    // Generate and store session secret
    const sessionSecret = this.generateSessionSecret();
    this.sessionSecrets.set(sessionId, sessionSecret);

    // Update device last used
    await deviceTrustService.updateDeviceLastUsed(userId, deviceFingerprint);

    // Log session creation
    await auditService.logAuthenticationEvent({
      userId: user?.email || userId,
      event: 'session_created',
      provider: 'SESSION_MANAGER',
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      success: true,
      metadata: {
        sessionId,
        deviceFingerprint,
        deviceTrusted,
        mfaVerified,
        authProvider,
        riskLevel: sessionData.metadata.riskLevel
      }
    });

    return sessionData;
  }

  /**
   * Validate an existing session
   */
  async validateSession(
    sessionId: string,
    req: NextRequest
  ): Promise<SessionValidationResult> {
    try {
      // Check memory cache first
      let session = this.activeSessions.get(sessionId);

      // If not in cache, load from database
      if (!session) {
        const dbSession = await prisma.userSession.findUnique({
          where: {
            id: sessionId,
            isActive: true
          }
        });

        if (!dbSession) {
          return {
            valid: false,
            reason: 'Session not found',
            riskLevel: 'HIGH'
          };
        }

        session = dbSession.sessionData as SessionData;
        this.activeSessions.set(sessionId, session);
      }

      // Check if session is expired
      if (session.expiresAt <= new Date()) {
        await this.invalidateSession(sessionId, 'SESSION_EXPIRED');
        return {
          valid: false,
          reason: 'Session expired',
          riskLevel: 'MEDIUM'
        };
      }

      // Extract current request info
      const currentDeviceInfo = deviceTrustService.extractDeviceInfo(req);
      const currentIP = currentDeviceInfo.ipAddress;
      const currentUA = currentDeviceInfo.userAgent;

      // Get user settings
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        include: {
          organization: {
            include: { settings: true }
          }
        }
      });

      const config = this.getSessionConfig(user?.organization?.settings);

      // Validate device fingerprint if required
      if (config.requireDeviceFingerprint) {
        if (currentDeviceInfo.fingerprint !== session.deviceFingerprint) {
          await this.invalidateSession(sessionId, 'DEVICE_MISMATCH');
          await auditService.logAuthenticationEvent({
            userId: user?.email || session.userId,
            event: 'session_device_mismatch',
            provider: 'SESSION_MANAGER',
            ipAddress: currentIP,
            userAgent: currentUA,
            success: false,
            metadata: {
              sessionId,
              originalFingerprint: session.deviceFingerprint,
              currentFingerprint: currentDeviceInfo.fingerprint
            }
          });

          return {
            valid: false,
            reason: 'Device fingerprint mismatch',
            requiresReauth: true,
            riskLevel: 'HIGH'
          };
        }
      }

      // Validate IP binding if enforced
      if (config.enforceIPBinding && currentIP !== session.ipAddress) {
        // Allow some flexibility for mobile networks and CDNs
        if (!this.isAllowedIPChange(session.ipAddress, currentIP)) {
          await this.invalidateSession(sessionId, 'IP_MISMATCH');
          await auditService.logAuthenticationEvent({
            userId: user?.email || session.userId,
            event: 'session_ip_mismatch',
            provider: 'SESSION_MANAGER',
            ipAddress: currentIP,
            userAgent: currentUA,
            success: false,
            metadata: {
              sessionId,
              originalIP: session.ipAddress,
              currentIP
            }
          });

          return {
            valid: false,
            reason: 'IP address mismatch',
            requiresReauth: true,
            riskLevel: 'HIGH'
          };
        }
      }

      // Check for idle timeout
      const idleTime = Date.now() - session.lastActivityAt.getTime();
      if (idleTime > config.idleTimeout * 60 * 1000) {
        await this.invalidateSession(sessionId, 'IDLE_TIMEOUT');
        return {
          valid: false,
          reason: 'Session idle timeout',
          requiresReauth: false,
          riskLevel: 'MEDIUM'
        };
      }

      // Update last activity
      await this.updateSessionActivity(sessionId, currentIP, currentUA);

      // Calculate current risk level
      const riskLevel = this.assessSessionRisk(session, currentDeviceInfo);

      // Session is valid
      return {
        valid: true,
        session,
        riskLevel
      };

    } catch (error) {
      console.error('Session validation error:', error);
      return {
        valid: false,
        reason: 'Validation error',
        riskLevel: 'HIGH'
      };
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(
    sessionId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const now = new Date();

    // Update database
    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        lastAccessAt: now,
        ...(ipAddress && { ipAddress }),
        ...(userAgent && { userAgent })
      }
    });

    // Update memory cache
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivityAt = now;
      if (ipAddress) session.ipAddress = ipAddress;
      if (userAgent) session.userAgent = userAgent;
      this.activeSessions.set(sessionId, session);
    }
  }

  /**
   * Invalidate a session
   */
  async invalidateSession(sessionId: string, reason?: string): Promise<void> {
    // Get session data for logging
    const session = this.activeSessions.get(sessionId) ||
      await this.getSessionFromDB(sessionId);

    if (session) {
      // Update database
      await prisma.userSession.update({
        where: { id: sessionId },
        data: {
          isActive: false,
          invalidatedAt: new Date(),
          invalidationReason: reason
        }
      });

      // Log session invalidation
      await auditService.logAuthenticationEvent({
        userId: session.userId,
        event: 'session_invalidated',
        provider: 'SESSION_MANAGER',
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        success: true,
        metadata: {
          sessionId,
          reason,
          sessionDuration: Date.now() - session.lastActivityAt.getTime()
        }
      });
    }

    // Remove from memory
    this.activeSessions.delete(sessionId);
    this.sessionSecrets.delete(sessionId);
  }

  /**
   * Invalidate all sessions for a user
   */
  async invalidateAllUserSessions(
    userId: string,
    excludeSessionId?: string,
    reason?: string
  ): Promise<number> {
    // Get all active sessions
    const sessions = await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        ...(excludeSessionId && { id: { not: excludeSessionId } })
      }
    });

    // Invalidate each session
    for (const session of sessions) {
      await this.invalidateSession(session.id, reason);
    }

    return sessions.length;
  }

  /**
   * Rotate session token
   */
  async rotateSessionToken(sessionId: string): Promise<string> {
    const newSessionId = this.generateSessionId();
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    // Update session data
    session.sessionId = newSessionId;
    session.lastActivityAt = new Date();

    // Update database
    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        id: newSessionId,
        lastAccessAt: new Date()
      }
    });

    // Update memory cache
    this.activeSessions.delete(sessionId);
    this.activeSessions.set(newSessionId, session);

    // Rotate session secret
    this.sessionSecrets.delete(sessionId);
    const newSecret = this.generateSessionSecret();
    this.sessionSecrets.set(newSessionId, newSecret);

    // Log token rotation
    await auditService.logAuthenticationEvent({
      userId: session.userId,
      event: 'session_token_rotated',
      provider: 'SESSION_MANAGER',
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      success: true,
      metadata: {
        oldSessionId: sessionId,
        newSessionId
      }
    });

    return newSessionId;
  }

  /**
   * Get user's active sessions
   */
  async getUserActiveSessions(userId: string): Promise<SessionData[]> {
    const sessions = await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() }
      },
      orderBy: {
        lastAccessAt: 'desc'
      }
    });

    return sessions.map(s => s.sessionData as SessionData);
  }

  /**
   * Calculate session risk level
   */
  private calculateSessionRiskLevel(
    deviceInfo: any,
    deviceTrusted: boolean,
    mfaVerified: boolean
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    let risk = 0;

    // Device trust
    if (!deviceTrusted) risk += 30;

    // MFA verification
    if (!mfaVerified) risk += 20;

    // Location factors
    if (deviceInfo.location?.country) {
      const highRiskCountries = ['CN', 'RU', 'NK', 'IR'];
      if (highRiskCountries.includes(deviceInfo.location.country)) {
        risk += 25;
      }
    }

    // Unknown device type
    if (!deviceInfo.device?.type) risk += 10;

    if (risk >= 50) return 'HIGH';
    if (risk >= 25) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Assess current session risk
   */
  private assessSessionRisk(
    session: SessionData,
    currentDeviceInfo: any
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    let risk = 0;

    // Base risk from session metadata
    if (session.metadata.riskLevel === 'HIGH') risk += 30;
    else if (session.metadata.riskLevel === 'MEDIUM') risk += 15;

    // IP changes
    if (currentDeviceInfo.ipAddress !== session.ipAddress) {
      risk += 20;
    }

    // Location changes
    if (currentDeviceInfo.location?.country !== session.metadata.location?.country) {
      risk += 25;
    }

    // Session age
    const sessionAge = Date.now() - session.lastActivityAt.getTime();
    if (sessionAge > 4 * 60 * 60 * 1000) { // 4 hours
      risk += 10;
    }

    if (risk >= 40) return 'HIGH';
    if (risk >= 20) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Check if IP change is allowed
   */
  private isAllowedIPChange(originalIP: string, newIP: string): boolean {
    // Allow changes within same subnet (for mobile networks)
    try {
      const originalParts = originalIP.split('.');
      const newParts = newIP.split('.');

      // Allow if first 2 octets match (simplified CIDR /16)
      if (originalParts[0] === newParts[0] && originalParts[1] === newParts[1]) {
        return true;
      }
    } catch (error) {
      console.error('IP change validation error:', error);
    }

    return false;
  }

  /**
   * Enforce concurrent session limits
   */
  private async enforceConcurrentSessionLimits(
    userId: string,
    maxSessions: number
  ): Promise<void> {
    const activeSessions = await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() }
      },
      orderBy: {
        lastAccessAt: 'asc'
      }
    });

    // Remove oldest sessions if over limit
    const sessionsToRemove = activeSessions.length - maxSessions + 1;
    if (sessionsToRemove > 0) {
      for (let i = 0; i < sessionsToRemove; i++) {
        await this.invalidateSession(
          activeSessions[i].id,
          'CONCURRENT_SESSION_LIMIT'
        );
      }
    }
  }

  /**
   * Get session configuration
   */
  private getSessionConfig(organizationSettings?: any): SessionSecurityConfig {
    return {
      maxConcurrentSessions: organizationSettings?.maxConcurrentSessions || 3,
      sessionTimeout: organizationSettings?.sessionTimeout || 480, // 8 hours
      idleTimeout: organizationSettings?.idleTimeout || 120, // 2 hours
      rotateTokenInterval: organizationSettings?.rotateTokenInterval || 60, // 1 hour
      requireDeviceFingerprint: organizationSettings?.requireDeviceFingerprint ?? true,
      trackLocationChanges: organizationSettings?.trackLocationChanges ?? true,
      enforceIPBinding: organizationSettings?.enforceIPBinding ?? false,
      allowSessionTransfer: organizationSettings?.allowSessionTransfer ?? false
    };
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return createHash('sha256')
      .update(randomBytes(32))
      .update(Date.now().toString())
      .digest('hex');
  }

  /**
   * Generate session secret
   */
  private generateSessionSecret(): string {
    return randomBytes(64).toString('hex');
  }

  /**
   * Get session from database
   */
  private async getSessionFromDB(sessionId: string): Promise<SessionData | null> {
    const dbSession = await prisma.userSession.findUnique({
      where: { id: sessionId }
    });

    return dbSession ? (dbSession.sessionData as SessionData) : null;
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<number> {
    const result = await prisma.userSession.updateMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            lastAccessAt: {
              lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours inactive
            }
          }
        ],
        isActive: true
      },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        invalidationReason: 'EXPIRED'
      }
    });

    // Clean up memory cache
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.expiresAt <= new Date()) {
        this.activeSessions.delete(sessionId);
        this.sessionSecrets.delete(sessionId);
      }
    }

    return result.count;
  }

  /**
   * Get session statistics
   */
  async getSessionStatistics(): Promise<{
    activeSessions: number;
    expiredSessions: number;
    sessionsLast24Hours: number;
    averageSessionDuration: number;
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [activeCount, expiredCount, recentCount] = await Promise.all([
      prisma.userSession.count({
        where: {
          isActive: true,
          expiresAt: { gt: now }
        }
      }),
      prisma.userSession.count({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { isActive: false }
          ]
        }
      }),
      prisma.userSession.count({
        where: {
          createdAt: { gte: yesterday }
        }
      })
    ]);

    // Calculate average session duration
    const recentSessions = await prisma.userSession.findMany({
      where: {
        createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        isActive: false
      },
      select: {
        createdAt: true,
        invalidatedAt: true
      }
    });

    const totalDuration = recentSessions.reduce((sum, session) => {
      if (session.invalidatedAt) {
        return sum + (session.invalidatedAt.getTime() - session.createdAt.getTime());
      }
      return sum;
    }, 0);

    const averageSessionDuration = recentSessions.length > 0
      ? Math.round(totalDuration / recentSessions.length / 1000 / 60) // minutes
      : 0;

    return {
      activeSessions: activeCount,
      expiredSessions: expiredCount,
      sessionsLast24Hours: recentCount,
      averageSessionDuration
    };
  }
}

export const sessionManagementService = new SessionManagementService();
export default sessionManagementService;