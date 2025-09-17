import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { videoAnalyticsService } from '@/services/videoAnalyticsService';
import { rateLimiter } from '@/middleware/rateLimiter';
import { z } from 'zod';

const trackEventSchema = z.object({
  videoId: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventType: z.enum([
    'VIDEO_START',
    'VIDEO_PLAY',
    'VIDEO_PAUSE',
    'VIDEO_SEEK',
    'VIDEO_BUFFER_START',
    'VIDEO_BUFFER_END',
    'VIDEO_QUALITY_CHANGE',
    'VIDEO_SPEED_CHANGE',
    'VIDEO_VOLUME_CHANGE',
    'VIDEO_FULLSCREEN',
    'VIDEO_EXIT_FULLSCREEN',
    'VIDEO_END',
    'VIDEO_ERROR',
    'VIDEO_PROGRESS',
    'CHAPTER_START',
    'CHAPTER_END',
    'SUBTITLE_TOGGLE',
    'INTERACTION_CLICK',
    'QUIZ_START',
    'QUIZ_COMPLETE',
    'NOTE_CREATE',
    'BOOKMARK_CREATE'
  ]),
  position: z.number().min(0),
  duration: z.number().min(0).optional(),
  quality: z.string().optional(),
  playbackRate: z.number().positive().optional(),
  volume: z.number().min(0).max(1).optional(),
  isFullscreen: z.boolean().optional(),
  deviceInfo: z.object({
    userAgent: z.string(),
    platform: z.string(),
    browser: z.string(),
    browserVersion: z.string(),
    os: z.string(),
    osVersion: z.string(),
    screenWidth: z.number(),
    screenHeight: z.number(),
    pixelRatio: z.number(),
    touchEnabled: z.boolean(),
    connectionType: z.string().optional(),
    effectiveType: z.string().optional()
  }),
  networkInfo: z.object({
    bandwidth: z.number(),
    effectiveType: z.string(),
    rtt: z.number(),
    downlink: z.number(),
    saveData: z.boolean()
  }).optional(),
  geolocation: z.object({
    country: z.string(),
    region: z.string(),
    city: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    timezone: z.string()
  }).optional(),
  metadata: z.record(z.any()).optional()
});

const sessionSchema = z.object({
  videoId: z.string().uuid(),
  deviceInfo: z.object({
    userAgent: z.string(),
    platform: z.string(),
    browser: z.string(),
    browserVersion: z.string(),
    os: z.string(),
    osVersion: z.string(),
    screenWidth: z.number(),
    screenHeight: z.number(),
    pixelRatio: z.number(),
    touchEnabled: z.boolean(),
    connectionType: z.string().optional(),
    effectiveType: z.string().optional()
  }),
  sessionId: z.string().uuid().optional()
});

/**
 * POST /api/video/analytics
 * Track video analytics events or manage sessions
 */
export async function POST(req: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = await rateLimiter.checkLimit(req, 'analytics', 500, 3600); // 500 events per hour
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const body = await req.json();
    const action = body.action || 'track';

    switch (action) {
      case 'track':
        // Track analytics event
        try {
          const eventData = trackEventSchema.parse(body);

          await videoAnalyticsService.trackEvent({
            userId,
            ...eventData
          });

          return NextResponse.json({
            success: true,
            message: 'Event tracked successfully'
          });

        } catch (error) {
          if (error instanceof z.ZodError) {
            return NextResponse.json(
              { error: 'Invalid event data', details: error.errors },
              { status: 400 }
            );
          }
          throw error;
        }

      case 'startSession':
        // Start watch session
        try {
          const sessionData = sessionSchema.parse(body);

          const result = await videoAnalyticsService.startWatchSession(
            userId,
            sessionData.videoId,
            sessionData.deviceInfo,
            sessionData.sessionId
          );

          return NextResponse.json({
            success: true,
            sessionId: result.sessionId
          });

        } catch (error) {
          if (error instanceof z.ZodError) {
            return NextResponse.json(
              { error: 'Invalid session data', details: error.errors },
              { status: 400 }
            );
          }
          throw error;
        }

      case 'endSession':
        // End watch session
        const { sessionId } = body;

        if (!sessionId) {
          return NextResponse.json(
            { error: 'Session ID required' },
            { status: 400 }
          );
        }

        await videoAnalyticsService.endWatchSession(sessionId);

        return NextResponse.json({
          success: true,
          message: 'Session ended successfully'
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video/analytics?type=video&id=xxx&timeRange=7d
 * Get analytics data
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if user has admin/instructor permissions
    // This would depend on your permission system
    const hasAnalyticsAccess = await checkAnalyticsAccess(session.user.id);
    if (!hasAnalyticsAccess) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const url = req.nextUrl;
    const type = url.searchParams.get('type');
    const id = url.searchParams.get('id');
    const timeRange = url.searchParams.get('timeRange') as '1h' | '24h' | '7d' | '30d' || '7d';

    switch (type) {
      case 'video':
        if (!id) {
          return NextResponse.json(
            { error: 'Video ID required' },
            { status: 400 }
          );
        }

        const videoMetrics = await videoAnalyticsService.getVideoMetrics(id, timeRange);

        return NextResponse.json({
          success: true,
          metrics: videoMetrics
        });

      case 'learner':
        const learnerId = id || session.user.id;
        const learnerTimeRange = timeRange === '1h' || timeRange === '24h' ? '7d' : timeRange;

        const learnerInsights = await videoAnalyticsService.getLearnerInsights(
          learnerId,
          learnerTimeRange as '7d' | '30d' | '90d'
        );

        return NextResponse.json({
          success: true,
          insights: learnerInsights
        });

      case 'course':
        if (!id) {
          return NextResponse.json(
            { error: 'Course ID required' },
            { status: 400 }
          );
        }

        const courseAnalytics = await videoAnalyticsService.getCourseAnalytics(id);

        return NextResponse.json({
          success: true,
          analytics: courseAnalytics
        });

      case 'realtime':
        const realtimeMetrics = await videoAnalyticsService.getRealTimeMetrics();

        return NextResponse.json({
          success: true,
          metrics: realtimeMetrics
        });

      default:
        return NextResponse.json(
          { error: 'Invalid analytics type' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Analytics retrieval error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Check if user has analytics access
 */
async function checkAnalyticsAccess(userId: string): Promise<boolean> {
  try {
    // This would check user roles/permissions
    // For now, return true - implement proper permission checking
    return true;
  } catch {
    return false;
  }
}