import { NextRequest, NextResponse } from 'next/server';
import { redisManager } from '@/lib/redis';
import { cacheService } from '@/services/cacheService';
import { CacheMonitor } from '@/utils/cache';

export async function GET(request: NextRequest) {
  try {
    // Basic Redis connectivity check
    const isHealthy = redisManager.isHealthy();
    const ping = await redisManager.ping();
    
    // Get Redis statistics
    const redisStats = await redisManager.getStats();
    
    // Get cache service statistics
    const cacheStats = await cacheService.getCacheInfo();
    
    // Get comprehensive health check
    const healthCheck = await CacheMonitor.checkCacheHealth();
    
    // Get memory and performance metrics
    const comprehensiveStats = await CacheMonitor.getComprehensiveStats();
    
    // Determine overall health status
    const status = isHealthy && ping === 'PONG' && healthCheck.status !== 'critical' 
      ? 'healthy' 
      : 'unhealthy';

    const response = {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        redis_connection: {
          status: isHealthy ? 'pass' : 'fail',
          ping: ping === 'PONG' ? 'pass' : 'fail',
          details: {
            connected: redisStats.connected,
            clientStatus: redisStats.clientStatus,
            subscriberStatus: redisStats.subscriberStatus,
            publisherStatus: redisStats.publisherStatus,
          },
        },
        cache_health: {
          status: healthCheck.status === 'critical' ? 'fail' : 'pass',
          details: {
            status: healthCheck.status,
            issues: healthCheck.issues,
            metrics: healthCheck.metrics,
          },
        },
        cache_performance: {
          status: cacheStats.hitRate > 0.5 ? 'pass' : 'warn',
          details: {
            hitRate: cacheStats.hitRate,
            totalKeys: cacheStats.totalKeys,
            memoryUsed: cacheStats.memoryUsed,
            stats: cacheStats.stats,
          },
        },
      },
      metrics: {
        redis: comprehensiveStats.redis,
        memory: comprehensiveStats.memory,
        performance: comprehensiveStats.performance,
        cache: comprehensiveStats.general,
      },
    };

    const httpStatus = status === 'healthy' ? 200 : 503;

    return NextResponse.json(response, {
      status: httpStatus,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Redis health check error:', error);
    
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Redis health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'clear_cache':
        const cleared = await cacheService.clearAll();
        return NextResponse.json({
          success: cleared,
          message: cleared ? 'Cache cleared successfully' : 'Failed to clear cache',
        });

      case 'reset_stats':
        cacheService.resetStats();
        return NextResponse.json({
          success: true,
          message: 'Cache statistics reset',
        });

      case 'optimize_cache':
        const { CacheOptimizer } = await import('@/utils/cache');
        const optimization = await CacheOptimizer.optimizeCache();
        return NextResponse.json({
          success: true,
          message: 'Cache optimization complete',
          details: optimization,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Redis health check POST error:', error);
    
    return NextResponse.json(
      { error: 'Operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}