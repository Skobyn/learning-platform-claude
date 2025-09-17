import Redis from 'ioredis';

// Advanced Query Caching Strategy for Learning Platform
// Optimized for 100K+ concurrent users with intelligent cache invalidation

interface CacheConfig {
  ttl: number;
  tags: string[];
  version?: string;
  compress?: boolean;
  keyPrefix?: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  memoryUsage: number;
  keyCount: number;
}

export class QueryCacheManager {
  private redis: Redis;
  private localCache: Map<string, { data: any; expiry: number; tags: string[]; hits: number }>;
  private stats: { hits: number; misses: number } = { hits: 0, misses: 0 };
  private readonly maxLocalCacheSize = 10000; // Maximum local cache entries

  constructor(redisUrl?: string) {
    // Initialize Redis connection
    this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      // Connection pool settings for high concurrency
      family: 4,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    // Initialize local in-memory cache as L1 cache
    this.localCache = new Map();

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.redis.on('error', (error) => {
      console.error('Redis cache error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Redis cache connected');
    });
  }

  /**
   * Multi-level caching strategy:
   * 1. L1: In-memory cache (fastest)
   * 2. L2: Redis cache (fast, distributed)
   * 3. L3: Database query (fallback)
   */
  async withCache<T>(
    key: string,
    queryFn: () => Promise<T>,
    config: CacheConfig
  ): Promise<T> {
    const fullKey = this.buildCacheKey(key, config.keyPrefix);

    try {
      // L1 Cache: Check local memory first
      const localResult = this.getFromLocalCache(fullKey);
      if (localResult !== null) {
        this.stats.hits++;
        return localResult;
      }

      // L2 Cache: Check Redis
      const redisResult = await this.getFromRedis<T>(fullKey);
      if (redisResult !== null) {
        // Store in L1 cache for faster subsequent access
        this.setInLocalCache(fullKey, redisResult, config.ttl, config.tags);
        this.stats.hits++;
        return redisResult;
      }

      // L3 Cache Miss: Execute query
      this.stats.misses++;
      const result = await queryFn();

      // Store in both caches
      await this.setInRedis(fullKey, result, config);
      this.setInLocalCache(fullKey, result, config.ttl, config.tags);

      return result;
    } catch (error) {
      console.error(`Cache error for key ${fullKey}:`, error);
      // Fallback to direct query on cache failure
      return queryFn();
    }
  }

  /**
   * Intelligent cache invalidation by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      // Invalidate local cache
      for (const [key, item] of this.localCache.entries()) {
        if (item.tags.some(tag => tags.includes(tag))) {
          this.localCache.delete(key);
        }
      }

      // Invalidate Redis cache using tag-based keys
      const pipeline = this.redis.pipeline();

      for (const tag of tags) {
        const taggedKeys = await this.redis.smembers(`tag:${tag}`);
        for (const key of taggedKeys) {
          pipeline.del(key);
        }
        pipeline.del(`tag:${tag}`);
      }

      await pipeline.exec();
    } catch (error) {
      console.error('Error invalidating cache by tags:', error);
    }
  }

  /**
   * Preload frequently accessed data
   */
  async preloadCache(queries: Array<{
    key: string;
    queryFn: () => Promise<any>;
    config: CacheConfig;
  }>): Promise<void> {
    const pipeline = this.redis.pipeline();

    for (const query of queries) {
      try {
        const result = await query.queryFn();
        const fullKey = this.buildCacheKey(query.key, query.config.keyPrefix);

        await this.setInRedis(fullKey, result, query.config);
        this.setInLocalCache(fullKey, result, query.config.ttl, query.config.tags);
      } catch (error) {
        console.error(`Error preloading cache for key ${query.key}:`, error);
      }
    }
  }

