import { cacheService, CacheOptions, CacheStats } from '@/services/cacheService';
import { redis } from '@/lib/redis';
import { createHash } from 'crypto';

/**
 * Cache key generation utilities
 */
export class CacheKeyGenerator {
  static user(userId: string, suffix?: string): string {
    return suffix ? `user:${userId}:${suffix}` : `user:${userId}`;
  }

  static course(courseId: string, suffix?: string): string {
    return suffix ? `course:${courseId}:${suffix}` : `course:${courseId}`;
  }

  static lesson(lessonId: string, suffix?: string): string {
    return suffix ? `lesson:${lessonId}:${suffix}` : `lesson:${lessonId}`;
  }

  static progress(userId: string, courseId: string): string {
    return `progress:${userId}:${courseId}`;
  }

  static search(query: string, filters?: Record<string, any>): string {
    const filterStr = filters ? JSON.stringify(filters) : '';
    const combined = `${query}:${filterStr}`;
    return `search:${createHash('md5').update(combined).digest('hex')}`;
  }

  static analytics(metric: string, timeframe: string, dimensions?: string[]): string {
    const dimStr = dimensions ? dimensions.sort().join(',') : '';
    return `analytics:${metric}:${timeframe}:${createHash('md5').update(dimStr).digest('hex')}`;
  }

  static recommendations(userId: string, type: string): string {
    return `recommendations:${type}:${userId}`;
  }

  static settings(scope: string, identifier?: string): string {
    return identifier ? `settings:${scope}:${identifier}` : `settings:${scope}`;
  }

  static certificate(userId: string, courseId: string): string {
    return `certificate:${userId}:${courseId}`;
  }

  static leaderboard(scope: string, period?: string): string {
    return period ? `leaderboard:${scope}:${period}` : `leaderboard:${scope}`;
  }
}

/**
 * Cache warming utilities
 */
export class CacheWarmer {
  /**
   * Warm user-specific cache data
   */
  static async warmUserCache(userId: string): Promise<void> {
    try {
      const warmingTasks = [
        // User profile
        this.warmUserProfile(userId),
        // User courses
        this.warmUserCourses(userId),
        // User progress
        this.warmUserProgress(userId),
        // User recommendations
        this.warmUserRecommendations(userId),
      ];

      await Promise.allSettled(warmingTasks);
    } catch (error) {
      console.error('Error warming user cache:', error);
    }
  }

  /**
   * Warm course-specific cache data
   */
  static async warmCourseCache(courseId: string): Promise<void> {
    try {
      const warmingTasks = [
        // Course details
        this.warmCourseDetails(courseId),
        // Course lessons
        this.warmCourseLessons(courseId),
        // Course analytics
        this.warmCourseAnalytics(courseId),
      ];

      await Promise.allSettled(warmingTasks);
    } catch (error) {
      console.error('Error warming course cache:', error);
    }
  }

  /**
   * Warm system-wide cache data
   */
  static async warmSystemCache(): Promise<void> {
    try {
      const warmingTasks = [
        // Popular courses
        this.warmPopularCourses(),
        // System settings
        this.warmSystemSettings(),
        // Global leaderboards
        this.warmGlobalLeaderboards(),
      ];

      await Promise.allSettled(warmingTasks);
    } catch (error) {
      console.error('Error warming system cache:', error);
    }
  }

  private static async warmUserProfile(userId: string): Promise<void> {
    // Implementation would fetch and cache user profile data
    console.log(`Warming user profile cache for user: ${userId}`);
  }

  private static async warmUserCourses(userId: string): Promise<void> {
    // Implementation would fetch and cache user's enrolled courses
    console.log(`Warming user courses cache for user: ${userId}`);
  }

  private static async warmUserProgress(userId: string): Promise<void> {
    // Implementation would fetch and cache user's progress data
    console.log(`Warming user progress cache for user: ${userId}`);
  }

  private static async warmUserRecommendations(userId: string): Promise<void> {
    // Implementation would fetch and cache user recommendations
    console.log(`Warming user recommendations cache for user: ${userId}`);
  }

  private static async warmCourseDetails(courseId: string): Promise<void> {
    // Implementation would fetch and cache course details
    console.log(`Warming course details cache for course: ${courseId}`);
  }

  private static async warmCourseLessons(courseId: string): Promise<void> {
    // Implementation would fetch and cache course lessons
    console.log(`Warming course lessons cache for course: ${courseId}`);
  }

  private static async warmCourseAnalytics(courseId: string): Promise<void> {
    // Implementation would fetch and cache course analytics
    console.log(`Warming course analytics cache for course: ${courseId}`);
  }

  private static async warmPopularCourses(): Promise<void> {
    // Implementation would fetch and cache popular courses
    console.log('Warming popular courses cache');
  }

  private static async warmSystemSettings(): Promise<void> {
    // Implementation would fetch and cache system settings
    console.log('Warming system settings cache');
  }

