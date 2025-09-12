import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream, statSync } from 'fs';
import db from '@/lib/db';

export interface VideoStreamConfig {
  enableTranscoding: boolean;
  supportedFormats: string[];
  qualityLevels: QualityLevel[];
  enableAdaptiveStreaming: boolean;
  chunkDuration: number; // in seconds
  secureStreaming: boolean;
  allowDownload: boolean;
}

export interface QualityLevel {
  name: string;
  resolution: string;
  bitrate: number;
  fps: number;
}

export interface VideoMetadata {
  id: string;
  originalFilename: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  bitrate: number;
  fps: number;
  size: number;
  createdAt: Date;
  processedAt?: Date;
  status: 'processing' | 'ready' | 'error';
  qualityVariants?: VideoVariant[];
}

export interface VideoVariant {
  quality: string;
  resolution: string;
  bitrate: number;
  url: string;
  size: number;
}

export interface StreamingToken {
  videoId: string;
  userId: string;
  expiresAt: Date;
  permissions: string[];
  token: string;
}

export interface WatchProgress {
  userId: string;
  videoId: string;
  position: number; // in seconds
  duration: number;
  completed: boolean;
  lastWatched: Date;
}

class VideoStreamingService {
  private readonly streamingConfig: VideoStreamConfig = {
    enableTranscoding: true,
    supportedFormats: ['mp4', 'webm', 'mov', 'avi'],
    qualityLevels: [
      { name: '240p', resolution: '426x240', bitrate: 400, fps: 24 },
      { name: '360p', resolution: '640x360', bitrate: 800, fps: 24 },
      { name: '480p', resolution: '854x480', bitrate: 1200, fps: 30 },
      { name: '720p', resolution: '1280x720', bitrate: 2500, fps: 30 },
      { name: '1080p', resolution: '1920x1080', bitrate: 5000, fps: 30 },
    ],
    enableAdaptiveStreaming: true,
    chunkDuration: 10,
    secureStreaming: true,
    allowDownload: false,
  };

  private readonly videoBasePath = process.env.VIDEO_STORAGE_PATH || './storage/videos';
  private readonly publicVideoUrl = process.env.PUBLIC_VIDEO_URL || '/api/videos/stream';

  /**
   * Process uploaded video for streaming
   */
  async processVideoForStreaming(
    videoFileId: string,
    courseId?: string,
    lessonId?: string
  ): Promise<{ success: boolean; videoId?: string; error?: string }> {
    try {
      const mediaFile = await db.mediaFile.findUnique({
        where: { id: videoFileId },
      });

      if (!mediaFile) {
        return { success: false, error: 'Video file not found' };
      }

      // Create video record
      const video = await db.video.create({
        data: {
          id: crypto.randomUUID(),
          mediaFileId: videoFileId,
          courseId,
          lessonId,
          originalFilename: mediaFile.originalName,
          status: 'processing',
          metadata: {
            originalSize: mediaFile.size,
            originalFormat: mediaFile.mimeType,
            uploadedAt: mediaFile.createdAt,
          }
        }
      });

      // Start async processing
      this.processVideoAsync(video.id, mediaFile).catch(error => {
        console.error(`Video processing failed for ${video.id}:`, error);
      });

      return { success: true, videoId: video.id };

    } catch (error) {
      console.error('Video processing initiation failed:', error);
      return { success: false, error: 'Processing initiation failed' };
    }
  }

