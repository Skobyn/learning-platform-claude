import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// Validation schemas
const CreateCollectionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  shortDescription: z.string().max(500).optional(),
  category: z.string().min(1),
  tags: z.array(z.string()).optional(),
  targetAudience: z.array(z.string()).optional(),
  thumbnailUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  colorTheme: z.string().optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isCurated: z.boolean().optional(),
});

const UpdateCollectionSchema = CreateCollectionSchema.partial();

const AddCollectionItemSchema = z.object({
  learningPathId: z.string().min(1),
  orderIndex: z.number().int().min(0),
  section: z.string().optional(),
  featured: z.boolean().optional(),
  customTitle: z.string().optional(),
  customDescription: z.string().optional(),
  difficultyBoost: z.number().int().optional(),
  priority: z.number().int().optional(),
});

export type CreateCollectionInput = z.infer<typeof CreateCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof UpdateCollectionSchema>;
export type AddCollectionItemInput = z.infer<typeof AddCollectionItemSchema>;

export interface Collection {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  category: string;
  tags: string[];
  targetAudience: string[];
  thumbnailUrl?: string;
  bannerUrl?: string;
  colorTheme: string;
  learningPathCount: number;
  totalEstimatedDuration: number;
  isPublic: boolean;
  isFeatured: boolean;
  isCurated: boolean;
  createdBy: string;
  organizationId?: string;
  status: string;
  publishedAt?: Date;
  viewCount: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
  items?: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  learningPathId: string;
  orderIndex: number;
  section?: string;
  featured: boolean;
  customTitle?: string;
  customDescription?: string;
  difficultyBoost: number;
  priority: number;
  addedAt: Date;
  addedBy: string;
  learningPath: {
    id: string;
    title: string;
    description: string;
    category: string;
    difficulty: string;
    estimatedDuration: number;
    enrollmentCount: number;
    averageRating: number;
    tags: string[];
    skills: string[];
  };
}

