import { NextRequest, NextResponse } from 'next/server'
import { courseService } from '@/services/courseService'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    // Check if course exists
    const course = await courseService.getCourse(params.id)
    if (!course) {
      return NextResponse.json(
        { error: 'Course not found' },
        { status: 404 }
      )
    }
    
    // Check if course is published
    if (course.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: 'Course is not available for enrollment' },
        { status: 400 }
      )
    }
    
    try {
      const enrollment = await courseService.enrollUser(userId, params.id)
      
      return NextResponse.json({
        success: true,
        enrollment,
        message: 'Successfully enrolled in course'
      }, { status: 201 })
      
    } catch (enrollmentError: any) {
      if (enrollmentError.message === 'User already enrolled in this course') {
        return NextResponse.json(
          { error: 'You are already enrolled in this course' },
          { status: 409 }
        )
      }
      throw enrollmentError
    }
    
  } catch (error) {
    console.error('Enroll in course API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      )
    }
    
    const enrollments = await courseService.getUserEnrollments(userId)
    const enrollment = enrollments.find(e => e.courseId === params.id)
    
    if (!enrollment) {
      return NextResponse.json(
        { error: 'Enrollment not found' },
        { status: 404 }
      )
    }
    
    // Get progress details
    const progress = await courseService.getCourseProgress(userId, params.id)
    
    return NextResponse.json({
      success: true,
      enrollment: {
        ...enrollment,
        progress
      }
    })
    
  } catch (error) {
    console.error('Get enrollment API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}