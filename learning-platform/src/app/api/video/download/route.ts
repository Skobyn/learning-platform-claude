import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { offlineDownloadService } from '@/services/offlineDownloadService';

/**
 * GET /api/video/download
 * Get user's offline packages
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const packages = await offlineDownloadService.getUserPackages(userId);

    return NextResponse.json({
      success: true,
      packages: packages.map(pkg => ({
        id: pkg.id,
        videoId: pkg.videoId,
        title: pkg.title,
        quality: pkg.quality,
        format: pkg.format,
        status: pkg.status,
        createdAt: pkg.createdAt,
        expiresAt: pkg.expiresAt,
        packageSize: pkg.packageSize,
        downloadCount: pkg.downloadCount,
        maxDownloads: pkg.maxDownloads,
        includeSubtitles: pkg.includeSubtitles,
        includeChapters: pkg.includeChapters,
        includeNotes: pkg.includeNotes
      }))
    });

  } catch (error) {
    console.error('Get packages error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/video/download
 * Initiate download for a package
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { packageId } = await req.json();

    if (!packageId) {
      return NextResponse.json(
        { error: 'Package ID required' },
        { status: 400 }
      );
    }

    const result = await offlineDownloadService.downloadPackage(packageId, session.user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      downloadUrl: result.downloadUrl,
      message: 'Download ready'
    });

  } catch (error) {
    console.error('Download initiation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}