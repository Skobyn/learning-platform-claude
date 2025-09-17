import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enhancedVideoStreamingService } from '@/services/videoStreamingService.enhanced';
import VideoTranscodingService from '@/services/videoTranscodingService';
import { rateLimiter } from '@/middleware/rateLimiter';
import crypto from 'crypto';
import { z } from 'zod';

// Initialize transcoding service
const transcodingService = new VideoTranscodingService();

// Validation schemas
const createUploadSessionSchema = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.number().positive().max(10 * 1024 * 1024 * 1024), // 10GB max
  chunkSize: z.number().positive().max(50 * 1024 * 1024).optional(), // 50MB max chunk
  courseId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  metadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    chapters: z.array(z.object({
      title: z.string(),
      startTime: z.number(),
      endTime: z.number()
    })).optional()
  }).optional()
});

const uploadChunkSchema = z.object({
  sessionId: z.string().uuid(),
  chunkIndex: z.number().min(0),
  checksum: z.string().optional()
});

const finalizeUploadSchema = z.object({
  sessionId: z.string().uuid(),
  qualityProfiles: z.array(z.string()).optional(),
  enablePreview: z.boolean().optional(),
  autoPublish: z.boolean().optional()
});

/**
 * POST /api/video/upload
 * Create new upload session or upload chunk
 */