  private static async warmGlobalLeaderboards(): Promise<void> {
    // Implementation would fetch and cache global leaderboards
    console.log('Warming global leaderboards cache');
  }
}

/**
 * Cache statistics and monitoring utilities
 */
export class CacheMonitor {
  /**
   * Get comprehensive cache statistics
   */
  static async getComprehensiveStats(): Promise<{
    general: CacheStats;
    redis: any;
    memory: any;
    performance: any;
  }> {
    try {
      const [generalStats, redisInfo, memoryInfo, performanceMetrics] = await Promise.all([
        cacheService.getStats(),
        this.getRedisStats(),
        this.getMemoryStats(),
        this.getPerformanceMetrics(),
      ]);

      return {
        general: generalStats,
        redis: redisInfo,
        memory: memoryInfo,
        performance: performanceMetrics,
      };
    } catch (error) {
      console.error('Error getting comprehensive cache stats:', error);
      return {
        general: cacheService.getStats(),
        redis: {},
        memory: {},
        performance: {},
      };
    }
  }

  /**
   * Monitor cache health
   */
  static async checkCacheHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    issues: string[];
    metrics: Record<string, number>;
  }> {
    const issues: string[] = [];
    const metrics: Record<string, number> = {};
    
    try {
      // Check Redis connection
      const ping = await redis.ping();
      if (ping !== 'PONG') {
        issues.push('Redis connection issue');
      }

      // Check memory usage
      const info = await redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsed = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      const memoryMaxMatch = info.match(/maxmemory:(\d+)/);
      const memoryMax = memoryMaxMatch ? parseInt(memoryMaxMatch[1]) : 0;
      
      metrics.memoryUsed = memoryUsed;
      metrics.memoryMax = memoryMax;
      
      if (memoryMax > 0) {
        const memoryUsagePercent = (memoryUsed / memoryMax) * 100;
        metrics.memoryUsagePercent = memoryUsagePercent;
        
        if (memoryUsagePercent > 90) {
          issues.push('High memory usage (>90%)');
        } else if (memoryUsagePercent > 80) {
          issues.push('Elevated memory usage (>80%)');
        }
      }

      // Check cache hit rate
      const stats = cacheService.getStats();
      const totalRequests = stats.hits + stats.misses;
      const hitRate = totalRequests > 0 ? stats.hits / totalRequests : 0;
      metrics.hitRate = hitRate;
      
      if (hitRate < 0.5) {
        issues.push('Low cache hit rate (<50%)');
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (issues.length > 0) {
        const criticalIssues = issues.filter(issue => 
          issue.includes('connection') || issue.includes('High memory')
        );
        status = criticalIssues.length > 0 ? 'critical' : 'degraded';
      }

      return { status, issues, metrics };
    } catch (error) {
      console.error('Cache health check error:', error);
      return {
        status: 'critical',
        issues: ['Cache health check failed'],
        metrics: {},
      };
    }
  }

  /**
   * Get cache usage by namespace
   */
  static async getCacheUsageByNamespace(): Promise<Record<string, {
    keys: number;
    estimatedSize: number;
  }>> {
    try {
      const namespaces = ['user', 'course', 'api', 'session', 'search', 'analytics'];
      const usage: Record<string, { keys: number; estimatedSize: number }> = {};

      for (const namespace of namespaces) {
        const pattern = `${namespace}:*`;
        const keys = await redis.keys(pattern);
        
        // Estimate size by sampling a few keys
        let estimatedSize = 0;
        const sampleSize = Math.min(keys.length, 10);
        
        for (let i = 0; i < sampleSize; i++) {
          try {
            const memory = await redis.memory('usage', keys[i]);
            estimatedSize += memory || 0;
          } catch {
            // Ignore individual key errors
          }
        }
        
        // Extrapolate to total size
        if (sampleSize > 0) {
          estimatedSize = Math.round((estimatedSize / sampleSize) * keys.length);
        }

        usage[namespace] = {
          keys: keys.length,
          estimatedSize,
        };
      }

      return usage;
    } catch (error) {
      console.error('Error getting cache usage by namespace:', error);
      return {};
    }
  }

  private static async getRedisStats(): Promise<any> {
    try {
      const info = await redis.info();
      return this.parseRedisInfo(info);
    } catch (error) {
      console.error('Error getting Redis stats:', error);
      return {};
    }
  }

  private static async getMemoryStats(): Promise<any> {
    try {
      const info = await redis.info('memory');
      return this.parseRedisInfo(info);
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return {};
    }
  }

  private static async getPerformanceMetrics(): Promise<any> {
    try {
      const stats = await redis.info('stats');
      return this.parseRedisInfo(stats);
    } catch (error) {
      console.error('Error getting performance metrics:', error);
      return {};
    }
  }

  private static parseRedisInfo(info: string): Record<string, any> {
    const parsed: Record<string, any> = {};
    
    info.split('\r\n').forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        parsed[key] = isNaN(Number(value)) ? value : Number(value);
      }
    });

    return parsed;
  }
}

