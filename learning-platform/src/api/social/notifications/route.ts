import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { notificationService } from '@/services/social/notificationService';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const priority = searchParams.get('priority') as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | undefined;
    const types = searchParams.get('types')?.split(',').filter(Boolean);

    const options = {
      page,
      limit,
      unreadOnly,
      priority,
      types: types as any[],
    };

    const result = await notificationService.getUserNotifications(session.user.id, options);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
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
      type,
      title,
      message,
      entityType,
      entityId,
      actionUrl,
      metadata,
      priority,
      channels,
    } = body;

    // Validate required fields
    if (!type || !title || !message) {
      return NextResponse.json(
        { error: 'Type, title, and message are required' },
        { status: 400 }
      );
    }

    const notificationData = {
      userId: session.user.id,
      type,
      title,
      message,
      entityType,
      entityId,
      actionUrl,
      metadata: metadata || {},
      priority: priority || 'MEDIUM',
      channels: channels || ['IN_APP'],
    };

    const notification = await notificationService.createNotification(notificationData);

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    console.error('Error creating notification:', error);
    return NextResponse.json(
      { error: 'Failed to create notification' },
      { status: 500 }
    );
  }
}