import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { createReadStream, statSync, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import ffmpeg from 'fluent-ffmpeg';
import ffprobe from 'ffprobe-static';
import db from '@/lib/db';
import { Redis } from 'ioredis';
import axios from 'axios';

// Configure FFmpeg paths
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || 'ffmpeg');
ffmpeg.setFfprobePath(ffprobe.path);

interface VideoStreamConfig {
  enableTranscoding: boolean;
  supportedFormats: string[];
  qualityLevels: QualityLevel[];
  enableAdaptiveStreaming: boolean;
  enableHLS: boolean;
  enableDASH: boolean;
  chunkDuration: number;
  enableThumbnails: boolean;
  enablePreview: boolean;
  enableDRM: boolean;
  enableCDN: boolean;
  cdnProvider: 'cloudflare' | 'aws' | 'azure';
  maxConcurrentTranscoding: number;
  segmentSize: number;
  keyFrameInterval: number;
  enableGPUAcceleration: boolean;
}

interface QualityLevel {
  name: string;
  resolution: string;
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  codec: string;
  profile: string;
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
}

interface VideoMetadata {
  id: string;
  originalFilename: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  bitrate: number;
  fps: number;
  size: number;
  aspectRatio: string;
  audioCodec?: string;
  videoCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  createdAt: Date;
  processedAt?: Date;
  status: 'uploading' | 'processing' | 'ready' | 'error' | 'transcoding';
  qualityVariants?: VideoVariant[];
  thumbnails?: ThumbnailInfo[];
  chapters?: ChapterInfo[];
  subtitles?: SubtitleInfo[];
  drmKeyId?: string;
  cdnUrls?: Record<string, string>;
}

interface VideoVariant {
  quality: string;
  resolution: string;
  bitrate: number;
  fps: number;
  codec: string;
  format: 'hls' | 'dash' | 'mp4';
  url: string;
  size: number;
  segmentCount?: number;
  playlistUrl?: string;
}

interface ThumbnailInfo {
  timestamp: number;
  url: string;
  width: number;
  height: number;
}

interface ChapterInfo {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  thumbnailUrl?: string;
}

interface SubtitleInfo {
  id: string;
  language: string;
  label: string;
  format: 'vtt' | 'srt' | 'ass';
  url: string;
}

interface TranscodingJob {
  id: string;
  videoId: string;
  sourceFile: string;
  outputDir: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  startTime?: Date;
  completedTime?: Date;
  error?: string;
  qualityLevel: QualityLevel;
}

interface UploadSession {
  id: string;
  videoId: string;
  userId: string;
  filename: string;
  totalSize: number;
  uploadedSize: number;
  chunkSize: number;
  chunks: UploadChunk[];
  status: 'active' | 'completed' | 'failed';
  expiresAt: Date;
  metadata?: Record<string, any>;
}

interface UploadChunk {
  index: number;
  size: number;
  checksum: string;
  uploaded: boolean;
  uploadedAt?: Date;
}

interface StreamingAnalytics {
  videoId: string;
  userId: string;
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  totalWatchTime: number;
  maxPosition: number;
  qualityChanges: QualityChange[];
  bufferEvents: BufferEvent[];
  seekEvents: SeekEvent[];
  playbackSpeed: number;
  deviceInfo: DeviceInfo;
  networkInfo?: NetworkInfo;
}

interface QualityChange {
  timestamp: Date;
  fromQuality: string;
  toQuality: string;
  reason: 'auto' | 'manual';
}

interface BufferEvent {
  timestamp: Date;
  type: 'start' | 'end';
  duration?: number;
  position: number;
}

interface SeekEvent {
  timestamp: Date;
  fromPosition: number;
  toPosition: number;
}

interface DeviceInfo {
  userAgent: string;
  platform: string;
  screenResolution: string;
  playerVersion: string;
}

interface NetworkInfo {
  bandwidth: number;
  latency: number;
  connectionType: string;
}

