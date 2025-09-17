// Advanced Query Optimization and Caching System
// Provides intelligent query optimization, caching, and monitoring

import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';

interface CacheConfig {
  defaultTTL: number;
  maxMemoryUsage: number;
  compressionEnabled: boolean;
  prefixStrategy: 'hash' | 'prefix' | 'none';
  statsEnabled: boolean;
}

interface QueryPattern {
  pattern: string;
  frequency: number;
  averageExecutionTime: number;
  cacheHitRatio: number;
  optimalStrategy: 'cache' | 'index' | 'materialize' | 'partition';
  lastAnalyzed: Date;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
  memoryUsage: number;
  evictions: number;
  compressionRatio: number;
}

interface QueryOptimizationRule {
  id: string;
  name: string;
  pattern: RegExp;
  action: 'cache' | 'transform' | 'redirect' | 'deny';
  ttl?: number;
  transform?: (query: string) => string;
  priority: number;
  enabled: boolean;
}

class QueryOptimizer {
  private redis: Redis;
  private prisma: PrismaClient;
  private config: CacheConfig;
  private queryPatterns: Map<string, QueryPattern> = new Map();
  private cacheStats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRatio: 0,
    memoryUsage: 0,
    evictions: 0,
    compressionRatio: 0
  };

  private optimizationRules: QueryOptimizationRule[] = [
    {
      id: 'course-catalog',
      name: 'Course Catalog Queries',
      pattern: /SELECT.*FROM.*Course.*WHERE.*published.*=.*true/i,
      action: 'cache',
      ttl: 300, // 5 minutes
      priority: 1,
      enabled: true
    },
    {
      id: 'user-profile',
      name: 'User Profile Queries',
      pattern: /SELECT.*FROM.*User.*WHERE.*id.*=.*/i,
      action: 'cache',
      ttl: 600, // 10 minutes
      priority: 2,
      enabled: true
    },
    {
      id: 'enrollment-stats',
      name: 'Enrollment Statistics',
      pattern: /SELECT.*COUNT.*FROM.*Enrollment/i,
      action: 'cache',
      ttl: 180, // 3 minutes
      priority: 3,
      enabled: true
    },
    {
      id: 'progress-tracking',
      name: 'Progress Tracking Queries',
      pattern: /SELECT.*FROM.*Progress.*WHERE.*userId/i,
      action: 'cache',
      ttl: 60, // 1 minute
      priority: 4,
      enabled: true
    },
    {
      id: 'analytics-heavy',
      name: 'Heavy Analytics Queries',
      pattern: /SELECT.*AVG|SUM|COUNT.*FROM.*(Analytics|Enrollment).*GROUP BY/i,
      action: 'redirect',
      priority: 5,
      enabled: true
    }
  ];

  constructor(
    redisUrl: string,
    prismaClient: PrismaClient,
    config: Partial<CacheConfig> = {}
  ) {
    this.redis = new Redis(redisUrl, {
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      compression: 'gzip'
    });

    this.prisma = prismaClient;
    this.config = {
      defaultTTL: 300, // 5 minutes
      maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
      compressionEnabled: true,
      prefixStrategy: 'hash',
      statsEnabled: true,
      ...config
    };

    this.startBackgroundTasks();
  }

  // Intelligent query execution with optimization
  async executeOptimizedQuery<T>(
    queryKey: string,
    queryFn: () => Promise<T>,
    options: {
      ttl?: number;
      tags?: string[];
      priority?: 'low' | 'medium' | 'high';
      bypassCache?: boolean;
      compress?: boolean;
    } = {}
  ): Promise<T> {
    const {
      ttl = this.config.defaultTTL,
      tags = [],
      priority = 'medium',
      bypassCache = false,
      compress = this.config.compressionEnabled
    } = options;

    // Apply optimization rules
    const optimizedKey = this.applyOptimizationRules(queryKey);
    if (!optimizedKey) {
      throw new Error('Query denied by optimization rules');
    }

    const cacheKey = this.generateCacheKey(optimizedKey, tags);
    const startTime = Date.now();

    // Try cache first (unless bypassed)
    if (!bypassCache) {
      try {
        const cached = await this.getCached<T>(cacheKey);
        if (cached !== null) {
          this.recordCacheHit(queryKey, Date.now() - startTime);
          return cached;
        }
      } catch (error) {
        console.warn('Cache get failed:', error);
      }
    }

    // Execute query
    try {
      const result = await queryFn();
      const executionTime = Date.now() - startTime;

      // Cache the result
      if (!bypassCache) {
        this.setCached(cacheKey, result, { ttl, compress, tags })
          .catch(error => console.warn('Cache set failed:', error));
      }

      // Record metrics
      this.recordCacheMiss(queryKey, executionTime);
      this.updateQueryPattern(queryKey, executionTime);

      return result;
    } catch (error) {
      this.recordQueryError(queryKey, error as Error);
      throw error;
    }
  }

  // Multi-level caching with different strategies
  async executeWithMultiLevelCache<T>(
    queryKey: string,
    queryFn: () => Promise<T>,
    levels: {
      l1: { ttl: number; tags?: string[] };
      l2?: { ttl: number; tags?: string[] };
      l3?: { ttl: number; tags?: string[] };
    }
  ): Promise<T> {
    // L1 Cache (fastest, shortest TTL)
    try {
      const l1Key = `l1:${queryKey}`;
      const l1Result = await this.getCached<T>(l1Key);
      if (l1Result !== null) {
        return l1Result;
      }
    } catch (error) {
      console.warn('L1 cache failed:', error);
    }

    // L2 Cache (medium speed, medium TTL)
    if (levels.l2) {
      try {
        const l2Key = `l2:${queryKey}`;
        const l2Result = await this.getCached<T>(l2Key);
        if (l2Result !== null) {
          // Backfill L1 cache
          this.setCached(`l1:${queryKey}`, l2Result, levels.l1)
            .catch(error => console.warn('L1 backfill failed:', error));
          return l2Result;
        }
      } catch (error) {
        console.warn('L2 cache failed:', error);
      }
    }

    // L3 Cache (slowest, longest TTL)
    if (levels.l3) {
      try {
        const l3Key = `l3:${queryKey}`;
        const l3Result = await this.getCached<T>(l3Key);
        if (l3Result !== null) {
          // Backfill L2 and L1 caches
          if (levels.l2) {
            this.setCached(`l2:${queryKey}`, l3Result, levels.l2)
              .catch(error => console.warn('L2 backfill failed:', error));
          }
          this.setCached(`l1:${queryKey}`, l3Result, levels.l1)
            .catch(error => console.warn('L1 backfill failed:', error));
          return l3Result;
        }
      } catch (error) {
        console.warn('L3 cache failed:', error);
      }
    }

    // Execute query and populate all cache levels
    const result = await queryFn();

    // Populate caches in parallel
    const cachePromises = [
      this.setCached(`l1:${queryKey}`, result, levels.l1)
    ];

    if (levels.l2) {
      cachePromises.push(
        this.setCached(`l2:${queryKey}`, result, levels.l2)
      );
    }

    if (levels.l3) {
      cachePromises.push(
        this.setCached(`l3:${queryKey}`, result, levels.l3)
      );
    }

    Promise.all(cachePromises)
      .catch(error => console.warn('Multi-level cache population failed:', error));

    return result;
  }

  // Batch query optimization
  async executeBatchOptimized<T>(
    queries: Array<{
      key: string;
      fn: () => Promise<T>;
      options?: { ttl?: number; tags?: string[] };
    }>
  ): Promise<T[]> {
    // Group queries by cache status
    const cachedResults = new Map<number, T>();
    const uncachedQueries: Array<{ index: number; key: string; fn: () => Promise<T>; options?: any }> = [];

    // Check cache for all queries
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const cacheKey = this.generateCacheKey(query.key, query.options?.tags);

      try {
        const cached = await this.getCached<T>(cacheKey);
        if (cached !== null) {
          cachedResults.set(i, cached);
        } else {
          uncachedQueries.push({ index: i, ...query });
        }
      } catch (error) {
        uncachedQueries.push({ index: i, ...query });
      }
    }

    // Execute uncached queries with controlled concurrency
    const concurrency = Math.min(uncachedQueries.length, 10);
    const uncachedResults = new Map<number, T>();

    for (let i = 0; i < uncachedQueries.length; i += concurrency) {
      const batch = uncachedQueries.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(async (query) => {
          const result = await query.fn();
          const cacheKey = this.generateCacheKey(query.key, query.options?.tags);

          // Cache the result
          this.setCached(cacheKey, result, query.options || {})
            .catch(error => console.warn('Batch cache failed:', error));

          return { index: query.index, result };
        })
      );

      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          uncachedResults.set(result.value.index, result.value.result);
        }
      });
    }

    // Combine results in original order
    const finalResults: T[] = [];
    for (let i = 0; i < queries.length; i++) {
      if (cachedResults.has(i)) {
        finalResults[i] = cachedResults.get(i)!;
      } else if (uncachedResults.has(i)) {
        finalResults[i] = uncachedResults.get(i)!;
      } else {
        throw new Error(`Failed to execute query at index ${i}`);
      }
    }

    return finalResults;
  }

  // Smart cache invalidation
  async invalidateByTags(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;

    let deletedCount = 0;

    for (const tag of tags) {
      const keys = await this.redis.keys(`*:tag:${tag}:*`);
      if (keys.length > 0) {
        deletedCount += await this.redis.del(...keys);
      }
    }

    return deletedCount;
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    const keys = await this.redis.keys(pattern);
    if (keys.length === 0) return 0;
    return await this.redis.del(...keys);
  }

  // Cache warming strategies
  async warmCache(
    queries: Array<{
      key: string;
      fn: () => Promise<any>;
      ttl?: number;
      schedule?: string; // Cron-like schedule
    }>
  ): Promise<void> {
    for (const query of queries) {
      try {
        const result = await query.fn();
        await this.setCached(
          this.generateCacheKey(query.key),
          result,
          { ttl: query.ttl || this.config.defaultTTL }
        );
      } catch (error) {
        console.error(`Cache warming failed for ${query.key}:`, error);
      }
    }
  }

  // Query analysis and optimization suggestions
  async analyzeQueries(timeframeHours: number = 24): Promise<{
    patterns: QueryPattern[];
    suggestions: string[];
    slowQueries: { query: string; avgTime: number; frequency: number }[];
  }> {
    const patterns = Array.from(this.queryPatterns.values())
      .filter(p => p.lastAnalyzed > new Date(Date.now() - timeframeHours * 60 * 60 * 1000))
      .sort((a, b) => b.frequency - a.frequency);

    const suggestions = this.generateOptimizationSuggestions(patterns);
    const slowQueries = patterns
      .filter(p => p.averageExecutionTime > 1000)
      .sort((a, b) => b.averageExecutionTime - a.averageExecutionTime)
      .slice(0, 10);

    return {
      patterns,
      suggestions,
      slowQueries: slowQueries.map(q => ({
        query: q.pattern,
        avgTime: q.averageExecutionTime,
        frequency: q.frequency
      }))
    };
  }

  // Private helper methods
  private applyOptimizationRules(queryKey: string): string | null {
    const enabledRules = this.optimizationRules
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of enabledRules) {
      if (rule.pattern.test(queryKey)) {
        switch (rule.action) {
          case 'deny':
            return null;
          case 'transform':
            return rule.transform ? rule.transform(queryKey) : queryKey;
          case 'cache':
          case 'redirect':
            return queryKey;
        }
      }
    }

    return queryKey;
  }

  private generateCacheKey(queryKey: string, tags?: string[]): string {
    let key = '';

    switch (this.config.prefixStrategy) {
      case 'hash':
        const hash = this.simpleHash(queryKey);
        key = `qc:${hash}`;
        break;
      case 'prefix':
        key = `query_cache:${queryKey.slice(0, 50)}`;
        break;
      default:
        key = queryKey;
    }

    if (tags && tags.length > 0) {
      key += `:tag:${tags.join(':')}`;
    }

    return key;
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (cached === null) return null;

      return JSON.parse(cached) as T;
    } catch (error) {
      console.warn('Cache get error:', error);
      return null;
    }
  }

  private async setCached<T>(
    key: string,
    value: T,
    options: { ttl?: number; compress?: boolean; tags?: string[] } = {}
  ): Promise<void> {
    const { ttl = this.config.defaultTTL, compress = false } = options;

    try {
      let serialized = JSON.stringify(value);

      if (compress && this.config.compressionEnabled) {
        // Compression would be implemented here
        // For now, we'll just store as-is
      }

      if (ttl > 0) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      console.warn('Cache set error:', error);
    }
  }

  private recordCacheHit(queryKey: string, responseTime: number): void {
    if (!this.config.statsEnabled) return;

    this.cacheStats.hits++;
    this.cacheStats.hitRatio = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses);
  }

  private recordCacheMiss(queryKey: string, responseTime: number): void {
    if (!this.config.statsEnabled) return;

    this.cacheStats.misses++;
    this.cacheStats.hitRatio = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses);
  }

  private recordQueryError(queryKey: string, error: Error): void {
    console.error(`Query error for ${queryKey}:`, error);
  }

  private updateQueryPattern(queryKey: string, executionTime: number): void {
    const existing = this.queryPatterns.get(queryKey);

    if (existing) {
      existing.frequency++;
      existing.averageExecutionTime =
        (existing.averageExecutionTime * (existing.frequency - 1) + executionTime) / existing.frequency;
      existing.lastAnalyzed = new Date();
    } else {
      this.queryPatterns.set(queryKey, {
        pattern: queryKey,
        frequency: 1,
        averageExecutionTime: executionTime,
        cacheHitRatio: 0,
        optimalStrategy: this.determineOptimalStrategy(executionTime),
        lastAnalyzed: new Date()
      });
    }
  }

  private determineOptimalStrategy(executionTime: number): 'cache' | 'index' | 'materialize' | 'partition' {
    if (executionTime < 100) return 'cache';
    if (executionTime < 1000) return 'index';
    if (executionTime < 5000) return 'materialize';
    return 'partition';
  }

  private generateOptimizationSuggestions(patterns: QueryPattern[]): string[] {
    const suggestions: string[] = [];

    patterns.forEach(pattern => {
      if (pattern.averageExecutionTime > 2000 && pattern.frequency > 10) {
        suggestions.push(`Consider creating an index for pattern: ${pattern.pattern}`);
      }
      if (pattern.cacheHitRatio < 0.5 && pattern.frequency > 50) {
        suggestions.push(`Low cache hit ratio for: ${pattern.pattern} - consider longer TTL`);
      }
      if (pattern.averageExecutionTime > 5000) {
        suggestions.push(`Very slow query detected: ${pattern.pattern} - consider partitioning`);
      }
    });

    return suggestions;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private startBackgroundTasks(): void {
    // Cleanup old patterns every hour
    setInterval(() => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const [key, pattern] of this.queryPatterns) {
        if (pattern.lastAnalyzed < cutoff) {
          this.queryPatterns.delete(key);
        }
      }
    }, 60 * 60 * 1000);

    // Update stats every minute
    if (this.config.statsEnabled) {
      setInterval(async () => {
        try {
          const info = await this.redis.info('memory');
          const memoryMatch = info.match(/used_memory:(\d+)/);
          if (memoryMatch) {
            this.cacheStats.memoryUsage = parseInt(memoryMatch[1]);
          }
        } catch (error) {
          console.warn('Failed to update cache stats:', error);
        }
      }, 60 * 1000);
    }
  }

  // Public API for getting stats
  getStats(): CacheStats & { patterns: number; rules: number } {
    return {
      ...this.cacheStats,
      patterns: this.queryPatterns.size,
      rules: this.optimizationRules.filter(r => r.enabled).length
    };
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Factory function
export function createQueryOptimizer(
  redisUrl: string,
  prismaClient: PrismaClient,
  config?: Partial<CacheConfig>
): QueryOptimizer {
  return new QueryOptimizer(redisUrl, prismaClient, config);
}

export default QueryOptimizer;