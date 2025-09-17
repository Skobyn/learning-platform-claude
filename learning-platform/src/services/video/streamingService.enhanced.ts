import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import { redis } from '../../lib/redis';

export interface StreamingQuality {
  name: string;
  width: number;
  height: number;
  bitrate: number;
  bandwidth: number;
}

export interface AdaptiveBitrateConfig {
  qualities: StreamingQuality[];
  bufferLength: number;
  switchUpBandwidth: number;
  switchDownBandwidth: number;
  maxRetries: number;
}

export interface StreamingSession {
  id: string;
  userId: string;
  videoId: string;
  currentQuality: string;
  bandwidth: number;
  bufferHealth: number;
  watchTime: number;
  lastActivity: Date;
  analytics: StreamingAnalytics;
}

export interface StreamingAnalytics {
  startTime: Date;
  totalWatchTime: number;
  qualitySwitches: number;
  rebufferEvents: number;
  rebufferTime: number;
  averageBandwidth: number;
  peakBandwidth: number;
  errors: StreamingError[];
}

export interface StreamingError {
  type: 'network' | 'decode' | 'manifest' | 'drm';
  message: string;
  timestamp: Date;
  quality: string;
  bandwidth: number;
}

export interface OfflineDownload {
  id: string;
  userId: string;
  videoId: string;
  quality: string;
  size: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'expired';
  expiryDate: Date;
  drmLicense?: string;
}

export class EnhancedStreamingService extends EventEmitter {
  private activeSessions = new Map<string, StreamingSession>();
  private abr: AdaptiveBitrateConfig;
  private bandwidthHistory = new Map<string, number[]>();

  constructor() {
    super();
    this.abr = this.getDefaultABRConfig();
    this.startBandwidthMonitoring();
    this.startSessionCleanup();
  }

  /**
   * Initialize streaming session
   */
  async initializeSession(userId: string, videoId: string): Promise<string> {
    const sessionId = this.generateSessionId();

    const session: StreamingSession = {
      id: sessionId,
      userId,
      videoId,
      currentQuality: 'auto',
      bandwidth: 0,
      bufferHealth: 0,
      watchTime: 0,
      lastActivity: new Date(),
      analytics: {
        startTime: new Date(),
        totalWatchTime: 0,
        qualitySwitches: 0,
        rebufferEvents: 0,
        rebufferTime: 0,
        averageBandwidth: 0,
        peakBandwidth: 0,
        errors: []
      }
    };

    this.activeSessions.set(sessionId, session);

    // Store session in Redis with TTL
    await redis.setex(`streaming:session:${sessionId}`, 7200, JSON.stringify(session));

    this.emit('sessionStarted', session);
    return sessionId;
  }

