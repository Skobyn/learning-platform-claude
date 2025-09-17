import { Worker } from 'worker_threads';
import Queue from 'bull';
import path from 'path';
import fs from 'fs-extra';
import VideoTranscodingService from '../services/video/videoTranscodingService';
import { redis } from '../lib/redis';

export interface VideoProcessingJob {
  id: string;
  type: 'transcode' | 'thumbnail' | 'subtitle' | 'preview';
  inputPath: string;
  outputPath: string;
  options: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

export interface TranscodeJobOptions {
  profiles: string[];
  generateThumbnails: boolean;
  extractSubtitles: boolean;
  generatePreview: boolean;
}

export interface ThumbnailJobOptions {
  count: number;
  width: number;
  height: number;
  interval?: number;
  timestamps?: number[];
}

export interface SubtitleJobOptions {
  extractAll: boolean;
  generateWebVTT: boolean;
  languages: string[];
}

export interface PreviewJobOptions {
  duration: number;
  startTime: number;
  quality: string;
}

export class VideoProcessor {
  private transcodingService: VideoTranscodingService;
  private transcodeQueue: Queue.Queue;
  private thumbnailQueue: Queue.Queue;
  private subtitleQueue: Queue.Queue;
  private previewQueue: Queue.Queue;
  private activeJobs = new Map<string, VideoProcessingJob>();

  constructor() {
    this.transcodingService = new VideoTranscodingService();
    this.initializeQueues();
    this.setupJobProcessors();
    this.setupEventListeners();
  }

  /**
   * Initialize Bull queues for different job types
   */
  private initializeQueues(): void {
    const redisConfig = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD
      }
    };

    this.transcodeQueue = new Queue('video transcode', redisConfig);
    this.thumbnailQueue = new Queue('thumbnail generation', redisConfig);
    this.subtitleQueue = new Queue('subtitle extraction', redisConfig);
    this.previewQueue = new Queue('preview generation', redisConfig);

