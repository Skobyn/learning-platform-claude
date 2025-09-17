import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import CollectionService from '@/services/learningPaths/collectionService';

const prisma = new PrismaClient();
const collectionService = new CollectionService(prisma);

const CreateCollectionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  shortDescription: z.string().max(500).optional(),
  category: z.string().min(1),
  tags: z.array(z.string()).optional(),
  targetAudience: z.array(z.string()).optional(),
  thumbnailUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  colorTheme: z.string().optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isCurated: z.boolean().optional(),
});

const QuerySchema = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  category: z.string().optional(),
  tags: z.string().optional(), // Comma-separated
  targetAudience: z.string().optional(), // Comma-separated
  status: z.string().optional(),
  isPublic: z.string().transform(Boolean).optional(),
  isFeatured: z.string().transform(Boolean).optional(),
  isCurated: z.string().transform(Boolean).optional(),
  search: z.string().optional(),
});

/**
 * GET /api/collections
 * Get collections with filtering and pagination
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
      tags,
      targetAudience,
      status = 'PUBLISHED',
      isPublic,
      isFeatured,
      isCurated,
      search,
    } = QuerySchema.parse(queryData);

    // Convert comma-separated strings to arrays
    const tagsArray = tags ? tags.split(',').map(t => t.trim()) : undefined;
    const audienceArray = targetAudience ? targetAudience.split(',').map(a => a.trim()) : undefined;

    const options = {
      page,
      limit,
      category,
      tags: tagsArray,
      targetAudience: audienceArray,
      status,
      isPublic,
      isFeatured,
      isCurated,
      search,
      // Only show organization collections if user is authenticated
      organizationId: session?.user?.organizationId,
    };

    const result = await collectionService.getCollections(options);

    return NextResponse.json({
      success: true,
      data: result.collections,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: result.pages,
      },
    });
  } catch (error) {
    console.error('Error fetching collections:', error);

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
        error: 'Failed to fetch collections',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/collections
 * Create a new collection
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

    // Check if user has permission to create collections
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
    const validatedData = CreateCollectionSchema.parse(body);

    const collection = await collectionService.createCollection(
      validatedData,
      session.user.id,
      user.organizationId
    );

    return NextResponse.json({
      success: true,
      data: collection,
      message: 'Collection created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating collection:', error);

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
        error: error instanceof Error ? error.message : 'Failed to create collection',
      },
      { status: 500 }
    );
  }
}