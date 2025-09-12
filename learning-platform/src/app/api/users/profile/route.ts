import { NextRequest, NextResponse } from 'next/server'
import { userService } from '@/services/userService'

export async function GET(request: NextRequest) {
  try {
    // Get user ID from middleware-set headers
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const profile = await userService.getUserProfile(userId)
    
    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      success: true,
      profile
    })
    
  } catch (error) {
    console.error('Get profile API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const body = await request.json()
    
    // Validate and sanitize input
    const allowedFields = [
      'firstName', 'lastName', 'bio', 'profilePicture', 
      'skills', 'preferences', 'timezone'
    ]
    
    const updates: any = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }
    
    // Validate specific fields
    if (updates.firstName && updates.firstName.trim().length < 2) {
      return NextResponse.json(
        { error: 'First name must be at least 2 characters' },
        { status: 400 }
      )
    }
    
    if (updates.lastName && updates.lastName.trim().length < 2) {
      return NextResponse.json(
        { error: 'Last name must be at least 2 characters' },
        { status: 400 }
      )
    }
    
    if (updates.bio && updates.bio.length > 500) {
      return NextResponse.json(
        { error: 'Bio must be less than 500 characters' },
        { status: 400 }
      )
    }
    
    const updatedProfile = await userService.updateUserProfile(userId, updates)
    
    if (!updatedProfile) {
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      profile: updatedProfile,
      message: 'Profile updated successfully'
    })
    
  } catch (error) {
    console.error('Update profile API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}