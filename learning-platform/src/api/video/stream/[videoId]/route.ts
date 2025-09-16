import { NextRequest, NextResponse } from 'next/server';
import EnhancedStreamingService from '../../../../services/video/streamingService.enhanced';
import VideoAnalyticsService from '../../../../services/video/videoAnalyticsService';
import { getSession } from '../../../../lib/session';
import path from 'path';
import fs from 'fs-extra';

const streamingService = new EnhancedStreamingService();
const analyticsService = new VideoAnalyticsService();

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session');
    const quality = url.searchParams.get('quality');
    const segment = url.searchParams.get('segment');
    const format = url.searchParams.get('format') as 'hls' | 'dash' || 'hls';
    const bandwidth = url.searchParams.get('bandwidth');

    // Validate session
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Handle different streaming requests
    if (segment) {
      // Serve video segment
      return handleSegmentRequest(videoId, segment, quality || 'auto', sessionId, request);
    } else {
      // Serve manifest
      return handleManifestRequest(videoId, sessionId, format, request);
    }

  } catch (error) {
    console.error('Streaming error:', error);
    return NextResponse.json(
      { error: 'Streaming service error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;
    const body = await request.json();
    const session = await getSession(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    switch (body.action) {
      case 'start-session':
        return handleStartSession(videoId, session.user.id, body.deviceInfo);

      case 'update-bandwidth':
        return handleBandwidthUpdate(body.sessionId, body.bandwidth, body.transferTime, body.bytesTransferred);

      case 'switch-quality':
        return handleQualitySwitch(body.sessionId, body.newQuality, body.reason);

      case 'report-buffering':
        return handleBufferingReport(body.sessionId, body.bufferHealth, body.rebufferTime);

      case 'report-error':
        return handleErrorReport(body.sessionId, body.error);

      case 'update-watch-time':
        return handleWatchTimeUpdate(videoId, session.user.id, body.sessionId, body.watchTime);

      case 'track-engagement':
        return handleEngagementTracking(videoId, session.user.id, body.sessionId, body.event);

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Streaming API error:', error);
    return NextResponse.json(
      { error: 'API error' },
      { status: 500 }
    );
  }
}

async function handleSegmentRequest(
  videoId: string,
  segmentName: string,
  quality: string,
  sessionId: string,
  request: NextRequest
): Promise<NextResponse> {
  try {
    // Get segment data
    const segment = await streamingService.getSegment(videoId, segmentName, quality);

    if (!segment) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
    }

    // Track bandwidth for adaptive streaming
    const startTime = Date.now();
    const range = request.headers.get('range');

    let start = 0;
    let end = segment.length - 1;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : segment.length - 1;
    }

    const chunk = segment.slice(start, end + 1);
    const headers = new Headers({
      'Content-Type': 'video/mp2t',
      'Content-Length': chunk.length.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Accept-Ranges'
    });

    if (range) {
      headers.set('Content-Range', `bytes ${start}-${end}/${segment.length}`);
    }

    // Calculate and report bandwidth
    const transferTime = Date.now() - startTime;
    if (transferTime > 0) {
      await streamingService.updateBandwidth(sessionId, 0, transferTime, chunk.length);
    }

    return new NextResponse(chunk, {
      status: range ? 206 : 200,
      headers
    });

  } catch (error) {
    console.error('Segment serving error:', error);
    return NextResponse.json({ error: 'Segment serving failed' }, { status: 500 });
  }
}

async function handleManifestRequest(
  videoId: string,
  sessionId: string,
  format: 'hls' | 'dash',
  request: NextRequest
): Promise<NextResponse> {
  try {
    const manifest = await streamingService.getAdaptiveManifest(videoId, sessionId, format);

    const contentType = format === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml';

    return new NextResponse(manifest, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
      }
    });

  } catch (error) {
    console.error('Manifest serving error:', error);
    return NextResponse.json({ error: 'Manifest not available' }, { status: 404 });
  }
}

