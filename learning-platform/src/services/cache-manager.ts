import { getRedisClient, RedisClusterClient } from '../lib/redis-cluster';
import { logger } from '../lib/logger';

export interface CacheConfig {
  prefix: string;
  ttl: number;
  tags?: string[];
  version?: number;
  warmingEnabled?: boolean;
  invalidationStrategy?: 'tag-based' | 'time-based' | 'event-driven' | 'dependency-based';
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  version: number;
  tags: string[];
  dependencies: string[];
}

export interface CacheWarmerConfig {
  enabled: boolean;
  parallelWorkers: number;
  batchSize: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface CacheInvalidationEvent {
  type: 'user-update' | 'course-update' | 'quiz-completion' | 'enrollment-change' | 'settings-change';
  entityId: string;
  affectedKeys?: string[];
  tags?: string[];
}

export class CacheManager {
  private redis: RedisClusterClient;
  private defaultTTL = 3600; // 1 hour
  private cacheVersions = new Map<string, number>();
  private warmingQueue: Array<() => Promise<void>> = [];
  private isWarmingInProgress = false;

  private readonly warmerConfig: CacheWarmerConfig = {
    enabled: true,
    parallelWorkers: 10,
    batchSize: 100,
    retryAttempts: 3,
    retryDelay: 1000
  };

  constructor() {
    this.redis = getRedisClient();
    this.initializeCacheVersions();
  }

  private initializeCacheVersions(): void {
    // Initialize cache versions for different data types
    this.cacheVersions.set('user', 1);
    this.cacheVersions.set('course', 1);
    this.cacheVersions.set('quiz', 1);
    this.cacheVersions.set('analytics', 1);
    this.cacheVersions.set('session', 1);
  }

