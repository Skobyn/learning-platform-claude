import { redis, generateCacheKey } from './redis';
import { cacheService, CacheConfigs } from '@/services/cacheService';
import { randomBytes, createHash } from 'crypto';
import { sign, verify, JwtPayload } from 'jsonwebtoken';

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  loginTime: number;
  lastActivity: number;
  ipAddress: string;
  userAgent: string;
  csrfToken: string;
  metadata?: Record<string, any>;
}

export interface SessionOptions {
  maxAge?: number; // Session max age in milliseconds
  secure?: boolean; // Require HTTPS
  httpOnly?: boolean; // HTTP only flag
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
  path?: string;
}

export interface SessionValidationResult {
  valid: boolean;
  session?: SessionData;
  reason?: string;
  shouldRefresh?: boolean;
}

class SessionManager {
  private readonly sessionSecret: string;
  private readonly csrfSecret: string;
  private readonly defaultMaxAge: number = 8 * 60 * 60 * 1000; // 8 hours
  private readonly sessionPrefix = 'session';
  private readonly userSessionsPrefix = 'user_sessions';
  private readonly maxConcurrentSessions = 5;

  constructor() {
    this.sessionSecret = process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || 'default-session-secret';
    this.csrfSecret = process.env.CSRF_SECRET || 'default-csrf-secret';
    
    if (this.sessionSecret === 'default-session-secret') {
      console.warn('Using default session secret - this is insecure for production!');
    }
  }

  /**
   * Create a new session
   */
  async createSession(
    sessionData: Omit<SessionData, 'loginTime' | 'lastActivity' | 'csrfToken'>,
    options?: SessionOptions
  ): Promise<{ sessionId: string; sessionToken: string; csrfToken: string }> {
    const sessionId = this.generateSessionId();
    const csrfToken = this.generateCsrfToken();
    const now = Date.now();
    
    const fullSessionData: SessionData = {
      ...sessionData,
      loginTime: now,
      lastActivity: now,
      csrfToken,
    };

    // Store session data in Redis
    const sessionKey = this.buildSessionKey(sessionId);
    await cacheService.set(sessionKey, fullSessionData, {
      ...CacheConfigs.userSession,
      ttl: options?.maxAge ? Math.floor(options.maxAge / 1000) : CacheConfigs.userSession.ttl,
    });

    // Track user's active sessions
    await this.addUserSession(sessionData.userId, sessionId);

    // Enforce concurrent session limits
    await this.enforceSessionLimits(sessionData.userId);

    // Generate JWT token for the session
    const sessionToken = this.generateSessionToken(sessionId, sessionData.userId);

    return {
      sessionId,
      sessionToken,
      csrfToken,
    };
  }

  /**
   * Validate and retrieve session
   */
  async validateSession(sessionToken: string, ipAddress?: string, userAgent?: string): Promise<SessionValidationResult> {
    try {
      // Verify JWT token
      const decoded = this.verifySessionToken(sessionToken);
      if (!decoded || !decoded.sessionId) {
        return { valid: false, reason: 'Invalid session token' };
      }

      // Get session data from Redis
      const sessionKey = this.buildSessionKey(decoded.sessionId);
      const sessionData = await cacheService.get<SessionData>(sessionKey);

      if (!sessionData) {
        return { valid: false, reason: 'Session not found' };
      }

      // Check session expiration
      const now = Date.now();
      const sessionAge = now - sessionData.loginTime;
      if (sessionAge > this.defaultMaxAge) {
        await this.destroySession(decoded.sessionId);
        return { valid: false, reason: 'Session expired' };
      }

      // Check for suspicious activity
      if (ipAddress && sessionData.ipAddress !== ipAddress) {
        console.warn(`IP address mismatch for session ${decoded.sessionId}: expected ${sessionData.ipAddress}, got ${ipAddress}`);
        // Could implement stricter validation here
      }

      // Check if session should be refreshed (if more than 25% of max age has passed)
      const shouldRefresh = (now - sessionData.lastActivity) > (this.defaultMaxAge * 0.25);

      if (shouldRefresh) {
        sessionData.lastActivity = now;
        if (ipAddress) sessionData.ipAddress = ipAddress;
        if (userAgent) sessionData.userAgent = userAgent;
        
        await cacheService.set(sessionKey, sessionData, CacheConfigs.userSession);
      }

      return {
        valid: true,
        session: sessionData,
        shouldRefresh,
      };
    } catch (error) {
      console.error('Session validation error:', error);
      return { valid: false, reason: 'Session validation failed' };
    }
  }

