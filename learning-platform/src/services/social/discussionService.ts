import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import {
  Discussion,
  DiscussionPost,
  User,
  DiscussionCategory,
  PostReaction,
  PostReport
} from '@prisma/client';

export interface DiscussionWithDetails extends Discussion {
  author: User;
  category: DiscussionCategory;
  posts: PostWithDetails[];
  _count: {
    posts: number;
    views: number;
    followers: number;
  };
  isFollowing?: boolean;
}

export interface PostWithDetails extends DiscussionPost {
  author: User;
  reactions: PostReaction[];
  replies: PostWithDetails[];
  _count: {
    replies: number;
    reactions: number;
  };
  userReaction?: PostReaction;
  isBestAnswer?: boolean;
}

export interface CreateDiscussionData {
  title: string;
  content: string;
  categoryId: string;
  tags: string[];
  isQuestion?: boolean;
  courseId?: string;
  lessonId?: string;
}

export interface CreatePostData {
  content: string;
  parentId?: string;
  attachments?: string[];
  isMarkdown?: boolean;
}

export interface ModerationAction {
  type: 'hide' | 'delete' | 'lock' | 'pin' | 'feature' | 'warn_user';
  reason: string;
  duration?: number; // in hours
  notifyUser?: boolean;
}

class DiscussionService {
  private cachePrefix = 'discussion:';
  private cacheTTL = 1800; // 30 minutes

  /**
   * Create a new discussion thread
   */
  async createDiscussion(
    authorId: string,
    data: CreateDiscussionData
  ): Promise<DiscussionWithDetails> {
    // Validate category exists
    const category = await prisma.discussionCategory.findUnique({
      where: { id: data.categoryId }
    });

    if (!category) {
      throw new Error('Discussion category not found');
    }

    const discussion = await prisma.$transaction(async (tx) => {
      const newDiscussion = await tx.discussion.create({
        data: {
          title: data.title,
          content: data.content,
          authorId,
          categoryId: data.categoryId,
          tags: data.tags,
          isQuestion: data.isQuestion || false,
          courseId: data.courseId,
          lessonId: data.lessonId,
          status: 'ACTIVE'
        }
      });

      // Auto-follow the discussion for the author
      await tx.discussionFollower.create({
        data: {
          discussionId: newDiscussion.id,
          userId: authorId
        }
      });

      // Create activity log
      await tx.userActivity.create({
        data: {
          userId: authorId,
          type: 'DISCUSSION_CREATED',
          entityType: 'DISCUSSION',
          entityId: newDiscussion.id,
          metadata: {
            title: data.title,
            category: category.name
          }
        }
      });

      return newDiscussion;
    });

    // Clear relevant caches
    await this.clearDiscussionCaches();

    return this.getDiscussionById(discussion.id, authorId);
  }