export async function POST(req: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = await rateLimiter.checkLimit(req, 'video-upload', 50, 3600); // 50 uploads per hour
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

    const userId = session.user.id;
    const contentType = req.headers.get('content-type');
    const action = req.headers.get('x-upload-action') || 'create-session';

    switch (action) {
      case 'create-session':
        return await handleCreateUploadSession(req, userId);

      case 'upload-chunk':
        return await handleUploadChunk(req, userId);

      case 'finalize':
        return await handleFinalizeUpload(req, userId);

      default:
        return NextResponse.json(
          { error: 'Invalid upload action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Video upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle create upload session
 */
async function handleCreateUploadSession(req: NextRequest, userId: string) {
  try {
    const body = await req.json();
    const validatedData = createUploadSessionSchema.parse(body);

    // Validate file type
    const allowedTypes = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.m4v'];
    const fileExtension = validatedData.filename.toLowerCase().slice(validatedData.filename.lastIndexOf('.'));

    if (!allowedTypes.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Unsupported file type', supportedTypes: allowedTypes },
        { status: 400 }
      );
    }

    // Check user's upload quota (if implemented)
    // const quota = await checkUserUploadQuota(userId, validatedData.fileSize);
    // if (!quota.allowed) {
    //   return NextResponse.json(
    //     { error: 'Upload quota exceeded', availableSpace: quota.available },
    //     { status: 413 }
    //   );
    // }

    // Create upload session
    const result = await enhancedVideoStreamingService.createUploadSession(
      userId,
      validatedData.filename,
      validatedData.fileSize,
      validatedData.chunkSize,
      {
        ...validatedData.metadata,
        courseId: validatedData.courseId,
        lessonId: validatedData.lessonId
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      uploadSession: {
        id: result.uploadSession!.id,
        videoId: result.uploadSession!.videoId,
        totalChunks: result.uploadSession!.chunks.length,
        chunkSize: result.uploadSession!.chunkSize,
        expiresAt: result.uploadSession!.expiresAt
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    throw error;
  }
}

/**
 * Handle chunk upload
 */
async function handleUploadChunk(req: NextRequest, userId: string) {
  try {
    const sessionId = req.headers.get('x-session-id');
    const chunkIndex = parseInt(req.headers.get('x-chunk-index') || '0');
    const checksum = req.headers.get('x-chunk-checksum') || undefined;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    // Validate session ownership
    const session = await enhancedVideoStreamingService.getUploadSessionStatus(sessionId);
    if (!session || session.userId !== userId) {
      return NextResponse.json(
        { error: 'Invalid session or access denied' },
        { status: 403 }
      );
    }

    if (session.status !== 'active') {
      return NextResponse.json(
        { error: 'Session not active', status: session.status },
        { status: 400 }
      );
    }

    // Check if session expired
    if (new Date() > session.expiresAt) {
      return NextResponse.json(
        { error: 'Session expired' },
        { status: 410 }
      );
    }

    // Read chunk data
    const chunkData = Buffer.from(await req.arrayBuffer());

    // Validate chunk size
    const expectedChunk = session.chunks[chunkIndex];
    if (!expectedChunk) {
      return NextResponse.json(
        { error: 'Invalid chunk index' },
        { status: 400 }
      );
    }

    if (chunkData.length !== expectedChunk.size) {
      return NextResponse.json(
        { error: 'Chunk size mismatch', expected: expectedChunk.size, received: chunkData.length },
        { status: 400 }
      );
    }

    // Upload chunk
    const result = await enhancedVideoStreamingService.uploadChunk(
      sessionId,
      chunkIndex,
      chunkData,
      checksum
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      uploadedChunks: result.uploadedChunks,
      totalChunks: result.totalChunks,
      progress: Math.round((result.uploadedChunks! / result.totalChunks!) * 100),
      isComplete: result.uploadedChunks === result.totalChunks
    });

  } catch (error) {
    console.error('Chunk upload error:', error);
    return NextResponse.json(
      { error: 'Chunk upload failed' },
      { status: 500 }
    );
  }
}

/**
 * Handle finalize upload
 */
async function handleFinalizeUpload(req: NextRequest, userId: string) {
  try {
    const body = await req.json();
    const validatedData = finalizeUploadSchema.parse(body);

    // Validate session ownership
    const session = await enhancedVideoStreamingService.getUploadSessionStatus(validatedData.sessionId);
    if (!session || session.userId !== userId) {
      return NextResponse.json(
        { error: 'Invalid session or access denied' },
        { status: 403 }
      );
    }

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Upload not completed', status: session.status },
        { status: 400 }
      );
    }

    // Start transcoding process
    const videoId = session.videoId;
    const inputFile = `${process.env.VIDEO_STORAGE_PATH || './storage/videos'}/${videoId}.${getFileExtension(session.filename)}`;

    const transcodingResult = await transcodingService.createTranscodingJob(
      videoId,
      inputFile,
      {
        qualityProfiles: validatedData.qualityProfiles,
        formats: ['hls', 'dash', 'mp4'],
        priority: 'medium'
      }
    );

    if (!transcodingResult.success) {
      return NextResponse.json(
        { error: 'Failed to start transcoding', details: transcodingResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      videoId,
      transcodingJobId: transcodingResult.jobId,
      message: 'Upload completed, transcoding started'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    throw error;
  }
}

/**
 * GET /api/video/upload?sessionId=xxx
 * Get upload session status
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

    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    const uploadSession = await enhancedVideoStreamingService.getUploadSessionStatus(sessionId);
    if (!uploadSession || uploadSession.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      );
    }

    const uploadedChunks = uploadSession.chunks.filter(c => c.uploaded).length;
    const progress = Math.round((uploadedChunks / uploadSession.chunks.length) * 100);

    return NextResponse.json({
      success: true,
      session: {
        id: uploadSession.id,
        videoId: uploadSession.videoId,
        status: uploadSession.status,
        filename: uploadSession.filename,
        totalSize: uploadSession.totalSize,
        uploadedSize: uploadSession.uploadedSize,
        totalChunks: uploadSession.chunks.length,
        uploadedChunks,
        progress,
        expiresAt: uploadSession.expiresAt
      }
    });

  } catch (error) {
    console.error('Get upload session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/video/upload?sessionId=xxx
 * Cancel upload session
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      );
    }

    // Validate session ownership
    const uploadSession = await enhancedVideoStreamingService.getUploadSessionStatus(sessionId);
    if (!uploadSession || uploadSession.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      );
    }

    const result = await enhancedVideoStreamingService.cancelUploadSession(sessionId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Upload session cancelled'
    });

  } catch (error) {
    console.error('Cancel upload session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/video/upload/retry
 * Retry failed chunks
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { sessionId, failedChunks } = await req.json();

    if (!sessionId || !Array.isArray(failedChunks)) {
      return NextResponse.json(
        { error: 'Session ID and failed chunks required' },
        { status: 400 }
      );
    }

    // Validate session ownership
    const uploadSession = await enhancedVideoStreamingService.getUploadSessionStatus(sessionId);
    if (!uploadSession || uploadSession.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      );
    }

    // Reset failed chunks
    for (const chunkIndex of failedChunks) {
      if (chunkIndex >= 0 && chunkIndex < uploadSession.chunks.length) {
        uploadSession.chunks[chunkIndex].uploaded = false;
        uploadSession.chunks[chunkIndex].uploadedAt = undefined;
      }
    }

    // Update session in Redis
    await enhancedVideoStreamingService['redis'].setex(
      `upload:session:${sessionId}`,
      24 * 60 * 60,
      JSON.stringify(uploadSession)
    );

    return NextResponse.json({
      success: true,
      message: `Reset ${failedChunks.length} chunks for retry`
    });

  } catch (error) {
    console.error('Retry chunks error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Helper functions
 */
function getFileExtension(filename: string): string {
  return filename.slice(filename.lastIndexOf('.') + 1);
}

async function checkUserUploadQuota(userId: string, fileSize: number): Promise<{ allowed: boolean; available: number }> {
  // Implementation depends on your quota system
  // This is a placeholder
  const quotaLimit = 50 * 1024 * 1024 * 1024; // 50GB default quota
  const usedSpace = 0; // Calculate used space from database
  const available = quotaLimit - usedSpace;

  return {
    allowed: fileSize <= available,
    available
  };
}