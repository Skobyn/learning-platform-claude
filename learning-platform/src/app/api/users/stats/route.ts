import { NextRequest, NextResponse } from 'next/server'
import { userService } from '@/services/userService'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const stats = await userService.getUserStats(userId)
    
    if (!stats) {
      return NextResponse.json(
        { error: 'Unable to fetch user stats' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      stats
    })
    
  } catch (error) {
    console.error('Get user stats API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}