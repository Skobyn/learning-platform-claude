import { NextRequest, NextResponse } from 'next/server';
import { sessionManager } from '@/lib/session';
import { headers } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const userId = searchParams.get('userId');
    const sessionId = searchParams.get('sessionId');

    switch (action) {
      case 'validate':
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
        }
        
        const token = authHeader.substring(7);
        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                         request.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';
        
        const validation = await sessionManager.validateSession(token, ipAddress, userAgent);
        
        return NextResponse.json({
          valid: validation.valid,
          session: validation.session,
          reason: validation.reason,
          shouldRefresh: validation.shouldRefresh,
        });

      case 'user_sessions':
        if (!userId) {
          return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
        }
        
        const userSessions = await sessionManager.getUserSessions(userId);
        return NextResponse.json({
          userId,
          sessions: userSessions.map(s => ({
            sessionId: s.sessionId,
            loginTime: s.sessionData.loginTime,
            lastActivity: s.sessionData.lastActivity,
            ipAddress: s.sessionData.ipAddress,
            userAgent: s.sessionData.userAgent,
          })),
          count: userSessions.length,
        });

      case 'stats':
        const stats = await sessionManager.getSessionStats();
        return NextResponse.json({
          ...stats,
          timestamp: new Date().toISOString(),
        });

      case 'health':
        // Basic session system health check
        const testSession = {
          userId: 'health-check',
          email: 'health@test.com',
          role: 'user',
          permissions: [],
          ipAddress: 'localhost',
          userAgent: 'health-check',
        };
        
        try {
          const { sessionId, sessionToken } = await sessionManager.createSession(testSession);
          const validation = await sessionManager.validateSession(sessionToken);
          await sessionManager.destroySession(sessionId);
          
          return NextResponse.json({
            status: validation.valid ? 'healthy' : 'unhealthy',
            details: {
              canCreate: true,
              canValidate: validation.valid,
              canDestroy: true,
            },
          });
        } catch (error) {
          return NextResponse.json({
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
          }, { status: 500 });
        }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Supported actions: validate, user_sessions, stats, health' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Session API GET error:', error);
    
    return NextResponse.json(
      { error: 'Session operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create':
        const { userId, email, role, permissions } = body;
        if (!userId || !email || !role) {
          return NextResponse.json(
            { error: 'userId, email, and role parameters required' },
            { status: 400 }
          );
        }

        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                         request.headers.get('x-real-ip') || 
                         'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';

        const sessionData = {
          userId,
          email,
          role,
          permissions: permissions || [],
          ipAddress,
          userAgent,
        };

        const session = await sessionManager.createSession(sessionData, body.options);
        
        return NextResponse.json({
          success: true,
          sessionId: session.sessionId,
          sessionToken: session.sessionToken,
          csrfToken: session.csrfToken,
        });

      case 'refresh':
        const { sessionId, updates } = body;
        if (!sessionId) {
          return NextResponse.json({ error: 'sessionId parameter required' }, { status: 400 });
        }

        const refreshed = await sessionManager.refreshSession(sessionId, updates);
        return NextResponse.json({ success: refreshed });

      case 'destroy':
        const { sessionId: destroySessionId } = body;
        if (!destroySessionId) {
          return NextResponse.json({ error: 'sessionId parameter required' }, { status: 400 });
        }

        const destroyed = await sessionManager.destroySession(destroySessionId);
        return NextResponse.json({ success: destroyed });

      case 'destroy_user_sessions':
        const { userId: destroyUserId } = body;
        if (!destroyUserId) {
          return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
        }

        const destroyedCount = await sessionManager.destroyUserSessions(destroyUserId);
        return NextResponse.json({ success: true, destroyedCount });

      case 'regenerate_csrf':
        const { sessionId: csrfSessionId } = body;
        if (!csrfSessionId) {
          return NextResponse.json({ error: 'sessionId parameter required' }, { status: 400 });
        }

        const newCsrfToken = await sessionManager.regenerateCsrfToken(csrfSessionId);
        return NextResponse.json({ 
          success: newCsrfToken !== null, 
          csrfToken: newCsrfToken 
        });

      case 'validate_csrf':
        const { sessionCsrfToken, submittedCsrfToken } = body;
        if (!sessionCsrfToken || !submittedCsrfToken) {
          return NextResponse.json(
            { error: 'sessionCsrfToken and submittedCsrfToken parameters required' },
            { status: 400 }
          );
        }

        const isValidCsrf = sessionManager.validateCsrfToken(sessionCsrfToken, submittedCsrfToken);
        return NextResponse.json({ valid: isValidCsrf });

      case 'cleanup_expired':
        const cleanupCount = await sessionManager.cleanupExpiredSessions();
        return NextResponse.json({ 
          success: true, 
          cleanupCount,
          message: `Cleaned up ${cleanupCount} expired sessions`,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Session API POST error:', error);
    
    return NextResponse.json(
      { error: 'Session operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');
    const all = searchParams.get('all') === 'true';

    if (all) {
      // This would be a dangerous operation in production
      // You might want to restrict this or add additional authentication
      return NextResponse.json(
        { error: 'Bulk session deletion not allowed via API' },
        { status: 403 }
      );
    }

    if (sessionId) {
      const destroyed = await sessionManager.destroySession(sessionId);
      return NextResponse.json({ 
        success: destroyed, 
        message: destroyed ? 'Session destroyed' : 'Session not found' 
      });
    }

    if (userId) {
      const destroyedCount = await sessionManager.destroyUserSessions(userId);
      return NextResponse.json({ 
        success: true, 
        destroyedCount,
        message: `Destroyed ${destroyedCount} sessions for user ${userId}`,
      });
    }

    return NextResponse.json(
      { error: 'Must specify either sessionId or userId' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Session API DELETE error:', error);
    
    return NextResponse.json(
      { error: 'Session deletion failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}