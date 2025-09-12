import { redis, generateCacheKey, serializeForCache, deserializeFromCache } from '@/lib/redis';
import { createHash } from 'crypto';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
  version?: string; // Version for cache versioning
  compress?: boolean; // Enable compression
  namespace?: string; // Cache namespace
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size: number;
  memory: number;
}

class CacheService {
  private defaultTTL = 3600; // 1 hour default TTL
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
    memory: 0,
  };

  constructor() {
    // Initialize cache statistics tracking
    this.initializeStatsTracking();
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options?: Pick<CacheOptions, 'namespace'>): Promise<T | null> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      const cached = await redis.get(fullKey);
      
      if (cached === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      const deserialized = deserializeFromCache<T>(cached);
      
      if (deserialized === null) {
        // Invalid cache data, remove it
        await this.delete(key, options);
        this.stats.misses++;
        return null;
      }

      return deserialized;
    } catch (error) {
      console.error('Cache get error:', error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<boolean> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      const serialized = serializeForCache(value);
      const ttl = options?.ttl || this.defaultTTL;

      // Set the main cache entry
      await redis.setex(fullKey, ttl, serialized);
      
      // Track tags for invalidation
      if (options?.tags && options.tags.length > 0) {
        await this.addTagAssociations(fullKey, options.tags, ttl);
      }

      // Track version if provided
      if (options?.version) {
        const versionKey = this.buildVersionKey(key, options.namespace);
        await redis.setex(versionKey, ttl, options.version);
      }

      this.stats.sets++;
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, options?: Pick<CacheOptions, 'namespace'>): Promise<boolean> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      const result = await redis.del(fullKey);
      
      // Also delete version key if it exists
      const versionKey = this.buildVersionKey(key, options?.namespace);
      await redis.del(versionKey);
      
      this.stats.deletes++;
      return result > 0;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, options?: Pick<CacheOptions, 'namespace'>): Promise<boolean> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      const result = await redis.exists(fullKey);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   */
  async ttl(key: string, options?: Pick<CacheOptions, 'namespace'>): Promise<number> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      return await redis.ttl(fullKey);
    } catch (error) {
      console.error('Cache TTL error:', error);
      return -1;
    }
  }

  /**
   * Update TTL for existing key
   */
  async expire(key: string, ttl: number, options?: Pick<CacheOptions, 'namespace'>): Promise<boolean> {
    try {
      const fullKey = this.buildCacheKey(key, options?.namespace);
      const result = await redis.expire(fullKey, ttl);
      return result === 1;
    } catch (error) {
      console.error('Cache expire error:', error);
      return false;
    }
  }

  /**
   * Get or set pattern - execute function if not cached
   */
  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // First try to get from cache
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // Not in cache, execute function
    try {
      const result = await fetchFunction();
      await this.set(key, result, options);
      return result;
    } catch (error) {
      console.error('Cache getOrSet fetch error:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      let deletedCount = 0;
      
      for (const tag of tags) {
        const tagKey = this.buildTagKey(tag);
        const associatedKeys = await redis.smembers(tagKey);
        
        if (associatedKeys.length > 0) {
          // Delete all associated keys
          const deleted = await redis.del(...associatedKeys);
          deletedCount += deleted;
          
          // Delete the tag set itself
          await redis.del(tagKey);
        }
      }
      
      return deletedCount;
    } catch (error) {
      console.error('Cache invalidateByTags error:', error);
      return 0;
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      
      const deleted = await redis.del(...keys);
      return deleted;
    } catch (error) {
      console.error('Cache invalidateByPattern error:', error);
      return 0;
    }
  }

  /**
   * Clear all cache in namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    const pattern = this.buildCacheKey('*', namespace);
    return this.invalidateByPattern(pattern);
  }

  /**
   * Clear all cache
   */
  async clearAll(): Promise<boolean> {
    try {
      await redis.flushdb();
      return true;
    } catch (error) {
      console.error('Cache clearAll error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      size: 0,
      memory: 0,
    };
  }

  /**
   * Get cache size information
   */
  async getCacheInfo(): Promise<{
    totalKeys: number;
    memoryUsed: number;
    hitRate: number;
    stats: CacheStats;
  }> {
    try {
      const info = await redis.info('memory');
      const dbSize = await redis.dbsize();
      
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsed = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      
      const totalRequests = this.stats.hits + this.stats.misses;
      const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
      
      return {
        totalKeys: dbSize,
        memoryUsed,
        hitRate,
        stats: this.getStats(),
      };
    } catch (error) {
      console.error('Cache getCacheInfo error:', error);
      return {
        totalKeys: 0,
        memoryUsed: 0,
        hitRate: 0,
        stats: this.getStats(),
      };
    }
  }

  /**
   * Warm cache with data
   */
  async warmCache(data: Array<{ key: string; value: any; options?: CacheOptions }>): Promise<number> {
    try {
      let successCount = 0;
      
      // Use pipeline for better performance
      const pipeline = redis.pipeline();
      
      for (const item of data) {
        const fullKey = this.buildCacheKey(item.key, item.options?.namespace);
        const serialized = serializeForCache(item.value);
        const ttl = item.options?.ttl || this.defaultTTL;
        
        pipeline.setex(fullKey, ttl, serialized);
        successCount++;
      }
      
      await pipeline.exec();
      return successCount;
    } catch (error) {
      console.error('Cache warmCache error:', error);
      return 0;
    }
  }

  // Private helper methods

  private buildCacheKey(key: string, namespace?: string): string {
    const prefix = namespace || 'default';
    return `${prefix}:${key}`;
  }

  private buildTagKey(tag: string): string {
    return `tags:${tag}`;
  }

  private buildVersionKey(key: string, namespace?: string): string {
    return `${this.buildCacheKey(key, namespace)}:version`;
  }

  private async addTagAssociations(key: string, tags: string[], ttl: number): Promise<void> {
    const pipeline = redis.pipeline();
    
    for (const tag of tags) {
      const tagKey = this.buildTagKey(tag);
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, ttl + 60); // Tag expires slightly after the cached data
    }
    
    await pipeline.exec();
  }

  private async initializeStatsTracking(): Promise<void> {
    // Periodically update cache size statistics
    setInterval(async () => {
      try {
        const info = await this.getCacheInfo();
        this.stats.size = info.totalKeys;
        this.stats.memory = info.memoryUsed;
      } catch (error) {
        console.error('Error updating cache stats:', error);
      }
    }, 30000); // Update every 30 seconds
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Predefined cache configurations for common use cases
export const CacheConfigs = {
  // User sessions - 8 hours
  userSession: { ttl: 28800, namespace: 'session', tags: ['user', 'session'] },
  
  // Course data - 1 hour, refreshed on updates
  courseData: { ttl: 3600, namespace: 'course', tags: ['course', 'content'] },
  
  // API responses - 15 minutes
  apiResponse: { ttl: 900, namespace: 'api', tags: ['api'] },
  
  // Static assets - 24 hours
  staticAssets: { ttl: 86400, namespace: 'assets', tags: ['assets', 'static'] },
  
  // Search results - 30 minutes
  searchResults: { ttl: 1800, namespace: 'search', tags: ['search'] },
  
  // User recommendations - 2 hours
  recommendations: { ttl: 7200, namespace: 'recommendations', tags: ['user', 'recommendations'] },
  
  // System settings - 1 hour
  systemSettings: { ttl: 3600, namespace: 'system', tags: ['system', 'settings'] },
  
  // Analytics data - 5 minutes
  analytics: { ttl: 300, namespace: 'analytics', tags: ['analytics'] },
} as const;