import { NextRequest, NextResponse } from 'next/server'
import { userService } from '@/services/userService'

export async function GET(request: NextRequest) {
  try {
    const userRole = request.headers.get('x-user-role')
    
    // Verify admin access
    if (userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
    
    const { searchParams } = new URL(request.url)
    const role = searchParams.get('role')
    const isActiveParam = searchParams.get('isActive')
    const organizationId = searchParams.get('organizationId')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    
    const filters: any = {}
    
    if (role) filters.role = role
    if (isActiveParam !== null) filters.isActive = isActiveParam === 'true'
    if (organizationId) filters.organizationId = organizationId
    if (limitParam) filters.limit = parseInt(limitParam, 10)
    if (offsetParam) filters.offset = parseInt(offsetParam, 10)
    
    const { users, total } = await userService.getAllUsers(filters)
    
    return NextResponse.json({
      success: true,
      users,
      total,
      pagination: {
        limit: filters.limit || total,
        offset: filters.offset || 0,
        hasMore: (filters.offset || 0) + (filters.limit || total) < total
      }
    })
    
  } catch (error) {
    console.error('Admin get users API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}