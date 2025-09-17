import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import LearningPathService from '@/services/learningPaths/pathService';
import ProgressTracker from '@/services/learningPaths/progressTracker';

const prisma = new PrismaClient();
const pathService = new LearningPathService(prisma);
const progressTracker = new ProgressTracker(prisma);

const UpdatePathSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  shortDescription: z.string().max(500).optional(),
  category: z.string().min(1).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  tags: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
  learningObjectives: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  templateCategory: z.string().optional(),
});

/**
 * GET /api/learning-paths/[pathId]
 * Get a specific learning path with full details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { pathId: string } }
) {
  try {
    const session = await getServerSession();
    const pathId = params.pathId;

    if (!pathId) {
      return NextResponse.json(
        { success: false, error: 'Path ID is required' },
        { status: 400 }
      );
    }

    const learningPath = await pathService.getLearningPath(pathId, session?.user?.id);

    if (!learningPath) {
      return NextResponse.json(
        { success: false, error: 'Learning path not found' },
        { status: 404 }
      );
    }

    // Check access permissions for private paths
    if (!learningPath.isPublic && session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true, role: true },
      });

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Access denied' },
          { status: 403 }
        );
      }

      // Check if user has access to private path
      if (learningPath.organizationId !== user.organizationId && user.role !== 'ADMIN') {
        return NextResponse.json(
          { success: false, error: 'Access denied to private learning path' },
          { status: 403 }
        );
      }
    } else if (!learningPath.isPublic && !session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required for private content' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: learningPath,
    });
  } catch (error) {
    console.error('Error fetching learning path:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch learning path',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/learning-paths/[pathId]
 * Update a learning path
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { pathId: string } }
) {
  try {
    const session = await getServerSession();
    const pathId = params.pathId;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!pathId) {
      return NextResponse.json(
        { success: false, error: 'Path ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = UpdatePathSchema.parse(body);

    const updatedPath = await pathService.updateLearningPath(
      pathId,
      validatedData,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      data: updatedPath,
      message: 'Learning path updated successfully',
    });
  } catch (error) {
    console.error('Error updating learning path:', error);

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
        error: error instanceof Error ? error.message : 'Failed to update learning path',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/learning-paths/[pathId]
 * Delete (archive) a learning path
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { pathId: string } }
) {
  try {
    const session = await getServerSession();
    const pathId = params.pathId;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!pathId) {
      return NextResponse.json(
        { success: false, error: 'Path ID is required' },
        { status: 400 }
      );
    }

    await pathService.deleteLearningPath(pathId, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Learning path archived successfully',
    });
  } catch (error) {
    console.error('Error deleting learning path:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete learning path',
      },
      { status: 500 }
    );
  }
}