import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { studyGroupService } from '@/services/social/studyGroupService';
import { notificationService } from '@/services/social/notificationService';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const groupId = params.id;
    const body = await request.json();
    const {
      title,
      description,
      scheduledFor,
      duration,
      type,
      isVirtual,
      location,
      meetingUrl,
      agenda,
      requiredResources,
      maxAttendees,
    } = body;

    // Validate required fields
    if (!title?.trim() || !description?.trim() || !scheduledFor || !duration) {
      return NextResponse.json(
        { error: 'Title, description, scheduled time, and duration are required' },
        { status: 400 }
      );
    }

    // Validate scheduled time is in the future
    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Scheduled time must be in the future' },
        { status: 400 }
      );
    }

    // Validate duration
    if (duration < 15 || duration > 480) { // 15 minutes to 8 hours
      return NextResponse.json(
        { error: 'Duration must be between 15 minutes and 8 hours' },
        { status: 400 }
      );
    }

    // Validate type
    if (!['STUDY', 'DISCUSSION', 'PROJECT', 'REVIEW'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid session type' },
        { status: 400 }
      );
    }

    // Validate virtual session requirements
    if (isVirtual && !meetingUrl?.trim()) {
      return NextResponse.json(
        { error: 'Meeting URL is required for virtual sessions' },
        { status: 400 }
      );
    }

    // Validate in-person session requirements
    if (!isVirtual && !location?.trim()) {
      return NextResponse.json(
        { error: 'Location is required for in-person sessions' },
        { status: 400 }
      );
    }

    const sessionData = {
      title: title.trim(),
      description: description.trim(),
      scheduledFor: scheduledDate,
      duration,
      type,
      isVirtual: isVirtual ?? true,
      location: location?.trim(),
      meetingUrl: meetingUrl?.trim(),
      agenda: agenda || [],
      requiredResources: requiredResources || [],
      maxAttendees: maxAttendees || undefined,
    };

    const session_result = await studyGroupService.createSession(
      groupId,
      session.user.id,
      sessionData
    );

    // Get group info for notifications
    const group = await studyGroupService.getStudyGroupById(groupId);

    // Send notifications to group members
    if (group) {
      try {
        const memberIds = group.members
          .filter(member => member.user.id !== session.user.id)
          .map(member => member.user.id);

        if (memberIds.length > 0) {
          await notificationService.createBulkNotifications({
            userIds: memberIds,
            type: 'STUDY_SESSION_SCHEDULED',
            title: 'New study session scheduled',
            message: `A new ${type.toLowerCase()} session "${title}" has been scheduled in "${group.name}"`,
            entityType: 'STUDY_SESSION',
            entityId: session_result.id,
            actionUrl: `/study-groups/${groupId}?tab=sessions`,
            priority: 'MEDIUM',
          });
        }
      } catch (notificationError) {
        console.error('Failed to send notifications:', notificationError);
      }
    }

    return NextResponse.json(session_result, { status: 201 });
  } catch (error) {
    console.error('Error creating study session:', error);

    // Handle specific error messages
    let errorMessage = 'Failed to create study session';
    let statusCode = 500;

    if (error instanceof Error) {
      errorMessage = error.message;

      if (errorMessage.includes('not found')) {
        statusCode = 404;
      } else if (errorMessage.includes('permission')) {
        statusCode = 403;
      } else if (errorMessage.includes('required') || errorMessage.includes('invalid')) {
        statusCode = 400;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}