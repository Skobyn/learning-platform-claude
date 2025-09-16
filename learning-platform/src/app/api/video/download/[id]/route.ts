import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { offlineDownloadService } from '@/services/offlineDownloadService';
import { rateLimiter } from '@/middleware/rateLimiter';
import { z } from 'zod';

const downloadOptionsSchema = z.object({
  quality: z.enum(['240p', '360p', '480p', '720p', '1080p', '1440p', '4K']).optional(),
  format: z.enum(['hls', 'dash', 'mp4']).optional(),
  includeSubtitles: z.boolean().optional(),
  includeChapters: z.boolean().optional(),
  includeNotes: z.boolean().optional(),
  expirationDays: z.number().min(1).max(90).optional(),
  maxDownloads: z.number().min(1).max(10).optional(),
  enableDRM: z.boolean().optional(),
  compressionLevel: z.number().min(0).max(9).optional()
});

/**
 * POST /api/video/download/[id]
 * Create offline download package
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Apply rate limiting
    const rateLimitResult = await rateLimiter.checkLimit(req, 'video-download', 10, 3600); // 10 downloads per hour
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const videoId = params.id;
    const userId = session.user.id;

    // Parse request body
    let options = {};
    try {
      const body = await req.json();
      options = downloadOptionsSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid options', details: error.errors },
          { status: 400 }
        );
      }
    }

    // Create offline package
    const result = await offlineDownloadService.createOfflinePackage(
      userId,
      videoId,
      options
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      packageId: result.packageId,
      message: 'Download package creation started'
    });

  } catch (error) {
    console.error('Download creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video/download/[id]?token=xxx
 * Download package file or get package status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const packageId = params.id;
    const token = req.nextUrl.searchParams.get('token');

    // If token is provided, stream the package file
    if (token) {
      const result = await offlineDownloadService.streamPackageFile(packageId, token);

      if (!result.success) {
        return new NextResponse(result.error, { status: 404 });
      }

      return new NextResponse(result.stream as any, {
        headers: result.headers
      });
    }

    // Otherwise, return package status
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const packageStatus = await offlineDownloadService.getPackageStatus(packageId);

    if (!packageStatus) {
      return NextResponse.json(
        { error: 'Package not found' },
        { status: 404 }
      );
    }

    if (packageStatus.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      package: {
        id: packageStatus.id,
        videoId: packageStatus.videoId,
        title: packageStatus.title,
        quality: packageStatus.quality,
        format: packageStatus.format,
        status: packageStatus.status,
        createdAt: packageStatus.createdAt,
        expiresAt: packageStatus.expiresAt,
        packageSize: packageStatus.packageSize,
        downloadCount: packageStatus.downloadCount,
        maxDownloads: packageStatus.maxDownloads,
        includeSubtitles: packageStatus.includeSubtitles,
        includeChapters: packageStatus.includeChapters,
        includeNotes: packageStatus.includeNotes
      }
    });

  } catch (error) {
    console.error('Download retrieval error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/video/download/[id]
 * Delete offline package
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const packageId = params.id;
    const userId = session.user.id;

    const result = await offlineDownloadService.deletePackage(packageId, userId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Package deleted successfully'
    });

  } catch (error) {
    console.error('Download deletion error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}