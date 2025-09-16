import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import VideoTranscodingService from '../../services/video-transcoding.service';
import VideoStreamingService from '../../services/video-streaming.service';
import { createCloudflareCDN } from '../../../config/cdn/cloudflare-config';
import * as crypto from 'crypto';
import * as path from 'path';
import { rateLimit } from '../../middleware/rateLimiter';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../lib/logger';

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow common video formats
    const allowedTypes = [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',
      'video/webm',
      'video/ogg',
      'video/3gpp',
      'video/x-flv'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Initialize services
const gcsStorage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
});

const transcodingService = new VideoTranscodingService({
  googleCloudConfig: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
  },
  bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME!,
  redisUrl: process.env.REDIS_URL!,
  tempDir: '/tmp/video-processing',
  maxConcurrentJobs: 3
});

const streamingService = new VideoStreamingService({
  googleCloudConfig: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
  },
  bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME!,
  redisUrl: process.env.REDIS_URL!,
  cdnBaseUrl: process.env.CDN_BASE_URL!,
  jwtSecret: process.env.JWT_SECRET!
});

const cloudflareService = createCloudflareCDN({
  zoneId: process.env.CLOUDFLARE_ZONE_ID!,
  apiToken: process.env.CLOUDFLARE_API_TOKEN!,
  zoneName: process.env.CLOUDFLARE_ZONE_NAME!,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  streamDomain: process.env.CLOUDFLARE_STREAM_DOMAIN
});

interface VideoUploadRequest extends NextApiRequest {
  file?: Express.Multer.File;
  user?: {
    id: string;
    role: string;
  };
}

interface VideoUploadResponse {
  success: boolean;
  data?: {
    videoId: string;
    uploadUrl?: string;
    transcodingJobId: string;
    streamingToken: string;
    estimatedProcessingTime: number;
  };
  error?: string;
}

/**
 * Handle video upload with multiple strategies
 */
async function handleVideoUpload(req: VideoUploadRequest, res: NextApiResponse<VideoUploadResponse>) {
  try {
    const { uploadMethod = 'direct', title, description, courseId, lessonId, quality = '1080p', isPrivate = false } = req.body;
    const userId = req.user!.id;

    // Validate required fields
    if (!title || !courseId) {
      return res.status(400).json({
        success: false,
        error: 'Title and courseId are required'
      });
    }

    // Generate unique video ID
    const videoId = `video_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    switch (uploadMethod) {
      case 'direct':
        return await handleDirectUpload(req, res, { videoId, userId, title, description, courseId, lessonId, quality, isPrivate });

      case 'cloudflare':
        return await handleCloudflareUpload(req, res, { videoId, userId, title, description, courseId, lessonId, quality, isPrivate });

      case 'resumable':
        return await handleResumableUpload(req, res, { videoId, userId, title, description, courseId, lessonId, quality, isPrivate });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid upload method'
        });
    }
  } catch (error) {
    logger.error('Video upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during video upload'
    });
  }
}

/**
 * Direct upload to Google Cloud Storage with immediate transcoding
 */
async function handleDirectUpload(
  req: VideoUploadRequest,
  res: NextApiResponse<VideoUploadResponse>,
  metadata: any
): Promise<void> {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided'
      });
    }

    const { videoId, userId, title, description, courseId, lessonId, quality, isPrivate } = metadata;
    const fileName = `uploads/${videoId}/${req.file.originalname}`;

    // Upload to Google Cloud Storage
    const bucket = gcsStorage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          videoId,
          userId,
          title,
          description,
          courseId,
          lessonId: lessonId || null,
          uploadedAt: new Date().toISOString(),
          isPrivate: isPrivate.toString()
        }
      }
    });

    // Get GCS file path for transcoding
    const gcsPath = `gs://${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${fileName}`;

    // Submit transcoding job
    const qualityLevels = getQualityLevels(quality);
    const transcodingJob = await transcodingService.submitTranscodingJob(
      videoId,
      userId,
      gcsPath,
      qualityLevels
    );

    // Generate streaming token
    const streamingToken = streamingService.generateStreamingToken(videoId, userId, {
      expiresIn: 86400, // 24 hours
      maxSessions: 5
    });

    // Estimate processing time based on file size
    const estimatedProcessingTime = Math.ceil(req.file.size / (1024 * 1024 * 10)); // ~10MB per minute

    // Store video metadata in database
    await storeVideoMetadata({
      videoId,
      userId,
      title,
      description,
      courseId,
      lessonId,
      fileName,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      status: 'processing',
      transcodingJobId: transcodingJob.id,
      isPrivate,
      createdAt: new Date()
    });

    res.status(200).json({
      success: true,
      data: {
        videoId,
        transcodingJobId: transcodingJob.id,
        streamingToken,
        estimatedProcessingTime
      }
    });

  } catch (error) {
    logger.error('Direct upload error:', error);
    throw error;
  }
}

