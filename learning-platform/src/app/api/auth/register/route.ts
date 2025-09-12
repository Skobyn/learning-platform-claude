import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/services/authService'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { firstName, lastName, email, password, role, organizationCode } = body
    
    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: 'All required fields must be provided' },
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
    
    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }
    
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/
    if (!passwordRegex.test(password)) {
      return NextResponse.json(
        { 
          error: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character' 
        },
        { status: 400 }
      )
    }
    
    // Validate role
    const validRoles = ['LEARNER', 'INSTRUCTOR', 'ADMIN']
    if (role && !validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role specified' },
        { status: 400 }
      )
    }
    
    // Validate name fields
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      return NextResponse.json(
        { error: 'First name and last name must be at least 2 characters long' },
        { status: 400 }
      )
    }
    
    // Attempt registration
    const result = await authService.register({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || 'LEARNER',
      organizationCode: organizationCode?.trim()
    })
    
    if (!result.success) {
      const statusCode = result.error === 'Email already registered' ? 409 : 400
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      )
    }
    
    // Return success response
    return NextResponse.json({
      success: true,
      user: result.user,
      message: 'Registration successful. Please check your email to verify your account.'
    }, { status: 201 })
    
  } catch (error) {
    console.error('Registration API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
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