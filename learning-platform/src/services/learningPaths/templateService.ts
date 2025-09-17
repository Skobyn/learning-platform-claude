import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// Validation schemas
const CreateTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.enum(['ROLE', 'SKILL', 'INDUSTRY', 'CERTIFICATION']),
  templateType: z.string().min(1), // e.g., 'DEVELOPER', 'MANAGER', 'DESIGNER'
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
    fieldValues: z.record(z.string()).optional(), // For variable field substitution
    selectedItems: z.array(z.string()).optional(), // IDs of template items to include
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

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type InstantiateTemplateInput = z.infer<typeof InstantiateTemplateSchema>;

export interface LearningPathTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  templateType: string;
  targetRoles: string[];
  targetDepartments: string[];
  targetSkillLevel?: string;
  industry?: string;
  templateStructure: TemplateStructure;
  variableFields: string[];
  usageCount: number;
  isFeatured: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateStructure {
  sections: TemplateSection[];
  totalEstimatedDuration?: number;
  totalItems?: number;
  difficulty?: string;
  skills?: string[];
  learningObjectives?: string[];
}

export interface TemplateSection {
  title: string;
  description?: string;
  items: TemplateItem[];
  orderIndex: number;
}

export interface TemplateItem {
  type: 'COURSE' | 'MODULE' | 'ASSESSMENT' | 'RESOURCE';
  title: string;
  description?: string;
  skills?: string[];
  estimatedDuration?: number;
  difficulty?: string;
  isRequired?: boolean;
  prerequisites?: string[];
  metadata?: Record<string, unknown>;
}

export interface TemplateInstantiation {
  learningPathId: string;
  templateId: string;
  customizations: Record<string, unknown>;
  instantiatedAt: Date;
  instantiatedBy: string;
}

