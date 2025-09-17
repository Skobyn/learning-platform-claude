/**
 * Advanced Caching Policy Configuration
 * Optimized for Learning Platform with dynamic and static content
 */

const cacheConfig = {
  // Static Assets - Long-term caching
  staticAssets: {
    pattern: /\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|avif|woff|woff2|ttf|eot)$/,
    maxAge: '1y',
    staleWhileRevalidate: '7d',
    cacheControl: 'public, immutable',
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString(),
    }
  },

  // Next.js Build Assets - Aggressive caching
  nextStaticAssets: {
    pattern: /\/_next\/static\/.*/,
    maxAge: '1y',
    staleWhileRevalidate: '30d',
    cacheControl: 'public, immutable',
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString(),
    }
  },

  // API Routes - No caching by default
  apiRoutes: {
    pattern: /\/api\/.*/,
    maxAge: 0,
    staleWhileRevalidate: 0,
    cacheControl: 'no-cache, no-store, must-revalidate',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    exceptions: {
      // Cache public API endpoints
      '/api/courses/public': {
        maxAge: '5m',
        staleWhileRevalidate: '1h',
        cacheControl: 'public, max-age=300, stale-while-revalidate=3600'
      },
      '/api/health': {
        maxAge: '1m',
        staleWhileRevalidate: '5m',
        cacheControl: 'public, max-age=60, stale-while-revalidate=300'
      }
    }
  },

  // Course Content - Medium-term caching with revalidation
  courseContent: {
    pattern: /\/courses\/[^\/]+$/,
    maxAge: '1h',
    staleWhileRevalidate: '24h',
    cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Vary': 'Accept-Encoding, Accept, Authorization'
    }
  },

  // User Dashboard - Short-term caching for authenticated users
  userContent: {
    pattern: /\/(dashboard|profile|settings).*/,
    maxAge: '5m',
    staleWhileRevalidate: '15m',
    cacheControl: 'private, max-age=300, stale-while-revalidate=900',
    headers: {
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=900',
      'Vary': 'Accept-Encoding, Accept, Authorization'
    }
  },

  // Media Files - Long-term caching
  mediaFiles: {
    pattern: /\/(images|videos|documents)\/.*/,
    maxAge: '7d',
    staleWhileRevalidate: '30d',
    cacheControl: 'public, max-age=604800, stale-while-revalidate=2592000',
    headers: {
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
      'Vary': 'Accept-Encoding'
    }
  },

  // HTML Pages - Short-term caching with revalidation
  htmlPages: {
    pattern: /\/(?!api|_next).*/,
    maxAge: '10m',
    staleWhileRevalidate: '1h',
    cacheControl: 'public, max-age=600, stale-while-revalidate=3600',
    headers: {
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600',
      'Vary': 'Accept-Encoding, Accept, Accept-Language, Authorization'
    }
  }
};

/**
 * Cache Strategy Implementation
 */
class CacheStrategy {
  constructor(config = cacheConfig) {
    this.config = config;
  }

  /**
   * Get cache configuration for a given URL
   */
  getCacheConfig(url, isAuthenticated = false) {
    const { pathname } = new URL(url, 'http://localhost');

    // Check each pattern in order of specificity
    for (const [key, config] of Object.entries(this.config)) {
      if (config.pattern && config.pattern.test(pathname)) {
        // Handle API exceptions
        if (key === 'apiRoutes' && config.exceptions) {
          const exception = Object.keys(config.exceptions).find(path => 
            pathname.startsWith(path)
          );
          if (exception) {
            return {
              ...config.exceptions[exception],
              strategy: 'exception',
              type: key
            };
          }
        }

        // Adjust caching for authenticated users
        if (isAuthenticated && key === 'htmlPages') {
          return {
            ...config,
            cacheControl: 'private, max-age=300, stale-while-revalidate=900',
            headers: {
              ...config.headers,
              'Cache-Control': 'private, max-age=300, stale-while-revalidate=900'
            },
            strategy: 'authenticated',
            type: key
          };
        }

        return {
          ...config,
          strategy: 'default',
          type: key
        };
      }
    }

    // Default fallback
    return {
      maxAge: '5m',
      staleWhileRevalidate: '15m',
      cacheControl: 'public, max-age=300, stale-while-revalidate=900',
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=900'
      },
      strategy: 'fallback',
      type: 'default'
    };
  }

  /**
   * Generate cache headers for response
   */
  getCacheHeaders(url, isAuthenticated = false, customHeaders = {}) {
    const config = this.getCacheConfig(url, isAuthenticated);
    
    return {
      ...config.headers,
      ...customHeaders,
      'X-Cache-Strategy': config.strategy,
      'X-Cache-Type': config.type
    };
  }

  /**
   * Check if URL should be cached
   */
  shouldCache(url) {
    const config = this.getCacheConfig(url);
    return config.maxAge !== 0 && config.maxAge !== '0';
  }

  /**
   * Get cache key for URL
   */
  getCacheKey(url, userId = null, version = '1') {
    const { pathname, search } = new URL(url, 'http://localhost');
    const baseKey = `${pathname}${search}`;
    
    if (userId && this.requiresUserContext(url)) {
      return `user:${userId}:${baseKey}:v${version}`;
    }
    
    return `public:${baseKey}:v${version}`;
  }

  /**
   * Check if URL requires user context for caching
   */
  requiresUserContext(url) {
    const { pathname } = new URL(url, 'http://localhost');
    return pathname.includes('/dashboard') || 
           pathname.includes('/profile') || 
           pathname.includes('/settings') ||
           pathname.includes('/api/user');
  }
}

module.exports = { cacheConfig, CacheStrategy };