import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// Validation schemas
const ProgressUpdateSchema = z.object({
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  score: z.number().min(0).max(100).optional(),
  timeSpent: z.number().min(0).optional(), // in minutes
  notes: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AnalyticsFilters = z.object({
  pathId: z.string().optional(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'PAUSED', 'DROPPED']).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  category: z.string().optional(),
});

export type ProgressUpdateInput = z.infer<typeof ProgressUpdateSchema>;
export type AnalyticsFiltersInput = z.infer<typeof AnalyticsFilters>;

export interface DetailedProgressReport {
  enrollment: {
    id: string;
    userId: string;
    learningPathId: string;
    status: string;
    progressPercentage: number;
    enrolledAt: Date;
    completedAt?: Date;
    timeSpent: number;
    estimatedCompletionDate?: Date;
  };
  learningPath: {
    id: string;
    title: string;
    category: string;
    difficulty: string;
    estimatedDuration: number;
    totalItems: number;
    requiredItems: number;
  };
  itemProgress: {
    id: string;
    itemId: string;
    itemType: string;
    title: string;
    orderIndex: number;
    isRequired: boolean;
    status: string;
    progressPercentage: number;
    timeSpent: number;
    score?: number;
    completedAt?: Date;
    estimatedDuration: number;
  }[];
  summary: {
    completedItems: number;
    totalItems: number;
    completedRequiredItems: number;
    totalRequiredItems: number;
    averageScore?: number;
    timeSpentTotal: number;
    estimatedTimeRemaining: number;
    nextItem?: {
      id: string;
      title: string;
      itemType: string;
      estimatedDuration: number;
    };
  };
}

export interface LearningPathAnalytics {
  pathMetrics: {
    totalEnrollments: number;
    activeEnrollments: number;
    completedEnrollments: number;
    averageCompletionTime: number; // in days
    averageProgressPercentage: number;
    completionRate: number; // percentage
    dropoutRate: number; // percentage
  };
  itemMetrics: {
    itemId: string;
    itemType: string;
    title: string;
    averageCompletionTime: number; // in minutes
    completionRate: number;
    averageScore?: number;
    difficultyRating: number; // 1-10 based on completion times and scores
  }[];
  progressDistribution: {
    range: string; // "0-10%", "11-20%", etc.
    count: number;
    percentage: number;
  }[];
  timeAnalytics: {
    averageSessionDuration: number; // in minutes
    peakActivityHours: number[]; // hours of the day (0-23)
    weeklyActivity: {
      dayOfWeek: number; // 0-6 (Sunday-Saturday)
      averageTimeSpent: number;
      sessionsCount: number;
    }[];
  };
}

export interface UserLearningAnalytics {
  user: {
    id: string;
    totalPathsEnrolled: number;
    totalPathsCompleted: number;
    totalTimeSpent: number; // in minutes
    averageCompletionTime: number; // in days
    skillsAcquired: string[];
    completionRate: number;
  };
  currentPaths: {
    id: string;
    title: string;
    category: string;
    progressPercentage: number;
    timeSpent: number;
    estimatedTimeRemaining: number;
    lastAccessedAt?: Date;
    isOnTrack: boolean; // based on estimated completion date
  }[];
  completedPaths: {
    id: string;
    title: string;
    category: string;
    completedAt: Date;
    timeSpent: number;
    finalScore?: number;
    certificateIssued: boolean;
  }[];
  learningVelocity: {
    itemsCompletedLastWeek: number;
    itemsCompletedLastMonth: number;
    averageItemsPerWeek: number;
    timeSpentLastWeek: number;
    timeSpentLastMonth: number;
  };
  recommendations: {
    pathId: string;
    title: string;
    reason: string;
    confidenceScore: number;
  }[];
}

export interface OrganizationLearningAnalytics {
  organization: {
    id: string;
    totalUsers: number;
    activeUsers: number; // users with activity in last 30 days
    totalPathsCreated: number;
    totalEnrollments: number;
    totalCompletions: number;
  };
  pathPopularity: {
    pathId: string;
    title: string;
    category: string;
    enrollments: number;
    completions: number;
    averageRating: number;
    averageCompletionTime: number;
  }[];
  userEngagement: {
    highEngagement: number; // users with >80% avg progress
    mediumEngagement: number; // users with 40-80% avg progress
    lowEngagement: number; // users with <40% avg progress
    inactive: number; // users with no activity in 30 days
  };
  skillGaps: {
    skill: string;
    requiredBy: number; // number of paths requiring this skill
    usersWithSkill: number;
    gap: number; // percentage gap
  }[];
  departmentMetrics: {
    department: string;
    totalUsers: number;
    averageCompletionRate: number;
    averageTimeSpent: number;
    popularCategories: string[];
  }[];
}

export class ProgressTracker {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Update progress for a specific learning path item
   */
  async updateItemProgress(
    enrollmentId: string,
    itemId: string,
    progressData: ProgressUpdateInput,
    userId: string
  ): Promise<void> {
    try {
      const validatedData = ProgressUpdateSchema.parse(progressData);

      await this.prisma.$transaction(async (tx) => {
        // Verify enrollment belongs to user
        const enrollment = await tx.learningPathEnrollment.findFirst({
          where: {
            id: enrollmentId,
            userId,
          },
        });

        if (!enrollment) {
          throw new Error('Enrollment not found or access denied');
        }

        // Update item progress
        const existingProgress = await tx.learningPathItemProgress.findUnique({
          where: {
            enrollmentId_itemId: {
              enrollmentId,
              itemId,
            },
          },
        });

        if (!existingProgress) {
          throw new Error('Item progress not found');
        }

        const updatedProgress = await tx.learningPathItemProgress.update({
          where: {
            enrollmentId_itemId: {
              enrollmentId,
              itemId,
            },
          },
          data: {
            ...validatedData,
            lastAccessedAt: new Date(),
            ...(validatedData.status === 'COMPLETED' && {
              completedAt: existingProgress.completedAt || new Date(),
              progressPercentage: 100,
            }),
            ...(validatedData.status === 'IN_PROGRESS' && !existingProgress.startedAt && {
              startedAt: new Date(),
            }),
            attempts: validatedData.status === 'COMPLETED' ? existingProgress.attempts + 1 : existingProgress.attempts,
          },
        });

        // Update enrollment last accessed
        await tx.learningPathEnrollment.update({
          where: { id: enrollmentId },
          data: {
            lastAccessedAt: new Date(),
            timeSpent: {
              increment: validatedData.timeSpent || 0,
            },
          },
        });

        // Recalculate overall path progress
        await this.recalculatePathProgress(enrollmentId, tx);

        // Check if this unlocks next items
        await this.checkAndUnlockNextItems(enrollmentId, itemId, tx);
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to update progress: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get detailed progress report for a user's learning path enrollment
   */
  async getDetailedProgressReport(
    enrollmentId: string,
    userId: string
  ): Promise<DetailedProgressReport> {
    try {
      const enrollment = await this.prisma.learningPathEnrollment.findFirst({
        where: {
          id: enrollmentId,
          userId,
        },
        include: {
          learningPath: {
            include: {
              items: {
                orderBy: { orderIndex: 'asc' },
              },
            },
          },
          itemProgress: {
            include: {
              item: true,
            },
            orderBy: {
              item: {
                orderIndex: 'asc',
              },
            },
          },
        },
      });

      if (!enrollment) {
        throw new Error('Enrollment not found or access denied');
      }

      const totalItems = enrollment.learningPath.items.length;
      const requiredItems = enrollment.learningPath.items.filter(item => item.isRequired).length;
      const completedItems = enrollment.itemProgress.filter(p => p.status === 'COMPLETED').length;
      const completedRequiredItems = enrollment.itemProgress.filter(
        p => p.status === 'COMPLETED' && p.item.isRequired
      ).length;

      const scores = enrollment.itemProgress
        .filter(p => p.score !== null && p.score !== undefined)
        .map(p => p.score!);
      const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined;

      const timeSpentTotal = enrollment.itemProgress.reduce((sum, p) => sum + p.timeSpent, 0);
      const estimatedTimeRemaining = enrollment.learningPath.estimatedDuration - timeSpentTotal;

      // Find next item to complete
      const nextItem = enrollment.itemProgress.find(p =>
        p.status === 'NOT_STARTED' || p.status === 'IN_PROGRESS'
      );

      const report: DetailedProgressReport = {
        enrollment: {
          id: enrollment.id,
          userId: enrollment.userId,
          learningPathId: enrollment.learningPathId,
          status: enrollment.status,
          progressPercentage: enrollment.progressPercentage,
          enrolledAt: enrollment.enrolledAt,
          completedAt: enrollment.completedAt,
          timeSpent: enrollment.timeSpent,
          estimatedCompletionDate: enrollment.estimatedCompletionDate,
        },
        learningPath: {
          id: enrollment.learningPath.id,
          title: enrollment.learningPath.title,
          category: enrollment.learningPath.category,
          difficulty: enrollment.learningPath.difficulty,
          estimatedDuration: enrollment.learningPath.estimatedDuration,
          totalItems,
          requiredItems,
        },
        itemProgress: enrollment.itemProgress.map(progress => ({
          id: progress.id,
          itemId: progress.itemId,
          itemType: progress.item.itemType,
          title: progress.item.title,
          orderIndex: progress.item.orderIndex,
          isRequired: progress.item.isRequired,
          status: progress.status,
          progressPercentage: progress.progressPercentage,
          timeSpent: progress.timeSpent,
          score: progress.score,
          completedAt: progress.completedAt,
          estimatedDuration: progress.item.estimatedDuration,
        })),
        summary: {
          completedItems,
          totalItems,
          completedRequiredItems,
          totalRequiredItems: requiredItems,
          averageScore,
          timeSpentTotal,
          estimatedTimeRemaining: Math.max(0, estimatedTimeRemaining),
          nextItem: nextItem ? {
            id: nextItem.itemId,
            title: nextItem.item.title,
            itemType: nextItem.item.itemType,
            estimatedDuration: nextItem.item.estimatedDuration,
          } : undefined,
        },
      };

      return report;
    } catch (error) {
      throw new Error(`Failed to get progress report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get analytics for a specific learning path
   */
  async getLearningPathAnalytics(
    pathId: string,
    filters: AnalyticsFiltersInput = {}
  ): Promise<LearningPathAnalytics> {
    try {
      const validatedFilters = AnalyticsFilters.parse(filters);

      // Base where clause for enrollments
      const enrollmentWhere: any = {
        learningPathId: pathId,
        ...(validatedFilters.dateFrom && {
          enrolledAt: { gte: validatedFilters.dateFrom },
        }),
        ...(validatedFilters.dateTo && {
          enrolledAt: { lte: validatedFilters.dateTo },
        }),
        ...(validatedFilters.status && {
          status: validatedFilters.status,
        }),
      };

      // Get path metrics
      const [
        totalEnrollments,
        activeEnrollments,
        completedEnrollments,
        avgCompletionTime,
        avgProgress,
      ] = await Promise.all([
        this.prisma.learningPathEnrollment.count({
          where: enrollmentWhere,
        }),
        this.prisma.learningPathEnrollment.count({
          where: { ...enrollmentWhere, status: 'ACTIVE' },
        }),
        this.prisma.learningPathEnrollment.count({
          where: { ...enrollmentWhere, status: 'COMPLETED' },
        }),
        this.prisma.learningPathEnrollment.aggregate({
          where: {
            ...enrollmentWhere,
            status: 'COMPLETED',
            completedAt: { not: null },
          },
          _avg: {
            timeSpent: true,
          },
        }),
        this.prisma.learningPathEnrollment.aggregate({
          where: enrollmentWhere,
          _avg: {
            progressPercentage: true,
          },
        }),
      ]);

      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;
      const dropoutRate = 100 - completionRate;

      // Get item metrics
      const pathItems = await this.prisma.learningPathItem.findMany({
        where: { learningPathId: pathId },
        include: {
          _count: {
            select: {
              progress: {
                where: { status: 'COMPLETED' },
              },
            },
          },
        },
      });

      const itemMetrics = await Promise.all(
        pathItems.map(async (item) => {
          const itemProgress = await this.prisma.learningPathItemProgress.aggregate({
            where: {
              itemId: item.id,
              status: 'COMPLETED',
            },
            _avg: {
              timeSpent: true,
              score: true,
            },
            _count: true,
          });

          const totalEnrollmentsForItem = await this.prisma.learningPathItemProgress.count({
            where: { itemId: item.id },
          });

          const completionRateForItem = totalEnrollmentsForItem > 0
            ? (itemProgress._count / totalEnrollmentsForItem) * 100
            : 0;

          // Calculate difficulty rating based on completion time and scores
          const avgTime = itemProgress._avg.timeSpent || 0;
          const avgScore = itemProgress._avg.score || 0;
          const expectedTime = item.estimatedDuration || 1;
          const timeRatio = avgTime / expectedTime;
          const difficultyRating = Math.min(10, Math.max(1,
            (timeRatio * 5) + ((100 - avgScore) / 10)
          ));

          return {
            itemId: item.id,
            itemType: item.itemType,
            title: item.title,
            averageCompletionTime: avgTime,
            completionRate: completionRateForItem,
            averageScore: itemProgress._avg.score,
            difficultyRating: Math.round(difficultyRating * 10) / 10,
          };
        })
      );

      // Get progress distribution
      const progressRanges = [
        { min: 0, max: 10, label: '0-10%' },
        { min: 11, max: 20, label: '11-20%' },
        { min: 21, max: 30, label: '21-30%' },
        { min: 31, max: 40, label: '31-40%' },
        { min: 41, max: 50, label: '41-50%' },
        { min: 51, max: 60, label: '51-60%' },
        { min: 61, max: 70, label: '61-70%' },
        { min: 71, max: 80, label: '71-80%' },
        { min: 81, max: 90, label: '81-90%' },
        { min: 91, max: 100, label: '91-100%' },
      ];

      const progressDistribution = await Promise.all(
        progressRanges.map(async (range) => {
          const count = await this.prisma.learningPathEnrollment.count({
            where: {
              ...enrollmentWhere,
              progressPercentage: {
                gte: range.min,
                lte: range.max,
              },
            },
          });

          return {
            range: range.label,
            count,
            percentage: totalEnrollments > 0 ? (count / totalEnrollments) * 100 : 0,
          };
        })
      );

      // Get time analytics (simplified for now)
      const timeAnalytics = {
        averageSessionDuration: avgCompletionTime._avg.timeSpent || 0,
        peakActivityHours: [9, 14, 20], // Mock data - would need session tracking
        weeklyActivity: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          averageTimeSpent: (avgCompletionTime._avg.timeSpent || 0) / 7,
          sessionsCount: Math.floor(totalEnrollments / 7),
        })),
      };

      return {
        pathMetrics: {
          totalEnrollments,
          activeEnrollments,
          completedEnrollments,
          averageCompletionTime: (avgCompletionTime._avg.timeSpent || 0) / (24 * 60), // Convert to days
          averageProgressPercentage: avgProgress._avg.progressPercentage || 0,
          completionRate,
          dropoutRate,
        },
        itemMetrics,
        progressDistribution,
        timeAnalytics,
      };
    } catch (error) {
      throw new Error(`Failed to get learning path analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get comprehensive analytics for a user's learning progress
   */
  async getUserLearningAnalytics(
    userId: string,
    organizationId?: string
  ): Promise<UserLearningAnalytics> {
    try {
      // Get user's enrollment data
      const enrollments = await this.prisma.learningPathEnrollment.findMany({
        where: {
          userId,
          ...(organizationId && {
            learningPath: {
              organizationId,
            },
          }),
        },
        include: {
          learningPath: {
            select: {
              id: true,
              title: true,
              category: true,
              estimatedDuration: true,
              skills: true,
            },
          },
          itemProgress: {
            where: { status: 'COMPLETED' },
          },
        },
      });

      const totalPathsEnrolled = enrollments.length;
      const totalPathsCompleted = enrollments.filter(e => e.status === 'COMPLETED').length;
      const totalTimeSpent = enrollments.reduce((sum, e) => sum + e.timeSpent, 0);

      // Calculate completion rate
      const completionRate = totalPathsEnrolled > 0 ? (totalPathsCompleted / totalPathsEnrolled) * 100 : 0;

      // Calculate average completion time
      const completedEnrollments = enrollments.filter(e => e.completedAt && e.startedAt);
      const averageCompletionTime = completedEnrollments.length > 0
        ? completedEnrollments.reduce((sum, e) => {
            const days = (e.completedAt!.getTime() - e.startedAt!.getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / completedEnrollments.length
        : 0;

      // Get acquired skills
      const skillsAcquired = [...new Set(
        enrollments
          .filter(e => e.status === 'COMPLETED')
          .flatMap(e => e.learningPath.skills || [])
      )];

      // Get current active paths
      const currentPaths = enrollments
        .filter(e => e.status === 'ACTIVE')
        .map(e => {
          const estimatedTimeRemaining = e.learningPath.estimatedDuration - e.timeSpent;
          const isOnTrack = !e.estimatedCompletionDate ||
            e.estimatedCompletionDate.getTime() > Date.now();

          return {
            id: e.learningPathId,
            title: e.learningPath.title,
            category: e.learningPath.category,
            progressPercentage: e.progressPercentage,
            timeSpent: e.timeSpent,
            estimatedTimeRemaining: Math.max(0, estimatedTimeRemaining),
            lastAccessedAt: e.lastAccessedAt,
            isOnTrack,
          };
        });

      // Get completed paths
      const completedPaths = enrollments
        .filter(e => e.status === 'COMPLETED')
        .map(e => ({
          id: e.learningPathId,
          title: e.learningPath.title,
          category: e.learningPath.category,
          completedAt: e.completedAt!,
          timeSpent: e.timeSpent,
          finalScore: e.completionScore,
          certificateIssued: false, // Would need to check certificates table
        }));

      // Calculate learning velocity
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const itemsCompletedLastWeek = await this.prisma.learningPathItemProgress.count({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { gte: oneWeekAgo },
        },
      });

      const itemsCompletedLastMonth = await this.prisma.learningPathItemProgress.count({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { gte: oneMonthAgo },
        },
      });

      const timeSpentLastWeek = await this.prisma.learningPathItemProgress.aggregate({
        where: {
          userId,
          lastAccessedAt: { gte: oneWeekAgo },
        },
        _sum: { timeSpent: true },
      });

      const timeSpentLastMonth = await this.prisma.learningPathItemProgress.aggregate({
        where: {
          userId,
          lastAccessedAt: { gte: oneMonthAgo },
        },
        _sum: { timeSpent: true },
      });

      const learningVelocity = {
        itemsCompletedLastWeek,
        itemsCompletedLastMonth,
        averageItemsPerWeek: itemsCompletedLastMonth / 4,
        timeSpentLastWeek: timeSpentLastWeek._sum.timeSpent || 0,
        timeSpentLastMonth: timeSpentLastMonth._sum.timeSpent || 0,
      };

      // Mock recommendations (would be more sophisticated in real implementation)
      const recommendations = [
        {
          pathId: 'mock-path-1',
          title: 'Advanced JavaScript Concepts',
          reason: 'Based on your completed frontend paths',
          confidenceScore: 0.85,
        },
        {
          pathId: 'mock-path-2',
          title: 'Database Design Fundamentals',
          reason: 'Complements your backend development skills',
          confidenceScore: 0.72,
        },
      ];

      return {
        user: {
          id: userId,
          totalPathsEnrolled,
          totalPathsCompleted,
          totalTimeSpent,
          averageCompletionTime,
          skillsAcquired,
          completionRate,
        },
        currentPaths,
        completedPaths,
        learningVelocity,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to get user learning analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get organization-wide learning analytics
   */
  async getOrganizationLearningAnalytics(
    organizationId: string,
    filters: AnalyticsFiltersInput = {}
  ): Promise<OrganizationLearningAnalytics> {
    try {
      // Get basic organization metrics
      const [
        totalUsers,
        activeUsers,
        totalPathsCreated,
        totalEnrollments,
        totalCompletions,
      ] = await Promise.all([
        this.prisma.user.count({
          where: { organizationId },
        }),
        this.prisma.user.count({
          where: {
            organizationId,
            lastLoginAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        }),
        this.prisma.learningPath.count({
          where: { organizationId },
        }),
        this.prisma.learningPathEnrollment.count({
          where: {
            learningPath: { organizationId },
          },
        }),
        this.prisma.learningPathEnrollment.count({
          where: {
            learningPath: { organizationId },
            status: 'COMPLETED',
          },
        }),
      ]);

      // Get path popularity
      const pathPopularity = await this.prisma.learningPath.findMany({
        where: { organizationId },
        select: {
          id: true,
          title: true,
          category: true,
          enrollmentCount: true,
          completionCount: true,
          averageRating: true,
          estimatedDuration: true,
          _count: {
            select: {
              enrollments: {
                where: { status: 'COMPLETED' },
              },
            },
          },
        },
        orderBy: { enrollmentCount: 'desc' },
        take: 20,
      });

      // Get user engagement levels
      const enrollmentStats = await this.prisma.learningPathEnrollment.groupBy({
        by: ['userId'],
        where: {
          learningPath: { organizationId },
        },
        _avg: {
          progressPercentage: true,
        },
        _count: true,
      });

      const userEngagement = {
        highEngagement: enrollmentStats.filter(stat => (stat._avg.progressPercentage || 0) > 80).length,
        mediumEngagement: enrollmentStats.filter(stat => {
          const avg = stat._avg.progressPercentage || 0;
          return avg >= 40 && avg <= 80;
        }).length,
        lowEngagement: enrollmentStats.filter(stat => (stat._avg.progressPercentage || 0) < 40).length,
        inactive: totalUsers - enrollmentStats.length,
      };

      // Mock skill gaps and department metrics (would require more complex queries)
      const skillGaps = [
        { skill: 'JavaScript', requiredBy: 15, usersWithSkill: 8, gap: 46.7 },
        { skill: 'Python', requiredBy: 12, usersWithSkill: 5, gap: 58.3 },
        { skill: 'Data Analysis', requiredBy: 8, usersWithSkill: 3, gap: 62.5 },
      ];

      const departmentMetrics = [
        {
          department: 'Engineering',
          totalUsers: Math.floor(totalUsers * 0.4),
          averageCompletionRate: 75.5,
          averageTimeSpent: 120,
          popularCategories: ['Programming', 'DevOps', 'System Design'],
        },
        {
          department: 'Product',
          totalUsers: Math.floor(totalUsers * 0.3),
          averageCompletionRate: 68.2,
          averageTimeSpent: 95,
          popularCategories: ['Product Management', 'Analytics', 'UX Design'],
        },
      ];

      return {
        organization: {
          id: organizationId,
          totalUsers,
          activeUsers,
          totalPathsCreated,
          totalEnrollments,
          totalCompletions,
        },
        pathPopularity: pathPopularity.map(path => ({
          pathId: path.id,
          title: path.title,
          category: path.category,
          enrollments: path.enrollmentCount,
          completions: path.completionCount,
          averageRating: path.averageRating,
          averageCompletionTime: path.estimatedDuration / (24 * 60), // Convert to days
        })),
        userEngagement,
        skillGaps,
        departmentMetrics,
      };
    } catch (error) {
      throw new Error(`Failed to get organization analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Recalculate learning path progress based on item completion
   */
  private async recalculatePathProgress(enrollmentId: string, tx: any): Promise<void> {
    // Get all required items and their progress
    const enrollment = await tx.learningPathEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        learningPath: {
          include: {
            items: {
              where: { isRequired: true },
            },
          },
        },
        itemProgress: {
          include: {
            item: true,
          },
        },
      },
    });

    if (!enrollment) return;

    const requiredItems = enrollment.learningPath.items;
    const completedItems = enrollment.itemProgress.filter(
      progress => progress.status === 'COMPLETED' && progress.item.isRequired
    );

    const progressPercentage = requiredItems.length > 0
      ? (completedItems.length / requiredItems.length) * 100
      : 100;

    const allCompleted = progressPercentage === 100;
    const hasStarted = enrollment.itemProgress.some(p => p.status !== 'NOT_STARTED');

    await tx.learningPathEnrollment.update({
      where: { id: enrollmentId },
      data: {
        progressPercentage,
        status: allCompleted ? 'COMPLETED' : hasStarted ? 'ACTIVE' : 'ACTIVE',
        completedAt: allCompleted && !enrollment.completedAt ? new Date() : enrollment.completedAt,
        startedAt: hasStarted && !enrollment.startedAt ? new Date() : enrollment.startedAt,
      },
    });

    // Update completion count for the path
    if (allCompleted && !enrollment.completedAt) {
      await tx.learningPath.update({
        where: { id: enrollment.learningPathId },
        data: {
          completionCount: {
            increment: 1,
          },
        },
      });
    }
  }

  /**
   * Check and unlock next items based on prerequisites
   */
  private async checkAndUnlockNextItems(
    enrollmentId: string,
    completedItemId: string,
    tx: any
  ): Promise<void> {
    // Find items that have this item as a prerequisite
    const dependentItems = await tx.learningPathItem.findMany({
      where: {
        prerequisites: {
          has: completedItemId,
        },
      },
    });

    for (const item of dependentItems) {
      // Check if all prerequisites are met
      const prerequisiteProgress = await tx.learningPathItemProgress.findMany({
        where: {
          enrollmentId,
          itemId: { in: item.prerequisites },
        },
      });

      const allPrerequisitesMet = prerequisiteProgress.every(p => p.status === 'COMPLETED');

      if (allPrerequisitesMet) {
        // Update item status to make it available
        await tx.learningPathItemProgress.updateMany({
          where: {
            enrollmentId,
            itemId: item.id,
            status: 'NOT_STARTED',
          },
          data: {
            status: 'NOT_STARTED', // Keep as NOT_STARTED but now available
            // Could add an 'isAvailable' field to track this
          },
        });
      }
    }
  }
}

export default ProgressTracker;