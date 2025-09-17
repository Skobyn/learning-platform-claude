import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import RecommendationService from '@/services/learningPaths/recommendationService';

const prisma = new PrismaClient();
const recommendationService = new RecommendationService(prisma);

const PersonalizedRecommendationsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
  excludeEnrolled: z.boolean().optional().default(true),
  includeDifficulty: z.array(z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])).optional(),
  includeCategories: z.array(z.string()).optional(),
  minConfidenceScore: z.number().min(0).max(1).optional().default(0.3),
});

const SkillBasedRecommendationsSchema = z.object({
  targetSkills: z.array(z.string()).min(1),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

const RoleBasedRecommendationsSchema = z.object({
  targetRole: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

const SkillGapAnalysisSchema = z.object({
  targetRole: z.string().optional(),
});

const CareerPathAnalysisSchema = z.object({
  targetRole: z.string().min(1),
});

/**
 * GET /api/recommendations
 * Get personalized learning path recommendations
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Parse query parameters
    const {
      limit = 10,
      excludeEnrolled = true,
      includeDifficulty,
      includeCategories,
      minConfidenceScore = 0.3,
    } = PersonalizedRecommendationsSchema.parse({
      limit: queryParams.limit ? parseInt(queryParams.limit) : undefined,
      excludeEnrolled: queryParams.excludeEnrolled !== 'false',
      includeDifficulty: queryParams.includeDifficulty ? queryParams.includeDifficulty.split(',') : undefined,
      includeCategories: queryParams.includeCategories ? queryParams.includeCategories.split(',') : undefined,
      minConfidenceScore: queryParams.minConfidenceScore ? parseFloat(queryParams.minConfidenceScore) : undefined,
    });

    const recommendations = await recommendationService.getPersonalizedRecommendations({
      userId: session.user.id,
      limit,
      excludeEnrolled,
      includeDifficulty,
      includeCategories,
      minConfidenceScore,
    });

    return NextResponse.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error('Error getting personalized recommendations:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get recommendations',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recommendations/skill-based
 * Get skill-based recommendations
 */
export async function skillBasedRecommendations(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetSkills, limit } = SkillBasedRecommendationsSchema.parse(body);

    const recommendations = await recommendationService.getSkillBasedRecommendations(
      session.user.id,
      targetSkills,
      limit
    );

    return NextResponse.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error('Error getting skill-based recommendations:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get skill-based recommendations',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recommendations/role-based
 * Get role-based recommendations
 */
export async function roleBasedRecommendations(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetRole, limit } = RoleBasedRecommendationsSchema.parse(body);

    const recommendations = await recommendationService.getRoleBasedRecommendations(
      session.user.id,
      targetRole,
      limit
    );

    return NextResponse.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error('Error getting role-based recommendations:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get role-based recommendations',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/recommendations/collaborative
 * Get collaborative filtering recommendations
 */
export async function collaborativeRecommendations(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    const recommendations = await recommendationService.getCollaborativeRecommendations(
      session.user.id,
      limit
    );

    return NextResponse.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error('Error getting collaborative recommendations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get collaborative recommendations',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recommendations/skill-gap-analysis
 * Analyze skill gaps for a user
 */
export async function skillGapAnalysis(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetRole } = SkillGapAnalysisSchema.parse(body);

    const analysis = await recommendationService.analyzeSkillGaps(
      session.user.id,
      targetRole
    );

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error('Error analyzing skill gaps:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze skill gaps',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recommendations/career-path-analysis
 * Analyze career path progression
 */
export async function careerPathAnalysis(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetRole } = CareerPathAnalysisSchema.parse(body);

    const analysis = await recommendationService.analyzeCareerPath(
      session.user.id,
      targetRole
    );

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error('Error analyzing career path:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze career path',
      },
      { status: 500 }
    );
  }
}