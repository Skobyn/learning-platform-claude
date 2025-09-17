import { redis } from '../../lib/redis';
import { db } from '../../lib/db';

export interface VideoAnalytics {
  videoId: string;
  userId: string;
  sessionId: string;
  watchTime: number;
  totalDuration: number;
  completionRate: number;
  qualitySwitches: number;
  rebufferCount: number;
  rebufferTime: number;
  averageBitrate: number;
  peakBitrate: number;
  engagementEvents: EngagementEvent[];
  watchSessions: WatchSession[];
}

export interface EngagementEvent {
  type: 'play' | 'pause' | 'seek' | 'skip' | 'quality_change' | 'fullscreen' | 'volume_change';
  timestamp: number; // seconds into video
  value?: any; // additional data specific to event type
  sessionTime: Date;
}

export interface WatchSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  device: string;
  browser: string;
  country: string;
  quality: string;
  bandwidth: number;
}

export interface ViewerEngagement {
  attentionScore: number; // 0-100
  interactionRate: number;
  dropOffPoints: number[];
  replaySegments: { start: number; end: number; count: number }[];
  averageViewDuration: number;
}

export interface VideoPerformance {
  videoId: string;
  totalViews: number;
  uniqueViewers: number;
  totalWatchTime: number;
  averageWatchTime: number;
  completionRate: number;
  engagement: ViewerEngagement;
  qualityDistribution: Record<string, number>;
  deviceDistribution: Record<string, number>;
  geographicDistribution: Record<string, number>;
  peakConcurrentViewers: number;
  bufferingMetrics: BufferingMetrics;
}

export interface BufferingMetrics {
  averageRebufferCount: number;
  averageRebufferTime: number;
  bufferingRatio: number; // rebuffer time / watch time
  qualityStability: number; // fewer switches = higher stability
}

export interface HeatmapData {
  timestamp: number;
  engagement: number;
  viewers: number;
  interactions: number;
}

export class VideoAnalyticsService {
  private eventBuffer = new Map<string, EngagementEvent[]>();
  private flushInterval = 30000; // 30 seconds

  constructor() {
    this.startEventFlushing();
  }

  /**
   * Track video play event
   */
  async trackPlay(userId: string, videoId: string, sessionId: string, timestamp: number, quality: string): Promise<void> {
    const event: EngagementEvent = {
      type: 'play',
      timestamp,
      value: { quality },
      sessionTime: new Date()
    };

    await this.recordEvent(userId, videoId, sessionId, event);
    await this.updateRealTimeMetrics(videoId, 'play', 1);
  }

  /**
   * Track video pause event
   */
  async trackPause(userId: string, videoId: string, sessionId: string, timestamp: number): Promise<void> {
    const event: EngagementEvent = {
      type: 'pause',
      timestamp,
      sessionTime: new Date()
    };

    await this.recordEvent(userId, videoId, sessionId, event);
    await this.updateRealTimeMetrics(videoId, 'pause', 1);
  }

  /**
   * Track seek/scrub event
   */
  async trackSeek(userId: string, videoId: string, sessionId: string, fromTime: number, toTime: number): Promise<void> {
    const event: EngagementEvent = {
      type: 'seek',
      timestamp: toTime,
      value: { fromTime, toTime, seekDistance: Math.abs(toTime - fromTime) },
      sessionTime: new Date()
    };

    await this.recordEvent(userId, videoId, sessionId, event);

    // Track skip behavior
    if (Math.abs(toTime - fromTime) > 10) { // Skip of more than 10 seconds
      await this.updateRealTimeMetrics(videoId, 'skip', 1);
    }
  }

  /**
   * Track quality change
   */
  async trackQualityChange(userId: string, videoId: string, sessionId: string, timestamp: number, fromQuality: string, toQuality: string, reason: string): Promise<void> {
    const event: EngagementEvent = {
      type: 'quality_change',
      timestamp,
      value: { fromQuality, toQuality, reason },
      sessionTime: new Date()
    };

    await this.recordEvent(userId, videoId, sessionId, event);
    await this.updateRealTimeMetrics(videoId, 'qualityChange', 1);
  }

  /**
   * Track buffering event
   */
  async trackBuffering(userId: string, videoId: string, sessionId: string, timestamp: number, duration: number): Promise<void> {
    await this.updateSessionMetrics(sessionId, {
      rebufferCount: 1,
      rebufferTime: duration
    });

    await this.updateRealTimeMetrics(videoId, 'buffering', duration);
  }

  /**
   * Track watch progress
   */
  async trackWatchProgress(userId: string, videoId: string, sessionId: string, currentTime: number, duration: number): Promise<void> {
    const completionRate = (currentTime / duration) * 100;

    // Update session metrics
    await this.updateSessionMetrics(sessionId, {
      watchTime: currentTime,
      completionRate
    });

    // Track milestone completions
    const milestones = [25, 50, 75, 90, 100];
    for (const milestone of milestones) {
      if (completionRate >= milestone) {
        const key = `milestone:${videoId}:${userId}:${milestone}`;
        const exists = await redis.get(key);
        if (!exists) {
          await redis.setex(key, 24 * 3600, '1'); // 24 hour expiry
          await this.updateRealTimeMetrics(videoId, `milestone${milestone}`, 1);
        }
      }
    }
  }

