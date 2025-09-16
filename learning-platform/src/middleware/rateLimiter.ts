import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { createHash } from 'crypto';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed in the window
  keyGenerator?: (request: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (request: NextRequest, identifier: string) => void;
  message?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export interface RateLimitInfo extends RateLimitResult {
  identifier: string;
  windowStart: number;
}

class RateLimiter {
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      keyGenerator: config.keyGenerator || this.defaultKeyGenerator,
      skipSuccessfulRequests: config.skipSuccessfulRequests || false,
      skipFailedRequests: config.skipFailedRequests || false,
      onLimitReached: config.onLimitReached || (() => {}),
      message: config.message || 'Too many requests from this IP, please try again later.',
      statusCode: config.statusCode || 429,
      headers: config.headers || {},
    };
  }

  /**
   * Check if request should be rate limited
   */
  async checkLimit(request: NextRequest): Promise<RateLimitInfo> {
    const identifier = this.config.keyGenerator(request);
    const key = this.buildRateLimitKey(identifier);
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const windowEnd = windowStart + this.config.windowMs;

    try {
      // Use Redis transaction for atomic operations
      const pipeline = redis.pipeline();
      
      // Get current count for this window
      const windowKey = `${key}:${windowStart}`;
      pipeline.incr(windowKey);
      pipeline.expire(windowKey, Math.ceil(this.config.windowMs / 1000) + 10); // Add buffer
      
      const results = await pipeline.exec();
      const currentCount = results?.[0]?.[1] as number || 0;

      const allowed = currentCount <= this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - currentCount);
      const resetTime = windowEnd;

      if (!allowed) {
        this.config.onLimitReached(request, identifier);
      }

      const result: RateLimitInfo = {
        allowed,
        limit: this.config.maxRequests,
        remaining,
        resetTime,
        identifier,
        windowStart,
      };
      
      if (!allowed) {
        result.retryAfter = Math.ceil((resetTime - now) / 1000);
      }
      
      return result;
    } catch (error) {
      console.error('Rate limit check error:', error);
      // In case of Redis error, allow the request to proceed
      return {
        allowed: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests,
        resetTime: windowStart + this.config.windowMs,
        identifier,
        windowStart,
      };
    }
  }

  /**
   * Record a request result (for skip options)
   */
  async recordResult(
    identifier: string,
    success: boolean,
    windowStart: number
  ): Promise<void> {
    if (
      (success && this.config.skipSuccessfulRequests) ||
      (!success && this.config.skipFailedRequests)
    ) {
      try {
        const key = this.buildRateLimitKey(identifier);
        const windowKey = `${key}:${windowStart}`;
        await redis.decr(windowKey);
      } catch (error) {
        console.error('Error recording rate limit result:', error);
      }
    }
  }

  /**
   * Create rate limit response
   */
  createLimitResponse(limitInfo: RateLimitInfo): NextResponse {
    const headers = new Headers({
      'X-RateLimit-Limit': limitInfo.limit.toString(),
      'X-RateLimit-Remaining': limitInfo.remaining.toString(),
      'X-RateLimit-Reset': new Date(limitInfo.resetTime).toISOString(),
      'Content-Type': 'application/json',
      ...this.config.headers,
    });

    if (limitInfo.retryAfter) {
      headers.set('Retry-After', limitInfo.retryAfter.toString());
    }

    return new NextResponse(
      JSON.stringify({
        error: this.config.message,
        limit: limitInfo.limit,
        remaining: limitInfo.remaining,
        resetTime: limitInfo.resetTime,
      }),
      {
        status: this.config.statusCode,
        headers,
      }
    );
  }

  private defaultKeyGenerator(request: NextRequest): string {
    // Extract IP address
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 
              request.headers.get('x-real-ip') || 
              'unknown';
    
    return `ip:${ip}`;
  }

  private buildRateLimitKey(identifier: string): string {
    return `ratelimit:${createHash('sha256').update(identifier).digest('hex').substring(0, 16)}`;
  }
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new RateLimiter(config);

  return async function rateLimitMiddleware(
    request: NextRequest,
    next: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    try {
      // Check rate limit
      const limitInfo = await limiter.checkLimit(request);

      // Add rate limit headers to all responses
      const response = limitInfo.allowed ? await next() : limiter.createLimitResponse(limitInfo);

      // Add rate limit headers
      response.headers.set('X-RateLimit-Limit', limitInfo.limit.toString());
      response.headers.set('X-RateLimit-Remaining', limitInfo.remaining.toString());
      response.headers.set('X-RateLimit-Reset', new Date(limitInfo.resetTime).toISOString());

      // Record result if needed
      if (!limitInfo.allowed || response.status >= 400) {
        await limiter.recordResult(
          limitInfo.identifier,
          response.status < 400,
          limitInfo.windowStart
        );
      }

      return response;
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      // If rate limiting fails, allow the request to proceed
      return next();
    }
  };
}

