import { NextRequest, NextResponse } from 'next/server';
import { cacheService, CacheConfigs } from '@/services/cacheService';
import { createHash } from 'crypto';

export interface CacheMiddlewareOptions {
  ttl?: number;
  varyBy?: string[];
  skipIfAuthenticated?: boolean;
  skipMethods?: string[];
  onlyMethods?: string[];
  cacheControl?: string;
  etag?: boolean;
  staleWhileRevalidate?: number;
  namespace?: string;
  tags?: string[];
}

const DEFAULT_OPTIONS: Required<CacheMiddlewareOptions> = {
  ttl: 300, // 5 minutes
  varyBy: [],
  skipIfAuthenticated: false,
  skipMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  onlyMethods: [],
  cacheControl: 'public, max-age=300',
  etag: true,
  staleWhileRevalidate: 0,
  namespace: 'api',
  tags: ['api'],
};

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  contentType: string;
  etag?: string;
  timestamp: number;
}

/**
 * HTTP cache middleware factory
 */
export function createCacheMiddleware(options: CacheMiddlewareOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async function cacheMiddleware(
    request: NextRequest,
    context: { params: Record<string, string> },
    next: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    // Check if caching should be skipped
    if (shouldSkipCache(request, config)) {
      return next();
    }

    // Generate cache key
    const cacheKey = generateRequestCacheKey(request, context, config);
    
    try {
      // Try to get cached response
      const cachedResponse = await cacheService.get<CachedResponse>(cacheKey, {
        namespace: config.namespace,
      });

      if (cachedResponse) {
        // Check if cached response is still valid
        if (isCachedResponseValid(cachedResponse, config)) {
          console.log(`Cache HIT: ${cacheKey}`);
          return createResponseFromCache(cachedResponse, request);
        }
      }

      // Cache miss or expired - execute the handler
      console.log(`Cache MISS: ${cacheKey}`);
      const response = await next();

      // Cache the response if it's successful
      if (shouldCacheResponse(response)) {
        await cacheResponse(cacheKey, response, config);
      }

      return response;
    } catch (error) {
      console.error('Cache middleware error:', error);
      // If cache fails, still serve the request
      return next();
    }
  };
}

/**
 * Response caching utility for API routes
 */
export class ResponseCache {
  /**
   * Cache API response
   */
  static async cacheApiResponse(
    key: string,
    data: any,
    options?: {
      ttl?: number;
      tags?: string[];
      headers?: Record<string, string>;
    }
  ): Promise<void> {
    try {
      const cachedResponse: CachedResponse = {
        statusCode: 200,
        headers: options?.headers || {},
        body: data,
        contentType: 'application/json',
        timestamp: Date.now(),
      };

      await cacheService.set(key, cachedResponse, {
        ttl: options?.ttl || CacheConfigs.apiResponse.ttl,
        tags: options?.tags || ['api'],
        namespace: 'api',
      });
    } catch (error) {
      console.error('API response cache error:', error);
    }
  }

  /**
   * Get cached API response
   */
  static async getCachedApiResponse(key: string): Promise<any | null> {
    try {
      const cachedResponse = await cacheService.get<CachedResponse>(key, {
        namespace: 'api',
      });

      return cachedResponse ? cachedResponse.body : null;
    } catch (error) {
      console.error('Get cached API response error:', error);
      return null;
    }
  }

  /**
   * Invalidate API response cache
   */
  static async invalidateApiCache(pattern: string): Promise<number> {
    try {
      return await cacheService.invalidateByPattern(`api:${pattern}`);
    } catch (error) {
      console.error('API cache invalidation error:', error);
      return 0;
    }
  }
}

/**
 * Cache configuration presets for different route types
 */
export const CachePresets = {
  // Static data that changes infrequently
  staticData: {
    ttl: 86400, // 24 hours
    cacheControl: 'public, max-age=86400',
    tags: ['static'],
    namespace: 'static',
  },

  // User-specific data
  userData: {
    ttl: 1800, // 30 minutes
    skipIfAuthenticated: false,
    varyBy: ['authorization'],
    cacheControl: 'private, max-age=1800',
    tags: ['user'],
    namespace: 'user',
  },

  // Search results
  searchResults: {
    ttl: 900, // 15 minutes
    varyBy: ['query', 'filters'],
    cacheControl: 'public, max-age=900',
    tags: ['search'],
    namespace: 'search',
  },

  // Course content
  courseContent: {
    ttl: 3600, // 1 hour
    cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    tags: ['course', 'content'],
    namespace: 'course',
  },

  // Analytics data
  analyticsData: {
    ttl: 300, // 5 minutes
    cacheControl: 'private, max-age=300',
    tags: ['analytics'],
    namespace: 'analytics',
  },
} as const;

// Helper functions

function shouldSkipCache(request: NextRequest, config: Required<CacheMiddlewareOptions>): boolean {
  const method = request.method;

  // Check method restrictions
  if (config.onlyMethods.length > 0 && !config.onlyMethods.includes(method)) {
    return true;
  }

  if (config.skipMethods.includes(method)) {
    return true;
  }

  // Check authentication
  if (config.skipIfAuthenticated && hasAuthHeader(request)) {
    return true;
  }

  // Skip if no-cache header is present
  if (request.headers.get('cache-control')?.includes('no-cache')) {
    return true;
  }

  return false;
}

