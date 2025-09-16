import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import {
  LearningPath,
  Course,
  User,
  PathProgress,
  PathPrerequisite
} from '@prisma/client';

export interface LearningPathWithDetails extends LearningPath {
  courses: Course[];
  prerequisites: PathPrerequisite[];
  enrolledUsers: User[];
  progress?: PathProgress[];
}

export interface PathCreationData {
  title: string;
  description: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimatedHours: number;
  courseIds: string[];
  prerequisites: {
    pathId?: string;
    skillLevel?: number;
    requiredCourses?: string[];
  }[];
  tags: string[];
  isPublic: boolean;
  price?: number;
}

export interface PathAnalytics {
  enrollmentCount: number;
  completionRate: number;
  averageRating: number;
  totalRatings: number;
  popularTags: string[];
  completionTimeStats: {
    average: number;
    median: number;
    fastest: number;
    slowest: number;
  };
}

class LearningPathService {
  private cachePrefix = 'learning_path:';
  private cacheTTL = 3600; // 1 hour

  /**
   * Create a new learning path with prerequisites
   */
  async createPath(
    creatorId: string,
    data: PathCreationData
  ): Promise<LearningPathWithDetails> {
    // Validate prerequisites and courses exist
    await this.validatePrerequisites(data.prerequisites);
    await this.validateCourses(data.courseIds);

    const path = await prisma.$transaction(async (tx) => {
      // Create the learning path
      const newPath = await tx.learningPath.create({
        data: {
          title: data.title,
          description: data.description,
          level: data.level,
          estimatedHours: data.estimatedHours,
          tags: data.tags,
          isPublic: data.isPublic,
          price: data.price || 0,
          creatorId,
          order: await this.getNextOrder(tx)
        }
      });

      // Add courses to path with order
      await Promise.all(
        data.courseIds.map((courseId, index) =>
          tx.pathCourse.create({
            data: {
              pathId: newPath.id,
              courseId,
              order: index + 1,
              isRequired: true
            }
          })
        )
      );

      // Add prerequisites
      if (data.prerequisites.length > 0) {
        await Promise.all(
          data.prerequisites.map(prereq =>
            tx.pathPrerequisite.create({
              data: {
                pathId: newPath.id,
                requiredPathId: prereq.pathId,
                requiredSkillLevel: prereq.skillLevel,
                requiredCourses: prereq.requiredCourses || []
              }
            })
          )
        );
      }

      return newPath;
    });

    // Clear cache
    await this.clearPathCache();

    return this.getPathById(path.id);
  }

  /**
   * Get learning path by ID with all details
   */
  async getPathById(pathId: string): Promise<LearningPathWithDetails | null> {
    const cacheKey = `${this.cachePrefix}${pathId}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
      include: {
        courses: {
          include: {
            course: {
              include: {
                instructor: {
                  select: { id: true, name: true, email: true }
                },
                _count: {
                  select: { enrollments: true, lessons: true }
                }
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        prerequisites: {
          include: {
            requiredPath: {
              select: { id: true, title: true, level: true }
            }
          }
        },
        enrolledUsers: {
          select: { id: true, name: true, email: true },
          take: 10
        },
        creator: {
          select: { id: true, name: true, email: true }
        },
        _count: {
          select: {
            enrollments: true,
            ratings: true,
            completions: true
          }
        }
      }
    });

    if (!path) return null;

    const pathWithDetails = {
      ...path,
      courses: path.courses.map(pc => pc.course)
    } as LearningPathWithDetails;

    // Cache result
    await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(pathWithDetails));

    return pathWithDetails;
  }

  /**
   * Get user's learning paths with progress
   */
  async getUserPaths(
    userId: string,
    filters?: {
      level?: string;
      status?: 'enrolled' | 'completed' | 'available';
      tags?: string[];
    }
  ): Promise<LearningPathWithDetails[]> {
    const where: any = {};

    if (filters?.level) {
      where.level = filters.level;
    }

    if (filters?.tags?.length) {
      where.tags = {
        hasSome: filters.tags
      };
    }

    let paths = await prisma.learningPath.findMany({
      where,
      include: {
        courses: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                description: true,
                thumbnailUrl: true,
                level: true,
                duration: true
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        enrollments: {
          where: { userId },
          include: {
            progress: true
          }
        },
        prerequisites: {
          include: {
            requiredPath: {
              select: { id: true, title: true }
            }
          }
        }
      },
      orderBy: [
        { isPublic: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    // Filter by enrollment status
    if (filters?.status) {
      paths = paths.filter(path => {
        const isEnrolled = path.enrollments.length > 0;
        const isCompleted = path.enrollments.some(e => e.completedAt);

        switch (filters.status) {
          case 'enrolled':
            return isEnrolled && !isCompleted;
          case 'completed':
            return isCompleted;
          case 'available':
            return !isEnrolled;
          default:
            return true;
        }
      });
    }

    return paths.map(path => ({
      ...path,
      courses: path.courses.map(pc => pc.course),
      progress: path.enrollments[0]?.progress || []
    })) as LearningPathWithDetails[];
  }

  /**
   * Enroll user in learning path
   */
  async enrollUser(userId: string, pathId: string): Promise<void> {
    // Check prerequisites
    const canEnroll = await this.checkPrerequisites(userId, pathId);
    if (!canEnroll.eligible) {
      throw new Error(`Prerequisites not met: ${canEnroll.missingRequirements.join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      // Check if already enrolled
      const existingEnrollment = await tx.pathEnrollment.findUnique({
        where: {
          userId_pathId: {
            userId,
            pathId
          }
        }
      });

      if (existingEnrollment) {
        throw new Error('Already enrolled in this learning path');
      }

      // Create enrollment
      await tx.pathEnrollment.create({
        data: {
          userId,
          pathId,
          enrolledAt: new Date()
        }
      });

      // Auto-enroll in first course if it exists
      const firstCourse = await tx.pathCourse.findFirst({
        where: { pathId },
        orderBy: { order: 'asc' }
      });

      if (firstCourse) {
        const existingCourseEnrollment = await tx.courseEnrollment.findUnique({
          where: {
            userId_courseId: {
              userId,
              courseId: firstCourse.courseId
            }
          }
        });

        if (!existingCourseEnrollment) {
          await tx.courseEnrollment.create({
            data: {
              userId,
              courseId: firstCourse.courseId,
              enrolledAt: new Date()
            }
          });
        }
      }
    });

