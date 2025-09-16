import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { EventEmitter } from 'events';
import db from '@/lib/db';
import { Redis } from 'ioredis';
import archiver from 'archiver';
import { videoStreamingService } from '@/services/videoStreamingService';

interface OfflinePackage {
  id: string;
  userId: string;
  videoId: string;
  courseId?: string;
  lessonId?: string;
  title: string;
  description?: string;
  quality: string;
  format: 'hls' | 'dash' | 'mp4';
  status: 'preparing' | 'packaging' | 'ready' | 'expired' | 'error';
  createdAt: Date;
  expiresAt: Date;
  downloadUrl?: string;
  packageSize: number;
  encryptionKey?: string;
  drmKeyId?: string;
  includeSubtitles: boolean;
  includeChapters: boolean;
  includeNotes: boolean;
  downloadCount: number;
  maxDownloads: number;
  metadata?: Record<string, any>;
}

interface DRMInfo {
  keyId: string;
  key: string;
  algorithm: 'AES-128' | 'AES-256';
  method: 'CBC' | 'CTR' | 'GCM';
  iv: string;
  pssh?: string; // Protection System Specific Header for Widevine/PlayReady
}

interface OfflineManifest {
  packageId: string;
  version: '1.0';
  title: string;
  description?: string;
  createdAt: string;
  expiresAt: string;
  video: {
    id: string;
    title: string;
    duration: number;
    format: string;
    quality: string;
    files: OfflineVideoFile[];
  };
  subtitles?: OfflineSubtitleFile[];
  chapters?: OfflineChapter[];
  notes?: OfflineNote[];
  drm?: DRMInfo;
  metadata: Record<string, any>;
}

interface OfflineVideoFile {
  type: 'video' | 'audio' | 'manifest' | 'segment';
  path: string;
  size: number;
  checksum: string;
  mimeType: string;
  encrypted: boolean;
  segmentIndex?: number;
  bandwidth?: number;
  resolution?: string;
}

interface OfflineSubtitleFile {
  language: string;
  label: string;
  format: 'vtt' | 'srt';
  path: string;
  size: number;
  checksum: string;
}

interface OfflineChapter {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  thumbnailPath?: string;
}

interface OfflineNote {
  id: string;
  timestamp: number;
  content: string;
  type: 'note' | 'bookmark' | 'question';
  createdAt: string;
}

interface DownloadOptions {
  quality?: string;
  format?: 'hls' | 'dash' | 'mp4';
  includeSubtitles?: boolean;
  includeChapters?: boolean;
  includeNotes?: boolean;
  expirationDays?: number;
  maxDownloads?: number;
  enableDRM?: boolean;
  compressionLevel?: number;
}

interface DownloadProgress {
  packageId: string;
  status: string;
  progress: number;
  currentStep: string;
  totalSteps: number;
  estimatedTimeRemaining?: number;
  error?: string;
}

