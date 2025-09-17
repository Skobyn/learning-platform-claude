import db from '@/lib/db';
import { jwtUtils } from '@/lib/auth';
import { NextRequest } from 'next/server';

export interface SessionConfig {
  maxAge: number; // Maximum session duration in milliseconds
  idleTimeout: number; // Idle timeout in milliseconds
  absoluteTimeout: number; // Absolute timeout in milliseconds
  renewalThreshold: number; // Threshold for automatic renewal in milliseconds
  requireActiveRefresh: boolean; // Whether to require active user interaction for renewal
}

export interface SessionInfo {
  userId: string;
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  isActive: boolean;
  metadata?: Record<string, any>;
}

export interface TimeoutConfig {
  role: 'ADMIN' | 'INSTRUCTOR' | 'MANAGER' | 'LEARNER';
  sessionTimeout: number; // in minutes
  idleTimeout: number; // in minutes
  absoluteTimeout: number; // in hours
  allowMultipleSessions: boolean;
  requireReauth: boolean; // require re-authentication for sensitive actions
}

class SessionTimeoutService {
  private defaultTimeouts: Record<string, TimeoutConfig> = {
    ADMIN: {
      role: 'ADMIN',
      sessionTimeout: 30, // 30 minutes
      idleTimeout: 15, // 15 minutes
      absoluteTimeout: 8, // 8 hours
      allowMultipleSessions: false,
      requireReauth: true,
    },
    INSTRUCTOR: {
      role: 'INSTRUCTOR',
      sessionTimeout: 60, // 1 hour
      idleTimeout: 30, // 30 minutes
      absoluteTimeout: 12, // 12 hours
      allowMultipleSessions: true,
      requireReauth: false,
    },
    MANAGER: {
      role: 'MANAGER',
      sessionTimeout: 45, // 45 minutes
      idleTimeout: 20, // 20 minutes
      absoluteTimeout: 10, // 10 hours
      allowMultipleSessions: true,
      requireReauth: false,
    },
    LEARNER: {
      role: 'LEARNER',
      sessionTimeout: 120, // 2 hours
      idleTimeout: 60, // 1 hour
      absoluteTimeout: 24, // 24 hours
      allowMultipleSessions: true,
      requireReauth: false,
    },
  };

  /**
   * Create a new session
   */
  async createSession(userId: string, userRole: string, request?: NextRequest): Promise<SessionInfo> {
    try {
      const config = this.getTimeoutConfig(userRole);
      const now = new Date();
      
      const sessionData = {
        userId,
        token: this.generateSessionId(),
        expiresAt: new Date(now.getTime() + config.sessionTimeout * 60 * 1000),
        lastActivity: now,
        metadata: {
          userAgent: request?.headers.get('user-agent') || 'unknown',
          ipAddress: this.getClientIP(request) || 'unknown',
          role: userRole,
          config: config,
          absoluteExpiresAt: new Date(now.getTime() + config.absoluteTimeout * 60 * 60 * 1000),
        }
      };

      // Check if multiple sessions are allowed
      if (!config.allowMultipleSessions) {
        await this.terminateAllUserSessions(userId);
      }

      const session = await db.userSession.create({
        data: sessionData
      });

      return {
        userId: session.userId,
        sessionId: session.token,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity || now,
        expiresAt: session.expiresAt,
        isActive: true,
        metadata: session.metadata as Record<string, any>,
      };

    } catch (error) {
      console.error('Failed to create session:', error);
      throw new Error('Session creation failed');
    }
  }

  /**
   * Validate and refresh session
   */
  async validateAndRefreshSession(sessionId: string, request?: NextRequest): Promise<{
    valid: boolean;
    session?: SessionInfo;
    reason?: string;
    requiresReauth?: boolean;
  }> {
    try {
      const dbSession = await db.userSession.findUnique({
        where: { token: sessionId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              isActive: true,
            }
          }
        }
      });

      if (!dbSession || !dbSession.user) {
        return { valid: false, reason: 'SESSION_NOT_FOUND' };
      }

      if (!dbSession.user.isActive) {
        await this.terminateSession(sessionId);
        return { valid: false, reason: 'USER_INACTIVE' };
      }

      const now = new Date();
      const metadata = dbSession.metadata as Record<string, any> || {};
      const config = this.getTimeoutConfig(dbSession.user.role);

      // Check absolute timeout
      const absoluteExpiresAt = metadata.absoluteExpiresAt ? new Date(metadata.absoluteExpiresAt) : null;
      if (absoluteExpiresAt && now > absoluteExpiresAt) {
        await this.terminateSession(sessionId);
        return { valid: false, reason: 'ABSOLUTE_TIMEOUT_EXCEEDED' };
      }

      // Check session expiration
      if (now > dbSession.expiresAt) {
        await this.terminateSession(sessionId);
        return { valid: false, reason: 'SESSION_EXPIRED' };
      }

      // Check idle timeout
      const lastActivity = dbSession.lastActivity || dbSession.createdAt;
      const idleExpiration = new Date(lastActivity.getTime() + config.idleTimeout * 60 * 1000);
      if (now > idleExpiration) {
        await this.terminateSession(sessionId);
        return { valid: false, reason: 'IDLE_TIMEOUT_EXCEEDED' };
      }

      // Update last activity and extend session if needed
      const timeUntilExpiration = dbSession.expiresAt.getTime() - now.getTime();
      const renewalThreshold = config.sessionTimeout * 60 * 1000 * 0.2; // 20% of session timeout