    // Clear user's cache
    await this.clearUserCache(userId);
  }

  /**
   * Update path progress when user completes a course
   */
  async updateProgress(
    userId: string,
    pathId: string,
    courseId: string
  ): Promise<void> {
    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
      include: {
        courses: {
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!path) throw new Error('Learning path not found');

    const courseIndex = path.courses.findIndex(pc => pc.courseId === courseId);
    if (courseIndex === -1) throw new Error('Course not part of this path');

    await prisma.$transaction(async (tx) => {
      // Update progress
      await tx.pathProgress.upsert({
        where: {
          userId_pathId_courseId: {
            userId,
            pathId,
            courseId
          }
        },
        update: {
          completedAt: new Date(),
          score: 100
        },
        create: {
          userId,
          pathId,
          courseId,
          completedAt: new Date(),
          score: 100
        }
      });

      // Check if path is completed
      const completedCourses = await tx.pathProgress.count({
        where: {
          userId,
          pathId,
          completedAt: { not: null }
        }
      });

      if (completedCourses >= path.courses.length) {
        // Mark path as completed
        await tx.pathEnrollment.update({
          where: {
            userId_pathId: {
              userId,
              pathId
            }
          },
          data: {
            completedAt: new Date(),
            completionScore: 100
          }
        });

        // Award path completion badge
        await this.awardPathBadge(tx, userId, pathId);
      } else {
        // Auto-enroll in next course
        const nextCourse = path.courses[courseIndex + 1];
        if (nextCourse) {
          const existingEnrollment = await tx.courseEnrollment.findUnique({
            where: {
              userId_courseId: {
                userId,
                courseId: nextCourse.courseId
              }
            }
          });

          if (!existingEnrollment) {
            await tx.courseEnrollment.create({
              data: {
                userId,
                courseId: nextCourse.courseId,
                enrolledAt: new Date()
              }
            });
          }
        }
      }
    });

    await this.clearUserCache(userId);
  }

  /**
   * Check if user meets prerequisites for a learning path
   */
  async checkPrerequisites(
    userId: string,
    pathId: string
  ): Promise<{
    eligible: boolean;
    missingRequirements: string[];
    progress: any;
  }> {
    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
      include: {
        prerequisites: {
          include: {
            requiredPath: true
          }
        }
      }
    });

    if (!path || !path.prerequisites.length) {
      return { eligible: true, missingRequirements: [], progress: null };
    }

    const missingRequirements: string[] = [];
    const progress: any = {};

    for (const prereq of path.prerequisites) {
      if (prereq.requiredPathId) {
        const completion = await prisma.pathEnrollment.findFirst({
          where: {
            userId,
            pathId: prereq.requiredPathId,
            completedAt: { not: null }
          }
        });

        if (!completion) {
          missingRequirements.push(`Complete ${prereq.requiredPath?.title}`);
        }
      }

      if (prereq.requiredCourses?.length) {
        const completedCourses = await prisma.courseEnrollment.findMany({
          where: {
            userId,
            courseId: { in: prereq.requiredCourses },
            completedAt: { not: null }
          }
        });

        const missingCourses = prereq.requiredCourses.filter(
          courseId => !completedCourses.some(c => c.courseId === courseId)
        );

        if (missingCourses.length > 0) {
          const courses = await prisma.course.findMany({
            where: { id: { in: missingCourses } },
            select: { title: true }
          });

          missingRequirements.push(
            `Complete courses: ${courses.map(c => c.title).join(', ')}`
          );
        }
      }
    }

    return {
      eligible: missingRequirements.length === 0,
      missingRequirements,
      progress
    };
  }

  /**
   * Get learning path analytics
   */
  async getPathAnalytics(pathId: string): Promise<PathAnalytics> {
    const cacheKey = `${this.cachePrefix}analytics:${pathId}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [
      enrollmentCount,
      completionCount,
      ratings,
      completionTimes
    ] = await Promise.all([
      prisma.pathEnrollment.count({
        where: { pathId }
      }),
      prisma.pathEnrollment.count({
        where: {
          pathId,
          completedAt: { not: null }
        }
      }),
      prisma.pathRating.findMany({
        where: { pathId },
        select: { rating: true }
      }),
      prisma.pathEnrollment.findMany({
        where: {
          pathId,
          completedAt: { not: null }
        },
        select: {
          enrolledAt: true,
          completedAt: true
        }
      })
    ]);

    const completionRate = enrollmentCount > 0
      ? (completionCount / enrollmentCount) * 100
      : 0;

    const averageRating = ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : 0;

    const completionDurations = completionTimes.map(ct =>
      Math.floor((ct.completedAt!.getTime() - ct.enrolledAt.getTime()) / (1000 * 60 * 60))
    );

    const analytics: PathAnalytics = {
      enrollmentCount,
      completionRate: Math.round(completionRate * 100) / 100,
      averageRating: Math.round(averageRating * 100) / 100,
      totalRatings: ratings.length,
      popularTags: [], // TODO: Calculate from path tags
      completionTimeStats: {
        average: completionDurations.length > 0
          ? Math.round(completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length)
          : 0,
        median: this.calculateMedian(completionDurations),
        fastest: Math.min(...completionDurations) || 0,
        slowest: Math.max(...completionDurations) || 0
      }
    };

    await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(analytics));

    return analytics;
  }

  /**
   * Get trending learning paths
   */
  async getTrendingPaths(limit: number = 10): Promise<LearningPathWithDetails[]> {
    const cacheKey = `${this.cachePrefix}trending:${limit}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get paths with highest enrollment in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trending = await prisma.learningPath.findMany({
      where: {
        isPublic: true,
        enrollments: {
          some: {
            enrolledAt: { gte: thirtyDaysAgo }
          }
        }
      },
      include: {
        courses: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                thumbnailUrl: true
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        _count: {
          select: { enrollments: true }
        }
      },
      orderBy: {
        enrollments: {
          _count: 'desc'
        }
      },
      take: limit
    });

    const result = trending.map(path => ({
      ...path,
      courses: path.courses.map(pc => pc.course)
    })) as LearningPathWithDetails[];

    await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));

    return result;
  }

  // Helper methods
  private async validatePrerequisites(prerequisites: any[]): Promise<void> {
    for (const prereq of prerequisites) {
      if (prereq.pathId) {
        const exists = await prisma.learningPath.findUnique({
          where: { id: prereq.pathId }
        });
        if (!exists) {
          throw new Error(`Prerequisite path not found: ${prereq.pathId}`);
        }
      }

      if (prereq.requiredCourses?.length) {
        const courses = await prisma.course.findMany({
          where: { id: { in: prereq.requiredCourses } }
        });
        if (courses.length !== prereq.requiredCourses.length) {
          throw new Error('Some required courses not found');
        }
      }
    }
  }

  private async validateCourses(courseIds: string[]): Promise<void> {
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } }
    });

    if (courses.length !== courseIds.length) {
      throw new Error('Some courses not found');
    }
  }

  private async getNextOrder(tx: any): Promise<number> {
    const lastPath = await tx.learningPath.findFirst({
      orderBy: { order: 'desc' }
    });
    return (lastPath?.order || 0) + 1;
  }

  private async awardPathBadge(tx: any, userId: string, pathId: string): Promise<void> {
    const path = await tx.learningPath.findUnique({
      where: { id: pathId },
      select: { title: true, level: true }
    });

    if (path) {
      await tx.badge.create({
        data: {
          userId,
          name: `Path Completion: ${path.title}`,
          description: `Completed the ${path.level.toLowerCase()} learning path: ${path.title}`,
          type: 'PATH_COMPLETION',
          iconUrl: '/badges/path-completion.svg',
          earnedAt: new Date()
        }
      });
    }
  }

  private calculateMedian(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  private async clearPathCache(): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  private async clearUserCache(userId: string): Promise<void> {
    const keys = await redis.keys(`user:${userId}:paths:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export const learningPathService = new LearningPathService();