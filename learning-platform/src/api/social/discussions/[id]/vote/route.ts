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
    const { type } = body;

    if (!type || !['up', 'down'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid vote type. Must be "up" or "down"' },
        { status: 400 }
      );
    }

    // Check if discussion exists
    const discussion = await discussionService.getDiscussion(discussionId);
    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    // Don't allow users to vote on their own discussions
    if (discussion.author.id === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot vote on your own discussion' },
        { status: 400 }
      );
    }

    await discussionService.voteDiscussion(session.user.id, discussionId, type);

    // Create notification for upvotes (but not downvotes to avoid negativity)
    if (type === 'up') {
      try {
        await notificationService.createNotification({
          userId: discussion.author.id,
          type: 'CONTENT_LIKED',
          title: 'Your discussion was liked',
          message: `${session.user.name} upvoted your discussion "${discussion.title}"`,
          entityType: 'DISCUSSION',
          entityId: discussionId,
          actionUrl: `/discussions/${discussionId}`,
          priority: 'LOW',
        });
      } catch (notificationError) {
        console.error('Failed to send notification:', notificationError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error voting on discussion:', error);
    return NextResponse.json(
      { error: 'Failed to vote on discussion' },
      { status: 500 }
    );
  }
}