      let updatedSession = dbSession;
      if (timeUntilExpiration < renewalThreshold) {
        const newExpiresAt = new Date(now.getTime() + config.sessionTimeout * 60 * 1000);
        
        // Don't extend beyond absolute timeout
        const maxExpiresAt = absoluteExpiresAt || new Date(now.getTime() + config.absoluteTimeout * 60 * 60 * 1000);
        const finalExpiresAt = newExpiresAt > maxExpiresAt ? maxExpiresAt : newExpiresAt;

        updatedSession = await db.userSession.update({
          where: { id: dbSession.id },
          data: {
            expiresAt: finalExpiresAt,
            lastActivity: now,
            metadata: {
              ...metadata,
              renewedAt: now,
              clientIP: this.getClientIP(request) || metadata.clientIP,
            }
          },
          include: {
            user: {
              select: {
                id: true,
                role: true,
                isActive: true,
              }
            }
          }
        });

        // Log session renewal
        await this.logSessionActivity(dbSession.userId, 'SESSION_RENEWED', {
          sessionId,
          oldExpiresAt: dbSession.expiresAt,
          newExpiresAt: finalExpiresAt,
        });
      } else {
        // Just update last activity
        updatedSession = await db.userSession.update({
          where: { id: dbSession.id },
          data: { lastActivity: now },
          include: {
            user: {
              select: {
                id: true,
                role: true,
                isActive: true,
              }
            }
          }
        });
      }

      return {
        valid: true,
        session: {
          userId: updatedSession.userId,
          sessionId: updatedSession.token,
          createdAt: updatedSession.createdAt,
          lastActivity: updatedSession.lastActivity || now,
          expiresAt: updatedSession.expiresAt,
          isActive: true,
          metadata: updatedSession.metadata as Record<string, any>,
        },
      };

    } catch (error) {
      console.error('Session validation failed:', error);
      return { valid: false, reason: 'VALIDATION_ERROR' };
    }
  }

  /**
   * Terminate a specific session
   */
  async terminateSession(sessionId: string): Promise<void> {
    try {
      const session = await db.userSession.findUnique({
        where: { token: sessionId },
        select: { userId: true, id: true }
      });

      if (session) {
        await db.userSession.delete({
          where: { id: session.id }
        });

        await this.logSessionActivity(session.userId, 'SESSION_TERMINATED', {
          sessionId,
          terminatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error('Failed to terminate session:', error);
    }
  }

  /**
   * Terminate all sessions for a user
   */
  async terminateAllUserSessions(userId: string): Promise<number> {
    try {
      const sessions = await db.userSession.findMany({
        where: { userId },
        select: { id: true, token: true }
      });

      if (sessions.length > 0) {
        await db.userSession.deleteMany({
          where: { userId }
        });

        await this.logSessionActivity(userId, 'ALL_SESSIONS_TERMINATED', {
          sessionCount: sessions.length,
          terminatedAt: new Date(),
        });
      }

      return sessions.length;
    } catch (error) {
      console.error('Failed to terminate all user sessions:', error);
      return 0;
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionInfo[]> {
    try {
      const sessions = await db.userSession.findMany({
        where: {
          userId,
          expiresAt: { gt: new Date() }
        },
        orderBy: { lastActivity: 'desc' }
      });

      return sessions.map(session => ({
        userId: session.userId,
        sessionId: session.token,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity || session.createdAt,
        expiresAt: session.expiresAt,
        isActive: true,
        metadata: session.metadata as Record<string, any>,
      }));
    } catch (error) {
      console.error('Failed to get user sessions:', error);
      return [];
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await db.userSession.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });

      if (result.count > 0) {
        console.log(`Cleaned up ${result.count} expired sessions`);
      }

      return result.count;
    } catch (error) {
      console.error('Session cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStatistics(): Promise<{
    totalActiveSessions: number;
    sessionsByRole: Record<string, number>;
    expiredSessions: number;
    avgSessionDuration: number;
  }> {
    try {
      const now = new Date();
      
      const [activeSessions, expiredCount] = await Promise.all([
        db.userSession.findMany({
          where: { expiresAt: { gt: now } },
          include: {
            user: { select: { role: true } }
          }
        }),
        db.userSession.count({
          where: { expiresAt: { lt: now } }
        })
      ]);

      const sessionsByRole = activeSessions.reduce((acc, session) => {
        const role = session.user.role;
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const avgSessionDuration = activeSessions.length > 0 
        ? activeSessions.reduce((sum, session) => {
            const duration = (session.lastActivity || session.createdAt).getTime() - session.createdAt.getTime();
            return sum + duration;
          }, 0) / activeSessions.length / (60 * 1000) // in minutes
        : 0;

      return {
        totalActiveSessions: activeSessions.length,
        sessionsByRole,
        expiredSessions: expiredCount,
        avgSessionDuration: Math.round(avgSessionDuration),
      };
    } catch (error) {
      console.error('Failed to get session statistics:', error);
      return {
        totalActiveSessions: 0,
        sessionsByRole: {},
        expiredSessions: 0,
        avgSessionDuration: 0,
      };
    }
  }

  /**
   * Update timeout configuration for a role
   */
  updateTimeoutConfig(role: string, config: Partial<TimeoutConfig>): void {
    if (this.defaultTimeouts[role]) {
      this.defaultTimeouts[role] = {
        ...this.defaultTimeouts[role],
        ...config,
      };
    }
  }

  /**
   * Get timeout configuration for a role
   */
  getTimeoutConfig(role: string): TimeoutConfig {
    return this.defaultTimeouts[role] || this.defaultTimeouts.LEARNER;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private getClientIP(request?: NextRequest): string | null {
    if (!request) return null;
    
    return (
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      request.ip ||
      null
    );
  }

  private async logSessionActivity(userId: string, action: string, details: Record<string, any>): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action,
          resource: 'session',
          details,
          ipAddress: details.clientIP || 'unknown',
          userAgent: details.userAgent || 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log session activity:', error);
    }
  }
}

export const sessionTimeoutService = new SessionTimeoutService();