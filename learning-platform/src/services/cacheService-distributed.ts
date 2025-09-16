import { RedisClusterManager, getRedisCluster } from '../lib/redis-cluster';
import { CloudflareCDNManager, getCDNManager } from '../lib/cdn-manager';
import { EventEmitter } from 'events';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  tags: string[];
  version: string;
}

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
  version?: string;
  skipCDN?: boolean;
  compressionLevel?: number;
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  memory_usage: number;
  operations: number;
  last_reset: Date;
}

export class DistributedCacheService extends EventEmitter {
  private redis: RedisClusterManager;
  private cdn: CloudflareCDNManager;
  private stats: CacheStats;
  private defaultTTL = 3600; // 1 hour
  private compressionThreshold = 1024; // 1KB
  private namespace = 'lms';

  constructor() {
    super();
    this.redis = getRedisCluster();
    this.cdn = getCDNManager();
    this.stats = this.initializeStats();
    this.setupEventHandlers();
  }

  private initializeStats(): CacheStats {
    return {
      hits: 0,
      misses: 0,
      evictions: 0,
      memory_usage: 0,
      operations: 0,
      last_reset: new Date(),
    };
  }

  private setupEventHandlers(): void {
    this.redis.on('error', (error) => {
      console.error('Redis cluster error:', error);
      this.emit('cache_error', error);
    });

    this.redis.on('node_failed', (address) => {
      console.warn(`Redis node failed: ${address}`);
      this.emit('node_failed', address);
    });

    this.redis.on('connection_failed', () => {
      console.error('Redis cluster connection failed');
      this.emit('connection_failed');
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.redis.connect();
      console.log('Distributed cache service initialized');
    } catch (error) {
      console.error('Failed to initialize cache service:', error);
      throw error;
    }
  }

  // Core cache operations
  async get<T>(key: string, options?: { namespace?: string }): Promise<T | null> {
    const fullKey = this.buildKey(key, options?.namespace);

    try {
      const cached = await this.redis.get(fullKey);

      if (!cached) {
        this.stats.misses++;
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check if entry has expired
      if (this.isExpired(entry)) {
        await this.redis.del(fullKey);
        this.stats.misses++;
        this.stats.evictions++;
        return null;
      }

      this.stats.hits++;
      this.stats.operations++;

      return entry.data;
    } catch (error) {
      console.error('Cache get error:', error);
      this.stats.misses++;
      return null;
    }
  }

  async set<T>(
    key: string,
    data: T,
    options?: CacheOptions
  ): Promise<void> {
    const fullKey = this.buildKey(key, options?.namespace);
    const ttl = options?.ttl || this.defaultTTL;

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      tags: options?.tags || [],
      version: options?.version || '1.0.0',
    };

    try {
      const serialized = JSON.stringify(entry);
      await this.redis.set(fullKey, serialized, ttl);

      // Add to tag indexes for invalidation
      if (options?.tags) {
        await this.addToTagIndexes(fullKey, options.tags);
      }

      this.stats.operations++;

      // Optionally trigger CDN cache warming for static content
      if (!options?.skipCDN && this.isStaticContent(key)) {
        this.warmCDNCache(key, data).catch((error) => {
          console.warn('CDN cache warming failed:', error);
        });
      }

      this.emit('cache_set', { key: fullKey, size: serialized.length });
    } catch (error) {
      console.error('Cache set error:', error);
      throw error;
    }
  }

  async mget<T>(keys: string[], options?: { namespace?: string }): Promise<(T | null)[]> {
    const fullKeys = keys.map(key => this.buildKey(key, options?.namespace));

    try {
      const results = await this.redis.mget(fullKeys);
      const parsed: (T | null)[] = [];

      for (let i = 0; i < results.length; i++) {
        const cached = results[i];

        if (!cached) {
          parsed.push(null);
          this.stats.misses++;
          continue;
        }

        try {
          const entry: CacheEntry<T> = JSON.parse(cached);

          if (this.isExpired(entry)) {
            parsed.push(null);
            // Queue for deletion
            this.redis.del(fullKeys[i]).catch(() => {});
            this.stats.misses++;
            this.stats.evictions++;
          } else {
            parsed.push(entry.data);
            this.stats.hits++;
          }
        } catch (parseError) {
          parsed.push(null);
          this.stats.misses++;
        }
      }

      this.stats.operations++;
      return parsed;
    } catch (error) {
      console.error('Cache mget error:', error);
      return keys.map(() => null);
    }
  }

  async mset<T>(
    keyValuePairs: Record<string, T>,
    options?: CacheOptions
  ): Promise<void> {
    const ttl = options?.ttl || this.defaultTTL;
    const serializedPairs: Record<string, string> = {};
    const tagOperations: Promise<void>[] = [];

    for (const [key, data] of Object.entries(keyValuePairs)) {
      const fullKey = this.buildKey(key, options?.namespace);
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl,
        tags: options?.tags || [],
        version: options?.version || '1.0.0',
      };

      serializedPairs[fullKey] = JSON.stringify(entry);

      // Add to tag indexes
      if (options?.tags) {
        tagOperations.push(this.addToTagIndexes(fullKey, options.tags));
      }
    }

    try {
      await this.redis.mset(serializedPairs);

      // Set TTL for each key
      const ttlOperations = Object.keys(serializedPairs).map(fullKey =>
        this.redis.expire(fullKey, ttl)
      );

      await Promise.all([...ttlOperations, ...tagOperations]);

      this.stats.operations++;
    } catch (error) {
      console.error('Cache mset error:', error);
      throw error;
    }
  }

