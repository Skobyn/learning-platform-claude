import { PrismaClient } from '@prisma/client';
import { MediaFile } from '../types';
import { ValidationError, NotFoundError } from '../utils/errors';
import logger from '../utils/logger';
import AWS from 'aws-sdk';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'learning-platform-media';

export class MediaService {
  /**
   * Upload file to cloud storage
   */
  async uploadFile(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string,
    folder?: string
  ): Promise<MediaFile> {
    try {
      logger.info('Uploading file', { 
        originalName: file.originalname, 
        size: file.size,
        mimeType: file.mimetype 
      });

      // Validate file
      this.validateFile(file);

      // Generate unique filename
      const fileExtension = path.extname(file.originalname);
      const filename = `${uuidv4()}${fileExtension}`;
      const key = folder ? `${folder}/${filename}` : filename;

      // Process file based on type
      let processedBuffer = file.buffer;
      if (this.isImage(file.mimetype)) {
        processedBuffer = await this.processImage(file.buffer, file.mimetype);
      } else if (this.isVideo(file.mimetype)) {
        // For videos, we might want to generate thumbnails
        await this.generateVideoThumbnail(file.buffer, filename);
      }

      // Upload to S3
      const uploadResult = await s3.upload({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: processedBuffer,
        ContentType: file.mimetype,
        ACL: 'public-read'
      }).promise();

      // Save to database
      const mediaFile = await prisma.mediaFile.create({
        data: {
          filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: uploadResult.Location,
          uploadedBy: userId
        }
      });

      logger.info('File uploaded successfully', { 
        mediaFileId: mediaFile.id, 
        url: uploadResult.Location 
      });

      return mediaFile as MediaFile;
    } catch (error) {
      logger.error('Error uploading file', { originalName: file.originalname, error });
      throw new ValidationError('Failed to upload file');
    }
  }