/**
 * Cache optimization utilities
 */
export class CacheOptimizer {
  /**
   * Optimize cache by removing stale or low-value entries
   */
  static async optimizeCache(): Promise<{
    removedKeys: number;
    freedMemory: number;
  }> {
    let removedKeys = 0;
    let freedMemory = 0;

    try {
      // Get all keys
      const allKeys = await redis.keys('*');
      
      // Check each key for optimization opportunities
      for (const key of allKeys) {
        const shouldRemove = await this.shouldRemoveKey(key);
        
        if (shouldRemove) {
          try {
            const keyMemory = await redis.memory('usage', key);
            await redis.del(key);
            removedKeys++;
            freedMemory += keyMemory || 0;
          } catch {
            // Ignore individual key errors
          }
        }
      }

      console.log(`Cache optimization complete: removed ${removedKeys} keys, freed ${freedMemory} bytes`);
      return { removedKeys, freedMemory };
    } catch (error) {
      console.error('Cache optimization error:', error);
      return { removedKeys: 0, freedMemory: 0 };
    }
  }

  /**
   * Compact cache by re-encoding data
   */
  static async compactCache(namespace?: string): Promise<void> {
    try {
      const pattern = namespace ? `${namespace}:*` : '*';
      const keys = await redis.keys(pattern);
      
      console.log(`Compacting ${keys.length} keys${namespace ? ` in namespace ${namespace}` : ''}`);
      
      // This would implement cache compaction logic
      // For example, re-encoding data in more efficient format
      
    } catch (error) {
      console.error('Cache compaction error:', error);
    }
  }

  private static async shouldRemoveKey(key: string): Promise<boolean> {
    try {
      // Check if key is expired
      const ttl = await redis.ttl(key);
      if (ttl === -2) {
        return true; // Key has already expired
      }

      // Check if key is rarely accessed (would need tracking)
      // This is a simplified example
      
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Cache invalidation utilities
 */
export class CacheInvalidator {
  /**
   * Invalidate user-related cache
   */
  static async invalidateUserCache(userId: string): Promise<number> {
    const patterns = [
      CacheKeyGenerator.user(userId, '*'),
      CacheKeyGenerator.progress(userId, '*'),
      CacheKeyGenerator.recommendations(userId, '*'),
    ];

    let totalInvalidated = 0;
    for (const pattern of patterns) {
      totalInvalidated += await cacheService.invalidateByPattern(pattern);
    }

    return totalInvalidated;
  }

  /**
   * Invalidate course-related cache
   */
  static async invalidateCourseCache(courseId: string): Promise<number> {
    const patterns = [
      CacheKeyGenerator.course(courseId, '*'),
      `progress:*:${courseId}`,
      'search:*', // Course updates might affect search results
    ];

    let totalInvalidated = 0;
    for (const pattern of patterns) {
      totalInvalidated += await cacheService.invalidateByPattern(pattern);
    }

    // Also invalidate by tags
    totalInvalidated += await cacheService.invalidateByTags(['course', 'content']);

    return totalInvalidated;
  }

  /**
   * Invalidate search cache
   */
  static async invalidateSearchCache(): Promise<number> {
    return await cacheService.invalidateByTags(['search']);
  }

  /**
   * Invalidate analytics cache
   */
  static async invalidateAnalyticsCache(): Promise<number> {
    return await cacheService.invalidateByTags(['analytics']);
  }
}

/**
 * Cache utilities for common operations
 */
export const CacheUtils = {
  // Key generators
  keys: CacheKeyGenerator,
  
  // Cache warming
  warm: CacheWarmer,
  
  // Monitoring and statistics
  monitor: CacheMonitor,
  
  // Optimization
  optimize: CacheOptimizer,
  
  // Invalidation
  invalidate: CacheInvalidator,
  
  /**
   * Batch cache operations
   */
  async batchSet(items: Array<{ key: string; value: any; options?: CacheOptions }>): Promise<number> {
    return await cacheService.warmCache(items);
  },

  /**
   * Batch cache retrieval
   */
  async batchGet<T>(keys: string[], namespace?: string): Promise<Record<string, T | null>> {
    const results: Record<string, T | null> = {};
    
    await Promise.all(
      keys.map(async (key) => {
        results[key] = await cacheService.get<T>(key, { namespace });
      })
    );

    return results;
  },

  /**
   * Cache with fallback
   */
  async getWithFallback<T>(
    key: string, 
    fallbackFn: () => Promise<T>, 
    options?: CacheOptions
  ): Promise<T> {
    return await cacheService.getOrSet(key, fallbackFn, options);
  },
};