/**
 * Advanced rate limiter with multiple tiers
 */
export class TieredRateLimiter {
  private limiters: Array<{ name: string; limiter: RateLimiter; priority: number }> = [];

  constructor() {}

  addTier(name: string, config: RateLimitConfig, priority: number = 0) {
    this.limiters.push({
      name,
      limiter: new RateLimiter(config),
      priority,
    });

    // Sort by priority (higher priority first)
    this.limiters.sort((a, b) => b.priority - a.priority);
  }

  async checkAllLimits(request: NextRequest): Promise<{
    allowed: boolean;
    limitInfo?: RateLimitInfo;
    tier?: string;
  }> {
    for (const { name, limiter } of this.limiters) {
      const limitInfo = await limiter.checkLimit(request);
      
      if (!limitInfo.allowed) {
        return {
          allowed: false,
          limitInfo,
          tier: name,
        };
      }
    }

    return { allowed: true };
  }
}

/**
 * Predefined rate limit configurations
 */
export const RateLimitPresets = {
  // General API rate limiting
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
  } as RateLimitConfig,

  // Strict rate limiting for sensitive endpoints
  strict: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
  } as RateLimitConfig,

  // Authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts, please try again later.',
  } as RateLimitConfig,

  // File upload endpoints
  upload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    message: 'Upload limit exceeded, please try again later.',
  } as RateLimitConfig,

  // Search endpoints
  search: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
  } as RateLimitConfig,

  // Per-user rate limiting
  perUser: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000,
    keyGenerator: (request: NextRequest) => {
      // Extract user ID from token or session
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        // Extract user ID from JWT - simplified example
        return 'user:unknown'; // Would extract actual user ID
      }
      
      // Fall back to IP if no user
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : 
                request.headers.get('x-real-ip') || 
                'unknown';
      return `guest:${ip}`;
    },
  } as RateLimitConfig,
};

/**
 * Sliding window rate limiter
 */
export class SlidingWindowRateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private keyPrefix: string;

  constructor(windowMs: number, maxRequests: number, keyPrefix: string = 'sliding') {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.keyPrefix = keyPrefix;
  }

  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const key = `${this.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      // Use Redis sorted set to track requests with timestamps
      const pipeline = redis.pipeline();
      
      // Remove expired entries
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      
      // Add current request
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      
      // Count current requests in window
      pipeline.zcard(key);
      
      // Set expiration on the key
      pipeline.expire(key, Math.ceil(this.windowMs / 1000) + 10);
      
      const results = await pipeline.exec();
      const currentCount = results?.[2]?.[1] as number || 0;

      const allowed = currentCount <= this.maxRequests;
      const remaining = Math.max(0, this.maxRequests - currentCount);
      const resetTime = now + this.windowMs;

      const result: RateLimitResult = {
        allowed,
        limit: this.maxRequests,
        remaining,
        resetTime,
      };
      
      if (!allowed) {
        result.retryAfter = Math.ceil(this.windowMs / 1000);
      }
      
      return result;
    } catch (error) {
      console.error('Sliding window rate limit error:', error);
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: this.maxRequests,
        resetTime: now + this.windowMs,
      };
    }
  }
}

/**
 * Rate limiter with different limits based on user tier
 */
export class UserTierRateLimiter {
  private tierLimits: Map<string, RateLimitConfig> = new Map();
  private defaultConfig: RateLimitConfig;

  constructor(defaultConfig: RateLimitConfig) {
    this.defaultConfig = defaultConfig;
  }

  setTierLimit(tier: string, config: RateLimitConfig) {
    this.tierLimits.set(tier, config);
  }

  async checkLimit(request: NextRequest, userTier?: string): Promise<RateLimitInfo> {
    const config = userTier && this.tierLimits.has(userTier) 
      ? this.tierLimits.get(userTier)!
      : this.defaultConfig;

    const limiter = new RateLimiter(config);
    return limiter.checkLimit(request);
  }
}

/**
 * Rate limiter statistics and monitoring
 */
export class RateLimitStats {
  static async getStats(timeRange: number = 24 * 60 * 60 * 1000): Promise<{
    totalRequests: number;
    blockedRequests: number;
    topIPs: Array<{ ip: string; requests: number }>;
    blockRate: number;
  }> {
    try {
      // This would require more sophisticated tracking
      // For now, return basic structure
      return {
        totalRequests: 0,
        blockedRequests: 0,
        topIPs: [],
        blockRate: 0,
      };
    } catch (error) {
      console.error('Rate limit stats error:', error);
      return {
        totalRequests: 0,
        blockedRequests: 0,
        topIPs: [],
        blockRate: 0,
      };
    }
  }

  static async clearUserLimits(identifier: string): Promise<boolean> {
    try {
      const pattern = `ratelimit:*${identifier}*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length > 0) {
        await redis.del(...keys);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Clear user limits error:', error);
      return false;
    }
  }
}