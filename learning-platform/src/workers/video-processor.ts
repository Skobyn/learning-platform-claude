import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { Redis } from 'ioredis';
import VideoTranscodingService from '../services/video-transcoding.service';
import VideoStreamingService from '../services/video-streaming.service';
import { Storage } from '@google-cloud/storage';
import { logger } from '../lib/logger';
import * as os from 'os';
import * as fs from 'fs/promises';

interface WorkerConfig {
  redisUrl: string;
  googleCloudConfig: any;
  bucketName: string;
  tempDir: string;
  workerId: string;
  concurrentJobs: number;
}

interface ProcessingJob {
  id: string;
  type: 'transcode' | 'thumbnail' | 'analytics' | 'cleanup';
  videoId: string;
  userId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: any;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledAt?: Date;
}

interface WorkerMetrics {
  workerId: string;
  startTime: Date;
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  lastHeartbeat: Date;
  cpuUsage: number;
  memoryUsage: number;
  activeJobs: number;
}

class VideoProcessorWorker {
  private redis: Redis;
  private transcodingService: VideoTranscodingService;
  private streamingService: VideoStreamingService;
  private storage: Storage;
  private config: WorkerConfig;
  private isRunning: boolean = false;
  private activeJobs: Map<string, ProcessingJob> = new Map();
  private metrics: WorkerMetrics;
  private heartbeatInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config: WorkerConfig) {
    this.config = config;

    this.redis = new Redis(config.redisUrl);

    this.storage = new Storage(config.googleCloudConfig);

    this.transcodingService = new VideoTranscodingService({
      googleCloudConfig: config.googleCloudConfig,
      bucketName: config.bucketName,
      redisUrl: config.redisUrl,
      tempDir: config.tempDir,
      maxConcurrentJobs: config.concurrentJobs
    });

    this.streamingService = new VideoStreamingService({
      googleCloudConfig: config.googleCloudConfig,
      bucketName: config.bucketName,
      redisUrl: config.redisUrl,
      cdnBaseUrl: process.env.CDN_BASE_URL!,
      jwtSecret: process.env.JWT_SECRET!
    });

    this.metrics = {
      workerId: config.workerId,
      startTime: new Date(),
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      lastHeartbeat: new Date(),
      cpuUsage: 0,
      memoryUsage: 0,
      activeJobs: 0
    };

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Start the worker processing loop
   */
  async start(): Promise<void> {
    try {
      this.isRunning = true;

      // Register worker
      await this.registerWorker();

      // Start heartbeat
      this.startHeartbeat();

      // Start metrics collection
      this.startMetricsCollection();

      logger.info(`Video processor worker ${this.config.workerId} started`);

      // Main processing loop
      while (this.isRunning) {
        try {
          await this.processNextJob();

          // Small delay to prevent CPU spinning
          await this.sleep(100);
        } catch (error) {
          logger.error('Error in worker processing loop:', error);
          await this.sleep(5000); // Wait longer on error
        }
      }
    } catch (error) {
      logger.error('Failed to start video processor worker:', error);
      throw error;
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    logger.info(`Stopping video processor worker ${this.config.workerId}`);

    this.isRunning = false;

    // Wait for active jobs to complete
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeJobs.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      logger.info(`Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await this.sleep(1000);
    }

    // Cancel remaining jobs
    for (const [jobId, job] of this.activeJobs) {
      await this.cancelJob(jobId, 'Worker shutdown');
    }

    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Unregister worker
    await this.unregisterWorker();

    // Close Redis connection
    await this.redis.quit();

    logger.info(`Video processor worker ${this.config.workerId} stopped`);
  }

  /**
   * Process the next job from the queue
   */
  private async processNextJob(): Promise<void> {
    if (this.activeJobs.size >= this.config.concurrentJobs) {
      return;
    }

    // Get next job with priority
    const jobData = await this.getNextJob();
    if (!jobData) {
      return;
    }

    const job: ProcessingJob = JSON.parse(jobData);
    this.activeJobs.set(job.id, job);
    this.metrics.activeJobs = this.activeJobs.size;

    try {
      logger.info(`Processing job ${job.id} (type: ${job.type}, priority: ${job.priority})`);

      // Update job status
      await this.updateJobStatus(job.id, 'processing');

      // Process based on job type
      switch (job.type) {
        case 'transcode':
          await this.processTranscodingJob(job);
          break;

        case 'thumbnail':
          await this.processThumbnailJob(job);
          break;

        case 'analytics':
          await this.processAnalyticsJob(job);
          break;

        case 'cleanup':
          await this.processCleanupJob(job);
          break;

        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Mark job as completed
      await this.completeJob(job.id);
      this.metrics.jobsSucceeded++;

      logger.info(`Job ${job.id} completed successfully`);

    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error);
      await this.failJob(job.id, error.message);
      this.metrics.jobsFailed++;
    } finally {
      this.activeJobs.delete(job.id);
      this.metrics.activeJobs = this.activeJobs.size;
      this.metrics.jobsProcessed++;
    }
  }

  /**
   * Process video transcoding job
   */
  private async processTranscodingJob(job: ProcessingJob): Promise<void> {
    const { videoId, inputPath, outputPath, qualities, metadata } = job.data;

    // Submit to transcoding service
    const transcodingJob = await this.transcodingService.submitTranscodingJob(
      videoId,
      job.userId,
      inputPath,
      qualities
    );

    // Monitor transcoding progress
    let lastProgress = 0;
    while (true) {
      const status = await this.transcodingService.getJobStatus(transcodingJob.id);
      if (!status) {
        throw new Error('Transcoding job not found');
      }

      if (status.status === 'completed') {
        // Generate streaming manifests
        await this.generateStreamingManifests(videoId, status.qualities);
        break;
      } else if (status.status === 'failed') {
        throw new Error(`Transcoding failed: ${status.error}`);
      }

      // Update progress if changed significantly
      if (Math.abs(status.progress - lastProgress) > 5) {
        await this.updateJobProgress(job.id, status.progress);
        lastProgress = status.progress;
      }

      // Wait before checking again
      await this.sleep(5000);
    }
  }

  /**
   * Process thumbnail generation job
   */
  private async processThumbnailJob(job: ProcessingJob): Promise<void> {
    const { videoId, inputPath, timestamps, dimensions } = job.data;

    // Implementation would use FFmpeg to generate thumbnails
    // at specific timestamps and upload to storage
    logger.info(`Generating thumbnails for video ${videoId}`);

    // This is a simplified placeholder - actual implementation
    // would involve FFmpeg processing
    await this.sleep(2000); // Simulate processing time
  }

  /**
   * Process analytics job
   */
  private async processAnalyticsJob(job: ProcessingJob): Promise<void> {
    const { videoId, eventType, timeRange } = job.data;

    // Aggregate analytics data for the video
    const analytics = await this.streamingService.getStreamingAnalytics(videoId, timeRange);

    // Store processed analytics
    await this.redis.setex(
      `analytics:processed:${videoId}:${timeRange}`,
      3600, // 1 hour cache
      JSON.stringify(analytics)
    );

    logger.info(`Analytics processed for video ${videoId}`);
  }

  /**
   * Process cleanup job
   */
  private async processCleanupJob(job: ProcessingJob): Promise<void> {
    const { videoId, paths, olderThan } = job.data;

    // Clean up temporary files and old versions
    for (const path of paths) {
      try {
        // Delete from Google Cloud Storage
        const bucket = this.storage.bucket(this.config.bucketName);
        await bucket.deleteFiles({
          prefix: path,
          versions: true
        });

        logger.info(`Cleaned up path: ${path}`);
      } catch (error) {
        logger.warn(`Failed to clean up path ${path}:`, error);
      }
    }
  }

  /**
   * Generate streaming manifests after transcoding
   */
  private async generateStreamingManifests(videoId: string, qualities: any[]): Promise<void> {
    const config = {
      videoId,
      userId: '', // Would get from job data
      qualities,
      duration: 0, // Would get from metadata
      thumbnails: []
    };

    // Generate HLS manifest
    await this.streamingService.generateHLSManifest(videoId, config);

    // Generate DASH manifest
    await this.streamingService.generateDASHManifest(videoId, config);

    logger.info(`Generated streaming manifests for video ${videoId}`);
  }

  /**
   * Get next job from priority queues
   */
  private async getNextJob(): Promise<string | null> {
    const queues = [
      'video:jobs:critical',
      'video:jobs:high',
      'video:jobs:medium',
      'video:jobs:low'
    ];

    for (const queue of queues) {
      const job = await this.redis.brpop(queue, 1);
      if (job) {
        return job[1];
      }
    }

    return null;
  }

  /**
   * Update job status
   */
  private async updateJobStatus(jobId: string, status: string, progress?: number): Promise<void> {
    const updates: any = { status };
    if (progress !== undefined) {
      updates.progress = progress;
    }

    await this.redis.hmset(`video:job:${jobId}`, updates);

    // Emit progress event
    await this.redis.publish('video:job:progress', JSON.stringify({
      jobId,
      status,
      progress,
      workerId: this.config.workerId
    }));
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(jobId: string, progress: number): Promise<void> {
    await this.updateJobStatus(jobId, 'processing', progress);
  }

  /**
   * Mark job as completed
   */
  private async completeJob(jobId: string): Promise<void> {
    await this.updateJobStatus(jobId, 'completed', 100);

    // Move to completed set
    await this.redis.sadd('video:jobs:completed', jobId);

    // Set TTL for cleanup
    await this.redis.expire(`video:job:${jobId}`, 86400); // 24 hours
  }

  /**
   * Mark job as failed
   */
  private async failJob(jobId: string, error: string): Promise<void> {
    await this.redis.hmset(`video:job:${jobId}`, {
      status: 'failed',
      error,
      failedAt: new Date().toISOString()
    });

    // Check if should retry
    const job = this.activeJobs.get(jobId);
    if (job && job.attempts < job.maxAttempts) {
      // Reschedule with exponential backoff
      const delay = Math.min(60000 * Math.pow(2, job.attempts), 3600000); // Max 1 hour
      job.attempts++;
      job.scheduledAt = new Date(Date.now() + delay);

      // Add back to queue
      await this.redis.lpush('video:jobs:medium', JSON.stringify(job));
      logger.info(`Job ${jobId} will be retried in ${delay}ms (attempt ${job.attempts})`);
    } else {
      // Move to failed set
      await this.redis.sadd('video:jobs:failed', jobId);
      logger.error(`Job ${jobId} failed permanently after ${job?.attempts || 1} attempts`);
    }
  }

  /**
   * Cancel a job
   */
  private async cancelJob(jobId: string, reason: string): Promise<void> {
    await this.redis.hmset(`video:job:${jobId}`, {
      status: 'cancelled',
      reason,
      cancelledAt: new Date().toISOString()
    });

    await this.redis.sadd('video:jobs:cancelled', jobId);
  }

  /**
   * Register worker with Redis
   */
  private async registerWorker(): Promise<void> {
    await this.redis.hset('video:workers', this.config.workerId, JSON.stringify({
      ...this.metrics,
      config: {
        concurrentJobs: this.config.concurrentJobs,
        tempDir: this.config.tempDir
      }
    }));
  }

  /**
   * Unregister worker
   */
  private async unregisterWorker(): Promise<void> {
    await this.redis.hdel('video:workers', this.config.workerId);
  }

  /**
   * Start heartbeat to indicate worker is alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      this.metrics.lastHeartbeat = new Date();

      await this.redis.hset('video:workers', this.config.workerId, JSON.stringify({
        ...this.metrics,
        config: {
          concurrentJobs: this.config.concurrentJobs,
          tempDir: this.config.tempDir
        }
      }));
    }, 30000); // Every 30 seconds
  }

  /**
   * Start system metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB

      // CPU usage would need more sophisticated tracking
      this.metrics.cpuUsage = os.loadavg()[0] * 100;
    }, 10000); // Every 10 seconds
  }

  /**
   * Setup event listeners for cleanup
   */
  private setupEventListeners(): void {
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      this.stop().then(() => process.exit(0));
    });

    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully');
      this.stop().then(() => process.exit(0));
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Worker manager for spawning multiple workers
export class VideoProcessorManager {
  private workers: Worker[] = [];
  private config: WorkerConfig;

  constructor(config: Omit<WorkerConfig, 'workerId'>) {
    this.config = {
      ...config,
      workerId: '' // Will be set per worker
    };
  }

  /**
   * Start specified number of worker processes
   */
  async startWorkers(count: number = os.cpus().length): Promise<void> {
    for (let i = 0; i < count; i++) {
      const workerId = `video-worker-${i}-${Date.now()}`;
      const workerConfig = {
        ...this.config,
        workerId
      };

      const worker = new Worker(__filename, {
        workerData: workerConfig
      });

      worker.on('message', (message) => {
        logger.info(`Worker ${workerId} message:`, message);
      });

      worker.on('error', (error) => {
        logger.error(`Worker ${workerId} error:`, error);
      });

      worker.on('exit', (code) => {
        logger.info(`Worker ${workerId} exited with code ${code}`);
      });

      this.workers.push(worker);
      logger.info(`Started video processor worker ${workerId}`);
    }
  }

  /**
   * Stop all workers
   */
  async stopWorkers(): Promise<void> {
    const promises = this.workers.map(worker => {
      return new Promise<void>((resolve) => {
        worker.terminate().then(() => resolve());
      });
    });

    await Promise.all(promises);
    this.workers = [];
    logger.info('All video processor workers stopped');
  }
}

// Worker thread execution
if (!isMainThread && parentPort) {
  const config: WorkerConfig = workerData;
  const worker = new VideoProcessorWorker(config);

  worker.start().catch(error => {
    logger.error('Worker failed to start:', error);
    process.exit(1);
  });

  parentPort.on('message', (message) => {
    if (message === 'shutdown') {
      worker.stop().then(() => process.exit(0));
    }
  });
}

export default VideoProcessorWorker;