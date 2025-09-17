import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { z } from 'zod';
import crypto from 'crypto';
import { parseFilter } from 'scim2-parse-filter';

interface SCIMUser {
  id: string;
  externalId?: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
    formatted?: string;
  };
  emails: Array<{
    value: string;
    type?: string;
    primary?: boolean;
  }>;
  active: boolean;
  groups?: Array<{
    value: string;
    $ref?: string;
    display?: string;
  }>;
  roles?: Array<{
    value: string;
    display?: string;
    type?: string;
  }>;
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
    location: string;
    version?: string;
  };
  schemas: string[];
  urn?: {
    'ietf:params:scim:schemas:extension:enterprise:2.0:User'?: {
      employeeNumber?: string;
      costCenter?: string;
      organization?: string;
      division?: string;
      department?: string;
      manager?: {
        value: string;
        $ref?: string;
        displayName?: string;
      };
    };
  };
}

interface SCIMGroup {
  id: string;
  externalId?: string;
  displayName: string;
  members?: Array<{
    value: string;
    $ref?: string;
    display?: string;
    type?: string;
  }>;
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
    location: string;
    version?: string;
  };
  schemas: string[];
}

interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

interface SCIMError {
  schemas: string[];
  status: string;
  detail: string;
  scimType?: string;
}

interface SCIMPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path?: string;
  value?: any;
}

const scimUserSchema = z.object({
  externalId: z.string().optional(),
  userName: z.string().min(1),
  name: z.object({
    givenName: z.string(),
    familyName: z.string(),
    formatted: z.string().optional(),
  }),
  emails: z.array(z.object({
    value: z.string().email(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  })).min(1),
  active: z.boolean().default(true),
  groups: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
  })).optional(),
  roles: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
});

const scimGroupSchema = z.object({
  externalId: z.string().optional(),
  displayName: z.string().min(1),
  members: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
});

export class SCIMService {
  private readonly baseUrl: string;
  private readonly schemas = {
    user: 'urn:ietf:params:scim:schemas:core:2.0:User',
    group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
    listResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
    patchOp: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
    error: 'urn:ietf:params:scim:api:messages:2.0:Error',
    enterprise: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  };

