import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { Storage } from '@google-cloud/storage';
import { logger } from '../lib/logger';

export interface VideoAnalyticsEvent {
  sessionId: string;
  videoId: string;
  userId: string;
  eventType: 'play' | 'pause' | 'seek' | 'quality_change' | 'buffer' | 'complete' | 'error';
  timestamp: Date;
  currentTime: number;
  duration?: number;
  quality?: string;
  bandwidth?: number;
  bufferLevel?: number;
  deviceInfo?: {
    type: string;
    os: string;
    browser: string;
    screenSize: string;
  };
  location?: {
    country: string;
    region: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
  metadata?: { [key: string]: any };
}

export interface VideoEngagementMetrics {
  videoId: string;
  totalViews: number;
  uniqueViewers: number;
  totalWatchTime: number;
  averageWatchTime: number;
  completionRate: number;
  engagementRate: number;
  retentionCurve: number[];
  heatmapData: { time: number; intensity: number }[];
  qualityDistribution: { [quality: string]: number };
  deviceDistribution: { [device: string]: number };
  geographicDistribution: { [country: string]: number };
  peakConcurrentViewers: number;
  averageBitrate: number;
  bufferingEvents: number;
  errorRate: number;
}

export interface RealTimeMetrics {
  activeViewers: number;
  currentBitrate: number;
  bufferHealth: number;
  errorCount: number;
  qualityDistribution: { [quality: string]: number };
  geographicDistribution: { [country: string]: number };
}

export interface AnalyticsQuery {
  videoId?: string;
  userId?: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  groupBy?: 'hour' | 'day' | 'week' | 'month';
  filters?: {
    country?: string[];
    deviceType?: string[];
    quality?: string[];
  };
}

export class VideoAnalyticsService extends EventEmitter {
  private redis: Redis;
  private storage: Storage;
  private bucketName: string;
  private batchSize: number = 1000;
  private flushInterval: number = 60000; // 1 minute
  private eventBatch: VideoAnalyticsEvent[] = [];
  private batchTimer?: NodeJS.Timeout;

  constructor(config: {
    redisUrl: string;
    googleCloudConfig: any;
    bucketName: string;
    batchSize?: number;
    flushInterval?: number;
  }) {
    super();

    this.redis = new Redis(config.redisUrl);
    this.storage = new Storage(config.googleCloudConfig);
    this.bucketName = config.bucketName;
    this.batchSize = config.batchSize || 1000;
    this.flushInterval = config.flushInterval || 60000;

    // Start batch processing
    this.startBatchProcessor();

    // Setup cleanup job
    this.scheduleCleanupJobs();
  }

  /**
   * Track a video analytics event
   */
  async trackEvent(event: VideoAnalyticsEvent): Promise<void> {
    try {
      // Add to batch
      this.eventBatch.push({
        ...event,
        timestamp: event.timestamp || new Date()
      });

      // Store in Redis for real-time analytics
      await this.storeRealTimeEvent(event);

      // Update session data
      await this.updateSessionData(event);

      // Flush batch if it's full
      if (this.eventBatch.length >= this.batchSize) {
        await this.flushBatch();
      }

      this.emit('eventTracked', event);
    } catch (error) {
      logger.error('Failed to track analytics event:', error);
      throw error;
    }
  }

