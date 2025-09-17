import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import ffmpeg from 'fluent-ffmpeg';
import ffprobe from 'ffprobe-static';
import { Redis } from 'ioredis';
import db from '@/lib/db';

// Configure FFmpeg
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || 'ffmpeg');
ffmpeg.setFfprobePath(ffprobe.path);

interface TranscodingConfig {
  maxConcurrentJobs: number;
  enableGPUAcceleration: boolean;
  enableTwoPassEncoding: boolean;
  enableAudioNormalization: boolean;
  enableSceneDetection: boolean;
  outputFormats: ('hls' | 'dash' | 'mp4')[];
  hlsSegmentDuration: number;
  dashSegmentDuration: number;
  enableSubtitleExtraction: boolean;
  enableChapterExtraction: boolean;
  workingDirectory: string;
  tempDirectory: string;
}

interface QualityProfile {
  name: string;
  width: number;
  height: number;
  videoBitrate: number;
  audioBitrate: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  preset: string;
  profile: string;
  level: string;
  pixelFormat: string;
  gopSize: number;
  bFrames: number;
  minKeyframeInterval: number;
  maxKeyframeInterval: number;
}

interface TranscodingJob {
  id: string;
  videoId: string;
  inputFile: string;
  outputDirectory: string;
  qualityProfiles: QualityProfile[];
  formats: ('hls' | 'dash' | 'mp4')[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  currentProfile?: string;
  currentFormat?: string;
  startTime?: Date;
  endTime?: Date;
  error?: string;
  metadata?: VideoMetadata;
  priority: 'low' | 'medium' | 'high';
  retryCount: number;
  maxRetries: number;
}

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  aspectRatio: string;
  videoCodec: string;
  audioCodec: string;
  audioChannels: number;
  audioSampleRate: number;
  hasSubtitles: boolean;
  subtitleTracks: SubtitleTrack[];
  chapters: Chapter[];
}

interface SubtitleTrack {
  index: number;
  language: string;
  title?: string;
  codec: string;
  disposition: {
    default: boolean;
    forced: boolean;
  };
}

interface Chapter {
  id: string;
  timeBase: string;
  start: number;
  end: number;
  title?: string;
}

interface TranscodingProgress {
  jobId: string;
  profile: string;
  format: string;
  framesProcessed: number;
  fps: number;
  quality: number;
  size: string;
  time: string;
  bitrate: string;
  speed: string;
  progress: number;
}

interface TranscodingResult {
  jobId: string;
  success: boolean;
  outputFiles: OutputFile[];
  metadata: VideoMetadata;
  duration: number;
  error?: string;
}

interface OutputFile {
  profile: string;
  format: string;
  path: string;
  size: number;
  bitrate: number;
  segments?: number;
  manifestUrl?: string;
}

class VideoTranscodingService extends EventEmitter {
  private config: TranscodingConfig;
  private redis: Redis;
  private jobQueue: TranscodingJob[] = [];
  private runningJobs = new Map<string, ChildProcess>();
  private qualityProfiles: QualityProfile[];
  private isProcessing = false;