export class TemplateService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new learning path template
   */
  async createTemplate(
    data: CreateTemplateInput,
    userId: string
  ): Promise<LearningPathTemplate> {
    try {
      const validatedData = CreateTemplateSchema.parse(data);

      const template = await this.prisma.learningPathTemplate.create({
        data: {
          ...validatedData,
          createdBy: userId,
          usageCount: 0,
          isFeatured: validatedData.isFeatured || false,
          isActive: validatedData.isActive !== false,
        },
      });

      return this.formatTemplate(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to create template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all learning path templates with filtering
   */
  async getTemplates(options: {
    category?: string;
    templateType?: string;
    targetRoles?: string[];
    targetSkillLevel?: string;
    industry?: string;
    isFeatured?: boolean;
    isActive?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ templates: LearningPathTemplate[]; total: number; pages: number }> {
    try {
      const {
        category,
        templateType,
        targetRoles,
        targetSkillLevel,
        industry,
        isFeatured,
        isActive = true,
        search,
        page = 1,
        limit = 20,
      } = options;

      const offset = (page - 1) * limit;

      const where: any = {
        isActive,
        ...(category && { category }),
        ...(templateType && { templateType }),
        ...(targetRoles?.length && { targetRoles: { hasSome: targetRoles } }),
        ...(targetSkillLevel && { targetSkillLevel }),
        ...(industry && { industry }),
        ...(isFeatured !== undefined && { isFeatured }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { templateType: { contains: search, mode: 'insensitive' } },
          ],
        }),
      };

      const [templates, total] = await Promise.all([
        this.prisma.learningPathTemplate.findMany({
          where,
          orderBy: [
            { isFeatured: 'desc' },
            { usageCount: 'desc' },
            { createdAt: 'desc' },
          ],
          skip: offset,
          take: limit,
        }),
        this.prisma.learningPathTemplate.count({ where }),
      ]);

      return {
        templates: templates.map(template => this.formatTemplate(template)),
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw new Error(`Failed to get templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific template by ID
   */
  async getTemplate(templateId: string): Promise<LearningPathTemplate | null> {
    try {
      const template = await this.prisma.learningPathTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return null;
      }

      return this.formatTemplate(template);
    } catch (error) {
      throw new Error(`Failed to get template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get featured templates for quick access
   */
  async getFeaturedTemplates(limit: number = 12): Promise<LearningPathTemplate[]> {
    try {
      const templates = await this.prisma.learningPathTemplate.findMany({
        where: {
          isFeatured: true,
          isActive: true,
        },
        orderBy: { usageCount: 'desc' },
        take: limit,
      });

      return templates.map(template => this.formatTemplate(template));
    } catch (error) {
      throw new Error(`Failed to get featured templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get templates by role
   */
  async getTemplatesByRole(role: string, limit: number = 10): Promise<LearningPathTemplate[]> {
    try {
      const templates = await this.prisma.learningPathTemplate.findMany({
        where: {
          isActive: true,
          targetRoles: { has: role },
        },
        orderBy: { usageCount: 'desc' },
        take: limit,
      });

      return templates.map(template => this.formatTemplate(template));
    } catch (error) {
      throw new Error(`Failed to get templates by role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Instantiate a template into a learning path
   */
  async instantiateTemplate(
    data: InstantiateTemplateInput,
    userId: string,
    organizationId?: string
  ): Promise<string> {
    try {
      const validatedData = InstantiateTemplateSchema.parse(data);
      const { templateId, customizations } = validatedData;

      const template = await this.prisma.learningPathTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        throw new Error('Template not found');
      }

      const learningPathId = await this.prisma.$transaction(async (tx) => {
        // Create the learning path from template
        const learningPath = await tx.learningPath.create({
          data: {
            title: customizations?.title || this.processTemplateText(template.title, customizations?.fieldValues),
            description: customizations?.description || this.processTemplateText(template.description, customizations?.fieldValues),
            category: customizations?.category || this.inferCategoryFromTemplate(template),
            difficulty: customizations?.difficulty || template.templateStructure.difficulty || 'INTERMEDIATE',
            tags: customizations?.tags || [],
            skills: customizations?.skills || template.templateStructure.skills || [],
            learningObjectives: template.templateStructure.learningObjectives || [],
            isPublic: validatedData.isPublic !== false,
            isFeatured: validatedData.isFeatured || false,
            isTemplate: false,
            status: 'DRAFT',
            createdBy: userId,
            organizationId,
          },
        });

        // Create learning path items from template structure
        await this.createItemsFromTemplate(
          tx,
          learningPath.id,
          template.templateStructure,
          customizations
        );

        // Update template usage count
        await tx.learningPathTemplate.update({
          where: { id: templateId },
          data: { usageCount: { increment: 1 } },
        });

        return learningPath.id;
      });

      return learningPathId;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw new Error(`Failed to instantiate template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create learning path items from template structure
   */
  private async createItemsFromTemplate(
    tx: any,
    learningPathId: string,
    templateStructure: any,
    customizations?: any
  ): Promise<void> {
    let orderIndex = 0;

    for (const section of templateStructure.sections) {
      const selectedItems = customizations?.selectedItems;

      for (const templateItem of section.items) {
        // Skip items that weren't selected (if selection was specified)
        if (selectedItems && !selectedItems.includes(`${section.title}-${templateItem.title}`)) {
          continue;
        }

        // Create learning path item
        await tx.learningPathItem.create({
          data: {
            learningPathId,
            itemType: templateItem.type,
            itemId: this.generateMockItemId(templateItem), // In real implementation, would map to actual courses
            title: this.processTemplateText(templateItem.title, customizations?.fieldValues),
            description: templateItem.description ? this.processTemplateText(templateItem.description, customizations?.fieldValues) : undefined,
            orderIndex,
            section: section.title,
            isRequired: templateItem.isRequired !== false,
            prerequisites: templateItem.prerequisites || [],
            estimatedDuration: templateItem.estimatedDuration || 60, // Default 1 hour
            unlockDelay: 0,
            metadata: {
              templateGenerated: true,
              templateId: templateStructure.id,
              originalTemplateItem: templateItem,
              ...templateItem.metadata,
            },
          },
        });

        orderIndex++;
      }
    }

    // Add any custom items specified
    if (customizations?.customItems) {
      for (const customItem of customizations.customItems) {
        await tx.learningPathItem.create({
          data: {
            learningPathId,
            itemType: customItem.type,
            itemId: customItem.itemId,
            title: customItem.title,
            description: customItem.description,
            orderIndex: customItem.orderIndex + orderIndex,
            section: customItem.section || 'Additional Content',
            isRequired: true,
            prerequisites: [],
            estimatedDuration: 60,
            unlockDelay: 0,
            metadata: { customAdded: true },
          },
        });
      }
    }
  }

  /**
   * Generate common role-based templates
   */
  async generateBuiltinTemplates(userId: string): Promise<string[]> {
    const templates = [
      {
        title: 'Software Engineer Career Path',
        description: 'Comprehensive learning path for aspiring software engineers',
        category: 'ROLE' as const,
        templateType: 'SOFTWARE_ENGINEER',
        targetRoles: ['Software Engineer', 'Developer', 'Programmer'],
        targetSkillLevel: 'BEGINNER' as const,
        templateStructure: {
          sections: [
            {
              title: 'Programming Fundamentals',
              description: 'Core programming concepts and practices',
              orderIndex: 0,
              items: [
                {
                  type: 'COURSE' as const,
                  title: 'Introduction to Programming with {{language}}',
                  description: 'Learn the basics of programming',
                  skills: ['Programming', '{{language}}'],
                  estimatedDuration: 2400, // 40 hours
                  difficulty: 'BEGINNER' as const,
                  isRequired: true,
                },
                {
                  type: 'COURSE' as const,
                  title: 'Data Structures and Algorithms',
                  description: 'Essential data structures and algorithms',
                  skills: ['Data Structures', 'Algorithms'],
                  estimatedDuration: 3600, // 60 hours
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                  prerequisites: ['Introduction to Programming with {{language}}'],
                },
              ],
            },
            {
              title: 'Web Development',
              description: 'Modern web development technologies',
              orderIndex: 1,
              items: [
                {
                  type: 'COURSE' as const,
                  title: 'Frontend Development with {{frontend_framework}}',
                  description: 'Build interactive user interfaces',
                  skills: ['Frontend Development', '{{frontend_framework}}', 'HTML', 'CSS'],
                  estimatedDuration: 2400,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
                {
                  type: 'COURSE' as const,
                  title: 'Backend Development with {{backend_framework}}',
                  description: 'Build robust server-side applications',
                  skills: ['Backend Development', '{{backend_framework}}', 'API Design'],
                  estimatedDuration: 2400,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
              ],
            },
            {
              title: 'Advanced Topics',
              description: 'Advanced software engineering concepts',
              orderIndex: 2,
              items: [
                {
                  type: 'COURSE' as const,
                  title: 'System Design and Architecture',
                  description: 'Design scalable software systems',
                  skills: ['System Design', 'Architecture', 'Scalability'],
                  estimatedDuration: 1800,
                  difficulty: 'ADVANCED' as const,
                  isRequired: false,
                },
                {
                  type: 'ASSESSMENT' as const,
                  title: 'Capstone Project',
                  description: 'Build a complete software application',
                  skills: ['Project Management', 'Full Stack Development'],
                  estimatedDuration: 4800, // 80 hours
                  difficulty: 'ADVANCED' as const,
                  isRequired: true,
                  prerequisites: ['Frontend Development with {{frontend_framework}}', 'Backend Development with {{backend_framework}}'],
                },
              ],
            },
          ],
          totalEstimatedDuration: 17000, // ~283 hours
          totalItems: 6,
          difficulty: 'INTERMEDIATE' as const,
          skills: ['Programming', 'Web Development', 'Problem Solving'],
          learningObjectives: [
            'Master fundamental programming concepts',
            'Build full-stack web applications',
            'Understand system design principles',
            'Complete a real-world software project',
          ],
        },
        variableFields: ['language', 'frontend_framework', 'backend_framework'],
      },
      {
        title: 'Product Manager Growth Path',
        description: 'Essential skills for product management excellence',
        category: 'ROLE' as const,
        templateType: 'PRODUCT_MANAGER',
        targetRoles: ['Product Manager', 'Product Owner', 'Product Lead'],
        targetSkillLevel: 'INTERMEDIATE' as const,
        templateStructure: {
          sections: [
            {
              title: 'Product Strategy',
              description: 'Strategic thinking and planning',
              orderIndex: 0,
              items: [
                {
                  type: 'COURSE' as const,
                  title: 'Product Strategy and Vision',
                  description: 'Learn to develop winning product strategies',
                  skills: ['Product Strategy', 'Vision', 'Market Analysis'],
                  estimatedDuration: 1200,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
                {
                  type: 'COURSE' as const,
                  title: 'Customer Research and Validation',
                  description: 'Understand your customers deeply',
                  skills: ['User Research', 'Customer Development', 'Validation'],
                  estimatedDuration: 1800,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
              ],
            },
            {
              title: 'Execution and Analytics',
              description: 'Bringing products to market successfully',
              orderIndex: 1,
              items: [
                {
                  type: 'COURSE' as const,
                  title: 'Product Analytics and Metrics',
                  description: 'Measure what matters for product success',
                  skills: ['Analytics', 'Data Analysis', 'KPIs'],
                  estimatedDuration: 1500,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
                {
                  type: 'COURSE' as const,
                  title: 'Agile Product Management',
                  description: 'Lead agile product development teams',
                  skills: ['Agile', 'Scrum', 'Team Leadership'],
                  estimatedDuration: 1200,
                  difficulty: 'INTERMEDIATE' as const,
                  isRequired: true,
                },
              ],
            },
          ],
          totalEstimatedDuration: 5700,
          totalItems: 4,
          difficulty: 'INTERMEDIATE' as const,
          skills: ['Product Management', 'Strategy', 'Analytics', 'Leadership'],
          learningObjectives: [
            'Develop compelling product strategies',
            'Conduct effective customer research',
            'Use data to drive product decisions',
            'Lead cross-functional product teams',
          ],
        },
        variableFields: ['industry', 'product_type'],
      },
    ];

    const createdTemplateIds = [];

    for (const templateData of templates) {
      try {
        const template = await this.createTemplate(templateData, userId);
        createdTemplateIds.push(template.id);
      } catch (error) {
        console.error(`Failed to create builtin template ${templateData.title}:`, error);
      }
    }

    return createdTemplateIds;
  }

  /**
   * Process template text by replacing variables
   */
  private processTemplateText(text: string, fieldValues?: Record<string, string>): string {
    if (!fieldValues) return text;

    let processedText = text;
    for (const [key, value] of Object.entries(fieldValues)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processedText = processedText.replace(regex, value);
    }

    return processedText;
  }

  /**
   * Infer category from template type
   */
  private inferCategoryFromTemplate(template: any): string {
    const categoryMap: Record<string, string> = {
      SOFTWARE_ENGINEER: 'Programming',
      PRODUCT_MANAGER: 'Product Management',
      DATA_SCIENTIST: 'Data Science',
      DESIGNER: 'Design',
      MARKETING_MANAGER: 'Marketing',
      DEVOPS_ENGINEER: 'DevOps',
    };

    return categoryMap[template.templateType] || 'Technology';
  }

  /**
   * Generate mock item ID for template items
   */
  private generateMockItemId(templateItem: any): string {
    // In a real implementation, this would map template items to actual course IDs
    // For now, generate a deterministic ID based on the item
    const hash = templateItem.title.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `template-item-${hash}`;
  }

  /**
   * Format template for API response
   */
  private formatTemplate(template: any): LearningPathTemplate {
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      templateType: template.templateType,
      targetRoles: template.targetRoles || [],
      targetDepartments: template.targetDepartments || [],
      targetSkillLevel: template.targetSkillLevel,
      industry: template.industry,
      templateStructure: template.templateStructure,
      variableFields: template.variableFields || [],
      usageCount: template.usageCount,
      isFeatured: template.isFeatured,
      isActive: template.isActive,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}

export default TemplateService;