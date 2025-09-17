import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import LearningPathService from '@/services/learningPaths/pathService';

const prisma = new PrismaClient();
const pathService = new LearningPathService(prisma);

const UpdateItemSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  section: z.string().optional(),
  isRequired: z.boolean().optional(),
  prerequisites: z.array(z.string()).optional(),
  estimatedDuration: z.number().int().min(0).optional(),
  unlockDelay: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * PUT /api/learning-paths/[pathId]/items/[itemId]
 * Update a specific item in a learning path
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { pathId: string; itemId: string } }
) {
  try {
    const session = await getServerSession();
    const { pathId, itemId } = params;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!pathId || !itemId) {
      return NextResponse.json(
        { success: false, error: 'Path ID and Item ID are required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = UpdateItemSchema.parse(body);

    const updatedItem = await pathService.updatePathItem(
      itemId,
      validatedData,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      data: updatedItem,
      message: 'Path item updated successfully',
    });
  } catch (error) {
    console.error('Error updating path item:', error);

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
        error: error instanceof Error ? error.message : 'Failed to update path item',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/learning-paths/[pathId]/items/[itemId]
 * Remove an item from a learning path
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { pathId: string; itemId: string } }
) {
  try {
    const session = await getServerSession();
    const { pathId, itemId } = params;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!pathId || !itemId) {
      return NextResponse.json(
        { success: false, error: 'Path ID and Item ID are required' },
        { status: 400 }
      );
    }

    await pathService.removePathItem(itemId, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Item removed from learning path successfully',
    });
  } catch (error) {
    console.error('Error removing path item:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove path item',
      },
      { status: 500 }
    );
  }
}