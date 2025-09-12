import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authService } from '@/services/authService'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body
    
    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }
    
    // Attempt login
    const result = await authService.login(email, password)
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === 'User not found' ? 404 : 401 }
      )
    }
    
    // Handle 2FA requirement
    if (result.requiresTwoFactor) {
      return NextResponse.json({
        success: true,
        requiresTwoFactor: true,
        message: '2FA code sent to your email'
      })
    }
    
    // Set secure HTTP-only cookie
    if (result.token) {
      const cookieStore = cookies()
      cookieStore.set('auth-token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })
    }
    
    // Return success response
    return NextResponse.json({
      success: true,
      user: result.user,
      message: 'Login successful'
    })
    
  } catch (error) {
    console.error('Login API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle preflight requests for CORS
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