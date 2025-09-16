import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discussionService } from '@/services/social/discussionService';
import { notificationService } from '@/services/social/notificationService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const sortBy = searchParams.get('sortBy') as 'newest' | 'popular' | 'trending' | 'unanswered' || 'newest';
    const courseId = searchParams.get('courseId');
    const userId = searchParams.get('userId');
    const tags = searchParams.get('tags')?.split(',').filter(Boolean);

    const session = await getServerSession(authOptions);

    const filters = {
      category: category || undefined,
      search: search || undefined,
      sortBy,
      courseId: courseId || undefined,
      userId: userId || undefined,
      tags: tags || undefined,
    };

    const result = await discussionService.getDiscussions(filters, page, limit);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching discussions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch discussions' },
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
    const { title, content, category, tags, isQuestion, courseId } = body;

    // Validate required fields
    if (!title?.trim() || !content?.trim() || !category) {
      return NextResponse.json(
        { error: 'Title, content, and category are required' },
        { status: 400 }
      );
    }

    const discussionData = {
      title: title.trim(),
      content: content.trim(),
      category,
      tags: tags || [],
      isQuestion: isQuestion || false,
      courseId,
    };

    const discussion = await discussionService.createDiscussion(session.user.id, discussionData);

    // Create notification for course participants if discussion is course-related
    if (courseId) {
      try {
        // Get course participants (simplified - you may need to implement this)
        // const participants = await getCourseParticipants(courseId);

        // await notificationService.createBulkNotifications({
        //   userIds: participants.filter(p => p.id !== session.user.id).map(p => p.id),
        //   type: 'DISCUSSION_CREATED',
        //   title: 'New Discussion Started',
        //   message: `${session.user.name} started a new discussion: "${title}"`,
        //   entityType: 'DISCUSSION',
        //   entityId: discussion.id,
        //   actionUrl: `/discussions/${discussion.id}`,
        //   priority: 'MEDIUM',
        // });
      } catch (notificationError) {
        console.error('Failed to send notifications:', notificationError);
        // Don't fail the main request if notifications fail
      }
    }

    return NextResponse.json(discussion, { status: 201 });
  } catch (error) {
    console.error('Error creating discussion:', error);
    return NextResponse.json(
      { error: 'Failed to create discussion' },
      { status: 500 }
    );
  }
}