  /**
   * Get engagement metrics for a video
   */
  async getVideoMetrics(
    videoId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<VideoEngagementMetrics> {
    try {
      const cacheKey = `analytics:video:${videoId}:${timeRange.start.getTime()}-${timeRange.end.getTime()}`;

      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Calculate metrics
      const metrics = await this.calculateVideoMetrics(videoId, timeRange);

      // Cache for 5 minutes
      await this.redis.setex(cacheKey, 300, JSON.stringify(metrics));

      return metrics;
    } catch (error) {
      logger.error('Failed to get video metrics:', error);
      throw error;
    }
  }

  /**
   * Get real-time metrics for active sessions
   */
  async getRealTimeMetrics(videoId?: string): Promise<RealTimeMetrics> {
    try {
      const pattern = videoId ? `session:${videoId}:*` : 'session:*';
      const sessionKeys = await this.redis.keys(pattern);

      const activeSessions = await Promise.all(
        sessionKeys.map(key => this.redis.hgetall(key))
      );

      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      // Filter active sessions (updated within last 5 minutes)
      const activeViewers = activeSessions.filter(session =>
        parseInt(session.lastUpdate || '0') > fiveMinutesAgo
      );

      // Calculate metrics
      const metrics: RealTimeMetrics = {
        activeViewers: activeViewers.length,
        currentBitrate: this.calculateAverageBitrate(activeViewers),
        bufferHealth: this.calculateBufferHealth(activeViewers),
        errorCount: await this.getRecentErrorCount(),
        qualityDistribution: this.calculateQualityDistribution(activeViewers),
        geographicDistribution: this.calculateGeographicDistribution(activeViewers)
      };

      return metrics;
    } catch (error) {
      logger.error('Failed to get real-time metrics:', error);
      throw error;
    }
  }

  /**
   * Generate retention curve for video engagement analysis
   */
  async generateRetentionCurve(
    videoId: string,
    timeRange: { start: Date; end: Date },
    intervalSeconds: number = 30
  ): Promise<number[]> {
    try {
      // Get video duration
      const videoDuration = await this.getVideoDuration(videoId);
      const intervals = Math.ceil(videoDuration / intervalSeconds);
      const retentionCurve: number[] = new Array(intervals).fill(0);

      // Query events from time series data
      const events = await this.queryTimeSeriesEvents(videoId, timeRange, ['play', 'pause', 'seek', 'complete']);

      // Group by session and calculate retention
      const sessionData = new Map<string, { startTime: number; events: VideoAnalyticsEvent[] }>();

      events.forEach(event => {
        if (!sessionData.has(event.sessionId)) {
          sessionData.set(event.sessionId, { startTime: event.currentTime, events: [] });
        }
        sessionData.get(event.sessionId)!.events.push(event);
      });

      // Calculate retention at each interval
      sessionData.forEach(({ events }) => {
        const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        let currentInterval = 0;
        let watchedIntervals = new Set<number>();

        sortedEvents.forEach(event => {
          const intervalIndex = Math.floor(event.currentTime / intervalSeconds);
          watchedIntervals.add(intervalIndex);
        });

        // Mark all watched intervals
        watchedIntervals.forEach(interval => {
          if (interval < retentionCurve.length) {
            retentionCurve[interval]++;
          }
        });
      });

      // Convert to percentages
      const totalSessions = sessionData.size;
      return retentionCurve.map(count => totalSessions > 0 ? count / totalSessions : 0);

    } catch (error) {
      logger.error('Failed to generate retention curve:', error);
      throw error;
    }
  }

  /**
   * Generate heatmap data for video engagement
   */
  async generateHeatmap(
    videoId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{ time: number; intensity: number }[]> {
    try {
      const videoDuration = await this.getVideoDuration(videoId);
      const heatmapData: { time: number; intensity: number }[] = [];

      // Create 100 data points for smooth heatmap
      const intervalDuration = videoDuration / 100;

      for (let i = 0; i < 100; i++) {
        const time = i * intervalDuration;
        const intensity = await this.getEngagementIntensity(videoId, time, intervalDuration, timeRange);
        heatmapData.push({ time, intensity });
      }

      return heatmapData;
    } catch (error) {
      logger.error('Failed to generate heatmap:', error);
      throw error;
    }
  }

  /**
   * Query analytics data with flexible filters
   */
  async queryAnalytics(query: AnalyticsQuery): Promise<any[]> {
    try {
      // Build query based on filters
      const events = await this.queryTimeSeriesEvents(
        query.videoId,
        query.timeRange,
        undefined,
        query.filters
      );

      // Group data based on groupBy parameter
      return this.groupAnalyticsData(events, query.groupBy || 'hour');
    } catch (error) {
      logger.error('Failed to query analytics:', error);
      throw error;
    }
  }

  /**
   * Export analytics data to various formats
   */
  async exportAnalytics(
    query: AnalyticsQuery,
    format: 'csv' | 'json' | 'parquet' = 'json'
  ): Promise<string> {
    try {
      const data = await this.queryAnalytics(query);

      let exportContent: string;
      let contentType: string;
      let filename: string;

      switch (format) {
        case 'csv':
          exportContent = this.convertToCSV(data);
          contentType = 'text/csv';
          filename = `analytics-${Date.now()}.csv`;
          break;
        case 'json':
          exportContent = JSON.stringify(data, null, 2);
          contentType = 'application/json';
          filename = `analytics-${Date.now()}.json`;
          break;
        case 'parquet':
          // For Parquet, you'd need a library like 'parquetjs'
          exportContent = JSON.stringify(data, null, 2);
          contentType = 'application/octet-stream';
          filename = `analytics-${Date.now()}.parquet`;
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      // Upload to cloud storage
      const file = this.storage.bucket(this.bucketName).file(`exports/${filename}`);
      await file.save(exportContent, {
        metadata: {
          contentType,
          metadata: {
            exportedAt: new Date().toISOString(),
            query: JSON.stringify(query)
          }
        }
      });

      return `gs://${this.bucketName}/exports/${filename}`;
    } catch (error) {
      logger.error('Failed to export analytics:', error);
      throw error;
    }
  }

  // Private helper methods

  private async storeRealTimeEvent(event: VideoAnalyticsEvent): Promise<void> {
    // Store in Redis sorted sets for time-series data
    const eventKey = `events:${event.videoId}:${event.eventType}`;
    const score = event.timestamp.getTime();

    await this.redis.zadd(eventKey, score, JSON.stringify(event));

    // Set expiration for cleanup (7 days)
    await this.redis.expire(eventKey, 7 * 24 * 60 * 60);
  }

  private async updateSessionData(event: VideoAnalyticsEvent): Promise<void> {
    const sessionKey = `session:${event.videoId}:${event.sessionId}`;

    await this.redis.hmset(sessionKey, {
      videoId: event.videoId,
      userId: event.userId,
      lastUpdate: Date.now(),
      currentTime: event.currentTime,
      quality: event.quality || '',
      bandwidth: event.bandwidth || 0,
      bufferLevel: event.bufferLevel || 0,
      deviceType: event.deviceInfo?.type || '',
      country: event.location?.country || ''
    });

    // Set expiration (1 hour)
    await this.redis.expire(sessionKey, 60 * 60);
  }

  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      if (this.eventBatch.length > 0) {
        this.flushBatch();
      }
    }, this.flushInterval);
  }