  /**
   * Start watch session
   */
  async startWatchSession(userId: string, videoId: string, deviceInfo: any): Promise<string> {
    const sessionId = this.generateSessionId();

    const session: WatchSession = {
      id: sessionId,
      startTime: new Date(),
      duration: 0,
      device: deviceInfo.device || 'unknown',
      browser: deviceInfo.browser || 'unknown',
      country: deviceInfo.country || 'unknown',
      quality: 'auto',
      bandwidth: 0
    };

    await redis.setex(`session:${sessionId}`, 7200, JSON.stringify(session));
    await this.updateRealTimeMetrics(videoId, 'sessions', 1);

    return sessionId;
  }

  /**
   * End watch session
   */
  async endWatchSession(sessionId: string, finalWatchTime: number): Promise<void> {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) return;

    const session: WatchSession = JSON.parse(sessionData);
    session.endTime = new Date();
    session.duration = finalWatchTime;

    // Store session in database for long-term analytics
    await this.storeWatchSession(session);

    // Remove from Redis
    await redis.del(`session:${sessionId}`);
  }

  /**
   * Get video performance metrics
   */
  async getVideoPerformance(videoId: string, timeframe: '24h' | '7d' | '30d' = '24h'): Promise<VideoPerformance> {
    const hours = timeframe === '24h' ? 24 : (timeframe === '7d' ? 168 : 720);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get basic metrics from database
    const [views, sessions, engagement] = await Promise.all([
      this.getVideoViews(videoId, since),
      this.getWatchSessions(videoId, since),
      this.getEngagementData(videoId, since)
    ]);

    // Calculate derived metrics
    const totalWatchTime = sessions.reduce((sum, s) => sum + s.duration, 0);
    const averageWatchTime = sessions.length > 0 ? totalWatchTime / sessions.length : 0;
    const uniqueViewers = new Set(sessions.map(s => s.id)).size;

    // Quality distribution
    const qualityDistribution: Record<string, number> = {};
    sessions.forEach(session => {
      qualityDistribution[session.quality] = (qualityDistribution[session.quality] || 0) + 1;
    });

    // Device distribution
    const deviceDistribution: Record<string, number> = {};
    sessions.forEach(session => {
      deviceDistribution[session.device] = (deviceDistribution[session.device] || 0) + 1;
    });

    // Geographic distribution
    const geographicDistribution: Record<string, number> = {};
    sessions.forEach(session => {
      geographicDistribution[session.country] = (geographicDistribution[session.country] || 0) + 1;
    });

    // Buffering metrics
    const bufferingMetrics = await this.getBufferingMetrics(videoId, since);

    return {
      videoId,
      totalViews: views,
      uniqueViewers,
      totalWatchTime,
      averageWatchTime,
      completionRate: this.calculateCompletionRate(engagement),
      engagement: await this.calculateViewerEngagement(videoId, since),
      qualityDistribution,
      deviceDistribution,
      geographicDistribution,
      peakConcurrentViewers: await this.getPeakConcurrentViewers(videoId, since),
      bufferingMetrics
    };
  }

  /**
   * Generate engagement heatmap data
   */
  async generateHeatmap(videoId: string, timeframe: '24h' | '7d' = '24h'): Promise<HeatmapData[]> {
    const hours = timeframe === '24h' ? 24 : 168;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get video duration
    const videoDuration = await this.getVideoDuration(videoId);
    if (!videoDuration) return [];

    // Create time buckets (5-second intervals)
    const bucketSize = 5;
    const buckets = Math.ceil(videoDuration / bucketSize);
    const heatmapData: HeatmapData[] = [];

    for (let i = 0; i < buckets; i++) {
      const timestamp = i * bucketSize;
      const bucketData = await this.getBucketEngagement(videoId, timestamp, timestamp + bucketSize, since);

      heatmapData.push({
        timestamp,
        engagement: bucketData.engagement,
        viewers: bucketData.viewers,
        interactions: bucketData.interactions
      });
    }

    return heatmapData;
  }

  /**
   * Get real-time metrics
   */
  async getRealTimeMetrics(videoId: string): Promise<Record<string, number>> {
    const metrics: Record<string, number> = {};
    const keys = await redis.keys(`realtime:${videoId}:*`);

    for (const key of keys) {
      const value = await redis.get(key);
      const metricName = key.split(':')[2];
      metrics[metricName] = parseInt(value || '0');
    }

    return metrics;
  }

  /**
   * Get drop-off analysis
   */
  async getDropOffAnalysis(videoId: string, timeframe: '24h' | '7d' = '24h'): Promise<{ timestamp: number; dropOffRate: number }[]> {
    const hours = timeframe === '24h' ? 24 : 168;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const videoDuration = await this.getVideoDuration(videoId);
    if (!videoDuration) return [];

    const analysis: { timestamp: number; dropOffRate: number }[] = [];
    const intervalSize = Math.max(10, videoDuration / 100); // 100 data points max

    for (let timestamp = 0; timestamp < videoDuration; timestamp += intervalSize) {
      const viewersAtStart = await this.getViewersAtTimestamp(videoId, timestamp, since);
      const viewersAtEnd = await this.getViewersAtTimestamp(videoId, timestamp + intervalSize, since);

      const dropOffRate = viewersAtStart > 0 ? ((viewersAtStart - viewersAtEnd) / viewersAtStart) * 100 : 0;

      analysis.push({
        timestamp,
        dropOffRate
      });
    }

    return analysis;
  }

  /**
   * Export analytics data
   */
  async exportAnalytics(videoId: string, format: 'json' | 'csv' = 'json', timeframe: '24h' | '7d' | '30d' = '7d'): Promise<string> {
    const performance = await this.getVideoPerformance(videoId, timeframe);
    const heatmap = await this.generateHeatmap(videoId, timeframe === '30d' ? '7d' : timeframe);
    const dropOff = await this.getDropOffAnalysis(videoId, timeframe === '30d' ? '7d' : timeframe);

    const data = {
      performance,
      heatmap,
      dropOff,
      exportedAt: new Date().toISOString()
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else {
      return this.convertToCSV(data);
    }
  }

  // Private helper methods
  private async recordEvent(userId: string, videoId: string, sessionId: string, event: EngagementEvent): Promise<void> {
    const key = `${userId}:${videoId}:${sessionId}`;

    if (!this.eventBuffer.has(key)) {
      this.eventBuffer.set(key, []);
    }

    this.eventBuffer.get(key)!.push(event);
  }

  private async updateRealTimeMetrics(videoId: string, metric: string, value: number): Promise<void> {
    const key = `realtime:${videoId}:${metric}`;
    await redis.incrby(key, value);
    await redis.expire(key, 24 * 3600); // 24 hour expiry
  }

  private async updateSessionMetrics(sessionId: string, metrics: Partial<{ watchTime: number; completionRate: number; rebufferCount: number; rebufferTime: number }>): Promise<void> {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) return;

    const session = JSON.parse(sessionData);
    Object.assign(session, metrics);

    await redis.setex(`session:${sessionId}`, 7200, JSON.stringify(session));
  }

  private async storeWatchSession(session: WatchSession): Promise<void> {
    // Store in database for long-term analytics
    // This would typically use your database ORM
    console.log('Storing session:', session.id);
  }

  private async getVideoViews(videoId: string, since: Date): Promise<number> {
    // Mock implementation - replace with actual database query
    return Math.floor(Math.random() * 1000);
  }

  private async getWatchSessions(videoId: string, since: Date): Promise<WatchSession[]> {
    // Mock implementation - replace with actual database query
    return [];
  }

  private async getEngagementData(videoId: string, since: Date): Promise<EngagementEvent[]> {
    // Mock implementation - replace with actual database query
    return [];
  }

  private calculateCompletionRate(events: EngagementEvent[]): number {
    // Calculate average completion rate from events
    return 0;
  }

  private async calculateViewerEngagement(videoId: string, since: Date): Promise<ViewerEngagement> {
    return {
      attentionScore: 75,
      interactionRate: 0.15,
      dropOffPoints: [120, 300, 480],
      replaySegments: [],
      averageViewDuration: 180
    };
  }

  private async getBufferingMetrics(videoId: string, since: Date): Promise<BufferingMetrics> {
    return {
      averageRebufferCount: 2.1,
      averageRebufferTime: 5.3,
      bufferingRatio: 0.03,
      qualityStability: 0.85
    };
  }

  private async getPeakConcurrentViewers(videoId: string, since: Date): Promise<number> {
    return Math.floor(Math.random() * 50);
  }

  private async getVideoDuration(videoId: string): Promise<number | null> {
    // Get video duration from database or metadata
    return 600; // Mock: 10 minutes
  }

  private async getBucketEngagement(videoId: string, startTime: number, endTime: number, since: Date): Promise<{ engagement: number; viewers: number; interactions: number }> {
    return {
      engagement: Math.random() * 100,
      viewers: Math.floor(Math.random() * 20),
      interactions: Math.floor(Math.random() * 5)
    };
  }

  private async getViewersAtTimestamp(videoId: string, timestamp: number, since: Date): Promise<number> {
    return Math.floor(Math.random() * 100);
  }

  private convertToCSV(data: any): string {
    // Simplified CSV conversion
    return JSON.stringify(data);
  }

  private generateSessionId(): string {
    return `analytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startEventFlushing(): void {
    setInterval(async () => {
      for (const [key, events] of this.eventBuffer.entries()) {
        if (events.length > 0) {
          // Flush events to database
          await this.flushEvents(key, events);
          this.eventBuffer.set(key, []); // Clear buffer
        }
      }
    }, this.flushInterval);
  }

  private async flushEvents(key: string, events: EngagementEvent[]): Promise<void> {
    // Store events in database for long-term analysis
    console.log(`Flushing ${events.length} events for ${key}`);
  }
}

export default VideoAnalyticsService;