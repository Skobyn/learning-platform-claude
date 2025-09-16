import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import db from '@/lib/db';
import crypto from 'crypto';

interface VideoAnalyticsEvent {
  id: string;
  userId: string;
  videoId: string;
  sessionId: string;
  eventType: VideoEventType;
  timestamp: Date;
  position: number;
  duration?: number;
  quality?: string;
  playbackRate?: number;
  volume?: number;
  isFullscreen?: boolean;
  deviceInfo: DeviceInfo;
  networkInfo?: NetworkInfo;
  geolocation?: GeoLocation;
  metadata?: Record<string, any>;
}

type VideoEventType =
  | 'VIDEO_START'
  | 'VIDEO_PLAY'
  | 'VIDEO_PAUSE'
  | 'VIDEO_SEEK'
  | 'VIDEO_BUFFER_START'
  | 'VIDEO_BUFFER_END'
  | 'VIDEO_QUALITY_CHANGE'
  | 'VIDEO_SPEED_CHANGE'
  | 'VIDEO_VOLUME_CHANGE'
  | 'VIDEO_FULLSCREEN'
  | 'VIDEO_EXIT_FULLSCREEN'
  | 'VIDEO_END'
  | 'VIDEO_ERROR'
  | 'VIDEO_PROGRESS'
  | 'CHAPTER_START'
  | 'CHAPTER_END'
  | 'SUBTITLE_TOGGLE'
  | 'INTERACTION_CLICK'
  | 'QUIZ_START'
  | 'QUIZ_COMPLETE'
  | 'NOTE_CREATE'
  | 'BOOKMARK_CREATE';

interface DeviceInfo {
  userAgent: string;
  platform: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  touchEnabled: boolean;
  connectionType?: string;
  effectiveType?: string;
}

interface NetworkInfo {
  bandwidth: number;
  effectiveType: string;
  rtt: number;
  downlink: number;
  saveData: boolean;
}

interface GeoLocation {
  country: string;
  region: string;
  city: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
}

interface WatchSession {
  id: string;
  userId: string;
  videoId: string;
  startTime: Date;
  endTime?: Date;
  totalWatchTime: number;
  maxPosition: number;
  watchPercentage: number;
  completionRate: number;
  averageQuality: string;
  qualityChanges: number;
  seekCount: number;
  pauseCount: number;
  bufferEvents: number;
  totalBufferTime: number;
  interactionCount: number;
  deviceInfo: DeviceInfo;
  engagementScore: number;
  attentionScore: number;
}

interface VideoMetrics {
  videoId: string;
  totalViews: number;
  uniqueViewers: number;
  totalWatchTime: number;
  averageWatchTime: number;
  completionRate: number;
  engagementRate: number;
  qualityDistribution: Record<string, number>;
  deviceDistribution: Record<string, number>;
  geographicDistribution: Record<string, number>;
  dropOffPoints: Array<{ position: number; count: number }>;
  heatmapData: Array<{ time: number; engagement: number }>;
  retentionCurve: Array<{ time: number; retention: number }>;
}

interface LearnerInsights {
  userId: string;
  totalVideosWatched: number;
  totalWatchTime: number;
  averageCompletionRate: number;
  preferredQuality: string;
  preferredPlaybackSpeed: number;
  mostActiveHours: number[];
  learningPace: 'slow' | 'medium' | 'fast';
  engagementLevel: 'low' | 'medium' | 'high';
  attentionSpan: number;
  knowledgeRetention: number;
  personalizedRecommendations: string[];
}

interface CourseAnalytics {
  courseId: string;
  totalEnrollments: number;
  activeViewers: number;
  completionRate: number;
  averageProgress: number;
  dropOffRate: number;
  mostPopularVideos: Array<{ videoId: string; views: number }>;
  leastEngagingVideos: Array<{ videoId: string; engagementScore: number }>;
  optimalVideoLengths: number[];
  peakViewingTimes: Array<{ hour: number; count: number }>;
  learnerFeedback: {
    averageRating: number;
    sentimentScore: number;
    commonIssues: string[];
  };
}

interface RealTimeMetrics {
  currentViewers: number;
  viewersGrowth: number;
  activeRegions: Record<string, number>;
  popularVideos: Array<{ videoId: string; viewers: number }>;
  systemHealth: {
    transcoding: { queue: number; processing: number };
    streaming: { bandwidth: number; errors: number };
    storage: { usage: number; available: number };
  };
}

