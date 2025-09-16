import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { studyGroupService } from '@/services/social/studyGroupService';
import { notificationService } from '@/services/social/notificationService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search');
    const type = searchParams.get('type') as 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
    const courseId = searchParams.get('courseId');
    const tags = searchParams.get('tags')?.split(',').filter(Boolean);
    const userId = searchParams.get('userId');

    const session = await getServerSession(authOptions);

    // If userId is provided, get user's study groups
    if (userId) {
      const groups = await studyGroupService.getUserStudyGroups(
        userId,
        searchParams.get('status') as any || 'ACTIVE'
      );
      return NextResponse.json({ groups });
    }

    // Build filters for public groups or groups user has access to
    const filters: any = {};

    if (search) {
      filters.search = search;
    }

    if (type) {
      filters.type = type;
    } else {
      // Only show public groups for non-authenticated users
      if (!session?.user) {
        filters.type = 'PUBLIC';
      }
    }

    if (courseId) {
      filters.courseId = courseId;
    }

    if (tags) {
      filters.tags = tags;
    }

    // For now, we'll implement a simplified version
    // In a real implementation, you'd have a getStudyGroups method
    const result = {
      groups: [],
      total: 0,
      hasMore: false,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching study groups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch study groups' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      name,
      description,
      type,
      maxMembers,
      tags,
      courseIds,
      meetingSchedule,
      rules,
      isVirtual,
      location,
    } = body;

    // Validate required fields
    if (!name?.trim() || !description?.trim() || !type || !maxMembers) {
      return NextResponse.json(
        { error: 'Name, description, type, and maxMembers are required' },
        { status: 400 }
      );
    }

    // Validate maxMembers range
    if (maxMembers < 2 || maxMembers > 100) {
      return NextResponse.json(
        { error: 'maxMembers must be between 2 and 100' },
        { status: 400 }
      );
    }

    // Validate type
    if (!['PUBLIC', 'PRIVATE', 'INVITE_ONLY'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid group type' },
        { status: 400 }
      );
    }

    const groupData = {
      name: name.trim(),
      description: description.trim(),
      type,
      maxMembers,
      tags: tags || [],
      courseIds: courseIds || [],
      meetingSchedule,
      rules: rules || [],
      isVirtual: isVirtual ?? true,
      location: location || undefined,
    };

    const studyGroup = await studyGroupService.createStudyGroup(session.user.id, groupData);

    // Create activity log
    try {
      // This would typically integrate with your activity tracking service
      console.log(`Study group created: ${studyGroup.id} by ${session.user.id}`);

      // If the group is linked to courses, notify course participants
      if (courseIds?.length > 0 && type === 'PUBLIC') {
        // Implementation would depend on your course participant system
        // await notificationService.createBulkNotifications({
        //   userIds: courseParticipants,
        //   type: 'STUDY_GROUP_CREATED',
        //   title: 'New Study Group Available',
        //   message: `A new study group "${name}" has been created for your course`,
        //   entityType: 'STUDY_GROUP',
        //   entityId: studyGroup.id,
        //   actionUrl: `/study-groups/${studyGroup.id}`,
        //   priority: 'LOW',
        // });
      }
    } catch (notificationError) {
      console.error('Failed to send notifications:', notificationError);
      // Don't fail the main request if notifications fail
    }

    return NextResponse.json(studyGroup, { status: 201 });
  } catch (error) {
    console.error('Error creating study group:', error);
    return NextResponse.json(
      { error: 'Failed to create study group' },
      { status: 500 }
    );
  }
}