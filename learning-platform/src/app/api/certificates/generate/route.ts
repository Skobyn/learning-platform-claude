import { NextRequest, NextResponse } from 'next/server';
import { certificateService } from '@/services/certificateService';
import { sessionUtils } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { courseId, templateId } = body;

    // Validate input
    if (!courseId) {
      return NextResponse.json(
        { success: false, error: 'Course ID is required' },
        { status: 400 }
      );
    }

    // Get user and course details for certificate
    const certificateData = {
      userId: user.id,
      courseId,
      templateId: templateId || 'default-course-completion',
      recipientName: `${user.firstName} ${user.lastName}`,
      courseTitle: 'Course Title', // This should be fetched from the course
      completionDate: new Date(),
      metadata: {
        generatedBy: 'system',
        generatedAt: new Date(),
      },
    };

    // Generate certificate
    const result = await certificateService.generateCertificate(certificateData);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      certificateId: result.certificateId,
      pdfUrl: result.pdfUrl,
      verificationCode: result.verificationCode,
    });

  } catch (error) {
    console.error('Generate certificate API error:', error);
    return NextResponse.json(
      { success: false, error: 'Certificate generation failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get user certificates
    const certificates = await certificateService.getUserCertificates(user.id);

    return NextResponse.json({
      success: true,
      certificates,
    });

  } catch (error) {
    console.error('Get certificates API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get certificates' },
      { status: 500 }
    );
  }
}