  // Core Cache Operations
  async get<T>(key: string): Promise<T | null> {
    try {
      const cachedData = await this.redis.get(key);
      if (!cachedData) {
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cachedData);

      // Check if cache entry is still valid based on version
      const keyPrefix = this.extractPrefix(key);
      const currentVersion = this.cacheVersions.get(keyPrefix) || 1;

      if (entry.version < currentVersion) {
        await this.delete(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  async set<T>(
    key: string,
    data: T,
    config: Partial<CacheConfig> = {}
  ): Promise<boolean> {
    try {
      const keyPrefix = this.extractPrefix(key);
      const ttl = config.ttl || this.defaultTTL;
      const tags = config.tags || [keyPrefix];
      const version = this.cacheVersions.get(keyPrefix) || 1;

      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        version,
        tags,
        dependencies: []
      };

      await this.redis.set(key, JSON.stringify(entry), ttl);

      // Store tags for invalidation
      if (tags.length > 0) {
        await this.storeTags(key, tags);
      }

      return true;
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      await this.removeTags(key);
      return true;
    } catch (error) {
      logger.error(`Cache DELETE error for key ${key}:`, error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Cache EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  // Pattern-based Operations
  async deleteByPattern(pattern: string): Promise<number> {
    try {
      return await this.redis.deleteByPattern(pattern);
    } catch (error) {
      logger.error(`Cache DELETE_BY_PATTERN error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  async getByPattern(pattern: string): Promise<Record<string, any>> {
    try {
      const keys = await this.redis.keys(pattern);
      const values = await this.redis.mget(...keys);

      const result: Record<string, any> = {};
      keys.forEach((key, index) => {
        if (values[index]) {
          try {
            const entry: CacheEntry = JSON.parse(values[index]!);
            result[key] = entry.data;
          } catch (error) {
            logger.error(`Error parsing cached data for key ${key}:`, error);
          }
        }
      });

      return result;
    } catch (error) {
      logger.error(`Cache GET_BY_PATTERN error for pattern ${pattern}:`, error);
      return {};
    }
  }

  // Cache Warming
  async warmCache(): Promise<void> {
    if (!this.warmerConfig.enabled || this.isWarmingInProgress) {
      return;
    }

    this.isWarmingInProgress = true;
    logger.info('Starting cache warming process...');

    try {
      // Define warming strategies for different data types
      await this.warmUserProfiles();
      await this.warmCourseData();
      await this.warmQuizData();
      await this.warmAnalyticsData();

      logger.info('Cache warming completed successfully');
    } catch (error) {
      logger.error('Cache warming failed:', error);
    } finally {
      this.isWarmingInProgress = false;
    }
  }

  private async warmUserProfiles(): Promise<void> {
    // Implementation would fetch frequently accessed user profiles
    // and pre-load them into cache
    logger.info('Warming user profiles cache...');

    // Example implementation:
    const activeUserIds = await this.getActiveUserIds();
    const batchSize = this.warmerConfig.batchSize;

    for (let i = 0; i < activeUserIds.length; i += batchSize) {
      const batch = activeUserIds.slice(i, i + batchSize);
      const promises = batch.map(userId => this.warmUserProfile(userId));

      await Promise.allSettled(promises);

      // Small delay between batches to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async warmCourseData(): Promise<void> {
    logger.info('Warming course data cache...');

    const popularCourseIds = await this.getPopularCourseIds();
    const batchSize = this.warmerConfig.batchSize;

    for (let i = 0; i < popularCourseIds.length; i += batchSize) {
      const batch = popularCourseIds.slice(i, i + batchSize);
      const promises = batch.map(courseId => this.warmCourseData_single(courseId));

      await Promise.allSettled(promises);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async warmQuizData(): Promise<void> {
    logger.info('Warming quiz data cache...');

    const recentQuizIds = await this.getRecentQuizIds();
    const batchSize = this.warmerConfig.batchSize;

    for (let i = 0; i < recentQuizIds.length; i += batchSize) {
      const batch = recentQuizIds.slice(i, i + batchSize);
      const promises = batch.map(quizId => this.warmQuizData_single(quizId));

      await Promise.allSettled(promises);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async warmAnalyticsData(): Promise<void> {
    logger.info('Warming analytics data cache...');

    // Pre-calculate and cache common analytics queries
    const analyticsQueries = [
      'daily-active-users',
      'course-completion-rates',
      'popular-courses',
      'quiz-performance-stats'
    ];

    const promises = analyticsQueries.map(query => this.warmAnalyticsQuery(query));
    await Promise.allSettled(promises);
  }

  // Cache Invalidation
  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      let totalDeleted = 0;

      for (const tag of tags) {
        const keys = await this.getKeysByTag(tag);
        if (keys.length > 0) {
          const deleted = await this.redis.deleteByPattern(`{${keys.join(',')}}`);
          totalDeleted += deleted;

          // Remove tag associations
          await this.redis.del(`tag:${tag}`);
        }
      }

      logger.info(`Invalidated ${totalDeleted} cache entries for tags: ${tags.join(', ')}`);
      return totalDeleted;
    } catch (error) {
      logger.error(`Cache invalidation error for tags ${tags.join(', ')}:`, error);
      return 0;
    }
  }

  async invalidateByEvent(event: CacheInvalidationEvent): Promise<void> {
    try {
      logger.info(`Processing cache invalidation event: ${event.type} for entity ${event.entityId}`);

      const tagsToInvalidate = this.getTagsForEvent(event);

      if (tagsToInvalidate.length > 0) {
        await this.invalidateByTags(tagsToInvalidate);
      }

      // Handle specific keys if provided
      if (event.affectedKeys && event.affectedKeys.length > 0) {
        const promises = event.affectedKeys.map(key => this.delete(key));
        await Promise.allSettled(promises);
      }

    } catch (error) {
      logger.error(`Error processing invalidation event:`, error);
    }
  }

  async incrementVersion(prefix: string): Promise<void> {
    const currentVersion = this.cacheVersions.get(prefix) || 1;
    this.cacheVersions.set(prefix, currentVersion + 1);

    // Persist version information in Redis
    await this.redis.set(`version:${prefix}`, (currentVersion + 1).toString());

    logger.info(`Incremented cache version for prefix ${prefix} to ${currentVersion + 1}`);
  }

  // Utility Methods
  private extractPrefix(key: string): string {
    const parts = key.split(':');
    return parts[0] || 'default';
  }

  private async storeTags(key: string, tags: string[]): Promise<void> {
    const promises = tags.map(tag =>
      this.redis.sadd(`tag:${tag}`, key)
    );
    await Promise.allSettled(promises);
  }

  private async removeTags(key: string): Promise<void> {
    // This would need to be implemented based on how tags are stored
    // For now, we'll skip this as it requires knowing which tags were associated with the key
  }

  private async getKeysByTag(tag: string): Promise<string[]> {
    try {
      return await this.redis.smembers(`tag:${tag}`);
    } catch (error) {
      logger.error(`Error getting keys for tag ${tag}:`, error);
      return [];
    }
  }

  private getTagsForEvent(event: CacheInvalidationEvent): string[] {
    const tags: string[] = [];

    switch (event.type) {
      case 'user-update':
        tags.push('user', `user:${event.entityId}`, 'session');
        break;
      case 'course-update':
        tags.push('course', `course:${event.entityId}`, 'analytics');
        break;
      case 'quiz-completion':
        tags.push('quiz', `quiz:${event.entityId}`, 'analytics', 'user');
        break;
      case 'enrollment-change':
        tags.push('course', 'user', 'analytics');
        break;
      case 'settings-change':
        tags.push('user', 'course', 'analytics');
        break;
    }

    // Add any additional tags from the event
    if (event.tags) {
      tags.push(...event.tags);
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  // Placeholder methods for cache warming - these would be implemented based on actual data access patterns
  private async getActiveUserIds(): Promise<string[]> {
    // This would query the database for recently active users
    return [];
  }

  private async getPopularCourseIds(): Promise<string[]> {
    // This would query for most accessed courses
    return [];
  }

  private async getRecentQuizIds(): Promise<string[]> {
    // This would query for recently created or accessed quizzes
    return [];
  }

  private async warmUserProfile(userId: string): Promise<void> {
    // Implementation would fetch user profile and cache it
  }

  private async warmCourseData_single(courseId: string): Promise<void> {
    // Implementation would fetch course data and cache it
  }

  private async warmQuizData_single(quizId: string): Promise<void> {
    // Implementation would fetch quiz data and cache it
  }

  private async warmAnalyticsQuery(query: string): Promise<void> {
    // Implementation would execute analytics query and cache results
  }

  // Statistics and Monitoring
  async getStats(): Promise<any> {
    const redisMetrics = this.redis.getMetrics();

    return {
      redis: redisMetrics,
      warming: {
        enabled: this.warmerConfig.enabled,
        inProgress: this.isWarmingInProgress,
        queueSize: this.warmingQueue.length
      },
      versions: Object.fromEntries(this.cacheVersions)
    };
  }

  // Health Check
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error('Cache health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
let cacheManager: CacheManager;

export function getCacheManager(): CacheManager {
  if (!cacheManager) {
    cacheManager = new CacheManager();
  }
  return cacheManager;
}

export default CacheManager;