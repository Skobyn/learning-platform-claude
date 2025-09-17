"use client"

import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Course, CourseLevel, Enrollment } from '@/types'
import { Clock, Users, BookOpen, Star, PlayCircle, CheckCircle2 } from 'lucide-react'

interface CourseCardProps {
  course: Course
  enrollment?: Enrollment
  showProgress?: boolean
  variant?: 'default' | 'compact' | 'detailed'
  className?: string
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

export default function CourseCard({ 
  course, 
  enrollment, 
  showProgress = false,
  variant = 'default',
  className = ''
}: CourseCardProps) {
  const isEnrolled = !!enrollment
  const isCompleted = enrollment?.status === 'completed'
  const progress = enrollment?.progress || 0

  const getProgressVariant = () => {
    if (progress >= 80) return 'success'
    if (progress >= 50) return 'warning'
    return 'default'
  }

  if (variant === 'compact') {
    return (
      <Link href={`/learn/courses/${course.id}`}>
        <Card className={`group hover:shadow-md transition-all duration-300 cursor-pointer ${className}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 flex-shrink-0">
                <Image
                  src={course.thumbnailUrl || '/images/course-placeholder.jpg'}
                  alt={course.title}
                  fill
                  className="object-cover rounded-lg"
                />
                {isCompleted && (
                  <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full p-1">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                  {course.title}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {formatDuration(course.duration)}
                  </span>
                  <Badge variant={getLevelBadgeVariant(course.level)} className="text-xs">
                    {course.level}
                  </Badge>
                </div>
                
                {showProgress && isEnrolled && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600">Progress</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    )
  }

  return (
    <Link href={`/learn/courses/${course.id}`}>
      <Card className={`group hover:shadow-lg transition-all duration-300 cursor-pointer border-0 bg-white overflow-hidden h-full ${className}`}>
        <div className="relative">
          <div className="relative h-48">
            <Image
              src={course.thumbnailUrl || '/images/course-placeholder.jpg'}
              alt={course.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute top-3 left-3">
              <Badge variant={getLevelBadgeVariant(course.level)}>
                {course.level}
              </Badge>
            </div>
            {isCompleted && (
              <div className="absolute top-3 right-3 bg-green-500 text-white rounded-full p-2">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <PlayCircle className="h-16 w-16 text-white drop-shadow-lg" />
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
            {course.title}
          </h3>
          
          <p className="text-gray-600 text-sm mb-4 line-clamp-3">
            {course.description}
          </p>

          <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatDuration(course.duration)}
            </span>
            <span className="flex items-center gap-1">
              <BookOpen className="h-4 w-4" />
              {course.modules?.length || 0} modules
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {course.enrollments?.length || 0}
            </span>
          </div>

          {course.tags && course.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {course.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {course.tags.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{course.tags.length - 3} more
                </Badge>
              )}
            </div>
          )}

          {showProgress && isEnrolled && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600">Your Progress</span>
                <span className="font-semibold text-gray-900">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </CardContent>

        <CardFooter className="px-6 py-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isEnrolled ? (
              <Badge variant="info" className="text-xs">
                {isCompleted ? 'Completed' : 'In Progress'}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Not Enrolled
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span>4.8</span>
          </div>
        </CardFooter>
      </Card>
    </Link>
  )
}