import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discussionService } from '@/services/social/discussionService';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    const discussionId = params.id;

    const discussion = await discussionService.getDiscussion(
      discussionId,
      session?.user?.id
    );

    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(discussion);
  } catch (error) {
    console.error('Error fetching discussion:', error);
    return NextResponse.json(
      { error: 'Failed to fetch discussion' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const { title, content, tags, isLocked, isPinned } = body;

    // First, check if user has permission to edit this discussion
    const discussion = await discussionService.getDiscussion(discussionId);

    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    // Only allow the author or moderators to edit
    const canEdit = discussion.author.id === session.user.id ||
                   session.user.role === 'ADMIN' ||
                   session.user.role === 'MODERATOR';

    if (!canEdit) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Update discussion (implementation would depend on your service)
    // For now, just return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating discussion:', error);
    return NextResponse.json(
      { error: 'Failed to update discussion' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    // Check if user has permission to delete
    const discussion = await discussionService.getDiscussion(discussionId);

    if (!discussion) {
      return NextResponse.json(
        { error: 'Discussion not found' },
        { status: 404 }
      );
    }

    const canDelete = discussion.author.id === session.user.id ||
                     session.user.role === 'ADMIN' ||
                     session.user.role === 'MODERATOR';

    if (!canDelete) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Delete discussion (implementation would depend on your service)
    // For now, just return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting discussion:', error);
    return NextResponse.json(
      { error: 'Failed to delete discussion' },
      { status: 500 }
    );
  }
}