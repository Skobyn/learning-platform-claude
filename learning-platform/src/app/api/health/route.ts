import { NextRequest, NextResponse } from 'next/server';
import { redisManager } from '@/lib/redis';
import { sessionManager } from '@/lib/session';
import { CacheMonitor } from '@/utils/cache';

export async function GET(request: NextRequest) {
  try {
    // Check Redis health
    const redisHealthy = redisManager.isHealthy();
    const redisPing = redisHealthy ? await redisManager.ping() : 'DISCONNECTED';
    
    // Check cache health
    const cacheHealth = await CacheMonitor.checkCacheHealth();
    
    // Check session system
    const sessionStats = await sessionManager.getSessionStats();
    
    // Basic health check
    const healthCheck = {
      status: redisHealthy && cacheHealth.status !== 'critical' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      services: {
        database: 'connected', // In real implementation, check actual DB connection
        auth: 'operational',
        api: 'operational',
        redis: redisHealthy ? 'connected' : 'disconnected',
        cache: cacheHealth.status,
        sessions: sessionStats.totalActiveSessions > 0 ? 'active' : 'idle'
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      redis: {
        status: redisHealthy ? 'healthy' : 'unhealthy',
        ping: redisPing,
        connection: redisHealthy
      },
      cache: {
        status: cacheHealth.status,
        issues: cacheHealth.issues,
        hitRate: cacheHealth.metrics.hitRate || 0
      },
      sessions: {
        total: sessionStats.totalActiveSessions,
        expired: sessionStats.expiredSessions,
        avgAge: Math.round(sessionStats.avgSessionAge / 1000 / 60) // Convert to minutes
      }
    };

    const httpStatus = healthCheck.status === 'healthy' ? 200 : 503;
    
    return NextResponse.json(healthCheck, { status: httpStatus });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}

export async function HEAD(request: NextRequest) {
  try {
    // Quick health check for load balancers
    const redisHealthy = redisManager.isHealthy();
    const status = redisHealthy ? 200 : 503;
    
    return new NextResponse(null, { 
      status,
      headers: {
        'X-Health-Status': redisHealthy ? 'healthy' : 'unhealthy',
        'X-Timestamp': new Date().toISOString(),
      }
    });
  } catch (error) {
    return new NextResponse(null, { 
      status: 503,
      headers: {
        'X-Health-Status': 'unhealthy',
        'X-Error': 'Health check failed'
      }
    });
  }
}