class VideoAnalyticsService extends EventEmitter {
  private redis: Redis;
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes
  private activeSessions = new Map<string, WatchSession>();
  private metricsCache = new Map<string, { data: any; expiry: number }>();
  private batchSize = 100;
  private flushInterval = 5000; // 5 seconds
  private eventBuffer: VideoAnalyticsEvent[] = [];

  constructor() {
    super();

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });

    this.startBatchProcessor();
    this.startSessionCleanup();
  }

  /**
   * Track video analytics event
   */
  async trackEvent(event: Omit<VideoAnalyticsEvent, 'id' | 'timestamp'>): Promise<void> {
    try {
      const analyticsEvent: VideoAnalyticsEvent = {
        ...event,
        id: crypto.randomUUID(),
        timestamp: new Date()
      };

      // Add to buffer for batch processing
      this.eventBuffer.push(analyticsEvent);

      // Update session data
      await this.updateSession(analyticsEvent);

      // Emit real-time event
      this.emit('analytics-event', analyticsEvent);

      // Update real-time metrics
      await this.updateRealTimeMetrics(analyticsEvent);

    } catch (error) {
      console.error('Failed to track analytics event:', error);
    }
  }

  /**
   * Start or update watch session
   */
  async startWatchSession(
    userId: string,
    videoId: string,
    deviceInfo: DeviceInfo,
    sessionId?: string
  ): Promise<{ sessionId: string }> {
    try {
      const id = sessionId || crypto.randomUUID();

      const session: WatchSession = {
        id,
        userId,
        videoId,
        startTime: new Date(),
        totalWatchTime: 0,
        maxPosition: 0,
        watchPercentage: 0,
        completionRate: 0,
        averageQuality: '720p',
        qualityChanges: 0,
        seekCount: 0,
        pauseCount: 0,
        bufferEvents: 0,
        totalBufferTime: 0,
        interactionCount: 0,
        deviceInfo,
        engagementScore: 0,
        attentionScore: 0
      };

      this.activeSessions.set(id, session);

      // Store session in Redis
      await this.redis.setex(
        `video:session:${id}`,
        this.sessionTimeout / 1000,
        JSON.stringify(session)
      );

      // Track session start event
      await this.trackEvent({
        userId,
        videoId,
        sessionId: id,
        eventType: 'VIDEO_START',
        position: 0,
        deviceInfo
      });

      return { sessionId: id };

    } catch (error) {
      console.error('Failed to start watch session:', error);
      throw error;
    }
  }

  /**
   * End watch session
   */
  async endWatchSession(sessionId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId) ||
        JSON.parse(await this.redis.get(`video:session:${sessionId}`) || '{}');

      if (!session || !session.id) return;

      session.endTime = new Date();

      // Calculate final metrics
      session.engagementScore = this.calculateEngagementScore(session);
      session.attentionScore = this.calculateAttentionScore(session);

      // Store completed session in database
      await db.videoWatchSession.create({
        data: {
          id: session.id,
          userId: session.userId,
          videoId: session.videoId,
          startTime: session.startTime,
          endTime: session.endTime,
          totalWatchTime: session.totalWatchTime,
          maxPosition: session.maxPosition,
          watchPercentage: session.watchPercentage,
          completionRate: session.completionRate,
          averageQuality: session.averageQuality,
          qualityChanges: session.qualityChanges,
          seekCount: session.seekCount,
          pauseCount: session.pauseCount,
          bufferEvents: session.bufferEvents,
          totalBufferTime: session.totalBufferTime,
          interactionCount: session.interactionCount,
          engagementScore: session.engagementScore,
          attentionScore: session.attentionScore,
          deviceInfo: session.deviceInfo,
          metadata: {}
        }
      });

      // Track session end event
      await this.trackEvent({
        userId: session.userId,
        videoId: session.videoId,
        sessionId: session.id,
        eventType: 'VIDEO_END',
        position: session.maxPosition,
        deviceInfo: session.deviceInfo
      });

      // Clean up
      this.activeSessions.delete(sessionId);
      await this.redis.del(`video:session:${sessionId}`);

    } catch (error) {
      console.error('Failed to end watch session:', error);
    }
  }

  /**
   * Update session with new event
   */
  private async updateSession(event: VideoAnalyticsEvent): Promise<void> {
    const session = this.activeSessions.get(event.sessionId);
    if (!session) return;

    // Update session metrics based on event type
    switch (event.eventType) {
      case 'VIDEO_PLAY':
        session.totalWatchTime += 1; // Approximate
        break;

      case 'VIDEO_PAUSE':
        session.pauseCount++;
        break;

      case 'VIDEO_SEEK':
        session.seekCount++;
        break;

      case 'VIDEO_BUFFER_START':
        session.bufferEvents++;
        break;

      case 'VIDEO_QUALITY_CHANGE':
        session.qualityChanges++;
        if (event.quality) {
          session.averageQuality = event.quality;
        }
        break;

      case 'VIDEO_PROGRESS':
        session.maxPosition = Math.max(session.maxPosition, event.position);
        if (event.duration) {
          session.watchPercentage = (session.maxPosition / event.duration) * 100;
          session.completionRate = session.watchPercentage >= 90 ? 1 : 0;
        }
        break;

      case 'INTERACTION_CLICK':
      case 'NOTE_CREATE':
      case 'BOOKMARK_CREATE':
        session.interactionCount++;
        break;
    }

    // Update session in Redis
    await this.redis.setex(
      `video:session:${event.sessionId}`,
      this.sessionTimeout / 1000,
      JSON.stringify(session)
    );
  }

  /**
   * Get video metrics
   */
  async getVideoMetrics(
    videoId: string,
    timeRange: '1h' | '24h' | '7d' | '30d' = '7d'
  ): Promise<VideoMetrics> {
    try {
      const cacheKey = `metrics:video:${videoId}:${timeRange}`;
      const cached = this.metricsCache.get(cacheKey);

      if (cached && cached.expiry > Date.now()) {
        return cached.data;
      }

      const endDate = new Date();
      const startDate = this.getStartDate(endDate, timeRange);

      // Get analytics events
      const events = await db.analyticsEvent.findMany({
        where: {
          entityId: videoId,
          entityType: 'video',
          timestamp: {
            gte: startDate,
            lte: endDate
          }
        },
        orderBy: { timestamp: 'asc' }
      });

      // Get watch sessions
      const sessions = await db.videoWatchSession.findMany({
        where: {
          videoId,
          startTime: {
            gte: startDate,
            lte: endDate
          }
        }
      });

      // Calculate metrics
      const totalViews = events.filter(e => e.eventType === 'VIDEO_START').length;
      const uniqueViewers = new Set(events.map(e => e.userId).filter(Boolean)).size;
      const totalWatchTime = sessions.reduce((sum, s) => sum + s.totalWatchTime, 0);
      const completedSessions = sessions.filter(s => s.completionRate >= 0.9);
      const completionRate = sessions.length > 0 ? completedSessions.length / sessions.length : 0;

      // Quality distribution
      const qualityChanges = events.filter(e => e.eventType === 'VIDEO_QUALITY_CHANGE');
      const qualityDistribution = this.calculateDistribution(
        qualityChanges.map(e => e.properties?.quality || 'unknown')
      );

      // Device distribution
      const deviceDistribution = this.calculateDistribution(
        sessions.map(s => s.deviceInfo?.platform || 'unknown')
      );

      // Drop-off analysis
      const dropOffPoints = this.calculateDropOffPoints(events);

      // Retention curve
      const retentionCurve = this.calculateRetentionCurve(sessions);

      // Engagement heatmap
      const heatmapData = this.calculateEngagementHeatmap(events);

      const metrics: VideoMetrics = {
        videoId,
        totalViews,
        uniqueViewers,
        totalWatchTime,
        averageWatchTime: sessions.length > 0 ? totalWatchTime / sessions.length : 0,
        completionRate,
        engagementRate: sessions.length > 0 ? sessions.reduce((sum, s) => sum + s.engagementScore, 0) / sessions.length : 0,
        qualityDistribution,
        deviceDistribution,
        geographicDistribution: {}, // Would need IP geolocation
        dropOffPoints,
        heatmapData,
        retentionCurve
      };

      // Cache result
      this.metricsCache.set(cacheKey, {
        data: metrics,
        expiry: Date.now() + 5 * 60 * 1000 // 5 minutes
      });

      return metrics;

    } catch (error) {
      console.error('Failed to get video metrics:', error);
      throw error;
    }
  }

  /**
   * Get learner insights
   */
  async getLearnerInsights(
    userId: string,
    timeRange: '7d' | '30d' | '90d' = '30d'
  ): Promise<LearnerInsights> {
    try {
      const endDate = new Date();
      const startDate = this.getStartDate(endDate, timeRange);

      // Get user's watch sessions
      const sessions = await db.videoWatchSession.findMany({
        where: {
          userId,
          startTime: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          video: true
        }
      });

      if (sessions.length === 0) {
        return this.getDefaultLearnerInsights(userId);
      }

      const totalVideosWatched = sessions.length;
      const totalWatchTime = sessions.reduce((sum, s) => sum + s.totalWatchTime, 0);
      const averageCompletionRate = sessions.reduce((sum, s) => sum + s.completionRate, 0) / sessions.length;

      // Calculate preferred quality
      const qualityFrequency = sessions.reduce((acc, s) => {
        acc[s.averageQuality] = (acc[s.averageQuality] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const preferredQuality = Object.keys(qualityFrequency).reduce((a, b) =>
        qualityFrequency[a] > qualityFrequency[b] ? a : b
      );

      // Calculate learning pace based on video completion times
      const averageSessionDuration = sessions.reduce((sum, s) => {
        const duration = s.endTime ? (s.endTime.getTime() - s.startTime.getTime()) / 1000 : 0;
        return sum + duration;
      }, 0) / sessions.length;

      const averageVideoLength = sessions.reduce((sum, s) => {
        return sum + (s.video?.metadata?.duration || 0);
      }, 0) / sessions.length;

      const paceRatio = averageVideoLength > 0 ? averageSessionDuration / averageVideoLength : 1;
      const learningPace = paceRatio < 0.8 ? 'fast' : paceRatio > 1.2 ? 'slow' : 'medium';

      // Calculate engagement level
      const averageEngagement = sessions.reduce((sum, s) => sum + s.engagementScore, 0) / sessions.length;
      const engagementLevel = averageEngagement < 0.3 ? 'low' : averageEngagement > 0.7 ? 'high' : 'medium';

      // Calculate most active hours
      const hourDistribution = sessions.reduce((acc, s) => {
        const hour = s.startTime.getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const mostActiveHours = Object.entries(hourDistribution)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([hour]) => parseInt(hour));

      // Calculate attention span (average session length)
      const attentionSpan = averageSessionDuration / 60; // in minutes

      const insights: LearnerInsights = {
        userId,
        totalVideosWatched,
        totalWatchTime,
        averageCompletionRate,
        preferredQuality,
        preferredPlaybackSpeed: 1.0, // Would need to track this
        mostActiveHours,
        learningPace,
        engagementLevel,
        attentionSpan,
        knowledgeRetention: averageCompletionRate, // Simplified
        personalizedRecommendations: await this.generateRecommendations(userId, sessions)
      };

      return insights;

    } catch (error) {
      console.error('Failed to get learner insights:', error);
      throw error;
    }
  }

  /**
   * Get course analytics
   */
  async getCourseAnalytics(courseId: string): Promise<CourseAnalytics> {
    try {
      // Get course enrollments
      const enrollments = await db.enrollment.count({
        where: { courseId }
      });

      // Get course videos
      const videos = await db.video.findMany({
        where: { courseId },
        include: {
          watchSessions: {
            where: {
              startTime: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
              }
            }
          }
        }
      });

      const totalSessions = videos.reduce((sum, v) => sum + v.watchSessions.length, 0);
      const completedSessions = videos.reduce((sum, v) =>
        sum + v.watchSessions.filter(s => s.completionRate >= 0.9).length, 0
      );

      const completionRate = totalSessions > 0 ? completedSessions / totalSessions : 0;

      // Calculate most popular videos
      const mostPopularVideos = videos
        .map(v => ({ videoId: v.id, views: v.watchSessions.length }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);

      // Calculate least engaging videos
      const leastEngagingVideos = videos
        .map(v => ({
          videoId: v.id,
          engagementScore: v.watchSessions.length > 0
            ? v.watchSessions.reduce((sum, s) => sum + s.engagementScore, 0) / v.watchSessions.length
            : 0
        }))
        .sort((a, b) => a.engagementScore - b.engagementScore)
        .slice(0, 5);

      const analytics: CourseAnalytics = {
        courseId,
        totalEnrollments: enrollments,
        activeViewers: new Set(videos.flatMap(v => v.watchSessions.map(s => s.userId))).size,
        completionRate,
        averageProgress: completionRate,
        dropOffRate: 1 - completionRate,
        mostPopularVideos,
        leastEngagingVideos,
        optimalVideoLengths: [300, 600, 900], // 5, 10, 15 minutes - would calculate from data
        peakViewingTimes: this.calculatePeakViewingTimes(videos.flatMap(v => v.watchSessions)),
        learnerFeedback: {
          averageRating: 4.2, // Would come from actual feedback
          sentimentScore: 0.8,
          commonIssues: []
        }
      };

      return analytics;

    } catch (error) {
      console.error('Failed to get course analytics:', error);
      throw error;
    }
  }

  /**
   * Get real-time metrics
   */
  async getRealTimeMetrics(): Promise<RealTimeMetrics> {
    try {
      const currentTime = new Date();
      const fiveMinutesAgo = new Date(currentTime.getTime() - 5 * 60 * 1000);

      // Count active sessions
      const activeSessions = await this.redis.keys('video:session:*');
      const currentViewers = activeSessions.length;

      // Get system health from Redis
      const systemHealth = {
        transcoding: {
          queue: await this.redis.llen('transcoding:queue') || 0,
          processing: await this.redis.scard('transcoding:active') || 0
        },
        streaming: {
          bandwidth: 0, // Would calculate from actual streaming data
          errors: 0
        },
        storage: {
          usage: 0, // Would get from filesystem
          available: 0
        }
      };

      const metrics: RealTimeMetrics = {
        currentViewers,
        viewersGrowth: 0, // Would calculate growth rate
        activeRegions: {}, // Would get from geo data
        popularVideos: [], // Would get from current streaming sessions
        systemHealth
      };

      return metrics;

    } catch (error) {
      console.error('Failed to get real-time metrics:', error);
      throw error;
    }
  }

  /**
   * Generate A/B test insights
   */
  async generateABTestInsights(
    videoId: string,
    variants: string[],
    metric: 'completion_rate' | 'engagement' | 'watch_time'
  ): Promise<{
    winner: string;
    confidence: number;
    results: Array<{ variant: string; value: number; sampleSize: number }>;
  }> {
    try {
      const results = [];

      for (const variant of variants) {
        const sessions = await db.videoWatchSession.findMany({
          where: {
            videoId,
            metadata: {
              path: ['variant'],
              equals: variant
            }
          }
        });

        let value: number;
        switch (metric) {
          case 'completion_rate':
            value = sessions.length > 0
              ? sessions.filter(s => s.completionRate >= 0.9).length / sessions.length
              : 0;
            break;
          case 'engagement':
            value = sessions.length > 0
              ? sessions.reduce((sum, s) => sum + s.engagementScore, 0) / sessions.length
              : 0;
            break;
          case 'watch_time':
            value = sessions.length > 0
              ? sessions.reduce((sum, s) => sum + s.totalWatchTime, 0) / sessions.length
              : 0;
            break;
        }

        results.push({
          variant,
          value,
          sampleSize: sessions.length
        });
      }

      // Simple winner determination (would use proper statistical testing)
      const winner = results.reduce((best, current) =>
        current.value > best.value ? current : best
      ).variant;

      return {
        winner,
        confidence: 0.95, // Would calculate actual statistical confidence
        results
      };

    } catch (error) {
      console.error('Failed to generate A/B test insights:', error);
      throw error;
    }
  }

  /**
   * Calculate engagement score
   */
  private calculateEngagementScore(session: WatchSession): number {
    let score = 0;

    // Base score from completion rate
    score += session.completionRate * 0.4;

    // Interaction bonus
    score += Math.min(session.interactionCount * 0.1, 0.3);

    // Quality consistency bonus
    const qualityPenalty = session.qualityChanges > 5 ? 0.1 : 0;
    score -= qualityPenalty;

    // Buffer penalty
    const bufferPenalty = session.bufferEvents > 10 ? 0.1 : 0;
    score -= bufferPenalty;

    // Seek penalty (too much seeking indicates confusion)
    const seekPenalty = session.seekCount > 20 ? 0.1 : 0;
    score -= seekPenalty;

    // Watch time bonus
    const watchTimeRatio = session.totalWatchTime / (session.maxPosition || 1);
    score += Math.min(watchTimeRatio * 0.2, 0.2);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate attention score
   */
  private calculateAttentionScore(session: WatchSession): number {
    const sessionDuration = session.endTime
      ? (session.endTime.getTime() - session.startTime.getTime()) / 1000
      : 0;

    if (sessionDuration === 0) return 0;

    // Ratio of actual watch time to session duration
    const attentionRatio = session.totalWatchTime / sessionDuration;

    // Penalize for excessive pauses
    const pausePenalty = Math.min(session.pauseCount * 0.02, 0.2);

    // Penalize for excessive seeking
    const seekPenalty = Math.min(session.seekCount * 0.01, 0.1);

    let score = attentionRatio - pausePenalty - seekPenalty;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Helper methods
   */
  private calculateDistribution(values: string[]): Record<string, number> {
    const total = values.length;
    return values.reduce((acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private calculateDropOffPoints(events: any[]): Array<{ position: number; count: number }> {
    // Simplified implementation - would analyze actual drop-off patterns
    return [];
  }

  private calculateRetentionCurve(sessions: any[]): Array<{ time: number; retention: number }> {
    // Simplified implementation - would calculate retention at different time points
    return [];
  }

  private calculateEngagementHeatmap(events: any[]): Array<{ time: number; engagement: number }> {
    // Simplified implementation - would calculate engagement levels over time
    return [];
  }

  private calculatePeakViewingTimes(sessions: any[]): Array<{ hour: number; count: number }> {
    const hourCounts = sessions.reduce((acc, session) => {
      const hour = new Date(session.startTime).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    return Object.entries(hourCounts)
      .map(([hour, count]) => ({ hour: parseInt(hour), count }))
      .sort((a, b) => b.count - a.count);
  }

  private getStartDate(endDate: Date, timeRange: string): Date {
    const ranges = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    };

    return new Date(endDate.getTime() - (ranges[timeRange] || ranges['7d']));
  }

  private getDefaultLearnerInsights(userId: string): LearnerInsights {
    return {
      userId,
      totalVideosWatched: 0,
      totalWatchTime: 0,
      averageCompletionRate: 0,
      preferredQuality: '720p',
      preferredPlaybackSpeed: 1.0,
      mostActiveHours: [],
      learningPace: 'medium',
      engagementLevel: 'medium',
      attentionSpan: 0,
      knowledgeRetention: 0,
      personalizedRecommendations: []
    };
  }

  private async generateRecommendations(userId: string, sessions: any[]): Promise<string[]> {
    // Simplified recommendation engine
    const recommendations = [];

    if (sessions.length > 0) {
      const avgCompletion = sessions.reduce((sum, s) => sum + s.completionRate, 0) / sessions.length;

      if (avgCompletion < 0.5) {
        recommendations.push('Consider shorter video formats');
        recommendations.push('Add more interactive elements');
      }

      if (sessions.some(s => s.bufferEvents > 5)) {
        recommendations.push('Check your internet connection');
        recommendations.push('Try lower video quality for smoother playback');
      }
    }

    return recommendations;
  }

  /**
   * Batch processing methods
   */
  private startBatchProcessor(): void {
    setInterval(() => {
      this.flushEventBuffer();
    }, this.flushInterval);
  }

  private async flushEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    try {
      const events = this.eventBuffer.splice(0, this.batchSize);

      // Store events in database
      await db.analyticsEvent.createMany({
        data: events.map(event => ({
          id: event.id,
          userId: event.userId,
          eventType: event.eventType,
          entityType: 'video',
          entityId: event.videoId,
          properties: {
            sessionId: event.sessionId,
            position: event.position,
            duration: event.duration,
            quality: event.quality,
            playbackRate: event.playbackRate,
            volume: event.volume,
            isFullscreen: event.isFullscreen,
            deviceInfo: event.deviceInfo,
            networkInfo: event.networkInfo,
            geolocation: event.geolocation,
            ...event.metadata
          },
          timestamp: event.timestamp
        }))
      });

    } catch (error) {
      console.error('Failed to flush event buffer:', error);
    }
  }

  private startSessionCleanup(): void {
    setInterval(async () => {
      await this.cleanupInactiveSessions();
    }, 60000); // Every minute
  }

  private async cleanupInactiveSessions(): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.sessionTimeout;

      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.startTime.getTime() < cutoffTime) {
          await this.endWatchSession(sessionId);
        }
      }

    } catch (error) {
      console.error('Failed to cleanup inactive sessions:', error);
    }
  }

  private async updateRealTimeMetrics(event: VideoAnalyticsEvent): Promise<void> {
    try {
      const key = `realtime:metrics:${new Date().toISOString().slice(0, 16)}`; // Per minute

      await this.redis.hincrby(key, 'total_events', 1);
      await this.redis.hincrby(key, `events:${event.eventType}`, 1);
      await this.redis.hincrby(key, `videos:${event.videoId}`, 1);
      await this.redis.expire(key, 3600); // 1 hour TTL

    } catch (error) {
      console.error('Failed to update real-time metrics:', error);
    }
  }
}

export const videoAnalyticsService = new VideoAnalyticsService();
export type {
  VideoAnalyticsEvent,
  WatchSession,
  VideoMetrics,
  LearnerInsights,
  CourseAnalytics,
  RealTimeMetrics
};