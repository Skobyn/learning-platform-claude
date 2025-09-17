import { NextRequest, NextResponse } from 'next/server';
import { certificateService } from '@/services/certificateService';

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;

    if (!code) {
      return NextResponse.json(
        { valid: false, error: 'Verification code is required' },
        { status: 400 }
      );
    }

    // Verify certificate
    const result = await certificateService.verifyCertificate(code);

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json({
      valid: true,
      certificate: result.certificate,
    });

  } catch (error) {
    console.error('Certificate verification API error:', error);
    return NextResponse.json(
      { valid: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}