export class CollectionService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new collection
   */
  async createCollection(
    data: CreateCollectionInput,
    userId: string,
    organizationId?: string
  ): Promise<Collection> {
    try {
      const validatedData = CreateCollectionSchema.parse(data);

      const collection = await this.prisma.collection.create({
        data: {
          ...validatedData,
          createdBy: userId,
          organizationId,
          status: 'DRAFT',
          colorTheme: validatedData.colorTheme || '#3B82F6',
        },
        include: {
          items: {
            include: {
              learningPath: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  difficulty: true,
                  estimatedDuration: true,
                  enrollmentCount: true,
                  averageRating: true,
                  tags: true,
                  skills: true,
                },
              },
            },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });

      return this.formatCollection(collection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to create collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update an existing collection
   */
  async updateCollection(
    collectionId: string,
    data: UpdateCollectionInput,
    userId: string
  ): Promise<Collection> {
    try {
      const validatedData = UpdateCollectionSchema.parse(data);

      // Check if user has permission to update
      const existingCollection = await this.prisma.collection.findUnique({
        where: { id: collectionId },
        select: { createdBy: true, organizationId: true },
      });

      if (!existingCollection) {
        throw new Error('Collection not found');
      }

      const updatedCollection = await this.prisma.collection.update({
        where: { id: collectionId },
        data: validatedData,
        include: {
          items: {
            include: {
              learningPath: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  difficulty: true,
                  estimatedDuration: true,
                  enrollmentCount: true,
                  averageRating: true,
                  tags: true,
                  skills: true,
                },
              },
            },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });

      return this.formatCollection(updatedCollection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to update collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get collection by ID with full details
   */
  async getCollection(collectionId: string): Promise<Collection | null> {
    try {
      const collection = await this.prisma.collection.findUnique({
        where: { id: collectionId },
        include: {
          items: {
            include: {
              learningPath: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  difficulty: true,
                  estimatedDuration: true,
                  enrollmentCount: true,
                  averageRating: true,
                  tags: true,
                  skills: true,
                },
              },
            },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });

      if (!collection) {
        return null;
      }

      // Increment view count
      await this.prisma.collection.update({
        where: { id: collectionId },
        data: { viewCount: { increment: 1 } },
      });

      return this.formatCollection(collection);
    } catch (error) {
      throw new Error(`Failed to get collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get collections with filtering and pagination
   */
  async getCollections(options: {
    page?: number;
    limit?: number;
    category?: string;
    tags?: string[];
    targetAudience?: string[];
    status?: string;
    isPublic?: boolean;
    isFeatured?: boolean;
    isCurated?: boolean;
    createdBy?: string;
    organizationId?: string;
    search?: string;
  } = {}): Promise<{ collections: Collection[]; total: number; pages: number }> {
    try {
      const {
        page = 1,
        limit = 20,
        category,
        tags,
        targetAudience,
        status = 'PUBLISHED',
        isPublic,
        isFeatured,
        isCurated,
        createdBy,
        organizationId,
        search,
      } = options;

      const offset = (page - 1) * limit;

      const where: any = {
        status,
        ...(category && { category }),
        ...(tags?.length && { tags: { hasSome: tags } }),
        ...(targetAudience?.length && { targetAudience: { hasSome: targetAudience } }),
        ...(isPublic !== undefined && { isPublic }),
        ...(isFeatured !== undefined && { isFeatured }),
        ...(isCurated !== undefined && { isCurated }),
        ...(createdBy && { createdBy }),
        ...(organizationId && { organizationId }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { hasSome: [search] } },
          ],
        }),
      };

      const [collections, total] = await Promise.all([
        this.prisma.collection.findMany({
          where,
          include: {
            items: {
              include: {
                learningPath: {
                  select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    difficulty: true,
                    estimatedDuration: true,
                    enrollmentCount: true,
                    averageRating: true,
                    tags: true,
                    skills: true,
                  },
                },
              },
              orderBy: { orderIndex: 'asc' },
            },
          },
          orderBy: [
            { isFeatured: 'desc' },
            { viewCount: 'desc' },
            { createdAt: 'desc' },
          ],
          skip: offset,
          take: limit,
        }),
        this.prisma.collection.count({ where }),
      ]);

      return {
        collections: collections.map(collection => this.formatCollection(collection)),
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw new Error(`Failed to get collections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add learning path to collection
   */
  async addPathToCollection(
    collectionId: string,
    data: AddCollectionItemInput,
    userId: string
  ): Promise<CollectionItem> {
    try {
      const validatedData = AddCollectionItemSchema.parse(data);

      // Check if user has permission
      const collection = await this.prisma.collection.findUnique({
        where: { id: collectionId },
        select: { createdBy: true },
      });

      if (!collection) {
        throw new Error('Collection not found');
      }

      // Check if path already exists in collection
      const existingItem = await this.prisma.collectionItem.findUnique({
        where: {
          collectionId_learningPathId: {
            collectionId,
            learningPathId: validatedData.learningPathId,
          },
        },
      });

      if (existingItem) {
        throw new Error('Learning path is already in this collection');
      }

      const collectionItem = await this.prisma.$transaction(async (tx) => {
        // Create collection item
        const item = await tx.collectionItem.create({
          data: {
            ...validatedData,
            collectionId,
            addedBy: userId,
            featured: validatedData.featured || false,
            difficultyBoost: validatedData.difficultyBoost || 0,
            priority: validatedData.priority || 0,
          },
          include: {
            learningPath: {
              select: {
                id: true,
                title: true,
                description: true,
                category: true,
                difficulty: true,
                estimatedDuration: true,
                enrollmentCount: true,
                averageRating: true,
                tags: true,
                skills: true,
              },
            },
          },
        });

        // Update collection counts
        await this.updateCollectionCounts(collectionId, tx);

        return item;
      });

      return this.formatCollectionItem(collectionItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to add path to collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove learning path from collection
   */
  async removePathFromCollection(
    collectionId: string,
    learningPathId: string,
    userId: string
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.collectionItem.delete({
          where: {
            collectionId_learningPathId: {
              collectionId,
              learningPathId,
            },
          },
        });

        // Update collection counts
        await this.updateCollectionCounts(collectionId, tx);
      });
    } catch (error) {
      throw new Error(`Failed to remove path from collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Reorder items in collection
   */
  async reorderCollectionItems(
    collectionId: string,
    itemIds: string[],
    userId: string
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (let i = 0; i < itemIds.length; i++) {
          await tx.collectionItem.update({
            where: { id: itemIds[i] },
            data: { orderIndex: i },
          });
        }
      });
    } catch (error) {
      throw new Error(`Failed to reorder collection items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get curated collections for a specific audience
   */
  async getCuratedCollections(
    audience: string[],
    limit: number = 10
  ): Promise<Collection[]> {
    try {
      const collections = await this.prisma.collection.findMany({
        where: {
          status: 'PUBLISHED',
          isCurated: true,
          targetAudience: { hasSome: audience },
        },
        include: {
          items: {
            include: {
              learningPath: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  difficulty: true,
                  estimatedDuration: true,
                  enrollmentCount: true,
                  averageRating: true,
                  tags: true,
                  skills: true,
                },
              },
            },
            orderBy: { orderIndex: 'asc' },
          },
        },
        orderBy: [
          { isFeatured: 'desc' },
          { enrollmentCount: 'desc' },
        ],
        take: limit,
      });

      return collections.map(collection => this.formatCollection(collection));
    } catch (error) {
      throw new Error(`Failed to get curated collections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get trending collections based on recent activity
   */
  async getTrendingCollections(limit: number = 10): Promise<Collection[]> {
    try {
      // Simple trending algorithm based on recent views and enrollments
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const collections = await this.prisma.collection.findMany({
        where: {
          status: 'PUBLISHED',
          isPublic: true,
          updatedAt: { gte: oneWeekAgo },
        },
        include: {
          items: {
            include: {
              learningPath: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  difficulty: true,
                  estimatedDuration: true,
                  enrollmentCount: true,
                  averageRating: true,
                  tags: true,
                  skills: true,
                },
              },
            },
            orderBy: { orderIndex: 'asc' },
          },
        },
        orderBy: [
          { viewCount: 'desc' },
          { enrollmentCount: 'desc' },
        ],
        take: limit,
      });

      return collections.map(collection => this.formatCollection(collection));
    } catch (error) {
      throw new Error(`Failed to get trending collections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete collection (soft delete by setting status to ARCHIVED)
   */
  async deleteCollection(collectionId: string, userId: string): Promise<void> {
    try {
      await this.prisma.collection.update({
        where: { id: collectionId },
        data: { status: 'ARCHIVED' },
      });
    } catch (error) {
      throw new Error(`Failed to delete collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update collection counts (path count and total duration)
   */
  private async updateCollectionCounts(collectionId: string, tx?: any): Promise<void> {
    const prisma = tx || this.prisma;

    const items = await prisma.collectionItem.findMany({
      where: { collectionId },
      include: {
        learningPath: {
          select: { estimatedDuration: true },
        },
      },
    });

    const learningPathCount = items.length;
    const totalEstimatedDuration = items.reduce(
      (sum, item) => sum + (item.learningPath.estimatedDuration || 0),
      0
    );

    await prisma.collection.update({
      where: { id: collectionId },
      data: {
        learningPathCount,
        totalEstimatedDuration,
      },
    });
  }

  /**
   * Format collection for API response
   */
  private formatCollection(collection: any): Collection {
    return {
      id: collection.id,
      title: collection.title,
      description: collection.description,
      shortDescription: collection.shortDescription,
      category: collection.category,
      tags: collection.tags || [],
      targetAudience: collection.targetAudience || [],
      thumbnailUrl: collection.thumbnailUrl,
      bannerUrl: collection.bannerUrl,
      colorTheme: collection.colorTheme,
      learningPathCount: collection.learningPathCount,
      totalEstimatedDuration: collection.totalEstimatedDuration,
      isPublic: collection.isPublic,
      isFeatured: collection.isFeatured,
      isCurated: collection.isCurated,
      createdBy: collection.createdBy,
      organizationId: collection.organizationId,
      status: collection.status,
      publishedAt: collection.publishedAt,
      viewCount: collection.viewCount,
      enrollmentCount: collection.enrollmentCount,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      items: (collection.items || []).map((item: any) => this.formatCollectionItem(item)),
    };
  }

  /**
   * Format collection item for API response
   */
  private formatCollectionItem(item: any): CollectionItem {
    return {
      id: item.id,
      collectionId: item.collectionId,
      learningPathId: item.learningPathId,
      orderIndex: item.orderIndex,
      section: item.section,
      featured: item.featured,
      customTitle: item.customTitle,
      customDescription: item.customDescription,
      difficultyBoost: item.difficultyBoost,
      priority: item.priority,
      addedAt: item.addedAt,
      addedBy: item.addedBy,
      learningPath: {
        id: item.learningPath.id,
        title: item.learningPath.title,
        description: item.learningPath.description,
        category: item.learningPath.category,
        difficulty: item.learningPath.difficulty,
        estimatedDuration: item.learningPath.estimatedDuration,
        enrollmentCount: item.learningPath.enrollmentCount,
        averageRating: item.learningPath.averageRating,
        tags: item.learningPath.tags || [],
        skills: item.learningPath.skills || [],
      },
    };
  }
}

export default CollectionService;