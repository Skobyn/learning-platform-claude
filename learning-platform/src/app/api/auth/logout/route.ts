import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authService } from '@/services/authService'

export async function POST(request: NextRequest) {
  try {
    // Get user info from headers (set by middleware)
    const userId = request.headers.get('x-user-id')
    
    // Perform logout operations
    await authService.logout()
    
    // Clear the authentication cookie
    const cookieStore = cookies()
    cookieStore.delete('auth-token')
    
    // Log the logout event (in real implementation)
    if (userId) {
      console.log(`User ${userId} logged out at ${new Date().toISOString()}`)
      // await auditService.logEvent('USER_LOGOUT', userId)
    }
    
    return NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    })
    
  } catch (error) {
    console.error('Logout API error:', error)
    
    // Even if there's an error, we should clear the cookie
    const cookieStore = cookies()
    cookieStore.delete('auth-token')
    
    return NextResponse.json(
      { error: 'Logout failed, but session cleared' },
      { status: 500 }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}