  constructor(config?: Partial<TranscodingConfig>) {
    super();

    this.config = {
      maxConcurrentJobs: 3,
      enableGPUAcceleration: process.env.ENABLE_GPU_ACCELERATION === 'true',
      enableTwoPassEncoding: process.env.ENABLE_TWO_PASS === 'true',
      enableAudioNormalization: true,
      enableSceneDetection: false,
      outputFormats: ['hls', 'dash', 'mp4'],
      hlsSegmentDuration: 4,
      dashSegmentDuration: 4,
      enableSubtitleExtraction: true,
      enableChapterExtraction: true,
      workingDirectory: process.env.VIDEO_STORAGE_PATH || './storage/videos',
      tempDirectory: process.env.TEMP_STORAGE_PATH || './storage/temp',
      ...config
    };

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100
    });

    this.qualityProfiles = this.initializeQualityProfiles();
    this.startJobProcessor();
  }

  private initializeQualityProfiles(): QualityProfile[] {
    return [
      {
        name: '240p',
        width: 426,
        height: 240,
        videoBitrate: 400,
        audioBitrate: 64,
        fps: 24,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'fast',
        profile: 'baseline',
        level: '3.0',
        pixelFormat: 'yuv420p',
        gopSize: 48,
        bFrames: 0,
        minKeyframeInterval: 24,
        maxKeyframeInterval: 48
      },
      {
        name: '360p',
        width: 640,
        height: 360,
        videoBitrate: 800,
        audioBitrate: 96,
        fps: 24,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'fast',
        profile: 'main',
        level: '3.1',
        pixelFormat: 'yuv420p',
        gopSize: 48,
        bFrames: 2,
        minKeyframeInterval: 24,
        maxKeyframeInterval: 48
      },
      {
        name: '480p',
        width: 854,
        height: 480,
        videoBitrate: 1200,
        audioBitrate: 128,
        fps: 30,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium',
        profile: 'main',
        level: '3.1',
        pixelFormat: 'yuv420p',
        gopSize: 60,
        bFrames: 3,
        minKeyframeInterval: 30,
        maxKeyframeInterval: 60
      },
      {
        name: '720p',
        width: 1280,
        height: 720,
        videoBitrate: 2500,
        audioBitrate: 128,
        fps: 30,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium',
        profile: 'high',
        level: '4.0',
        pixelFormat: 'yuv420p',
        gopSize: 60,
        bFrames: 3,
        minKeyframeInterval: 30,
        maxKeyframeInterval: 60
      },
      {
        name: '1080p',
        width: 1920,
        height: 1080,
        videoBitrate: 5000,
        audioBitrate: 192,
        fps: 30,
        videoCodec: 'libx264',
        audioCodec: 'aac',
        preset: 'medium',
        profile: 'high',
        level: '4.0',
        pixelFormat: 'yuv420p',
        gopSize: 60,
        bFrames: 3,
        minKeyframeInterval: 30,
        maxKeyframeInterval: 60
      },
      {
        name: '1440p',
        width: 2560,
        height: 1440,
        videoBitrate: 8000,
        audioBitrate: 192,
        fps: 30,
        videoCodec: 'libx265',
        audioCodec: 'aac',
        preset: 'slow',
        profile: 'main',
        level: '5.0',
        pixelFormat: 'yuv420p',
        gopSize: 60,
        bFrames: 4,
        minKeyframeInterval: 30,
        maxKeyframeInterval: 60
      },
      {
        name: '4K',
        width: 3840,
        height: 2160,
        videoBitrate: 15000,
        audioBitrate: 256,
        fps: 30,
        videoCodec: 'libx265',
        audioCodec: 'aac',
        preset: 'slow',
        profile: 'main',
        level: '5.1',
        pixelFormat: 'yuv420p',
        gopSize: 60,
        bFrames: 4,
        minKeyframeInterval: 30,
        maxKeyframeInterval: 60
      }
    ];
  }

  /**
   * Create transcoding job
   */
  async createTranscodingJob(
    videoId: string,
    inputFile: string,
    options: {
      qualityProfiles?: string[];
      formats?: ('hls' | 'dash' | 'mp4')[];
      priority?: 'low' | 'medium' | 'high';
    } = {}
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      // Validate input file
      const fileExists = await this.fileExists(inputFile);
      if (!fileExists) {
        return { success: false, error: 'Input file not found' };
      }

      // Extract metadata
      const metadata = await this.extractMetadata(inputFile);

      // Determine suitable quality profiles
      const suitableProfiles = this.getSuitableProfiles(
        metadata.width,
        metadata.height,
        options.qualityProfiles
      );

      if (suitableProfiles.length === 0) {
        return { success: false, error: 'No suitable quality profiles found' };
      }

      const outputDirectory = path.join(this.config.workingDirectory, videoId);
      await fs.mkdir(outputDirectory, { recursive: true });

      const job: TranscodingJob = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        videoId,
        inputFile,
        outputDirectory,
        qualityProfiles: suitableProfiles,
        formats: options.formats || this.config.outputFormats,
        status: 'queued',
        progress: 0,
        priority: options.priority || 'medium',
        retryCount: 0,
        maxRetries: 3,
        metadata
      };

      // Add to queue
      this.addJobToQueue(job);

      // Store in Redis for persistence
      await this.redis.setex(
        `transcoding:job:${job.id}`,
        7 * 24 * 60 * 60, // 7 days TTL
        JSON.stringify(job)
      );

      // Update video status
      await db.video.update({
        where: { id: videoId },
        data: {
          status: 'transcoding',
          metadata: {
            transcodingJobId: job.id,
            inputMetadata: metadata
          }
        }
      });

      this.emit('jobCreated', job);
      return { success: true, jobId: job.id };

    } catch (error) {
      console.error('Failed to create transcoding job:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract video metadata using FFprobe
   */
  private async extractMetadata(inputFile: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputFile)
        .ffprobe((err, metadata) => {
          if (err) {
            reject(new Error(`FFprobe failed: ${err.message}`));
            return;
          }

          try {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            const subtitleStreams = metadata.streams.filter(s => s.codec_type === 'subtitle');

            if (!videoStream) {
              reject(new Error('No video stream found'));
              return;
            }

            const fps = this.parseFps(videoStream.r_frame_rate || '30/1');
            const duration = parseFloat(metadata.format.duration || '0');

            const result: VideoMetadata = {
              duration,
              width: videoStream.width || 0,
              height: videoStream.height || 0,
              bitrate: parseInt(metadata.format.bit_rate || '0'),
              fps,
              aspectRatio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`,
              videoCodec: videoStream.codec_name || 'unknown',
              audioCodec: audioStream?.codec_name || 'none',
              audioChannels: audioStream?.channels || 0,
              audioSampleRate: parseInt(audioStream?.sample_rate || '0'),
              hasSubtitles: subtitleStreams.length > 0,
              subtitleTracks: subtitleStreams.map(stream => ({
                index: stream.index,
                language: stream.tags?.language || 'unknown',
                title: stream.tags?.title,
                codec: stream.codec_name,
                disposition: {
                  default: stream.disposition?.default === 1,
                  forced: stream.disposition?.forced === 1
                }
              })),
              chapters: this.extractChapters(metadata.chapters || [])
            };

            resolve(result);

          } catch (parseError) {
            reject(new Error(`Metadata parsing failed: ${parseError.message}`));
          }
        });
    });
  }

  /**
   * Extract chapters from metadata
   */
  private extractChapters(chapters: any[]): Chapter[] {
    return chapters.map((chapter, index) => ({
      id: `chapter_${index}`,
      timeBase: chapter.time_base || '1/1000',
      start: parseFloat(chapter.start_time || '0'),
      end: parseFloat(chapter.end_time || '0'),
      title: chapter.tags?.title || `Chapter ${index + 1}`
    }));
  }

  /**
   * Get suitable quality profiles based on source resolution
   */
  private getSuitableProfiles(
    sourceWidth: number,
    sourceHeight: number,
    requestedProfiles?: string[]
  ): QualityProfile[] {
    let profiles = this.qualityProfiles.filter(
      profile => profile.width <= sourceWidth && profile.height <= sourceHeight
    );

    if (requestedProfiles && requestedProfiles.length > 0) {
      profiles = profiles.filter(profile =>
        requestedProfiles.includes(profile.name)
      );
    }

    // Always include at least one profile (lowest quality that fits)
    if (profiles.length === 0 && this.qualityProfiles.length > 0) {
      const lowestProfile = this.qualityProfiles
        .filter(p => p.width <= sourceWidth && p.height <= sourceHeight)
        .sort((a, b) => a.width - b.width)[0];

      if (lowestProfile) {
        profiles = [lowestProfile];
      }
    }

    // Sort by bitrate ascending for better streaming
    return profiles.sort((a, b) => a.videoBitrate - b.videoBitrate);
  }

  /**
   * Add job to queue with priority
   */
  private addJobToQueue(job: TranscodingJob): void {
    const priorityOrder = { high: 0, medium: 1, low: 2 };

    // Insert job based on priority
    let insertIndex = this.jobQueue.length;
    for (let i = 0; i < this.jobQueue.length; i++) {
      if (priorityOrder[job.priority] < priorityOrder[this.jobQueue[i].priority]) {
        insertIndex = i;
        break;
      }
    }

    this.jobQueue.splice(insertIndex, 0, job);
    this.processQueue();
  }

  /**
   * Start job processor
   */
  private startJobProcessor(): void {
    setInterval(() => {
      if (!this.isProcessing) {
        this.processQueue();
      }
    }, 1000);
  }

  /**
   * Process job queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.runningJobs.size >= this.config.maxConcurrentJobs) {
      return;
    }

    const job = this.jobQueue.find(j => j.status === 'queued');
    if (!job) {
      return;
    }

    this.isProcessing = true;

    try {
      job.status = 'running';
      job.startTime = new Date();
      await this.updateJobInRedis(job);

      this.emit('jobStarted', job);
      await this.processJob(job);

    } catch (error) {
      console.error(`Job processing failed: ${error.message}`);
      await this.handleJobError(job, error.message);
    } finally {
      this.isProcessing = false;
      this.processQueue(); // Process next job
    }
  }

  /**
   * Process individual transcoding job
   */
  private async processJob(job: TranscodingJob): Promise<void> {
    const outputFiles: OutputFile[] = [];
    let totalSteps = job.qualityProfiles.length * job.formats.length;
    let completedSteps = 0;

    try {
      // Process each quality profile
      for (const profile of job.qualityProfiles) {
        job.currentProfile = profile.name;
        const profileOutputDir = path.join(job.outputDirectory, profile.name);
        await fs.mkdir(profileOutputDir, { recursive: true });

        // Process each format
        for (const format of job.formats) {
          job.currentFormat = format;
          await this.updateJobInRedis(job);

          const result = await this.transcodeFormat(job, profile, format, profileOutputDir);

          if (result.success) {
            outputFiles.push(...result.outputFiles);
          } else {
            throw new Error(`${format.toUpperCase()} transcoding failed: ${result.error}`);
          }

          completedSteps++;
          job.progress = Math.round((completedSteps / totalSteps) * 100);
          await this.updateJobInRedis(job);

          this.emit('progress', {
            jobId: job.id,
            profile: profile.name,
            format,
            progress: job.progress
          } as TranscodingProgress);
        }
      }

      // Extract subtitles if enabled
      if (this.config.enableSubtitleExtraction && job.metadata.hasSubtitles) {
        await this.extractSubtitles(job);
      }

      // Job completed successfully
      job.status = 'completed';
      job.endTime = new Date();
      job.progress = 100;

      await this.updateJobInRedis(job);

      const result: TranscodingResult = {
        jobId: job.id,
        success: true,
        outputFiles,
        metadata: job.metadata,
        duration: (job.endTime.getTime() - job.startTime!.getTime()) / 1000
      };

      // Update video status
      await db.video.update({
        where: { id: job.videoId },
        data: {
          status: 'ready',
          processedAt: new Date(),
          metadata: {
            outputFiles,
            transcodingDuration: result.duration,
            completedAt: new Date()
          }
        }
      });

      this.emit('jobCompleted', result);

      // Remove from running jobs
      if (this.runningJobs.has(job.id)) {
        this.runningJobs.delete(job.id);
      }

      // Remove from queue
      const queueIndex = this.jobQueue.findIndex(j => j.id === job.id);
      if (queueIndex !== -1) {
        this.jobQueue.splice(queueIndex, 1);
      }

    } catch (error) {
      await this.handleJobError(job, error.message);
    }
  }

  /**
   * Transcode to specific format
   */
  private async transcodeFormat(
    job: TranscodingJob,
    profile: QualityProfile,
    format: 'hls' | 'dash' | 'mp4',
    outputDir: string
  ): Promise<{ success: boolean; outputFiles: OutputFile[]; error?: string }> {
    switch (format) {
      case 'hls':
        return await this.transcodeToHLS(job, profile, outputDir);
      case 'dash':
        return await this.transcodeToDASH(job, profile, outputDir);
      case 'mp4':
        return await this.transcodeToMP4(job, profile, outputDir);
      default:
        return { success: false, outputFiles: [], error: `Unsupported format: ${format}` };
    }
  }

  /**
   * Transcode to HLS
   */
  private async transcodeToHLS(
    job: TranscodingJob,
    profile: QualityProfile,
    outputDir: string
  ): Promise<{ success: boolean; outputFiles: OutputFile[]; error?: string }> {
    const hlsDir = path.join(outputDir, 'hls');
    await fs.mkdir(hlsDir, { recursive: true });

    const playlistPath = path.join(hlsDir, 'playlist.m3u8');
    const segmentPattern = path.join(hlsDir, 'segment_%03d.ts');

    return new Promise((resolve) => {
      let command = ffmpeg(job.inputFile);

      // Input options
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      // Video encoding options
      command = command
        .videoCodec(profile.videoCodec)
        .size(`${profile.width}x${profile.height}`)
        .videoBitrate(profile.videoBitrate)
        .fps(profile.fps)
        .addOptions([
          '-preset', profile.preset,
          '-profile:v', profile.profile,
          '-level:v', profile.level,
          '-pix_fmt', profile.pixelFormat,
          '-g', profile.gopSize.toString(),
          '-bf', profile.bFrames.toString(),
          '-keyint_min', profile.minKeyframeInterval.toString(),
          '-sc_threshold', '0'
        ]);

      // Audio encoding options
      command = command
        .audioCodec(profile.audioCodec)
        .audioBitrate(profile.audioBitrate);

      // Audio normalization
      if (this.config.enableAudioNormalization) {
        command = command.audioFilters('loudnorm');
      }

      // HLS specific options
      command = command.addOptions([
        '-f', 'hls',
        '-hls_time', this.config.hlsSegmentDuration.toString(),
        '-hls_list_size', '0',
        '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', segmentPattern,
        '-hls_flags', 'independent_segments'
      ]);

      const ffmpegProcess = command
        .output(playlistPath)
        .on('start', (commandLine) => {
          console.log(`Starting HLS transcoding for ${profile.name}: ${commandLine}`);
          this.runningJobs.set(job.id, ffmpegProcess.ffmpegProc);
        })
        .on('progress', (progress) => {
          // Update progress based on time processed
          if (job.metadata.duration > 0) {
            const timeProgress = this.parseTime(progress.timemark) / job.metadata.duration;
            const currentStepProgress = Math.min(timeProgress * 100, 100);

            this.emit('progress', {
              jobId: job.id,
              profile: profile.name,
              format: 'hls',
              framesProcessed: progress.frames,
              fps: parseFloat(progress.currentFps),
              quality: parseFloat(progress.currentKbps),
              size: progress.targetSize,
              time: progress.timemark,
              bitrate: progress.currentKbps,
              speed: progress.speed,
              progress: currentStepProgress
            } as TranscodingProgress);
          }
        })
        .on('end', async () => {
          try {
            // Count segments and get file size
            const files = await fs.readdir(hlsDir);
            const segmentFiles = files.filter(f => f.endsWith('.ts'));
            const playlistStats = await fs.stat(playlistPath);

            const outputFile: OutputFile = {
              profile: profile.name,
              format: 'hls',
              path: playlistPath,
              size: playlistStats.size,
              bitrate: profile.videoBitrate + profile.audioBitrate,
              segments: segmentFiles.length,
              manifestUrl: playlistPath
            };

            console.log(`HLS transcoding completed for ${profile.name}: ${segmentFiles.length} segments`);
            resolve({ success: true, outputFiles: [outputFile] });

          } catch (error) {
            console.error(`HLS post-processing failed for ${profile.name}:`, error);
            resolve({ success: false, outputFiles: [], error: error.message });
          }
        })
        .on('error', (err) => {
          console.error(`HLS transcoding failed for ${profile.name}:`, err);
          resolve({ success: false, outputFiles: [], error: err.message });
        });

      ffmpegProcess.run();
    });
  }

  /**
   * Transcode to DASH
   */
  private async transcodeToDASH(
    job: TranscodingJob,
    profile: QualityProfile,
    outputDir: string
  ): Promise<{ success: boolean; outputFiles: OutputFile[]; error?: string }> {
    const dashDir = path.join(outputDir, 'dash');
    await fs.mkdir(dashDir, { recursive: true });

    const manifestPath = path.join(dashDir, 'manifest.mpd');

    return new Promise((resolve) => {
      let command = ffmpeg(job.inputFile);

      // Input options
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      // Video encoding options
      command = command
        .videoCodec(profile.videoCodec)
        .size(`${profile.width}x${profile.height}`)
        .videoBitrate(profile.videoBitrate)
        .fps(profile.fps)
        .addOptions([
          '-preset', profile.preset,
          '-profile:v', profile.profile,
          '-level:v', profile.level,
          '-pix_fmt', profile.pixelFormat,
          '-g', profile.gopSize.toString(),
          '-bf', profile.bFrames.toString(),
          '-keyint_min', profile.minKeyframeInterval.toString(),
          '-sc_threshold', '0'
        ]);

      // Audio encoding options
      command = command
        .audioCodec(profile.audioCodec)
        .audioBitrate(profile.audioBitrate);

      // Audio normalization
      if (this.config.enableAudioNormalization) {
        command = command.audioFilters('loudnorm');
      }

      // DASH specific options
      command = command.addOptions([
        '-f', 'dash',
        '-seg_duration', this.config.dashSegmentDuration.toString(),
        '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
        '-init_seg_name', 'init_$RepresentationID$.m4s',
        '-media_seg_name', 'chunk_$RepresentationID$_$Number$.m4s',
        '-single_file', '0',
        '-dash_segment_type', 'mp4'
      ]);

      const ffmpegProcess = command
        .output(manifestPath)
        .on('start', (commandLine) => {
          console.log(`Starting DASH transcoding for ${profile.name}: ${commandLine}`);
          this.runningJobs.set(job.id + '_dash', ffmpegProcess.ffmpegProc);
        })
        .on('progress', (progress) => {
          if (job.metadata.duration > 0) {
            const timeProgress = this.parseTime(progress.timemark) / job.metadata.duration;
            const currentStepProgress = Math.min(timeProgress * 100, 100);

            this.emit('progress', {
              jobId: job.id,
              profile: profile.name,
              format: 'dash',
              framesProcessed: progress.frames,
              fps: parseFloat(progress.currentFps),
              quality: parseFloat(progress.currentKbps),
              size: progress.targetSize,
              time: progress.timemark,
              bitrate: progress.currentKbps,
              speed: progress.speed,
              progress: currentStepProgress
            } as TranscodingProgress);
          }
        })
        .on('end', async () => {
          try {
            // Count segments and get file size
            const files = await fs.readdir(dashDir);
            const segmentFiles = files.filter(f => f.endsWith('.m4s'));
            const manifestStats = await fs.stat(manifestPath);

            const outputFile: OutputFile = {
              profile: profile.name,
              format: 'dash',
              path: manifestPath,
              size: manifestStats.size,
              bitrate: profile.videoBitrate + profile.audioBitrate,
              segments: segmentFiles.length,
              manifestUrl: manifestPath
            };

            console.log(`DASH transcoding completed for ${profile.name}: ${segmentFiles.length} segments`);
            resolve({ success: true, outputFiles: [outputFile] });

          } catch (error) {
            console.error(`DASH post-processing failed for ${profile.name}:`, error);
            resolve({ success: false, outputFiles: [], error: error.message });
          }
        })
        .on('error', (err) => {
          console.error(`DASH transcoding failed for ${profile.name}:`, err);
          resolve({ success: false, outputFiles: [], error: err.message });
        });

      ffmpegProcess.run();
    });
  }

  /**
   * Transcode to MP4
   */
  private async transcodeToMP4(
    job: TranscodingJob,
    profile: QualityProfile,
    outputDir: string
  ): Promise<{ success: boolean; outputFiles: OutputFile[]; error?: string }> {
    const mp4Path = path.join(outputDir, `video_${profile.name}.mp4`);

    return new Promise((resolve) => {
      let command = ffmpeg(job.inputFile);

      // Input options
      if (this.config.enableGPUAcceleration) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }

      // Two-pass encoding for better quality
      if (this.config.enableTwoPassEncoding) {
        const passLogFile = path.join(this.config.tempDirectory, `pass_${job.id}_${profile.name}`);

        // First pass
        const firstPassCommand = ffmpeg(job.inputFile)
          .videoCodec(profile.videoCodec)
          .size(`${profile.width}x${profile.height}`)
          .videoBitrate(profile.videoBitrate)
          .fps(profile.fps)
          .addOptions([
            '-preset', profile.preset,
            '-profile:v', profile.profile,
            '-level:v', profile.level,
            '-pix_fmt', profile.pixelFormat,
            '-g', profile.gopSize.toString(),
            '-bf', profile.bFrames.toString(),
            '-pass', '1',
            '-passlogfile', passLogFile,
            '-f', 'null'
          ]);

        if (this.config.enableGPUAcceleration) {
          firstPassCommand.inputOptions(['-hwaccel', 'auto']);
        }

        // Execute first pass
        firstPassCommand
          .output('/dev/null')
          .on('end', () => {
            // Second pass
            command = command
              .videoCodec(profile.videoCodec)
              .size(`${profile.width}x${profile.height}`)
              .videoBitrate(profile.videoBitrate)
              .fps(profile.fps)
              .audioCodec(profile.audioCodec)
              .audioBitrate(profile.audioBitrate)
              .addOptions([
                '-preset', profile.preset,
                '-profile:v', profile.profile,
                '-level:v', profile.level,
                '-pix_fmt', profile.pixelFormat,
                '-g', profile.gopSize.toString(),
                '-bf', profile.bFrames.toString(),
                '-pass', '2',
                '-passlogfile', passLogFile,
                '-movflags', '+faststart'
              ]);

            // Audio normalization
            if (this.config.enableAudioNormalization) {
              command = command.audioFilters('loudnorm');
            }

            this.executeMP4Command(command, mp4Path, job, profile, resolve);
          })
          .on('error', (err) => {
            console.error(`First pass failed for ${profile.name}:`, err);
            resolve({ success: false, outputFiles: [], error: err.message });
          })
          .run();

      } else {
        // Single pass encoding
        command = command
          .videoCodec(profile.videoCodec)
          .size(`${profile.width}x${profile.height}`)
          .videoBitrate(profile.videoBitrate)
          .fps(profile.fps)
          .audioCodec(profile.audioCodec)
          .audioBitrate(profile.audioBitrate)
          .addOptions([
            '-preset', profile.preset,
            '-profile:v', profile.profile,
            '-level:v', profile.level,
            '-pix_fmt', profile.pixelFormat,
            '-g', profile.gopSize.toString(),
            '-bf', profile.bFrames.toString(),
            '-movflags', '+faststart'
          ]);

        // Audio normalization
        if (this.config.enableAudioNormalization) {
          command = command.audioFilters('loudnorm');
        }

        this.executeMP4Command(command, mp4Path, job, profile, resolve);
      }
    });
  }

  /**
   * Execute MP4 command
   */
  private executeMP4Command(
    command: ffmpeg.FfmpegCommand,
    outputPath: string,
    job: TranscodingJob,
    profile: QualityProfile,
    resolve: Function
  ): void {
    const ffmpegProcess = command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log(`Starting MP4 transcoding for ${profile.name}: ${commandLine}`);
        this.runningJobs.set(job.id + '_mp4', ffmpegProcess.ffmpegProc);
      })
      .on('progress', (progress) => {
        if (job.metadata.duration > 0) {
          const timeProgress = this.parseTime(progress.timemark) / job.metadata.duration;
          const currentStepProgress = Math.min(timeProgress * 100, 100);

          this.emit('progress', {
            jobId: job.id,
            profile: profile.name,
            format: 'mp4',
            framesProcessed: progress.frames,
            fps: parseFloat(progress.currentFps),
            quality: parseFloat(progress.currentKbps),
            size: progress.targetSize,
            time: progress.timemark,
            bitrate: progress.currentKbps,
            speed: progress.speed,
            progress: currentStepProgress
          } as TranscodingProgress);
        }
      })
      .on('end', async () => {
        try {
          const stats = await fs.stat(outputPath);

          const outputFile: OutputFile = {
            profile: profile.name,
            format: 'mp4',
            path: outputPath,
            size: stats.size,
            bitrate: profile.videoBitrate + profile.audioBitrate
          };

          console.log(`MP4 transcoding completed for ${profile.name}: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
          resolve({ success: true, outputFiles: [outputFile] });

        } catch (error) {
          console.error(`MP4 post-processing failed for ${profile.name}:`, error);
          resolve({ success: false, outputFiles: [], error: error.message });
        }
      })
      .on('error', (err) => {
        console.error(`MP4 transcoding failed for ${profile.name}:`, err);
        resolve({ success: false, outputFiles: [], error: err.message });
      });

    ffmpegProcess.run();
  }

  /**
   * Extract subtitles from source
   */
  private async extractSubtitles(job: TranscodingJob): Promise<void> {
    if (!job.metadata.hasSubtitles) {
      return;
    }

    const subtitlesDir = path.join(job.outputDirectory, 'subtitles');
    await fs.mkdir(subtitlesDir, { recursive: true });

    for (const track of job.metadata.subtitleTracks) {
      try {
        const outputPath = path.join(subtitlesDir, `subtitle_${track.index}_${track.language}.vtt`);

        await new Promise<void>((resolve, reject) => {
          ffmpeg(job.inputFile)
            .outputOptions([
              '-map', `0:s:${track.index}`,
              '-c:s', 'webvtt'
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });

        console.log(`Extracted subtitle track ${track.index} (${track.language}) to WebVTT`);

      } catch (error) {
        console.error(`Failed to extract subtitle track ${track.index}:`, error);
      }
    }
  }

  /**
   * Handle job error
   */
  private async handleJobError(job: TranscodingJob, errorMessage: string): Promise<void> {
    job.error = errorMessage;
    job.retryCount++;

    if (job.retryCount <= job.maxRetries) {
      // Retry job
      job.status = 'queued';
      job.progress = 0;
      console.log(`Retrying job ${job.id}, attempt ${job.retryCount}/${job.maxRetries}`);
      await this.updateJobInRedis(job);
    } else {
      // Mark as failed
      job.status = 'failed';
      job.endTime = new Date();
      await this.updateJobInRedis(job);

      // Update video status
      await db.video.update({
        where: { id: job.videoId },
        data: {
          status: 'error',
          metadata: { error: errorMessage }
        }
      });

      this.emit('jobFailed', { jobId: job.id, error: errorMessage });

      // Remove from running jobs and queue
      if (this.runningJobs.has(job.id)) {
        const process = this.runningJobs.get(job.id);
        process?.kill('SIGTERM');
        this.runningJobs.delete(job.id);
      }

      const queueIndex = this.jobQueue.findIndex(j => j.id === job.id);
      if (queueIndex !== -1) {
        this.jobQueue.splice(queueIndex, 1);
      }
    }
  }

  /**
   * Update job in Redis
   */
  private async updateJobInRedis(job: TranscodingJob): Promise<void> {
    try {
      await this.redis.setex(
        `transcoding:job:${job.id}`,
        7 * 24 * 60 * 60, // 7 days TTL
        JSON.stringify(job)
      );
    } catch (error) {
      console.error('Failed to update job in Redis:', error);
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<TranscodingJob | null> {
    try {
      const jobData = await this.redis.get(`transcoding:job:${jobId}`);
      return jobData ? JSON.parse(jobData) : null;
    } catch (error) {
      console.error('Failed to get job status:', error);
      return null;
    }
  }

  /**
   * Cancel job
   */
  async cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const job = await this.getJobStatus(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      if (job.status === 'completed' || job.status === 'failed') {
        return { success: false, error: 'Job already finished' };
      }

      // Kill running processes
      const processKeys = [`${jobId}`, `${jobId}_dash`, `${jobId}_mp4`];
      for (const key of processKeys) {
        if (this.runningJobs.has(key)) {
          const process = this.runningJobs.get(key);
          process?.kill('SIGTERM');
          this.runningJobs.delete(key);
        }
      }

      // Update job status
      job.status = 'cancelled';
      job.endTime = new Date();
      await this.updateJobInRedis(job);

      // Remove from queue
      const queueIndex = this.jobQueue.findIndex(j => j.id === jobId);
      if (queueIndex !== -1) {
        this.jobQueue.splice(queueIndex, 1);
      }

      this.emit('jobCancelled', { jobId });
      return { success: true };

    } catch (error) {
      console.error('Failed to cancel job:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Utility methods
   */
  private parseFps(frameRate: string): number {
    if (frameRate.includes('/')) {
      const [numerator, denominator] = frameRate.split('/').map(Number);
      return Math.round(numerator / denominator);
    }
    return parseInt(frameRate) || 30;
  }

  private parseTime(timeString: string): number {
    const parts = timeString.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
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
   * Get queue status
   */
  getQueueStatus(): { queued: number; running: number; total: number } {
    const queued = this.jobQueue.filter(j => j.status === 'queued').length;
    const running = this.runningJobs.size;
    return { queued, running, total: this.jobQueue.length };
  }

  /**
   * Get transcoding statistics
   */
  async getStatistics(): Promise<{
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    averageProcessingTime: number;
  }> {
    try {
      const keys = await this.redis.keys('transcoding:job:*');
      const jobs = await Promise.all(
        keys.map(async (key) => {
          const data = await this.redis.get(key);
          return data ? JSON.parse(data) : null;
        })
      );

      const validJobs = jobs.filter(j => j !== null);
      const completedJobs = validJobs.filter(j => j.status === 'completed');
      const failedJobs = validJobs.filter(j => j.status === 'failed');

      const processingTimes = completedJobs
        .filter(j => j.startTime && j.endTime)
        .map(j => new Date(j.endTime).getTime() - new Date(j.startTime).getTime());

      const averageProcessingTime = processingTimes.length > 0
        ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length / 1000
        : 0;

      return {
        totalJobs: validJobs.length,
        completedJobs: completedJobs.length,
        failedJobs: failedJobs.length,
        averageProcessingTime: Math.round(averageProcessingTime)
      };

    } catch (error) {
      console.error('Failed to get statistics:', error);
      return {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        averageProcessingTime: 0
      };
    }
  }
}

export default VideoTranscodingService;
export type {
  TranscodingConfig,
  QualityProfile,
  TranscodingJob,
  VideoMetadata,
  TranscodingProgress,
  TranscodingResult,
  OutputFile
};