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
    const { inviteCode } = body;

    await studyGroupService.joinStudyGroup(session.user.id, groupId, inviteCode);

    // Get updated group info for notifications
    const group = await studyGroupService.getStudyGroupById(groupId);

    // Create notifications for group admins
    if (group) {
      try {
        const adminMembers = group.members.filter(member => member.role === 'ADMIN');

        await Promise.all(
          adminMembers.map(admin =>
            notificationService.createNotification({
              userId: admin.user.id,
              type: 'STUDY_GROUP_NEW_MEMBER',
              title: 'New member joined your study group',
              message: `${session.user.name} joined "${group.name}"`,
              entityType: 'STUDY_GROUP',
              entityId: groupId,
              actionUrl: `/study-groups/${groupId}`,
              priority: 'LOW',
            })
          )
        );
      } catch (notificationError) {
        console.error('Failed to send notifications:', notificationError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error joining study group:', error);

    // Handle specific error messages
    let errorMessage = 'Failed to join study group';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    const statusCode = errorMessage.includes('not found') ? 404 :
                      errorMessage.includes('full') ? 400 :
                      errorMessage.includes('private') ? 403 :
                      errorMessage.includes('invite code') ? 400 :
                      errorMessage.includes('already') ? 409 : 500;

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}