    // Configure queue settings
    this.transcodeQueue.process('transcode', this.processTranscodeJob.bind(this));
    this.thumbnailQueue.process('thumbnail', this.processThumbnailJob.bind(this));
    this.subtitleQueue.process('subtitle', this.processSubtitleJob.bind(this));
    this.previewQueue.process('preview', this.processPreviewJob.bind(this));
  }

  /**
   * Setup job processors with concurrency limits
   */
  private setupJobProcessors(): void {
    // Transcode: 2 concurrent jobs (CPU intensive)
    this.transcodeQueue.process('transcode', 2, this.processTranscodeJob.bind(this));

    // Thumbnails: 4 concurrent jobs (less CPU intensive)
    this.thumbnailQueue.process('thumbnail', 4, this.processThumbnailJob.bind(this));

    // Subtitles: 3 concurrent jobs
    this.subtitleQueue.process('subtitle', 3, this.processSubtitleJob.bind(this));

    // Previews: 2 concurrent jobs
    this.previewQueue.process('preview', 2, this.processPreviewJob.bind(this));
  }

  /**
   * Setup event listeners for job updates
   */
  private setupEventListeners(): void {
    const queues = [this.transcodeQueue, this.thumbnailQueue, this.subtitleQueue, this.previewQueue];

    queues.forEach(queue => {
      queue.on('active', (job) => {
        this.updateJobStatus(job.data.jobId, 'processing', 0);
      });

      queue.on('progress', (job, progress) => {
        this.updateJobStatus(job.data.jobId, 'processing', progress);
      });

      queue.on('completed', (job) => {
        this.updateJobStatus(job.data.jobId, 'completed', 100);
      });

      queue.on('failed', (job, error) => {
        this.updateJobStatus(job.data.jobId, 'failed', 0, error.message);
      });
    });
  }

  /**
   * Add video transcoding job
   */
  async addTranscodeJob(inputPath: string, outputPath: string, options: TranscodeJobOptions): Promise<string> {
    const jobId = this.generateJobId('transcode');

    const job: VideoProcessingJob = {
      id: jobId,
      type: 'transcode',
      inputPath,
      outputPath,
      options,
      status: 'pending',
      progress: 0
    };

    this.activeJobs.set(jobId, job);
    await this.storeJob(job);

    // Add to queue
    await this.transcodeQueue.add('transcode', {
      jobId,
      inputPath,
      outputPath,
      options
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000
      },
      removeOnComplete: 50,
      removeOnFail: 20
    });

    return jobId;
  }

  /**
   * Add thumbnail generation job
   */
  async addThumbnailJob(inputPath: string, outputPath: string, options: ThumbnailJobOptions): Promise<string> {
    const jobId = this.generateJobId('thumbnail');

    const job: VideoProcessingJob = {
      id: jobId,
      type: 'thumbnail',
      inputPath,
      outputPath,
      options,
      status: 'pending',
      progress: 0
    };

    this.activeJobs.set(jobId, job);
    await this.storeJob(job);

    await this.thumbnailQueue.add('thumbnail', {
      jobId,
      inputPath,
      outputPath,
      options
    }, {
      attempts: 2,
      removeOnComplete: 100
    });

    return jobId;
  }

  /**
   * Add subtitle extraction job
   */
  async addSubtitleJob(inputPath: string, outputPath: string, options: SubtitleJobOptions): Promise<string> {
    const jobId = this.generateJobId('subtitle');

    const job: VideoProcessingJob = {
      id: jobId,
      type: 'subtitle',
      inputPath,
      outputPath,
      options,
      status: 'pending',
      progress: 0
    };

    this.activeJobs.set(jobId, job);
    await this.storeJob(job);

    await this.subtitleQueue.add('subtitle', {
      jobId,
      inputPath,
      outputPath,
      options
    }, {
      attempts: 2,
      removeOnComplete: 50
    });

    return jobId;
  }

  /**
   * Add preview generation job
   */
  async addPreviewJob(inputPath: string, outputPath: string, options: PreviewJobOptions): Promise<string> {
    const jobId = this.generateJobId('preview');

    const job: VideoProcessingJob = {
      id: jobId,
      type: 'preview',
      inputPath,
      outputPath,
      options,
      status: 'pending',
      progress: 0
    };

    this.activeJobs.set(jobId, job);
    await this.storeJob(job);

    await this.previewQueue.add('preview', {
      jobId,
      inputPath,
      outputPath,
      options
    }, {
      attempts: 2,
      removeOnComplete: 30
    });

    return jobId;
  }

  /**
   * Process transcode job
   */
  private async processTranscodeJob(job: Queue.Job): Promise<void> {
    const { jobId, inputPath, outputPath, options } = job.data;

    try {
      await fs.ensureDir(outputPath);

      // Load transcoding profiles
      const profiles = await this.loadTranscodingProfiles(options.profiles);

      // Start transcoding
      const transcodingJobId = await this.transcodingService.startTranscoding(
        inputPath,
        outputPath,
        profiles,
        jobId
      );

      // Monitor progress
      this.transcodingService.on('jobProgress', (transcodingJob) => {
        if (transcodingJob.id === transcodingJobId) {
          job.progress(transcodingJob.progress);
        }
      });

      // Wait for completion
      await this.waitForTranscodingCompletion(transcodingJobId);

      // Generate additional assets if requested
      if (options.generateThumbnails) {
        await this.addThumbnailJob(inputPath, path.join(outputPath, 'thumbnails'), {
          count: 20,
          width: 160,
          height: 90
        });
      }

      if (options.extractSubtitles) {
        await this.addSubtitleJob(inputPath, path.join(outputPath, 'subtitles'), {
          extractAll: true,
          generateWebVTT: true,
          languages: ['en', 'es', 'fr']
        });
      }

      if (options.generatePreview) {
        await this.addPreviewJob(inputPath, path.join(outputPath, 'preview.mp4'), {
          duration: 30,
          startTime: 60,
          quality: '480p'
        });
      }

    } catch (error) {
      throw new Error(`Transcoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process thumbnail generation job
   */
  private async processThumbnailJob(job: Queue.Job): Promise<void> {
    const { jobId, inputPath, outputPath, options } = job.data;

    try {
      await fs.ensureDir(outputPath);

      // Get video metadata
      const metadata = await this.transcodingService.getVideoMetadata(inputPath);

      let thumbnailCount = 0;
      const totalThumbnails = options.count || 20;

      if (options.timestamps && options.timestamps.length > 0) {
        // Generate thumbnails at specific timestamps
        for (let i = 0; i < options.timestamps.length; i++) {
          const timestamp = options.timestamps[i];
          const outputFile = path.join(outputPath, `thumb_${String(i).padStart(3, '0')}.jpg`);

          await this.generateSingleThumbnail(inputPath, outputFile, timestamp, options);
          thumbnailCount++;

          job.progress(Math.round((thumbnailCount / options.timestamps.length) * 100));
        }
      } else {
        // Generate thumbnails at intervals
        const interval = options.interval || (metadata.duration / totalThumbnails);

        for (let i = 0; i < totalThumbnails; i++) {
          const timestamp = i * interval;
          if (timestamp >= metadata.duration) break;

          const outputFile = path.join(outputPath, `thumb_${String(i).padStart(3, '0')}.jpg`);
          await this.generateSingleThumbnail(inputPath, outputFile, timestamp, options);
          thumbnailCount++;

          job.progress(Math.round((thumbnailCount / totalThumbnails) * 100));
        }
      }

      // Generate sprite sheet
      await this.generateSpriteSheet(outputPath, options);

    } catch (error) {
      throw new Error(`Thumbnail generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process subtitle extraction job
   */
  private async processSubtitleJob(job: Queue.Job): Promise<void> {
    const { jobId, inputPath, outputPath, options } = job.data;

    try {
      await fs.ensureDir(outputPath);

      const extractedFiles = await this.transcodingService.extractSubtitles(inputPath, outputPath);

      if (extractedFiles.length === 0) {
        console.log('No subtitles found in video');
        return;
      }

      job.progress(100);

    } catch (error) {
      throw new Error(`Subtitle extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process preview generation job
   */
  private async processPreviewJob(job: Queue.Job): Promise<void> {
    const { jobId, inputPath, outputPath, options } = job.data;

    try {
      await this.generateVideoPreview(inputPath, outputPath, options);
      job.progress(100);

    } catch (error) {
      throw new Error(`Preview generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<VideoProcessingJob | null> {
    // Try memory first
    if (this.activeJobs.has(jobId)) {
      return this.activeJobs.get(jobId)!;
    }

    // Try Redis
    const stored = await redis.get(`job:${jobId}`);
    if (stored) {
      return JSON.parse(stored);
    }

    return null;
  }

  /**
   * Cancel job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJobStatus(jobId);
    if (!job) return false;

    if (job.status !== 'processing') return false;

    // Try to cancel from appropriate queue
    let cancelled = false;

    const queues = [this.transcodeQueue, this.thumbnailQueue, this.subtitleQueue, this.previewQueue];

    for (const queue of queues) {
      const jobs = await queue.getJobs(['active', 'waiting']);
      const targetJob = jobs.find(j => j.data.jobId === jobId);

      if (targetJob) {
        await targetJob.remove();
        cancelled = true;
        break;
      }
    }

    if (cancelled) {
      await this.updateJobStatus(jobId, 'failed', 0, 'Job cancelled by user');
    }

    return cancelled;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    const queues = {
      transcode: this.transcodeQueue,
      thumbnail: this.thumbnailQueue,
      subtitle: this.subtitleQueue,
      preview: this.previewQueue
    };

    for (const [name, queue] of Object.entries(queues)) {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed()
      ]);

      stats[name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      };
    }

    return stats;
  }

  /**
   * Clean up completed jobs
   */
  async cleanupJobs(): Promise<void> {
    const queues = [this.transcodeQueue, this.thumbnailQueue, this.subtitleQueue, this.previewQueue];

    for (const queue of queues) {
      await queue.clean(24 * 60 * 60 * 1000, 'completed'); // Remove completed jobs older than 24 hours
      await queue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // Remove failed jobs older than 7 days
    }
  }

  // Helper methods
  private async loadTranscodingProfiles(profileNames: string[]): Promise<any[]> {
    const profilesPath = path.join(__dirname, '../../config/video/transcoding-profiles.json');
    const profiles = await fs.readJson(profilesPath);

    return profiles.filter((p: any) => profileNames.includes(p.name));
  }

  private async waitForTranscodingCompletion(transcodingJobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        const job = this.transcodingService.getJobStatus(transcodingJobId);

        if (job?.status === 'completed') {
          resolve();
        } else if (job?.status === 'failed') {
          reject(new Error(job.error || 'Transcoding failed'));
        } else {
          setTimeout(checkStatus, 1000);
        }
      };

      checkStatus();
    });
  }

  private async generateSingleThumbnail(inputPath: string, outputPath: string, timestamp: number, options: ThumbnailJobOptions): Promise<void> {
    const { spawn } = require('child_process');
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-ss', timestamp.toString(),
        '-vframes', '1',
        '-vf', `scale=${options.width}:${options.height}`,
        '-y',
        outputPath
      ];

      const ffmpeg = spawn(ffmpegPath, args);

      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Thumbnail generation failed at ${timestamp}s`));
        }
      });
    });
  }

  private async generateSpriteSheet(thumbnailDir: string, options: ThumbnailJobOptions): Promise<void> {
    // Implementation would generate a sprite sheet from individual thumbnails
    console.log(`Generating sprite sheet from ${thumbnailDir}`);
  }

  private async generateVideoPreview(inputPath: string, outputPath: string, options: PreviewJobOptions): Promise<void> {
    const { spawn } = require('child_process');
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-ss', options.startTime.toString(),
        '-t', options.duration.toString(),
        '-vf', 'scale=-2:480', // Adjust resolution based on quality
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '28',
        '-c:a', 'aac',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn(ffmpegPath, args);

      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Preview generation failed'));
        }
      });
    });
  }

  private async updateJobStatus(jobId: string, status: VideoProcessingJob['status'], progress: number, error?: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = status;
      job.progress = progress;
      if (error) job.error = error;
      if (status === 'processing' && !job.startTime) job.startTime = new Date();
      if (status === 'completed' || status === 'failed') job.endTime = new Date();

      await this.storeJob(job);
    }
  }

  private async storeJob(job: VideoProcessingJob): Promise<void> {
    await redis.setex(`job:${job.id}`, 7 * 24 * 3600, JSON.stringify(job)); // 7 days TTL
  }

  private generateJobId(type: string): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default VideoProcessor;