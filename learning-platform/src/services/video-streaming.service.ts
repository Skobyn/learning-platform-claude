import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { Storage } from '@google-cloud/storage';
import { Redis } from 'ioredis';
import { logger } from '../lib/logger';

export interface StreamingQuality {
  resolution: string;
  bitrate: number;
  codec: string;
  profile: string;
}

export interface VideoStreamConfig {
  videoId: string;
  userId: string;
  qualities: StreamingQuality[];
  duration: number;
  thumbnails: string[];
  chapters?: VideoChapter[];
}

export interface VideoChapter {
  title: string;
  startTime: number;
  endTime: number;
  thumbnail?: string;
}

export interface StreamingSession {
  sessionId: string;
  videoId: string;
  userId: string;
  quality: string;
  startTime: Date;
  lastHeartbeat: Date;
  watchTime: number;
  bandwidth: number;
  deviceType: string;
  location?: string;
}

export interface AdaptiveBitrateConfig {
  qualities: StreamingQuality[];
  bandwidthThresholds: { [key: string]: number };
  bufferLevels: { low: number; high: number };
  switchingLogic: 'aggressive' | 'conservative' | 'balanced';
}

export class VideoStreamingService extends EventEmitter {
  private storage: Storage;
  private redis: Redis;
  private activeSessions: Map<string, StreamingSession> = new Map();
  private bucketName: string;
  private cdnBaseUrl: string;
  private jwtSecret: string;

  constructor(config: {
    googleCloudConfig: any;
    bucketName: string;
    redisUrl: string;
    cdnBaseUrl: string;
    jwtSecret: string;
  }) {
    super();

    this.storage = new Storage(config.googleCloudConfig);
    this.redis = new Redis(config.redisUrl);
    this.bucketName = config.bucketName;
    this.cdnBaseUrl = config.cdnBaseUrl;
    this.jwtSecret = config.jwtSecret;

    // Setup session cleanup
    setInterval(() => this.cleanupInactiveSessions(), 30000);
  }

  /**
   * Generate streaming manifest (HLS/DASH) for adaptive bitrate
   */
  async generateHLSManifest(videoId: string, config: VideoStreamConfig): Promise<string> {
    try {
      const qualities = config.qualities.sort((a, b) => b.bitrate - a.bitrate);

      let manifest = '#EXTM3U\n#EXT-X-VERSION:6\n';

      for (const quality of qualities) {
        const bandwidth = quality.bitrate * 1000;
        const resolution = quality.resolution;
        const playlistUrl = `${this.cdnBaseUrl}/video/${videoId}/${quality.resolution}/playlist.m3u8`;

        manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="${quality.codec}"\n`;
        manifest += `${playlistUrl}\n`;
      }

      // Store manifest in cloud storage
      const manifestPath = `video/${videoId}/master.m3u8`;
      await this.uploadToStorage(manifestPath, manifest, 'text/plain');

      return `${this.cdnBaseUrl}/${manifestPath}`;
    } catch (error) {
      logger.error('Failed to generate HLS manifest:', error);
      throw error;
    }
  }

  /**
   * Generate DASH manifest for cross-platform compatibility
   */
  async generateDASHManifest(videoId: string, config: VideoStreamConfig): Promise<string> {
    try {
      const qualities = config.qualities.sort((a, b) => b.bitrate - a.bitrate);

      let manifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     type="static"
     mediaPresentationDuration="PT${config.duration}S"
     profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4">`;

      for (const quality of qualities) {
        const [width, height] = quality.resolution.split('x');
        manifest += `
      <Representation
        id="${quality.resolution}"
        bandwidth="${quality.bitrate * 1000}"
        width="${width}"
        height="${height}"
        codecs="${quality.codec}">
        <BaseURL>${this.cdnBaseUrl}/video/${videoId}/${quality.resolution}/</BaseURL>
        <SegmentTemplate
          media="segment_$Number$.m4s"
          initialization="init.mp4"
          startNumber="1"
          duration="4"/>
      </Representation>`;
      }

      manifest += `
    </AdaptationSet>
  </Period>
</MPD>`;

      // Store DASH manifest
      const manifestPath = `video/${videoId}/manifest.mpd`;
      await this.uploadToStorage(manifestPath, manifest, 'application/dash+xml');

      return `${this.cdnBaseUrl}/${manifestPath}`;
    } catch (error) {
      logger.error('Failed to generate DASH manifest:', error);
      throw error;
    }
  }

  /**
   * Create secure streaming token with expiration and restrictions
   */
  generateStreamingToken(videoId: string, userId: string, options: {
    expiresIn?: number;
    allowedIPs?: string[];
    maxSessions?: number;
    qualityRestriction?: string[];
  } = {}): string {
    const payload = {
      videoId,
      userId,
      exp: Math.floor(Date.now() / 1000) + (options.expiresIn || 3600), // 1 hour default
      allowedIPs: options.allowedIPs,
      maxSessions: options.maxSessions || 3,
      qualityRestriction: options.qualityRestriction,
      iat: Math.floor(Date.now() / 1000)
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.jwtSecret)
      .update(`${header}.${payloadBase64}`)
      .digest('base64url');

    return `${header}.${payloadBase64}.${signature}`;
  }

  /**
   * Validate streaming token and extract permissions
   */
  validateStreamingToken(token: string, clientIP?: string): { valid: boolean; payload?: any; error?: string } {
    try {
      const [header, payload, signature] = token.split('.');

      const expectedSignature = crypto.createHmac('sha256', this.jwtSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid signature' };
      }

      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());

      // Check expiration
      if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, error: 'Token expired' };
      }

