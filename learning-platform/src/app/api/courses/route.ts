import { NextRequest, NextResponse } from 'next/server'
import { courseService } from '@/services/courseService'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const difficulty = searchParams.get('difficulty')
    const status = searchParams.get('status')
    const createdBy = searchParams.get('createdBy')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    
    const filters: any = {}
    
    if (category) filters.category = category
    if (difficulty) filters.difficulty = difficulty
    if (status) filters.status = status
    if (createdBy) filters.createdBy = createdBy
    if (limitParam) filters.limit = parseInt(limitParam, 10)
    if (offsetParam) filters.offset = parseInt(offsetParam, 10)
    
    const { courses, total } = await courseService.getCourses(filters)
    
    return NextResponse.json({
      success: true,
      courses,
      total,
      pagination: {
        limit: filters.limit || total,
        offset: filters.offset || 0,
        hasMore: (filters.offset || 0) + (filters.limit || total) < total
      }
    })
    
  } catch (error) {
    console.error('Get courses API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    // Check permissions - only instructors and admins can create courses
    if (userRole !== 'INSTRUCTOR' && userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions to create courses' },
        { status: 403 }
      )
    }
    
    const body = await request.json()
    
    // Validate required fields
    const requiredFields = ['title', 'description', 'category', 'difficulty']
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `${field} is required` },
          { status: 400 }
        )
      }
    }
    
    // Validate field values
    const validDifficulties = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
    if (!validDifficulties.includes(body.difficulty)) {
      return NextResponse.json(
        { error: 'Invalid difficulty level' },
        { status: 400 }
      )
    }
    
    if (body.title.length < 5 || body.title.length > 100) {
      return NextResponse.json(
        { error: 'Title must be between 5 and 100 characters' },
        { status: 400 }
      )
    }
    
    if (body.description.length < 20 || body.description.length > 1000) {
      return NextResponse.json(
        { error: 'Description must be between 20 and 1000 characters' },
        { status: 400 }
      )
    }
    
    // Create course
    const course = await courseService.createCourse({
      title: body.title,
      description: body.description,
      objectives: body.objectives || [],
      status: 'DRAFT',
      category: body.category,
      difficulty: body.difficulty,
      estimatedDuration: body.estimatedDuration || 0,
      modules: [],
      tags: body.tags || [],
      price: body.price || 0,
      currency: body.currency || 'USD',
      thumbnailUrl: body.thumbnailUrl,
      isAIGenerated: body.isAIGenerated || false
    }, userId)
    
    return NextResponse.json({
      success: true,
      course,
      message: 'Course created successfully'
    }, { status: 201 })
    
  } catch (error) {
    console.error('Create course API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}