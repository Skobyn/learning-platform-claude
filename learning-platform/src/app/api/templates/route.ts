import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import TemplateService from '@/services/learningPaths/templateService';

const prisma = new PrismaClient();
const templateService = new TemplateService(prisma);

const CreateTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.enum(['ROLE', 'SKILL', 'INDUSTRY', 'CERTIFICATION']),
  templateType: z.string().min(1),
  targetRoles: z.array(z.string()).optional(),
  targetDepartments: z.array(z.string()).optional(),
  targetSkillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  industry: z.string().optional(),
  templateStructure: z.object({
    sections: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      items: z.array(z.object({
        type: z.enum(['COURSE', 'MODULE', 'ASSESSMENT', 'RESOURCE']),
        title: z.string(),
        description: z.string().optional(),
        skills: z.array(z.string()).optional(),
        estimatedDuration: z.number().optional(),
        difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
        isRequired: z.boolean().optional(),
        prerequisites: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      })),
      orderIndex: z.number(),
    })),
    totalEstimatedDuration: z.number().optional(),
    totalItems: z.number().optional(),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
    skills: z.array(z.string()).optional(),
    learningObjectives: z.array(z.string()).optional(),
  }),
  variableFields: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const InstantiateTemplateSchema = z.object({
  templateId: z.string().min(1),
  customizations: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
    tags: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    fieldValues: z.record(z.string()).optional(),
    selectedItems: z.array(z.string()).optional(),
    customItems: z.array(z.object({
      type: z.enum(['COURSE', 'MODULE', 'ASSESSMENT', 'RESOURCE']),
      itemId: z.string(),
      title: z.string(),
      description: z.string().optional(),
      orderIndex: z.number(),
      section: z.string().optional(),
    })).optional(),
  }).optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

const QuerySchema = z.object({
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  category: z.string().optional(),
  templateType: z.string().optional(),
  targetRoles: z.string().optional(), // Comma-separated
  targetSkillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  industry: z.string().optional(),
  isFeatured: z.string().transform(Boolean).optional(),
  isActive: z.string().transform(Boolean).optional(),
  search: z.string().optional(),
});

/**
 * GET /api/templates
 * Get learning path templates with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const queryData = Object.fromEntries(searchParams.entries());
    const {
      page = 1,
      limit = 20,
      category,
      templateType,
      targetRoles,
      targetSkillLevel,
      industry,
      isFeatured,
      isActive = true,
      search,
    } = QuerySchema.parse(queryData);

    // Convert comma-separated strings to arrays
    const targetRolesArray = targetRoles ? targetRoles.split(',').map(r => r.trim()) : undefined;

    const options = {
      page,
      limit,
      category,
      templateType,
      targetRoles: targetRolesArray,
      targetSkillLevel,
      industry,
      isFeatured,
      isActive,
      search,
    };

    const result = await templateService.getTemplates(options);

    return NextResponse.json({
      success: true,
      data: result.templates,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: result.pages,
      },
    });
  } catch (error) {
    console.error('Error fetching templates:', error);

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
        error: 'Failed to fetch templates',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/templates
 * Create a new learning path template
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

    // Check if user has permission to create templates
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (!user || !['INSTRUCTOR', 'ADMIN'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = CreateTemplateSchema.parse(body);

    const template = await templateService.createTemplate(
      validatedData,
      session.user.id
    );

    return NextResponse.json({
      success: true,
      data: template,
      message: 'Template created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating template:', error);

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
        error: error instanceof Error ? error.message : 'Failed to create template',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/templates/instantiate
 * Instantiate a template into a learning path
 */
export async function instantiateTemplate(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true },
    });

    const body = await request.json();
    const validatedData = InstantiateTemplateSchema.parse(body);

    const learningPathId = await templateService.instantiateTemplate(
      validatedData,
      session.user.id,
      user?.organizationId
    );

    return NextResponse.json({
      success: true,
      data: { learningPathId },
      message: 'Template instantiated successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error instantiating template:', error);

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
        error: error instanceof Error ? error.message : 'Failed to instantiate template',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/templates/featured
 * Get featured templates
 */
export async function getFeaturedTemplates(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '12');

    const templates = await templateService.getFeaturedTemplates(limit);

    return NextResponse.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error('Error fetching featured templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch featured templates' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/templates/by-role
 * Get templates by role
 */
export async function getTemplatesByRole(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!role) {
      return NextResponse.json(
        { success: false, error: 'Role parameter is required' },
        { status: 400 }
      );
    }

    const templates = await templateService.getTemplatesByRole(role, limit);

    return NextResponse.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error('Error fetching templates by role:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates by role' },
      { status: 500 }
    );
  }
}