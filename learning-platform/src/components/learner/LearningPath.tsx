"use client"

import React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Progress } from '@/components/ui/Progress'
import { LearningPath as LearningPathType, Course, Enrollment, CourseLevel } from '@/types'
import { 
  MapPin, 
  CheckCircle2, 
  Clock, 
  Star, 
  ArrowRight, 
  PlayCircle,
  BookOpen,
  Trophy,
  Lock,
  Route
} from 'lucide-react'

interface LearningPathProps {
  learningPath: LearningPathType
  enrollments?: Enrollment[]
  className?: string
}

interface CourseProgress {
  course: Course
  enrollment?: Enrollment
  isCompleted: boolean
  isAvailable: boolean
  isNext: boolean
  position: number
}

const getLevelBadgeVariant = (level: CourseLevel) => {
  switch (level) {
    case CourseLevel.BEGINNER:
      return 'success'
    case CourseLevel.INTERMEDIATE:
      return 'warning'
    case CourseLevel.ADVANCED:
      return 'destructive'
    default:
      return 'default'
  }
}

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  
  if (hours > 0) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  return `${minutes}m`
}

export function LearningPath({ 
  learningPath, 
  enrollments = [],
  className = '' 
}: LearningPathProps) {
  const coursesProgress: CourseProgress[] = React.useMemo(() => {
    return learningPath.courses.map((course, index) => {
      const enrollment = enrollments.find(e => e.courseId === course.id)
      const isCompleted = enrollment?.status === 'completed'
      
      // First course is always available, subsequent courses require previous completion
      let isAvailable = index === 0
      if (index > 0) {
        const prevCourseProgress = learningPath.courses.slice(0, index)
        const prevCoursesCompleted = prevCourseProgress.every(prevCourse => 
          enrollments.some(e => e.courseId === prevCourse.id && e.status === 'completed')
        )
        isAvailable = prevCoursesCompleted
      }
      
      // Next course to take (first available non-completed course)
      const completedCourses = learningPath.courses.slice(0, index)
        .filter(prevCourse => enrollments.some(e => e.courseId === prevCourse.id && e.status === 'completed'))
      const isNext = !isCompleted && isAvailable && completedCourses.length === index

      return {
        course,
        enrollment,
        isCompleted,
        isAvailable,
        isNext,
        position: index + 1
      }
    })
  }, [learningPath.courses, enrollments])

  const pathStats = React.useMemo(() => {
    const totalCourses = learningPath.courses.length
    const completedCourses = coursesProgress.filter(cp => cp.isCompleted).length
    const inProgressCourses = coursesProgress.filter(cp => cp.enrollment?.status === 'active').length
    const overallProgress = totalCourses > 0 ? (completedCourses / totalCourses) * 100 : 0
    
    const totalDuration = learningPath.courses.reduce((sum, course) => sum + course.duration, 0)
    const completedDuration = coursesProgress
      .filter(cp => cp.isCompleted)
      .reduce((sum, cp) => sum + cp.course.duration, 0)

    return {
      totalCourses,
      completedCourses,
      inProgressCourses,
      overallProgress,
      totalDuration,
      completedDuration
    }
  }, [coursesProgress, learningPath.courses])

  const nextCourse = coursesProgress.find(cp => cp.isNext)

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Path Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 text-white rounded-lg">
                <Route className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-xl">{learningPath.name}</CardTitle>
                <p className="text-gray-600 mt-1">{learningPath.description}</p>
              </div>
            </div>
            <Badge variant={getLevelBadgeVariant(learningPath.difficulty)}>
              {learningPath.difficulty}
            </Badge>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Progress Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600 mb-1">
                {pathStats.completedCourses}/{pathStats.totalCourses}
              </div>
              <p className="text-sm text-blue-700">Courses Completed</p>
            </div>
            
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600 mb-1">
                {Math.round(pathStats.overallProgress)}%
              </div>
              <p className="text-sm text-green-700">Path Progress</p>
            </div>
            
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600 mb-1">
                {formatDuration(pathStats.completedDuration)}
              </div>
              <p className="text-sm text-purple-700">Time Invested</p>
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Overall Progress</span>
              <span className="text-sm font-bold text-gray-900">
                {Math.round(pathStats.overallProgress)}%
              </span>
            </div>
            <Progress 
              value={pathStats.overallProgress} 
              variant={pathStats.overallProgress >= 80 ? 'success' : 'default'}
              className="h-3"
            />
          </div>

          {/* Next Course CTA */}
          {nextCourse && (
            <Card className="border-2 border-dashed border-blue-200 bg-blue-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-500 text-white rounded-lg">
                    <PlayCircle className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 mb-1">
                      Continue Your Journey
                    </h4>
                    <p className="text-sm text-gray-600 mb-2">
                      Next up: {nextCourse.course.title}
                    </p>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {formatDuration(nextCourse.course.duration)}
                      </span>
                      <Badge variant="info" className="text-xs">
                        Course {nextCourse.position}
                      </Badge>
                    </div>
                  </div>
                  <Link href={`/learn/courses/${nextCourse.course.id}`}>
                    <Badge variant="default" className="cursor-pointer hover:bg-gray-800">
                      Start Course
                    </Badge>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Course Path Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Learning Journey
          </CardTitle>
        </CardHeader>
        
        <CardContent>
          <div className="space-y-4">
            {coursesProgress.map((courseProgress, index) => {
              const { course, enrollment, isCompleted, isAvailable, isNext } = courseProgress
              
              return (
                <div key={course.id} className="relative">
                  {/* Connection Line */}
                  {index < coursesProgress.length - 1 && (
                    <div 
                      className={`absolute left-6 top-16 w-0.5 h-8 ${
                        isCompleted ? 'bg-green-400' : 'bg-gray-200'
                      }`}
                    />
                  )}
                  
                  <div className="flex items-start gap-4">
                    {/* Status Icon */}
                    <div className={`p-2 rounded-full border-2 ${
                      isCompleted 
                        ? 'bg-green-500 border-green-500 text-white' 
                        : isNext
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : isAvailable
                        ? 'bg-white border-gray-300 text-gray-600'
                        : 'bg-gray-100 border-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : isNext ? (
                        <PlayCircle className="h-5 w-5" />
                      ) : isAvailable ? (
                        <BookOpen className="h-5 w-5" />
                      ) : (
                        <Lock className="h-5 w-5" />
                      )}
                    </div>
                    
                    {/* Course Info */}
                    <div className={`flex-1 ${
                      isAvailable ? '' : 'opacity-60'
                    }`}>
                      <Card className={`${
                        isNext 
                          ? 'border-2 border-blue-200 bg-blue-50/50' 
                          : isCompleted 
                          ? 'border-2 border-green-200 bg-green-50/50'
                          : 'border border-gray-200'
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">
                                  Course {courseProgress.position}
                                </Badge>
                                <Badge variant={getLevelBadgeVariant(course.level)} className="text-xs">
                                  {course.level}
                                </Badge>
                                {isNext && (
                                  <Badge variant="info" className="text-xs">
                                    Next
                                  </Badge>
                                )}
                              </div>
                              
                              <h4 className={`font-semibold ${
                                isAvailable ? 'text-gray-900' : 'text-gray-500'
                              }`}>
                                {course.title}
                              </h4>
                              
                              <p className={`text-sm mt-1 ${
                                isAvailable ? 'text-gray-600' : 'text-gray-400'
                              }`}>
                                {course.description}
                              </p>
                            </div>
                            
                            {isCompleted && (
                              <Trophy className="h-5 w-5 text-yellow-500" />
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                              <span className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {formatDuration(course.duration)}
                              </span>
                              <span className="flex items-center gap-1">
                                <BookOpen className="h-4 w-4" />
                                {course.modules?.length || 0} modules
                              </span>
                              {enrollment && (
                                <span className="flex items-center gap-1">
                                  <Star className="h-4 w-4" />
                                  {enrollment.progress}%
                                </span>
                              )}
                            </div>
                            
                            {isAvailable && (
                              <Link href={`/learn/courses/${course.id}`}>
                                <Badge 
                                  variant={isNext ? 'default' : 'outline'} 
                                  className="cursor-pointer hover:opacity-80"
                                >
                                  {isCompleted ? 'Review' : enrollment ? 'Continue' : 'Start'}
                                  <ArrowRight className="h-3 w-3 ml-1" />
                                </Badge>
                              </Link>
                            )}
                          </div>
                          
                          {/* Course Progress Bar */}
                          {enrollment && enrollment.progress > 0 && (
                            <div className="mt-3">
                              <Progress 
                                value={enrollment.progress} 
                                variant={enrollment.progress >= 80 ? 'success' : 'default'}
                                className="h-2"
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Path Completion Reward */}
      {pathStats.overallProgress === 100 && (
        <Card className="border-2 border-yellow-200 bg-yellow-50">
          <CardContent className="p-6 text-center">
            <Trophy className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
            <h3 className="text-xl font-bold text-yellow-800 mb-2">
              🎉 Path Completed!
            </h3>
            <p className="text-yellow-700 mb-4">
              Congratulations! You've successfully completed the {learningPath.name} learning path.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Badge variant="gold" className="px-4 py-2">
                Certificate Available
              </Badge>
              <Badge variant="outline" className="px-4 py-2 cursor-pointer hover:bg-yellow-100">
                Share Achievement
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default LearningPath;