import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient, RedisClusterClient } from '../lib/redis-cluster';
import { logger } from '../lib/logger';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum number of requests per window
  keyGenerator?: (request: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (request: NextRequest) => void;
  message?: string;
  standardHeaders?: boolean; // Return rate limit info in headers
  legacyHeaders?: boolean; // Return rate limit info in legacy X-RateLimit-* headers
}

export interface RateLimitRule {
  name: string;
  path: string | RegExp;
  config: RateLimitConfig;
  enabled: boolean;
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

export class RedisRateLimiter {
  private redis: RedisClusterClient;
  private readonly defaultConfig: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    keyGenerator: (request: NextRequest) => this.getClientIdentifier(request),
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false
  };

  private rules: RateLimitRule[] = [
    // Authentication endpoints
    {
      name: 'auth-login',
      path: /^\/api\/auth\/login/,
      config: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5, // 5 login attempts per 15 minutes
        message: 'Too many login attempts, please try again later'
      },
      enabled: true
    },

    // Registration endpoint
    {
      name: 'auth-register',
      path: /^\/api\/auth\/register/,
      config: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 3, // 3 registration attempts per hour
        message: 'Too many registration attempts, please try again later'
      },
      enabled: true
    },

    // Password reset
    {
      name: 'auth-reset-password',
      path: /^\/api\/auth\/reset-password/,
      config: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 3, // 3 password reset attempts per hour
        message: 'Too many password reset attempts, please try again later'
      },
      enabled: true
    },

    // API endpoints
    {
      name: 'api-general',
      path: /^\/api\//,
      config: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 1000, // 1000 API calls per 15 minutes
        skipSuccessfulRequests: false,
        skipFailedRequests: false
      },
      enabled: true
    },

    // Course creation (admin/instructor only)
    {
      name: 'course-creation',
      path: /^\/api\/courses$/,
      config: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 10, // 10 course creations per hour
        message: 'Course creation limit exceeded, please try again later'
      },
      enabled: true
    },

    // Quiz submissions
    {
      name: 'quiz-submission',
      path: /^\/api\/quizzes\/.*\/submit/,
      config: {
        windowMs: 5 * 60 * 1000, // 5 minutes
        maxRequests: 1, // 1 quiz submission per 5 minutes (prevent rapid resubmissions)
        message: 'Please wait before submitting another quiz response'
      },
      enabled: true
    },

    // File uploads
    {
      name: 'file-upload',
      path: /^\/api\/upload/,
      config: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 50, // 50 file uploads per hour
        message: 'File upload limit exceeded, please try again later'
      },
      enabled: true
    },

    // Search endpoints
    {
      name: 'search',
      path: /^\/api\/search/,
      config: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 30, // 30 searches per minute
        message: 'Search limit exceeded, please slow down'
      },
      enabled: true
    },

    // Analytics endpoints
    {
      name: 'analytics',
      path: /^\/api\/analytics/,
      config: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 100, // 100 analytics requests per 15 minutes
        message: 'Analytics request limit exceeded'
      },
      enabled: true
    },

    // Global rate limit for all requests
    {
      name: 'global',
      path: /^.*/,
      config: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 300, // 300 requests per minute per IP
        message: 'Global rate limit exceeded, please slow down'
      },
      enabled: true
    }
  ];

  constructor() {
    this.redis = getRedisClient();
  }

  // Main middleware function
  async middleware(request: NextRequest): Promise<NextResponse | null> {
    try {
      // Find applicable rules for this request
      const applicableRules = this.getApplicableRules(request);

      // Check each rule
      for (const rule of applicableRules) {
        if (!rule.enabled) continue;

        const rateLimitInfo = await this.checkRateLimit(request, rule);

        if (rateLimitInfo.remaining < 0) {
          // Rate limit exceeded
          logger.warn(`Rate limit exceeded for rule ${rule.name}`, {
            ip: this.getClientIdentifier(request),
            path: request.nextUrl.pathname,
            userAgent: request.headers.get('user-agent'),
            rule: rule.name
          });

          if (rule.config.onLimitReached) {
            rule.config.onLimitReached(request);
          }

          return this.createRateLimitResponse(rule.config, rateLimitInfo);
        }

        // Add rate limit headers
        const response = NextResponse.next();
        this.addRateLimitHeaders(response, rateLimitInfo, rule.config);
      }

      return null; // Continue to next middleware
    } catch (error) {
      logger.error('Rate limiter error:', error);
      return null; // Continue on error to avoid breaking the application
    }
  }

  // Check rate limit for a specific rule
  private async checkRateLimit(request: NextRequest, rule: RateLimitRule): Promise<RateLimitInfo> {
    const config = { ...this.defaultConfig, ...rule.config };
    const key = this.getRateLimitKey(request, rule, config);
    const window = Math.floor(Date.now() / config.windowMs);
    const windowKey = `${key}:${window}`;

    // Use Redis pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Increment counter
    pipeline.incr(windowKey);

    // Set expiration if this is a new key
    pipeline.expire(windowKey, Math.ceil(config.windowMs / 1000));

    const results = await pipeline.exec();
    const current = (results?.[0]?.[1] as number) || 0;

    const remaining = Math.max(0, config.maxRequests - current);
    const resetTime = new Date((window + 1) * config.windowMs);

    return {
      limit: config.maxRequests,
      current,
      remaining,
      resetTime
    };
  }

  // Sliding window rate limiter (more accurate but more complex)
  async checkSlidingWindowRateLimit(
    request: NextRequest,
    rule: RateLimitRule
  ): Promise<RateLimitInfo> {
    const config = { ...this.defaultConfig, ...rule.config };
    const key = this.getRateLimitKey(request, rule, config);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Use sorted set to store request timestamps
    const setKey = `sliding:${key}`;

    const pipeline = this.redis.pipeline();

    // Remove old entries
    pipeline.zremrangebyscore(setKey, 0, windowStart);

    // Add current request
    pipeline.zadd(setKey, now, now);

    // Count requests in current window
    pipeline.zcard(setKey);

    // Set expiration
    pipeline.expire(setKey, Math.ceil(config.windowMs / 1000));

    const results = await pipeline.exec();
    const current = (results?.[2]?.[1] as number) || 0;

    const remaining = Math.max(0, config.maxRequests - current);
    const resetTime = new Date(now + config.windowMs);

    return {
      limit: config.maxRequests,
      current,
      remaining,
      resetTime
    };
  }

  // Distributed rate limiting using distributed locks
  async checkDistributedRateLimit(
    request: NextRequest,
    rule: RateLimitRule
  ): Promise<RateLimitInfo> {
    const config = { ...this.defaultConfig, ...rule.config };
    const key = this.getRateLimitKey(request, rule, config);
    const lockKey = `lock:${key}`;
    const lockIdentifier = `${Date.now()}-${Math.random()}`;

    try {
      // Acquire lock
      const lockAcquired = await this.redis.acquireLock(lockKey, lockIdentifier, 1000);

      if (!lockAcquired) {
        // If we can't acquire lock, assume rate limit not exceeded
        return {
          limit: config.maxRequests,
          current: 0,
          remaining: config.maxRequests,
          resetTime: new Date(Date.now() + config.windowMs)
        };
      }

      // Check and update rate limit
      const rateLimitInfo = await this.checkRateLimit(request, rule);

      // Release lock
      await this.redis.releaseLock(lockKey, lockIdentifier);

      return rateLimitInfo;

    } catch (error) {
      logger.error('Distributed rate limit error:', error);

      // Try to release lock
      await this.redis.releaseLock(lockKey, lockIdentifier);

      // Return permissive response on error
      return {
        limit: config.maxRequests,
        current: 0,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs)
      };
    }
  }

  // Get applicable rules for a request
  private getApplicableRules(request: NextRequest): RateLimitRule[] {
    const path = request.nextUrl.pathname;

    return this.rules.filter(rule => {
      if (typeof rule.path === 'string') {
        return path.startsWith(rule.path);
      } else if (rule.path instanceof RegExp) {
        return rule.path.test(path);
      }
      return false;
    }).sort((a, b) => {
      // Sort by specificity (more specific rules first)
      if (typeof a.path === 'string' && typeof b.path === 'string') {
        return b.path.length - a.path.length;
      }
      return 0;
    });
  }

  // Generate rate limit key
  private getRateLimitKey(
    request: NextRequest,
    rule: RateLimitRule,
    config: RateLimitConfig
  ): string {
    const identifier = config.keyGenerator ?
      config.keyGenerator(request) :
      this.getClientIdentifier(request);

    return `ratelimit:${rule.name}:${identifier}`;
  }

  // Get client identifier (IP address, user ID, etc.)
  private getClientIdentifier(request: NextRequest): string {
    // Try to get user ID from session/JWT
    const userId = this.getUserIdFromRequest(request);
    if (userId) {
      return `user:${userId}`;
    }

    // Fallback to IP address
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const remoteAddr = request.ip;

    const ip = forwarded?.split(',')[0] || realIp || remoteAddr || 'unknown';
    return `ip:${ip}`;
  }

  // Extract user ID from request (implement based on your auth system)
  private getUserIdFromRequest(request: NextRequest): string | null {
    try {
      // This would be implemented based on your authentication system
      // Example with JWT:
      const token = request.headers.get('authorization')?.replace('Bearer ', '');
      if (token) {
        // Parse JWT and extract user ID
        // const payload = jwt.verify(token, secret);
        // return payload.userId;
      }

      // Example with session cookie:
      const sessionId = request.cookies.get('sessionId')?.value;
      if (sessionId) {
        // You could look up the user ID from the session
        // return await getUserIdFromSession(sessionId);
      }
    } catch (error) {
      logger.debug('Could not extract user ID from request:', error);
    }

    return null;
  }

  // Create rate limit exceeded response
  private createRateLimitResponse(
    config: RateLimitConfig,
    rateLimitInfo: RateLimitInfo
  ): NextResponse {
    const response = NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: config.message,
        retryAfter: Math.ceil((rateLimitInfo.resetTime.getTime() - Date.now()) / 1000)
      },
      { status: 429 }
    );

    this.addRateLimitHeaders(response, rateLimitInfo, config);
    return response;
  }

  // Add rate limit headers to response
  private addRateLimitHeaders(
    response: NextResponse,
    rateLimitInfo: RateLimitInfo,
    config: RateLimitConfig
  ): void {
    if (config.standardHeaders) {
      response.headers.set('RateLimit-Limit', rateLimitInfo.limit.toString());
      response.headers.set('RateLimit-Remaining', rateLimitInfo.remaining.toString());
      response.headers.set('RateLimit-Reset', rateLimitInfo.resetTime.getTime().toString());
    }

    if (config.legacyHeaders) {
      response.headers.set('X-RateLimit-Limit', rateLimitInfo.limit.toString());
      response.headers.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString());
      response.headers.set('X-RateLimit-Reset', rateLimitInfo.resetTime.getTime().toString());
    }

    // Always add Retry-After header when rate limited
    if (rateLimitInfo.remaining <= 0) {
      const retryAfter = Math.ceil((rateLimitInfo.resetTime.getTime() - Date.now()) / 1000);
      response.headers.set('Retry-After', retryAfter.toString());
    }
  }

  // Configuration management
  addRule(rule: RateLimitRule): void {
    this.rules.push(rule);
  }

  removeRule(ruleName: string): void {
    this.rules = this.rules.filter(rule => rule.name !== ruleName);
  }

  updateRule(ruleName: string, updates: Partial<RateLimitRule>): void {
    const ruleIndex = this.rules.findIndex(rule => rule.name === ruleName);
    if (ruleIndex !== -1) {
      this.rules[ruleIndex] = { ...this.rules[ruleIndex], ...updates };
    }
  }

  enableRule(ruleName: string): void {
    this.updateRule(ruleName, { enabled: true });
  }

  disableRule(ruleName: string): void {
    this.updateRule(ruleName, { enabled: false });
  }

  // Statistics and monitoring
  async getRateLimitStats(timeRange: number = 3600000): Promise<any> {
    try {
      const now = Date.now();
      const start = now - timeRange;

      const stats: any = {
        timeRange,
        rules: {}
      };

      for (const rule of this.rules) {
        const pattern = `ratelimit:${rule.name}:*`;
        const keys = await this.redis.keys(pattern);

        let totalRequests = 0;
        let blockedRequests = 0;

        for (const key of keys) {
          const count = await this.redis.get(key);
          if (count) {
            const requestCount = parseInt(count, 10);
            totalRequests += requestCount;

            if (requestCount > rule.config.maxRequests) {
              blockedRequests += (requestCount - rule.config.maxRequests);
            }
          }
        }

        stats.rules[rule.name] = {
          enabled: rule.enabled,
          totalRequests,
          blockedRequests,
          activeKeys: keys.length
        };
      }

      return stats;
    } catch (error) {
      logger.error('Error getting rate limit stats:', error);
      return null;
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error('Rate limiter health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
let rateLimiter: RedisRateLimiter;

export function getRateLimiter(): RedisRateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RedisRateLimiter();
  }
  return rateLimiter;
}

// Middleware wrapper for easy integration
export async function rateLimitMiddleware(request: NextRequest): Promise<NextResponse | null> {
  const limiter = getRateLimiter();
  return await limiter.middleware(request);
}

export default RedisRateLimiter;