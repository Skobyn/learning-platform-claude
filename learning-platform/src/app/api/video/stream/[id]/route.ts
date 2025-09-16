import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { videoStreamingService } from '@/services/videoStreamingService';
import { enhancedVideoStreamingService } from '@/services/videoStreamingService.enhanced';
import VideoTranscodingService from '@/services/videoTranscodingService';
import { rateLimiter } from '@/middleware/rateLimiter';
import fs from 'fs';
import path from 'path';
import { createReadStream, statSync } from 'fs';
import { z } from 'zod';

// Initialize services
const transcodingService = new VideoTranscodingService();

// Validation schemas
const streamParamsSchema = z.object({
  quality: z.string().optional(),
  format: z.enum(['hls', 'dash', 'mp4']).optional(),
  token: z.string().optional(),
  segment: z.string().optional(),
  chunk: z.coerce.number().optional(),
  startTime: z.coerce.number().optional(),
  endTime: z.coerce.number().optional()
});

/**
 * GET /api/video/stream/[id]
 * Stream video content with adaptive bitrate support
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const videoId = params.id;
    const url = new URL(req.url);
    const searchParams = Object.fromEntries(url.searchParams.entries());

    // Apply rate limiting for streaming
    const rateLimitResult = await rateLimiter.checkLimit(req, 'video-stream', 1000, 3600); // 1000 requests per hour
    if (!rateLimitResult.success) {
      return new NextResponse('Rate limit exceeded', {
        status: 429,
        headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '3600' }
      });
    }

    const validatedParams = streamParamsSchema.parse(searchParams);

    // Check authentication and access
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse('Authentication required', { status: 401 });
    }

    const userId = session.user.id;

    // Handle different streaming endpoints
    const { quality, format, token, segment, chunk, startTime, endTime } = validatedParams;

    // Handle master playlist request
    if (format === 'hls' && !quality && !segment) {
      return await handleMasterPlaylist(videoId, userId);
    }

    // Handle HLS playlist request
    if (format === 'hls' && quality && !segment) {
      return await handleHLSPlaylist(videoId, quality, userId, token);
    }

    // Handle HLS segment request
    if (format === 'hls' && quality && segment) {
      return await handleHLSSegment(videoId, quality, segment, userId, token);
    }

    // Handle DASH manifest request
    if (format === 'dash' && !segment) {
      return await handleDASHManifest(videoId, userId, token);
    }

    // Handle DASH segment request
    if (format === 'dash' && segment) {
      return await handleDASHSegment(videoId, segment, userId, token);
    }

    // Handle MP4 progressive download
    if (format === 'mp4') {
      return await handleMP4Stream(videoId, quality || '720p', userId, req);
    }

    // Handle chunk request (for legacy compatibility)
    if (chunk !== undefined) {
      return await handleChunkStream(videoId, quality || '720p', chunk, userId, token);
    }

    // Handle video clip request (with time range)
    if (startTime !== undefined || endTime !== undefined) {
      return await handleVideoClip(videoId, quality || '720p', startTime, endTime, userId);
    }

    // Default: return video metadata
    return await handleVideoMetadata(videoId, userId);

  } catch (error) {
    console.error('Video streaming error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}

/**
 * Handle master playlist for adaptive streaming
 */
async function handleMasterPlaylist(videoId: string, userId: string) {
  try {
    // Generate streaming token
    const tokenResult = await videoStreamingService.generateStreamingToken(videoId, userId);
    if (!tokenResult.success) {
      return new NextResponse(tokenResult.error, { status: 403 });
    }

    // Generate master playlist
    const playlistResult = await enhancedVideoStreamingService.generateMasterPlaylist(videoId);
    if (!playlistResult.success) {
      return new NextResponse(playlistResult.error, { status: 404 });
    }

    return new NextResponse(playlistResult.playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'public, max-age=300', // 5 minutes cache
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'X-Streaming-Token': tokenResult.token!
      }
    });

  } catch (error) {
    console.error('Master playlist error:', error);
    return new NextResponse('Playlist generation failed', { status: 500 });
  }
}

/**
 * Handle HLS playlist request
 */
async function handleHLSPlaylist(videoId: string, quality: string, userId: string, token?: string) {
  try {
    // Validate token if provided
    if (token) {
      const manifest = await videoStreamingService.createStreamingManifest(videoId, token);
      if (!manifest.success) {
        return new NextResponse('Invalid token', { status: 403 });
      }
    }

    const playlistPath = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      videoId,
      quality,
      'hls',
      'playlist.m3u8'
    );

    if (!fs.existsSync(playlistPath)) {
      return new NextResponse('Playlist not found', { status: 404 });
    }

    const playlist = fs.readFileSync(playlistPath, 'utf-8');

    return new NextResponse(playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('HLS playlist error:', error);
    return new NextResponse('Playlist error', { status: 500 });
  }
}

