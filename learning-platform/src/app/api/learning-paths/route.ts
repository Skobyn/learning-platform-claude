import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import LearningPathService from '@/services/learningPaths/pathService';
import ProgressTracker from '@/services/learningPaths/progressTracker';

const prisma = new PrismaClient();
const pathService = new LearningPathService(prisma);
const progressTracker = new ProgressTracker(prisma);

// Validation schemas
const CreatePathSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  shortDescription: z.string().max(500).optional(),
  category: z.string().min(1),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  tags: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
  learningObjectives: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  templateCategory: z.string().optional(),
});

const QuerySchema = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  category: z.string().optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  tags: z.string().optional(), // Comma-separated
  skills: z.string().optional(), // Comma-separated
  status: z.string().optional(),
  isPublic: z.string().transform(Boolean).optional(),
  isFeatured: z.string().transform(Boolean).optional(),
  isTemplate: z.string().transform(Boolean).optional(),
  templateCategory: z.string().optional(),
  search: z.string().optional(),
});

/**
 * GET /api/learning-paths
 * Get learning paths with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const queryData = Object.fromEntries(searchParams.entries());
    const {
      page = 1,
      limit = 20,
      category,
      difficulty,
      tags,
      skills,
      status = 'PUBLISHED',
      isPublic,
      isFeatured,
      isTemplate,
      templateCategory,
      search,
    } = QuerySchema.parse(queryData);

    // Convert comma-separated strings to arrays
    const tagsArray = tags ? tags.split(',').map(t => t.trim()) : undefined;
    const skillsArray = skills ? skills.split(',').map(s => s.trim()) : undefined;

    const options = {
      page,
      limit,
      category,
      difficulty,
      tags: tagsArray,
      skills: skillsArray,
      status,
      isPublic,
      isFeatured,
      isTemplate,
      templateCategory,
      search,
      // Only show organization paths if user is authenticated
      organizationId: session?.user?.organizationId,
    };

    const result = await pathService.getLearningPaths(options);

    return NextResponse.json({
      success: true,
      data: result.paths,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: result.pages,
      },
    });
  } catch (error) {
    console.error('Error fetching learning paths:', error);

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
        error: 'Failed to fetch learning paths',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/learning-paths
 * Create a new learning path
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if user has permission to create learning paths
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });

    if (!user || !['INSTRUCTOR', 'ADMIN'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = CreatePathSchema.parse(body);

    const learningPath = await pathService.createLearningPath(
      validatedData,
      session.user.id,
      user.organizationId
    );

    return NextResponse.json({
      success: true,
      data: learningPath,
      message: 'Learning path created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating learning path:', error);

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
        error: error instanceof Error ? error.message : 'Failed to create learning path',
      },
      { status: 500 }
    );
  }
}

/**
 * Helper function to check user permissions
 */
async function checkPermissions(
  userId: string,
  requiredRoles: string[] = ['INSTRUCTOR', 'ADMIN'],
  pathId?: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, organizationId: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!requiredRoles.includes(user.role)) {
    throw new Error('Insufficient permissions');
  }

  // If checking for a specific path, ensure user has access
  if (pathId) {
    const path = await prisma.learningPath.findUnique({
      where: { id: pathId },
      select: { createdBy: true, organizationId: true },
    });

    if (!path) {
      throw new Error('Learning path not found');
    }

    // User can access if they created it or it's in their organization
    if (path.createdBy !== userId && path.organizationId !== user.organizationId) {
      if (user.role !== 'ADMIN') {
        throw new Error('Access denied');
      }
    }
  }

  return user;
}

/**
 * GET /api/learning-paths/templates
 * Get learning path templates
 */
export async function getTemplates(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateCategory = searchParams.get('category');

    const options = {
      isTemplate: true,
      ...(templateCategory && { templateCategory }),
      status: 'PUBLISHED',
    };

    const result = await pathService.getLearningPaths(options);

    return NextResponse.json({
      success: true,
      data: result.paths,
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/learning-paths/featured
 * Get featured learning paths
 */
export async function getFeatured(request: NextRequest) {
  try {
    const session = await getServerSession();

    const options = {
      isFeatured: true,
      status: 'PUBLISHED',
      limit: 12,
      organizationId: session?.user?.organizationId,
    };

    const result = await pathService.getLearningPaths(options);

    return NextResponse.json({
      success: true,
      data: result.paths,
    });
  } catch (error) {
    console.error('Error fetching featured paths:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch featured paths' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/learning-paths/recommendations
 * Get personalized learning path recommendations
 */
export async function getRecommendations(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // This would use a more sophisticated recommendation algorithm
    // For now, we'll return popular paths in user's skill areas
    const userSkills = await prisma.userSkill.findMany({
      where: { userId: session.user.id },
      select: { skill: { select: { name: true } } },
    });

    const skillNames = userSkills.map(us => us.skill.name);

    const options = {
      skills: skillNames,
      status: 'PUBLISHED',
      limit: 10,
      organizationId: session.user.organizationId,
    };

    const result = await pathService.getLearningPaths(options);

    return NextResponse.json({
      success: true,
      data: result.paths,
    });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch recommendations' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/learning-paths/analytics/organization
 * Get organization-wide learning path analytics
 */
export async function getOrganizationAnalytics(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if user has admin permissions
    const user = await checkPermissions(session.user.id, ['ADMIN']);

    if (!user.organizationId) {
      return NextResponse.json(
        { success: false, error: 'Organization required' },
        { status: 400 }
      );
    }

    const analytics = await progressTracker.getOrganizationLearningAnalytics(
      user.organizationId
    );

    return NextResponse.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('Error fetching organization analytics:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch analytics',
      },
      { status: 500 }
    );
  }
}

/**
 * Helper to validate path access
 */
export async function validatePathAccess(pathId: string, userId: string) {
  const path = await prisma.learningPath.findUnique({
    where: { id: pathId },
    include: {
      dependencies: {
        include: {
          prerequisitePath: {
            select: { id: true, title: true },
          },
        },
      },
    },
  });

  if (!path) {
    throw new Error('Learning path not found');
  }

  // Check if path is accessible
  if (!path.isPublic) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, role: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check if user has access to private path
    if (path.organizationId !== user.organizationId && user.role !== 'ADMIN') {
      throw new Error('Access denied to private learning path');
    }
  }

  return path;
}