class OfflineDownloadService extends EventEmitter {
  private redis: Redis;
  private packageDirectory: string;
  private tempDirectory: string;
  private defaultExpirationDays = 30;
  private maxPackageSize = 5 * 1024 * 1024 * 1024; // 5GB
  private allowedFormats = ['hls', 'dash', 'mp4'];
  private compressionLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  constructor() {
    super();

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100
    });

    this.packageDirectory = process.env.OFFLINE_PACKAGE_PATH || './storage/offline-packages';
    this.tempDirectory = process.env.TEMP_STORAGE_PATH || './storage/temp';

    this.initializeDirectories();
    this.startCleanupWorker();
  }

  /**
   * Create offline download package
   */
  async createOfflinePackage(
    userId: string,
    videoId: string,
    options: DownloadOptions = {}
  ): Promise<{ success: boolean; packageId?: string; error?: string }> {
    try {
      // Verify user access to video
      const hasAccess = await this.verifyVideoAccess(userId, videoId);
      if (!hasAccess) {
        return { success: false, error: 'Access denied to video' };
      }

      // Get video metadata
      const video = await db.video.findUnique({
        where: { id: videoId },
        include: {
          course: true,
          lesson: true
        }
      });

      if (!video || video.status !== 'ready') {
        return { success: false, error: 'Video not available for download' };
      }

      // Check if user already has a package for this video
      const existingPackage = await db.offlinePackage.findFirst({
        where: {
          userId,
          videoId,
          status: { in: ['preparing', 'packaging', 'ready'] }
        }
      });

      if (existingPackage) {
        return { success: true, packageId: existingPackage.id };
      }

      // Create package record
      const packageId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (options.expirationDays || this.defaultExpirationDays));

      const offlinePackage: OfflinePackage = {
        id: packageId,
        userId,
        videoId,
        courseId: video.courseId || undefined,
        lessonId: video.lessonId || undefined,
        title: video.originalFilename,
        description: video.metadata?.description,
        quality: options.quality || '720p',
        format: options.format || 'mp4',
        status: 'preparing',
        createdAt: new Date(),
        expiresAt,
        packageSize: 0,
        includeSubtitles: options.includeSubtitles || false,
        includeChapters: options.includeChapters || false,
        includeNotes: options.includeNotes || false,
        downloadCount: 0,
        maxDownloads: options.maxDownloads || 5,
        metadata: options
      };

      // Generate DRM info if enabled
      if (options.enableDRM) {
        const drmInfo = await this.generateDRMInfo();
        offlinePackage.drmKeyId = drmInfo.keyId;
        offlinePackage.encryptionKey = drmInfo.key;
      }

      // Store package in database
      await db.offlinePackage.create({
        data: {
          id: offlinePackage.id,
          userId: offlinePackage.userId,
          videoId: offlinePackage.videoId,
          courseId: offlinePackage.courseId,
          lessonId: offlinePackage.lessonId,
          title: offlinePackage.title,
          description: offlinePackage.description,
          quality: offlinePackage.quality,
          format: offlinePackage.format,
          status: offlinePackage.status,
          expiresAt: offlinePackage.expiresAt,
          packageSize: offlinePackage.packageSize,
          includeSubtitles: offlinePackage.includeSubtitles,
          includeChapters: offlinePackage.includeChapters,
          includeNotes: offlinePackage.includeNotes,
          downloadCount: offlinePackage.downloadCount,
          maxDownloads: offlinePackage.maxDownloads,
          encryptionKey: offlinePackage.encryptionKey,
          drmKeyId: offlinePackage.drmKeyId,
          metadata: offlinePackage.metadata || {}
        }
      });

      // Start packaging process asynchronously
      this.packageVideoAsync(offlinePackage).catch(error => {
        console.error(`Package creation failed for ${packageId}:`, error);
        this.updatePackageStatus(packageId, 'error', { error: error.message });
      });

      return { success: true, packageId };

    } catch (error) {
      console.error('Failed to create offline package:', error);
      return { success: false, error: 'Package creation failed' };
    }
  }

  /**
   * Get offline package status
   */
  async getPackageStatus(packageId: string): Promise<OfflinePackage | null> {
    try {
      const pkg = await db.offlinePackage.findUnique({
        where: { id: packageId }
      });

      if (!pkg) return null;

      return {
        id: pkg.id,
        userId: pkg.userId,
        videoId: pkg.videoId,
        courseId: pkg.courseId || undefined,
        lessonId: pkg.lessonId || undefined,
        title: pkg.title,
        description: pkg.description || undefined,
        quality: pkg.quality,
        format: pkg.format as 'hls' | 'dash' | 'mp4',
        status: pkg.status as any,
        createdAt: pkg.createdAt,
        expiresAt: pkg.expiresAt,
        downloadUrl: pkg.downloadUrl || undefined,
        packageSize: pkg.packageSize,
        encryptionKey: pkg.encryptionKey || undefined,
        drmKeyId: pkg.drmKeyId || undefined,
        includeSubtitles: pkg.includeSubtitles,
        includeChapters: pkg.includeChapters,
        includeNotes: pkg.includeNotes,
        downloadCount: pkg.downloadCount,
        maxDownloads: pkg.maxDownloads,
        metadata: pkg.metadata as Record<string, any> || {}
      };

    } catch (error) {
      console.error('Failed to get package status:', error);
      return null;
    }
  }

  /**
   * Download offline package
   */
  async downloadPackage(
    packageId: string,
    userId: string
  ): Promise<{ success: boolean; downloadUrl?: string; error?: string }> {
    try {
      const pkg = await this.getPackageStatus(packageId);

      if (!pkg) {
        return { success: false, error: 'Package not found' };
      }

      if (pkg.userId !== userId) {
        return { success: false, error: 'Access denied' };
      }

      if (pkg.status !== 'ready') {
        return { success: false, error: `Package not ready (status: ${pkg.status})` };
      }

      if (new Date() > pkg.expiresAt) {
        return { success: false, error: 'Package has expired' };
      }

      if (pkg.downloadCount >= pkg.maxDownloads) {
        return { success: false, error: 'Download limit exceeded' };
      }

      // Increment download count
      await db.offlinePackage.update({
        where: { id: packageId },
        data: { downloadCount: pkg.downloadCount + 1 }
      });

      // Generate secure download URL
      const downloadToken = crypto.randomBytes(32).toString('hex');
      const downloadUrl = `/api/video/download/${packageId}?token=${downloadToken}`;

      // Store download token in Redis with expiration
      await this.redis.setex(
        `download:token:${downloadToken}`,
        3600, // 1 hour expiry
        JSON.stringify({ packageId, userId })
      );

      return { success: true, downloadUrl };

    } catch (error) {
      console.error('Failed to initiate download:', error);
      return { success: false, error: 'Download initiation failed' };
    }
  }

  /**
   * Stream package file for download
   */
  async streamPackageFile(
    packageId: string,
    token: string
  ): Promise<{ success: boolean; stream?: NodeJS.ReadableStream; headers?: Record<string, string>; error?: string }> {
    try {
      // Validate download token
      const tokenData = await this.redis.get(`download:token:${token}`);
      if (!tokenData) {
        return { success: false, error: 'Invalid or expired download token' };
      }

      const { packageId: tokenPackageId, userId } = JSON.parse(tokenData);
      if (tokenPackageId !== packageId) {
        return { success: false, error: 'Token mismatch' };
      }

      const pkg = await this.getPackageStatus(packageId);
      if (!pkg || pkg.userId !== userId) {
        return { success: false, error: 'Package not found or access denied' };
      }

      const packagePath = path.join(this.packageDirectory, `${packageId}.zip`);

      // Check if package file exists
      try {
        await fs.access(packagePath);
      } catch {
        return { success: false, error: 'Package file not found' };
      }

      const stats = await fs.stat(packagePath);
      const stream = createReadStream(packagePath);

      const headers = {
        'Content-Type': 'application/zip',
        'Content-Length': stats.size.toString(),
        'Content-Disposition': `attachment; filename="${pkg.title}.zip"`,
        'Cache-Control': 'no-cache',
        'X-Package-Id': packageId,
        'X-Package-Size': stats.size.toString()
      };

      return { success: true, stream, headers };

    } catch (error) {
      console.error('Failed to stream package file:', error);
      return { success: false, error: 'File streaming failed' };
    }
  }

  /**
   * Get user's offline packages
   */
  async getUserPackages(userId: string): Promise<OfflinePackage[]> {
    try {
      const packages = await db.offlinePackage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          video: {
            select: {
              originalFilename: true,
              metadata: true
            }
          }
        }
      });

      return packages.map(pkg => ({
        id: pkg.id,
        userId: pkg.userId,
        videoId: pkg.videoId,
        courseId: pkg.courseId || undefined,
        lessonId: pkg.lessonId || undefined,
        title: pkg.title,
        description: pkg.description || undefined,
        quality: pkg.quality,
        format: pkg.format as 'hls' | 'dash' | 'mp4',
        status: pkg.status as any,
        createdAt: pkg.createdAt,
        expiresAt: pkg.expiresAt,
        downloadUrl: pkg.downloadUrl || undefined,
        packageSize: pkg.packageSize,
        includeSubtitles: pkg.includeSubtitles,
        includeChapters: pkg.includeChapters,
        includeNotes: pkg.includeNotes,
        downloadCount: pkg.downloadCount,
        maxDownloads: pkg.maxDownloads,
        metadata: pkg.metadata as Record<string, any> || {}
      }));

    } catch (error) {
      console.error('Failed to get user packages:', error);
      return [];
    }
  }

  /**
   * Delete offline package
   */
  async deletePackage(packageId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const pkg = await this.getPackageStatus(packageId);

      if (!pkg) {
        return { success: false, error: 'Package not found' };
      }

      if (pkg.userId !== userId) {
        return { success: false, error: 'Access denied' };
      }

      // Delete package file
      const packagePath = path.join(this.packageDirectory, `${packageId}.zip`);
      try {
        await fs.unlink(packagePath);
      } catch {
        // File might not exist, continue with database cleanup
      }

      // Delete from database
      await db.offlinePackage.delete({
        where: { id: packageId }
      });

      // Clean up any related Redis keys
      const keys = await this.redis.keys(`package:${packageId}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      return { success: true };

    } catch (error) {
      console.error('Failed to delete package:', error);
      return { success: false, error: 'Package deletion failed' };
    }
  }

  /**
   * Package video for offline use
   */
  private async packageVideoAsync(pkg: OfflinePackage): Promise<void> {
    try {
      await this.updatePackageStatus(pkg.id, 'packaging');

      const packagePath = path.join(this.packageDirectory, `${pkg.id}.zip`);
      const tempDir = path.join(this.tempDirectory, pkg.id);

      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true });

      // Get video files
      const videoFiles = await this.collectVideoFiles(pkg);

      // Get subtitles if requested
      const subtitleFiles = pkg.includeSubtitles
        ? await this.collectSubtitleFiles(pkg)
        : [];

      // Get chapters if requested
      const chapters = pkg.includeChapters
        ? await this.collectChapters(pkg)
        : [];

      // Get user notes if requested
      const notes = pkg.includeNotes
        ? await this.collectUserNotes(pkg)
        : [];

      // Apply DRM encryption if enabled
      if (pkg.encryptionKey) {
        await this.encryptVideoFiles(videoFiles, pkg.encryptionKey);
      }

      // Create manifest
      const manifest = await this.createOfflineManifest(pkg, videoFiles, subtitleFiles, chapters, notes);

      // Copy files to temp directory
      await this.copyFilesToTemp(tempDir, videoFiles, subtitleFiles);

      // Write manifest
      await fs.writeFile(
        path.join(tempDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // Create zip package
      await this.createZipPackage(tempDir, packagePath, pkg.metadata?.compressionLevel || 6);

      // Get package size
      const stats = await fs.stat(packagePath);
      const packageSize = stats.size;

      if (packageSize > this.maxPackageSize) {
        throw new Error('Package size exceeds maximum allowed size');
      }

      // Update package status
      await this.updatePackageStatus(pkg.id, 'ready', {
        packageSize,
        downloadUrl: `/api/video/download/${pkg.id}`
      });

      // Clean up temp directory
      await fs.rmdir(tempDir, { recursive: true });

      this.emit('packageReady', pkg.id);

    } catch (error) {
      console.error(`Package creation failed for ${pkg.id}:`, error);
      await this.updatePackageStatus(pkg.id, 'error', { error: error.message });
      this.emit('packageError', pkg.id, error);
    }
  }

  /**
   * Collect video files for packaging
   */
  private async collectVideoFiles(pkg: OfflinePackage): Promise<OfflineVideoFile[]> {
    const videoDir = path.join(process.env.VIDEO_STORAGE_PATH || './storage/videos', pkg.videoId);
    const qualityDir = path.join(videoDir, pkg.quality);
    const files: OfflineVideoFile[] = [];

    switch (pkg.format) {
      case 'mp4':
        const mp4Path = path.join(qualityDir, `video_${pkg.quality}.mp4`);
        const mp4Stats = await fs.stat(mp4Path);
        const mp4Checksum = await this.calculateChecksum(mp4Path);

        files.push({
          type: 'video',
          path: mp4Path,
          size: mp4Stats.size,
          checksum: mp4Checksum,
          mimeType: 'video/mp4',
          encrypted: false
        });
        break;

      case 'hls':
        const hlsDir = path.join(qualityDir, 'hls');
        const playlistPath = path.join(hlsDir, 'playlist.m3u8');

        // Add playlist
        const playlistStats = await fs.stat(playlistPath);
        const playlistChecksum = await this.calculateChecksum(playlistPath);

        files.push({
          type: 'manifest',
          path: playlistPath,
          size: playlistStats.size,
          checksum: playlistChecksum,
          mimeType: 'application/vnd.apple.mpegurl',
          encrypted: false
        });

        // Add segments
        const segmentFiles = await fs.readdir(hlsDir);
        for (const segmentFile of segmentFiles.filter(f => f.endsWith('.ts'))) {
          const segmentPath = path.join(hlsDir, segmentFile);
          const segmentStats = await fs.stat(segmentPath);
          const segmentChecksum = await this.calculateChecksum(segmentPath);
          const segmentIndex = parseInt(segmentFile.match(/\d+/)?.[0] || '0');

          files.push({
            type: 'segment',
            path: segmentPath,
            size: segmentStats.size,
            checksum: segmentChecksum,
            mimeType: 'video/mp2t',
            encrypted: false,
            segmentIndex
          });
        }
        break;

      case 'dash':
        const dashDir = path.join(qualityDir, 'dash');
        const manifestPath = path.join(dashDir, 'manifest.mpd');

        // Add manifest
        const manifestStats = await fs.stat(manifestPath);
        const manifestChecksum = await this.calculateChecksum(manifestPath);

        files.push({
          type: 'manifest',
          path: manifestPath,
          size: manifestStats.size,
          checksum: manifestChecksum,
          mimeType: 'application/dash+xml',
          encrypted: false
        });

        // Add segments
        const dashFiles = await fs.readdir(dashDir);
        for (const dashFile of dashFiles.filter(f => f.endsWith('.m4s') || f.endsWith('.mp4'))) {
          const dashFilePath = path.join(dashDir, dashFile);
          const dashFileStats = await fs.stat(dashFilePath);
          const dashFileChecksum = await this.calculateChecksum(dashFilePath);

          files.push({
            type: 'segment',
            path: dashFilePath,
            size: dashFileStats.size,
            checksum: dashFileChecksum,
            mimeType: 'video/mp4',
            encrypted: false
          });
        }
        break;
    }

    return files;
  }

  /**
   * Collect subtitle files
   */
  private async collectSubtitleFiles(pkg: OfflinePackage): Promise<OfflineSubtitleFile[]> {
    const subtitlesDir = path.join(
      process.env.VIDEO_STORAGE_PATH || './storage/videos',
      pkg.videoId,
      'subtitles'
    );

    const files: OfflineSubtitleFile[] = [];

    try {
      const subtitleFiles = await fs.readdir(subtitlesDir);

      for (const subtitleFile of subtitleFiles.filter(f => f.endsWith('.vtt') || f.endsWith('.srt'))) {
        const subtitlePath = path.join(subtitlesDir, subtitleFile);
        const stats = await fs.stat(subtitlePath);
        const checksum = await this.calculateChecksum(subtitlePath);

        const language = subtitleFile.match(/_([a-z]{2})_/)?.[1] || 'en';
        const format = path.extname(subtitleFile).slice(1) as 'vtt' | 'srt';

        files.push({
          language,
          label: `Subtitles (${language.toUpperCase()})`,
          format,
          path: subtitlePath,
          size: stats.size,
          checksum
        });
      }
    } catch {
      // Subtitles directory might not exist
    }

    return files;
  }

  /**
   * Collect chapters information
   */
  private async collectChapters(pkg: OfflinePackage): Promise<OfflineChapter[]> {
    try {
      const video = await db.video.findUnique({
        where: { id: pkg.videoId }
      });

      const chapters = video?.metadata?.chapters as any[] || [];

      return chapters.map(chapter => ({
        id: chapter.id || crypto.randomUUID(),
        title: chapter.title || `Chapter ${chapter.index || 1}`,
        startTime: chapter.startTime || 0,
        endTime: chapter.endTime || 0,
        thumbnailPath: chapter.thumbnailPath
      }));

    } catch {
      return [];
    }
  }

  /**
   * Collect user notes
   */
  private async collectUserNotes(pkg: OfflinePackage): Promise<OfflineNote[]> {
    try {
      // This would fetch user's notes/bookmarks for the video
      // Implementation depends on your notes/bookmarks schema
      return [];

    } catch {
      return [];
    }
  }

  /**
   * Create offline manifest
   */
  private async createOfflineManifest(
    pkg: OfflinePackage,
    videoFiles: OfflineVideoFile[],
    subtitleFiles: OfflineSubtitleFile[],
    chapters: OfflineChapter[],
    notes: OfflineNote[]
  ): Promise<OfflineManifest> {
    const video = await db.video.findUnique({
      where: { id: pkg.videoId }
    });

    const drmInfo: DRMInfo | undefined = pkg.encryptionKey ? {
      keyId: pkg.drmKeyId!,
      key: pkg.encryptionKey,
      algorithm: 'AES-256',
      method: 'CBC',
      iv: crypto.randomBytes(16).toString('hex')
    } : undefined;

    return {
      packageId: pkg.id,
      version: '1.0',
      title: pkg.title,
      description: pkg.description,
      createdAt: pkg.createdAt.toISOString(),
      expiresAt: pkg.expiresAt.toISOString(),
      video: {
        id: pkg.videoId,
        title: pkg.title,
        duration: video?.metadata?.duration || 0,
        format: pkg.format,
        quality: pkg.quality,
        files: videoFiles.map(f => ({
          ...f,
          path: path.relative(this.packageDirectory, f.path)
        }))
      },
      subtitles: subtitleFiles.length > 0 ? subtitleFiles.map(f => ({
        ...f,
        path: path.relative(this.packageDirectory, f.path)
      })) : undefined,
      chapters: chapters.length > 0 ? chapters : undefined,
      notes: notes.length > 0 ? notes : undefined,
      drm: drmInfo,
      metadata: pkg.metadata || {}
    };
  }

  /**
   * Helper methods
   */
  private async initializeDirectories(): Promise<void> {
    await fs.mkdir(this.packageDirectory, { recursive: true });
    await fs.mkdir(this.tempDirectory, { recursive: true });
  }

  private async verifyVideoAccess(userId: string, videoId: string): Promise<boolean> {
    // Implementation would verify user has access to the video
    // This could check enrollments, purchases, etc.
    return true;
  }

  private async generateDRMInfo(): Promise<DRMInfo> {
    return {
      keyId: crypto.randomUUID(),
      key: crypto.randomBytes(32).toString('hex'),
      algorithm: 'AES-256',
      method: 'CBC',
      iv: crypto.randomBytes(16).toString('hex')
    };
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async encryptVideoFiles(files: OfflineVideoFile[], encryptionKey: string): Promise<void> {
    // Implementation would encrypt video files using the provided key
    // This is a placeholder - actual encryption would depend on your DRM solution
    for (const file of files) {
      file.encrypted = true;
    }
  }

  private async copyFilesToTemp(
    tempDir: string,
    videoFiles: OfflineVideoFile[],
    subtitleFiles: OfflineSubtitleFile[]
  ): Promise<void> {
    // Copy video files
    for (const file of videoFiles) {
      const relativePath = path.relative(process.env.VIDEO_STORAGE_PATH || './storage/videos', file.path);
      const destPath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(file.path, destPath);
    }

    // Copy subtitle files
    for (const file of subtitleFiles) {
      const relativePath = path.relative(process.env.VIDEO_STORAGE_PATH || './storage/videos', file.path);
      const destPath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(file.path, destPath);
    }
  }

  private async createZipPackage(sourceDir: string, outputPath: string, compressionLevel: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: compressionLevel }
      });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  private async updatePackageStatus(
    packageId: string,
    status: OfflinePackage['status'],
    updates: Partial<OfflinePackage> = {}
  ): Promise<void> {
    await db.offlinePackage.update({
      where: { id: packageId },
      data: {
        status,
        packageSize: updates.packageSize,
        downloadUrl: updates.downloadUrl,
        metadata: updates.metadata
      }
    });

    // Update Redis cache
    await this.redis.setex(
      `package:${packageId}:status`,
      300, // 5 minutes
      JSON.stringify({ status, ...updates })
    );
  }

  private startCleanupWorker(): void {
    setInterval(async () => {
      await this.cleanupExpiredPackages();
    }, 60 * 60 * 1000); // Every hour
  }

  private async cleanupExpiredPackages(): Promise<void> {
    try {
      const expiredPackages = await db.offlinePackage.findMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });

      for (const pkg of expiredPackages) {
        const packagePath = path.join(this.packageDirectory, `${pkg.id}.zip`);

        try {
          await fs.unlink(packagePath);
        } catch {
          // File might not exist
        }

        await db.offlinePackage.update({
          where: { id: pkg.id },
          data: { status: 'expired' }
        });
      }

      if (expiredPackages.length > 0) {
        console.log(`Cleaned up ${expiredPackages.length} expired packages`);
      }

    } catch (error) {
      console.error('Failed to cleanup expired packages:', error);
    }
  }
}

export const offlineDownloadService = new OfflineDownloadService();
export type {
  OfflinePackage,
  OfflineManifest,
  DownloadOptions,
  DownloadProgress,
  DRMInfo
};