import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discussionService } from '@/services/social/discussionService';
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

    const discussionId = params.id;
    const body = await request.json();
    const { content, parentId } = body;

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'Reply content is required' },
        { status: 400 }
      );
    }

    // Check if discussion exists and is not locked
    const discussion = await discussionService.getDiscussion(discussionId);
    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    if (discussion.isLocked) {
      return NextResponse.json(
        { error: 'Discussion is locked' },
        { status: 400 }
      );
    }

    const replyData = {
      content: content.trim(),
      discussionId,
      parentId: parentId || undefined,
    };

    const reply = await discussionService.createReply(session.user.id, replyData);

    // Create notifications
    try {
      const notifications = [];

      // Notify discussion author (if not the same as reply author)
      if (discussion.author.id !== session.user.id) {
        notifications.push({
          userId: discussion.author.id,
          type: 'DISCUSSION_REPLY' as const,
          title: 'New reply to your discussion',
          message: `${session.user.name} replied to your discussion "${discussion.title}"`,
          entityType: 'DISCUSSION',
          entityId: discussionId,
          actionUrl: `/discussions/${discussionId}#reply-${reply.id}`,
          priority: 'MEDIUM' as const,
        });
      }

      // If this is a reply to another reply, notify the parent reply author
      if (parentId) {
        const parentReply = discussion.replies.find(r => r.id === parentId);
        if (parentReply && parentReply.author.id !== session.user.id && parentReply.author.id !== discussion.author.id) {
          notifications.push({
            userId: parentReply.author.id,
            type: 'DISCUSSION_REPLY' as const,
            title: 'Someone replied to your comment',
            message: `${session.user.name} replied to your comment in "${discussion.title}"`,
            entityType: 'DISCUSSION',
            entityId: discussionId,
            actionUrl: `/discussions/${discussionId}#reply-${reply.id}`,
            priority: 'MEDIUM' as const,
          });
        }
      }

      // Send all notifications
      await Promise.all(
        notifications.map(notification =>
          notificationService.createNotification(notification)
        )
      );
    } catch (notificationError) {
      console.error('Failed to send notifications:', notificationError);
    }

    return NextResponse.json(reply, { status: 201 });
  } catch (error) {
    console.error('Error creating reply:', error);
    return NextResponse.json(
      { error: 'Failed to create reply' },
      { status: 500 }
    );
  }
}