import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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

    const notificationId = params.id;

    await notificationService.markAsRead(notificationId, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);

    // Handle specific error messages
    let errorMessage = 'Failed to mark notification as read';
    let statusCode = 500;

    if (error instanceof Error) {
      errorMessage = error.message;

      if (errorMessage.includes('not found')) {
        statusCode = 404;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}