import { NextRequest, NextResponse } from 'next/server';
import { passwordResetService } from '@/services/passwordResetService';
import { rateLimitUtils } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    // Validate input
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Rate limiting by IP
    const clientIP = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = `forgot_password_ip:${clientIP}`;
    
    if (rateLimitUtils.isRateLimited(rateLimitKey, 5, 15 * 60 * 1000)) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Process password reset request
    const result = await passwordResetService.initiatePasswordReset(
      email,
      request.headers.get('user-agent') || undefined,
      clientIP
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
    console.error('Forgot password API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}