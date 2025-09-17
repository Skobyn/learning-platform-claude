/**
 * Cron Job Handlers
 * Handles scheduled tasks triggered by Google Cloud Scheduler
 */

const prisma = require('../../src/lib/db');
const { sendEmail } = require('../../src/services/email.service');
const { generateCertificate } = require('../../src/services/certificate.service');
const { updateAnalytics } = require('../../src/services/analytics.service');
const Redis = require('ioredis');

class CronHandlers {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
    this.cronToken = process.env.CRON_SECRET_TOKEN || 'your-cron-secret-token';
  }

  /**
   * Verify cron token for security
   */
  verifyCronToken(token) {
    return token === this.cronToken;
  }

  /**
   * Daily analytics aggregation
   */
  async handleDailyAnalytics(jobData) {
    try {
      console.log('Starting daily analytics aggregation...');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Aggregate user progress
      await this.aggregateUserProgress(yesterday, today);
      
      // Calculate course completion rates
      await this.calculateCourseCompletionRates(yesterday, today);
      
      // Update learning streaks
      await this.updateLearningStreaks(yesterday);
      
      // Generate daily reports
      await this.generateDailyReports(yesterday);

      console.log('Daily analytics aggregation completed successfully');
      return { success: true, message: 'Daily analytics aggregation completed' };
    } catch (error) {
      console.error('Failed to process daily analytics:', error);
      throw error;
    }
  }

  /**
   * Aggregate user progress data
   */
  async aggregateUserProgress(startDate, endDate) {
    // Get all users who were active yesterday
    const activeUsers = await prisma.user.findMany({
      where: {
        lastLoginAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        enrollments: {
          include: {
            course: true,
          },
        },
      },
    });

    for (const user of activeUsers) {
      let totalProgress = 0;
      let activeEnrollments = 0;
      
      for (const enrollment of user.enrollments) {
        if (enrollment.status === 'ACTIVE') {
          totalProgress += enrollment.progress;
          activeEnrollments++;
        }
      }
      
      const averageProgress = activeEnrollments > 0 ? totalProgress / activeEnrollments : 0;
      
      // Store daily progress snapshot
      await prisma.dailyProgress.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date: startDate,
          },
        },
        update: {
          averageProgress,
          activeEnrollments,
          totalTimeSpent: await this.calculateDailyTimeSpent(user.id, startDate, endDate),
        },
        create: {
          userId: user.id,
          date: startDate,
          averageProgress,
          activeEnrollments,
          totalTimeSpent: await this.calculateDailyTimeSpent(user.id, startDate, endDate),
        },
      });
    }
  }

  /**
   * Calculate course completion rates
   */
  async calculateCourseCompletionRates(startDate, endDate) {
    const courses = await prisma.course.findMany({
      where: {
        isPublished: true,
      },
      include: {
        enrollments: {
          where: {
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
        },
      },
    });

    for (const course of courses) {
      const totalEnrollments = course.enrollments.length;
      const completedEnrollments = course.enrollments.filter(
        enrollment => enrollment.status === 'COMPLETED'
      ).length;
      
      const completionRate = totalEnrollments > 0 ? 
        (completedEnrollments / totalEnrollments) * 100 : 0;

      await prisma.dailyCourseStats.upsert({
        where: {
          courseId_date: {
            courseId: course.id,
            date: startDate,
          },
        },
        update: {
          enrollments: totalEnrollments,
          completions: completedEnrollments,
          completionRate,
        },
        create: {
          courseId: course.id,
          date: startDate,
          enrollments: totalEnrollments,
          completions: completedEnrollments,
          completionRate,
        },
      });
    }
  }

  /**
   * Update learning streaks
   */
  async updateLearningStreaks(date) {
    const users = await prisma.user.findMany({
      include: {
        learningStreak: true,
      },
    });

    for (const user of users) {
      const wasActiveToday = await this.wasUserActiveOnDate(user.id, date);
      
      if (wasActiveToday) {
        // User was active, extend or start streak
        if (user.learningStreak) {
          await prisma.learningStreak.update({
            where: { userId: user.id },
            data: {
              currentStreak: user.learningStreak.currentStreak + 1,
              longestStreak: Math.max(
                user.learningStreak.longestStreak,
                user.learningStreak.currentStreak + 1
              ),
              lastActiveDate: date,
            },
          });
        } else {
          await prisma.learningStreak.create({
            data: {
              userId: user.id,
              currentStreak: 1,
              longestStreak: 1,
              lastActiveDate: date,
            },
          });
        }
      } else {
        // User was not active, break streak
        if (user.learningStreak && user.learningStreak.currentStreak > 0) {
          await prisma.learningStreak.update({
            where: { userId: user.id },
            data: {
              currentStreak: 0,
            },
          });
        }
      }
    }
  }

  /**
   * Generate daily reports
   */
  async generateDailyReports(date) {
    const report = {
      date: date.toISOString(),
      metrics: {
        totalUsers: await prisma.user.count(),
        activeUsers: await prisma.user.count({
          where: {
            lastLoginAt: {
              gte: date,
              lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        }),
        coursesCompleted: await prisma.enrollment.count({
          where: {
            completedAt: {
              gte: date,
              lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        }),
        quizzesTaken: await prisma.quizAttempt.count({
          where: {
            submittedAt: {
              gte: date,
              lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        }),
      },
    };

    // Store report
    await this.redis.setex(
      `daily_report:${date.toISOString().split('T')[0]}`,
      7 * 24 * 60 * 60, // 7 days
      JSON.stringify(report)
    );

    // Send report to administrators
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Learning Platform Daily Report - ${date.toDateString()}`,
      template: 'daily-report',
      data: report,
    });
  }

  /**
   * Weekly certificate batch generation
   */
  async handleCertificateBatch(jobData) {
    try {
      console.log('Starting certificate batch generation...');
      
      const { batchSize = 100, filters = {} } = jobData;
      
      // Find completed enrollments that need certificates
      const completedEnrollments = await prisma.enrollment.findMany({
        where: {
          status: 'COMPLETED',
          certificate: null,
          completedAt: filters.completedSince ? {
            gte: new Date(Date.now() - this.parseDuration(filters.completedSince)),
          } : undefined,
        },
        take: batchSize,
        include: {
          user: true,
          course: true,
        },
      });

      let processed = 0;
      let errors = 0;

      for (const enrollment of completedEnrollments) {
        try {
          await generateCertificate({
            userId: enrollment.userId,
            courseId: enrollment.courseId,
            enrollmentId: enrollment.id,
            completionDate: enrollment.completedAt,
          });
          processed++;
        } catch (error) {
          console.error(`Failed to generate certificate for enrollment ${enrollment.id}:`, error);
          errors++;
        }
      }

      console.log(`Certificate batch completed: ${processed} processed, ${errors} errors`);
      return { 
        success: true, 
        message: `Certificate batch completed: ${processed} processed, ${errors} errors`,
        processed,
        errors,
      };
    } catch (error) {
      console.error('Failed to process certificate batch:', error);
      throw error;
    }
  }

  /**
   * Comprehensive system health check
   */
  async handleHealthCheck() {
    try {
      const healthChecks = await Promise.allSettled([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkExternalServices(),
        this.checkFileStorage(),
        this.checkMemoryUsage(),
        this.checkPerformanceMetrics(),
      ]);

      const results = healthChecks.map((check, index) => ({
        service: ['database', 'redis', 'external', 'storage', 'memory', 'performance'][index],
        status: check.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        details: check.status === 'fulfilled' ? check.value : check.reason?.message,
      }));

      const overallHealth = results.every(result => result.status === 'healthy') ? 'healthy' : 'degraded';
      
      const healthReport = {
        timestamp: new Date().toISOString(),
        overall: overallHealth,
        services: results,
      };

      // Store health check result
      await this.redis.setex('health_check:latest', 3600, JSON.stringify(healthReport));

      // Alert if unhealthy
      if (overallHealth === 'degraded') {
        await this.sendHealthAlert(healthReport);
      }

      return { success: true, health: healthReport };
    } catch (error) {
      console.error('Failed to perform health check:', error);
      throw error;
    }
  }

  /**
   * Database cleanup and optimization
   */
  async handleDatabaseCleanup(jobData) {
    try {
      console.log('Starting database cleanup...');
      
      const { tasks = [], retentionPolicies = {} } = jobData;
      const results = {};

      for (const task of tasks) {
        switch (task) {
          case 'cleanup_expired_sessions':
            results[task] = await this.cleanupExpiredSessions(retentionPolicies.sessions);
            break;
          case 'archive_old_logs':
            results[task] = await this.archiveOldLogs(retentionPolicies.logs);
            break;
          case 'cleanup_temporary_files':
            results[task] = await this.cleanupTemporaryFiles(retentionPolicies.tempFiles);
            break;
          case 'update_search_indexes':
            results[task] = await this.updateSearchIndexes();
            break;
          case 'vacuum_tables':
            results[task] = await this.vacuumTables();
            break;
          case 'update_statistics':
            results[task] = await this.updateStatistics();
            break;
        }
      }

      console.log('Database cleanup completed:', results);
      return { success: true, results };
    } catch (error) {
      console.error('Failed to perform database cleanup:', error);
      throw error;
    }
  }

  /**
   * Send daily email digest
   */
  async handleEmailDigest(jobData) {
    try {
      console.log('Starting email digest generation...');
      
      const { digestType, targetUsers, content } = jobData;
      
      // Get target users based on criteria
      const users = await this.getTargetUsers(targetUsers);
      
      let sent = 0;
      let errors = 0;

      for (const user of users) {
        try {
          const digestData = await this.generateDigestContent(user, content);
          
          await sendEmail({
            to: user.email,
            subject: 'Your Learning Digest',
            template: 'daily-digest',
            data: digestData,
          });
          
          sent++;
        } catch (error) {
          console.error(`Failed to send digest to user ${user.id}:`, error);
          errors++;
        }
      }

      console.log(`Email digest completed: ${sent} sent, ${errors} errors`);
      return { success: true, sent, errors };
    } catch (error) {
      console.error('Failed to send email digest:', error);
      throw error;
    }
  }

  /**
   * Cache warming
   */
  async handleCacheWarming(jobData) {
    try {
      console.log('Starting cache warming...');
      
      const { strategy, content_types, cache_duration } = jobData;
      
      const results = {};
      
      for (const contentType of content_types) {
        switch (contentType) {
          case 'courses':
            results[contentType] = await this.warmCourseCache(strategy, cache_duration);
            break;
          case 'modules':
            results[contentType] = await this.warmModuleCache(strategy, cache_duration);
            break;
          case 'user_profiles':
            results[contentType] = await this.warmUserProfileCache(strategy, cache_duration);
            break;
          case 'quiz_questions':
            results[contentType] = await this.warmQuizCache(strategy, cache_duration);
            break;
        }
      }

      console.log('Cache warming completed:', results);
      return { success: true, results };
    } catch (error) {
      console.error('Failed to warm cache:', error);
      throw error;
    }
  }

  // Helper methods
  async calculateDailyTimeSpent(userId, startDate, endDate) {
    // This would calculate actual time spent based on activity logs
    // For now, return a mock value
    return Math.floor(Math.random() * 120) + 30; // 30-150 minutes
  }

  async wasUserActiveOnDate(userId, date) {
    const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    const activity = await prisma.userActivity.findFirst({
      where: {
        userId,
        createdAt: {
          gte: date,
          lt: nextDay,
        },
      },
    });
    
    return !!activity;
  }

  parseDuration(duration) {
    const match = duration.match(/^(\d+)([dhm])$/);
    if (!match) return 0;
    
    const [, amount, unit] = match;
    const multipliers = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000, m: 60 * 1000 };
    
    return parseInt(amount) * multipliers[unit];
  }

  async checkDatabase() {
    const result = await prisma.$queryRaw`SELECT 1 as status`;
    return { status: 'connected', response_time: Date.now() };
  }

  async checkRedis() {
    const start = Date.now();
    await this.redis.ping();
    return { status: 'connected', response_time: Date.now() - start };
  }

  async checkExternalServices() {
    // Mock implementation
    return { status: 'connected', services: ['email', 'storage'] };
  }

  async checkFileStorage() {
    // Mock implementation
    return { status: 'connected', available_space: '95%' };
  }

  async checkMemoryUsage() {
    const used = process.memoryUsage();
    return {
      status: used.heapUsed < 1024 * 1024 * 1024 ? 'healthy' : 'warning', // 1GB threshold
      heap_used: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
      heap_total: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
    };
  }

  async checkPerformanceMetrics() {
    // Mock implementation
    return { status: 'healthy', avg_response_time: '150ms', error_rate: '0.1%' };
  }

  async sendHealthAlert(healthReport) {
    const unhealthyServices = healthReport.services.filter(s => s.status === 'unhealthy');
    
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: 'Learning Platform Health Alert',
      template: 'health-alert',
      data: {
        overall: healthReport.overall,
        unhealthyServices,
        timestamp: healthReport.timestamp,
      },
    });
  }

  async cleanupExpiredSessions(retention) {
    const cutoffDate = new Date(Date.now() - this.parseDuration(retention || '30d'));
    
    const result = await prisma.session.deleteMany({
      where: {
        updatedAt: {
          lt: cutoffDate,
        },
      },
    });
    
    return { deleted: result.count };
  }

  async archiveOldLogs(retention) {
    // Mock implementation
    return { archived: 1000, deleted: 500 };
  }

  async cleanupTemporaryFiles(retention) {
    // Mock implementation
    return { deleted: 50, freed_space: '2GB' };
  }

  async updateSearchIndexes() {
    // Mock implementation
    return { indexes_updated: 5, time_taken: '30s' };
  }

  async vacuumTables() {
    // Mock implementation
    return { tables_vacuumed: 12, space_reclaimed: '500MB' };
  }

  async updateStatistics() {
    // Mock implementation
    return { statistics_updated: 8, time_taken: '15s' };
  }

  async getTargetUsers(targetUsers) {
    if (targetUsers === 'active') {
      return prisma.user.findMany({
        where: {
          lastLoginAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
        take: 1000, // Limit for safety
      });
    }
    
    // Add more targeting logic as needed
    return [];
  }

  async generateDigestContent(user, content) {
    const digestData = {
      firstName: user.firstName,
      date: new Date().toLocaleDateString(),
    };
    
    for (const contentType of content) {
      switch (contentType) {
        case 'progress_summary':
          digestData.progressSummary = await this.getUserProgressSummary(user.id);
          break;
        case 'upcoming_deadlines':
          digestData.upcomingDeadlines = await this.getUserUpcomingDeadlines(user.id);
          break;
        case 'recommended_courses':
          digestData.recommendedCourses = await this.getUserRecommendedCourses(user.id);
          break;
        case 'achievement_highlights':
          digestData.achievements = await this.getUserRecentAchievements(user.id);
          break;
      }
    }
    
    return digestData;
  }

  async getUserProgressSummary(userId) {
    // Mock implementation
    return {
      coursesInProgress: 3,
      modulesCompleted: 12,
      averageProgress: 67,
    };
  }

  async getUserUpcomingDeadlines(userId) {
    // Mock implementation
    return [
      { course: 'JavaScript Basics', deadline: '2024-01-15', type: 'quiz' },
      { course: 'React Fundamentals', deadline: '2024-01-20', type: 'project' },
    ];
  }

  async getUserRecommendedCourses(userId) {
    // Mock implementation
    return [
      { title: 'Advanced JavaScript', reason: 'Based on your progress' },
      { title: 'Node.js Essentials', reason: 'Popular among peers' },
    ];
  }

  async getUserRecentAchievements(userId) {
    // Mock implementation
    return [
      { type: 'badge', name: 'Quiz Master', earned: '2024-01-10' },
      { type: 'certificate', name: 'HTML/CSS Basics', earned: '2024-01-08' },
    ];
  }

  async warmCourseCache(strategy, duration) {
    // Mock implementation
    return { courses_cached: 50, cache_hits_expected: '85%' };
  }

  async warmModuleCache(strategy, duration) {
    // Mock implementation
    return { modules_cached: 200, cache_hits_expected: '90%' };
  }

  async warmUserProfileCache(strategy, duration) {
    // Mock implementation
    return { profiles_cached: 1000, cache_hits_expected: '95%' };
  }

  async warmQuizCache(strategy, duration) {
    // Mock implementation
    return { quizzes_cached: 75, cache_hits_expected: '80%' };
  }
}

module.exports = CronHandlers;