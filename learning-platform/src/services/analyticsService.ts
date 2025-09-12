import { PrismaClient } from '@prisma/client';
import { AnalyticsEvent, Course, User } from '../types';
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class AnalyticsService {
  /**
   * Track user event
   */
  async trackEvent(
    userId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    properties?: Record<string, any>
  ): Promise<AnalyticsEvent> {
    try {
      const event = await prisma.analyticsEvent.create({
        data: {
          userId,
          eventType,
          entityType,
          entityId,
          properties: properties || {},
          timestamp: new Date()
        }
      });

      return event as AnalyticsEvent;
    } catch (error) {
      logger.error('Error tracking event', { userId, eventType, error });
      throw new ValidationError('Failed to track event');
    }
  }

  /**
   * Track course view
   */
  async trackCourseView(userId: string, courseId: string): Promise<void> {
    await this.trackEvent(userId, 'course_viewed', 'course', courseId);
  }

  /**
   * Track module completion
   */
  async trackModuleCompletion(userId: string, moduleId: string, timeSpent: number): Promise<void> {
    await this.trackEvent(userId, 'module_completed', 'module', moduleId, {
      timeSpent
    });
  }

  /**
   * Track quiz attempt
   */
  async trackQuizAttempt(userId: string, quizId: string, score: number, passed: boolean): Promise<void> {
    await this.trackEvent(userId, 'quiz_attempted', 'quiz', quizId, {
      score,
      passed
    });
  }

  /**
   * Track video watch
   */
  async trackVideoWatch(userId: string, videoId: string, watchTime: number, totalDuration: number): Promise<void> {
    const completionPercentage = (watchTime / totalDuration) * 100;
    
    await this.trackEvent(userId, 'video_watched', 'video', videoId, {
      watchTime,
      totalDuration,
      completionPercentage
    });
  }

  /**
   * Get user learning analytics
   */
  async getUserLearningAnalytics(userId: string, timeframe: 'week' | 'month' | 'year' = 'month'): Promise<{
    totalTimeSpent: number;
    coursesEnrolled: number;
    coursesCompleted: number;
    quizzesTaken: number;
    averageQuizScore: number;
    badges: number;
    certificates: number;
    activityTrend: Array<{ date: string; events: number }>;
    topCategories: Array<{ category: string; timeSpent: number }>;
  }> {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe);
      
      // Get basic stats
      const [
        timeSpentEvents,
        enrollments,
        completedEnrollments,
        quizAttempts,
        userBadges,
        userCertificates
      ] = await Promise.all([
        prisma.analyticsEvent.findMany({
          where: {
            userId,
            eventType: 'module_completed',
            timestamp: { gte: startDate }
          }
        }),
        prisma.enrollment.count({
          where: { userId, enrolledAt: { gte: startDate } }
        }),
        prisma.enrollment.count({
          where: { 
            userId, 
            status: 'completed',
            completedAt: { gte: startDate }
          }
        }),
        prisma.quizAttempt.findMany({
          where: {
            userId,
            completedAt: { gte: startDate }
          }
        }),
        prisma.userBadge.count({
          where: { userId, earnedAt: { gte: startDate } }
        }),
        prisma.certificate.count({
          where: { userId, issuedAt: { gte: startDate } }
        })
      ]);

      // Calculate total time spent
      const totalTimeSpent = timeSpentEvents.reduce((sum, event) => {
        return sum + (event.properties?.timeSpent || 0);
      }, 0);

      // Calculate average quiz score
      const averageQuizScore = quizAttempts.length > 0 
        ? quizAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / quizAttempts.length
        : 0;

      // Get activity trend
      const activityTrend = await this.getUserActivityTrend(userId, timeframe);

      // Get top categories
      const topCategories = await this.getUserTopCategories(userId, timeframe);

      return {
        totalTimeSpent,
        coursesEnrolled: enrollments,
        coursesCompleted: completedEnrollments,
        quizzesTaken: quizAttempts.length,
        averageQuizScore,
        badges: userBadges,
        certificates: userCertificates,
        activityTrend,
        topCategories
      };
    } catch (error) {
      logger.error('Error fetching user learning analytics', { userId, error });
      throw new ValidationError('Failed to fetch user learning analytics');
    }
  }

  /**
   * Get course analytics
   */
  async getCourseAnalytics(courseId: string, timeframe: 'week' | 'month' | 'year' = 'month'): Promise<{
    totalEnrollments: number;
    activeEnrollments: number;
    completionRate: number;
    averageProgress: number;
    averageRating: number;
    totalRevenue: number;
    enrollmentTrend: Array<{ date: string; enrollments: number }>;
    dropoffPoints: Array<{ moduleId: string; moduleTitle: string; dropoffRate: number }>;
    engagementMetrics: {
      averageTimePerModule: number;
      videoCompletionRate: number;
      quizCompletionRate: number;
    };
  }> {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe);
      
      // Get basic enrollment stats
      const [
        totalEnrollments,
        activeEnrollments,
        completedEnrollments,
        allEnrollments
      ] = await Promise.all([
        prisma.enrollment.count({
          where: { courseId, enrolledAt: { gte: startDate } }
        }),
        prisma.enrollment.count({
          where: { courseId, status: 'active' }
        }),
        prisma.enrollment.count({
          where: { courseId, status: 'completed' }
        }),
        prisma.enrollment.findMany({
          where: { courseId }
        })
      ]);

      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;
      const averageProgress = allEnrollments.length > 0
        ? allEnrollments.reduce((sum, e) => sum + e.progress, 0) / allEnrollments.length
        : 0;

      // Get enrollment trend
      const enrollmentTrend = await this.getCourseEnrollmentTrend(courseId, timeframe);

      // Get dropoff points
      const dropoffPoints = await this.getCourseDropoffPoints(courseId);

      // Get engagement metrics
      const engagementMetrics = await this.getCourseEngagementMetrics(courseId, timeframe);

      return {
        totalEnrollments,
        activeEnrollments,
        completionRate,
        averageProgress,
        averageRating: 0, // Would be calculated from reviews/ratings
        totalRevenue: 0, // Would be calculated based on pricing
        enrollmentTrend,
        dropoffPoints,
        engagementMetrics
      };
    } catch (error) {
      logger.error('Error fetching course analytics', { courseId, error });
      throw new ValidationError('Failed to fetch course analytics');
    }
  }

  /**
   * Get platform-wide analytics dashboard
   */
  async getPlatformAnalytics(timeframe: 'week' | 'month' | 'year' = 'month'): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalCourses: number;
    totalEnrollments: number;
    completionRate: number;
    userGrowth: number;
    engagementRate: number;
    topCourses: Array<{ course: Course; enrollments: number; rating: number }>;
    userActivityTrend: Array<{ date: string; activeUsers: number }>;
    categoryPerformance: Array<{ category: string; enrollments: number; completionRate: number }>;
  }> {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe);
      const previousPeriodStart = this.getPreviousPeriodStart(timeframe, startDate);

      // Get basic platform stats
      const [
        totalUsers,
        currentPeriodUsers,
        previousPeriodUsers,
        totalCourses,
        totalEnrollments,
        completedEnrollments,
        activeUsers
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: startDate } } }),
        prisma.user.count({ 
          where: { 
            createdAt: { 
              gte: previousPeriodStart, 
              lt: startDate 
            } 
          } 
        }),
        prisma.course.count({ where: { isPublished: true } }),
        prisma.enrollment.count({ where: { enrolledAt: { gte: startDate } } }),
        prisma.enrollment.count({
          where: {
            status: 'completed',
            completedAt: { gte: startDate }
          }
        }),
        this.getActiveUserCount(timeframe)
      ]);

      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;
      const userGrowth = previousPeriodUsers > 0 
        ? ((currentPeriodUsers - previousPeriodUsers) / previousPeriodUsers) * 100 
        : 0;

      // Get engagement rate (users with activity in period)
      const usersWithActivity = await prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: { timestamp: { gte: startDate } },
        _count: true
      });
      const engagementRate = totalUsers > 0 ? (usersWithActivity.length / totalUsers) * 100 : 0;

      // Get top courses
      const topCourses = await this.getTopCourses(timeframe);

      // Get user activity trend
      const userActivityTrend = await this.getPlatformActivityTrend(timeframe);

      // Get category performance
      const categoryPerformance = await this.getCategoryPerformance(timeframe);

      return {
        totalUsers,
        activeUsers,
        totalCourses,
        totalEnrollments,
        completionRate,
        userGrowth,
        engagementRate,
        topCourses,
        userActivityTrend,
        categoryPerformance
      };
    } catch (error) {
      logger.error('Error fetching platform analytics', error);
      throw new ValidationError('Failed to fetch platform analytics');
    }
  }

  /**
   * Get learning path analytics
   */
  async getLearningPathAnalytics(pathId: string): Promise<{
    totalEnrollments: number;
    completionRate: number;
    averageTimeToComplete: number;
    dropoffRate: number;
    courseCompletionRates: Array<{ courseId: string; title: string; completionRate: number }>;
  }> {
    try {
      // In a real implementation, this would analyze learning path specific data
      // For now, return basic structure
      return {
        totalEnrollments: 0,
        completionRate: 0,
        averageTimeToComplete: 0,
        dropoffRate: 0,
        courseCompletionRates: []
      };
    } catch (error) {
      logger.error('Error fetching learning path analytics', { pathId, error });
      throw new ValidationError('Failed to fetch learning path analytics');
    }
  }

  /**
   * Generate custom analytics report
   */
  async generateCustomReport(
    reportConfig: {
      metrics: string[];
      filters: {
        dateRange: { start: Date; end: Date };
        userIds?: string[];
        courseIds?: string[];
        categories?: string[];
      };
      groupBy?: string;
    }
  ): Promise<any> {
    try {
      logger.info('Generating custom analytics report', { metrics: reportConfig.metrics });
      
      // Build dynamic query based on configuration
      const where: any = {
        timestamp: {
          gte: reportConfig.filters.dateRange.start,
          lte: reportConfig.filters.dateRange.end
        }
      };

      if (reportConfig.filters.userIds) {
        where.userId = { in: reportConfig.filters.userIds };
      }

      if (reportConfig.filters.courseIds) {
        where.entityId = { in: reportConfig.filters.courseIds };
        where.entityType = 'course';
      }

      const events = await prisma.analyticsEvent.findMany({
        where,
        include: {
          user: true
        }
      });

      // Process events based on requested metrics
      const report = this.processEventsForReport(events, reportConfig.metrics, reportConfig.groupBy);
      
      logger.info('Custom report generated successfully');
      return report;
    } catch (error) {
      logger.error('Error generating custom report', error);
      throw new ValidationError('Failed to generate custom report');
    }
  }

  /**
   * Export analytics data
   */
  async exportAnalyticsData(
    format: 'csv' | 'json',
    filters: {
      dateRange: { start: Date; end: Date };
      eventTypes?: string[];
      userIds?: string[];
    }
  ): Promise<string> {
    try {
      logger.info('Exporting analytics data', { format, filters });
      
      const where: any = {
        timestamp: {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end
        }
      };

      if (filters.eventTypes) {
        where.eventType = { in: filters.eventTypes };
      }

      if (filters.userIds) {
        where.userId = { in: filters.userIds };
      }

      const events = await prisma.analyticsEvent.findMany({
        where,
        include: {
          user: {
            select: { email: true, firstName: true, lastName: true }
          }
        },
        orderBy: { timestamp: 'desc' }
      });

      if (format === 'csv') {
        return this.convertToCsv(events);
      } else {
        return JSON.stringify(events, null, 2);
      }
    } catch (error) {
      logger.error('Error exporting analytics data', error);
      throw new ValidationError('Failed to export analytics data');
    }
  }

  // Helper methods

  private getStartDateForTimeframe(timeframe: string): Date {
    const now = new Date();
    switch (timeframe) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'year':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  private getPreviousPeriodStart(timeframe: string, currentStart: Date): Date {
    const timeDiff = new Date().getTime() - currentStart.getTime();
    return new Date(currentStart.getTime() - timeDiff);
  }

  private async getActiveUserCount(timeframe: string): Promise<number> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    const activeUsers = await prisma.analyticsEvent.groupBy({
      by: ['userId'],
      where: { timestamp: { gte: startDate } }
    });

    return activeUsers.length;
  }

  private async getUserActivityTrend(userId: string, timeframe: string): Promise<Array<{ date: string; events: number }>> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    const events = await prisma.analyticsEvent.groupBy({
      by: ['timestamp'],
      where: {
        userId,
        timestamp: { gte: startDate }
      },
      _count: true
    });

    // Group by date and count events
    const trend: Record<string, number> = {};
    events.forEach(event => {
      const date = event.timestamp.toISOString().split('T')[0];
      trend[date] = (trend[date] || 0) + event._count;
    });

    return Object.entries(trend).map(([date, events]) => ({ date, events }));
  }

  private async getUserTopCategories(userId: string, timeframe: string): Promise<Array<{ category: string; timeSpent: number }>> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    // This would require joining with course data to get categories
    // Simplified for now
    return [];
  }

  private async getCourseEnrollmentTrend(courseId: string, timeframe: string): Promise<Array<{ date: string; enrollments: number }>> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    const enrollments = await prisma.enrollment.groupBy({
      by: ['enrolledAt'],
      where: {
        courseId,
        enrolledAt: { gte: startDate }
      },
      _count: true
    });

    const trend: Record<string, number> = {};
    enrollments.forEach(enrollment => {
      const date = enrollment.enrolledAt.toISOString().split('T')[0];
      trend[date] = (trend[date] || 0) + enrollment._count;
    });

    return Object.entries(trend).map(([date, enrollments]) => ({ date, enrollments }));
  }

  private async getCourseDropoffPoints(courseId: string): Promise<Array<{ moduleId: string; moduleTitle: string; dropoffRate: number }>> {
    // This would analyze where users stop progressing in the course
    // Simplified for now
    return [];
  }

  private async getCourseEngagementMetrics(courseId: string, timeframe: string): Promise<{
    averageTimePerModule: number;
    videoCompletionRate: number;
    quizCompletionRate: number;
  }> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    // Get module completion events
    const moduleCompletions = await prisma.analyticsEvent.findMany({
      where: {
        eventType: 'module_completed',
        timestamp: { gte: startDate }
      }
    });

    const averageTimePerModule = moduleCompletions.length > 0
      ? moduleCompletions.reduce((sum, event) => sum + (event.properties?.timeSpent || 0), 0) / moduleCompletions.length
      : 0;

    // Get video watch events
    const videoEvents = await prisma.analyticsEvent.count({
      where: {
        eventType: 'video_watched',
        timestamp: { gte: startDate }
      }
    });

    // Get quiz attempt events
    const quizEvents = await prisma.analyticsEvent.count({
      where: {
        eventType: 'quiz_attempted',
        timestamp: { gte: startDate }
      }
    });

    return {
      averageTimePerModule,
      videoCompletionRate: 85, // Would be calculated from actual video completion data
      quizCompletionRate: 78 // Would be calculated from actual quiz completion data
    };
  }

  private async getTopCourses(timeframe: string): Promise<Array<{ course: Course; enrollments: number; rating: number }>> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    const topCourseEnrollments = await prisma.enrollment.groupBy({
      by: ['courseId'],
      where: {
        enrolledAt: { gte: startDate }
      },
      _count: true,
      orderBy: {
        _count: {
          courseId: 'desc'
        }
      },
      take: 10
    });

    const courses = await Promise.all(
      topCourseEnrollments.map(async (item) => {
        const course = await prisma.course.findUnique({
          where: { id: item.courseId }
        });
        
        return {
          course: course as Course,
          enrollments: item._count,
          rating: 4.5 // Would be calculated from actual ratings
        };
      })
    );

    return courses;
  }

  private async getPlatformActivityTrend(timeframe: string): Promise<Array<{ date: string; activeUsers: number }>> {
    const startDate = this.getStartDateForTimeframe(timeframe);
    
    const dailyActiveUsers = await prisma.analyticsEvent.groupBy({
      by: ['timestamp', 'userId'],
      where: {
        timestamp: { gte: startDate }
      }
    });

    // Group by date and count unique users
    const trend: Record<string, Set<string>> = {};
    dailyActiveUsers.forEach(item => {
      const date = item.timestamp.toISOString().split('T')[0];
      if (!trend[date]) {
        trend[date] = new Set();
      }
      trend[date].add(item.userId);
    });

    return Object.entries(trend).map(([date, userSet]) => ({
      date,
      activeUsers: userSet.size
    }));
  }

  private async getCategoryPerformance(timeframe: string): Promise<Array<{ category: string; enrollments: number; completionRate: number }>> {
    // This would analyze performance by course categories
    // Simplified for now
    return [];
  }

  private processEventsForReport(events: any[], metrics: string[], groupBy?: string): any {
    // Process events based on requested metrics
    const report: any = {};
    
    metrics.forEach(metric => {
      switch (metric) {
        case 'total_events':
          report.totalEvents = events.length;
          break;
        case 'unique_users':
          report.uniqueUsers = new Set(events.map(e => e.userId)).size;
          break;
        case 'event_types':
          report.eventTypes = events.reduce((acc, event) => {
            acc[event.eventType] = (acc[event.eventType] || 0) + 1;
            return acc;
          }, {});
          break;
      }
    });

    return report;
  }

  private convertToCsv(data: any[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value}"` : value
      ).join(',')
    ).join('\n');

    return `${headers}\n${rows}`;
  }
}

export const analyticsService = new AnalyticsService();