  /**
   * Get adaptive streaming manifest
   */
  async getAdaptiveManifest(videoId: string, sessionId: string, format: 'hls' | 'dash' = 'hls'): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Invalid session');
    }

    const videoPath = this.getVideoPath(videoId);
    const manifestPath = format === 'hls' ?
      path.join(videoPath, 'master.m3u8') :
      path.join(videoPath, 'manifest.mpd');

    if (!await fs.pathExists(manifestPath)) {
      throw new Error(`${format.toUpperCase()} manifest not found`);
    }

    // Enhance manifest with bandwidth detection and analytics
    const manifest = await fs.readFile(manifestPath, 'utf8');
    return this.enhanceManifest(manifest, session, format);
  }

  /**
   * Update bandwidth measurement
   */
  async updateBandwidth(sessionId: string, bandwidth: number, transferTime: number, bytesTransferred: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    // Calculate actual bandwidth
    const actualBandwidth = (bytesTransferred * 8) / (transferTime / 1000); // bps
    session.bandwidth = actualBandwidth;

    // Update bandwidth history
    const history = this.bandwidthHistory.get(sessionId) || [];
    history.push(actualBandwidth);
    if (history.length > 10) {
      history.shift(); // Keep last 10 measurements
    }
    this.bandwidthHistory.set(sessionId, history);

    // Update analytics
    session.analytics.averageBandwidth = history.reduce((a, b) => a + b, 0) / history.length;
    session.analytics.peakBandwidth = Math.max(session.analytics.peakBandwidth, actualBandwidth);

    // Suggest quality adaptation
    const suggestedQuality = this.suggestQuality(session);
    if (suggestedQuality !== session.currentQuality) {
      this.emit('qualityRecommendation', {
        sessionId,
        currentQuality: session.currentQuality,
        suggestedQuality,
        bandwidth: actualBandwidth
      });
    }

    await this.updateSession(session);
  }

  /**
   * Handle quality switch
   */
  async switchQuality(sessionId: string, newQuality: string, reason: 'user' | 'auto' | 'buffer'): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const oldQuality = session.currentQuality;
    session.currentQuality = newQuality;
    session.analytics.qualitySwitches++;

    await this.updateSession(session);

    this.emit('qualitySwitched', {
      sessionId,
      oldQuality,
      newQuality,
      reason,
      bandwidth: session.bandwidth
    });
  }

  /**
   * Report buffering event
   */
  async reportBuffering(sessionId: string, bufferHealth: number, rebufferTime?: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    session.bufferHealth = bufferHealth;

    if (rebufferTime) {
      session.analytics.rebufferEvents++;
      session.analytics.rebufferTime += rebufferTime;

      // If rebuffering, suggest lower quality
      if (bufferHealth < 0.3) { // Less than 30% buffer
        const lowerQuality = this.getLowerQuality(session.currentQuality);
        if (lowerQuality) {
          this.emit('qualityRecommendation', {
            sessionId,
            currentQuality: session.currentQuality,
            suggestedQuality: lowerQuality,
            bandwidth: session.bandwidth
          });
        }
      }
    }

    await this.updateSession(session);
  }

  /**
   * Report streaming error
   */
  async reportError(sessionId: string, error: Omit<StreamingError, 'timestamp' | 'quality' | 'bandwidth'>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const streamingError: StreamingError = {
      ...error,
      timestamp: new Date(),
      quality: session.currentQuality,
      bandwidth: session.bandwidth
    };

    session.analytics.errors.push(streamingError);
    await this.updateSession(session);

    this.emit('streamingError', { sessionId, error: streamingError });
  }

  /**
   * Update watch time
   */
  async updateWatchTime(sessionId: string, watchTime: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    session.watchTime = watchTime;
    session.analytics.totalWatchTime = watchTime;
    session.lastActivity = new Date();

    await this.updateSession(session);
  }

  /**
   * Get streaming segment with caching
   */
  async getSegment(videoId: string, segmentName: string, quality: string): Promise<Buffer | null> {
    const cacheKey = `segment:${videoId}:${quality}:${segmentName}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return Buffer.from(cached, 'base64');
    }

    const segmentPath = path.join(this.getVideoPath(videoId), segmentName);

    if (!await fs.pathExists(segmentPath)) {
      return null;
    }

    const segment = await fs.readFile(segmentPath);

    // Cache segment for 1 hour
    await redis.setex(cacheKey, 3600, segment.toString('base64'));

    return segment;
  }

  /**
   * Start offline download
   */
  async startOfflineDownload(userId: string, videoId: string, quality: string): Promise<string> {
    const downloadId = this.generateDownloadId();
    const videoPath = this.getVideoPath(videoId);
    const qualityManifest = path.join(videoPath, `${quality}.m3u8`);

    if (!await fs.pathExists(qualityManifest)) {
      throw new Error('Quality not available for download');
    }

    // Calculate total size
    const segments = await this.getSegmentList(qualityManifest);
    const totalSize = await this.calculateTotalSize(videoPath, segments);

    const download: OfflineDownload = {
      id: downloadId,
      userId,
      videoId,
      quality,
      size: totalSize,
      downloadedBytes: 0,
      status: 'pending',
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      drmLicense: await this.generateDRMLicense(userId, videoId)
    };

    await redis.setex(`download:${downloadId}`, 30 * 24 * 3600, JSON.stringify(download));

    // Start download process
    this.processDownload(download);

    return downloadId;
  }

  /**
   * Get download progress
   */
  async getDownloadProgress(downloadId: string): Promise<OfflineDownload | null> {
    const cached = await redis.get(`download:${downloadId}`);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Cancel download
   */
  async cancelDownload(downloadId: string): Promise<void> {
    const download = await this.getDownloadProgress(downloadId);
    if (download) {
      download.status = 'failed';
      await redis.setex(`download:${downloadId}`, 24 * 3600, JSON.stringify(download));
      this.emit('downloadCancelled', downloadId);
    }
  }

  /**
   * Get user downloads
   */
  async getUserDownloads(userId: string): Promise<OfflineDownload[]> {
    const pattern = 'download:*';
    const keys = await redis.keys(pattern);
    const downloads: OfflineDownload[] = [];

    for (const key of keys) {
      const download = await redis.get(key);
      if (download) {
        const parsed: OfflineDownload = JSON.parse(download);
        if (parsed.userId === userId) {
          downloads.push(parsed);
        }
      }
    }

    return downloads.filter(d => d.expiryDate > new Date());
  }

  /**
   * Generate DRM license
   */
  private async generateDRMLicense(userId: string, videoId: string): Promise<string> {
    // Simplified DRM license generation
    const payload = {
      userId,
      videoId,
      issued: new Date().toISOString(),
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    // In production, use proper DRM solution like Widevine, PlayReady, or FairPlay
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Process offline download
   */
  private async processDownload(download: OfflineDownload): Promise<void> {
    try {
      download.status = 'downloading';
      await this.updateDownload(download);

      const videoPath = this.getVideoPath(download.videoId);
      const qualityManifest = path.join(videoPath, `${download.quality}.m3u8`);
      const segments = await this.getSegmentList(qualityManifest);

      let downloadedBytes = 0;

      for (const segment of segments) {
        const segmentPath = path.join(videoPath, segment);
        if (await fs.pathExists(segmentPath)) {
          const stats = await fs.stat(segmentPath);
          downloadedBytes += stats.size;
        }

        download.downloadedBytes = downloadedBytes;
        await this.updateDownload(download);

        this.emit('downloadProgress', {
          downloadId: download.id,
          progress: (downloadedBytes / download.size) * 100
        });
      }

      download.status = 'completed';
      await this.updateDownload(download);
      this.emit('downloadCompleted', download.id);

    } catch (error) {
      download.status = 'failed';
      await this.updateDownload(download);
      this.emit('downloadFailed', { downloadId: download.id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Helper methods
  private getDefaultABRConfig(): AdaptiveBitrateConfig {
    return {
      qualities: [
        { name: '240p', width: 426, height: 240, bitrate: 400, bandwidth: 500000 },
        { name: '360p', width: 640, height: 360, bitrate: 800, bandwidth: 1000000 },
        { name: '480p', width: 854, height: 480, bitrate: 1200, bandwidth: 1500000 },
        { name: '720p', width: 1280, height: 720, bitrate: 2500, bandwidth: 3000000 },
        { name: '1080p', width: 1920, height: 1080, bitrate: 5000, bandwidth: 6000000 }
      ],
      bufferLength: 30, // seconds
      switchUpBandwidth: 1.5, // multiplier
      switchDownBandwidth: 0.8, // multiplier
      maxRetries: 3
    };
  }

  private suggestQuality(session: StreamingSession): string {
    const history = this.bandwidthHistory.get(session.id) || [];
    if (history.length < 3) return session.currentQuality;

    const avgBandwidth = history.reduce((a, b) => a + b, 0) / history.length;

    // Find best quality for current bandwidth
    const suitableQualities = this.abr.qualities.filter(q =>
      q.bandwidth <= avgBandwidth * this.abr.switchDownBandwidth
    );

    if (suitableQualities.length === 0) {
      return this.abr.qualities[0].name; // Lowest quality
    }

    // Return highest suitable quality
    return suitableQualities[suitableQualities.length - 1].name;
  }

  private getLowerQuality(currentQuality: string): string | null {
    const currentIndex = this.abr.qualities.findIndex(q => q.name === currentQuality);
    return currentIndex > 0 ? this.abr.qualities[currentIndex - 1].name : null;
  }

  private async getSession(sessionId: string): Promise<StreamingSession | null> {
    // Try memory first
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId)!;
    }

    // Try Redis
    const cached = await redis.get(`streaming:session:${sessionId}`);
    if (cached) {
      const session = JSON.parse(cached);
      this.activeSessions.set(sessionId, session);
      return session;
    }

    return null;
  }

  private async updateSession(session: StreamingSession): Promise<void> {
    this.activeSessions.set(session.id, session);
    await redis.setex(`streaming:session:${session.id}`, 7200, JSON.stringify(session));
  }

  private async updateDownload(download: OfflineDownload): Promise<void> {
    await redis.setex(`download:${download.id}`, 30 * 24 * 3600, JSON.stringify(download));
  }

  private enhanceManifest(manifest: string, session: StreamingSession, format: 'hls' | 'dash'): string {
    // Add custom headers for analytics
    let enhanced = manifest;

    if (format === 'hls') {
      enhanced = `#EXT-X-SESSION-DATA:DATA-ID="com.learning.analytics",VALUE="${session.id}"\n` + enhanced;
    }

    return enhanced;
  }

  private getVideoPath(videoId: string): string {
    return path.join(process.env.VIDEO_STORAGE_PATH || '/storage/videos', videoId);
  }

  private async getSegmentList(manifestPath: string): Promise<string[]> {
    const manifest = await fs.readFile(manifestPath, 'utf8');
    const segments = manifest
      .split('\n')
      .filter(line => line.endsWith('.ts'))
      .map(line => line.trim());
    return segments;
  }

  private async calculateTotalSize(videoPath: string, segments: string[]): Promise<number> {
    let totalSize = 0;
    for (const segment of segments) {
      const segmentPath = path.join(videoPath, segment);
      if (await fs.pathExists(segmentPath)) {
        const stats = await fs.stat(segmentPath);
        totalSize += stats.size;
      }
    }
    return totalSize;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateDownloadId(): string {
    return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startBandwidthMonitoring(): void {
    setInterval(() => {
      // Clean up old bandwidth history
      for (const [sessionId, history] of this.bandwidthHistory.entries()) {
        if (!this.activeSessions.has(sessionId)) {
          this.bandwidthHistory.delete(sessionId);
        }
      }
    }, 60000); // Every minute
  }

  private startSessionCleanup(): void {
    setInterval(async () => {
      const now = new Date();
      for (const [sessionId, session] of this.activeSessions.entries()) {
        const timeDiff = now.getTime() - session.lastActivity.getTime();
        if (timeDiff > 30 * 60 * 1000) { // 30 minutes inactive
          this.activeSessions.delete(sessionId);
          await redis.del(`streaming:session:${sessionId}`);
          this.emit('sessionExpired', sessionId);
        }
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }
}

export default EnhancedStreamingService;