import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import {
  StudyGroup,
  StudyGroupMember,
  StudyGroupSession,
  StudyGroupResource,
  User,
  Course
} from '@prisma/client';

export interface StudyGroupWithDetails extends StudyGroup {
  members: (StudyGroupMember & {
    user: User;
  })[];
  resources: StudyGroupResource[];
  sessions: StudyGroupSession[];
  relatedCourses: Course[];
  _count: {
    members: number;
    sessions: number;
    resources: number;
  };
  userRole?: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  canJoin?: boolean;
}

export interface StudySessionWithDetails extends StudyGroupSession {
  group: StudyGroup;
  attendees: (StudyGroupMember & {
    user: User;
  })[];
  resources: StudyGroupResource[];
  _count: {
    attendees: number;
  };
}

export interface CreateStudyGroupData {
  name: string;
  description: string;
  type: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
  maxMembers: number;
  tags: string[];
  courseIds?: string[];
  meetingSchedule?: {
    frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
    dayOfWeek: number; // 0-6, Sunday = 0
    time: string; // HH:mm format
    timezone: string;
  };
  rules?: string[];
  isVirtual: boolean;
  location?: string;
}

export interface CreateSessionData {
  title: string;
  description: string;
  scheduledFor: Date;
  duration: number; // in minutes
  type: 'STUDY' | 'DISCUSSION' | 'PROJECT' | 'REVIEW';
  isVirtual: boolean;
  location?: string;
  meetingUrl?: string;
  agenda?: string[];
  requiredResources?: string[];
  maxAttendees?: number;
}

export interface StudyGroupStats {
  totalMembers: number;
  activeSessions: number;
  completedSessions: number;
  averageAttendance: number;
  memberEngagement: {
    userId: string;
    user: User;
    sessionsAttended: number;
    resourcesShared: number;
    participationScore: number;
  }[];
  studyStreaks: {
    userId: string;
    currentStreak: number;
    longestStreak: number;
  }[];
}

class StudyGroupService {
  private cachePrefix = 'study_group:';
  private cacheTTL = 1800; // 30 minutes