function hasAuthHeader(request: NextRequest): boolean {
  return !!(
    request.headers.get('authorization') ||
    request.headers.get('x-api-key') ||
    request.cookies.get('session')
  );
}

function generateRequestCacheKey(
  request: NextRequest,
  context: { params: Record<string, string> },
  config: Required<CacheMiddlewareOptions>
): string {
  const url = new URL(request.url);
  const baseKey = `${request.method}:${url.pathname}`;
  
  const keyParts = [baseKey];

  // Add query parameters
  if (url.searchParams.toString()) {
    keyParts.push(url.searchParams.toString());
  }

  // Add route parameters
  if (Object.keys(context.params).length > 0) {
    keyParts.push(JSON.stringify(context.params));
  }

  // Add vary-by headers
  for (const header of config.varyBy) {
    const value = request.headers.get(header);
    if (value) {
      keyParts.push(`${header}:${value}`);
    }
  }

  // Add user ID if authenticated
  const userId = getUserIdFromRequest(request);
  if (userId) {
    keyParts.push(`user:${userId}`);
  }

  // Create hash of the key parts
  const fullKey = keyParts.join('|');
  return createHash('sha256').update(fullKey).digest('hex').substring(0, 32);
}

function getUserIdFromRequest(request: NextRequest): string | null {
  // Try to extract user ID from token or session
  // This would be implemented based on your auth system
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    // Extract user ID from JWT token if needed
    // This is a simplified example
    return null; // Would return actual user ID
  }
  
  return null;
}

function isCachedResponseValid(cachedResponse: CachedResponse, config: Required<CacheMiddlewareOptions>): boolean {
  const age = (Date.now() - cachedResponse.timestamp) / 1000;
  
  // Check basic TTL
  if (age > config.ttl) {
    return false;
  }

  // Check stale-while-revalidate
  if (config.staleWhileRevalidate > 0 && age > (config.ttl - config.staleWhileRevalidate)) {
    // Could trigger background revalidation here
    return true;
  }

  return true;
}

function shouldCacheResponse(response: NextResponse): boolean {
  const status = response.status;
  
  // Only cache successful responses
  if (status < 200 || status >= 300) {
    return false;
  }

  // Don't cache if response has cache-control: no-cache
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl?.includes('no-cache') || cacheControl?.includes('no-store')) {
    return false;
  }

  return true;
}

async function cacheResponse(
  cacheKey: string,
  response: NextResponse,
  config: Required<CacheMiddlewareOptions>
): Promise<void> {
  try {
    // Clone the response to read the body
    const responseClone = response.clone();
    const body = await responseClone.text();

    // Create cached response object
    const cachedResponse: CachedResponse = {
      statusCode: response.status,
      headers: {},
      body: body,
      contentType: response.headers.get('content-type') || 'text/plain',
      timestamp: Date.now(),
    };

    // Copy important headers
    const headersToCache = [
      'content-type',
      'content-encoding',
      'content-language',
      'last-modified',
      'etag',
      'location',
    ];

    for (const header of headersToCache) {
      const value = response.headers.get(header);
      if (value) {
        cachedResponse.headers[header] = value;
      }
    }

    // Generate ETag if enabled
    if (config.etag && !cachedResponse.headers.etag) {
      cachedResponse.etag = `"${createHash('sha256').update(body).digest('hex').substring(0, 16)}"`;
      cachedResponse.headers.etag = cachedResponse.etag;
    }

    // Cache the response
    await cacheService.set(cacheKey, cachedResponse, {
      ttl: config.ttl,
      tags: config.tags,
      namespace: config.namespace,
    });
  } catch (error) {
    console.error('Response caching error:', error);
  }
}

function createResponseFromCache(cachedResponse: CachedResponse, request: NextRequest): NextResponse {
  // Check if client has matching ETag
  if (cachedResponse.etag) {
    const clientEtag = request.headers.get('if-none-match');
    if (clientEtag === cachedResponse.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'etag': cachedResponse.etag,
          'cache-control': 'public, max-age=300',
        },
      });
    }
  }

  // Create response with cached data
  const headers = new Headers(cachedResponse.headers);
  headers.set('x-cache', 'HIT');
  headers.set('x-cache-time', new Date(cachedResponse.timestamp).toISOString());

  return new NextResponse(cachedResponse.body, {
    status: cachedResponse.statusCode,
    headers,
  });
}

/**
 * Decorator for caching API route handlers
 */
export function withCache(options: CacheMiddlewareOptions = {}) {
  return function <T extends (...args: any[]) => Promise<NextResponse>>(
    target: T,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const middleware = createCacheMiddleware(options);

    descriptor.value = async function (this: any, request: NextRequest, context: any) {
      return middleware(request, context, () => originalMethod.call(this, request, context));
    };

    return descriptor;
  };
}