  /**
   * Generate secure streaming token
   */
  async generateStreamingToken(
    videoId: string,
    userId: string,
    permissions: string[] = ['view']
  ): Promise<{ success: boolean; token?: string; expiresAt?: Date; error?: string }> {
    try {
      // Verify user has access to the video
      const hasAccess = await this.verifyVideoAccess(videoId, userId);
      if (!hasAccess) {
        return { success: false, error: 'Access denied' };
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store token
      await db.videoStreamingToken.create({
        data: {
          token,
          videoId,
          userId,
          permissions,
          expiresAt,
          metadata: {
            generatedAt: new Date(),
            clientInfo: 'web', // Could be enhanced with actual client info
          }
        }
      });

      return { success: true, token, expiresAt };

    } catch (error) {
      console.error('Token generation failed:', error);
      return { success: false, error: 'Token generation failed' };
    }
  }

  /**
   * Create streaming manifest (for adaptive streaming)
   */
  async createStreamingManifest(videoId: string, token: string): Promise<{
    success: boolean;
    manifest?: string;
    error?: string;
  }> {
    try {
      // Validate token
      const tokenValid = await this.validateStreamingToken(token, videoId);
      if (!tokenValid) {
        return { success: false, error: 'Invalid or expired token' };
      }

      const video = await db.video.findUnique({
        where: { id: videoId },
        include: { mediaFile: true }
      });

      if (!video || video.status !== 'ready') {
        return { success: false, error: 'Video not ready' };
      }

      // Generate HLS manifest
      const manifest = this.generateHLSManifest(video);

      return { success: true, manifest };

    } catch (error) {
      console.error('Manifest generation failed:', error);
      return { success: false, error: 'Manifest generation failed' };
    }
  }

  /**
   * Stream video chunk
   */
  async streamVideoChunk(
    videoId: string,
    quality: string,
    chunkIndex: number,
    token: string
  ): Promise<{ success: boolean; stream?: NodeJS.ReadableStream; headers?: Record<string, string>; error?: string }> {
    try {
      // Validate token
      const tokenValid = await this.validateStreamingToken(token, videoId);
      if (!tokenValid) {
        return { success: false, error: 'Invalid or expired token' };
      }

      const video = await db.video.findUnique({
        where: { id: videoId }
      });

      if (!video || video.status !== 'ready') {
        return { success: false, error: 'Video not ready' };
      }

      // Get chunk path
      const chunkPath = this.getChunkPath(videoId, quality, chunkIndex);
      const chunkExists = await this.fileExists(chunkPath);

      if (!chunkExists) {
        return { success: false, error: 'Chunk not found' };
      }

      // Create stream
      const stream = createReadStream(chunkPath);
      const stats = statSync(chunkPath);

      const headers = {
        'Content-Type': 'video/mp2t', // For HLS
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000',
        'Accept-Ranges': 'bytes',
      };

      return { success: true, stream, headers };

    } catch (error) {
      console.error('Video chunk streaming failed:', error);
      return { success: false, error: 'Streaming failed' };
    }
  }

  /**
   * Track video watch progress
   */
  async updateWatchProgress(
    userId: string,
    videoId: string,
    position: number,
    duration: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const completed = position >= duration * 0.9; // 90% completion

      await db.videoWatchProgress.upsert({
        where: {
          userId_videoId: { userId, videoId }
        },
        update: {
          position,
          duration,
          completed,
          lastWatched: new Date(),
        },
        create: {
          userId,
          videoId,
          position,
          duration,
          completed,
          lastWatched: new Date(),
        }
      });

      // Log analytics
      await this.logVideoAnalytics(userId, videoId, 'PROGRESS_UPDATE', {
        position,
        duration,
        completed,
        watchPercentage: (position / duration) * 100,
      });

      return { success: true };

    } catch (error) {
      console.error('Watch progress update failed:', error);
      return { success: false, error: 'Progress update failed' };
    }
  }

