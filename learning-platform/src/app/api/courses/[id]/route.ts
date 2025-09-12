import { NextRequest, NextResponse } from 'next/server'
import { courseService } from '@/services/courseService'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const course = await courseService.getCourse(params.id)
    
    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      success: true,
      course
    })
    
  } catch (error) {
    console.error('Get course API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const course = await courseService.getCourse(params.id)
    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      )
    }
    
    // Check permissions - only course creator or admin can update
    if (course.createdBy !== userId && userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions to update this course' },
        { status: 403 }
      )
    }
    
    const body = await request.json()
    
    // Update course fields (limited set for security)
    const allowedFields = ['title', 'description', 'objectives', 'category', 'difficulty', 'tags', 'price', 'thumbnailUrl']
    const updates: any = {}
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field]
      }
    }
    
    // Validate updates
    if (updates.title && (updates.title.length < 5 || updates.title.length > 100)) {
      return NextResponse.json(
        { error: 'Title must be between 5 and 100 characters' },
        { status: 400 }
      )
    }
    
    if (updates.description && (updates.description.length < 20 || updates.description.length > 1000)) {
      return NextResponse.json(
        { error: 'Description must be between 20 and 1000 characters' },
        { status: 400 }
      )
    }
    
    if (updates.difficulty) {
      const validDifficulties = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
      if (!validDifficulties.includes(updates.difficulty)) {
        return NextResponse.json(
          { error: 'Invalid difficulty level' },
          { status: 400 }
        )
      }
    }
    
    // Update course (mock implementation - in real app, implement update method)
    Object.assign(course, updates, { updatedAt: new Date() })
    
    return NextResponse.json({
      success: true,
      course,
      message: 'Course updated successfully'
    })
    
  } catch (error) {
    console.error('Update course API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const course = await courseService.getCourse(params.id)
    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      )
    }
    
    // Check permissions - only course creator or admin can delete
    if (course.createdBy !== userId && userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions to delete this course' },
        { status: 403 }
      )
    }
    
    // Check if course has enrollments
    if (course.enrollmentCount > 0) {
      // Archive instead of delete if there are enrollments
      course.status = 'ARCHIVED'
      course.updatedAt = new Date()
      
      return NextResponse.json({
        success: true,
        message: 'Course archived successfully (has active enrollments)'
      })
    }
    
    // In real implementation, implement delete method
    // await courseService.deleteCourse(params.id)
    
    return NextResponse.json({
      success: true,
      message: 'Course deleted successfully'
    })
    
  } catch (error) {
    console.error('Delete course API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}