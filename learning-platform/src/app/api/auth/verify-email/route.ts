import { NextRequest, NextResponse } from 'next/server';
import { emailVerificationService } from '@/services/emailVerificationService';
import { sessionUtils } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;

    // Validate input
    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Verification token is required' },
        { status: 400 }
      );
    }

    // Verify email
    const result = await emailVerificationService.verifyEmail(
      token,
      request.headers.get('user-agent') || undefined,
      request.ip || request.headers.get('x-forwarded-for') || 'unknown'
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });

  } catch (error) {
    console.error('Email verification API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Resend verification email
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const result = await emailVerificationService.sendEmailVerification(
      user.id,
      request.headers.get('user-agent') || undefined,
      request.ip || request.headers.get('x-forwarded-for') || 'unknown'
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });

  } catch (error) {
    console.error('Resend verification API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { verified: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const status = await emailVerificationService.getVerificationStatus(user.id);

    return NextResponse.json(status);

  } catch (error) {
    console.error('Get verification status API error:', error);
    return NextResponse.json(
      { verified: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}