  constructor() {
    this.baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  // User Management
  async createUser(userData: any, organizationId: string): Promise<SCIMUser> {
    const validated = scimUserSchema.parse(userData);

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: validated.emails[0].value },
          { externalId: validated.externalId },
        ],
      },
    });

    if (existingUser) {
      throw this.createSCIMError('409', 'Conflict', 'User already exists', 'uniqueness');
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email: validated.emails[0].value,
        firstName: validated.name.givenName,
        lastName: validated.name.familyName,
        hashedPassword: '', // SCIM users don't have passwords
        role: this.mapRoleFromSCIM(validated.roles),
        organizationId,
        isActive: validated.active,
        emailVerified: new Date(),
        externalId: validated.externalId,
        scimMetadata: {
          userName: validated.userName,
          externalId: validated.externalId,
          lastSync: new Date(),
          source: 'scim',
        },
      },
    });

    // Handle group memberships
    if (validated.groups) {
      await this.updateUserGroups(user.id, validated.groups.map(g => g.value));
    }

    await this.createAuditLog(user.id, 'SCIM_USER_CREATED', {
      userName: validated.userName,
      organizationId,
      externalId: validated.externalId,
    });

    return this.mapUserToSCIM(user);
  }

  async getUser(userId: string): Promise<SCIMUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        userGroups: {
          include: {
            group: true,
          },
        },
      },
    });

    if (!user) {
      throw this.createSCIMError('404', 'Not Found', 'User not found');
    }

    return this.mapUserToSCIM(user);
  }

  async updateUser(userId: string, userData: any): Promise<SCIMUser> {
    const validated = scimUserSchema.partial().parse(userData);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw this.createSCIMError('404', 'Not Found', 'User not found');
    }

    const updateData: any = {};

    if (validated.name) {
      if (validated.name.givenName) updateData.firstName = validated.name.givenName;
      if (validated.name.familyName) updateData.lastName = validated.name.familyName;
    }

    if (validated.emails && validated.emails.length > 0) {
      updateData.email = validated.emails[0].value;
    }

    if (validated.active !== undefined) {
      updateData.isActive = validated.active;
    }

    if (validated.roles) {
      updateData.role = this.mapRoleFromSCIM(validated.roles);
    }

    // Update SCIM metadata
    updateData.scimMetadata = {
      ...existingUser.scimMetadata,
      lastSync: new Date(),
      userName: validated.userName || existingUser.scimMetadata?.userName,
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        organization: true,
        userGroups: {
          include: {
            group: true,
          },
        },
      },
    });

    // Handle group updates
    if (validated.groups) {
      await this.updateUserGroups(userId, validated.groups.map(g => g.value));
    }

    await this.createAuditLog(userId, 'SCIM_USER_UPDATED', {
      changes: Object.keys(updateData),
      userName: validated.userName,
    });

    return this.mapUserToSCIM(updatedUser);
  }

  async patchUser(userId: string, operations: SCIMPatchOperation[]): Promise<SCIMUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw this.createSCIMError('404', 'Not Found', 'User not found');
    }

    const updateData: any = {};

    for (const op of operations) {
      switch (op.op) {
        case 'replace':
          await this.handlePatchReplace(op, updateData);
          break;
        case 'add':
          await this.handlePatchAdd(op, updateData, userId);
          break;
        case 'remove':
          await this.handlePatchRemove(op, updateData, userId);
          break;
      }
    }

    if (Object.keys(updateData).length > 0) {
      updateData.scimMetadata = {
        ...user.scimMetadata,
        lastSync: new Date(),
      };

      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    await this.createAuditLog(userId, 'SCIM_USER_PATCHED', {
      operations: operations.map(op => ({ op: op.op, path: op.path })),
    });

    return this.getUser(userId);
  }

  async deleteUser(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw this.createSCIMError('404', 'Not Found', 'User not found');
    }

    // Soft delete by setting isActive to false
    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        scimMetadata: {
          ...user.scimMetadata,
          deleted: true,
          deletedAt: new Date(),
        },
      },
    });

    await this.createAuditLog(userId, 'SCIM_USER_DELETED', {
      userName: user.scimMetadata?.userName,
    });
  }

  async listUsers(
    filter?: string,
    startIndex: number = 1,
    count: number = 20,
    organizationId?: string
  ): Promise<SCIMListResponse<SCIMUser>> {
    let whereClause: any = {};

    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    // Parse SCIM filter
    if (filter) {
      const parsedFilter = this.parseSCIMFilter(filter);
      whereClause = { ...whereClause, ...parsedFilter };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        skip: startIndex - 1,
        take: count,
        include: {
          organization: true,
          userGroups: {
            include: {
              group: true,
            },
          },
        },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    const scimUsers = users.map(user => this.mapUserToSCIM(user));

    return {
      schemas: [this.schemas.listResponse],
      totalResults: total,
      startIndex,
      itemsPerPage: scimUsers.length,
      Resources: scimUsers,
    };
  }

  // Group Management
  async createGroup(groupData: any, organizationId: string): Promise<SCIMGroup> {
    const validated = scimGroupSchema.parse(groupData);

    // Check if group already exists
    const existingGroup = await prisma.group.findFirst({
      where: {
        OR: [
          { name: validated.displayName },
          { externalId: validated.externalId },
        ],
        organizationId,
      },
    });

    if (existingGroup) {
      throw this.createSCIMError('409', 'Conflict', 'Group already exists', 'uniqueness');
    }

    const group = await prisma.group.create({
      data: {
        name: validated.displayName,
        description: `SCIM managed group: ${validated.displayName}`,
        organizationId,
        externalId: validated.externalId,
        scimMetadata: {
          displayName: validated.displayName,
          externalId: validated.externalId,
          lastSync: new Date(),
          source: 'scim',
        },
      },
    });

    // Handle member assignments
    if (validated.members) {
      await this.updateGroupMembers(group.id, validated.members.map(m => m.value));
    }

    await this.createAuditLog('system', 'SCIM_GROUP_CREATED', {
      groupId: group.id,
      displayName: validated.displayName,
      organizationId,
      externalId: validated.externalId,
    });

    return this.mapGroupToSCIM(group);
  }

  async getGroup(groupId: string): Promise<SCIMGroup> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!group) {
      throw this.createSCIMError('404', 'Not Found', 'Group not found');
    }

    return this.mapGroupToSCIM(group);
  }

  async listGroups(
    filter?: string,
    startIndex: number = 1,
    count: number = 20,
    organizationId?: string
  ): Promise<SCIMListResponse<SCIMGroup>> {
    let whereClause: any = {};

    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    if (filter) {
      const parsedFilter = this.parseSCIMGroupFilter(filter);
      whereClause = { ...whereClause, ...parsedFilter };
    }

    const [groups, total] = await Promise.all([
      prisma.group.findMany({
        where: whereClause,
        skip: startIndex - 1,
        take: count,
        include: {
          members: {
            include: {
              user: true,
            },
          },
        },
      }),
      prisma.group.count({ where: whereClause }),
    ]);

    const scimGroups = groups.map(group => this.mapGroupToSCIM(group));

    return {
      schemas: [this.schemas.listResponse],
      totalResults: total,
      startIndex,
      itemsPerPage: scimGroups.length,
      Resources: scimGroups,
    };
  }

  // Utility Methods
  private mapUserToSCIM(user: any): SCIMUser {
    return {
      id: user.id,
      externalId: user.externalId,
      userName: user.scimMetadata?.userName || user.email,
      name: {
        givenName: user.firstName,
        familyName: user.lastName,
        formatted: `${user.firstName} ${user.lastName}`,
      },
      emails: [
        {
          value: user.email,
          type: 'work',
          primary: true,
        },
      ],
      active: user.isActive,
      groups: user.userGroups?.map((ug: any) => ({
        value: ug.group.id,
        $ref: `${this.baseUrl}/api/scim/v2/Groups/${ug.group.id}`,
        display: ug.group.name,
      })) || [],
      roles: [
        {
          value: user.role,
          display: this.formatRoleDisplay(user.role),
          type: 'direct',
        },
      ],
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        location: `${this.baseUrl}/api/scim/v2/Users/${user.id}`,
        version: `W/"${this.generateETag(user)}"`,
      },
      schemas: [this.schemas.user],
      urn: {
        [this.schemas.enterprise]: {
          organization: user.organization?.name,
          department: user.scimMetadata?.department,
          employeeNumber: user.scimMetadata?.employeeNumber,
        },
      },
    };
  }

  private mapGroupToSCIM(group: any): SCIMGroup {
    return {
      id: group.id,
      externalId: group.externalId,
      displayName: group.name,
      members: group.members?.map((member: any) => ({
        value: member.user.id,
        $ref: `${this.baseUrl}/api/scim/v2/Users/${member.user.id}`,
        display: `${member.user.firstName} ${member.user.lastName}`,
        type: 'User',
      })) || [],
      meta: {
        resourceType: 'Group',
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
        location: `${this.baseUrl}/api/scim/v2/Groups/${group.id}`,
        version: `W/"${this.generateETag(group)}"`,
      },
      schemas: [this.schemas.group],
    };
  }

  private parseSCIMFilter(filter: string): any {
    try {
      // Use scim2-parse-filter library to parse SCIM filter expressions
      const parsed = parseFilter(filter);
      return this.convertFilterToSQL(parsed);
    } catch (error) {
      throw this.createSCIMError('400', 'Bad Request', `Invalid filter: ${filter}`);
    }
  }

  private convertFilterToSQL(filterAST: any): any {
    // Convert parsed SCIM filter to Prisma where clause
    const where: any = {};

    if (filterAST.type === 'eq') {
      switch (filterAST.attribute) {
        case 'userName':
          where.scimMetadata = {
            path: ['userName'],
            equals: filterAST.value,
          };
          break;
        case 'emails.value':
          where.email = filterAST.value;
          break;
        case 'active':
          where.isActive = filterAST.value === 'true';
          break;
        case 'externalId':
          where.externalId = filterAST.value;
          break;
      }
    } else if (filterAST.type === 'sw') {
      // Starts with
      switch (filterAST.attribute) {
        case 'userName':
          where.scimMetadata = {
            path: ['userName'],
            string_starts_with: filterAST.value,
          };
          break;
        case 'emails.value':
          where.email = {
            startsWith: filterAST.value,
          };
          break;
      }
    }

    return where;
  }

  private parseSCIMGroupFilter(filter: string): any {
    try {
      const parsed = parseFilter(filter);
      return this.convertGroupFilterToSQL(parsed);
    } catch (error) {
      throw this.createSCIMError('400', 'Bad Request', `Invalid filter: ${filter}`);
    }
  }

  private convertGroupFilterToSQL(filterAST: any): any {
    const where: any = {};

    if (filterAST.type === 'eq') {
      switch (filterAST.attribute) {
        case 'displayName':
          where.name = filterAST.value;
          break;
        case 'externalId':
          where.externalId = filterAST.value;
          break;
      }
    }

    return where;
  }

  private mapRoleFromSCIM(roles?: Array<{ value: string; display?: string; type?: string }>): string {
    if (!roles || roles.length === 0) return 'LEARNER';

    const role = roles[0].value.toUpperCase();
    return ['ADMIN', 'INSTRUCTOR', 'LEARNER'].includes(role) ? role : 'LEARNER';
  }

  private formatRoleDisplay(role: string): string {
    const roleMap: Record<string, string> = {
      'ADMIN': 'Administrator',
      'INSTRUCTOR': 'Instructor',
      'LEARNER': 'Learner',
    };
    return roleMap[role] || role;
  }

  private async updateUserGroups(userId: string, groupIds: string[]): Promise<void> {
    // Remove existing group memberships
    await prisma.userGroup.deleteMany({
      where: { userId },
    });

    // Add new group memberships
    if (groupIds.length > 0) {
      const memberships = groupIds.map(groupId => ({
        userId,
        groupId,
      }));

      await prisma.userGroup.createMany({
        data: memberships,
        skipDuplicates: true,
      });
    }
  }

  private async updateGroupMembers(groupId: string, userIds: string[]): Promise<void> {
    // Remove existing members
    await prisma.userGroup.deleteMany({
      where: { groupId },
    });

    // Add new members
    if (userIds.length > 0) {
      const memberships = userIds.map(userId => ({
        userId,
        groupId,
      }));

      await prisma.userGroup.createMany({
        data: memberships,
        skipDuplicates: true,
      });
    }
  }

  private async handlePatchReplace(op: SCIMPatchOperation, updateData: any): Promise<void> {
    if (!op.path) return;

    switch (op.path) {
      case 'active':
        updateData.isActive = op.value;
        break;
      case 'name.givenName':
        updateData.firstName = op.value;
        break;
      case 'name.familyName':
        updateData.lastName = op.value;
        break;
      case 'emails[0].value':
        updateData.email = op.value;
        break;
    }
  }

  private async handlePatchAdd(op: SCIMPatchOperation, updateData: any, userId: string): Promise<void> {
    if (op.path === 'groups') {
      const groupIds = Array.isArray(op.value) ? op.value.map(g => g.value) : [op.value.value];
      await this.updateUserGroups(userId, groupIds);
    }
  }

  private async handlePatchRemove(op: SCIMPatchOperation, updateData: any, userId: string): Promise<void> {
    if (op.path === 'groups') {
      await this.updateUserGroups(userId, []);
    } else if (op.path === 'active') {
      updateData.isActive = false;
    }
  }

  private generateETag(resource: any): string {
    const data = JSON.stringify({
      id: resource.id,
      updatedAt: resource.updatedAt,
    });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private createSCIMError(status: string, title: string, detail: string, scimType?: string): Error {
    const error = new Error(detail) as any;
    error.scimError = {
      schemas: [this.schemas.error],
      status,
      detail,
      scimType,
    };
    error.status = parseInt(status);
    return error;
  }

  private async createAuditLog(userId: string, action: string, details: any): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          resource: 'scim',
          details,
          timestamp: new Date(),
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'scim-client',
        },
      });
    } catch (error) {
      console.error('Failed to create SCIM audit log:', error);
    }
  }

  // Resource Type and Service Provider Config
  getResourceTypes(): any[] {
    return [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'User Account',
        schema: this.schemas.user,
        schemaExtensions: [
          {
            schema: this.schemas.enterprise,
            required: false,
          },
        ],
        meta: {
          location: `${this.baseUrl}/api/scim/v2/ResourceTypes/User`,
          resourceType: 'ResourceType',
        },
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        description: 'Group',
        schema: this.schemas.group,
        meta: {
          location: `${this.baseUrl}/api/scim/v2/ResourceTypes/Group`,
          resourceType: 'ResourceType',
        },
      },
    ];
  }

  getServiceProviderConfig(): any {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: `${this.baseUrl}/docs/scim`,
      patch: {
        supported: true,
      },
      bulk: {
        supported: false,
        maxOperations: 0,
        maxPayloadSize: 0,
      },
      filter: {
        supported: true,
        maxResults: 200,
      },
      changePassword: {
        supported: false,
      },
      sort: {
        supported: false,
      },
      etag: {
        supported: true,
      },
      authenticationSchemes: [
        {
          type: 'httpbasic',
          name: 'HTTP Basic',
          description: 'Authentication scheme using the HTTP Basic Standard',
          specUri: 'http://www.rfc-editor.org/info/rfc2617',
          documentationUri: `${this.baseUrl}/docs/scim/auth`,
        },
        {
          type: 'oauth2',
          name: 'OAuth Bearer Token',
          description: 'Authentication scheme using the OAuth Bearer Token Standard',
          specUri: 'http://www.rfc-editor.org/info/rfc6750',
          documentationUri: `${this.baseUrl}/docs/scim/auth`,
        },
      ],
      meta: {
        location: `${this.baseUrl}/api/scim/v2/ServiceProviderConfig`,
        resourceType: 'ServiceProviderConfig',
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
    };
  }

  getSchemas(): any[] {
    return [
      {
        id: this.schemas.user,
        name: 'User',
        description: 'User Account',
        attributes: [
          {
            name: 'userName',
            type: 'string',
            multiValued: false,
            description: 'Unique identifier for the User',
            required: true,
            caseExact: false,
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'server',
          },
          {
            name: 'name',
            type: 'complex',
            multiValued: false,
            description: 'The components of the user\'s real name',
            required: false,
            subAttributes: [
              {
                name: 'givenName',
                type: 'string',
                multiValued: false,
                description: 'The given name of the User',
                required: false,
                caseExact: false,
                mutability: 'readWrite',
                returned: 'default',
                uniqueness: 'none',
              },
              {
                name: 'familyName',
                type: 'string',
                multiValued: false,
                description: 'The family name of the User',
                required: false,
                caseExact: false,
                mutability: 'readWrite',
                returned: 'default',
                uniqueness: 'none',
              },
            ],
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'none',
          },
          {
            name: 'emails',
            type: 'complex',
            multiValued: true,
            description: 'Email addresses for the user',
            required: false,
            subAttributes: [
              {
                name: 'value',
                type: 'string',
                multiValued: false,
                description: 'Email addresses for the user',
                required: false,
                caseExact: false,
                mutability: 'readWrite',
                returned: 'default',
                uniqueness: 'none',
              },
              {
                name: 'type',
                type: 'string',
                multiValued: false,
                description: 'A label indicating the attribute\'s function',
                required: false,
                caseExact: false,
                canonicalValues: ['work', 'home', 'other'],
                mutability: 'readWrite',
                returned: 'default',
                uniqueness: 'none',
              },
              {
                name: 'primary',
                type: 'boolean',
                multiValued: false,
                description: 'A Boolean value indicating the \'primary\' or preferred attribute value',
                required: false,
                mutability: 'readWrite',
                returned: 'default',
                uniqueness: 'none',
              },
            ],
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'none',
          },
          {
            name: 'active',
            type: 'boolean',
            multiValued: false,
            description: 'A Boolean value indicating the User\'s administrative status',
            required: false,
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'none',
          },
        ],
        meta: {
          resourceType: 'Schema',
          location: `${this.baseUrl}/api/scim/v2/Schemas/${this.schemas.user}`,
        },
      },
      {
        id: this.schemas.group,
        name: 'Group',
        description: 'Group',
        attributes: [
          {
            name: 'displayName',
            type: 'string',
            multiValued: false,
            description: 'A human-readable name for the Group',
            required: true,
            caseExact: false,
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'none',
          },
          {
            name: 'members',
            type: 'complex',
            multiValued: true,
            description: 'A list of members of the Group',
            required: false,
            subAttributes: [
              {
                name: 'value',
                type: 'string',
                multiValued: false,
                description: 'Identifier of the member of this Group',
                required: false,
                caseExact: false,
                mutability: 'immutable',
                returned: 'default',
                uniqueness: 'none',
              },
              {
                name: '$ref',
                type: 'reference',
                referenceTypes: ['User', 'Group'],
                multiValued: false,
                description: 'The URI of the corresponding resource',
                required: false,
                caseExact: true,
                mutability: 'immutable',
                returned: 'default',
                uniqueness: 'none',
              },
              {
                name: 'type',
                type: 'string',
                multiValued: false,
                description: 'A label indicating the type of resource',
                required: false,
                caseExact: false,
                canonicalValues: ['User', 'Group'],
                mutability: 'immutable',
                returned: 'default',
                uniqueness: 'none',
              },
            ],
            mutability: 'readWrite',
            returned: 'default',
            uniqueness: 'none',
          },
        ],
        meta: {
          resourceType: 'Schema',
          location: `${this.baseUrl}/api/scim/v2/Schemas/${this.schemas.group}`,
        },
      },
    ];
  }
}

export const scimService = new SCIMService();
export default scimService;