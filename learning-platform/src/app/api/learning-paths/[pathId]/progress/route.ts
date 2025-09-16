import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import ProgressTracker from '@/services/learningPaths/progressTracker';

const prisma = new PrismaClient();
const progressTracker = new ProgressTracker(prisma);

const ProgressUpdateSchema = z.object({
  itemId: z.string().min(1),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  score: z.number().min(0).max(100).optional(),
  timeSpent: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * GET /api/learning-paths/[pathId]/progress
 * Get detailed progress report for user's enrollment
 */
export async function GET(
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

    // Get user's enrollment
    const enrollment = await prisma.learningPathEnrollment.findUnique({
      where: {
        userId_learningPathId: {
          userId: session.user.id,
          learningPathId: pathId,
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json(
        { success: false, error: 'Not enrolled in this learning path' },
        { status: 404 }
      );
    }

    const progressReport = await progressTracker.getDetailedProgressReport(
      enrollment.id,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      data: progressReport,
    });
  } catch (error) {
    console.error('Error fetching progress report:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch progress report',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/learning-paths/[pathId]/progress
 * Update progress for a specific item in the learning path
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
    const { itemId, ...progressData } = ProgressUpdateSchema.parse(body);

    // Get user's enrollment
    const enrollment = await prisma.learningPathEnrollment.findUnique({
      where: {
        userId_learningPathId: {
          userId: session.user.id,
          learningPathId: pathId,
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json(
        { success: false, error: 'Not enrolled in this learning path' },
        { status: 404 }
      );
    }

    await progressTracker.updateItemProgress(
      enrollment.id,
      itemId,
      progressData,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      message: 'Progress updated successfully',
    });
  } catch (error) {
    console.error('Error updating progress:', error);

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
        error: error instanceof Error ? error.message : 'Failed to update progress',
      },
      { status: 500 }
    );
  }
}