  /**
   * Get video metadata
   */
  async getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
    try {
      const video = await db.video.findUnique({
        where: { id: videoId },
        include: { mediaFile: true }
      });

      if (!video) return null;

      return {
        id: video.id,
        originalFilename: video.originalFilename,
        duration: video.metadata?.duration || 0,
        width: video.metadata?.width || 0,
        height: video.metadata?.height || 0,
        format: video.metadata?.format || '',
        bitrate: video.metadata?.bitrate || 0,
        fps: video.metadata?.fps || 0,
        size: video.mediaFile?.size || 0,
        createdAt: video.createdAt,
        processedAt: video.processedAt || undefined,
        status: video.status as 'processing' | 'ready' | 'error',
        qualityVariants: video.metadata?.qualityVariants as VideoVariant[] || [],
      };

    } catch (error) {
      console.error('Get video metadata failed:', error);
      return null;
    }
  }

  /**
   * Get user watch progress
   */
  async getUserWatchProgress(userId: string, videoId: string): Promise<WatchProgress | null> {
    try {
      const progress = await db.videoWatchProgress.findUnique({
        where: {
          userId_videoId: { userId, videoId }
        }
      });

      if (!progress) return null;

      return {
        userId: progress.userId,
        videoId: progress.videoId,
        position: progress.position,
        duration: progress.duration,
        completed: progress.completed,
        lastWatched: progress.lastWatched,
      };

    } catch (error) {
      console.error('Get watch progress failed:', error);
      return null;
    }
  }

  /**
   * Get video analytics
   */
  async getVideoAnalytics(videoId: string, timeframe: 'day' | 'week' | 'month' = 'week'): Promise<{
    totalViews: number;
    uniqueViewers: number;
    avgWatchTime: number;
    completionRate: number;
    qualityDistribution: Record<string, number>;
  }> {
    try {
      const now = new Date();
      let startDate: Date;

      switch (timeframe) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      const [analytics, progress] = await Promise.all([
        db.analyticsEvent.findMany({
          where: {
            entityId: videoId,
            eventType: { in: ['VIDEO_VIEW', 'PROGRESS_UPDATE'] },
            timestamp: { gte: startDate }
          }
        }),
        db.videoWatchProgress.findMany({
          where: { videoId }
        })
      ]);

      const totalViews = analytics.filter(e => e.eventType === 'VIDEO_VIEW').length;
      const uniqueViewers = new Set(analytics.map(e => e.userId).filter(Boolean)).size;
      
      const avgWatchTime = progress.length > 0 
        ? progress.reduce((sum, p) => sum + p.position, 0) / progress.length
        : 0;

      const completionRate = progress.length > 0
        ? (progress.filter(p => p.completed).length / progress.length) * 100
        : 0;

      // Mock quality distribution - would be tracked in real implementation
      const qualityDistribution = {
        '720p': 40,
        '480p': 35,
        '1080p': 20,
        '360p': 5,
      };

      return {
        totalViews,
        uniqueViewers,
        avgWatchTime: Math.round(avgWatchTime),
        completionRate: Math.round(completionRate * 100) / 100,
        qualityDistribution,
      };

    } catch (error) {
      console.error('Get video analytics failed:', error);
      return {
        totalViews: 0,
        uniqueViewers: 0,
        avgWatchTime: 0,
        completionRate: 0,
        qualityDistribution: {},
      };
    }
  }

  private async processVideoAsync(videoId: string, mediaFile: any): Promise<void> {
    try {
      // This would typically use FFmpeg for actual video processing
      // For now, we'll simulate the process
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate processing

      // Extract video metadata (would use FFprobe in real implementation)
      const metadata = {
        duration: 3600, // 1 hour - mock value
        width: 1920,
        height: 1080,
        format: 'mp4',
        bitrate: 5000,
        fps: 30,
        qualityVariants: this.streamingConfig.qualityLevels.map(level => ({
          quality: level.name,
          resolution: level.resolution,
          bitrate: level.bitrate,
          url: `${this.publicVideoUrl}/${videoId}/${level.name}/playlist.m3u8`,
          size: Math.round(mediaFile.size * (level.bitrate / 5000)), // Estimated size
        }))
      };

      // Update video status
      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'ready',
          processedAt: new Date(),
          metadata,
        }
      });

      console.log(`Video processing completed for ${videoId}`);

    } catch (error) {
      console.error(`Video processing failed for ${videoId}:`, error);
      
      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'error',
          metadata: { error: error.message }
        }
      });
    }
  }

  private async verifyVideoAccess(videoId: string, userId: string): Promise<boolean> {
    try {
      const video = await db.video.findUnique({
        where: { id: videoId },
        include: {
          course: {
            include: {
              enrollments: {
                where: { userId }
              }
            }
          }
        }
      });

      if (!video) return false;

      // Check if user is enrolled in the course
      if (video.course && video.course.enrollments.length === 0) {
        return false;
      }

      // Additional access checks could be added here
      return true;

    } catch (error) {
      console.error('Video access verification failed:', error);
      return false;
    }
  }

  private async validateStreamingToken(token: string, videoId: string): Promise<boolean> {
    try {
      const tokenRecord = await db.videoStreamingToken.findFirst({
        where: {
          token,
          videoId,
          expiresAt: { gt: new Date() }
        }
      });

      return !!tokenRecord;

    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  private generateHLSManifest(video: any): string {
    const qualityVariants = video.metadata?.qualityVariants || [];
    
    let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    for (const variant of qualityVariants) {
      manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bitrate * 1000},RESOLUTION=${variant.resolution}\n`;
      manifest += `${variant.quality}/playlist.m3u8\n`;
    }

    return manifest;
  }

  private getChunkPath(videoId: string, quality: string, chunkIndex: number): string {
    return path.join(this.videoBasePath, videoId, quality, `chunk_${chunkIndex.toString().padStart(6, '0')}.ts`);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async logVideoAnalytics(userId: string, videoId: string, eventType: string, data: Record<string, any>): Promise<void> {
    try {
      await db.analyticsEvent.create({
        data: {
          userId,
          eventType,
          entityType: 'video',
          entityId: videoId,
          properties: data,
          timestamp: new Date(),
        }
      });
    } catch (error) {
      console.error('Failed to log video analytics:', error);
    }
  }
}

export const videoStreamingService = new VideoStreamingService();