  private async flushBatch(): Promise<void> {
    if (this.eventBatch.length === 0) return;

    try {
      const batch = [...this.eventBatch];
      this.eventBatch = [];

      // Process batch for long-term storage
      await this.processBatchForLongTermStorage(batch);

      logger.info(`Flushed ${batch.length} analytics events`);
    } catch (error) {
      logger.error('Failed to flush analytics batch:', error);

      // Re-add events to batch for retry
      this.eventBatch.unshift(...this.eventBatch);
    }
  }

  private async processBatchForLongTermStorage(batch: VideoAnalyticsEvent[]): Promise<void> {
    // Group events by date for partitioning
    const eventsByDate = new Map<string, VideoAnalyticsEvent[]>();

    batch.forEach(event => {
      const date = event.timestamp.toISOString().split('T')[0];
      if (!eventsByDate.has(date)) {
        eventsByDate.set(date, []);
      }
      eventsByDate.get(date)!.push(event);
    });

    // Store each date's events
    for (const [date, events] of eventsByDate) {
      const filename = `analytics/date=${date}/events-${Date.now()}.json`;
      const file = this.storage.bucket(this.bucketName).file(filename);

      const content = events.map(event => JSON.stringify(event)).join('\n');
      await file.save(content, {
        metadata: {
          contentType: 'application/json',
          metadata: {
            date,
            eventCount: events.length.toString(),
            batchedAt: new Date().toISOString()
          }
        }
      });
    }
  }

