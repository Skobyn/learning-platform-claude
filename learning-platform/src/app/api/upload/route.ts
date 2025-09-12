import { NextRequest, NextResponse } from 'next/server';
import { fileUploadService } from '@/services/fileUploadService';
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

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const uploadType = formData.get('uploadType') as string;
    const metadata = formData.get('metadata') ? JSON.parse(formData.get('metadata') as string) : {};

    // Validate input
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!uploadType) {
      return NextResponse.json(
        { success: false, error: 'Upload type is required' },
        { status: 400 }
      );
    }

    // Upload file
    const result = await fileUploadService.uploadFile(file, uploadType, user.id, metadata);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      file: result.file,
    });

  } catch (error) {
    console.error('File upload API error:', error);
    return NextResponse.json(
      { success: false, error: 'Upload failed' },
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

    const { searchParams } = new URL(request.url);
    const uploadType = searchParams.get('uploadType');

    const files = await fileUploadService.getUserFiles(user.id, uploadType || undefined);

    return NextResponse.json({
      success: true,
      files,
    });

  } catch (error) {
    console.error('Get files API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get files' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json(
        { success: false, error: 'File ID is required' },
        { status: 400 }
      );
    }

    const result = await fileUploadService.deleteFile(fileId, user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully',
    });

  } catch (error) {
    console.error('Delete file API error:', error);
    return NextResponse.json(
      { success: false, error: 'Delete failed' },
      { status: 500 }
    );
  }
}