class EnhancedVideoStreamingService {
  private readonly config: VideoStreamConfig = {
    enableTranscoding: true,
    supportedFormats: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'm4v'],
    qualityLevels: [
      {
        name: '240p',
        resolution: '426x240',
        width: 426,
        height: 240,
        bitrate: 400,
        fps: 24,
        codec: 'libx264',
        profile: 'baseline',
        preset: 'faster'
      },
      {
        name: '360p',
        resolution: '640x360',
        width: 640,
        height: 360,
        bitrate: 800,
        fps: 24,
        codec: 'libx264',
        profile: 'main',
        preset: 'faster'
      },
      {
        name: '480p',
        resolution: '854x480',
        width: 854,
        height: 480,
        bitrate: 1200,
        fps: 30,
        codec: 'libx264',
        profile: 'main',
        preset: 'fast'
      },
      {
        name: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        bitrate: 2500,
        fps: 30,
        codec: 'libx264',
        profile: 'high',
        preset: 'medium'
      },
      {
        name: '1080p',
        resolution: '1920x1080',
        width: 1920,
        height: 1080,
        bitrate: 5000,
        fps: 30,
        codec: 'libx264',
        profile: 'high',
        preset: 'medium'
      },
      {
        name: '1440p',
        resolution: '2560x1440',
        width: 2560,
        height: 1440,
        bitrate: 8000,
        fps: 30,
        codec: 'libx264',
        profile: 'high',
        preset: 'slow'
      },
      {
        name: '4K',
        resolution: '3840x2160',
        width: 3840,
        height: 2160,
        bitrate: 15000,
        fps: 30,
        codec: 'libx265',
        profile: 'main',
        preset: 'slow'
      }
    ],
    enableAdaptiveStreaming: true,
    enableHLS: true,
    enableDASH: true,
    chunkDuration: 4, // 4 seconds for better adaptive streaming
    enableThumbnails: true,
    enablePreview: true,
    enableDRM: true,
    enableCDN: true,
    cdnProvider: 'cloudflare',
    maxConcurrentTranscoding: 3,
    segmentSize: 4,
    keyFrameInterval: 2,
    enableGPUAcceleration: process.env.ENABLE_GPU_ACCELERATION === 'true'
  };

  private readonly videoBasePath = process.env.VIDEO_STORAGE_PATH || './storage/videos';
  private readonly tempPath = process.env.TEMP_STORAGE_PATH || './storage/temp';
  private readonly publicVideoUrl = process.env.PUBLIC_VIDEO_URL || '/api/videos/stream';
  private readonly cdnBaseUrl = process.env.CDN_BASE_URL || '';

  private redis: Redis;
  private transcodingQueue: TranscodingJob[] = [];
  private activeJobs = new Map<string, ChildProcess>();

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });

    this.initializeDirectories();
    this.startTranscodingWorker();
  }

  private async initializeDirectories(): Promise<void> {
    const dirs = [
      this.videoBasePath,
      this.tempPath,
      path.join(this.videoBasePath, 'hls'),
      path.join(this.videoBasePath, 'dash'),
      path.join(this.videoBasePath, 'thumbnails'),
      path.join(this.videoBasePath, 'previews'),
      path.join(this.tempPath, 'uploads'),
      path.join(this.tempPath, 'processing')
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
      }
    }
  }

  /**
   * Create chunked upload session
   */
  async createUploadSession(
    userId: string,
    filename: string,
    totalSize: number,
    chunkSize: number = 5 * 1024 * 1024, // 5MB chunks
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; uploadSession?: UploadSession; error?: string }> {
    try {
      const videoId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const totalChunks = Math.ceil(totalSize / chunkSize);

      const chunks: UploadChunk[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkSizeForIndex = i === totalChunks - 1
          ? totalSize - (i * chunkSize)
          : chunkSize;

        chunks.push({
          index: i,
          size: chunkSizeForIndex,
          checksum: '',
          uploaded: false
        });
      }

      const uploadSession: UploadSession = {
        id: sessionId,
        videoId,
        userId,
        filename,
        totalSize,
        uploadedSize: 0,
        chunkSize,
        chunks,
        status: 'active',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        metadata
      };

      // Store in Redis for quick access
      await this.redis.setex(
        `upload:session:${sessionId}`,
        24 * 60 * 60, // 24 hours TTL
        JSON.stringify(uploadSession)
      );

      // Create video record
      await db.video.create({
        data: {
          id: videoId,
          originalFilename: filename,
          status: 'uploading',
          metadata: {
            totalSize,
            uploadSessionId: sessionId,
            ...metadata
          }
        }
      });

      return { success: true, uploadSession };

    } catch (error) {
      console.error('Upload session creation failed:', error);
      return { success: false, error: 'Session creation failed' };
    }
  }

  /**
   * Upload video chunk
   */
  async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    chunkData: Buffer,
    checksum?: string
  ): Promise<{ success: boolean; uploadedChunks?: number; totalChunks?: number; error?: string }> {
    try {
      const sessionData = await this.redis.get(`upload:session:${sessionId}`);
      if (!sessionData) {
        return { success: false, error: 'Session not found or expired' };
      }

      const session: UploadSession = JSON.parse(sessionData);
      if (session.status !== 'active') {
        return { success: false, error: 'Session not active' };
      }

      const chunk = session.chunks[chunkIndex];
      if (!chunk) {
        return { success: false, error: 'Invalid chunk index' };
      }

      if (chunk.uploaded) {
        return { success: true, uploadedChunks: session.chunks.filter(c => c.uploaded).length, totalChunks: session.chunks.length };
      }

      // Verify chunk size and checksum
      if (chunkData.length !== chunk.size) {
        return { success: false, error: 'Chunk size mismatch' };
      }

      if (checksum) {
        const calculatedChecksum = crypto.createHash('md5').update(chunkData).digest('hex');
        if (calculatedChecksum !== checksum) {
          return { success: false, error: 'Chunk checksum mismatch' };
        }
        chunk.checksum = checksum;
      }

      // Save chunk to temp directory
      const chunkPath = path.join(this.tempPath, 'uploads', `${sessionId}_chunk_${chunkIndex}`);
      await fs.writeFile(chunkPath, chunkData);

      // Update chunk status
      chunk.uploaded = true;
      chunk.uploadedAt = new Date();
      session.uploadedSize += chunk.size;

      // Update session in Redis
      await this.redis.setex(
        `upload:session:${sessionId}`,
        24 * 60 * 60,
        JSON.stringify(session)
      );

      const uploadedChunks = session.chunks.filter(c => c.uploaded).length;
      const totalChunks = session.chunks.length;

      // Check if all chunks are uploaded
      if (uploadedChunks === totalChunks) {
        await this.assembleUploadedFile(session);
      }

      return { success: true, uploadedChunks, totalChunks };

    } catch (error) {
      console.error('Chunk upload failed:', error);
      return { success: false, error: 'Chunk upload failed' };
    }
  }

  /**
   * Assemble uploaded chunks into final file
   */
  private async assembleUploadedFile(session: UploadSession): Promise<void> {
    try {
      const finalPath = path.join(this.videoBasePath, `${session.videoId}.${this.getFileExtension(session.filename)}`);
      const writeStream = createWriteStream(finalPath);

      // Combine all chunks in order
      for (let i = 0; i < session.chunks.length; i++) {
        const chunkPath = path.join(this.tempPath, 'uploads', `${session.id}_chunk_${i}`);
        const chunkData = await fs.readFile(chunkPath);
        writeStream.write(chunkData);

        // Clean up chunk file
        await fs.unlink(chunkPath).catch(console.error);
      }

      writeStream.end();

      // Update session status
      session.status = 'completed';
      await this.redis.setex(
        `upload:session:${session.id}`,
        24 * 60 * 60,
        JSON.stringify(session)
      );

      // Create media file record
      const mediaFile = await db.mediaFile.create({
        data: {
          id: crypto.randomUUID(),
          originalName: session.filename,
          filename: `${session.videoId}.${this.getFileExtension(session.filename)}`,
          mimeType: this.getMimeType(session.filename),
          size: session.totalSize,
          path: finalPath,
          uploadedBy: session.userId
        }
      });

      // Update video record
      await db.video.update({
        where: { id: session.videoId },
        data: {
          mediaFileId: mediaFile.id,
          status: 'processing'
        }
      });

      // Start video processing
      await this.processVideoForStreaming(session.videoId, finalPath);

    } catch (error) {
      console.error('File assembly failed:', error);

      // Update session status to failed
      session.status = 'failed';
      await this.redis.setex(
        `upload:session:${session.id}`,
        24 * 60 * 60,
        JSON.stringify(session)
      );

      // Update video status
      await db.video.update({
        where: { id: session.videoId },
        data: {
          status: 'error',
          metadata: { error: 'File assembly failed' }
        }
      });
    }
  }

  /**
   * Process video for streaming with FFmpeg
   */
  async processVideoForStreaming(
    videoId: string,
    sourceFile: string,
    enablePreview = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Extract metadata first
      const metadata = await this.extractVideoMetadata(sourceFile);

      // Update video with metadata
      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'transcoding',
          metadata: {
            ...metadata,
            startedAt: new Date()
          }
        }
      });

      const outputDir = path.join(this.videoBasePath, videoId);
      await fs.mkdir(outputDir, { recursive: true });

      // Generate thumbnails
      if (this.config.enableThumbnails) {
        await this.generateThumbnails(sourceFile, videoId, metadata.duration);
      }

      // Generate preview clip if enabled
      if (enablePreview && this.config.enablePreview) {
        await this.generatePreviewClip(sourceFile, videoId);
      }

      // Queue transcoding jobs for different quality levels
      const suitableQualities = this.getSuitableQualities(metadata.width, metadata.height);

      for (const quality of suitableQualities) {
        const job: TranscodingJob = {
          id: crypto.randomUUID(),
          videoId,
          sourceFile,
          outputDir,
          status: 'queued',
          progress: 0,
          qualityLevel: quality
        };

        this.transcodingQueue.push(job);
      }

      return { success: true };

    } catch (error) {
      console.error('Video processing failed:', error);

      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'error',
          metadata: { error: error.message }
        }
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Extract video metadata using FFprobe
   */
  private async extractVideoMetadata(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .ffprobe((err, metadata) => {
          if (err) {
            reject(err);
            return;
          }

          const videoStream = metadata.streams.find(s => s.codec_type === 'video');
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

          const result = {
            duration: metadata.format.duration || 0,
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            format: metadata.format.format_name || '',
            bitrate: parseInt(metadata.format.bit_rate || '0'),
            fps: this.parseFps(videoStream?.r_frame_rate || '30/1'),
            aspectRatio: videoStream ? `${videoStream.width}:${videoStream.height}` : '',
            videoCodec: videoStream?.codec_name || '',
            audioCodec: audioStream?.codec_name || '',
            audioChannels: audioStream?.channels || 0,
            audioSampleRate: audioStream?.sample_rate || 0
          };

          resolve(result);
        });
    });
  }

  /**
   * Generate video thumbnails
   */
  private async generateThumbnails(sourceFile: string, videoId: string, duration: number): Promise<ThumbnailInfo[]> {
    const thumbnailsDir = path.join(this.videoBasePath, videoId, 'thumbnails');
    await fs.mkdir(thumbnailsDir, { recursive: true });

    const thumbnails: ThumbnailInfo[] = [];
    const thumbnailCount = Math.min(10, Math.ceil(duration / 60)); // One thumbnail per minute, max 10
    const interval = duration / thumbnailCount;

    return new Promise((resolve, reject) => {
      let completedCount = 0;

      for (let i = 0; i < thumbnailCount; i++) {
        const timestamp = i * interval;
        const thumbnailPath = path.join(thumbnailsDir, `thumb_${i.toString().padStart(3, '0')}.jpg`);

        ffmpeg(sourceFile)
          .seekInput(timestamp)
          .frames(1)
          .size('320x180')
          .output(thumbnailPath)
          .on('end', () => {
            thumbnails.push({
              timestamp,
              url: `${this.publicVideoUrl}/${videoId}/thumbnails/thumb_${i.toString().padStart(3, '0')}.jpg`,
              width: 320,
              height: 180
            });

            completedCount++;
            if (completedCount === thumbnailCount) {
              resolve(thumbnails.sort((a, b) => a.timestamp - b.timestamp));
            }
          })
          .on('error', (err) => {
            console.error(`Thumbnail generation failed for ${timestamp}s:`, err);
            completedCount++;
            if (completedCount === thumbnailCount) {
              resolve(thumbnails.sort((a, b) => a.timestamp - b.timestamp));
            }
          })
          .run();
      }
    });
  }

  /**
   * Generate preview clip (first 30 seconds)
   */
  private async generatePreviewClip(sourceFile: string, videoId: string): Promise<void> {
    const previewDir = path.join(this.videoBasePath, videoId, 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    const previewPath = path.join(previewDir, 'preview.mp4');

    return new Promise((resolve, reject) => {
      ffmpeg(sourceFile)
        .seekInput(0)
        .duration(30) // 30-second preview
        .size('854x480') // 480p quality for preview
        .videoBitrate(800)
        .videoCodec('libx264')
        .audioCodec('aac')
        .output(previewPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  /**
   * Transcoding worker that processes queued jobs
   */
  private startTranscodingWorker(): void {
    setInterval(() => {
      const activeJobCount = this.activeJobs.size;
      if (activeJobCount < this.config.maxConcurrentTranscoding && this.transcodingQueue.length > 0) {
        const job = this.transcodingQueue.shift();
        if (job) {
          this.processTranscodingJob(job);
        }
      }
    }, 1000);
  }

  /**
   * Process individual transcoding job
   */
  private async processTranscodingJob(job: TranscodingJob): Promise<void> {
    try {
      job.status = 'processing';
      job.startTime = new Date();

      const qualityOutputDir = path.join(job.outputDir, job.qualityLevel.name);
      await fs.mkdir(qualityOutputDir, { recursive: true });

      // HLS transcoding
      if (this.config.enableHLS) {
        await this.transcodeToHLS(job);
      }

      // DASH transcoding
      if (this.config.enableDASH) {
        await this.transcodeToDASH(job);
      }

      // MP4 transcoding for fallback
      await this.transcodeToMP4(job);

      job.status = 'completed';
      job.completedTime = new Date();
      job.progress = 100;

      // Check if all quality levels are complete
      await this.checkTranscodingCompletion(job.videoId);

    } catch (error) {
      console.error(`Transcoding job failed for ${job.id}:`, error);
      job.status = 'failed';
      job.error = error.message;
      job.completedTime = new Date();

      // Remove from active jobs
      if (this.activeJobs.has(job.id)) {
        const process = this.activeJobs.get(job.id);
        process?.kill('SIGTERM');
        this.activeJobs.delete(job.id);
      }
    }
  }

  /**
   * Transcode to HLS format
   */
  private async transcodeToHLS(job: TranscodingJob): Promise<void> {
    const qualityDir = path.join(job.outputDir, job.qualityLevel.name, 'hls');
    await fs.mkdir(qualityDir, { recursive: true });

    const playlistPath = path.join(qualityDir, 'playlist.m3u8');
    const segmentPattern = path.join(qualityDir, 'segment_%03d.ts');

    return new Promise((resolve, reject) => {
      let command = ffmpeg(job.sourceFile)
        .videoCodec(job.qualityLevel.codec)
        .size(`${job.qualityLevel.width}x${job.qualityLevel.height}`)
        .videoBitrate(job.qualityLevel.bitrate)
        .fps(job.qualityLevel.fps)
        .audioCodec('aac')
        .audioBitrate(128);

      // Add GPU acceleration if enabled
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      // Add preset and profile
      command = command.addOptions([
        '-preset', job.qualityLevel.preset,
        '-profile:v', job.qualityLevel.profile,
        '-g', (job.qualityLevel.fps * this.config.keyFrameInterval).toString(),
        '-keyint_min', (job.qualityLevel.fps * this.config.keyFrameInterval).toString(),
        '-sc_threshold', '0',
        '-hls_time', this.config.chunkDuration.toString(),
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', segmentPattern
      ]);

      const ffmpegProcess = command
        .output(playlistPath)
        .on('start', (commandLine) => {
          console.log(`Starting HLS transcoding for ${job.qualityLevel.name}: ${commandLine}`);
        })
        .on('progress', (progress) => {
          job.progress = Math.round(progress.percent || 0);
          console.log(`HLS ${job.qualityLevel.name} progress: ${job.progress}%`);
        })
        .on('end', () => {
          console.log(`HLS transcoding completed for ${job.qualityLevel.name}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`HLS transcoding failed for ${job.qualityLevel.name}:`, err);
          reject(err);
        });

      // Store process reference
      this.activeJobs.set(job.id, ffmpegProcess.ffmpegProc);

      ffmpegProcess.run();
    });
  }

  /**
   * Transcode to DASH format
   */
  private async transcodeToDASH(job: TranscodingJob): Promise<void> {
    const qualityDir = path.join(job.outputDir, job.qualityLevel.name, 'dash');
    await fs.mkdir(qualityDir, { recursive: true });

    const manifestPath = path.join(qualityDir, 'manifest.mpd');
    const initSegmentPath = path.join(qualityDir, 'init_$RepresentationID$.mp4');
    const segmentPattern = path.join(qualityDir, 'chunk_$RepresentationID$_$Number$.m4s');

    return new Promise((resolve, reject) => {
      let command = ffmpeg(job.sourceFile)
        .videoCodec(job.qualityLevel.codec)
        .size(`${job.qualityLevel.width}x${job.qualityLevel.height}`)
        .videoBitrate(job.qualityLevel.bitrate)
        .fps(job.qualityLevel.fps)
        .audioCodec('aac')
        .audioBitrate(128);

      // Add GPU acceleration if enabled
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      command = command.addOptions([
        '-preset', job.qualityLevel.preset,
        '-profile:v', job.qualityLevel.profile,
        '-g', (job.qualityLevel.fps * this.config.keyFrameInterval).toString(),
        '-keyint_min', (job.qualityLevel.fps * this.config.keyFrameInterval).toString(),
        '-sc_threshold', '0',
        '-f', 'dash',
        '-seg_duration', this.config.chunkDuration.toString(),
        '-init_seg_name', 'init_$RepresentationID$.mp4',
        '-media_seg_name', 'chunk_$RepresentationID$_$Number$.m4s',
        '-single_file', '0',
        '-adaptation_sets', 'id=0,streams=v id=1,streams=a'
      ]);

      const ffmpegProcess = command
        .output(manifestPath)
        .on('start', (commandLine) => {
          console.log(`Starting DASH transcoding for ${job.qualityLevel.name}: ${commandLine}`);
        })
        .on('progress', (progress) => {
          job.progress = Math.round(progress.percent || 0);
          console.log(`DASH ${job.qualityLevel.name} progress: ${job.progress}%`);
        })
        .on('end', () => {
          console.log(`DASH transcoding completed for ${job.qualityLevel.name}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`DASH transcoding failed for ${job.qualityLevel.name}:`, err);
          reject(err);
        });

      // Store process reference
      this.activeJobs.set(job.id + '_dash', ffmpegProcess.ffmpegProc);

      ffmpegProcess.run();
    });
  }

  /**
   * Transcode to MP4 for fallback
   */
  private async transcodeToMP4(job: TranscodingJob): Promise<void> {
    const mp4Path = path.join(job.outputDir, job.qualityLevel.name, `video_${job.qualityLevel.name}.mp4`);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(job.sourceFile)
        .videoCodec(job.qualityLevel.codec)
        .size(`${job.qualityLevel.width}x${job.qualityLevel.height}`)
        .videoBitrate(job.qualityLevel.bitrate)
        .fps(job.qualityLevel.fps)
        .audioCodec('aac')
        .audioBitrate(128);

      // Add GPU acceleration if enabled
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      command = command.addOptions([
        '-preset', job.qualityLevel.preset,
        '-profile:v', job.qualityLevel.profile,
        '-movflags', '+faststart' // Enable progressive download
      ]);

      const ffmpegProcess = command
        .output(mp4Path)
        .on('start', (commandLine) => {
          console.log(`Starting MP4 transcoding for ${job.qualityLevel.name}: ${commandLine}`);
        })
        .on('progress', (progress) => {
          job.progress = Math.round(progress.percent || 0);
        })
        .on('end', () => {
          console.log(`MP4 transcoding completed for ${job.qualityLevel.name}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`MP4 transcoding failed for ${job.qualityLevel.name}:`, err);
          reject(err);
        });

      // Store process reference
      this.activeJobs.set(job.id + '_mp4', ffmpegProcess.ffmpegProc);

      ffmpegProcess.run();
    });
  }

  /**
   * Check if transcoding is complete for all quality levels
   */
  private async checkTranscodingCompletion(videoId: string): Promise<void> {
    // Check if all transcoding jobs for this video are complete
    const pendingJobs = this.transcodingQueue.filter(job => job.videoId === videoId);
    const activeVideoJobs = Array.from(this.activeJobs.keys()).filter(jobId => jobId.includes(videoId));

    if (pendingJobs.length === 0 && activeVideoJobs.length === 0) {
      // All transcoding complete, update video status
      await this.finalizeVideoProcessing(videoId);
    }
  }

  /**
   * Finalize video processing and create quality variants
   */
  private async finalizeVideoProcessing(videoId: string): Promise<void> {
    try {
      const outputDir = path.join(this.videoBasePath, videoId);
      const qualityVariants: VideoVariant[] = [];

      // Scan for generated quality variants
      const qualityDirs = await fs.readdir(outputDir);

      for (const qualityDir of qualityDirs) {
        if (qualityDir === 'thumbnails' || qualityDir === 'previews') continue;

        const qualityPath = path.join(outputDir, qualityDir);
        const qualityLevel = this.config.qualityLevels.find(q => q.name === qualityDir);

        if (!qualityLevel) continue;

        // Check for HLS
        const hlsPath = path.join(qualityPath, 'hls', 'playlist.m3u8');
        if (await this.fileExists(hlsPath)) {
          const stats = await fs.stat(hlsPath);
          qualityVariants.push({
            quality: qualityLevel.name,
            resolution: qualityLevel.resolution,
            bitrate: qualityLevel.bitrate,
            fps: qualityLevel.fps,
            codec: qualityLevel.codec,
            format: 'hls',
            url: `${this.publicVideoUrl}/${videoId}/${qualityLevel.name}/hls/playlist.m3u8`,
            size: stats.size,
            playlistUrl: `${this.publicVideoUrl}/${videoId}/${qualityLevel.name}/hls/playlist.m3u8`
          });
        }

        // Check for DASH
        const dashPath = path.join(qualityPath, 'dash', 'manifest.mpd');
        if (await this.fileExists(dashPath)) {
          const stats = await fs.stat(dashPath);
          qualityVariants.push({
            quality: qualityLevel.name,
            resolution: qualityLevel.resolution,
            bitrate: qualityLevel.bitrate,
            fps: qualityLevel.fps,
            codec: qualityLevel.codec,
            format: 'dash',
            url: `${this.publicVideoUrl}/${videoId}/${qualityLevel.name}/dash/manifest.mpd`,
            size: stats.size,
            playlistUrl: `${this.publicVideoUrl}/${videoId}/${qualityLevel.name}/dash/manifest.mpd`
          });
        }

        // Check for MP4
        const mp4Path = path.join(qualityPath, `video_${qualityLevel.name}.mp4`);
        if (await this.fileExists(mp4Path)) {
          const stats = await fs.stat(mp4Path);
          qualityVariants.push({
            quality: qualityLevel.name,
            resolution: qualityLevel.resolution,
            bitrate: qualityLevel.bitrate,
            fps: qualityLevel.fps,
            codec: qualityLevel.codec,
            format: 'mp4',
            url: `${this.publicVideoUrl}/${videoId}/${qualityLevel.name}/video_${qualityLevel.name}.mp4`,
            size: stats.size
          });
        }
      }

      // Update video with complete metadata
      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'ready',
          processedAt: new Date(),
          metadata: {
            qualityVariants,
            processingCompletedAt: new Date()
          }
        }
      });

      // Upload to CDN if enabled
      if (this.config.enableCDN) {
        await this.uploadToCDN(videoId, qualityVariants);
      }

      console.log(`Video processing completed for ${videoId} with ${qualityVariants.length} quality variants`);

    } catch (error) {
      console.error(`Failed to finalize video processing for ${videoId}:`, error);

      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'error',
          metadata: { error: 'Finalization failed' }
        }
      });
    }
  }

  /**
   * Upload transcoded files to CDN
   */
  private async uploadToCDN(videoId: string, qualityVariants: VideoVariant[]): Promise<void> {
    // Implementation depends on CDN provider
    // This is a placeholder for CDN upload logic
    console.log(`Uploading ${qualityVariants.length} variants to CDN for video ${videoId}`);
  }

  /**
   * Generate master playlist for adaptive streaming
   */
  async generateMasterPlaylist(videoId: string): Promise<{ success: boolean; playlist?: string; error?: string }> {
    try {
      const video = await db.video.findUnique({
        where: { id: videoId }
      });

      if (!video || video.status !== 'ready') {
        return { success: false, error: 'Video not ready' };
      }

      const qualityVariants = video.metadata?.qualityVariants as VideoVariant[] || [];
      const hlsVariants = qualityVariants.filter(v => v.format === 'hls');

      if (hlsVariants.length === 0) {
        return { success: false, error: 'No HLS variants available' };
      }

      let playlist = '#EXTM3U\n#EXT-X-VERSION:6\n\n';

      // Sort by bitrate descending
      hlsVariants.sort((a, b) => b.bitrate - a.bitrate);

      for (const variant of hlsVariants) {
        const resolution = variant.resolution.split('x');
        playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bitrate * 1000},RESOLUTION=${variant.resolution},FRAME-RATE=${variant.fps},CODECS="${this.getCodecString(variant.codec)}"\n`;
        playlist += `${variant.quality}/hls/playlist.m3u8\n\n`;
      }

      return { success: true, playlist };

    } catch (error) {
      console.error('Master playlist generation failed:', error);
      return { success: false, error: 'Playlist generation failed' };
    }
  }

  /**
   * Get suitable quality levels based on source resolution
   */
  private getSuitableQualities(sourceWidth: number, sourceHeight: number): QualityLevel[] {
    return this.config.qualityLevels.filter(quality =>
      quality.width <= sourceWidth && quality.height <= sourceHeight
    );
  }

  /**
   * Helper methods
   */
  private getFileExtension(filename: string): string {
    return path.extname(filename).slice(1);
  }

  private getMimeType(filename: string): string {
    const ext = this.getFileExtension(filename).toLowerCase();
    const mimeTypes = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'flv': 'video/x-flv',
      'm4v': 'video/x-m4v'
    };
    return mimeTypes[ext] || 'video/mp4';
  }

  private parseFps(frameRate: string): number {
    if (frameRate.includes('/')) {
      const [numerator, denominator] = frameRate.split('/').map(Number);
      return Math.round(numerator / denominator);
    }
    return parseInt(frameRate) || 30;
  }

  private getCodecString(codec: string): string {
    const codecMap = {
      'libx264': 'avc1.640028',
      'libx265': 'hev1.1.6.L93.90',
      'libvpx-vp9': 'vp09.00.10.08'
    };
    return codecMap[codec] || 'avc1.640028';
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get upload session status
   */
  async getUploadSessionStatus(sessionId: string): Promise<UploadSession | null> {
    try {
      const sessionData = await this.redis.get(`upload:session:${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      console.error('Failed to get upload session status:', error);
      return null;
    }
  }

  /**
   * Cancel upload session
   */
  async cancelUploadSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const sessionData = await this.redis.get(`upload:session:${sessionId}`);
      if (!sessionData) {
        return { success: false, error: 'Session not found' };
      }

      const session: UploadSession = JSON.parse(sessionData);

      // Clean up uploaded chunks
      for (let i = 0; i < session.chunks.length; i++) {
        const chunkPath = path.join(this.tempPath, 'uploads', `${sessionId}_chunk_${i}`);
        await fs.unlink(chunkPath).catch(() => {}); // Ignore errors if file doesn't exist
      }

      // Remove session from Redis
      await this.redis.del(`upload:session:${sessionId}`);

      // Update video status if exists
      if (session.videoId) {
        await db.video.update({
          where: { id: session.videoId },
          data: { status: 'error', metadata: { error: 'Upload cancelled' } }
        }).catch(() => {}); // Ignore errors if video doesn't exist
      }

      return { success: true };

    } catch (error) {
      console.error('Failed to cancel upload session:', error);
      return { success: false, error: 'Cancellation failed' };
    }
  }
}

export const enhancedVideoStreamingService = new EnhancedVideoStreamingService();
export type { VideoMetadata, VideoVariant, UploadSession, TranscodingJob, StreamingAnalytics };