/**
 * Handle HLS segment request
 */
async function handleHLSSegment(videoId: string, quality: string, segment: string, userId: string, token?: string) {
  try {
    // Validate token
    if (token) {
      const valid = await videoStreamingService['validateStreamingToken'](token, videoId);
      if (!valid) {
        return new NextResponse('Invalid token', { status: 403 });
      }
    }

    const segmentPath = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      videoId,
      quality,
      'hls',
      segment
    );

    if (!fs.existsSync(segmentPath)) {
      return new NextResponse('Segment not found', { status: 404 });
    }

    const stats = statSync(segmentPath);
    const stream = createReadStream(segmentPath);

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000', // 1 year cache for segments
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('HLS segment error:', error);
    return new NextResponse('Segment error', { status: 500 });
  }
}

/**
 * Handle DASH manifest request
 */
async function handleDASHManifest(videoId: string, userId: string, token?: string) {
  try {
    // Validate token if provided
    if (token) {
      const manifest = await videoStreamingService.createStreamingManifest(videoId, token);
      if (!manifest.success) {
        return new NextResponse('Invalid token', { status: 403 });
      }
    }

    const manifestPath = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      videoId,
      'dash',
      'manifest.mpd'
    );

    if (!fs.existsSync(manifestPath)) {
      return new NextResponse('Manifest not found', { status: 404 });
    }

    const manifest = fs.readFileSync(manifestPath, 'utf-8');

    return new NextResponse(manifest, {
      headers: {
        'Content-Type': 'application/dash+xml',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('DASH manifest error:', error);
    return new NextResponse('Manifest error', { status: 500 });
  }
}

/**
 * Handle DASH segment request
 */
async function handleDASHSegment(videoId: string, segment: string, userId: string, token?: string) {
  try {
    // Validate token
    if (token) {
      const valid = await videoStreamingService['validateStreamingToken'](token, videoId);
      if (!valid) {
        return new NextResponse('Invalid token', { status: 403 });
      }
    }

    // Find segment in any quality directory
    const videoDir = path.join(process.env.VIDEO_STORAGE_PATH || './storage/videos', videoId);
    let segmentPath = '';

    // Search in quality directories
    const qualityDirs = fs.readdirSync(videoDir).filter(dir =>
      fs.statSync(path.join(videoDir, dir)).isDirectory()
    );

    for (const qualityDir of qualityDirs) {
      const dashDir = path.join(videoDir, qualityDir, 'dash');
      if (fs.existsSync(dashDir)) {
        const potentialPath = path.join(dashDir, segment);
        if (fs.existsSync(potentialPath)) {
          segmentPath = potentialPath;
          break;
        }
      }
    }

    if (!segmentPath) {
      return new NextResponse('Segment not found', { status: 404 });
    }

    const stats = statSync(segmentPath);
    const stream = createReadStream(segmentPath);

    const contentType = segment.endsWith('.m4s') ? 'video/mp4' : 'video/mp4';

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('DASH segment error:', error);
    return new NextResponse('Segment error', { status: 500 });
  }
}

/**
 * Handle MP4 progressive streaming with range requests
 */
async function handleMP4Stream(videoId: string, quality: string, userId: string, req: NextRequest) {
  try {
    // Generate streaming token
    const tokenResult = await videoStreamingService.generateStreamingToken(videoId, userId);
    if (!tokenResult.success) {
      return new NextResponse(tokenResult.error, { status: 403 });
    }

    const videoPath = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      videoId,
      quality,
      `video_${quality}.mp4`
    );

    if (!fs.existsSync(videoPath)) {
      return new NextResponse('Video not found', { status: 404 });
    }

    const stats = statSync(videoPath);
    const fileSize = stats.size;
    const range = req.headers.get('range');

    // Handle range requests for video seeking
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      const stream = createReadStream(videoPath, { start, end });

      return new NextResponse(stream as any, {
        status: 206, // Partial Content
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*',
          'X-Streaming-Token': tokenResult.token!
        }
      });
    }

    // Full file download
    const stream = createReadStream(videoPath);

    return new NextResponse(stream as any, {
      headers: {
        'Content-Length': fileSize.toString(),
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'X-Streaming-Token': tokenResult.token!
      }
    });

  } catch (error) {
    console.error('MP4 stream error:', error);
    return new NextResponse('Stream error', { status: 500 });
  }
}

/**
 * Handle legacy chunk streaming
 */
