import { EventEmitter } from 'events';
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Storage } from '@google-cloud/storage';
import { Redis } from 'ioredis';
import { logger } from '../lib/logger';

export interface TranscodingJob {
  id: string;
  videoId: string;
  userId: string;
  inputPath: string;
  outputPath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  qualities: TranscodingQuality[];
  metadata?: VideoMetadata;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface TranscodingQuality {
  resolution: string;
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  codec: string;
  profile: string;
  preset: string;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  audioCodec?: string;
  fileSize: number;
}

export interface ThumbnailConfig {
  count: number;
  width: number;
  height: number;
  format: 'jpg' | 'png' | 'webp';
  quality: number;
}

export class VideoTranscodingService extends EventEmitter {
  private storage: Storage;
  private redis: Redis;
  private tempDir: string;
  private bucketName: string;
  private maxConcurrentJobs: number;
  private activeJobs: Map<string, TranscodingJob> = new Map();

  // Predefined quality presets
  private qualityPresets: { [key: string]: TranscodingQuality } = {
    '4k': {
      resolution: '2160p',
      width: 3840,
      height: 2160,
      bitrate: 15000,
      fps: 30,
      codec: 'libx264',
      profile: 'high',
      preset: 'medium'
    },
    '1440p': {
      resolution: '1440p',
      width: 2560,
      height: 1440,
      bitrate: 8000,
      fps: 30,
      codec: 'libx264',
      profile: 'high',
      preset: 'medium'
    },
    '1080p': {
      resolution: '1080p',
      width: 1920,
      height: 1080,
      bitrate: 5000,
      fps: 30,
      codec: 'libx264',
      profile: 'high',
      preset: 'medium'
    },
    '720p': {
      resolution: '720p',
      width: 1280,
      height: 720,
      bitrate: 2500,
      fps: 30,
      codec: 'libx264',
      profile: 'main',
      preset: 'medium'
    },
    '480p': {
      resolution: '480p',
      width: 854,
      height: 480,
      bitrate: 1200,
      fps: 30,
      codec: 'libx264',
      profile: 'main',
      preset: 'fast'
    },
    '360p': {
      resolution: '360p',
      width: 640,
      height: 360,
      bitrate: 800,
      fps: 30,
      codec: 'libx264',
      profile: 'baseline',
      preset: 'fast'
    },
    '240p': {
      resolution: '240p',
      width: 426,
      height: 240,
      bitrate: 500,
      fps: 30,
      codec: 'libx264',
      profile: 'baseline',
      preset: 'ultrafast'
    }
  };

  constructor(config: {
    googleCloudConfig: any;
    bucketName: string;
    redisUrl: string;
    tempDir: string;
    maxConcurrentJobs?: number;
  }) {
    super();

    this.storage = new Storage(config.googleCloudConfig);
    this.redis = new Redis(config.redisUrl);
    this.bucketName = config.bucketName;
    this.tempDir = config.tempDir;
    this.maxConcurrentJobs = config.maxConcurrentJobs || 3;

    // Start job processor
    this.processJobs();
  }

