import { cacheService, CacheConfigs } from '@/services/cacheService';
import { CacheKeyGenerator, CacheUtils } from '@/utils/cache';

/**
 * Comprehensive caching strategies for the learning platform
 */

// User-specific caching strategies
export class UserCacheStrategy {
  /**
   * Cache user profile data with automatic invalidation on updates
   */
  static async cacheUserProfile(userId: string, profileData: any): Promise<void> {
    const key = CacheKeyGenerator.user(userId, 'profile');
    await cacheService.set(key, profileData, {
      ...CacheConfigs.userSession,
      tags: ['user', 'profile', `user:${userId}`],
    });
  }

  /**
   * Get cached user profile with fallback to database
   */
  static async getUserProfile(userId: string, fallbackFn: () => Promise<any>): Promise<any> {
    const key = CacheKeyGenerator.user(userId, 'profile');
    return await cacheService.getOrSet(key, fallbackFn, {
      ...CacheConfigs.userSession,
      tags: ['user', 'profile', `user:${userId}`],
    });
  }

  /**
   * Cache user course enrollment data
   */
  static async cacheUserCourses(userId: string, coursesData: any[]): Promise<void> {
    const key = CacheKeyGenerator.user(userId, 'courses');
    await cacheService.set(key, coursesData, {
      ttl: 1800, // 30 minutes
      namespace: 'user',
      tags: ['user', 'courses', `user:${userId}`],
    });
  }

  /**
   * Cache user progress across all courses
   */
  static async cacheUserProgress(userId: string, progressData: Record<string, any>): Promise<void> {
    // Cache overall progress summary
    const summaryKey = CacheKeyGenerator.user(userId, 'progress:summary');
    await cacheService.set(summaryKey, progressData, {
      ttl: 900, // 15 minutes
      namespace: 'user',
      tags: ['user', 'progress', `user:${userId}`],
    });

    // Cache individual course progress
    for (const [courseId, progress] of Object.entries(progressData)) {
      const courseProgressKey = CacheKeyGenerator.progress(userId, courseId);
      await cacheService.set(courseProgressKey, progress, {
        ttl: 900,
        namespace: 'progress',
        tags: ['user', 'progress', 'course', `user:${userId}`, `course:${courseId}`],
      });
    }
  }

  /**
   * Invalidate all user-related cache
   */
  static async invalidateUserCache(userId: string): Promise<void> {
    await cacheService.invalidateByTags([`user:${userId}`]);
  }
}

// Course content caching strategies
export class CourseCacheStrategy {
  /**
   * Cache course metadata with long TTL
   */
  static async cacheCourseMetadata(courseId: string, metadata: any): Promise<void> {
    const key = CacheKeyGenerator.course(courseId, 'metadata');
    await cacheService.set(key, metadata, {
      ...CacheConfigs.courseData,
      tags: ['course', 'metadata', `course:${courseId}`],
    });
  }

  /**
   * Cache course lessons with hierarchical structure
   */
  static async cacheCourseLessons(courseId: string, lessons: any[]): Promise<void> {
    // Cache all lessons together
    const allLessonsKey = CacheKeyGenerator.course(courseId, 'lessons');
    await cacheService.set(allLessonsKey, lessons, {
      ...CacheConfigs.courseData,
      tags: ['course', 'lessons', `course:${courseId}`],
    });

    // Cache individual lessons
    for (const lesson of lessons) {
      const lessonKey = CacheKeyGenerator.lesson(lesson.id, 'content');
      await cacheService.set(lessonKey, lesson, {
        ttl: 7200, // 2 hours
        namespace: 'lesson',
        tags: ['lesson', 'content', `course:${courseId}`, `lesson:${lesson.id}`],
      });
    }
  }

  /**
   * Cache course completion statistics
   */
  static async cacheCourseStats(courseId: string, stats: any): Promise<void> {
    const key = CacheKeyGenerator.course(courseId, 'stats');
    await cacheService.set(key, stats, {
      ttl: 1800, // 30 minutes
      namespace: 'course',
      tags: ['course', 'stats', `course:${courseId}`],
    });
  }

  /**
   * Cache course prerequisites and dependencies
   */
  static async cacheCourseDependencies(courseId: string, dependencies: any): Promise<void> {
    const key = CacheKeyGenerator.course(courseId, 'dependencies');
    await cacheService.set(key, dependencies, {
      ttl: 3600, // 1 hour
      namespace: 'course',
      tags: ['course', 'dependencies', `course:${courseId}`],
    });
  }

  /**
   * Warm course cache with all related data
   */
  static async warmCourseCache(courseId: string, fetchFunctions: {
    metadata: () => Promise<any>;
    lessons: () => Promise<any[]>;
    stats: () => Promise<any>;
    dependencies: () => Promise<any>;
  }): Promise<void> {
    await Promise.all([
      this.cacheCourseMetadata(courseId, await fetchFunctions.metadata()),
      this.cacheCourseLessons(courseId, await fetchFunctions.lessons()),
      this.cacheCourseStats(courseId, await fetchFunctions.stats()),
      this.cacheCourseDependencies(courseId, await fetchFunctions.dependencies()),
    ]);
  }