  /**
   * Refresh session activity
   */
  async refreshSession(sessionId: string, updates?: Partial<SessionData>): Promise<boolean> {
    try {
      const sessionKey = this.buildSessionKey(sessionId);
      const sessionData = await cacheService.get<SessionData>(sessionKey);

      if (!sessionData) {
        return false;
      }

      const updatedSession: SessionData = {
        ...sessionData,
        ...updates,
        lastActivity: Date.now(),
      };

      await cacheService.set(sessionKey, updatedSession, CacheConfigs.userSession);
      return true;
    } catch (error) {
      console.error('Session refresh error:', error);
      return false;
    }
  }

  /**
   * Destroy specific session
   */
  async destroySession(sessionId: string): Promise<boolean> {
    try {
      const sessionKey = this.buildSessionKey(sessionId);
      const sessionData = await cacheService.get<SessionData>(sessionKey);
      
      if (sessionData) {
        // Remove from user's session list
        await this.removeUserSession(sessionData.userId, sessionId);
      }

      // Delete session data
      await cacheService.delete(sessionKey);
      return true;
    } catch (error) {
      console.error('Session destroy error:', error);
      return false;
    }
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyUserSessions(userId: string): Promise<number> {
    try {
      const userSessionsKey = this.buildUserSessionsKey(userId);
      const sessionIds = await redis.smembers(userSessionsKey);
      
      let destroyedCount = 0;
      for (const sessionId of sessionIds) {
        const success = await this.destroySession(sessionId);
        if (success) destroyedCount++;
      }

      // Clear the user sessions set
      await redis.del(userSessionsKey);
      
      return destroyedCount;
    } catch (error) {
      console.error('Destroy user sessions error:', error);
      return 0;
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Array<{ sessionId: string; sessionData: SessionData }>> {
    try {
      const userSessionsKey = this.buildUserSessionsKey(userId);
      const sessionIds = await redis.smembers(userSessionsKey);
      
      const sessions = [];
      for (const sessionId of sessionIds) {
        const sessionKey = this.buildSessionKey(sessionId);
        const sessionData = await cacheService.get<SessionData>(sessionKey);
        
        if (sessionData) {
          sessions.push({ sessionId, sessionData });
        } else {
          // Clean up orphaned session ID
          await redis.srem(userSessionsKey, sessionId);
        }
      }
      
      return sessions;
    } catch (error) {
      console.error('Get user sessions error:', error);
      return [];
    }
  }

  /**
   * Validate CSRF token
   */
  validateCsrfToken(sessionCsrfToken: string, submittedCsrfToken: string): boolean {
    return sessionCsrfToken === submittedCsrfToken;
  }

  /**
   * Generate new CSRF token for session
   */
  async regenerateCsrfToken(sessionId: string): Promise<string | null> {
    try {
      const sessionKey = this.buildSessionKey(sessionId);
      const sessionData = await cacheService.get<SessionData>(sessionKey);

      if (!sessionData) {
        return null;
      }

      const newCsrfToken = this.generateCsrfToken();
      sessionData.csrfToken = newCsrfToken;

      await cacheService.set(sessionKey, sessionData, CacheConfigs.userSession);
      return newCsrfToken;
    } catch (error) {
      console.error('CSRF token regeneration error:', error);
      return null;
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const pattern = this.buildSessionKey('*');
      const sessionKeys = await redis.keys(pattern);
      
      let cleanedCount = 0;
      const now = Date.now();
      
      for (const sessionKey of sessionKeys) {
        const sessionData = await cacheService.get<SessionData>(sessionKey);
        
        if (sessionData && (now - sessionData.loginTime) > this.defaultMaxAge) {
          const sessionId = sessionKey.split(':').pop();
          if (sessionId) {
            await this.destroySession(sessionId);
            cleanedCount++;
          }
        }
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('Session cleanup error:', error);
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalActiveSessions: number;
    sessionsPerUser: Record<string, number>;
    avgSessionAge: number;
    expiredSessions: number;
  }> {
    try {
      const pattern = this.buildSessionKey('*');
      const sessionKeys = await redis.keys(pattern);
      
      const stats = {
        totalActiveSessions: sessionKeys.length,
        sessionsPerUser: {} as Record<string, number>,
        avgSessionAge: 0,
        expiredSessions: 0,
      };

      let totalAge = 0;
      const now = Date.now();

      for (const sessionKey of sessionKeys) {
        const sessionData = await cacheService.get<SessionData>(sessionKey);
        
        if (sessionData) {
          // Count sessions per user
          stats.sessionsPerUser[sessionData.userId] = 
            (stats.sessionsPerUser[sessionData.userId] || 0) + 1;
          
          // Calculate session age
          const sessionAge = now - sessionData.loginTime;
          totalAge += sessionAge;
          
          // Check if expired
          if (sessionAge > this.defaultMaxAge) {
            stats.expiredSessions++;
          }
        }
      }

      if (sessionKeys.length > 0) {
        stats.avgSessionAge = totalAge / sessionKeys.length;
      }

      return stats;
    } catch (error) {
      console.error('Session stats error:', error);
      return {
        totalActiveSessions: 0,
        sessionsPerUser: {},
        avgSessionAge: 0,
        expiredSessions: 0,
      };
    }
  }

  // Private helper methods

  private generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }

  private generateCsrfToken(): string {
    return createHash('sha256')
      .update(randomBytes(32))
      .update(this.csrfSecret)
      .digest('hex');
  }

  private generateSessionToken(sessionId: string, userId: string): string {
    return sign(
      {
        sessionId,
        userId,
        iat: Math.floor(Date.now() / 1000),
      },
      this.sessionSecret,
      {
        expiresIn: '8h',
        issuer: 'learning-platform',
        audience: 'learning-platform-users',
      }
    );
  }

  private verifySessionToken(token: string): (JwtPayload & { sessionId?: string; userId?: string }) | null {
    try {
      return verify(token, this.sessionSecret) as JwtPayload & { sessionId?: string; userId?: string };
    } catch (error) {
      return null;
    }
  }

  private buildSessionKey(sessionId: string): string {
    return `${this.sessionPrefix}:${sessionId}`;
  }

  private buildUserSessionsKey(userId: string): string {
    return `${this.userSessionsPrefix}:${userId}`;
  }

  private async addUserSession(userId: string, sessionId: string): Promise<void> {
    const userSessionsKey = this.buildUserSessionsKey(userId);
    await redis.sadd(userSessionsKey, sessionId);
    
    // Set expiration on the user sessions set
    await redis.expire(userSessionsKey, CacheConfigs.userSession.ttl);
  }

  private async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const userSessionsKey = this.buildUserSessionsKey(userId);
    await redis.srem(userSessionsKey, sessionId);
  }

  private async enforceSessionLimits(userId: string): Promise<void> {
    const userSessionsKey = this.buildUserSessionsKey(userId);
    const sessionIds = await redis.smembers(userSessionsKey);
    
    if (sessionIds.length > this.maxConcurrentSessions) {
      // Get session details to find oldest sessions
      const sessionsWithData = [];
      
      for (const sessionId of sessionIds) {
        const sessionKey = this.buildSessionKey(sessionId);
        const sessionData = await cacheService.get<SessionData>(sessionKey);
        
        if (sessionData) {
          sessionsWithData.push({ sessionId, sessionData });
        } else {
          // Clean up orphaned session
          await redis.srem(userSessionsKey, sessionId);
        }
      }
      
      // Sort by last activity (oldest first)
      sessionsWithData.sort((a, b) => a.sessionData.lastActivity - b.sessionData.lastActivity);
      
      // Remove excess sessions
      const sessionsToRemove = sessionsWithData.length - this.maxConcurrentSessions;
      for (let i = 0; i < sessionsToRemove; i++) {
        await this.destroySession(sessionsWithData[i].sessionId);
      }
    }
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();

// Background cleanup task
setInterval(() => {
  sessionManager.cleanupExpiredSessions().catch((error) => {
    console.error('Background session cleanup failed:', error);
  });
}, 15 * 60 * 1000); // Run every 15 minutes