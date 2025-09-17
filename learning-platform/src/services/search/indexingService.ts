import { elasticsearchClient } from './elasticsearchClient';
import { logger } from '../logger';
import { prisma } from '../../lib/db';

export interface IndexingOptions {
  batchSize?: number;
  delay?: number;
  skipExisting?: boolean;
  updateOnly?: boolean;
}

export interface IndexingStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  errors: Array<{
    id: string;
    error: string;
  }>;
}

class IndexingService {
  private readonly DEFAULT_BATCH_SIZE = 100;
  private readonly DEFAULT_DELAY = 100; // ms between batches

  async indexCourses(options: IndexingOptions = {}): Promise<IndexingStats> {
    const {
      batchSize = this.DEFAULT_BATCH_SIZE,
      delay = this.DEFAULT_DELAY,
      skipExisting = false,
      updateOnly = false
    } = options;

    const stats: IndexingStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: new Date(),
      errors: []
    };

    try {
      logger.info('Starting course indexing', { batchSize, skipExisting, updateOnly });

      // Get total count
      const totalCourses = await prisma.course.count({
        where: { isPublished: true }
      });

      let offset = 0;
      const operations: any[] = [];

      while (offset < totalCourses) {
        const courses = await prisma.course.findMany({
          where: { isPublished: true },
          include: {
            instructor: {
              select: {
                id: true,
                profile: {
                  select: {
                    firstName: true,
                    lastName: true
                  }
                },
                _avg: {
                  rating: true
                }
              }
            },
            categories: {
              select: {
                category: {
                  select: {
                    name: true
                  }
                }
              }
            },
            tags: {
              select: {
                tag: {
                  select: {
                    name: true
                  }
                }
              }
            },
            lessons: {
              select: {
                duration: true
              }
            },
            enrollments: {
              select: {
                id: true,
                progress: true
              }
            },
            reviews: {
              select: {
                rating: true
              }
            },
            _count: {
              select: {
                enrollments: true,
                reviews: true
              }
            }
          },
          skip: offset,
          take: batchSize
        });

        for (const course of courses) {
          try {
            // Check if document exists when skipExisting is true
            if (skipExisting) {
              const exists = await this.documentExists(
                elasticsearchClient.indexes.courses,
                course.id
              );
              if (exists) {
                continue;
              }
            }

            const indexDoc = await this.prepareCourseDocument(course);

            // Add to bulk operations
            operations.push(
              { index: { _index: elasticsearchClient.indexes.courses, _id: course.id } },
              indexDoc
            );

            stats.totalProcessed++;
          } catch (error) {
            stats.failed++;
            stats.errors.push({
              id: course.id,
              error: error instanceof Error ? error.message : String(error)
            });
            logger.error('Failed to prepare course document', { courseId: course.id, error });
          }
        }

        // Execute bulk operation if we have documents
        if (operations.length > 0) {
          try {
            const response = await elasticsearchClient.bulkIndex(operations);

            // Count successful operations
            response.items.forEach((item: any) => {
              if (item.index?.error || item.update?.error) {
                stats.failed++;
              } else {
                stats.successful++;
              }
            });

            operations.length = 0; // Clear the array
          } catch (error) {
            stats.failed += operations.length / 2; // Each document has 2 operations
            logger.error('Bulk indexing failed', { error });
          }
        }

        offset += batchSize;

        // Add delay between batches to avoid overwhelming Elasticsearch
        if (delay > 0 && offset < totalCourses) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        logger.info('Course indexing progress', {
          processed: stats.totalProcessed,
          total: totalCourses,
          percentage: Math.round((offset / totalCourses) * 100)
        });
      }

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      logger.info('Course indexing completed', {
        totalProcessed: stats.totalProcessed,
        successful: stats.successful,
        failed: stats.failed,
        duration: stats.duration
      });

      return stats;

    } catch (error) {
      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
      logger.error('Course indexing failed', { error, stats });
      throw error;
    }
  }

  async indexLessons(options: IndexingOptions = {}): Promise<IndexingStats> {
    const {
      batchSize = this.DEFAULT_BATCH_SIZE,
      delay = this.DEFAULT_DELAY
    } = options;

    const stats: IndexingStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: new Date(),
      errors: []
    };

    try {
      logger.info('Starting lesson indexing');

      const totalLessons = await prisma.lesson.count({
        where: {
          course: {
            isPublished: true
          }
        }
      });

      let offset = 0;
      const operations: any[] = [];

      while (offset < totalLessons) {
        const lessons = await prisma.lesson.findMany({
          where: {
            course: {
              isPublished: true
            }
          },
          include: {
            course: {
              select: {
                id: true,
                title: true,
                category: true
              }
            },
            attachments: {
              select: {
                name: true,
                type: true,
                url: true
              }
            }
          },
          skip: offset,
          take: batchSize
        });

        for (const lesson of lessons) {
          try {
            const indexDoc = this.prepareLessonDocument(lesson);

            operations.push(
              { index: { _index: elasticsearchClient.indexes.lessons, _id: lesson.id } },
              indexDoc
            );

            stats.totalProcessed++;
          } catch (error) {
            stats.failed++;
            stats.errors.push({
              id: lesson.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        if (operations.length > 0) {
          try {
            const response = await elasticsearchClient.bulkIndex(operations);

            response.items.forEach((item: any) => {
              if (item.index?.error) {
                stats.failed++;
              } else {
                stats.successful++;
              }
            });

            operations.length = 0;
          } catch (error) {
            stats.failed += operations.length / 2;
            logger.error('Lesson bulk indexing failed', { error });
          }
        }

        offset += batchSize;

        if (delay > 0 && offset < totalLessons) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      logger.info('Lesson indexing completed', stats);
      return stats;

    } catch (error) {
      stats.endTime = new Date();
      logger.error('Lesson indexing failed', { error });
      throw error;
    }
  }

  async indexResources(options: IndexingOptions = {}): Promise<IndexingStats> {
    const {
      batchSize = this.DEFAULT_BATCH_SIZE,
      delay = this.DEFAULT_DELAY
    } = options;

    const stats: IndexingStats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: new Date(),
      errors: []
    };

    try {
      logger.info('Starting resource indexing');

      const totalResources = await prisma.resource.count({
        where: { isActive: true }
      });

      let offset = 0;
      const operations: any[] = [];

      while (offset < totalResources) {
        const resources = await prisma.resource.findMany({
          where: { isActive: true },
          include: {
            tags: {
              select: {
                tag: {
                  select: {
                    name: true
                  }
                }
              }
            },
            downloads: {
              select: {
                id: true
              }
            },
            reviews: {
              select: {
                rating: true
              }
            }
          },
          skip: offset,
          take: batchSize
        });

        for (const resource of resources) {
          try {
            const indexDoc = this.prepareResourceDocument(resource);

            operations.push(
              { index: { _index: elasticsearchClient.indexes.resources, _id: resource.id } },
              indexDoc
            );

            stats.totalProcessed++;
          } catch (error) {
            stats.failed++;
            stats.errors.push({
              id: resource.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        if (operations.length > 0) {
          try {
            const response = await elasticsearchClient.bulkIndex(operations);

            response.items.forEach((item: any) => {
              if (item.index?.error) {
                stats.failed++;
              } else {
                stats.successful++;
              }
            });

            operations.length = 0;
          } catch (error) {
            stats.failed += operations.length / 2;
            logger.error('Resource bulk indexing failed', { error });
          }
        }

        offset += batchSize;

        if (delay > 0 && offset < totalResources) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      logger.info('Resource indexing completed', stats);
      return stats;

    } catch (error) {
      stats.endTime = new Date();
      logger.error('Resource indexing failed', { error });
      throw error;
    }
  }

  async indexUser(userId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          enrollments: {
            where: { isActive: true },
            select: {
              courseId: true,
              progress: true,
              completedAt: true
            }
          },
          searchHistory: {
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
              query: true,
              createdAt: true,
              clickedResults: true
            }
          }
        }
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      const indexDoc = {
        id: user.id,
        username: user.username,
        email: user.email,
        profile: {
          interests: user.profile?.interests || [],
          skillLevel: user.profile?.skillLevel || 'beginner',
          preferredCategories: [] // This would need to be derived from user behavior
        },
        searchHistory: user.searchHistory.map(search => ({
          query: search.query,
          timestamp: search.createdAt.toISOString(),
          results_clicked: search.clickedResults || []
        })),
        enrolledCourses: user.enrollments.map(e => e.courseId),
        completedCourses: user.enrollments
          .filter(e => e.completedAt)
          .map(e => e.courseId)
      };

      await elasticsearchClient.getClient().index({
        index: elasticsearchClient.indexes.users,
        id: user.id,
        body: indexDoc
      });

      logger.info('User indexed successfully', { userId });

    } catch (error) {
      logger.error('Failed to index user', { userId, error });
      throw error;
    }
  }

  async deleteFromIndex(index: string, id: string): Promise<void> {
    try {
      await elasticsearchClient.getClient().delete({
        index,
        id,
        ignore: [404] // Ignore if document doesn't exist
      });

      logger.info('Document deleted from index', { index, id });
    } catch (error) {
      logger.error('Failed to delete document from index', { index, id, error });
      throw error;
    }
  }

  async reindexAll(options: IndexingOptions = {}): Promise<{
    courses: IndexingStats;
    lessons: IndexingStats;
    resources: IndexingStats;
  }> {
    logger.info('Starting full reindex');

    const results = {
      courses: await this.indexCourses(options),
      lessons: await this.indexLessons(options),
      resources: await this.indexResources(options)
    };

    // Refresh all indexes
    await Promise.all([
      elasticsearchClient.refreshIndex(elasticsearchClient.indexes.courses),
      elasticsearchClient.refreshIndex(elasticsearchClient.indexes.lessons),
      elasticsearchClient.refreshIndex(elasticsearchClient.indexes.resources)
    ]);

    logger.info('Full reindex completed', {
      totalProcessed: results.courses.totalProcessed + results.lessons.totalProcessed + results.resources.totalProcessed,
      totalSuccessful: results.courses.successful + results.lessons.successful + results.resources.successful,
      totalFailed: results.courses.failed + results.lessons.failed + results.resources.failed
    });

    return results;
  }

  private async prepareCourseDocument(course: any): Promise<any> {
    // Calculate derived fields
    const totalDuration = course.lessons.reduce((sum: number, lesson: any) => sum + (lesson.duration || 0), 0);
    const averageRating = course.reviews.length > 0
      ? course.reviews.reduce((sum: number, review: any) => sum + review.rating, 0) / course.reviews.length
      : 0;
    const completionRate = course.enrollments.length > 0
      ? course.enrollments.filter((e: any) => e.progress === 100).length / course.enrollments.length
      : 0;

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      content: course.content || '',
      category: course.categories?.[0]?.category?.name || 'General',
      subcategory: course.subcategory,
      skillLevel: course.skillLevel,
      duration: totalDuration,
      price: parseFloat(course.price) || 0,
      rating: averageRating,
      reviewCount: course._count.reviews,
      enrollmentCount: course._count.enrollments,
      instructor: {
        id: course.instructor.id,
        name: `${course.instructor.profile?.firstName || ''} ${course.instructor.profile?.lastName || ''}`.trim() || course.instructor.username,
        rating: course.instructor._avg?.rating || 0
      },
      tags: course.tags.map((tag: any) => tag.tag.name),
      language: course.language || 'en',
      isPublished: course.isPublished,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
      popularity_score: this.calculatePopularityScore({
        enrollmentCount: course._count.enrollments,
        rating: averageRating,
        reviewCount: course._count.reviews,
        createdAt: course.createdAt
      }),
      completion_rate: completionRate
    };
  }

  private prepareLessonDocument(lesson: any): any {
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content || '',
      transcript: lesson.transcript || '',
      duration: lesson.duration || 0,
      lessonType: lesson.type || 'video',
      order: lesson.order || 0,
      isPreview: lesson.isPreview || false,
      attachments: lesson.attachments.map((attachment: any) => ({
        name: attachment.name,
        type: attachment.type,
        url: attachment.url
      }))
    };
  }

  private prepareResourceDocument(resource: any): any {
    const averageRating = resource.reviews.length > 0
      ? resource.reviews.reduce((sum: number, review: any) => sum + review.rating, 0) / resource.reviews.length
      : 0;

    return {
      id: resource.id,
      title: resource.title,
      description: resource.description,
      content: resource.content || '',
      type: resource.type,
      category: resource.category,
      tags: resource.tags.map((tag: any) => tag.tag.name),
      downloadCount: resource.downloads.length,
      rating: averageRating,
      fileSize: resource.fileSize || 0,
      format: resource.format,
      createdAt: resource.createdAt.toISOString()
    };
  }

  private calculatePopularityScore(data: {
    enrollmentCount: number;
    rating: number;
    reviewCount: number;
    createdAt: Date;
  }): number {
    const { enrollmentCount, rating, reviewCount, createdAt } = data;

    // Normalize enrollment count (log scale)
    const enrollmentScore = Math.log(1 + enrollmentCount) / Math.log(1000);

    // Rating score (weighted by review count)
    const ratingScore = (rating / 5) * Math.min(reviewCount / 50, 1);

    // Recency bonus (decay over time)
    const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-daysSinceCreation / 365); // Decay over a year

    // Weighted combination
    return (enrollmentScore * 0.4) + (ratingScore * 0.4) + (recencyScore * 0.2);
  }

  private async documentExists(index: string, id: string): Promise<boolean> {
    try {
      await elasticsearchClient.getClient().get({
        index,
        id
      });
      return true;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getIndexingProgress(): Promise<{
    courses: { indexed: number; total: number };
    lessons: { indexed: number; total: number };
    resources: { indexed: number; total: number };
  }> {
    try {
      const [coursesCount, lessonsCount, resourcesCount] = await Promise.all([
        elasticsearchClient.getClient().count({ index: elasticsearchClient.indexes.courses }),
        elasticsearchClient.getClient().count({ index: elasticsearchClient.indexes.lessons }),
        elasticsearchClient.getClient().count({ index: elasticsearchClient.indexes.resources })
      ]);

      const [totalCourses, totalLessons, totalResources] = await Promise.all([
        prisma.course.count({ where: { isPublished: true } }),
        prisma.lesson.count({ where: { course: { isPublished: true } } }),
        prisma.resource.count({ where: { isActive: true } })
      ]);

      return {
        courses: {
          indexed: coursesCount.count,
          total: totalCourses
        },
        lessons: {
          indexed: lessonsCount.count,
          total: totalLessons
        },
        resources: {
          indexed: resourcesCount.count,
          total: totalResources
        }
      };
    } catch (error) {
      logger.error('Failed to get indexing progress', error);
      throw error;
    }
  }
}

export const indexingService = new IndexingService();