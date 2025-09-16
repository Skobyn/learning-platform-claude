import { NextRequest, NextResponse } from 'next/server'

// Simplified middleware without Redis dependencies
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Allow all requests for now (disabled Redis-based auth/rate limiting)
  // This is a temporary fix for deployment

  // Skip middleware for static files and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health') ||
    pathname.includes('.') // static files
  ) {
    return NextResponse.next()
  }

  // Allow all other requests
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}