async function handleStartSession(videoId: string, userId: string, deviceInfo: any): Promise<NextResponse> {
  try {
    const sessionId = await streamingService.initializeSession(userId, videoId);
    const analyticsSessionId = await analyticsService.startWatchSession(userId, videoId, deviceInfo);

    return NextResponse.json({
      sessionId,
      analyticsSessionId,
      message: 'Session started successfully'
    });

  } catch (error) {
    console.error('Session start error:', error);
    return NextResponse.json({ error: 'Failed to start session' }, { status: 500 });
  }
}

async function handleBandwidthUpdate(
  sessionId: string,
  bandwidth: number,
  transferTime: number,
  bytesTransferred: number
): Promise<NextResponse> {
  try {
    await streamingService.updateBandwidth(sessionId, bandwidth, transferTime, bytesTransferred);

    return NextResponse.json({ message: 'Bandwidth updated successfully' });

  } catch (error) {
    console.error('Bandwidth update error:', error);
    return NextResponse.json({ error: 'Failed to update bandwidth' }, { status: 500 });
  }
}

async function handleQualitySwitch(
  sessionId: string,
  newQuality: string,
  reason: 'user' | 'auto' | 'buffer'
): Promise<NextResponse> {
  try {
    await streamingService.switchQuality(sessionId, newQuality, reason);

    return NextResponse.json({ message: 'Quality switched successfully' });

  } catch (error) {
    console.error('Quality switch error:', error);
    return NextResponse.json({ error: 'Failed to switch quality' }, { status: 500 });
  }
}

async function handleBufferingReport(
  sessionId: string,
  bufferHealth: number,
  rebufferTime?: number
): Promise<NextResponse> {
  try {
    await streamingService.reportBuffering(sessionId, bufferHealth, rebufferTime);

    return NextResponse.json({ message: 'Buffering reported successfully' });

  } catch (error) {
    console.error('Buffering report error:', error);
    return NextResponse.json({ error: 'Failed to report buffering' }, { status: 500 });
  }
}

async function handleErrorReport(sessionId: string, error: any): Promise<NextResponse> {
  try {
    await streamingService.reportError(sessionId, error);

    return NextResponse.json({ message: 'Error reported successfully' });

  } catch (error) {
    console.error('Error report error:', error);
    return NextResponse.json({ error: 'Failed to report error' }, { status: 500 });
  }
}

async function handleWatchTimeUpdate(
  videoId: string,
  userId: string,
  sessionId: string,
  watchTime: number
): Promise<NextResponse> {
  try {
    await streamingService.updateWatchTime(sessionId, watchTime);
    await analyticsService.trackWatchProgress(userId, videoId, sessionId, watchTime, 0); // Duration would be fetched from metadata

    return NextResponse.json({ message: 'Watch time updated successfully' });

  } catch (error) {
    console.error('Watch time update error:', error);
    return NextResponse.json({ error: 'Failed to update watch time' }, { status: 500 });
  }
}

async function handleEngagementTracking(
  videoId: string,
  userId: string,
  sessionId: string,
  event: any
): Promise<NextResponse> {
  try {
    switch (event.type) {
      case 'play':
        await analyticsService.trackPlay(userId, videoId, sessionId, event.timestamp, event.quality);
        break;
      case 'pause':
        await analyticsService.trackPause(userId, videoId, sessionId, event.timestamp);
        break;
      case 'seek':
        await analyticsService.trackSeek(userId, videoId, sessionId, event.fromTime, event.toTime);
        break;
      case 'quality_change':
        await analyticsService.trackQualityChange(userId, videoId, sessionId, event.timestamp, event.fromQuality, event.toQuality, event.reason);
        break;
      case 'buffering':
        await analyticsService.trackBuffering(userId, videoId, sessionId, event.timestamp, event.duration);
        break;
    }

    return NextResponse.json({ message: 'Event tracked successfully' });

  } catch (error) {
    console.error('Engagement tracking error:', error);
    return NextResponse.json({ error: 'Failed to track event' }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}