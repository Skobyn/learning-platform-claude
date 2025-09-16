import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import LearningPathService from '@/services/learningPaths/pathService';

const prisma = new PrismaClient();
const pathService = new LearningPathService(prisma);

const AddItemSchema = z.object({
  itemType: z.enum(['COURSE', 'MODULE', 'LEARNING_PATH', 'ASSESSMENT', 'RESOURCE']),
  itemId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  orderIndex: z.number().int().min(0),
  section: z.string().optional(),
  isRequired: z.boolean().optional().default(true),
  prerequisites: z.array(z.string()).optional().default([]),
  estimatedDuration: z.number().int().min(0).optional().default(0),
  unlockDelay: z.number().int().min(0).optional().default(0),
  metadata: z.record(z.unknown()).optional().default({}),
});

const ReorderSchema = z.object({
  itemIds: z.array(z.string().min(1)),
});

/**
 * POST /api/learning-paths/[pathId]/items
 * Add an item to a learning path
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
    const validatedData = AddItemSchema.parse(body);

    const pathItem = await pathService.addPathItem(
      pathId,
      validatedData,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      data: pathItem,
      message: 'Item added to learning path successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding path item:', error);

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
        error: error instanceof Error ? error.message : 'Failed to add item to path',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/learning-paths/[pathId]/items/reorder
 * Reorder items in a learning path
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
    const { itemIds } = ReorderSchema.parse(body);

    await pathService.reorderPathItems(pathId, itemIds, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Items reordered successfully',
    });
  } catch (error) {
    console.error('Error reordering path items:', error);

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
        error: error instanceof Error ? error.message : 'Failed to reorder items',
      },
      { status: 500 }
    );
  }
}