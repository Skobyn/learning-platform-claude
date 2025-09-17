import { NextRequest, NextResponse } from 'next/server';
import { cacheService } from '@/services/cacheService';
import { CacheUtils, CacheMonitor } from '@/utils/cache';
import { sessionManager } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const key = searchParams.get('key');
    const namespace = searchParams.get('namespace') || undefined;

    switch (action) {
      case 'get':
        if (!key) {
          return NextResponse.json({ error: 'Key parameter required' }, { status: 400 });
        }
        
        const value = await cacheService.get(key, namespace ? { namespace } : {});
        return NextResponse.json({ 
          key, 
          value, 
          found: value !== null,
          namespace: namespace || 'default',
        });

      case 'exists':
        if (!key) {
          return NextResponse.json({ error: 'Key parameter required' }, { status: 400 });
        }
        
        const exists = await cacheService.exists(key, namespace ? { namespace } : {});
        return NextResponse.json({ key, exists, namespace: namespace || 'default' });

      case 'ttl':
        if (!key) {
          return NextResponse.json({ error: 'Key parameter required' }, { status: 400 });
        }
        
        const ttl = await cacheService.ttl(key, namespace ? { namespace } : {});
        return NextResponse.json({ 
          key, 
          ttl, 
          expired: ttl === -2,
          persistent: ttl === -1,
          namespace: namespace || 'default',
        });

      case 'stats':
        const stats = await cacheService.getCacheInfo();
        const healthCheck = await CacheMonitor.checkCacheHealth();
        const usageByNamespace = await CacheMonitor.getCacheUsageByNamespace();
        
        return NextResponse.json({
          stats,
          health: healthCheck,
          usage: usageByNamespace,
          timestamp: new Date().toISOString(),
        });

      case 'namespaces':
        const namespaceUsage = await CacheMonitor.getCacheUsageByNamespace();
        return NextResponse.json({
          namespaces: Object.keys(namespaceUsage),
          usage: namespaceUsage,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Supported actions: get, exists, ttl, stats, namespaces' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Cache API GET error:', error);
    
    return NextResponse.json(
      { error: 'Cache operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, key, value, ttl, namespace, tags, pattern, keys } = body;

    switch (action) {
      case 'set':
        if (!key || value === undefined) {
          return NextResponse.json({ error: 'Key and value parameters required' }, { status: 400 });
        }
        
        const success = await cacheService.set(key, value, {
          ttl,
          namespace,
          tags,
        });
        
        return NextResponse.json({ 
          success, 
          key, 
          namespace: namespace || 'default',
          ttl: ttl || 3600,
        });

      case 'delete':
        if (!key) {
          return NextResponse.json({ error: 'Key parameter required' }, { status: 400 });
        }
        
        const deleted = await cacheService.delete(key, namespace ? { namespace } : {});
        return NextResponse.json({ success: deleted, key, namespace: namespace || 'default' });

      case 'expire':
        if (!key || !ttl) {
          return NextResponse.json({ error: 'Key and ttl parameters required' }, { status: 400 });
        }
        
        const expired = await cacheService.expire(key, ttl, namespace ? { namespace } : {});
        return NextResponse.json({ success: expired, key, ttl, namespace: namespace || 'default' });

      case 'invalidate_by_tags':
        if (!tags || !Array.isArray(tags)) {
          return NextResponse.json({ error: 'Tags array parameter required' }, { status: 400 });
        }
        
        const tagInvalidated = await cacheService.invalidateByTags(tags);
        return NextResponse.json({ success: true, invalidatedCount: tagInvalidated, tags });

      case 'invalidate_by_pattern':
        if (!pattern) {
          return NextResponse.json({ error: 'Pattern parameter required' }, { status: 400 });
        }
        
        const patternInvalidated = await cacheService.invalidateByPattern(pattern);
        return NextResponse.json({ success: true, invalidatedCount: patternInvalidated, pattern });

      case 'clear_namespace':
        if (!namespace) {
          return NextResponse.json({ error: 'Namespace parameter required' }, { status: 400 });
        }
        
        const namespaceCleared = await cacheService.clearNamespace(namespace);
        return NextResponse.json({ success: true, clearedCount: namespaceCleared, namespace });

      case 'batch_set':
        if (!Array.isArray(keys)) {
          return NextResponse.json({ error: 'Keys array parameter required' }, { status: 400 });
        }
        
        const batchCount = await CacheUtils.batchSet(keys);
        return NextResponse.json({ success: true, setCount: batchCount });

      case 'batch_get':
        if (!Array.isArray(keys)) {
          return NextResponse.json({ error: 'Keys array parameter required' }, { status: 400 });
        }
        
        const batchResults = await CacheUtils.batchGet(keys, namespace);
        return NextResponse.json({ results: batchResults, namespace: namespace || 'default' });

      case 'warm_user_cache':
        const { userId } = body;
        if (!userId) {
          return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
        }
        
        await CacheUtils.warm.warmUserCache(userId);
        return NextResponse.json({ success: true, message: `User cache warmed for ${userId}` });

      case 'warm_course_cache':
        const { courseId } = body;
        if (!courseId) {
          return NextResponse.json({ error: 'courseId parameter required' }, { status: 400 });
        }
        
        await CacheUtils.warm.warmCourseCache(courseId);
        return NextResponse.json({ success: true, message: `Course cache warmed for ${courseId}` });

      case 'warm_system_cache':
        await CacheUtils.warm.warmSystemCache();
        return NextResponse.json({ success: true, message: 'System cache warmed' });

      case 'optimize':
        const optimization = await CacheUtils.optimize.optimizeCache();
        return NextResponse.json({
          success: true,
          message: 'Cache optimization complete',
          details: optimization,
        });

      case 'compress':
        await CacheUtils.optimize.compactCache(namespace);
        return NextResponse.json({
          success: true,
          message: `Cache compaction complete${namespace ? ` for namespace ${namespace}` : ''}`,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Cache API POST error:', error);
    
    return NextResponse.json(
      { error: 'Cache operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const namespace = searchParams.get('namespace');
    const pattern = searchParams.get('pattern');
    const all = searchParams.get('all') === 'true';

    if (all) {
      // Clear entire cache
      const success = await cacheService.clearAll();
      return NextResponse.json({ 
        success, 
        message: success ? 'All cache cleared' : 'Failed to clear cache' 
      });
    }

    if (namespace) {
      // Clear specific namespace
      const cleared = await cacheService.clearNamespace(namespace);
      return NextResponse.json({ 
        success: true, 
        clearedCount: cleared, 
        namespace 
      });
    }

    if (pattern) {
      // Clear by pattern
      const cleared = await cacheService.invalidateByPattern(pattern);
      return NextResponse.json({ 
        success: true, 
        clearedCount: cleared, 
        pattern 
      });
    }

    return NextResponse.json(
      { error: 'Must specify either namespace, pattern, or all=true' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Cache API DELETE error:', error);
    
    return NextResponse.json(
      { error: 'Cache clear operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}