      // Check IP restrictions
      if (decodedPayload.allowedIPs && clientIP && !decodedPayload.allowedIPs.includes(clientIP)) {
        return { valid: false, error: 'IP not allowed' };
      }

      return { valid: true, payload: decodedPayload };
    } catch (error) {
      return { valid: false, error: 'Invalid token format' };
    }
  }

  /**
   * Start streaming session with adaptive bitrate logic
   */
  async startStreamingSession(
    videoId: string,
    userId: string,
    clientInfo: {
      bandwidth: number;
      deviceType: string;
      screenSize: string;
      location?: string;
    }
  ): Promise<{ sessionId: string; recommendedQuality: string; manifestUrl: string }> {
    try {
      const sessionId = crypto.randomUUID();

      // Get video configuration
      const videoConfig = await this.getVideoConfig(videoId);
      if (!videoConfig) {
        throw new Error('Video not found');
      }

      // Determine recommended quality based on bandwidth and device
      const recommendedQuality = this.selectOptimalQuality(
        videoConfig.qualities,
        clientInfo.bandwidth,
        clientInfo.deviceType,
        clientInfo.screenSize
      );

      // Create streaming session
      const session: StreamingSession = {
        sessionId,
        videoId,
        userId,
        quality: recommendedQuality.resolution,
        startTime: new Date(),
        lastHeartbeat: new Date(),
        watchTime: 0,
        bandwidth: clientInfo.bandwidth,
        deviceType: clientInfo.deviceType,
        location: clientInfo.location
      };

      this.activeSessions.set(sessionId, session);

      // Generate manifest URLs
      const hlsManifest = await this.generateHLSManifest(videoId, videoConfig);

      // Track session start
      await this.trackEvent('session_start', {
        sessionId,
        videoId,
        userId,
        recommendedQuality: recommendedQuality.resolution,
        bandwidth: clientInfo.bandwidth,
        deviceType: clientInfo.deviceType
      });

      this.emit('sessionStarted', session);

      return {
        sessionId,
        recommendedQuality: recommendedQuality.resolution,
        manifestUrl: hlsManifest
      };
    } catch (error) {
      logger.error('Failed to start streaming session:', error);
      throw error;
    }
  }

  /**
   * Handle adaptive bitrate quality switching
   */
  async switchQuality(
    sessionId: string,
    newQuality: string,
    reason: 'bandwidth' | 'user' | 'buffer' | 'device'
  ): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const oldQuality = session.quality;
      session.quality = newQuality;
      session.lastHeartbeat = new Date();

      // Track quality switch
      await this.trackEvent('quality_switch', {
        sessionId,
        videoId: session.videoId,
        userId: session.userId,
        oldQuality,
        newQuality,
        reason,
        timestamp: new Date()
      });

      this.emit('qualitySwitch', {
        sessionId,
        oldQuality,
        newQuality,
        reason
      });
    } catch (error) {
      logger.error('Failed to switch quality:', error);
      throw error;
    }
  }

  /**
   * Update session heartbeat and watch time
   */
  async updateSessionHeartbeat(
    sessionId: string,
    watchTime: number,
    currentBandwidth: number,
    bufferLevel: number
  ): Promise<{ recommendQualitySwitch?: string; reason?: string }> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      session.lastHeartbeat = new Date();
      session.watchTime = watchTime;
      session.bandwidth = currentBandwidth;

      // Check if quality adjustment is needed
      const videoConfig = await this.getVideoConfig(session.videoId);
      if (videoConfig) {
        const recommendation = this.analyzeQualitySwitchNeed(
          session,
          videoConfig.qualities,
          currentBandwidth,
          bufferLevel
        );

        if (recommendation) {
          return recommendation;
        }
      }

      return {};
    } catch (error) {
      logger.error('Failed to update session heartbeat:', error);
      throw error;
    }
  }

  /**
   * End streaming session and collect final analytics
   */
  async endStreamingSession(sessionId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return;
      }

      // Calculate final statistics
      const totalDuration = Date.now() - session.startTime.getTime();
      const watchPercentage = session.watchTime / (totalDuration / 1000) * 100;

      // Track session end
      await this.trackEvent('session_end', {
        sessionId,
        videoId: session.videoId,
        userId: session.userId,
        totalDuration: totalDuration / 1000,
        watchTime: session.watchTime,
        watchPercentage,
        finalQuality: session.quality,
        averageBandwidth: session.bandwidth,
        deviceType: session.deviceType
      });

      this.activeSessions.delete(sessionId);
      this.emit('sessionEnded', session);
    } catch (error) {
      logger.error('Failed to end streaming session:', error);
    }
  }

  /**
   * Get streaming analytics for a video
   */
  async getStreamingAnalytics(videoId: string, timeRange: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<any> {
    try {
      const key = `analytics:video:${videoId}:${timeRange}`;
      const cached = await this.redis.get(key);

      if (cached) {
        return JSON.parse(cached);
      }

      // Aggregate analytics from tracking events
      const analytics = await this.aggregateVideoAnalytics(videoId, timeRange);

      // Cache for 5 minutes
      await this.redis.setex(key, 300, JSON.stringify(analytics));

      return analytics;
    } catch (error) {
      logger.error('Failed to get streaming analytics:', error);
      throw error;
    }
  }

  // Private helper methods

  private selectOptimalQuality(
    qualities: StreamingQuality[],
    bandwidth: number,
    deviceType: string,
    screenSize: string
  ): StreamingQuality {
    // Sort qualities by bitrate (ascending)
    const sortedQualities = qualities.sort((a, b) => a.bitrate - b.bitrate);

    // Apply device-specific constraints
    let maxQuality = '1080p';
    if (deviceType === 'mobile') {
      maxQuality = screenSize.includes('small') ? '480p' : '720p';
    } else if (deviceType === 'tablet') {
      maxQuality = '1080p';
    }

    // Filter by device capability
    const deviceCompatibleQualities = sortedQualities.filter(q => {
      const qualityLevel = parseInt(q.resolution.replace('p', ''));
      const maxQualityLevel = parseInt(maxQuality.replace('p', ''));
      return qualityLevel <= maxQualityLevel;
    });

    // Select based on bandwidth (with 20% buffer)
    const targetBandwidth = bandwidth * 0.8;

    for (let i = deviceCompatibleQualities.length - 1; i >= 0; i--) {
      if (deviceCompatibleQualities[i].bitrate <= targetBandwidth) {
        return deviceCompatibleQualities[i];
      }
    }

    // Fallback to lowest quality
    return deviceCompatibleQualities[0] || sortedQualities[0];
  }

  private analyzeQualitySwitchNeed(
    session: StreamingSession,
    qualities: StreamingQuality[],
    currentBandwidth: number,
    bufferLevel: number
  ): { recommendQualitySwitch?: string; reason?: string } | null {
    const currentQuality = qualities.find(q => q.resolution === session.quality);
    if (!currentQuality) return null;

    // Check buffer level for quality adjustment
    if (bufferLevel < 5) { // Low buffer
      const lowerQuality = qualities.find(q => q.bitrate < currentQuality.bitrate);
      if (lowerQuality) {
        return {
          recommendQualitySwitch: lowerQuality.resolution,
          reason: 'buffer'
        };
      }
    } else if (bufferLevel > 20 && currentBandwidth > currentQuality.bitrate * 1.5) {
      // High buffer and good bandwidth
      const higherQuality = qualities.find(q =>
        q.bitrate > currentQuality.bitrate && q.bitrate <= currentBandwidth * 0.8
      );
      if (higherQuality) {
        return {
          recommendQualitySwitch: higherQuality.resolution,
          reason: 'bandwidth'
        };
      }
    }

    return null;
  }

  private async getVideoConfig(videoId: string): Promise<VideoStreamConfig | null> {
    try {
      const configPath = `video/${videoId}/config.json`;
      const [file] = await this.storage.bucket(this.bucketName).file(configPath).download();
      return JSON.parse(file.toString());
    } catch (error) {
      logger.error(`Failed to get video config for ${videoId}:`, error);
      return null;
    }
  }

  private async uploadToStorage(path: string, content: string, contentType: string): Promise<void> {
    const file = this.storage.bucket(this.bucketName).file(path);
    await file.save(content, {
      metadata: {
        contentType,
        cacheControl: 'public, max-age=3600'
      }
    });
  }

  private async trackEvent(eventType: string, data: any): Promise<void> {
    const event = {
      type: eventType,
      timestamp: new Date(),
      data
    };

    // Store in Redis for real-time analytics
    await this.redis.lpush(`events:${eventType}`, JSON.stringify(event));
    await this.redis.expire(`events:${eventType}`, 86400); // 24 hours

    // Also emit for real-time processing
    this.emit('analyticsEvent', event);
  }

  private async aggregateVideoAnalytics(videoId: string, timeRange: string): Promise<any> {
    // This would typically query a time-series database
    // For now, we'll aggregate from Redis events
    const events = await this.redis.lrange(`events:session_start`, 0, -1);
    const sessionData = events
      .map(e => JSON.parse(e))
      .filter(e => e.data.videoId === videoId);

    return {
      totalSessions: sessionData.length,
      uniqueViewers: new Set(sessionData.map(e => e.data.userId)).size,
      avgWatchTime: sessionData.reduce((sum, e) => sum + (e.data.watchTime || 0), 0) / sessionData.length,
      qualityDistribution: this.calculateQualityDistribution(sessionData),
      deviceTypeDistribution: this.calculateDeviceDistribution(sessionData),
      peakConcurrentViewers: await this.calculatePeakConcurrent(videoId, timeRange)
    };
  }

  private calculateQualityDistribution(sessions: any[]): { [quality: string]: number } {
    const distribution: { [quality: string]: number } = {};
    sessions.forEach(session => {
      const quality = session.data.recommendedQuality || 'unknown';
      distribution[quality] = (distribution[quality] || 0) + 1;
    });
    return distribution;
  }

  private calculateDeviceDistribution(sessions: any[]): { [device: string]: number } {
    const distribution: { [device: string]: number } = {};
    sessions.forEach(session => {
      const device = session.data.deviceType || 'unknown';
      distribution[device] = (distribution[device] || 0) + 1;
    });
    return distribution;
  }

  private async calculatePeakConcurrent(videoId: string, timeRange: string): Promise<number> {
    // This would need a more sophisticated time-series analysis
    // For now, return a placeholder
    return Math.floor(Math.random() * 100) + 1;
  }

  private cleanupInactiveSessions(): void {
    const now = new Date();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [sessionId, session] of this.activeSessions) {
      if (now.getTime() - session.lastHeartbeat.getTime() > timeout) {
        this.endStreamingSession(sessionId);
      }
    }
  }
}

export default VideoStreamingService;