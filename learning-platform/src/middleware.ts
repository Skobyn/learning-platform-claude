import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { createRateLimitMiddleware, RateLimitPresets } from '@/middleware/rateLimiter';
import { createCacheMiddleware, CachePresets } from '@/middleware/cache';

// Configure rate limiting for different routes
const generalRateLimit = createRateLimitMiddleware(RateLimitPresets.general);
const authRateLimit = createRateLimitMiddleware(RateLimitPresets.auth);
const apiRateLimit = createRateLimitMiddleware(RateLimitPresets.perUser);
const uploadRateLimit = createRateLimitMiddleware(RateLimitPresets.upload);
const searchRateLimit = createRateLimitMiddleware(RateLimitPresets.search);

// Configure caching for different routes
const staticDataCache = createCacheMiddleware(CachePresets.staticData);
const userDataCache = createCacheMiddleware(CachePresets.userData);
const searchResultsCache = createCacheMiddleware(CachePresets.searchResults);
const courseContentCache = createCacheMiddleware(CachePresets.courseContent);
const analyticsCache = createCacheMiddleware(CachePresets.analyticsData);

// Define protected routes and their required roles
const protectedRoutes = {
  '/dashboard': ['LEARNER', 'INSTRUCTOR', 'ADMIN'],
  '/admin': ['ADMIN'],
  '/instructor': ['INSTRUCTOR', 'ADMIN'],
  '/api/admin': ['ADMIN'],
  '/api/instructor': ['INSTRUCTOR', 'ADMIN'],
  '/api/courses/create': ['INSTRUCTOR', 'ADMIN'],
  '/api/users': ['ADMIN']
}

const publicRoutes = [
  '/',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/health'
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Skip middleware for static files and internal Next.js routes
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/robots.txt') ||
    pathname.startsWith('/sitemap.xml')
  ) {
    return NextResponse.next();
  }

  try {
    // Apply rate limiting based on route patterns FIRST
    let rateLimitResponse: NextResponse | null = null;

    if (pathname.startsWith('/api/auth/')) {
      // Strict rate limiting for authentication endpoints
      rateLimitResponse = await authRateLimit(request, () => Promise.resolve(NextResponse.next()));
      if (rateLimitResponse.status === 429) {
        return rateLimitResponse;
      }
    } else if (pathname.startsWith('/api/upload/')) {
      // Rate limiting for file uploads
      rateLimitResponse = await uploadRateLimit(request, () => Promise.resolve(NextResponse.next()));
      if (rateLimitResponse.status === 429) {
        return rateLimitResponse;
      }
    } else if (pathname.startsWith('/api/search/')) {
      // Rate limiting for search endpoints
      rateLimitResponse = await searchRateLimit(request, () => Promise.resolve(NextResponse.next()));
      if (rateLimitResponse.status === 429) {
        return rateLimitResponse;
      }
    } else if (pathname.startsWith('/api/')) {
      // General API rate limiting
      rateLimitResponse = await apiRateLimit(request, () => Promise.resolve(NextResponse.next()));
      if (rateLimitResponse.status === 429) {
        return rateLimitResponse;
      }
    }

    // Allow public routes (after rate limiting)
    if (publicRoutes.some(route => pathname.startsWith(route))) {
      return addSecurityHeaders(NextResponse.next(), pathname);
    }
  
  // Check if route requires authentication
  const requiresAuth = Object.keys(protectedRoutes).some(route => 
    pathname.startsWith(route)
  )
  
  if (!requiresAuth) {
    return NextResponse.next()
  }
  
  // Get token from cookies or Authorization header
  const token = request.cookies.get('auth-token')?.value || 
                request.headers.get('Authorization')?.replace('Bearer ', '')
  
  if (!token) {
    // Redirect to login for page requests
    if (!pathname.startsWith('/api')) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
    // Return 401 for API requests
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }
  
  try {
    // Verify JWT token
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback-secret'
    )
    
    const { payload } = await jwtVerify(token, secret)
    
    // Check if user session is valid
    if (!payload.sub || !payload.role) {
      throw new Error('Invalid token payload')
    }
    
    // Check role-based permissions
    const requiredRoles = Object.entries(protectedRoutes).find(([route]) => 
      pathname.startsWith(route)
    )?.[1]
    
    if (requiredRoles && !requiredRoles.includes(payload.role as string)) {
      // Redirect to unauthorized page for web requests
      if (!pathname.startsWith('/api')) {
        return NextResponse.redirect(new URL('/unauthorized', request.url))
      }
      // Return 403 for API requests
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
    
    // Add user info to headers for API routes
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', payload.sub as string)
    requestHeaders.set('x-user-role', payload.role as string)
    requestHeaders.set('x-user-email', payload.email as string)
    
    const response = NextResponse.next({
      request: {
        headers: requestHeaders
      }
    })
    
    // Apply caching for GET requests to authenticated routes
    if (request.method === 'GET') {
      const context = { params: {} };
      
      if (pathname.startsWith('/api/courses/') && !pathname.includes('/enroll')) {
        // Cache course content
        return courseContentCache(request, context, () => Promise.resolve(addSecurityHeaders(response, pathname)));
      } else if (pathname.startsWith('/api/search/')) {
        // Cache search results
        return searchResultsCache(request, context, () => Promise.resolve(addSecurityHeaders(response, pathname)));
      } else if (pathname.startsWith('/api/users/profile') || pathname.startsWith('/api/users/dashboard')) {
        // Cache user-specific data
        return userDataCache(request, context, () => Promise.resolve(addSecurityHeaders(response, pathname)));
      } else if (pathname.startsWith('/api/analytics/')) {
        // Cache analytics data
        return analyticsCache(request, context, () => Promise.resolve(addSecurityHeaders(response, pathname)));
      } else if (
        pathname.startsWith('/api/system/') ||
        pathname.startsWith('/api/settings/') ||
        pathname.startsWith('/api/categories/')
      ) {
        // Cache static system data
        return staticDataCache(request, context, () => Promise.resolve(addSecurityHeaders(response, pathname)));
      }
    }
    
    return addSecurityHeaders(response, pathname);
    
  } catch (error) {
    console.error('Auth middleware error:', error)
    
    // Clear invalid token
    const response = pathname.startsWith('/api') 
      ? NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        )
      : NextResponse.redirect(new URL('/auth/login', request.url))
    
    response.cookies.delete('auth-token')
    return response
  }

  } catch (middlewareError) {
    console.error('Middleware error:', middlewareError);
    
    // Return error response
    return new NextResponse(
      JSON.stringify({
        error: 'Middleware processing failed',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

// Helper function to add security headers
function addSecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  // Security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Content Security Policy (adjust based on your needs)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Adjust for your needs
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    "connect-src 'self' https:",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  
  response.headers.set('Content-Security-Policy', csp);

  // Add cache control headers for specific routes
  if (pathname.startsWith('/api/health')) {
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (pathname.startsWith('/api/static/') || pathname.startsWith('/api/settings/system')) {
    response.headers.set('Cache-Control', 'public, max-age=3600'); // 1 hour
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}