import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { promisify } from 'util';
import { EventEmitter } from 'events';

export interface TranscodingProfile {
  name: string;
  resolution: string;
  bitrate: string;
  fps: number;
  codec: string;
  preset: string;
  audioCodec: string;
  audioBitrate: string;
}

export interface TranscodingJob {
  id: string;
  inputPath: string;
  outputPath: string;
  profiles: TranscodingProfile[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  metadata?: VideoMetadata;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  codec: string;
  audioCodec: string;
}

export class VideoTranscodingService extends EventEmitter {
  private activeJobs = new Map<string, TranscodingJob>();
  private ffmpegPath: string;
  private ffprobePath: string;
  private tempDir: string;

  constructor() {
    super();
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
    this.tempDir = process.env.TEMP_DIR || '/tmp/video-processing';
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    await fs.ensureDir(this.tempDir);
  }

  /**
   * Get video metadata using ffprobe
   */
  async getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        inputPath
      ];

      const ffprobe = spawn(this.ffprobePath, args);
      let output = '';
      let error = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        error += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${error}`));
          return;
        }

        try {
          const probe = JSON.parse(output);
          const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
          const audioStream = probe.streams.find((s: any) => s.codec_type === 'audio');

          const metadata: VideoMetadata = {
            duration: parseFloat(probe.format.duration),
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            framerate: eval(videoStream?.r_frame_rate) || 30,
            bitrate: parseInt(probe.format.bit_rate) || 0,
            codec: videoStream?.codec_name || 'unknown',
            audioCodec: audioStream?.codec_name || 'unknown'
          };

          resolve(metadata);
        } catch (parseError) {
          reject(new Error(`Failed to parse metadata: ${parseError}`));
        }
      });
    });
  }

  /**
   * Start transcoding job with multiple quality profiles
   */
  async startTranscoding(
    inputPath: string,
    outputDir: string,
    profiles: TranscodingProfile[],
    jobId: string = this.generateJobId()
  ): Promise<string> {
    const job: TranscodingJob = {
      id: jobId,
      inputPath,
      outputPath: outputDir,
      profiles,
      status: 'pending',
      progress: 0
    };

    this.activeJobs.set(jobId, job);

    try {
      // Get video metadata
      job.metadata = await this.getVideoMetadata(inputPath);
      job.status = 'processing';
      this.emit('jobStarted', job);

      await fs.ensureDir(outputDir);

      // Process each profile
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const outputPath = path.join(outputDir, `${profile.name}.m3u8`);

        await this.transcodeProfile(inputPath, outputPath, profile, job);

        job.progress = Math.round(((i + 1) / profiles.length) * 100);
        this.emit('jobProgress', job);
      }

      // Generate master playlist
      await this.generateMasterPlaylist(outputDir, profiles);

      // Generate thumbnails
      await this.generateThumbnails(inputPath, outputDir, job.metadata!);

      job.status = 'completed';
      this.emit('jobCompleted', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      this.emit('jobFailed', job);
      throw error;
    }

    return jobId;
  }

  /**
   * Transcode video for specific profile
   */
  private async transcodeProfile(
    inputPath: string,
    outputPath: string,
    profile: TranscodingProfile,
    job: TranscodingJob
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = this.buildFFmpegArgs(inputPath, outputPath, profile);
      const ffmpeg = spawn(this.ffmpegPath, args);

      let error = '';

      ffmpeg.stderr.on('data', (data) => {
        error += data.toString();

        // Parse progress from ffmpeg output
        const progressMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (progressMatch && job.metadata) {
          const hours = parseInt(progressMatch[1]);
          const minutes = parseInt(progressMatch[2]);
          const seconds = parseInt(progressMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const profileProgress = (currentTime / job.metadata.duration) * 100;

          // Emit progress update
          this.emit('profileProgress', {
            jobId: job.id,
            profile: profile.name,
            progress: Math.min(profileProgress, 100)
          });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg transcoding failed for ${profile.name}: ${error}`));
        }
      });
    });
  }

  /**
   * Build FFmpeg arguments for transcoding
   */
  private buildFFmpegArgs(inputPath: string, outputPath: string, profile: TranscodingProfile): string[] {
    const segmentDir = path.dirname(outputPath);
    const segmentName = path.basename(outputPath, '.m3u8');

    return [
      '-i', inputPath,
      '-c:v', profile.codec,
      '-preset', profile.preset,
      '-crf', '23',
      '-maxrate', profile.bitrate,
      '-bufsize', `${parseInt(profile.bitrate) * 2}k`,
      '-vf', `scale=-2:${profile.resolution.split('x')[1]}`,
      '-r', profile.fps.toString(),
      '-c:a', profile.audioCodec,
      '-b:a', profile.audioBitrate,
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_segment_filename', path.join(segmentDir, `${segmentName}_%03d.ts`),
      '-hls_flags', 'independent_segments',
      outputPath
    ];
  }

  /**
   * Generate master HLS playlist
   */
  private async generateMasterPlaylist(outputDir: string, profiles: TranscodingProfile[]): Promise<void> {
    let content = '#EXTM3U\n#EXT-X-VERSION:6\n\n';

    for (const profile of profiles) {
      const bandwidth = parseInt(profile.bitrate) * 1000 + parseInt(profile.audioBitrate) * 1000;
      const resolution = profile.resolution;

      content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="${this.getCodecString(profile)}"\n`;
      content += `${profile.name}.m3u8\n\n`;
    }

    await fs.writeFile(path.join(outputDir, 'master.m3u8'), content);
  }

  /**
   * Generate DASH manifest
   */
  async generateDashManifest(outputDir: string, profiles: TranscodingProfile[]): Promise<void> {
    const dashArgs = [
      '-f', 'dash',
      '-adaptation_sets', this.buildAdaptationSets(profiles),
      path.join(outputDir, 'manifest.mpd')
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, dashArgs);
      let error = '';

      ffmpeg.stderr.on('data', (data) => {
        error += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`DASH manifest generation failed: ${error}`));
        }
      });
    });
  }

  /**
   * Generate video thumbnails at intervals
   */
  async generateThumbnails(inputPath: string, outputDir: string, metadata: VideoMetadata): Promise<void> {
    const thumbnailDir = path.join(outputDir, 'thumbnails');
    await fs.ensureDir(thumbnailDir);

    const interval = Math.max(10, metadata.duration / 20); // Generate ~20 thumbnails
    const totalThumbnails = Math.floor(metadata.duration / interval);

    for (let i = 0; i < totalThumbnails; i++) {
      const timestamp = i * interval;
      const outputPath = path.join(thumbnailDir, `thumb_${String(i).padStart(3, '0')}.jpg`);

      await this.generateThumbnail(inputPath, outputPath, timestamp);
    }

    // Generate sprite sheet
    await this.generateSpriteSheet(thumbnailDir, outputDir);
  }

  /**
   * Generate single thumbnail at specific timestamp
   */
  private async generateThumbnail(inputPath: string, outputPath: string, timestamp: number): Promise<void> {
    const args = [
      '-i', inputPath,
      '-ss', timestamp.toString(),
      '-vframes', '1',
      '-vf', 'scale=160:90',
      '-y',
      outputPath
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Thumbnail generation failed at ${timestamp}s`));
        }
      });
    });
  }

  /**
   * Generate thumbnail sprite sheet
   */
  private async generateSpriteSheet(thumbnailDir: string, outputDir: string): Promise<void> {
    const thumbnails = await fs.readdir(thumbnailDir);
    const validThumbnails = thumbnails.filter(f => f.endsWith('.jpg')).sort();

    if (validThumbnails.length === 0) return;

    const cols = 5;
    const rows = Math.ceil(validThumbnails.length / cols);

    const inputPattern = path.join(thumbnailDir, 'thumb_%03d.jpg');
    const spriteOutput = path.join(outputDir, 'sprite.jpg');
    const vttOutput = path.join(outputDir, 'thumbnails.vtt');

    const args = [
      '-i', inputPattern,
      '-filter_complex', `tile=${cols}x${rows}`,
      '-y',
      spriteOutput
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          await this.generateThumbnailVTT(vttOutput, validThumbnails.length, cols);
          resolve();
        } else {
          reject(new Error('Sprite sheet generation failed'));
        }
      });
    });
  }

  /**
   * Extract and convert subtitles to WebVTT
   */
  async extractSubtitles(inputPath: string, outputDir: string): Promise<string[]> {
    const subtitleFormats = ['srt', 'ass', 'vtt'];
    const extractedFiles: string[] = [];

    for (let i = 0; i < 10; i++) { // Check first 10 subtitle streams
      for (const format of subtitleFormats) {
        const outputPath = path.join(outputDir, `subtitle_${i}.${format}`);

        try {
          await this.extractSubtitleStream(inputPath, outputPath, i);

          if (format !== 'vtt') {
            const vttPath = path.join(outputDir, `subtitle_${i}.vtt`);
            await this.convertToWebVTT(outputPath, vttPath);
            extractedFiles.push(vttPath);
          } else {
            extractedFiles.push(outputPath);
          }
        } catch (error) {
          // Stream might not exist, continue
          continue;
        }
      }
    }

    return extractedFiles;
  }

  /**
   * Extract specific subtitle stream
   */
  private async extractSubtitleStream(inputPath: string, outputPath: string, streamIndex: number): Promise<void> {
    const args = [
      '-i', inputPath,
      '-map', `0:s:${streamIndex}`,
      '-c', 'copy',
      '-y',
      outputPath
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Subtitle extraction failed for stream ${streamIndex}`));
        }
      });
    });
  }

  /**
   * Convert subtitle file to WebVTT
   */
  private async convertToWebVTT(inputPath: string, outputPath: string): Promise<void> {
    const args = [
      '-i', inputPath,
      '-c:s', 'webvtt',
      '-y',
      outputPath
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('WebVTT conversion failed'));
        }
      });
    });
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): TranscodingJob | null {
    return this.activeJobs.get(jobId) || null;
  }

  /**
   * Cancel transcoding job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === 'processing') {
      job.status = 'failed';
      job.error = 'Job cancelled by user';
      this.emit('jobCancelled', job);
    }
  }

  // Helper methods
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getCodecString(profile: TranscodingProfile): string {
    const videoCodec = profile.codec === 'libx264' ? 'avc1.640028' : 'hev1.1.6.L93.B0';
    const audioCodec = profile.audioCodec === 'aac' ? 'mp4a.40.2' : 'mp4a.40.5';
    return `"${videoCodec},${audioCodec}"`;
  }

  private buildAdaptationSets(profiles: TranscodingProfile[]): string {
    return profiles.map((profile, index) =>
      `id=${index},streams=v,descriptor=role,value=main`
    ).join(' ');
  }

  private async generateThumbnailVTT(outputPath: string, totalThumbnails: number, cols: number): Promise<void> {
    let vttContent = 'WEBVTT\n\n';

    for (let i = 0; i < totalThumbnails; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = col * 160;
      const y = row * 90;

      const startTime = i * 10; // 10 seconds per thumbnail
      const endTime = (i + 1) * 10;

      vttContent += `${this.formatTime(startTime)} --> ${this.formatTime(endTime)}\n`;
      vttContent += `sprite.jpg#xywh=${x},${y},160,90\n\n`;
    }

    await fs.writeFile(outputPath, vttContent);
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.000`;
  }
}

export default VideoTranscodingService;