/**
 * Upload using Cloudflare Stream for instant delivery
 */
async function handleCloudflareUpload(
  req: VideoUploadRequest,
  res: NextApiResponse<VideoUploadResponse>,
  metadata: any
): Promise<void> {
  try {
    const { videoId, userId, title, description, courseId, lessonId, isPrivate } = metadata;

    // Create Cloudflare Stream upload URL
    const streamUpload = await cloudflareService.createStreamUploadUrl({
      maxDurationSeconds: 7200, // 2 hours max
      requireSignedUrls: true,
      allowedOrigins: [process.env.FRONTEND_URL!],
      thumbnailTimestampPct: 0.1
    });

    // Store video metadata with Cloudflare Stream ID
    await storeVideoMetadata({
      videoId,
      userId,
      title,
      description,
      courseId,
      lessonId,
      cloudflareStreamId: streamUpload.uid,
      status: 'uploading',
      isPrivate,
      createdAt: new Date()
    });

    // Generate streaming token
    const streamingToken = streamingService.generateStreamingToken(videoId, userId, {
      expiresIn: 86400, // 24 hours
      maxSessions: 5
    });

    res.status(200).json({
      success: true,
      data: {
        videoId,
        uploadUrl: streamUpload.uploadUrl,
        transcodingJobId: 'cloudflare-stream',
        streamingToken,
        estimatedProcessingTime: 5 // Cloudflare Stream processes quickly
      }
    });

  } catch (error) {
    logger.error('Cloudflare upload error:', error);
    throw error;
  }
}

/**
 * Resumable upload for large files
 */
async function handleResumableUpload(
  req: VideoUploadRequest,
  res: NextApiResponse<VideoUploadResponse>,
  metadata: any
): Promise<void> {
  try {
    const { videoId, userId, title, description, courseId, lessonId, quality, isPrivate } = metadata;
    const fileName = `uploads/${videoId}/video`;

    // Create resumable upload session with Google Cloud Storage
    const bucket = gcsStorage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);
    const file = bucket.file(fileName);

    const [uploadUrl] = await file.createResumableUpload({
      metadata: {
        metadata: {
          videoId,
          userId,
          title,
          description,
          courseId,
          lessonId: lessonId || null,
          uploadedAt: new Date().toISOString(),
          isPrivate: isPrivate.toString()
        }
      }
    });

    // Store video metadata
    await storeVideoMetadata({
      videoId,
      userId,
      title,
      description,
      courseId,
      lessonId,
      fileName,
      status: 'uploading',
      resumableUploadUrl: uploadUrl,
      isPrivate,
      createdAt: new Date()
    });

    // Generate streaming token
    const streamingToken = streamingService.generateStreamingToken(videoId, userId, {
      expiresIn: 86400, // 24 hours
      maxSessions: 5
    });

    res.status(200).json({
      success: true,
      data: {
        videoId,
        uploadUrl,
        transcodingJobId: 'pending-upload',
        streamingToken,
        estimatedProcessingTime: 0 // Will be calculated after upload
      }
    });

  } catch (error) {
    logger.error('Resumable upload error:', error);
    throw error;
  }
}

/**
 * Handle resumable upload completion
 */
