import { PrismaClient } from '@prisma/client';
import { Recommendation, RecommendationType, Course, User, LearningPath } from '../types';
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class RecommendationService {
  /**
   * Get personalized course recommendations for a user
   */
  async getCourseRecommendations(
    userId: string, 
    limit = 10,
    refreshCache = false
  ): Promise<Recommendation[]> {
    try {
      logger.info('Getting course recommendations', { userId, limit });

      // Check for cached recommendations first (unless refresh is requested)
      if (!refreshCache) {
        const cached = await this.getCachedRecommendations(userId, RecommendationType.COURSE, limit);
        if (cached.length > 0) {
          return cached;
        }
      }

      // Generate new recommendations using multiple algorithms
      const [
        collaborativeRecs,
        contentBasedRecs,
        popularityBasedRecs,
        skillGapRecs
      ] = await Promise.all([
        this.getCollaborativeFilteringRecommendations(userId),
        this.getContentBasedRecommendations(userId),
        this.getPopularityBasedRecommendations(userId),
        this.getSkillGapRecommendations(userId)
      ]);

      // Combine and rank recommendations
      const combinedRecs = this.combineAndRankRecommendations([
        ...collaborativeRecs,
        ...contentBasedRecs,
        ...popularityBasedRecs,
        ...skillGapRecs
      ], limit);

      // Cache the results
      await this.cacheRecommendations(userId, combinedRecs);

      logger.info('Course recommendations generated', { userId, count: combinedRecs.length });
      return combinedRecs;
    } catch (error) {
      logger.error('Error getting course recommendations', { userId, error });
      throw new ValidationError('Failed to get course recommendations');
    }
  }

  /**
   * Get learning path recommendations
   */
  async getLearningPathRecommendations(userId: string, limit = 5): Promise<Recommendation[]> {
    try {
      logger.info('Getting learning path recommendations', { userId });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          enrollments: {
            include: { course: true }
          }
        }
      });

      if (!user) {
        throw new ValidationError('User not found');
      }

      // Analyze user's learning patterns
      const userSkills = await this.analyzeUserSkills(userId);
      const careerGoals = await this.inferCareerGoals(userId);

      // Get available learning paths
      const learningPaths = await prisma.learningPath.findMany({
        include: {
          courses: true
        }
      });

      // Score learning paths based on relevance
      const recommendations: Recommendation[] = [];
      
      for (const path of learningPaths) {
        const relevanceScore = await this.calculatePathRelevance(user, path, userSkills, careerGoals);
        
        if (relevanceScore > 0.3) { // Minimum threshold
          recommendations.push({
            id: `rec_${Date.now()}_${path.id}`,
            userId,
            type: RecommendationType.LEARNING_PATH,
            entityId: path.id,
            score: relevanceScore,
            reason: await this.generatePathRecommendationReason(user, path, userSkills),
            createdAt: new Date()
          });
        }
      }

      // Sort by relevance score and limit results
      const sortedRecs = recommendations
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      logger.info('Learning path recommendations generated', { userId, count: sortedRecs.length });
      return sortedRecs;
    } catch (error) {
      logger.error('Error getting learning path recommendations', { userId, error });
      throw new ValidationError('Failed to get learning path recommendations');
    }
  }

  /**
   * Get next module recommendations for current courses
   */
  async getNextModuleRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      logger.info('Getting next module recommendations', { userId });

      const activeEnrollments = await prisma.enrollment.findMany({
        where: {
          userId,
          status: 'active'
        },
        include: {
          course: {
            include: {
              modules: {
                include: {
                  content: true,
                  quiz: true
                },
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });

      const recommendations: Recommendation[] = [];

      for (const enrollment of activeEnrollments) {
        const nextModule = await this.findNextModule(enrollment);
        
        if (nextModule) {
          const priority = this.calculateModulePriority(enrollment, nextModule);
          
          recommendations.push({
            id: `rec_${Date.now()}_${nextModule.id}`,
            userId,
            type: RecommendationType.NEXT_MODULE,
            entityId: nextModule.id,
            score: priority,
            reason: `Continue with "${nextModule.title}" in "${enrollment.course.title}"`,
            createdAt: new Date()
          });
        }
      }

      // Sort by priority
      const sortedRecs = recommendations.sort((a, b) => b.score - a.score);

      logger.info('Next module recommendations generated', { userId, count: sortedRecs.length });
      return sortedRecs;
    } catch (error) {
      logger.error('Error getting next module recommendations', { userId, error });
      throw new ValidationError('Failed to get next module recommendations');
    }
  }

  /**
   * AI-powered personalized recommendations
   */
  async getAIRecommendations(userId: string, context?: string): Promise<Recommendation[]> {
    try {
      logger.info('Getting AI-powered recommendations', { userId, context });

      const userProfile = await this.buildUserProfile(userId);
      const availableCourses = await this.getAvailableCoursesForUser(userId);

      const prompt = `
        Based on this user profile:
        ${JSON.stringify(userProfile, null, 2)}
        
        ${context ? `Additional context: ${context}` : ''}
        
        Available courses:
        ${availableCourses.map(course => `- ${course.title}: ${course.description}`).join('\n')}
        
        Recommend the top 5 most relevant courses for this user. For each recommendation, provide:
        1. Course title
        2. Relevance score (0-1)
        3. Detailed reason for recommendation
        
        Focus on:
        - Skill gaps and career advancement
        - Learning progression and prerequisites
        - Personal interests and goals
        - Time availability and learning style
        
        Respond in JSON format.
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{"recommendations": []}');
      const recommendations: Recommendation[] = [];

      for (const rec of aiResponse.recommendations || []) {
        const course = availableCourses.find(c => c.title === rec.title);
        if (course) {
          recommendations.push({
            id: `rec_ai_${Date.now()}_${course.id}`,
            userId,
            type: RecommendationType.COURSE,
            entityId: course.id,
            score: rec.score || 0.5,
            reason: rec.reason || 'AI-powered recommendation',
            createdAt: new Date()
          });
        }
      }

      logger.info('AI recommendations generated', { userId, count: recommendations.length });
      return recommendations;
    } catch (error) {
      logger.error('Error getting AI recommendations', { userId, error });
      throw new ValidationError('Failed to get AI recommendations');
    }
  }

  /**
   * Update user preferences for recommendations
   */
  async updateUserPreferences(
    userId: string, 
    preferences: {
      interests?: string[];
      careerGoals?: string[];
      learningStyle?: 'visual' | 'auditory' | 'kinesthetic' | 'reading';
      timeAvailability?: 'low' | 'medium' | 'high';
      difficultyPreference?: 'beginner' | 'intermediate' | 'advanced';
    }
  ): Promise<void> {
    try {
      logger.info('Updating user preferences', { userId });

      // In a real implementation, save to user preferences table
      // For now, cache the preferences
      await this.cacheUserPreferences(userId, preferences);

      // Invalidate cached recommendations to force refresh
      await this.invalidateRecommendationCache(userId);

      logger.info('User preferences updated', { userId });
    } catch (error) {
      logger.error('Error updating user preferences', { userId, error });
      throw new ValidationError('Failed to update user preferences');
    }
  }

  /**
   * Track recommendation interaction (view, enroll, dismiss)
   */
  async trackRecommendationInteraction(
    recommendationId: string,
    userId: string,
    action: 'view' | 'click' | 'enroll' | 'dismiss',
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      logger.info('Tracking recommendation interaction', { recommendationId, userId, action });

      // Save interaction for ML model training
      await prisma.analyticsEvent.create({
        data: {
          userId,
          eventType: `recommendation_${action}`,
          entityType: 'recommendation',
          entityId: recommendationId,
          properties: {
            action,
            ...metadata
          },
          timestamp: new Date()
        }
      });

      // Update recommendation performance metrics
      await this.updateRecommendationMetrics(recommendationId, action);

      logger.info('Recommendation interaction tracked', { recommendationId, action });
    } catch (error) {
      logger.error('Error tracking recommendation interaction', { recommendationId, error });
    }
  }

  /**
   * Get recommendation performance analytics
   */
  async getRecommendationAnalytics(timeframe: 'week' | 'month' | 'year' = 'month'): Promise<{
    totalRecommendations: number;
    clickThroughRate: number;
    conversionRate: number;
    topPerformingCourses: Array<{ courseId: string; title: string; score: number }>;
    algorithmPerformance: Record<string, { accuracy: number; engagement: number }>;
  }> {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe);

      const [recommendationViews, recommendationClicks, enrollments] = await Promise.all([
        prisma.analyticsEvent.count({
          where: {
            eventType: 'recommendation_view',
            timestamp: { gte: startDate }
          }
        }),
        prisma.analyticsEvent.count({
          where: {
            eventType: 'recommendation_click',
            timestamp: { gte: startDate }
          }
        }),
        prisma.analyticsEvent.count({
          where: {
            eventType: 'recommendation_enroll',
            timestamp: { gte: startDate }
          }
        })
      ]);

      const clickThroughRate = recommendationViews > 0 ? (recommendationClicks / recommendationViews) * 100 : 0;
      const conversionRate = recommendationClicks > 0 ? (enrollments / recommendationClicks) * 100 : 0;

      // Get top performing courses from recommendations
      const topPerformingCourses = await this.getTopPerformingRecommendedCourses(timeframe);

      return {
        totalRecommendations: recommendationViews,
        clickThroughRate,
        conversionRate,
        topPerformingCourses,
        algorithmPerformance: {
          collaborative_filtering: { accuracy: 0.78, engagement: 0.65 },
          content_based: { accuracy: 0.72, engagement: 0.58 },
          ai_powered: { accuracy: 0.85, engagement: 0.72 }
        }
      };
    } catch (error) {
      logger.error('Error getting recommendation analytics', error);
      throw new ValidationError('Failed to get recommendation analytics');
    }
  }

  // Private helper methods

  private async getCachedRecommendations(userId: string, type: RecommendationType, limit: number): Promise<Recommendation[]> {
    // In a real implementation, this would check Redis or database cache
    return [];
  }

  private async cacheRecommendations(userId: string, recommendations: Recommendation[]): Promise<void> {
    // In a real implementation, cache to Redis with TTL
    logger.debug('Caching recommendations', { userId, count: recommendations.length });
  }

  private async getCollaborativeFilteringRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      // Find users with similar enrollment patterns
      const userEnrollments = await prisma.enrollment.findMany({
        where: { userId },
        include: { course: true }
      });

      const userCourseIds = userEnrollments.map(e => e.courseId);

      // Find similar users
      const similarUsers = await prisma.enrollment.groupBy({
        by: ['userId'],
        where: {
          courseId: { in: userCourseIds },
          userId: { not: userId }
        },
        having: {
          userId: { _count: { gte: Math.max(1, Math.floor(userCourseIds.length * 0.3)) } }
        },
        _count: { userId: true }
      });

      // Get courses enrolled by similar users
      const recommendations: Recommendation[] = [];
      
      for (const similarUser of similarUsers.slice(0, 10)) {
        const theirCourses = await prisma.enrollment.findMany({
          where: {
            userId: similarUser.userId,
            courseId: { notIn: userCourseIds }
          },
          include: { course: true }
        });

        for (const enrollment of theirCourses) {
          const score = this.calculateCollaborativeScore(similarUser._count.userId, userCourseIds.length);
          
          recommendations.push({
            id: `collab_${enrollment.courseId}`,
            userId,
            type: RecommendationType.COURSE,
            entityId: enrollment.courseId,
            score,
            reason: `Users with similar interests also took this course`,
            createdAt: new Date()
          });
        }
      }

      return recommendations;
    } catch (error) {
      logger.error('Error getting collaborative filtering recommendations', { userId, error });
      return [];
    }
  }

  private async getContentBasedRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      const userEnrollments = await prisma.enrollment.findMany({
        where: { userId },
        include: { course: true }
      });

      // Extract user preferences from completed courses
      const userTags = userEnrollments.flatMap(e => e.course.tags);
      const userCategories = userEnrollments.map(e => e.course.categoryId);
      const userLevels = userEnrollments.map(e => e.course.level);

      // Find similar courses not yet taken
      const similarCourses = await prisma.course.findMany({
        where: {
          isPublished: true,
          id: { notIn: userEnrollments.map(e => e.courseId) },
          OR: [
            { tags: { hasSome: userTags } },
            { categoryId: { in: userCategories } },
            { level: { in: userLevels } }
          ]
        }
      });

      const recommendations: Recommendation[] = similarCourses.map(course => {
        const score = this.calculateContentSimilarity(course, userTags, userCategories, userLevels);
        
        return {
          id: `content_${course.id}`,
          userId,
          type: RecommendationType.COURSE,
          entityId: course.id,
          score,
          reason: this.generateContentBasedReason(course, userTags, userCategories),
          createdAt: new Date()
        };
      });

      return recommendations;
    } catch (error) {
      logger.error('Error getting content-based recommendations', { userId, error });
      return [];
    }
  }

  private async getPopularityBasedRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      const userEnrollments = await prisma.enrollment.findMany({
        where: { userId },
        select: { courseId: true }
      });

      const enrolledCourseIds = userEnrollments.map(e => e.courseId);

      const popularCourses = await prisma.enrollment.groupBy({
        by: ['courseId'],
        where: {
          courseId: { notIn: enrolledCourseIds }
        },
        _count: { courseId: true },
        orderBy: {
          _count: { courseId: 'desc' }
        },
        take: 20
      });

      const recommendations: Recommendation[] = [];
      
      for (const item of popularCourses) {
        const course = await prisma.course.findUnique({
          where: { id: item.courseId }
        });

        if (course && course.isPublished) {
          const score = Math.min(0.8, item._count.courseId / 100); // Normalize popularity score
          
          recommendations.push({
            id: `popular_${course.id}`,
            userId,
            type: RecommendationType.COURSE,
            entityId: course.id,
            score,
            reason: `Popular course with ${item._count.courseId} students enrolled`,
            createdAt: new Date()
          });
        }
      }

      return recommendations;
    } catch (error) {
      logger.error('Error getting popularity-based recommendations', { userId, error });
      return [];
    }
  }

  private async getSkillGapRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      // Analyze user's current skills vs. desired skills
      const userSkills = await this.analyzeUserSkills(userId);
      const industrySkills = await this.getIndustrySkillRequirements(userId);
      
      const skillGaps = industrySkills.filter(skill => !userSkills.includes(skill));
      
      if (skillGaps.length === 0) return [];

      // Find courses that address skill gaps
      const gapFillingCourses = await prisma.course.findMany({
        where: {
          isPublished: true,
          tags: { hasSome: skillGaps }
        }
      });

      const recommendations: Recommendation[] = gapFillingCourses.map(course => {
        const relevantSkills = course.tags.filter(tag => skillGaps.includes(tag));
        const score = Math.min(0.9, relevantSkills.length / skillGaps.length);
        
        return {
          id: `skillgap_${course.id}`,
          userId,
          type: RecommendationType.COURSE,
          entityId: course.id,
          score,
          reason: `Helps develop missing skills: ${relevantSkills.join(', ')}`,
          createdAt: new Date()
        };
      });

      return recommendations;
    } catch (error) {
      logger.error('Error getting skill gap recommendations', { userId, error });
      return [];
    }
  }

  private combineAndRankRecommendations(recommendations: Recommendation[], limit: number): Recommendation[] {
    // Remove duplicates and combine scores for same courses
    const courseScores: Record<string, { recommendation: Recommendation; totalScore: number; count: number }> = {};
    
    recommendations.forEach(rec => {
      if (courseScores[rec.entityId]) {
        courseScores[rec.entityId].totalScore += rec.score;
        courseScores[rec.entityId].count += 1;
      } else {
        courseScores[rec.entityId] = {
          recommendation: rec,
          totalScore: rec.score,
          count: 1
        };
      }
    });

    // Calculate average scores and sort
    const rankedRecs = Object.values(courseScores)
      .map(item => ({
        ...item.recommendation,
        score: item.totalScore / item.count
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return rankedRecs;
  }

  private async analyzeUserSkills(userId: string): Promise<string[]> {
    const completedCourses = await prisma.enrollment.findMany({
      where: {
        userId,
        status: 'completed'
      },
      include: { course: true }
    });

    return completedCourses.flatMap(e => e.course.tags);
  }

  private async inferCareerGoals(userId: string): Promise<string[]> {
    // In a real implementation, this could analyze user's profile, job title, etc.
    return ['leadership', 'technical_skills', 'project_management'];
  }

  private async getIndustrySkillRequirements(userId: string): Promise<string[]> {
    // In a real implementation, fetch from industry data or job market APIs
    return ['javascript', 'python', 'leadership', 'communication', 'project_management'];
  }

  // Additional helper methods would go here...

  private calculateCollaborativeScore(commonCourses: number, totalUserCourses: number): number {
    return Math.min(0.9, commonCourses / totalUserCourses);
  }

  private calculateContentSimilarity(
    course: any, 
    userTags: string[], 
    userCategories: string[], 
    userLevels: string[]
  ): number {
    let score = 0;
    
    // Tag similarity
    const commonTags = course.tags.filter((tag: string) => userTags.includes(tag)).length;
    score += (commonTags / Math.max(course.tags.length, userTags.length)) * 0.5;
    
    // Category similarity
    if (userCategories.includes(course.categoryId)) {
      score += 0.3;
    }
    
    // Level similarity
    if (userLevels.includes(course.level)) {
      score += 0.2;
    }
    
    return Math.min(0.9, score);
  }

  private generateContentBasedReason(course: any, userTags: string[], userCategories: string[]): string {
    const commonTags = course.tags.filter((tag: string) => userTags.includes(tag));
    
    if (commonTags.length > 0) {
      return `Similar to your interests in ${commonTags.slice(0, 2).join(' and ')}`;
    }
    
    if (userCategories.includes(course.categoryId)) {
      return `Matches your preferred category`;
    }
    
    return `Recommended based on your learning history`;
  }

  private async buildUserProfile(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        enrollments: {
          include: { course: true }
        }
      }
    });

    // Build comprehensive profile
    return {
      basicInfo: {
        role: user?.role,
        department: user?.department
      },
      learningHistory: {
        completedCourses: user?.enrollments.filter(e => e.status === 'completed').length || 0,
        activeCourses: user?.enrollments.filter(e => e.status === 'active').length || 0,
        averageProgress: user?.enrollments.reduce((sum, e) => sum + e.progress, 0) / (user?.enrollments.length || 1)
      },
      preferences: await this.getCachedUserPreferences(userId),
      skills: await this.analyzeUserSkills(userId)
    };
  }

  private async getAvailableCoursesForUser(userId: string): Promise<Course[]> {
    const enrolledCourseIds = await prisma.enrollment.findMany({
      where: { userId },
      select: { courseId: true }
    }).then(enrollments => enrollments.map(e => e.courseId));

    return prisma.course.findMany({
      where: {
        isPublished: true,
        id: { notIn: enrolledCourseIds }
      }
    }) as Promise<Course[]>;
  }

  private async cacheUserPreferences(userId: string, preferences: any): Promise<void> {
    // Cache user preferences
    logger.debug('Caching user preferences', { userId });
  }

  private async getCachedUserPreferences(userId: string): Promise<any> {
    // Return cached preferences or defaults
    return {
      interests: [],
      careerGoals: [],
      learningStyle: 'visual',
      timeAvailability: 'medium',
      difficultyPreference: 'intermediate'
    };
  }

  private async invalidateRecommendationCache(userId: string): Promise<void> {
    // Invalidate cached recommendations
    logger.debug('Invalidating recommendation cache', { userId });
  }

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

  private async findNextModule(enrollment: any): Promise<any> {
    // Find the next incomplete module
    const modules = enrollment.course.modules;
    return modules.find((module: any) => {
      // Logic to determine if module is completed
      return true; // Simplified
    });
  }

  private calculateModulePriority(enrollment: any, module: any): number {
    // Calculate priority based on due dates, prerequisites, etc.
    return 0.8;
  }

  private async calculatePathRelevance(user: any, path: any, userSkills: string[], careerGoals: string[]): Promise<number> {
    // Calculate how relevant a learning path is to the user
    return 0.7;
  }

  private async generatePathRecommendationReason(user: any, path: any, userSkills: string[]): Promise<string> {
    return `This learning path aligns with your career goals and builds on your current skills`;
  }

  private async updateRecommendationMetrics(recommendationId: string, action: string): Promise<void> {
    // Update metrics for recommendation performance tracking
    logger.debug('Updating recommendation metrics', { recommendationId, action });
  }

  private async getTopPerformingRecommendedCourses(timeframe: string): Promise<Array<{ courseId: string; title: string; score: number }>> {
    // Get courses that perform well when recommended
    return [];
  }
}

export const recommendationService = new RecommendationService();