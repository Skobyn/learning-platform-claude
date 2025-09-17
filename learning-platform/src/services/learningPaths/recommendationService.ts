import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// Validation schemas
const RecommendationFilters = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(10),
  excludeEnrolled: z.boolean().optional().default(true),
  includeDifficulty: z.array(z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])).optional(),
  includeCategories: z.array(z.string()).optional(),
  minConfidenceScore: z.number().min(0).max(1).optional().default(0.3),
});

export type RecommendationFiltersInput = z.infer<typeof RecommendationFilters>;

export interface UserProfile {
  id: string;
  currentSkills: string[];
  targetSkills: string[];
  interests: string[];
  currentRole: string;
  department: string;
  experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  learningStyle: string;
  completedPaths: string[];
  inProgressPaths: string[];
  averageCompletionTime: number; // in days
  preferredDifficulty: string[];
  timeAvailability: number; // hours per week
}

export interface LearningPathRecommendation {
  pathId: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  estimatedDuration: number;
  skills: string[];
  enrollmentCount: number;
  averageRating: number;
  recommendationType: 'SKILL_BASED' | 'ROLE_BASED' | 'COLLABORATIVE' | 'TRENDING' | 'SIMILAR_USERS';
  confidenceScore: number;
  reasoning: string;
  factors: {
    skillMatchScore: number;
    roleMatchScore: number;
    difficultyFitScore: number;
    timeAvailabilityScore: number;
    popularityScore: number;
  };
  prerequisites: string[];
  estimatedCompletionDate?: Date;
}

export interface SkillGapAnalysis {
  userId: string;
  targetRole?: string;
  skillGaps: {
    skill: string;
    currentLevel: number; // 1-10
    targetLevel: number; // 1-10
    gap: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendedPaths: string[];
  }[];
  recommendations: LearningPathRecommendation[];
}

export interface CareerPathAnalysis {
  currentRole: string;
  targetRole: string;
  progressPercentage: number;
  estimatedTimeToComplete: number; // in months
  requiredSkills: string[];
  missingSkills: string[];
  recommendedPaths: LearningPathRecommendation[];
  milestones: {
    title: string;
    skills: string[];
    estimatedDuration: number;
    pathIds: string[];
    completed: boolean;
  }[];
}

