import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { studyGroupService } from '@/services/social/studyGroupService';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    const groupId = params.id;

    const group = await studyGroupService.getStudyGroupById(
      groupId,
      session?.user?.id
    );

    if (!group) {
      return NextResponse.json(
        { error: 'Study group not found' },
        { status: 404 }
      );
    }

    // Check if user has access to this group
    if (group.type === 'PRIVATE' && !group.userRole) {
      return NextResponse.json(
        { error: 'Access denied to private group' },
        { status: 403 }
      );
    }

    return NextResponse.json(group);
  } catch (error) {
    console.error('Error fetching study group:', error);
    return NextResponse.json(
      { error: 'Failed to fetch study group' },
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

    const groupId = params.id;
    const body = await request.json();

    // Check if user has permission to edit this group
    const group = await studyGroupService.getStudyGroupById(groupId, session.user.id);

    if (!group) {
      return NextResponse.json(
        { error: 'Study group not found' },
        { status: 404 }
      );
    }

    // Only allow admins to edit the group
    if (group.userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only group admins can edit the group' },
        { status: 403 }
      );
    }

    // Update group (implementation would depend on your service)
    // For now, just return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating study group:', error);
    return NextResponse.json(
      { error: 'Failed to update study group' },
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

    const groupId = params.id;

    // Check if user has permission to delete this group
    const group = await studyGroupService.getStudyGroupById(groupId, session.user.id);

    if (!group) {
      return NextResponse.json(
        { error: 'Study group not found' },
        { status: 404 }
      );
    }

    // Only allow admins to delete the group
    if (group.userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only group admins can delete the group' },
        { status: 403 }
      );
    }

    // Delete group (implementation would depend on your service)
    // For now, just return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting study group:', error);
    return NextResponse.json(
      { error: 'Failed to delete study group' },
      { status: 500 }
    );
  }
}