  /**
   * Submit a video for transcoding
   */
  async submitTranscodingJob(
    videoId: string,
    userId: string,
    inputPath: string,
    qualityLevels: string[] = ['1080p', '720p', '480p', '360p']
  ): Promise<TranscodingJob> {
    try {
      const jobId = `transcode_${videoId}_${Date.now()}`;

      // Get video metadata first
      const metadata = await this.extractVideoMetadata(inputPath);

      // Filter quality levels based on input resolution
      const filteredQualities = this.filterQualitiesByInput(qualityLevels, metadata);

      const job: TranscodingJob = {
        id: jobId,
        videoId,
        userId,
        inputPath,
        outputPath: `video/${videoId}`,
        status: 'pending',
        progress: 0,
        qualities: filteredQualities.map(q => this.qualityPresets[q]),
        metadata,
        createdAt: new Date()
      };

      // Store job in Redis queue
      await this.redis.lpush('transcoding:queue', JSON.stringify(job));
      await this.redis.hset(`transcoding:job:${jobId}`, job as any);

      this.emit('jobSubmitted', job);
      logger.info(`Transcoding job submitted: ${jobId}`);

      return job;
    } catch (error) {
      logger.error('Failed to submit transcoding job:', error);
      throw error;
    }
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<TranscodingJob | null> {
    try {
      const jobData = await this.redis.hgetall(`transcoding:job:${jobId}`);

      if (!Object.keys(jobData).length) {
        return null;
      }

      // Parse the job data
      const job: TranscodingJob = {
        id: jobData.id,
        videoId: jobData.videoId,
        userId: jobData.userId,
        inputPath: jobData.inputPath,
        outputPath: jobData.outputPath,
        status: jobData.status as any,
        progress: parseInt(jobData.progress),
        qualities: JSON.parse(jobData.qualities || '[]'),
        metadata: JSON.parse(jobData.metadata || '{}'),
        createdAt: new Date(jobData.createdAt),
        startedAt: jobData.startedAt ? new Date(jobData.startedAt) : undefined,
        completedAt: jobData.completedAt ? new Date(jobData.completedAt) : undefined,
        error: jobData.error
      };

      return job;
    } catch (error) {
      logger.error(`Failed to get job status for ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Extract video metadata using FFprobe
   */
  private async extractVideoMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fps: this.parseFPS(videoStream.r_frame_rate || '30/1'),
          bitrate: metadata.format.bit_rate ? parseInt(metadata.format.bit_rate) : 0,
          codec: videoStream.codec_name || 'unknown',
          audioCodec: audioStream?.codec_name,
          fileSize: metadata.format.size ? parseInt(metadata.format.size) : 0
        });
      });
    });
  }

  /**
   * Process transcoding jobs from queue
   */
  private async processJobs(): Promise<void> {
    while (true) {
      try {
        if (this.activeJobs.size >= this.maxConcurrentJobs) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Get next job from queue
        const jobData = await this.redis.brpop('transcoding:queue', 10);

        if (!jobData) {
          continue;
        }

        const job: TranscodingJob = JSON.parse(jobData[1]);
        this.activeJobs.set(job.id, job);

        // Process job
        this.processTranscodingJob(job)
          .catch(error => {
            logger.error(`Failed to process job ${job.id}:`, error);
            this.updateJobStatus(job.id, 'failed', 0, error.message);
          })
          .finally(() => {
            this.activeJobs.delete(job.id);
          });

      } catch (error) {
        logger.error('Error in job processor:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Process a single transcoding job
   */
  private async processTranscodingJob(job: TranscodingJob): Promise<void> {
    try {
      // Update job status
      await this.updateJobStatus(job.id, 'processing', 0);
      job.startedAt = new Date();

      // Download input file if it's from cloud storage
      const localInputPath = await this.downloadInputFile(job.inputPath);

      // Create output directory
      const outputDir = path.join(this.tempDir, job.videoId);
      await fs.mkdir(outputDir, { recursive: true });

      let completedQualities = 0;
      const totalQualities = job.qualities.length;

      // Process each quality level
      for (const quality of job.qualities) {
        logger.info(`Processing ${quality.resolution} for video ${job.videoId}`);

        const qualityOutputDir = path.join(outputDir, quality.resolution);
        await fs.mkdir(qualityOutputDir, { recursive: true });

        // Transcode video to specific quality
        await this.transcodeToQuality(localInputPath, qualityOutputDir, quality, (progress) => {
          const overallProgress = ((completedQualities + progress / 100) / totalQualities) * 90; // 90% for transcoding
          this.updateJobStatus(job.id, 'processing', overallProgress);
        });

        // Create HLS segments
        await this.createHLSSegments(qualityOutputDir, quality);

        // Create DASH segments
        await this.createDASHSegments(qualityOutputDir, quality);

        // Upload quality files to cloud storage
        await this.uploadQualityFiles(qualityOutputDir, job.outputPath, quality.resolution);

        completedQualities++;
        const progress = (completedQualities / totalQualities) * 90;
        await this.updateJobStatus(job.id, 'processing', progress);
      }

      // Generate thumbnails (5% progress)
      await this.generateThumbnails(localInputPath, outputDir, job);
      await this.updateJobStatus(job.id, 'processing', 95);

      // Upload thumbnails
      await this.uploadThumbnails(outputDir, job.outputPath);

      // Generate video config
      await this.generateVideoConfig(job);

      // Cleanup temporary files
      await this.cleanupTempFiles(localInputPath, outputDir);

      // Mark job as completed
      await this.updateJobStatus(job.id, 'completed', 100);
      job.completedAt = new Date();

      this.emit('jobCompleted', job);
      logger.info(`Transcoding job completed: ${job.id}`);

    } catch (error) {
      logger.error(`Transcoding job failed: ${job.id}`, error);
      await this.updateJobStatus(job.id, 'failed', 0, error.message);
      this.emit('jobFailed', job, error);
    }
  }

  /**
   * Transcode video to specific quality
   */
  private async transcodeToQuality(
    inputPath: string,
    outputDir: string,
    quality: TranscodingQuality,
    onProgress: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(outputDir, 'video.mp4');

      let command = ffmpeg(inputPath)
        .videoCodec(quality.codec)
        .videoBitrate(quality.bitrate)
        .size(`${quality.width}x${quality.height}`)
        .fps(quality.fps)
        .audioCodec('aac')
        .audioBitrate(128)
        .format('mp4');

      // Apply codec-specific options
      if (quality.codec === 'libx264') {
        command = command
          .addOption('-profile:v', quality.profile)
          .addOption('-preset', quality.preset)
          .addOption('-crf', '23')
          .addOption('-movflags', '+faststart');
      }

      command
        .on('progress', (progress) => {
          if (progress.percent) {
            onProgress(progress.percent);
          }
        })
        .on('end', () => {
          resolve();
        })
        .on('error', (error) => {
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * Create HLS segments for streaming
   */
  private async createHLSSegments(outputDir: string, quality: TranscodingQuality): Promise<void> {
    return new Promise((resolve, reject) => {
      const inputPath = path.join(outputDir, 'video.mp4');
      const playlistPath = path.join(outputDir, 'playlist.m3u8');

      ffmpeg(inputPath)
        .addOption('-c', 'copy')
        .addOption('-hls_time', '4')
        .addOption('-hls_playlist_type', 'vod')
        .addOption('-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'))
        .format('hls')
        .on('end', resolve)
        .on('error', reject)
        .save(playlistPath);
    });
  }

  /**
   * Create DASH segments for streaming
   */
  private async createDASHSegments(outputDir: string, quality: TranscodingQuality): Promise<void> {
    return new Promise((resolve, reject) => {
      const inputPath = path.join(outputDir, 'video.mp4');

      ffmpeg(inputPath)
        .addOption('-c', 'copy')
        .addOption('-f', 'dash')
        .addOption('-seg_duration', '4')
        .addOption('-init_seg_name', 'init.mp4')
        .addOption('-media_seg_name', 'segment_$Number$.m4s')
        .on('end', resolve)
        .on('error', reject)
        .save(path.join(outputDir, 'manifest.mpd'));
    });
  }

  /**
   * Generate video thumbnails
   */
  private async generateThumbnails(
    inputPath: string,
    outputDir: string,
    job: TranscodingJob,
    config: ThumbnailConfig = {
      count: 10,
      width: 320,
      height: 180,
      format: 'jpg',
      quality: 80
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const thumbnailDir = path.join(outputDir, 'thumbnails');
      fs.mkdir(thumbnailDir, { recursive: true }).then(() => {

        ffmpeg(inputPath)
          .screenshots({
            count: config.count,
            folder: thumbnailDir,
            filename: 'thumb_%i.jpg',
            size: `${config.width}x${config.height}`
          })
          .on('end', resolve)
          .on('error', reject);
      });
    });
  }

  /**
   * Upload quality files to cloud storage
   */
  private async uploadQualityFiles(localDir: string, cloudPath: string, quality: string): Promise<void> {
    try {
      const files = await fs.readdir(localDir);

      for (const file of files) {
        const localFilePath = path.join(localDir, file);
        const cloudFilePath = `${cloudPath}/${quality}/${file}`;

        await this.storage.bucket(this.bucketName)
          .upload(localFilePath, {
            destination: cloudFilePath,
            metadata: {
              cacheControl: 'public, max-age=86400'
            }
          });
      }
    } catch (error) {
      logger.error(`Failed to upload quality files for ${quality}:`, error);
      throw error;
    }
  }

  /**
   * Upload thumbnails to cloud storage
   */
  private async uploadThumbnails(outputDir: string, cloudPath: string): Promise<void> {
    try {
      const thumbnailDir = path.join(outputDir, 'thumbnails');
      const files = await fs.readdir(thumbnailDir);

      for (const file of files) {
        const localFilePath = path.join(thumbnailDir, file);
        const cloudFilePath = `${cloudPath}/thumbnails/${file}`;

        await this.storage.bucket(this.bucketName)
          .upload(localFilePath, {
            destination: cloudFilePath,
            metadata: {
              cacheControl: 'public, max-age=86400'
            }
          });
      }
    } catch (error) {
      logger.error('Failed to upload thumbnails:', error);
      throw error;
    }
  }

  /**
   * Generate video configuration file
   */
  private async generateVideoConfig(job: TranscodingJob): Promise<void> {
    try {
      const config = {
        videoId: job.videoId,
        userId: job.userId,
        qualities: job.qualities,
        duration: job.metadata?.duration || 0,
        thumbnails: Array.from({ length: 10 }, (_, i) =>
          `${job.outputPath}/thumbnails/thumb_${i + 1}.jpg`
        ),
        createdAt: new Date(),
        metadata: job.metadata
      };

      const configPath = `${job.outputPath}/config.json`;
      const file = this.storage.bucket(this.bucketName).file(configPath);

      await file.save(JSON.stringify(config, null, 2), {
        metadata: {
          contentType: 'application/json',
          cacheControl: 'public, max-age=3600'
        }
      });
    } catch (error) {
      logger.error('Failed to generate video config:', error);
      throw error;
    }
  }

  /**
   * Update job status in Redis
   */
  private async updateJobStatus(
    jobId: string,
    status: TranscodingJob['status'],
    progress: number,
    error?: string
  ): Promise<void> {
    try {
      const updates: any = {
        status,
        progress: progress.toString(),
      };

      if (status === 'processing' && !await this.redis.hexists(`transcoding:job:${jobId}`, 'startedAt')) {
        updates.startedAt = new Date().toISOString();
      }

      if (status === 'completed') {
        updates.completedAt = new Date().toISOString();
      }

      if (error) {
        updates.error = error;
      }

      await this.redis.hmset(`transcoding:job:${jobId}`, updates);

      // Emit progress event
      this.emit('jobProgress', { jobId, status, progress, error });
    } catch (err) {
      logger.error(`Failed to update job status for ${jobId}:`, err);
    }
  }

  // Helper methods

  private filterQualitiesByInput(requestedQualities: string[], metadata: VideoMetadata): string[] {
    const inputHeight = metadata.height;

    return requestedQualities.filter(quality => {
      const qualityHeight = this.qualityPresets[quality]?.height;
      return qualityHeight && qualityHeight <= inputHeight;
    }).sort((a, b) => {
      // Sort by quality descending
      return this.qualityPresets[b].height - this.qualityPresets[a].height;
    });
  }

  private parseFPS(frameRate: string): number {
    const [num, den] = frameRate.split('/').map(Number);
    return den ? Math.round(num / den) : num;
  }

  private async downloadInputFile(inputPath: string): Promise<string> {
    if (inputPath.startsWith('gs://') || inputPath.startsWith('http')) {
      // Download from cloud storage
      const fileName = path.basename(inputPath);
      const localPath = path.join(this.tempDir, `input_${Date.now()}_${fileName}`);

      if (inputPath.startsWith('gs://')) {
        const [bucketName, ...pathParts] = inputPath.replace('gs://', '').split('/');
        const filePath = pathParts.join('/');

        await this.storage.bucket(bucketName).file(filePath).download({
          destination: localPath
        });
      }

      return localPath;
    }

    return inputPath;
  }

  private async cleanupTempFiles(inputPath: string, outputDir: string): Promise<void> {
    try {
      // Remove temporary input file if it was downloaded
      if (inputPath.includes('input_')) {
        await fs.unlink(inputPath);
      }

      // Remove output directory
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (error) {
      logger.error('Failed to cleanup temp files:', error);
    }
  }
}

export default VideoTranscodingService;