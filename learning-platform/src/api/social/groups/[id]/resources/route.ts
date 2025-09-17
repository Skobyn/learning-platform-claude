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
    const { title, description, type, url, fileSize, mimeType, tags } = body;

    // Validate required fields
    if (!title?.trim() || !url?.trim() || !type) {
      return NextResponse.json(
        { error: 'Title, URL, and type are required' },
        { status: 400 }
      );
    }

    // Validate type
    if (!['FILE', 'LINK', 'NOTE', 'VIDEO'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid resource type' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Validate file size if provided (max 100MB)
    if (fileSize && fileSize > 100 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size cannot exceed 100MB' },
        { status: 400 }
      );
    }

    const resourceData = {
      title: title.trim(),
      description: description?.trim(),
      type,
      url: url.trim(),
      fileSize: fileSize || undefined,
      mimeType: mimeType?.trim(),
      tags: tags || [],
    };

    const resource = await studyGroupService.shareResource(
      groupId,
      session.user.id,
      resourceData
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
            type: 'RESOURCE_SHARED',
            title: 'New resource shared',
            message: `${session.user.name} shared a new ${type.toLowerCase()}: "${title}" in "${group.name}"`,
            entityType: 'STUDY_GROUP',
            entityId: groupId,
            actionUrl: `/study-groups/${groupId}?tab=resources`,
            priority: 'LOW',
          });
        }
      } catch (notificationError) {
        console.error('Failed to send notifications:', notificationError);
      }
    }

    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('Error sharing resource:', error);

    // Handle specific error messages
    let errorMessage = 'Failed to share resource';
    let statusCode = 500;

    if (error instanceof Error) {
      errorMessage = error.message;

      if (errorMessage.includes('not found')) {
        statusCode = 404;
      } else if (errorMessage.includes('member')) {
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