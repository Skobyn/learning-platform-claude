import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import LearningPathService from '@/services/learningPaths/pathService';

const prisma = new PrismaClient();
const pathService = new LearningPathService(prisma);

const EnrollmentSchema = z.object({
  autoEnrollCourses: z.boolean().optional().default(true),
});

/**
 * POST /api/learning-paths/[pathId]/enroll
 * Enroll user in a learning path
 */
export async function POST(
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
    const { autoEnrollCourses } = EnrollmentSchema.parse(body);

    const enrollment = await pathService.enrollUser(
      pathId,
      session.user.id,
      autoEnrollCourses
    );

    return NextResponse.json({
      success: true,
      data: enrollment,
      message: 'Successfully enrolled in learning path',
    }, { status: 201 });
  } catch (error) {
    console.error('Error enrolling in learning path:', error);

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
        error: error instanceof Error ? error.message : 'Failed to enroll in learning path',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/learning-paths/[pathId]/enroll
 * Unenroll user from a learning path
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

    // Update enrollment status to DROPPED
    await prisma.learningPathEnrollment.updateMany({
      where: {
        learningPathId: pathId,
        userId: session.user.id,
        status: { in: ['ACTIVE', 'PAUSED'] },
      },
      data: {
        status: 'DROPPED',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Successfully unenrolled from learning path',
    });
  } catch (error) {
    console.error('Error unenrolling from learning path:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to unenroll from learning path',
      },
      { status: 500 }
    );
  }
}