  async del(keys: string | string[], options?: { namespace?: string }): Promise<number> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const fullKeys = keyArray.map(key => this.buildKey(key, options?.namespace));

    try {
      const deleted = await this.redis.del(fullKeys);

      // Remove from tag indexes
      await this.removeFromTagIndexes(fullKeys);

      // Purge from CDN
      await this.purgeCDNCache(keyArray);

      this.stats.operations++;
      this.emit('cache_invalidated', { keys: fullKeys, count: deleted });

      return deleted;
    } catch (error) {
      console.error('Cache delete error:', error);
      return 0;
    }
  }

  // Tag-based invalidation
  async invalidateByTags(tags: string[]): Promise<number> {
    let totalDeleted = 0;

    for (const tag of tags) {
      try {
        const tagKey = this.buildTagKey(tag);
        const keys = await this.redis.get(tagKey);

        if (keys) {
          const keyList: string[] = JSON.parse(keys);
          const deleted = await this.redis.del(keyList);
          totalDeleted += deleted;

          // Remove tag index
          await this.redis.del(tagKey);

          // Purge from CDN
          const originalKeys = keyList.map(key => this.extractOriginalKey(key));
          await this.purgeCDNCache(originalKeys);
        }
      } catch (error) {
        console.error(`Failed to invalidate tag ${tag}:`, error);
      }
    }

    this.stats.operations++;
    this.emit('tags_invalidated', { tags, count: totalDeleted });

    return totalDeleted;
  }

  // Session management with Redis cluster
  async setSession(sessionId: string, sessionData: any, ttl = 86400): Promise<void> {
    const sessionKey = this.buildKey(`session:${sessionId}`, 'sessions');

    try {
      await this.set(sessionKey, sessionData, {
        ttl,
        namespace: 'sessions',
        skipCDN: true, // Sessions should never be cached in CDN
      });
    } catch (error) {
      console.error('Failed to set session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<any | null> {
    const sessionKey = this.buildKey(`session:${sessionId}`, 'sessions');

    try {
      return await this.get(sessionKey, { namespace: 'sessions' });
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    const sessionKey = this.buildKey(`session:${sessionId}`, 'sessions');

    try {
      await this.del(sessionKey, { namespace: 'sessions' });
    } catch (error) {
      console.error('Failed to destroy session:', error);
    }
  }

  // Cache analytics and monitoring
  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.getClusterInfo();
      const memoryUsage = this.parseMemoryUsage(info);

      return {
        ...this.stats,
        memory_usage: memoryUsage,
      };
    } catch (error) {
      console.error('Failed to get cache stats:', error);
      return this.stats;
    }
  }

  async resetStats(): Promise<void> {
    this.stats = this.initializeStats();
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const testKey = 'health_check';
      const testValue = Date.now().toString();

      await this.redis.set(testKey, testValue, 10);
      const retrieved = await this.redis.get(testKey);
      await this.redis.del(testKey);

      return retrieved === testValue;
    } catch (error) {
      console.error('Cache health check failed:', error);
      return false;
    }
  }

  // Performance optimization methods
  async preloadPopularContent(contentMap: Record<string, any>): Promise<void> {
    const operations: Promise<void>[] = [];

    for (const [key, data] of Object.entries(contentMap)) {
      operations.push(
        this.set(key, data, {
          ttl: 86400, // 24 hours for popular content
          tags: ['popular', 'preloaded'],
        })
      );
    }

    await Promise.allSettled(operations);
    console.log(`Preloaded ${Object.keys(contentMap).length} popular content items`);
  }

  async warmupCache(keys: string[]): Promise<void> {
    // This would typically fetch from database and cache
    console.log(`Cache warmup requested for ${keys.length} keys`);
    // Implementation depends on your data sources
  }

  // Compression helpers
  private shouldCompress(data: string): boolean {
    return data.length > this.compressionThreshold;
  }

  // Utility methods
  private buildKey(key: string, namespace?: string): string {
    const ns = namespace || this.namespace;
    return `${ns}:${key}`;
  }

  private buildTagKey(tag: string): string {
    return `${this.namespace}:tags:${tag}`;
  }

  private extractOriginalKey(fullKey: string): string {
    return fullKey.replace(`${this.namespace}:`, '');
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.timestamp + (entry.ttl * 1000);
  }

  private isStaticContent(key: string): boolean {
    return key.includes('static') || key.includes('asset') || key.includes('video');
  }

  private async addToTagIndexes(key: string, tags: string[]): Promise<void> {
    const operations: Promise<void>[] = [];

    for (const tag of tags) {
      operations.push(this.addKeyToTag(key, tag));
    }

    await Promise.allSettled(operations);
  }

  private async addKeyToTag(key: string, tag: string): Promise<void> {
    const tagKey = this.buildTagKey(tag);

    try {
      const existing = await this.redis.get(tagKey);
      const keys: string[] = existing ? JSON.parse(existing) : [];

      if (!keys.includes(key)) {
        keys.push(key);
        await this.redis.set(tagKey, JSON.stringify(keys), 86400); // 24 hours
      }
    } catch (error) {
      console.error(`Failed to add key to tag ${tag}:`, error);
    }
  }

  private async removeFromTagIndexes(keys: string[]): Promise<void> {
    // This would involve removing keys from all associated tag indexes
    // Implementation would scan tag indexes and remove keys
  }

  private async warmCDNCache(key: string, data: any): Promise<void> {
    if (this.isStaticContent(key)) {
      // Implementation would depend on your CDN warming strategy
      console.log(`CDN cache warming for key: ${key}`);
    }
  }

  private async purgeCDNCache(keys: string[]): Promise<void> {
    try {
      const urls = keys
        .filter(key => this.isStaticContent(key))
        .map(key => this.keyToURL(key));

      if (urls.length > 0) {
        await this.cdn.purgeByUrls(urls);
      }
    } catch (error) {
      console.warn('CDN purge failed:', error);
    }
  }

  private keyToURL(key: string): string {
    // Convert cache key to URL for CDN purging
    return `https://your-domain.com/${key}`;
  }

  private parseMemoryUsage(info: string): number {
    // Parse Redis cluster info to extract memory usage
    const match = info.match(/used_memory:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async shutdown(): Promise<void> {
    try {
      await this.redis.disconnect();
      console.log('Distributed cache service shutdown complete');
    } catch (error) {
      console.error('Error during cache service shutdown:', error);
    }
  }
}

// Factory function
export function createDistributedCacheService(): DistributedCacheService {
  return new DistributedCacheService();
}

// Singleton instance
let cacheServiceInstance: DistributedCacheService | null = null;

export function getDistributedCacheService(): DistributedCacheService {
  if (!cacheServiceInstance) {
    cacheServiceInstance = createDistributedCacheService();
  }
  return cacheServiceInstance;
}