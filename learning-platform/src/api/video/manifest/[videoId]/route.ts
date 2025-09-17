import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import { getSession } from '../../../../lib/session';
import { redis } from '../../../../lib/redis';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'hls';
    const quality = url.searchParams.get('quality');
    const sessionId = url.searchParams.get('session');

    // Validate session
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const session = await getSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has access to the video
    const hasAccess = await checkVideoAccess(session.user.id, videoId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (format === 'hls') {
      return handleHLSManifest(videoId, quality, sessionId);
    } else if (format === 'dash') {
      return handleDASHManifest(videoId, sessionId);
    } else {
      return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

  } catch (error) {
    console.error('Manifest serving error:', error);
    return NextResponse.json(
      { error: 'Manifest service error' },
      { status: 500 }
    );
  }
}

async function handleHLSManifest(videoId: string, quality: string | null, sessionId: string): Promise<NextResponse> {
  const videoPath = getVideoPath(videoId);

  if (quality && quality !== 'master') {
    // Serve specific quality playlist
    const playlistPath = path.join(videoPath, `${quality}.m3u8`);

    if (!await fs.pathExists(playlistPath)) {
      return NextResponse.json({ error: 'Quality not available' }, { status: 404 });
    }

    let playlist = await fs.readFile(playlistPath, 'utf8');

    // Enhance playlist with session tracking
    playlist = enhanceHLSPlaylist(playlist, videoId, quality, sessionId);

    return new NextResponse(playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
      }
    });
  } else {
    // Serve master playlist
    const masterPath = path.join(videoPath, 'master.m3u8');

    if (!await fs.pathExists(masterPath)) {
      return NextResponse.json({ error: 'Video not available' }, { status: 404 });
    }

    let masterPlaylist = await fs.readFile(masterPath, 'utf8');

    // Enhance master playlist with analytics and session tracking
    masterPlaylist = enhanceMasterHLSPlaylist(masterPlaylist, videoId, sessionId);

    return new NextResponse(masterPlaylist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
      }
    });
  }
}

async function handleDASHManifest(videoId: string, sessionId: string): Promise<NextResponse> {
  const videoPath = getVideoPath(videoId);
  const manifestPath = path.join(videoPath, 'manifest.mpd');

  if (!await fs.pathExists(manifestPath)) {
    return NextResponse.json({ error: 'DASH manifest not available' }, { status: 404 });
  }

  let manifest = await fs.readFile(manifestPath, 'utf8');

  // Enhance DASH manifest with session tracking
  manifest = enhanceDASHManifest(manifest, videoId, sessionId);

  return new NextResponse(manifest, {
    headers: {
      'Content-Type': 'application/dash+xml',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
    }
  });
}

function enhanceMasterHLSPlaylist(playlist: string, videoId: string, sessionId: string): string {
  let enhanced = playlist;

  // Add session data for analytics
  const sessionData = `#EXT-X-SESSION-DATA:DATA-ID="com.learning.session",VALUE="${sessionId}"`;
  const videoData = `#EXT-X-SESSION-DATA:DATA-ID="com.learning.video",VALUE="${videoId}"`;
  const analyticsData = `#EXT-X-SESSION-DATA:DATA-ID="com.learning.analytics",VALUE="enabled"`;

  // Insert at the beginning after #EXTM3U
  enhanced = enhanced.replace(
    /#EXTM3U/,
    `#EXTM3U\n${sessionData}\n${videoData}\n${analyticsData}`
  );

  // Add session parameter to quality playlists
  enhanced = enhanced.replace(
    /^([^#\s].+\.m3u8)$/gm,
    `$1?session=${sessionId}&videoId=${videoId}`
  );

  return enhanced;
}

function enhanceHLSPlaylist(playlist: string, videoId: string, quality: string, sessionId: string): string {
  let enhanced = playlist;

  // Add session tracking to segments
  enhanced = enhanced.replace(
    /^([^#\s].+\.ts)$/gm,
    (match, segment) => {
      const segmentUrl = `/api/video/stream/${videoId}?session=${sessionId}&segment=${segment}&quality=${quality}`;
      return segmentUrl;
    }
  );

  // Add analytics markers
  const lines = enhanced.split('\n');
  const enhancedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXTINF:')) {
      // Add analytics marker before each segment
      enhancedLines.push(line);
      enhancedLines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date().toISOString()}`);
    } else {
      enhancedLines.push(line);
    }
  }

  return enhancedLines.join('\n');
}

function enhanceDASHManifest(manifest: string, videoId: string, sessionId: string): string {
  let enhanced = manifest;

  // Add analytics information to DASH manifest
  const analyticsElement = `
    <!-- Analytics Information -->
    <ProgramInformation>
      <Title>Learning Platform Video</Title>
      <Source>session=${sessionId}&video=${videoId}</Source>
    </ProgramInformation>
  `;

  // Insert analytics after MPD opening tag
  enhanced = enhanced.replace(
    /(<MPD[^>]*>)/,
    `$1\n${analyticsElement}`
  );

  // Update segment URLs to include session tracking
  enhanced = enhanced.replace(
    /(media=")([^"]+)(")/g,
    `$1/api/video/stream/${videoId}?session=${sessionId}&segment=$2$3`
  );

  return enhanced;
}

async function checkVideoAccess(userId: string, videoId: string): Promise<boolean> {
  // Check Redis cache first
  const cacheKey = `access:${userId}:${videoId}`;
  const cached = await redis.get(cacheKey);

  if (cached !== null) {
    return cached === '1';
  }

  // Mock implementation - replace with actual access control logic
  const hasAccess = true; // Check enrollment, payment, permissions, etc.

  // Cache result for 5 minutes
  await redis.setex(cacheKey, 300, hasAccess ? '1' : '0');

  return hasAccess;
}

function getVideoPath(videoId: string): string {
  return path.join(process.env.VIDEO_STORAGE_PATH || '/storage/videos', videoId);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}