  /**
   * Get discussion by ID with all details
   */
  async getDiscussionById(
    discussionId: string,
    userId?: string
  ): Promise<DiscussionWithDetails | null> {
    const cacheKey = `${this.cachePrefix}${discussionId}:${userId || 'anonymous'}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const discussion = await prisma.discussion.findUnique({
      where: { id: discussionId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImageUrl: true,
            reputation: true
          }
        },
        category: true,
        posts: {
          where: { parentId: null },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true,
                reputation: true
              }
            },
            reactions: true,
            replies: {
              include: {
                author: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    profileImageUrl: true,
                    reputation: true
                  }
                },
                reactions: true,
                _count: {
                  select: { replies: true, reactions: true }
                }
              },
              orderBy: { createdAt: 'asc' }
            },
            _count: {
              select: { replies: true, reactions: true }
            }
          },
          orderBy: [
            { isPinned: 'desc' },
            { isBestAnswer: 'desc' },
            { createdAt: 'asc' }
          ]
        },
        _count: {
          select: {
            posts: true,
            views: true,
            followers: true
          }
        }
      }
    });

    if (!discussion) return null;

    let isFollowing = false;
    let userReactions: PostReaction[] = [];

    if (userId) {
      // Check if user is following
      const following = await prisma.discussionFollower.findUnique({
        where: {
          discussionId_userId: {
            discussionId,
            userId
          }
        }
      });
      isFollowing = !!following;

      // Get user's reactions
      userReactions = await prisma.postReaction.findMany({
        where: {
          userId,
          postId: {
            in: discussion.posts.flatMap(p => [
              p.id,
              ...p.replies.map(r => r.id)
            ])
          }
        }
      });

      // Increment view count
      await this.incrementViewCount(discussionId, userId);
    }

    const result: DiscussionWithDetails = {
      ...discussion,
      posts: discussion.posts.map(post => ({
        ...post,
        userReaction: userReactions.find(r => r.postId === post.id),
        replies: post.replies.map(reply => ({
          ...reply,
          userReaction: userReactions.find(r => r.postId === reply.id),
          replies: []
        }))
      })),
      isFollowing
    };

    // Cache for shorter time due to dynamic content
    await redis.setex(cacheKey, 600, JSON.stringify(result));

    return result;
  }

  /**
   * Get discussions with filtering and pagination
   */
  async getDiscussions(params: {
    categoryId?: string;
    courseId?: string;
    tags?: string[];
    status?: 'ACTIVE' | 'LOCKED' | 'ARCHIVED';
    isQuestion?: boolean;
    sortBy?: 'recent' | 'popular' | 'trending' | 'unanswered';
    page?: number;
    limit?: number;
    userId?: string;
  }): Promise<{
    discussions: DiscussionWithDetails[];
    total: number;
    hasMore: boolean;
  }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = {
      status: params.status || 'ACTIVE'
    };

    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params.courseId) {
      where.courseId = params.courseId;
    }

    if (params.tags?.length) {
      where.tags = {
        hasSome: params.tags
      };
    }

    if (params.isQuestion !== undefined) {
      where.isQuestion = params.isQuestion;
    }

    // Special filter for unanswered questions
    if (params.sortBy === 'unanswered') {
      where.isQuestion = true;
      where.posts = {
        none: {
          isBestAnswer: true
        }
      };
    }

    let orderBy: any = { createdAt: 'desc' };

    switch (params.sortBy) {
      case 'popular':
        orderBy = {
          posts: { _count: 'desc' }
        };
        break;
      case 'trending':
        orderBy = [
          { views: { _count: 'desc' } },
          { createdAt: 'desc' }
        ];
        break;
      default:
        orderBy = { updatedAt: 'desc' };
    }

    const [discussions, total] = await Promise.all([
      prisma.discussion.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
              reputation: true
            }
          },
          category: true,
          posts: {
            take: 1,
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  profileImageUrl: true
                }
              }
            },
            orderBy: { createdAt: 'desc' }
          },
          _count: {
            select: {
              posts: true,
              views: true,
              followers: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: limit
      }),
      prisma.discussion.count({ where })
    ]);

    let following: string[] = [];
    if (params.userId) {
      const userFollowing = await prisma.discussionFollower.findMany({
        where: {
          userId: params.userId,
          discussionId: {
            in: discussions.map(d => d.id)
          }
        },
        select: { discussionId: true }
      });
      following = userFollowing.map(f => f.discussionId);
    }

    const result = discussions.map(discussion => ({
      ...discussion,
      posts: discussion.posts.map(post => ({
        ...post,
        replies: [],
        reactions: [],
        _count: { replies: 0, reactions: 0 }
      })),
      isFollowing: following.includes(discussion.id)
    })) as DiscussionWithDetails[];

    return {
      discussions: result,
      total,
      hasMore: offset + discussions.length < total
    };
  }

  /**
   * Create a new post in a discussion
   */
  async createPost(
    discussionId: string,
    authorId: string,
    data: CreatePostData
  ): Promise<PostWithDetails> {
    // Validate discussion exists and is not locked
    const discussion = await prisma.discussion.findUnique({
      where: { id: discussionId },
      select: { status: true, authorId: true, title: true }
    });

    if (!discussion) {
      throw new Error('Discussion not found');
    }

    if (discussion.status === 'LOCKED') {
      throw new Error('Discussion is locked');
    }

    // Validate parent post if replying
    if (data.parentId) {
      const parentPost = await prisma.discussionPost.findUnique({
        where: { id: data.parentId }
      });

      if (!parentPost || parentPost.discussionId !== discussionId) {
        throw new Error('Parent post not found or not in this discussion');
      }
    }

    const post = await prisma.$transaction(async (tx) => {
      const newPost = await tx.discussionPost.create({
        data: {
          content: data.content,
          authorId,
          discussionId,
          parentId: data.parentId,
          attachments: data.attachments || [],
          isMarkdown: data.isMarkdown || false
        }
      });

      // Update discussion's last activity
      await tx.discussion.update({
        where: { id: discussionId },
        data: { updatedAt: new Date() }
      });

      // Auto-follow discussion for the poster
      await tx.discussionFollower.upsert({
        where: {
          discussionId_userId: {
            discussionId,
            userId: authorId
          }
        },
        update: {},
        create: {
          discussionId,
          userId: authorId
        }
      });

      // Notify followers (except the author)
      const followers = await tx.discussionFollower.findMany({
        where: {
          discussionId,
          userId: { not: authorId }
        },
        include: {
          user: {
            select: { id: true, email: true, name: true }
          }
        }
      });

      // Create notifications
      await Promise.all(
        followers.map(follower =>
          tx.notification.create({
            data: {
              userId: follower.userId,
              type: 'DISCUSSION_REPLY',
              title: `New reply in "${discussion.title}"`,
              message: `${authorId} replied to a discussion you're following`,
              entityType: 'DISCUSSION',
              entityId: discussionId,
              actionUrl: `/discussions/${discussionId}#post-${newPost.id}`
            }
          })
        )
      );

      return newPost;
    });

    // Clear discussion cache
    await this.clearDiscussionCache(discussionId);

    return this.getPostById(post.id, authorId);
  }

  /**
   * React to a post (like, helpful, etc.)
   */
  async reactToPost(
    postId: string,
    userId: string,
    type: 'LIKE' | 'HELPFUL' | 'THANKS'
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Remove existing reaction if any
      await tx.postReaction.deleteMany({
        where: {
          postId,
          userId
        }
      });

      // Add new reaction
      await tx.postReaction.create({
        data: {
          postId,
          userId,
          type
        }
      });

      // Update post author's reputation
      const post = await tx.discussionPost.findUnique({
        where: { id: postId },
        select: { authorId: true }
      });

      if (post) {
        const reputationChange = type === 'LIKE' ? 5 : type === 'HELPFUL' ? 10 : 2;

        await tx.user.update({
          where: { id: post.authorId },
          data: {
            reputation: {
              increment: reputationChange
            }
          }
        });
      }
    });

    // Clear relevant caches
    await this.clearPostCache(postId);
  }

  /**
   * Mark a post as the best answer
   */
  async markBestAnswer(
    discussionId: string,
    postId: string,
    userId: string
  ): Promise<void> {
    const discussion = await prisma.discussion.findUnique({
      where: { id: discussionId },
      select: { authorId: true, isQuestion: true }
    });

    if (!discussion) {
      throw new Error('Discussion not found');
    }

    if (!discussion.isQuestion) {
      throw new Error('Only questions can have best answers');
    }

    if (discussion.authorId !== userId) {
      throw new Error('Only the question author can mark best answers');
    }

    await prisma.$transaction(async (tx) => {
      // Remove existing best answer
      await tx.discussionPost.updateMany({
        where: {
          discussionId,
          isBestAnswer: true
        },
        data: {
          isBestAnswer: false
        }
      });

      // Mark new best answer
      await tx.discussionPost.update({
        where: { id: postId },
        data: {
          isBestAnswer: true
        }
      });

      // Award reputation to answer author
      const post = await tx.discussionPost.findUnique({
        where: { id: postId },
        select: { authorId: true }
      });

      if (post) {
        await tx.user.update({
          where: { id: post.authorId },
          data: {
            reputation: {
              increment: 25
            }
          }
        });

        // Create notification
        await tx.notification.create({
          data: {
            userId: post.authorId,
            type: 'BEST_ANSWER_SELECTED',
            title: 'Your answer was selected as best!',
            message: 'Your answer was marked as the best answer and you earned 25 reputation points',
            entityType: 'POST',
            entityId: postId
          }
        });
      }
    });

    await this.clearDiscussionCache(discussionId);
  }

  /**
   * Report a post for moderation
   */
  async reportPost(
    postId: string,
    reporterId: string,
    reason: string,
    category: 'SPAM' | 'INAPPROPRIATE' | 'HARASSMENT' | 'COPYRIGHT' | 'OTHER'
  ): Promise<void> {
    // Check if user already reported this post
    const existingReport = await prisma.postReport.findUnique({
      where: {
        postId_reporterId: {
          postId,
          reporterId
        }
      }
    });

    if (existingReport) {
      throw new Error('You have already reported this post');
    }

    await prisma.$transaction(async (tx) => {
      await tx.postReport.create({
        data: {
          postId,
          reporterId,
          reason,
          category,
          status: 'PENDING'
        }
      });

      // Auto-hide post if multiple reports
      const reportCount = await tx.postReport.count({
        where: { postId }
      });

      if (reportCount >= 3) {
        await tx.discussionPost.update({
          where: { id: postId },
          data: { isHidden: true }
        });
      }
    });
  }

  /**
   * Moderate a discussion or post
   */
  async moderateContent(
    contentId: string,
    contentType: 'discussion' | 'post',
    moderatorId: string,
    action: ModerationAction
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const moderationData = {
        moderatorId,
        action: action.type,
        reason: action.reason,
        duration: action.duration,
        timestamp: new Date()
      };

      if (contentType === 'discussion') {
        const updates: any = {};

        switch (action.type) {
          case 'lock':
            updates.status = 'LOCKED';
            break;
          case 'hide':
            updates.isHidden = true;
            break;
          case 'pin':
            updates.isPinned = true;
            break;
          case 'feature':
            updates.isFeatured = true;
            break;
        }

        if (Object.keys(updates).length > 0) {
          await tx.discussion.update({
            where: { id: contentId },
            data: updates
          });
        }

        await tx.moderationLog.create({
          data: {
            ...moderationData,
            entityType: 'DISCUSSION',
            entityId: contentId
          }
        });
      } else {
        const updates: any = {};

        switch (action.type) {
          case 'hide':
            updates.isHidden = true;
            break;
          case 'delete':
            updates.isDeleted = true;
            break;
        }

        if (Object.keys(updates).length > 0) {
          await tx.discussionPost.update({
            where: { id: contentId },
            data: updates
          });
        }

        await tx.moderationLog.create({
          data: {
            ...moderationData,
            entityType: 'POST',
            entityId: contentId
          }
        });
      }

      // Warn user if specified
      if (action.type === 'warn_user') {
        const content = contentType === 'discussion'
          ? await tx.discussion.findUnique({
              where: { id: contentId },
              select: { authorId: true }
            })
          : await tx.discussionPost.findUnique({
              where: { id: contentId },
              select: { authorId: true }
            });

        if (content) {
          await tx.notification.create({
            data: {
              userId: content.authorId,
              type: 'MODERATION_WARNING',
              title: 'Content Moderation Warning',
              message: `Your ${contentType} has been flagged: ${action.reason}`,
              entityType: contentType.toUpperCase(),
              entityId: contentId
            }
          });
        }
      }
    });

    // Clear caches
    if (contentType === 'discussion') {
      await this.clearDiscussionCache(contentId);
    } else {
      await this.clearPostCache(contentId);
    }
  }

  /**
   * Get trending topics for the home page
   */
  async getTrendingTopics(limit: number = 10): Promise<{
    tag: string;
    count: number;
    discussions: number;
  }[]> {
    const cacheKey = `${this.cachePrefix}trending_topics:${limit}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get most used tags from recent discussions
    const recentDiscussions = await prisma.discussion.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        },
        status: 'ACTIVE'
      },
      select: { tags: true }
    });

    const tagCount = new Map<string, number>();
    recentDiscussions.forEach(discussion => {
      discussion.tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    const trending = Array.from(tagCount.entries())
      .map(([tag, count]) => ({
        tag,
        count,
        discussions: count // For now, same as count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    await redis.setex(cacheKey, 3600, JSON.stringify(trending));

    return trending;
  }

  // Helper methods
  private async getPostById(postId: string, userId?: string): Promise<PostWithDetails> {
    const post = await prisma.discussionPost.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImageUrl: true,
            reputation: true
          }
        },
        reactions: true,
        replies: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                profileImageUrl: true,
                reputation: true
              }
            },
            reactions: true,
            _count: {
              select: { replies: true, reactions: true }
            }
          }
        },
        _count: {
          select: { replies: true, reactions: true }
        }
      }
    });

    if (!post) {
      throw new Error('Post not found');
    }

    let userReaction;
    if (userId) {
      userReaction = await prisma.postReaction.findFirst({
        where: {
          postId,
          userId
        }
      });
    }

    return {
      ...post,
      userReaction,
      replies: post.replies.map(reply => ({
        ...reply,
        replies: []
      }))
    } as PostWithDetails;
  }

  private async incrementViewCount(discussionId: string, userId?: string): Promise<void> {
    if (userId) {
      // Only count unique views per user per day
      const today = new Date().toISOString().split('T')[0];
      const viewKey = `view:${discussionId}:${userId}:${today}`;

      const hasViewed = await redis.get(viewKey);
      if (!hasViewed) {
        await Promise.all([
          redis.setex(viewKey, 86400, '1'), // 24 hour TTL
          prisma.discussionView.create({
            data: {
              discussionId,
              userId,
              viewedAt: new Date()
            }
          }).catch(() => {}) // Ignore duplicates
        ]);
      }
    }
  }

  private async clearDiscussionCaches(): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  private async clearDiscussionCache(discussionId: string): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}${discussionId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  private async clearPostCache(postId: string): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}post:${postId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export const discussionService = new DiscussionService();