  /**
   * Cache warming for critical queries
   */
  async warmCache(): Promise<void> {
    const criticalQueries = [
      // Popular courses
      {
        key: 'popular-courses',
        queryFn: async () => {
          // This would be replaced with actual Prisma query
          return { placeholder: 'popular-courses-data' };
        },
        config: {
          ttl: 15 * 60 * 1000, // 15 minutes
          tags: ['courses', 'popular'],
          keyPrefix: 'analytics'
        }
      },

      // Platform statistics
      {
        key: 'platform-stats',
        queryFn: async () => {
          return { placeholder: 'platform-stats-data' };
        },
        config: {
          ttl: 5 * 60 * 1000, // 5 minutes
          tags: ['platform', 'stats'],
          keyPrefix: 'analytics'
        }
      },

      // User counts by role
      {
        key: 'user-counts',
        queryFn: async () => {
          return { placeholder: 'user-counts-data' };
        },
        config: {
          ttl: 30 * 60 * 1000, // 30 minutes
          tags: ['users', 'counts'],
          keyPrefix: 'analytics'
        }
      }
    ];

    await this.preloadCache(criticalQueries);
    console.log('Cache warming completed for critical queries');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      memoryUsage: this.getLocalCacheMemoryUsage(),
      keyCount: this.localCache.size,
    };
  }

  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<void> {
    try {
      this.localCache.clear();
      await this.redis.flushdb();
      this.stats = { hits: 0, misses: 0 };
    } catch (error) {
      console.error('Error clearing caches:', error);
    }
  }

  /**
   * Cleanup expired entries from local cache
   */
  cleanupLocalCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.localCache.entries()) {
      if (now > item.expiry) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.localCache.delete(key));

    // If cache is too large, remove least recently used items
    if (this.localCache.size > this.maxLocalCacheSize) {
      const sortedEntries = Array.from(this.localCache.entries())
        .sort((a, b) => a[1].hits - b[1].hits)
        .slice(0, this.localCache.size - this.maxLocalCacheSize);

      sortedEntries.forEach(([key]) => this.localCache.delete(key));
    }
  }

  // Private helper methods

  private buildCacheKey(key: string, prefix?: string): string {
    const baseKey = prefix ? `${prefix}:${key}` : key;
    return `lms:${baseKey}`;
  }

  private getFromLocalCache(key: string): any | null {
    const item = this.localCache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.localCache.delete(key);
      return null;
    }

    item.hits++;
    return item.data;
  }

  private setInLocalCache(key: string, data: any, ttl: number, tags: string[]): void {
    // Cleanup if approaching max size
    if (this.localCache.size >= this.maxLocalCacheSize) {
      this.cleanupLocalCache();
    }

    this.localCache.set(key, {
      data,
      expiry: Date.now() + ttl,
      tags,
      hits: 0,
    });
  }

  private async getFromRedis<T>(key: string): Promise<T | null> {
    try {
      const result = await this.redis.get(key);
      if (!result) return null;

      return JSON.parse(result);
    } catch (error) {
      console.error(`Error getting from Redis cache (${key}):`, error);
      return null;
    }
  }

  private async setInRedis(key: string, data: any, config: CacheConfig): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      // Store the data
      const serializedData = JSON.stringify(data);
      pipeline.setex(key, Math.floor(config.ttl / 1000), serializedData);

      // Add to tag sets for invalidation
      for (const tag of config.tags) {
        pipeline.sadd(`tag:${tag}`, key);
        pipeline.expire(`tag:${tag}`, Math.floor(config.ttl / 1000));
      }

      await pipeline.exec();
    } catch (error) {
      console.error(`Error setting Redis cache (${key}):`, error);
    }
  }

  private getLocalCacheMemoryUsage(): number {
    return JSON.stringify(Array.from(this.localCache.entries())).length;
  }

  /**
   * Close connections
   */
  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.localCache.clear();
    } catch (error) {
      console.error('Error disconnecting cache:', error);
    }
  }
}

// Cache configurations for different types of queries
export const CacheConfigs = {
  // User-specific data (short TTL due to frequent updates)
  USER_DATA: {
    ttl: 5 * 60 * 1000, // 5 minutes
    tags: ['user'],
    keyPrefix: 'user'
  },

  // Course catalog (medium TTL, updated less frequently)
  COURSE_CATALOG: {
    ttl: 30 * 60 * 1000, // 30 minutes
    tags: ['courses', 'catalog'],
    keyPrefix: 'courses'
  },

  // Analytics data (longer TTL, expensive to compute)
  ANALYTICS: {
    ttl: 60 * 60 * 1000, // 1 hour
    tags: ['analytics'],
    keyPrefix: 'analytics'
  },

  // Static content (very long TTL)
  STATIC_CONTENT: {
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    tags: ['static'],
    keyPrefix: 'static'
  },

  // Real-time data (very short TTL)
  REALTIME: {
    ttl: 30 * 1000, // 30 seconds
    tags: ['realtime'],
    keyPrefix: 'rt'
  },

  // Search results (medium TTL)
  SEARCH_RESULTS: {
    ttl: 15 * 60 * 1000, // 15 minutes
    tags: ['search'],
    keyPrefix: 'search'
  }
};

// Example usage patterns
export const CachePatterns = {
  /**
   * User-specific caching pattern
   */
  userSpecific: (userId: string, dataType: string) => ({
    key: `user:${userId}:${dataType}`,
    config: CacheConfigs.USER_DATA
  }),

  /**
   * Course-specific caching pattern
   */
  courseSpecific: (courseId: string, dataType: string) => ({
    key: `course:${courseId}:${dataType}`,
    config: {
      ...CacheConfigs.COURSE_CATALOG,
      tags: ['courses', `course:${courseId}`]
    }
  }),

  /**
   * Analytics caching pattern
   */
  analytics: (metric: string, timeframe: string) => ({
    key: `analytics:${metric}:${timeframe}`,
    config: CacheConfigs.ANALYTICS
  }),

  /**
   * Search caching pattern
   */
  search: (query: string, filters: string) => ({
    key: `search:${Buffer.from(query + filters).toString('base64')}`,
    config: CacheConfigs.SEARCH_RESULTS
  })
};

// Export singleton instance
export const queryCacheManager = new QueryCacheManager();

// Auto cleanup interval
setInterval(() => {
  queryCacheManager.cleanupLocalCache();
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
  await queryCacheManager.disconnect();
});

process.on('SIGINT', async () => {
  await queryCacheManager.disconnect();
});