  /**
   * Invalidate course-related cache
   */
  static async invalidateCourseCache(courseId: string): Promise<void> {
    await cacheService.invalidateByTags([`course:${courseId}`]);
  }
}

// Search and discovery caching
export class SearchCacheStrategy {
  /**
   * Cache search results with query-specific keys
   */
  static async cacheSearchResults(
    query: string,
    filters: Record<string, any>,
    results: any[],
    pagination: { page: number; limit: number; total: number }
  ): Promise<void> {
    const key = CacheKeyGenerator.search(query, { ...filters, ...pagination });
    await cacheService.set(key, { results, pagination }, {
      ...CacheConfigs.searchResults,
      tags: ['search', `query:${query}`],
    });
  }

  /**
   * Cache popular/trending searches
   */
  static async cachePopularSearches(searches: string[]): Promise<void> {
    const key = 'popular_searches';
    await cacheService.set(key, searches, {
      ttl: 3600, // 1 hour
      namespace: 'search',
      tags: ['search', 'popular'],
    });
  }

  /**
   * Cache search suggestions/autocomplete
   */
  static async cacheSearchSuggestions(prefix: string, suggestions: string[]): Promise<void> {
    const key = `suggestions:${prefix}`;
    await cacheService.set(key, suggestions, {
      ttl: 1800, // 30 minutes
      namespace: 'search',
      tags: ['search', 'suggestions'],
    });
  }

  /**
   * Get cached search results with fallback
   */
  static async getSearchResults(
    query: string,
    filters: Record<string, any>,
    pagination: { page: number; limit: number },
    fallbackFn: () => Promise<{ results: any[]; total: number }>
  ): Promise<any> {
    const key = CacheKeyGenerator.search(query, { ...filters, ...pagination });
    return await cacheService.getOrSet(key, async () => {
      const data = await fallbackFn();
      return { 
        results: data.results, 
        pagination: { ...pagination, total: data.total } 
      };
    }, {
      ...CacheConfigs.searchResults,
      tags: ['search', `query:${query}`],
    });
  }
}

// Analytics and reporting caching
export class AnalyticsCacheStrategy {
  /**
   * Cache dashboard metrics with short TTL
   */
  static async cacheDashboardMetrics(userId: string, metrics: any): Promise<void> {
    const key = CacheKeyGenerator.analytics('dashboard', 'current', [userId]);
    await cacheService.set(key, metrics, {
      ...CacheConfigs.analytics,
      tags: ['analytics', 'dashboard', `user:${userId}`],
    });
  }

  /**
   * Cache system-wide analytics
   */
  static async cacheSystemAnalytics(timeframe: string, data: any): Promise<void> {
    const key = CacheKeyGenerator.analytics('system', timeframe);
    await cacheService.set(key, data, {
      ttl: 600, // 10 minutes
      namespace: 'analytics',
      tags: ['analytics', 'system', `timeframe:${timeframe}`],
    });
  }

  /**
   * Cache course performance analytics
   */
  static async cacheCourseAnalytics(courseId: string, timeframe: string, analytics: any): Promise<void> {
    const key = CacheKeyGenerator.analytics('course_performance', timeframe, [courseId]);
    await cacheService.set(key, analytics, {
      ttl: 900, // 15 minutes
      namespace: 'analytics',
      tags: ['analytics', 'course', `course:${courseId}`, `timeframe:${timeframe}`],
    });
  }

  /**
   * Cache user learning analytics
   */
  static async cacheUserAnalytics(userId: string, timeframe: string, analytics: any): Promise<void> {
    const key = CacheKeyGenerator.analytics('user_learning', timeframe, [userId]);
    await cacheService.set(key, analytics, {
      ttl: 600, // 10 minutes
      namespace: 'analytics',
      tags: ['analytics', 'user', `user:${userId}`, `timeframe:${timeframe}`],
    });
  }
}

// Recommendation caching
export class RecommendationCacheStrategy {
  /**
   * Cache personalized course recommendations
   */
  static async cacheCourseRecommendations(userId: string, recommendations: any[]): Promise<void> {
    const key = CacheKeyGenerator.recommendations(userId, 'courses');
    await cacheService.set(key, recommendations, {
      ...CacheConfigs.recommendations,
      tags: ['recommendations', 'courses', `user:${userId}`],
    });
  }

  /**
   * Cache learning path recommendations
   */
  static async cacheLearningPathRecommendations(userId: string, paths: any[]): Promise<void> {
    const key = CacheKeyGenerator.recommendations(userId, 'learning_paths');
    await cacheService.set(key, paths, {
      ...CacheConfigs.recommendations,
      tags: ['recommendations', 'learning_paths', `user:${userId}`],
    });
  }

