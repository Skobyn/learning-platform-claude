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
    const { replyId } = body;

    if (!replyId) {
      return NextResponse.json(
        { error: 'Reply ID is required' },
        { status: 400 }
      );
    }

    // Check if discussion exists and is a question
    const discussion = await discussionService.getDiscussion(discussionId);
    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    if (!discussion.isQuestion) {
      return NextResponse.json(
        { error: 'Only questions can have accepted answers' },
        { status: 400 }
      );
    }

    // Check if user is the discussion author
    if (discussion.author.id !== session.user.id) {
      return NextResponse.json(
        { error: 'Only the question author can accept answers' },
        { status: 403 }
      );
    }

    // Check if the reply exists in this discussion
    const reply = discussion.replies.find(r => r.id === replyId);
    if (!reply) {
      return NextResponse.json(
        { error: 'Reply not found in this discussion' },
        { status: 404 }
      );
    }

    await discussionService.acceptAnswer(session.user.id, replyId);

    // Create notification for the answer author
    try {
      await notificationService.createNotification({
        userId: reply.author.id,
        type: 'ANSWER_ACCEPTED',
        title: 'Your answer was accepted!',
        message: `Your answer to "${discussion.title}" was marked as the best answer`,
        entityType: 'DISCUSSION',
        entityId: discussionId,
        actionUrl: `/discussions/${discussionId}#reply-${replyId}`,
        priority: 'HIGH',
      });
    } catch (notificationError) {
      console.error('Failed to send notification:', notificationError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error accepting answer:', error);
    return NextResponse.json(
      { error: 'Failed to accept answer' },
      { status: 500 }
    );
  }
}