async function handleResumableUploadComplete(req: VideoUploadRequest, res: NextApiResponse) {
  try {
    const { videoId } = req.body;
    const userId = req.user!.id;

    // Get video metadata
    const videoMetadata = await getVideoMetadata(videoId);
    if (!videoMetadata || videoMetadata.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    if (videoMetadata.status !== 'uploading') {
      return res.status(400).json({
        success: false,
        error: 'Video is not in uploading state'
      });
    }

    // Check if file exists in GCS
    const bucket = gcsStorage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);
    const file = bucket.file(videoMetadata.fileName);
    const [exists] = await file.exists();

    if (!exists) {
      return res.status(400).json({
        success: false,
        error: 'Upload not completed'
      });
    }

    // Submit transcoding job
    const gcsPath = `gs://${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${videoMetadata.fileName}`;
    const qualityLevels = getQualityLevels(videoMetadata.quality || '1080p');

    const transcodingJob = await transcodingService.submitTranscodingJob(
      videoId,
      userId,
      gcsPath,
      qualityLevels
    );

    // Update video metadata
    await updateVideoMetadata(videoId, {
      status: 'processing',
      transcodingJobId: transcodingJob.id
    });

    res.status(200).json({
      success: true,
      data: {
        transcodingJobId: transcodingJob.id,
        status: 'processing'
      }
    });

  } catch (error) {
    logger.error('Upload completion error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Get video upload progress
 */
async function getUploadProgress(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { videoId } = req.query;
    const userId = (req as any).user.id;

    // Get video metadata
    const videoMetadata = await getVideoMetadata(videoId as string);
    if (!videoMetadata || videoMetadata.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    let progress = {
      status: videoMetadata.status,
      progress: 0,
      message: 'Initializing...'
    };

    if (videoMetadata.transcodingJobId && videoMetadata.transcodingJobId !== 'pending-upload') {
      // Get transcoding progress
      const job = await transcodingService.getJobStatus(videoMetadata.transcodingJobId);
      if (job) {
        progress = {
          status: job.status,
          progress: job.progress,
          message: getProgressMessage(job.status, job.progress)
        };
      }
    } else if (videoMetadata.cloudflareStreamId) {
      // Check Cloudflare Stream status
      try {
        const streamVideo = await cloudflareService.getStreamVideo(videoMetadata.cloudflareStreamId);
        progress = {
          status: streamVideo.status.state,
          progress: streamVideo.status.pctComplete || 0,
          message: `Processing: ${streamVideo.status.state}`
        };
      } catch (error) {
        logger.error('Failed to get Cloudflare Stream status:', error);
      }
    }

    res.status(200).json({
      success: true,
      data: progress
    });

  } catch (error) {
    logger.error('Progress check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * Cancel video upload or processing
 */
async function cancelVideoUpload(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { videoId } = req.body;
    const userId = (req as any).user.id;

    const videoMetadata = await getVideoMetadata(videoId);
    if (!videoMetadata || videoMetadata.userId !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    // Cancel transcoding job if exists
    if (videoMetadata.transcodingJobId && videoMetadata.transcodingJobId !== 'pending-upload') {
      // Implementation would depend on your job queue system
      // For now, just mark as cancelled in metadata
    }

    // Clean up uploaded files
    try {
      const bucket = gcsStorage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);
      await bucket.deleteFiles({
        prefix: `uploads/${videoId}/`
      });
    } catch (cleanupError) {
      logger.error('Failed to cleanup files:', cleanupError);
    }

    // Update status
    await updateVideoMetadata(videoId, {
      status: 'cancelled'
    });

    res.status(200).json({
      success: true,
      message: 'Video upload cancelled'
    });

  } catch (error) {
    logger.error('Cancel upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// Helper functions

function getQualityLevels(quality: string): string[] {
  const qualityMap: { [key: string]: string[] } = {
    '4k': ['2160p', '1440p', '1080p', '720p', '480p', '360p'],
    '1440p': ['1440p', '1080p', '720p', '480p', '360p'],
    '1080p': ['1080p', '720p', '480p', '360p'],
    '720p': ['720p', '480p', '360p'],
    '480p': ['480p', '360p'],
    '360p': ['360p']
  };

  return qualityMap[quality] || qualityMap['1080p'];
}

function getProgressMessage(status: string, progress: number): string {
  switch (status) {
    case 'pending':
      return 'Waiting in queue...';
    case 'processing':
      if (progress < 30) return 'Analyzing video...';
      if (progress < 90) return 'Transcoding video...';
      return 'Finalizing...';
    case 'completed':
      return 'Processing complete!';
    case 'failed':
      return 'Processing failed';
    default:
      return 'Processing...';
  }
}

// Mock database functions - replace with actual implementation
async function storeVideoMetadata(metadata: any): Promise<void> {
  // Store in your database (PostgreSQL, MongoDB, etc.)
  logger.info('Storing video metadata:', metadata);
}

async function getVideoMetadata(videoId: string): Promise<any> {
  // Retrieve from your database
  logger.info('Getting video metadata for:', videoId);
  return null; // Replace with actual database query
}

async function updateVideoMetadata(videoId: string, updates: any): Promise<void> {
  // Update in your database
  logger.info('Updating video metadata:', videoId, updates);
}

// API route handler with middleware
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  await rateLimit(req, res);

  // Apply authentication
  await authenticate(req, res);

  if (req.method === 'POST') {
    if (req.url?.includes('/complete')) {
      return handleResumableUploadComplete(req as VideoUploadRequest, res);
    } else if (req.url?.includes('/cancel')) {
      return cancelVideoUpload(req, res);
    } else {
      // Handle file upload with multer
      upload.single('video')(req as any, res as any, (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            error: err.message
          });
        }
        return handleVideoUpload(req as VideoUploadRequest, res);
      });
    }
  } else if (req.method === 'GET') {
    return getUploadProgress(req, res);
  } else {
    res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
}

// Disable Next.js body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};