  /**
   * Cache peer recommendations (study buddies, mentors)
   */
  static async cachePeerRecommendations(userId: string, peers: any[]): Promise<void> {
    const key = CacheKeyGenerator.recommendations(userId, 'peers');
    await cacheService.set(key, peers, {
      ttl: 3600, // 1 hour
      namespace: 'recommendations',
      tags: ['recommendations', 'peers', `user:${userId}`],
    });
  }
}

// Static assets and content caching
export class StaticContentCacheStrategy {
  /**
   * Cache system settings and configurations
   */
  static async cacheSystemSettings(settings: any): Promise<void> {
    const key = CacheKeyGenerator.settings('system');
    await cacheService.set(key, settings, {
      ...CacheConfigs.systemSettings,
      tags: ['settings', 'system'],
    });
  }

  /**
   * Cache user-specific settings
   */
  static async cacheUserSettings(userId: string, settings: any): Promise<void> {
    const key = CacheKeyGenerator.settings('user', userId);
    await cacheService.set(key, settings, {
      ttl: 3600, // 1 hour
      namespace: 'settings',
      tags: ['settings', 'user', `user:${userId}`],
    });
  }

  /**
   * Cache certificates and badges
   */
  static async cacheCertificate(userId: string, courseId: string, certificate: any): Promise<void> {
    const key = CacheKeyGenerator.certificate(userId, courseId);
    await cacheService.set(key, certificate, {
      ttl: 86400, // 24 hours - certificates don't change often
      namespace: 'certificates',
      tags: ['certificates', `user:${userId}`, `course:${courseId}`],
    });
  }

  /**
   * Cache leaderboards
   */
  static async cacheLeaderboard(scope: string, period: string, leaderboard: any[]): Promise<void> {
    const key = CacheKeyGenerator.leaderboard(scope, period);
    await cacheService.set(key, leaderboard, {
      ttl: 1800, // 30 minutes
      namespace: 'leaderboard',
      tags: ['leaderboard', `scope:${scope}`, `period:${period}`],
    });
  }
}

// Cache invalidation strategies
export class CacheInvalidationStrategy {
  /**
   * Invalidate cache when user data changes
   */
  static async onUserUpdate(userId: string): Promise<void> {
    await Promise.all([
      UserCacheStrategy.invalidateUserCache(userId),
      cacheService.invalidateByTags(['recommendations']), // User changes might affect recommendations
      cacheService.invalidateByTags(['leaderboard']), // Might affect leaderboards
    ]);
  }

  /**
   * Invalidate cache when course content changes
   */
  static async onCourseUpdate(courseId: string): Promise<void> {
    await Promise.all([
      CourseCacheStrategy.invalidateCourseCache(courseId),
      cacheService.invalidateByTags(['search']), // Course changes affect search results
      cacheService.invalidateByTags(['recommendations']), // Might affect recommendations
    ]);
  }

  /**
   * Invalidate cache when user enrolls in a course
   */
  static async onCourseEnrollment(userId: string, courseId: string): Promise<void> {
    await Promise.all([
      cacheService.invalidateByTags([`user:${userId}`]),
      cacheService.invalidateByTags([`course:${courseId}`]),
      cacheService.invalidateByTags(['recommendations']),
    ]);
  }

  /**
   * Invalidate cache when user completes a lesson
   */
  static async onLessonCompletion(userId: string, courseId: string, lessonId: string): Promise<void> {
    await Promise.all([
      cacheService.invalidateByTags([`user:${userId}`]),
      cacheService.invalidateByTags(['progress']),
      cacheService.invalidateByTags(['analytics']),
      cacheService.invalidateByTags(['leaderboard']),
    ]);
  }

  /**
   * Scheduled cache cleanup and optimization
   */
  static async scheduledCleanup(): Promise<void> {
    // This would be called by a cron job or scheduled task
    await Promise.all([
      CacheUtils.optimize.optimizeCache(),
      cacheService.invalidateByTags(['expired']),
    ]);
  }
}

// Cache warming strategies for optimal performance
export class CacheWarmingStrategy {
  /**
   * Warm cache during off-peak hours
   */
  static async warmPopularContent(): Promise<void> {
    // This would be implemented based on analytics data
    console.log('Warming popular content cache...');
    
    // Example: warm most accessed courses
    // const popularCourses = await getPopularCourses();
    // for (const course of popularCourses) {
    //   await CourseCacheStrategy.warmCourseCache(course.id, ...);
    // }
  }

  /**
   * Warm user-specific cache on login
   */
  static async warmUserCacheOnLogin(userId: string): Promise<void> {
    await CacheUtils.warm.warmUserCache(userId);
  }

  /**
   * Pre-warm cache for new course releases
   */
  static async prewarmNewCourseCache(courseId: string): Promise<void> {
    await CacheUtils.warm.warmCourseCache(courseId);
  }
}