async function handleChunkStream(videoId: string, quality: string, chunkIndex: number, userId: string, token?: string) {
  try {
    let streamingToken = token;

    // Generate token if not provided
    if (!streamingToken) {
      const tokenResult = await videoStreamingService.generateStreamingToken(videoId, userId);
      if (!tokenResult.success) {
        return new NextResponse(tokenResult.error, { status: 403 });
      }
      streamingToken = tokenResult.token!;
    }

    // Stream chunk using existing service
    const result = await videoStreamingService.streamVideoChunk(videoId, quality, chunkIndex, streamingToken);

    if (!result.success) {
      return new NextResponse(result.error, { status: 404 });
    }

    return new NextResponse(result.stream as any, {
      headers: result.headers
    });

  } catch (error) {
    console.error('Chunk stream error:', error);
    return new NextResponse('Chunk error', { status: 500 });
  }
}

/**
 * Handle video clip extraction
 */
async function handleVideoClip(videoId: string, quality: string, startTime?: number, endTime?: number, userId: string) {
  try {
    // Generate streaming token
    const tokenResult = await videoStreamingService.generateStreamingToken(videoId, userId);
    if (!tokenResult.success) {
      return new NextResponse(tokenResult.error, { status: 403 });
    }

    const videoPath = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      videoId,
      quality,
      `video_${quality}.mp4`
    );

    if (!fs.existsSync(videoPath)) {
      return new NextResponse('Video not found', { status: 404 });
    }

    // For video clips, we'd need to use FFmpeg to extract the segment
    // This is a simplified implementation - in production, you might want to pre-generate clips
    // or use a more sophisticated approach

    const stats = statSync(videoPath);
    const stream = createReadStream(videoPath);

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Streaming-Token': tokenResult.token!,
        'X-Clip-Start': startTime?.toString() || '0',
        'X-Clip-End': endTime?.toString() || 'end'
      }
    });

  } catch (error) {
    console.error('Video clip error:', error);
    return new NextResponse('Clip error', { status: 500 });
  }
}

/**
 * Handle video metadata request
 */
async function handleVideoMetadata(videoId: string, userId: string) {
  try {
    // Verify access
    const hasAccess = await videoStreamingService['verifyVideoAccess'](videoId, userId);
    if (!hasAccess) {
      return new NextResponse('Access denied', { status: 403 });
    }

    const metadata = await videoStreamingService.getVideoMetadata(videoId);
    if (!metadata) {
      return new NextResponse('Video not found', { status: 404 });
    }

    // Get transcoding status
    const transcodingJob = await transcodingService.getJobStatus(videoId);

    return NextResponse.json({
      success: true,
      video: {
        id: metadata.id,
        originalFilename: metadata.originalFilename,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        status: metadata.status,
        qualityVariants: metadata.qualityVariants || [],
        createdAt: metadata.createdAt,
        processedAt: metadata.processedAt
      },
      transcoding: transcodingJob ? {
        jobId: transcodingJob.id,
        status: transcodingJob.status,
        progress: transcodingJob.progress,
        currentProfile: transcodingJob.currentProfile,
        currentFormat: transcodingJob.currentFormat
      } : null,
      streaming: {
        hlsUrl: `/api/video/stream/${videoId}?format=hls`,
        dashUrl: `/api/video/stream/${videoId}?format=dash`,
        mp4Urls: metadata.qualityVariants?.filter(v => v.format === 'mp4').reduce((acc, variant) => {
          acc[variant.quality] = `/api/video/stream/${videoId}?format=mp4&quality=${variant.quality}`;
          return acc;
        }, {} as Record<string, string>) || {}
      }
    });

  } catch (error) {
    console.error('Video metadata error:', error);
    return new NextResponse('Metadata error', { status: 500 });
  }
}

/**
 * POST /api/video/stream/[id]
 * Update watch progress and handle analytics
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const videoId = params.id;
    const userId = session.user.id;
    const body = await req.json();

    const { action, position, duration, quality, analytics } = body;

    switch (action) {
      case 'updateProgress':
        const progressResult = await videoStreamingService.updateWatchProgress(
          userId,
          videoId,
          position,
          duration
        );

        if (!progressResult.success) {
          return NextResponse.json({ error: progressResult.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });

      case 'logAnalytics':
        // Log streaming analytics
        if (analytics) {
          await logStreamingAnalytics(userId, videoId, analytics);
        }

        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Stream POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Log streaming analytics
 */
async function logStreamingAnalytics(userId: string, videoId: string, analytics: any) {
  try {
    // Implementation would depend on your analytics system
    // This is a placeholder for logging streaming analytics
    console.log('Streaming analytics:', { userId, videoId, analytics });
  } catch (error) {
    console.error('Analytics logging error:', error);
  }
}