  /**
   * Get file by ID
   */
  async getFileById(fileId: string): Promise<MediaFile> {
    try {
      const file = await prisma.mediaFile.findUnique({
        where: { id: fileId }
      });

      if (!file) {
        throw new NotFoundError('File not found');
      }

      return file as MediaFile;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Error fetching file', { fileId, error });
      throw new ValidationError('Failed to fetch file');
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    try {
      logger.info('Deleting file', { fileId, userId });

      const file = await this.getFileById(fileId);

      // Check if user has permission to delete (owner or admin)
      if (file.uploadedBy !== userId) {
        // In a real app, check if user is admin
        throw new ValidationError('Permission denied');
      }

      // Delete from S3
      const key = this.extractKeyFromUrl(file.url);
      await s3.deleteObject({
        Bucket: BUCKET_NAME,
        Key: key
      }).promise();

      // Delete from database
      await prisma.mediaFile.delete({
        where: { id: fileId }
      });

      logger.info('File deleted successfully', { fileId });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
      logger.error('Error deleting file', { fileId, error });
      throw new ValidationError('Failed to delete file');
    }
  }

  /**
   * Get user's uploaded files
   */
  async getUserFiles(
    userId: string, 
    page = 1, 
    limit = 20,
    mimeType?: string
  ): Promise<{
    files: MediaFile[];
    total: number;
    totalPages: number;
  }> {
    try {
      const skip = (page - 1) * limit;
      const where: any = { uploadedBy: userId };
      
      if (mimeType) {
        where.mimeType = { startsWith: mimeType };
      }

      const [files, total] = await Promise.all([
        prisma.mediaFile.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.mediaFile.count({ where })
      ]);

      return {
        files: files as MediaFile[],
        total,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      logger.error('Error fetching user files', { userId, error });
      throw new ValidationError('Failed to fetch user files');
    }
  }

  /**
   * Generate signed URL for private file access
   */
  async getSignedUrl(fileId: string, expiresIn = 3600): Promise<string> {
    try {
      const file = await this.getFileById(fileId);
      const key = this.extractKeyFromUrl(file.url);

      const signedUrl = await s3.getSignedUrlPromise('getObject', {
        Bucket: BUCKET_NAME,
        Key: key,
        Expires: expiresIn
      });

      return signedUrl;
    } catch (error) {
      logger.error('Error generating signed URL', { fileId, error });
      throw new ValidationError('Failed to generate signed URL');
    }
  }

  /**
   * Process video for streaming
   */
  async processVideoForStreaming(fileId: string): Promise<{
    hls: string;
    dash: string;
    thumbnails: string[];
  }> {
    try {
      logger.info('Processing video for streaming', { fileId });

      const file = await this.getFileById(fileId);
      
      if (!this.isVideo(file.mimeType)) {
        throw new ValidationError('File is not a video');
      }

      // Download original file
      const originalBuffer = await this.downloadFile(file.url);
      
      // Generate different quality versions
      const qualities = [
        { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
        { name: '480p', width: 854, height: 480, bitrate: '1500k' },
        { name: '360p', width: 640, height: 360, bitrate: '800k' }
      ];

      const processedVersions: string[] = [];
      
      for (const quality of qualities) {
        const processedBuffer = await this.transcodeVideo(
          originalBuffer, 
          quality.width, 
          quality.height, 
          quality.bitrate
        );
        
        const processedKey = `processed/${fileId}/${quality.name}.mp4`;
        const uploadResult = await s3.upload({
          Bucket: BUCKET_NAME,
          Key: processedKey,
          Body: processedBuffer,
          ContentType: 'video/mp4'
        }).promise();
        
        processedVersions.push(uploadResult.Location);
      }

      // Generate HLS playlist
      const hlsUrl = await this.generateHLSPlaylist(fileId, processedVersions);
      
      // Generate DASH manifest
      const dashUrl = await this.generateDASHManifest(fileId, processedVersions);
      
      // Generate video thumbnails
      const thumbnails = await this.generateVideoThumbnails(originalBuffer, fileId);

      logger.info('Video processing completed', { fileId, hlsUrl, dashUrl });

      return {
        hls: hlsUrl,
        dash: dashUrl,
        thumbnails
      };
    } catch (error) {
      logger.error('Error processing video', { fileId, error });
      throw new ValidationError('Failed to process video');
    }
  }

  /**
   * Generate video thumbnail
   */
  async generateVideoThumbnail(videoBuffer: Buffer, filename: string): Promise<string> {
    try {
      const thumbnailPath = `/tmp/${filename}_thumbnail.jpg`;
      const videoPath = `/tmp/${filename}_temp`;
      
      // Write video buffer to temp file
      await fs.writeFile(videoPath, videoBuffer);
      
      // Generate thumbnail using ffmpeg
      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: ['10%'],
            filename: 'thumbnail.jpg',
            folder: '/tmp',
            size: '320x240'
          })
          .on('end', async () => {
            try {
              // Upload thumbnail to S3
              const thumbnailBuffer = await fs.readFile(thumbnailPath);
              const key = `thumbnails/${filename}_thumbnail.jpg`;
              
              const uploadResult = await s3.upload({
                Bucket: BUCKET_NAME,
                Key: key,
                Body: thumbnailBuffer,
                ContentType: 'image/jpeg'
              }).promise();
              
              // Cleanup temp files
              await fs.unlink(videoPath).catch(() => {});
              await fs.unlink(thumbnailPath).catch(() => {});
              
              resolve(uploadResult.Location);
            } catch (error) {
              reject(error);
            }
          })
          .on('error', reject);
      });
    } catch (error) {
      logger.error('Error generating video thumbnail', error);
      throw error;
    }
  }

  /**
   * Resize and optimize image
   */
  async processImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
    try {
      let pipeline = sharp(buffer);
      
      // Resize if image is too large
      const metadata = await pipeline.metadata();
      if (metadata.width && metadata.width > 2048) {
        pipeline = pipeline.resize(2048, null, {
          withoutEnlargement: true,
          fit: 'inside'
        });
      }

      // Convert to appropriate format and optimize
      if (mimeType === 'image/jpeg') {
        pipeline = pipeline.jpeg({ quality: 85, progressive: true });
      } else if (mimeType === 'image/png') {
        pipeline = pipeline.png({ compressionLevel: 8 });
      } else if (mimeType === 'image/webp') {
        pipeline = pipeline.webp({ quality: 85 });
      }

      return await pipeline.toBuffer();
    } catch (error) {
      logger.error('Error processing image', error);
      throw error;
    }
  }

  /**
   * Get media analytics
   */
  async getMediaAnalytics(timeframe: 'week' | 'month' | 'year' = 'month'): Promise<{
    totalFiles: number;
    totalSize: number;
    filesByType: Record<string, number>;
    uploadTrend: Array<{ date: string; uploads: number }>;
    topUploaders: Array<{ userId: string; fileCount: number }>;
    storageUsage: {
      images: number;
      videos: number;
      documents: number;
      others: number;
    };
  }> {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe);

      const [files, filesByType] = await Promise.all([
        prisma.mediaFile.findMany({
          where: { createdAt: { gte: startDate } }
        }),
        prisma.mediaFile.groupBy({
          by: ['mimeType'],
          where: { createdAt: { gte: startDate } },
          _count: true,
          _sum: { size: true }
        })
      ]);

      const totalFiles = files.length;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);

      // Process file types
      const fileTypes: Record<string, number> = {};
      filesByType.forEach(item => {
        const category = this.getFileCategory(item.mimeType);
        fileTypes[category] = (fileTypes[category] || 0) + item._count;
      });

      // Get upload trend
      const uploadTrend = this.calculateUploadTrend(files);

      // Get top uploaders
      const uploaderCounts = files.reduce((acc: Record<string, number>, file) => {
        acc[file.uploadedBy] = (acc[file.uploadedBy] || 0) + 1;
        return acc;
      }, {});

      const topUploaders = Object.entries(uploaderCounts)
        .map(([userId, fileCount]) => ({ userId, fileCount }))
        .sort((a, b) => b.fileCount - a.fileCount)
        .slice(0, 10);

      // Calculate storage usage by category
      const storageUsage = filesByType.reduce(
        (acc, item) => {
          const category = this.getFileCategory(item.mimeType);
          const size = item._sum.size || 0;
          
          switch (category) {
            case 'image':
              acc.images += size;
              break;
            case 'video':
              acc.videos += size;
              break;
            case 'document':
              acc.documents += size;
              break;
            default:
              acc.others += size;
          }
          
          return acc;
        },
        { images: 0, videos: 0, documents: 0, others: 0 }
      );

      return {
        totalFiles,
        totalSize,
        filesByType: fileTypes,
        uploadTrend,
        topUploaders,
        storageUsage
      };
    } catch (error) {
      logger.error('Error fetching media analytics', error);
      throw new ValidationError('Failed to fetch media analytics');
    }
  }

  // Helper methods

  private validateFile(file: { size: number; mimetype: string }): void {
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    const ALLOWED_TYPES = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/mov',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (file.size > MAX_FILE_SIZE) {
      throw new ValidationError(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new ValidationError('File type not allowed');
    }
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private isVideo(mimeType: string): boolean {
    return mimeType.startsWith('video/');
  }

  private extractKeyFromUrl(url: string): string {
    return url.split('/').slice(3).join('/');
  }

  private async downloadFile(url: string): Promise<Buffer> {
    const key = this.extractKeyFromUrl(url);
    const result = await s3.getObject({
      Bucket: BUCKET_NAME,
      Key: key
    }).promise();
    
    return result.Body as Buffer;
  }

  private async transcodeVideo(
    buffer: Buffer, 
    width: number, 
    height: number, 
    bitrate: string
  ): Promise<Buffer> {
    const inputPath = `/tmp/input_${Date.now()}.mp4`;
    const outputPath = `/tmp/output_${Date.now()}.mp4`;
    
    try {
      await fs.writeFile(inputPath, buffer);
      
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .size(`${width}x${height}`)
          .videoBitrate(bitrate)
          .output(outputPath)
          .on('end', async () => {
            try {
              const result = await fs.readFile(outputPath);
              await fs.unlink(inputPath).catch(() => {});
              await fs.unlink(outputPath).catch(() => {});
              resolve(result);
            } catch (error) {
              reject(error);
            }
          })
          .on('error', reject)
          .run();
      });
    } catch (error) {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
      throw error;
    }
  }

  private async generateHLSPlaylist(fileId: string, versions: string[]): Promise<string> {
    // Generate HLS master playlist
    const playlistContent = versions.map((url, index) => {
      const qualities = ['720', '480', '360'];
      const bitrates = ['2500000', '1500000', '800000'];
      
      return `#EXT-X-STREAM-INF:BANDWIDTH=${bitrates[index]},RESOLUTION=${qualities[index] === '720' ? '1280x720' : qualities[index] === '480' ? '854x480' : '640x360'}\n${url}`;
    }).join('\n');

    const playlist = `#EXTM3U\n#EXT-X-VERSION:3\n${playlistContent}`;
    
    const key = `playlists/${fileId}/master.m3u8`;
    const uploadResult = await s3.upload({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: playlist,
      ContentType: 'application/vnd.apple.mpegurl'
    }).promise();

    return uploadResult.Location;
  }

  private async generateDASHManifest(fileId: string, versions: string[]): Promise<string> {
    // Simplified DASH manifest generation
    const key = `manifests/${fileId}/manifest.mpd`;
    const manifest = '<?xml version="1.0" encoding="UTF-8"?><MPD><!-- DASH Manifest --></MPD>';
    
    const uploadResult = await s3.upload({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: manifest,
      ContentType: 'application/dash+xml'
    }).promise();

    return uploadResult.Location;
  }

  private async generateVideoThumbnails(buffer: Buffer, fileId: string): Promise<string[]> {
    // Generate multiple thumbnails at different timestamps
    const timestamps = ['10%', '25%', '50%', '75%', '90%'];
    const thumbnails: string[] = [];

    for (const timestamp of timestamps) {
      try {
        const thumbnailBuffer = await this.generateThumbnailAtTimestamp(buffer, timestamp);
        const key = `thumbnails/${fileId}/${timestamp.replace('%', 'pct')}.jpg`;
        
        const uploadResult = await s3.upload({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg'
        }).promise();
        
        thumbnails.push(uploadResult.Location);
      } catch (error) {
        logger.error('Error generating thumbnail', { timestamp, error });
      }
    }

    return thumbnails;
  }

  private async generateThumbnailAtTimestamp(buffer: Buffer, timestamp: string): Promise<Buffer> {
    const inputPath = `/tmp/input_${Date.now()}.mp4`;
    const outputPath = `/tmp/thumb_${Date.now()}.jpg`;
    
    try {
      await fs.writeFile(inputPath, buffer);
      
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(timestamp)
          .frames(1)
          .size('320x240')
          .output(outputPath)
          .on('end', async () => {
            try {
              const result = await fs.readFile(outputPath);
              await fs.unlink(inputPath).catch(() => {});
              await fs.unlink(outputPath).catch(() => {});
              resolve(result);
            } catch (error) {
              reject(error);
            }
          })
          .on('error', reject)
          .run();
      });
    } catch (error) {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
      throw error;
    }
  }

  private getStartDateForTimeframe(timeframe: string): Date {
    const now = new Date();
    switch (timeframe) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'year':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  private getFileCategory(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'document';
    return 'other';
  }

  private calculateUploadTrend(files: any[]): Array<{ date: string; uploads: number }> {
    const trend: Record<string, number> = {};
    
    files.forEach(file => {
      const date = file.createdAt.toISOString().split('T')[0];
      trend[date] = (trend[date] || 0) + 1;
    });

    return Object.entries(trend)
      .map(([date, uploads]) => ({ date, uploads }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

export const mediaService = new MediaService();