export class RecommendationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get personalized learning path recommendations for a user
   */
  async getPersonalizedRecommendations(
    filters: RecommendationFiltersInput
  ): Promise<LearningPathRecommendation[]> {
    try {
      const validatedFilters = RecommendationFilters.parse(filters);
      const { userId, limit, excludeEnrolled, includeDifficulty, includeCategories, minConfidenceScore } = validatedFilters;

      // Get user profile
      const userProfile = await this.buildUserProfile(userId);

      // Get potential learning paths
      const pathsWhere: any = {
        status: 'PUBLISHED',
        isPublic: true,
        ...(includeDifficulty && { difficulty: { in: includeDifficulty } }),
        ...(includeCategories && { category: { in: includeCategories } }),
      };

      // Exclude already enrolled paths
      if (excludeEnrolled) {
        pathsWhere.id = {
          notIn: [...userProfile.completedPaths, ...userProfile.inProgressPaths],
        };
      }

      const candidatePaths = await this.prisma.learningPath.findMany({
        where: pathsWhere,
        include: {
          dependencies: {
            include: {
              prerequisitePath: {
                select: { id: true, title: true },
              },
            },
          },
        },
        take: limit * 3, // Get more candidates for better filtering
      });

      // Score and rank recommendations
      const recommendations: LearningPathRecommendation[] = [];

      for (const path of candidatePaths) {
        const recommendation = await this.scoreLearningPath(path, userProfile);

        if (recommendation.confidenceScore >= minConfidenceScore) {
          recommendations.push(recommendation);
        }
      }

      // Sort by confidence score and return top results
      return recommendations
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, limit);
    } catch (error) {
      throw new Error(`Failed to get recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get skill-based recommendations
   */
  async getSkillBasedRecommendations(
    userId: string,
    targetSkills: string[],
    limit: number = 10
  ): Promise<LearningPathRecommendation[]> {
    try {
      const userProfile = await this.buildUserProfile(userId);

      const paths = await this.prisma.learningPath.findMany({
        where: {
          status: 'PUBLISHED',
          isPublic: true,
          skills: { hasSome: targetSkills },
          id: { notIn: [...userProfile.completedPaths, ...userProfile.inProgressPaths] },
        },
        take: limit * 2,
      });

      const recommendations: LearningPathRecommendation[] = [];

      for (const path of paths) {
        const skillMatchScore = this.calculateSkillMatch(path.skills || [], targetSkills);

        if (skillMatchScore > 0.3) {
          const recommendation = await this.scoreLearningPath(path, userProfile);
          recommendation.recommendationType = 'SKILL_BASED';
          recommendation.factors.skillMatchScore = skillMatchScore;
          recommendations.push(recommendation);
        }
      }

      return recommendations
        .sort((a, b) => b.factors.skillMatchScore - a.factors.skillMatchScore)
        .slice(0, limit);
    } catch (error) {
      throw new Error(`Failed to get skill-based recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get role-based recommendations
   */
  async getRoleBasedRecommendations(
    userId: string,
    targetRole: string,
    limit: number = 10
  ): Promise<LearningPathRecommendation[]> {
    try {
      const userProfile = await this.buildUserProfile(userId);

      // Get learning paths that are commonly taken by users in the target role
      const roleBasedPaths = await this.prisma.learningPath.findMany({
        where: {
          status: 'PUBLISHED',
          isPublic: true,
          enrollments: {
            some: {
              user: {
                jobTitle: { contains: targetRole, mode: 'insensitive' },
              },
              status: 'COMPLETED',
            },
          },
          id: { notIn: [...userProfile.completedPaths, ...userProfile.inProgressPaths] },
        },
        include: {
          _count: {
            select: {
              enrollments: {
                where: {
                  user: {
                    jobTitle: { contains: targetRole, mode: 'insensitive' },
                  },
                  status: 'COMPLETED',
                },
              },
            },
          },
        },
        take: limit * 2,
      });

      const recommendations: LearningPathRecommendation[] = [];

      for (const path of roleBasedPaths) {
        const recommendation = await this.scoreLearningPath(path, userProfile);
        recommendation.recommendationType = 'ROLE_BASED';

        // Higher score for paths commonly completed by people in target role
        const rolePopularity = path._count?.enrollments || 0;
        recommendation.factors.roleMatchScore = Math.min(1, rolePopularity / 10);

        recommendations.push(recommendation);
      }

      return recommendations
        .sort((a, b) => b.factors.roleMatchScore - a.factors.roleMatchScore)
        .slice(0, limit);
    } catch (error) {
      throw new Error(`Failed to get role-based recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get collaborative filtering recommendations
   */
  async getCollaborativeRecommendations(
    userId: string,
    limit: number = 10
  ): Promise<LearningPathRecommendation[]> {
    try {
      const userProfile = await this.buildUserProfile(userId);

      // Find similar users based on completed paths and skills
      const similarUsers = await this.findSimilarUsers(userId);

      if (similarUsers.length === 0) {
        return [];
      }

      // Get paths completed by similar users that current user hasn't taken
      const recommendedPaths = await this.prisma.learningPath.findMany({
        where: {
          status: 'PUBLISHED',
          isPublic: true,
          enrollments: {
            some: {
              userId: { in: similarUsers.map(u => u.userId) },
              status: 'COMPLETED',
            },
          },
          id: { notIn: [...userProfile.completedPaths, ...userProfile.inProgressPaths] },
        },
        include: {
          _count: {
            select: {
              enrollments: {
                where: {
                  userId: { in: similarUsers.map(u => u.userId) },
                  status: 'COMPLETED',
                },
              },
            },
          },
        },
        take: limit * 2,
      });

      const recommendations: LearningPathRecommendation[] = [];

      for (const path of recommendedPaths) {
        const recommendation = await this.scoreLearningPath(path, userProfile);
        recommendation.recommendationType = 'COLLABORATIVE';

        // Score based on how many similar users completed this path
        const similarUserCompletions = path._count?.enrollments || 0;
        recommendation.factors.popularityScore = Math.min(1, similarUserCompletions / similarUsers.length);

        recommendations.push(recommendation);
      }

      return recommendations
        .sort((a, b) => b.factors.popularityScore - a.factors.popularityScore)
        .slice(0, limit);
    } catch (error) {
      throw new Error(`Failed to get collaborative recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze skill gaps for a user
   */
  async analyzeSkillGaps(
    userId: string,
    targetRole?: string
  ): Promise<SkillGapAnalysis> {
    try {
      const userProfile = await this.buildUserProfile(userId);

      // Get required skills for target role (simplified - would use a skills database)
      const requiredSkills = targetRole ? await this.getRoleRequiredSkills(targetRole) : [];

      // Calculate skill gaps
      const skillGaps = [];
      for (const skill of requiredSkills) {
        const currentSkill = await this.prisma.userSkill.findUnique({
          where: {
            userId_skillId: {
              userId,
              skillId: skill.id,
            },
          },
        });

        const currentLevel = currentSkill?.proficiencyLevel || 0;
        const targetLevel = skill.targetLevel;
        const gap = Math.max(0, targetLevel - currentLevel);

        if (gap > 0) {
          // Find learning paths that teach this skill
          const recommendedPaths = await this.prisma.learningPath.findMany({
            where: {
              status: 'PUBLISHED',
              skills: { has: skill.name },
            },
            select: { id: true },
            take: 3,
          });

          skillGaps.push({
            skill: skill.name,
            currentLevel,
            targetLevel,
            gap,
            priority: gap >= 5 ? 'CRITICAL' : gap >= 3 ? 'HIGH' : gap >= 1 ? 'MEDIUM' : 'LOW',
            recommendedPaths: recommendedPaths.map(p => p.id),
          });
        }
      }

      // Get overall recommendations based on skill gaps
      const recommendations = await this.getSkillBasedRecommendations(
        userId,
        skillGaps.map(sg => sg.skill),
        10
      );

      return {
        userId,
        targetRole,
        skillGaps,
        recommendations,
      };
    } catch (error) {
      throw new Error(`Failed to analyze skill gaps: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze career path progression
   */
  async analyzeCareerPath(
    userId: string,
    targetRole: string
  ): Promise<CareerPathAnalysis> {
    try {
      const userProfile = await this.buildUserProfile(userId);
      const requiredSkills = await this.getRoleRequiredSkills(targetRole);

      // Calculate missing skills
      const userSkillNames = userProfile.currentSkills;
      const requiredSkillNames = requiredSkills.map(s => s.name);
      const missingSkills = requiredSkillNames.filter(skill => !userSkillNames.includes(skill));

      // Calculate progress percentage
      const progressPercentage = ((requiredSkillNames.length - missingSkills.length) / requiredSkillNames.length) * 100;

      // Estimate time to complete (simplified calculation)
      const estimatedTimeToComplete = Math.ceil(missingSkills.length * 2); // 2 months per skill

      // Get recommendations for missing skills
      const recommendations = await this.getSkillBasedRecommendations(userId, missingSkills, 15);

      // Create milestones (grouped by skill categories)
      const milestones = this.createCareerMilestones(requiredSkills, userProfile.currentSkills, recommendations);

      return {
        currentRole: userProfile.currentRole,
        targetRole,
        progressPercentage,
        estimatedTimeToComplete,
        requiredSkills: requiredSkillNames,
        missingSkills,
        recommendedPaths: recommendations,
        milestones,
      };
    } catch (error) {
      throw new Error(`Failed to analyze career path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build comprehensive user profile for recommendations
   */
  private async buildUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        preferences: true,
        skills: {
          include: { skill: true },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get user's learning history
    const enrollments = await this.prisma.learningPathEnrollment.findMany({
      where: { userId },
      include: {
        learningPath: {
          select: { id: true, skills: true, estimatedDuration: true },
        },
      },
    });

    const completedPaths = enrollments
      .filter(e => e.status === 'COMPLETED')
      .map(e => e.learningPathId);

    const inProgressPaths = enrollments
      .filter(e => e.status === 'ACTIVE')
      .map(e => e.learningPathId);

    // Calculate average completion time
    const completedEnrollments = enrollments.filter(e => e.status === 'COMPLETED' && e.completedAt && e.startedAt);
    const averageCompletionTime = completedEnrollments.length > 0
      ? completedEnrollments.reduce((sum, e) => {
          const days = (e.completedAt!.getTime() - e.startedAt!.getTime()) / (1000 * 60 * 60 * 24);
          return sum + days;
        }, 0) / completedEnrollments.length
      : 30; // Default 30 days

    const currentSkills = user.skills.map(us => us.skill.name);

    return {
      id: userId,
      currentSkills,
      targetSkills: [], // Would be derived from user goals
      interests: [], // Would be derived from user preferences
      currentRole: user.jobTitle || 'Unknown',
      department: user.department || 'Unknown',
      experienceLevel: this.inferExperienceLevel(currentSkills, completedPaths),
      learningStyle: user.preferences?.learningStyle || 'VISUAL',
      completedPaths,
      inProgressPaths,
      averageCompletionTime,
      preferredDifficulty: this.inferPreferredDifficulty(completedPaths),
      timeAvailability: 10, // Default 10 hours per week
    };
  }

  /**
   * Score a learning path for a specific user
   */
  private async scoreLearningPath(path: any, userProfile: UserProfile): Promise<LearningPathRecommendation> {
    // Calculate various factors
    const skillMatchScore = this.calculateSkillMatch(path.skills || [], userProfile.currentSkills);
    const roleMatchScore = this.calculateRoleMatch(path, userProfile);
    const difficultyFitScore = this.calculateDifficultyFit(path.difficulty, userProfile);
    const timeAvailabilityScore = this.calculateTimeAvailabilityScore(path.estimatedDuration, userProfile);
    const popularityScore = Math.min(1, (path.enrollmentCount || 0) / 1000);

    // Calculate overall confidence score
    const confidenceScore = (
      skillMatchScore * 0.3 +
      roleMatchScore * 0.2 +
      difficultyFitScore * 0.2 +
      timeAvailabilityScore * 0.15 +
      popularityScore * 0.15
    );

    // Generate reasoning
    const reasoning = this.generateRecommendationReasoning(path, userProfile, {
      skillMatchScore,
      roleMatchScore,
      difficultyFitScore,
      timeAvailabilityScore,
      popularityScore,
    });

    // Estimate completion date
    const estimatedCompletionDate = new Date();
    estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + Math.ceil(path.estimatedDuration / (userProfile.timeAvailability * 60)));

    return {
      pathId: path.id,
      title: path.title,
      description: path.description,
      category: path.category,
      difficulty: path.difficulty,
      estimatedDuration: path.estimatedDuration,
      skills: path.skills || [],
      enrollmentCount: path.enrollmentCount || 0,
      averageRating: path.averageRating || 0,
      recommendationType: 'SKILL_BASED', // Default, will be overridden by specific methods
      confidenceScore,
      reasoning,
      factors: {
        skillMatchScore,
        roleMatchScore,
        difficultyFitScore,
        timeAvailabilityScore,
        popularityScore,
      },
      prerequisites: (path.dependencies || []).map((dep: any) => dep.prerequisitePath?.title || ''),
      estimatedCompletionDate,
    };
  }

  /**
   * Calculate skill match score between path skills and user skills
   */
  private calculateSkillMatch(pathSkills: string[], userSkills: string[]): number {
    if (pathSkills.length === 0) return 0;

    const matchingSkills = pathSkills.filter(skill => userSkills.includes(skill));
    const newSkills = pathSkills.filter(skill => !userSkills.includes(skill));

    // Score based on mix of reinforcing existing skills and learning new ones
    const reinforcementScore = matchingSkills.length / pathSkills.length;
    const noveltyScore = Math.min(1, newSkills.length / 3); // Up to 3 new skills is good

    return (reinforcementScore * 0.3) + (noveltyScore * 0.7);
  }

  /**
   * Calculate role match score
   */
  private calculateRoleMatch(path: any, userProfile: UserProfile): number {
    // Simplified role matching - would use more sophisticated logic in production
    const roleKeywords = userProfile.currentRole.toLowerCase().split(' ');
    const pathText = `${path.title} ${path.description} ${path.category}`.toLowerCase();

    const matches = roleKeywords.filter(keyword => pathText.includes(keyword));
    return Math.min(1, matches.length / roleKeywords.length);
  }

  /**
   * Calculate difficulty fit score
   */
  private calculateDifficultyFit(pathDifficulty: string, userProfile: UserProfile): number {
    const userLevel = userProfile.experienceLevel;

    if (userLevel === pathDifficulty) return 1.0;

    // Allow some difficulty progression
    if (userLevel === 'BEGINNER' && pathDifficulty === 'INTERMEDIATE') return 0.8;
    if (userLevel === 'INTERMEDIATE' && pathDifficulty === 'ADVANCED') return 0.8;
    if (userLevel === 'INTERMEDIATE' && pathDifficulty === 'BEGINNER') return 0.6;
    if (userLevel === 'ADVANCED' && pathDifficulty === 'INTERMEDIATE') return 0.6;

    return 0.3; // Significant mismatch
  }

  /**
   * Calculate time availability score
   */
  private calculateTimeAvailabilityScore(pathDuration: number, userProfile: UserProfile): number {
    const hoursNeeded = pathDuration / 60;
    const weeksNeeded = Math.ceil(hoursNeeded / userProfile.timeAvailability);

    // Optimal range is 2-8 weeks
    if (weeksNeeded >= 2 && weeksNeeded <= 8) return 1.0;
    if (weeksNeeded === 1 || weeksNeeded <= 12) return 0.8;
    if (weeksNeeded <= 16) return 0.6;
    return 0.3;
  }

  /**
   * Generate human-readable reasoning for recommendation
   */
  private generateRecommendationReasoning(
    path: any,
    userProfile: UserProfile,
    factors: any
  ): string {
    const reasons = [];

    if (factors.skillMatchScore > 0.7) {
      reasons.push('Strong match with your current skills');
    } else if (factors.skillMatchScore > 0.4) {
      reasons.push('Good opportunity to expand your skillset');
    }

    if (factors.roleMatchScore > 0.6) {
      reasons.push('Relevant to your current role');
    }

    if (factors.difficultyFitScore > 0.8) {
      reasons.push('Appropriate difficulty level for your experience');
    }

    if (factors.timeAvailabilityScore > 0.8) {
      reasons.push('Fits well with your available time');
    }

    if (factors.popularityScore > 0.7) {
      reasons.push('Popular choice among other learners');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Based on your learning profile';
  }

  /**
   * Find users similar to the given user
   */
  private async findSimilarUsers(userId: string): Promise<{ userId: string; similarity: number }[]> {
    // Simplified similarity calculation - would use more sophisticated algorithms in production
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        skills: true,
        enrollments: {
          where: { status: 'COMPLETED' },
          select: { learningPathId: true },
        },
      },
    });

    if (!user) return [];

    const userSkills = user.skills.map(s => s.skillId);
    const userPaths = user.enrollments.map(e => e.learningPathId);

    // Find users with similar skills and completed paths
    const similarUsers = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { skills: { some: { skillId: { in: userSkills } } } },
          { enrollments: { some: { learningPathId: { in: userPaths }, status: 'COMPLETED' } } },
        ],
      },
      include: {
        skills: true,
        enrollments: {
          where: { status: 'COMPLETED' },
          select: { learningPathId: true },
        },
      },
      take: 50,
    });

    return similarUsers
      .map(otherUser => {
        const otherSkills = otherUser.skills.map(s => s.skillId);
        const otherPaths = otherUser.enrollments.map(e => e.learningPathId);

        const skillSimilarity = this.calculateJaccardSimilarity(userSkills, otherSkills);
        const pathSimilarity = this.calculateJaccardSimilarity(userPaths, otherPaths);

        return {
          userId: otherUser.id,
          similarity: (skillSimilarity + pathSimilarity) / 2,
        };
      })
      .filter(u => u.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
  }

  /**
   * Calculate Jaccard similarity between two arrays
   */
  private calculateJaccardSimilarity(set1: string[], set2: string[]): number {
    const intersection = set1.filter(item => set2.includes(item));
    const union = [...new Set([...set1, ...set2])];

    return union.length > 0 ? intersection.length / union.length : 0;
  }

  /**
   * Infer user experience level based on skills and completed paths
   */
  private inferExperienceLevel(
    skills: string[],
    completedPaths: string[]
  ): 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' {
    const skillCount = skills.length;
    const pathCount = completedPaths.length;

    if (skillCount >= 10 && pathCount >= 5) return 'ADVANCED';
    if (skillCount >= 5 && pathCount >= 2) return 'INTERMEDIATE';
    return 'BEGINNER';
  }

  /**
   * Infer preferred difficulty based on completed paths
   */
  private inferPreferredDifficulty(completedPaths: string[]): string[] {
    // Simplified - would analyze actual difficulty of completed paths
    return ['INTERMEDIATE'];
  }

  /**
   * Get required skills for a role (mock implementation)
   */
  private async getRoleRequiredSkills(role: string): Promise<{ id: string; name: string; targetLevel: number }[]> {
    // This would typically come from a skills database or external API
    const roleSkillsMap: Record<string, { name: string; targetLevel: number }[]> = {
      'Software Engineer': [
        { name: 'JavaScript', targetLevel: 8 },
        { name: 'React', targetLevel: 7 },
        { name: 'Node.js', targetLevel: 6 },
        { name: 'Database Design', targetLevel: 6 },
        { name: 'System Design', targetLevel: 5 },
      ],
      'Product Manager': [
        { name: 'Product Strategy', targetLevel: 8 },
        { name: 'Data Analysis', targetLevel: 7 },
        { name: 'User Research', targetLevel: 6 },
        { name: 'Project Management', targetLevel: 7 },
        { name: 'Communication', targetLevel: 8 },
      ],
      'Data Scientist': [
        { name: 'Python', targetLevel: 8 },
        { name: 'Machine Learning', targetLevel: 7 },
        { name: 'Statistics', targetLevel: 8 },
        { name: 'Data Visualization', targetLevel: 6 },
        { name: 'SQL', targetLevel: 7 },
      ],
    };

    const skills = roleSkillsMap[role] || [];
    return skills.map((skill, index) => ({
      id: `skill_${index}`,
      name: skill.name,
      targetLevel: skill.targetLevel,
    }));
  }

  /**
   * Create career milestones for progression
   */
  private createCareerMilestones(
    requiredSkills: { name: string; targetLevel: number }[],
    currentSkills: string[],
    recommendations: LearningPathRecommendation[]
  ): { title: string; skills: string[]; estimatedDuration: number; pathIds: string[]; completed: boolean }[] {
    // Group skills into logical milestones
    const milestones = [
      {
        title: 'Foundation Skills',
        skills: requiredSkills.slice(0, 2).map(s => s.name),
        estimatedDuration: 3, // months
        pathIds: recommendations.slice(0, 3).map(r => r.pathId),
        completed: false,
      },
      {
        title: 'Intermediate Skills',
        skills: requiredSkills.slice(2, 4).map(s => s.name),
        estimatedDuration: 4, // months
        pathIds: recommendations.slice(3, 6).map(r => r.pathId),
        completed: false,
      },
      {
        title: 'Advanced Skills',
        skills: requiredSkills.slice(4).map(s => s.name),
        estimatedDuration: 5, // months
        pathIds: recommendations.slice(6).map(r => r.pathId),
        completed: false,
      },
    ];

    // Mark milestones as completed if user has all required skills
    return milestones.map(milestone => ({
      ...milestone,
      completed: milestone.skills.every(skill => currentSkills.includes(skill)),
    }));
  }
}

export default RecommendationService;