  private async calculateVideoMetrics(
    videoId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<VideoEngagementMetrics> {
    // This would typically query from a time-series database
    // For demo, we'll simulate with Redis data

    const events = await this.queryTimeSeriesEvents(videoId, timeRange);
    const sessions = this.groupEventsBySessions(events);

    const totalViews = sessions.size;
    const uniqueViewers = new Set(Array.from(sessions.values()).map(s => s[0].userId)).size;

    let totalWatchTime = 0;
    let completedSessions = 0;
    const qualityDistribution: { [quality: string]: number } = {};
    const deviceDistribution: { [device: string]: number } = {};
    const geographicDistribution: { [country: string]: number } = {};

    sessions.forEach(sessionEvents => {
      const sessionWatchTime = this.calculateSessionWatchTime(sessionEvents);
      totalWatchTime += sessionWatchTime;

      if (sessionEvents.some(e => e.eventType === 'complete')) {
        completedSessions++;
      }

      // Distribution calculations
      sessionEvents.forEach(event => {
        if (event.quality) {
          qualityDistribution[event.quality] = (qualityDistribution[event.quality] || 0) + 1;
        }
        if (event.deviceInfo?.type) {
          deviceDistribution[event.deviceInfo.type] = (deviceDistribution[event.deviceInfo.type] || 0) + 1;
        }
        if (event.location?.country) {
          geographicDistribution[event.location.country] = (geographicDistribution[event.location.country] || 0) + 1;
        }
      });
    });

    const averageWatchTime = totalViews > 0 ? totalWatchTime / totalViews : 0;
    const completionRate = totalViews > 0 ? completedSessions / totalViews : 0;

    return {
      videoId,
      totalViews,
      uniqueViewers,
      totalWatchTime,
      averageWatchTime,
      completionRate,
      engagementRate: completionRate * 0.8 + (averageWatchTime / 3600) * 0.2, // Simple calculation
      retentionCurve: await this.generateRetentionCurve(videoId, timeRange),
      heatmapData: await this.generateHeatmap(videoId, timeRange),
      qualityDistribution,
      deviceDistribution,
      geographicDistribution,
      peakConcurrentViewers: await this.calculatePeakConcurrent(videoId, timeRange),
      averageBitrate: this.calculateAverageBitrateFromEvents(events),
      bufferingEvents: events.filter(e => e.eventType === 'buffer').length,
      errorRate: events.filter(e => e.eventType === 'error').length / Math.max(totalViews, 1)
    };
  }

  private async queryTimeSeriesEvents(
    videoId?: string,
    timeRange?: { start: Date; end: Date },
    eventTypes?: string[],
    filters?: any
  ): Promise<VideoAnalyticsEvent[]> {
    const pattern = videoId ? `events:${videoId}:*` : 'events:*';
    const eventKeys = await this.redis.keys(pattern);

    let allEvents: VideoAnalyticsEvent[] = [];

    for (const key of eventKeys) {
      const minScore = timeRange?.start.getTime() || 0;
      const maxScore = timeRange?.end.getTime() || Date.now();

      const eventData = await this.redis.zrangebyscore(key, minScore, maxScore);
      const events = eventData.map(data => JSON.parse(data) as VideoAnalyticsEvent);
      allEvents.push(...events);
    }

    // Apply filters
    if (eventTypes) {
      allEvents = allEvents.filter(e => eventTypes.includes(e.eventType));
    }

    if (filters?.country) {
      allEvents = allEvents.filter(e =>
        e.location?.country && filters.country.includes(e.location.country)
      );
    }

    if (filters?.deviceType) {
      allEvents = allEvents.filter(e =>
        e.deviceInfo?.type && filters.deviceType.includes(e.deviceInfo.type)
      );
    }

    if (filters?.quality) {
      allEvents = allEvents.filter(e =>
        e.quality && filters.quality.includes(e.quality)
      );
    }

    return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private groupEventsBySessions(events: VideoAnalyticsEvent[]): Map<string, VideoAnalyticsEvent[]> {
    const sessions = new Map<string, VideoAnalyticsEvent[]>();

    events.forEach(event => {
      if (!sessions.has(event.sessionId)) {
        sessions.set(event.sessionId, []);
      }
      sessions.get(event.sessionId)!.push(event);
    });

    return sessions;
  }

  private calculateSessionWatchTime(events: VideoAnalyticsEvent[]): number {
    // Simple calculation - could be more sophisticated
    const playEvents = events.filter(e => e.eventType === 'play');
    const pauseEvents = events.filter(e => e.eventType === 'pause');

    let watchTime = 0;
    let lastPlayTime = 0;

    events.forEach(event => {
      if (event.eventType === 'play') {
        lastPlayTime = event.currentTime;
      } else if (event.eventType === 'pause' && lastPlayTime > 0) {
        watchTime += event.currentTime - lastPlayTime;
        lastPlayTime = 0;
      }
    });

    return watchTime;
  }

  private calculateAverageBitrate(sessions: any[]): number {
    const bitrates = sessions
      .map(s => parseFloat(s.bandwidth || '0'))
      .filter(b => b > 0);

    return bitrates.length > 0 ? bitrates.reduce((sum, b) => sum + b, 0) / bitrates.length : 0;
  }

  private calculateAverageBitrateFromEvents(events: VideoAnalyticsEvent[]): number {
    const bitrates = events
      .map(e => e.bandwidth || 0)
      .filter(b => b > 0);

    return bitrates.length > 0 ? bitrates.reduce((sum, b) => sum + b, 0) / bitrates.length : 0;
  }

  private calculateBufferHealth(sessions: any[]): number {
    const bufferLevels = sessions
      .map(s => parseFloat(s.bufferLevel || '0'))
      .filter(b => b >= 0);

    return bufferLevels.length > 0 ? bufferLevels.reduce((sum, b) => sum + b, 0) / bufferLevels.length : 0;
  }

  private calculateQualityDistribution(sessions: any[]): { [quality: string]: number } {
    const distribution: { [quality: string]: number } = {};

    sessions.forEach(session => {
      const quality = session.quality || 'unknown';
      distribution[quality] = (distribution[quality] || 0) + 1;
    });

    return distribution;
  }

  private calculateGeographicDistribution(sessions: any[]): { [country: string]: number } {
    const distribution: { [country: string]: number } = {};

    sessions.forEach(session => {
      const country = session.country || 'unknown';
      distribution[country] = (distribution[country] || 0) + 1;
    });

    return distribution;
  }

  private async getRecentErrorCount(): Promise<number> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const errorKeys = await this.redis.keys('events:*:error');

    let errorCount = 0;
    for (const key of errorKeys) {
      const count = await this.redis.zcount(key, fiveMinutesAgo, Date.now());
      errorCount += count;
    }

    return errorCount;
  }

  private async getVideoDuration(videoId: string): Promise<number> {
    // This would typically come from video metadata
    // For demo, return a default duration
    return 3600; // 1 hour
  }

  private async getEngagementIntensity(
    videoId: string,
    time: number,
    duration: number,
    timeRange: { start: Date; end: Date }
  ): Promise<number> {
    // Calculate engagement intensity at a specific time point
    const events = await this.queryTimeSeriesEvents(videoId, timeRange, ['play', 'seek']);

    const relevantEvents = events.filter(event =>
      event.currentTime >= time && event.currentTime < time + duration
    );

    return relevantEvents.length;
  }

  private async calculatePeakConcurrent(
    videoId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<number> {
    // This would require more sophisticated time-window analysis
    // For demo, return a simulated value
    return Math.floor(Math.random() * 100) + 1;
  }

  private groupAnalyticsData(events: VideoAnalyticsEvent[], groupBy: string): any[] {
    const grouped = new Map<string, VideoAnalyticsEvent[]>();

    events.forEach(event => {
      let key: string;
      const date = event.timestamp;

      switch (groupBy) {
        case 'hour':
          key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = `${weekStart.getFullYear()}-${weekStart.getMonth()}-${weekStart.getDate()}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${date.getMonth()}`;
          break;
        default:
          key = date.toISOString();
      }

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(event);
    });

    return Array.from(grouped.entries()).map(([period, events]) => ({
      period,
      eventCount: events.length,
      uniqueViewers: new Set(events.map(e => e.userId)).size,
      totalWatchTime: events.reduce((sum, e) => sum + (e.currentTime || 0), 0),
      events
    }));
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvLines = [headers.join(',')];

    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        return typeof value === 'string' ? `"${value}"` : value;
      });
      csvLines.push(values.join(','));
    });

    return csvLines.join('\n');
  }

  private scheduleCleanupJobs(): void {
    // Clean up old analytics data daily
    setInterval(async () => {
      try {
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        const eventKeys = await this.redis.keys('events:*');

        for (const key of eventKeys) {
          await this.redis.zremrangebyscore(key, 0, threeDaysAgo);
        }

        logger.info('Analytics cleanup completed');
      } catch (error) {
        logger.error('Analytics cleanup failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // Daily
  }
}

export default VideoAnalyticsService;