  /**
   * Create a new study group
   */
  async createStudyGroup(
    creatorId: string,
    data: CreateStudyGroupData
  ): Promise<StudyGroupWithDetails> {
    // Validate courses if provided
    if (data.courseIds?.length) {
      const courses = await prisma.course.findMany({
        where: { id: { in: data.courseIds } }
      });

      if (courses.length !== data.courseIds.length) {
        throw new Error('Some courses not found');
      }
    }

    const studyGroup = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.studyGroup.create({
        data: {
          name: data.name,
          description: data.description,
          type: data.type,
          maxMembers: data.maxMembers,
          tags: data.tags,
          rules: data.rules || [],
          isVirtual: data.isVirtual,
          location: data.location,
          meetingSchedule: data.meetingSchedule || null,
          creatorId,
          status: 'ACTIVE'
        }
      });

      // Add creator as admin
      await tx.studyGroupMember.create({
        data: {
          studyGroupId: newGroup.id,
          userId: creatorId,
          role: 'ADMIN',
          joinedAt: new Date()
        }
      });

      // Link courses if provided
      if (data.courseIds?.length) {
        await Promise.all(
          data.courseIds.map(courseId =>
            tx.studyGroupCourse.create({
              data: {
                studyGroupId: newGroup.id,
                courseId
              }
            })
          )
        );
      }

      // Create activity log
      await tx.userActivity.create({
        data: {
          userId: creatorId,
          type: 'STUDY_GROUP_CREATED',
          entityType: 'STUDY_GROUP',
          entityId: newGroup.id,
          metadata: {
            groupName: data.name,
            type: data.type
          }
        }
      });

      return newGroup;
    });

    await this.clearStudyGroupCaches();

    return this.getStudyGroupById(studyGroup.id, creatorId);
  }

  /**
   * Get study group by ID with all details
   */
  async getStudyGroupById(
    groupId: string,
    userId?: string
  ): Promise<StudyGroupWithDetails | null> {
    const cacheKey = `${this.cachePrefix}${groupId}:${userId || 'anonymous'}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const group = await prisma.studyGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true,
                reputation: true
              }
            }
          },
          orderBy: [
            { role: 'asc' }, // ADMIN first, then MODERATOR, then MEMBER
            { joinedAt: 'asc' }
          ]
        },
        resources: {
          where: { isActive: true },
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                profileImageUrl: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        sessions: {
          where: {
            scheduledFor: { gte: new Date() }
          },
          include: {
            attendees: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    profileImageUrl: true
                  }
                }
              }
            }
          },
          orderBy: { scheduledFor: 'asc' },
          take: 5
        },
        relatedCourses: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                description: true,
                thumbnailUrl: true,
                level: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            sessions: true,
            resources: true
          }
        }
      }
    });

    if (!group) return null;

    let userRole: 'ADMIN' | 'MODERATOR' | 'MEMBER' | undefined;
    let canJoin = false;

    if (userId) {
      const membership = group.members.find(m => m.userId === userId);
      userRole = membership?.role;

      canJoin = !membership &&
                group.status === 'ACTIVE' &&
                group.members.length < group.maxMembers &&
                (group.type === 'PUBLIC' || group.type === 'INVITE_ONLY');
    }

    const result: StudyGroupWithDetails = {
      ...group,
      relatedCourses: group.relatedCourses.map(gc => gc.course),
      userRole,
      canJoin
    };

    // Cache for shorter time due to dynamic content
    await redis.setex(cacheKey, 900, JSON.stringify(result));

    return result;
  }

  /**
   * Join a study group
   */
  async joinStudyGroup(
    groupId: string,
    userId: string,
    inviteCode?: string
  ): Promise<void> {
    const group = await prisma.studyGroup.findUnique({
      where: { id: groupId },
      include: {
        _count: { select: { members: true } }
      }
    });

    if (!group) {
      throw new Error('Study group not found');
    }

    if (group.status !== 'ACTIVE') {
      throw new Error('Study group is not active');
    }

    if (group._count.members >= group.maxMembers) {
      throw new Error('Study group is full');
    }

    // Check membership
    const existingMember = await prisma.studyGroupMember.findUnique({
      where: {
        studyGroupId_userId: {
          studyGroupId: groupId,
          userId
        }
      }
    });

    if (existingMember) {
      throw new Error('Already a member of this study group');
    }

    // Check access based on group type
    if (group.type === 'PRIVATE') {
      throw new Error('This study group is private');
    }

    if (group.type === 'INVITE_ONLY' && !inviteCode) {
      throw new Error('Invite code required for this study group');
    }

    if (inviteCode) {
      const invite = await prisma.studyGroupInvite.findFirst({
        where: {
          studyGroupId: groupId,
          code: inviteCode,
          expiresAt: { gt: new Date() },
          isActive: true
        }
      });

      if (!invite) {
        throw new Error('Invalid or expired invite code');
      }
    }

    await prisma.$transaction(async (tx) => {
      // Add member
      await tx.studyGroupMember.create({
        data: {
          studyGroupId: groupId,
          userId,
          role: 'MEMBER',
          joinedAt: new Date()
        }
      });

      // Create activity log
      await tx.userActivity.create({
        data: {
          userId,
          type: 'STUDY_GROUP_JOINED',
          entityType: 'STUDY_GROUP',
          entityId: groupId,
          metadata: {
            groupName: group.name
          }
        }
      });

      // Notify group admins
      const admins = await tx.studyGroupMember.findMany({
        where: {
          studyGroupId: groupId,
          role: 'ADMIN'
        },
        include: {
          user: { select: { id: true, name: true } }
        }
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true }
      });

      await Promise.all(
        admins.map(admin =>
          tx.notification.create({
            data: {
              userId: admin.userId,
              type: 'STUDY_GROUP_NEW_MEMBER',
              title: 'New member joined your study group',
              message: `${user?.name} joined "${group.name}"`,
              entityType: 'STUDY_GROUP',
              entityId: groupId
            }
          })
        )
      );
    });

    await this.clearStudyGroupCache(groupId);
  }

  /**
   * Create a study session
   */
  async createSession(
    groupId: string,
    creatorId: string,
    data: CreateSessionData
  ): Promise<StudySessionWithDetails> {
    // Validate user is group member with appropriate permissions
    const membership = await prisma.studyGroupMember.findUnique({
      where: {
        studyGroupId_userId: {
          studyGroupId: groupId,
          userId: creatorId
        }
      }
    });

    if (!membership || !['ADMIN', 'MODERATOR'].includes(membership.role)) {
      throw new Error('Insufficient permissions to create sessions');
    }

    const session = await prisma.$transaction(async (tx) => {
      const newSession = await tx.studyGroupSession.create({
        data: {
          studyGroupId: groupId,
          title: data.title,
          description: data.description,
          scheduledFor: data.scheduledFor,
          duration: data.duration,
          type: data.type,
          isVirtual: data.isVirtual,
          location: data.location,
          meetingUrl: data.meetingUrl,
          agenda: data.agenda || [],
          requiredResources: data.requiredResources || [],
          maxAttendees: data.maxAttendees,
          createdById: creatorId,
          status: 'SCHEDULED'
        }
      });

      // Auto-register the creator as attendee
      await tx.studyGroupSessionAttendee.create({
        data: {
          sessionId: newSession.id,
          userId: creatorId,
          status: 'REGISTERED'
        }
      });

      // Notify all group members
      const members = await tx.studyGroupMember.findMany({
        where: {
          studyGroupId: groupId,
          userId: { not: creatorId }
        },
        include: {
          user: { select: { id: true, name: true } }
        }
      });

      const group = await tx.studyGroup.findUnique({
        where: { id: groupId },
        select: { name: true }
      });

      await Promise.all(
        members.map(member =>
          tx.notification.create({
            data: {
              userId: member.userId,
              type: 'STUDY_SESSION_SCHEDULED',
              title: 'New study session scheduled',
              message: `A new session "${data.title}" is scheduled in "${group?.name}"`,
              entityType: 'STUDY_SESSION',
              entityId: newSession.id,
              actionUrl: `/study-groups/${groupId}/sessions/${newSession.id}`
            }
          })
        )
      );

      return newSession;
    });

    return this.getSessionById(session.id, creatorId);
  }

  /**
   * Register for a study session
   */
  async registerForSession(
    sessionId: string,
    userId: string
  ): Promise<void> {
    const session = await prisma.studyGroupSession.findUnique({
      where: { id: sessionId },
      include: {
        group: true,
        _count: { select: { attendees: true } }
      }
    });

    if (!session) {
      throw new Error('Study session not found');
    }

    if (session.status !== 'SCHEDULED') {
      throw new Error('Cannot register for this session');
    }

    if (session.maxAttendees && session._count.attendees >= session.maxAttendees) {
      throw new Error('Session is full');
    }

    // Verify user is group member
    const membership = await prisma.studyGroupMember.findUnique({
      where: {
        studyGroupId_userId: {
          studyGroupId: session.studyGroupId,
          userId
        }
      }
    });

    if (!membership) {
      throw new Error('Must be a group member to register for sessions');
    }

    // Check if already registered
    const existingRegistration = await prisma.studyGroupSessionAttendee.findUnique({
      where: {
        sessionId_userId: {
          sessionId,
          userId
        }
      }
    });

    if (existingRegistration) {
      throw new Error('Already registered for this session');
    }

    await prisma.studyGroupSessionAttendee.create({
      data: {
        sessionId,
        userId,
        status: 'REGISTERED'
      }
    });

    await this.clearSessionCache(sessionId);
  }

  /**
   * Share a resource with the study group
   */
  async shareResource(
    groupId: string,
    userId: string,
    data: {
      title: string;
      description?: string;
      type: 'FILE' | 'LINK' | 'NOTE' | 'VIDEO';
      url: string;
      fileSize?: number;
      mimeType?: string;
      tags?: string[];
    }
  ): Promise<StudyGroupResource> {
    // Verify user is group member
    const membership = await prisma.studyGroupMember.findUnique({
      where: {
        studyGroupId_userId: {
          studyGroupId: groupId,
          userId
        }
      }
    });

    if (!membership) {
      throw new Error('Must be a group member to share resources');
    }

    const resource = await prisma.studyGroupResource.create({
      data: {
        studyGroupId: groupId,
        title: data.title,
        description: data.description,
        type: data.type,
        url: data.url,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        tags: data.tags || [],
        uploadedById: userId,
        isActive: true
      }
    });

    await this.clearStudyGroupCache(groupId);

    return resource;
  }

  /**
   * Get study group statistics and analytics
   */
  async getGroupStats(
    groupId: string,
    timeframe: 'week' | 'month' | 'quarter' | 'all' = 'month'
  ): Promise<StudyGroupStats> {
    const cacheKey = `${this.cachePrefix}stats:${groupId}:${timeframe}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    let dateFilter: Date | undefined;
    const now = new Date();

    switch (timeframe) {
      case 'week':
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
    }

    const [
      members,
      sessions,
      attendanceData,
      resourcesData
    ] = await Promise.all([
      prisma.studyGroupMember.findMany({
        where: { studyGroupId: groupId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profileImageUrl: true
            }
          }
        }
      }),
      prisma.studyGroupSession.findMany({
        where: {
          studyGroupId: groupId,
          ...(dateFilter && { createdAt: { gte: dateFilter } })
        },
        include: {
          _count: { select: { attendees: true } }
        }
      }),
      prisma.studyGroupSessionAttendee.groupBy({
        by: ['userId'],
        where: {
          session: {
            studyGroupId: groupId,
            ...(dateFilter && { scheduledFor: { gte: dateFilter } })
          },
          status: 'ATTENDED'
        },
        _count: { sessionId: true }
      }),
      prisma.studyGroupResource.groupBy({
        by: ['uploadedById'],
        where: {
          studyGroupId: groupId,
          ...(dateFilter && { createdAt: { gte: dateFilter } })
        },
        _count: { id: true }
      })
    ]);

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'COMPLETED').length;
    const activeSessions = sessions.filter(s => s.status === 'IN_PROGRESS').length;

    const totalAttendance = sessions.reduce((sum, s) => sum + s._count.attendees, 0);
    const averageAttendance = totalSessions > 0 ? totalAttendance / totalSessions : 0;

    const memberEngagement = members.map(member => {
      const attendance = attendanceData.find(a => a.userId === member.userId);
      const resources = resourcesData.find(r => r.uploadedById === member.userId);

      const sessionsAttended = attendance?._count.sessionId || 0;
      const resourcesShared = resources?._count.id || 0;

      // Calculate participation score (0-100)
      const participationScore = Math.min(100,
        (sessionsAttended * 30) + (resourcesShared * 20) +
        (member.role === 'ADMIN' ? 20 : member.role === 'MODERATOR' ? 10 : 0)
      );

      return {
        userId: member.userId,
        user: member.user,
        sessionsAttended,
        resourcesShared,
        participationScore
      };
    });

    // Calculate study streaks (simplified version)
    const studyStreaks = members.map(member => ({
      userId: member.userId,
      currentStreak: 0, // TODO: Implement streak calculation
      longestStreak: 0
    }));

    const stats: StudyGroupStats = {
      totalMembers: members.length,
      activeSessions,
      completedSessions,
      averageAttendance: Math.round(averageAttendance * 100) / 100,
      memberEngagement: memberEngagement.sort((a, b) => b.participationScore - a.participationScore),
      studyStreaks
    };

    await redis.setex(cacheKey, 3600, JSON.stringify(stats));

    return stats;
  }

  /**
   * Get user's study groups
   */
  async getUserStudyGroups(
    userId: string,
    status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE'
  ): Promise<StudyGroupWithDetails[]> {
    const where: any = {
      members: {
        some: { userId }
      }
    };

    if (status !== 'ALL') {
      where.status = status;
    }

    const groups = await prisma.studyGroup.findMany({
      where,
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profileImageUrl: true
              }
            }
          },
          take: 5 // Limit for performance
        },
        resources: {
          where: { isActive: true },
          take: 3,
          orderBy: { createdAt: 'desc' }
        },
        sessions: {
          where: {
            scheduledFor: { gte: new Date() }
          },
          take: 2,
          orderBy: { scheduledFor: 'asc' }
        },
        _count: {
          select: {
            members: true,
            sessions: true,
            resources: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    return groups.map(group => {
      const userMembership = group.members.find(m => m.userId === userId);

      return {
        ...group,
        relatedCourses: [],
        userRole: userMembership?.role,
        canJoin: false
      };
    }) as StudyGroupWithDetails[];
  }

  // Helper methods
  private async getSessionById(
    sessionId: string,
    userId?: string
  ): Promise<StudySessionWithDetails> {
    const session = await prisma.studyGroupSession.findUnique({
      where: { id: sessionId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        attendees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true
              }
            }
          }
        },
        resources: {
          where: { isActive: true }
        },
        _count: {
          select: { attendees: true }
        }
      }
    });

    if (!session) {
      throw new Error('Study session not found');
    }

    return session as StudySessionWithDetails;
  }

  private async clearStudyGroupCaches(): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  private async clearStudyGroupCache(groupId: string): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}${groupId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  private async clearSessionCache(sessionId: string): Promise<void> {
    const keys = await redis.keys(`${this.cachePrefix}session:${sessionId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export const studyGroupService = new StudyGroupService();