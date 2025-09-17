"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Enrollment, Course } from '@/types'
import { TrendingUp, Clock, Target, Calendar, Award, BookOpen, CheckCircle2 } from 'lucide-react'

interface ProgressTrackerProps {
  enrollments: (Enrollment & { course: Course })[]
  totalLearningTime: number
  weeklyGoal: number
  weeklyProgress: number
  streak: number
  badgesEarned: number
  className?: string
}

interface LearningStats {
  completedCourses: number
  inProgressCourses: number
  totalCourses: number
  averageProgress: number
  timeSpentThisWeek: number
}

export function ProgressTracker({
  enrollments,
  totalLearningTime,
  weeklyGoal,
  weeklyProgress,
  streak,
  badgesEarned,
  className = ''
}: ProgressTrackerProps) {
  const stats: LearningStats = React.useMemo(() => {
    const completedCourses = enrollments.filter(e => e.status === 'completed').length
    const inProgressCourses = enrollments.filter(e => e.status === 'active').length
    const totalCourses = enrollments.length
    const averageProgress = totalCourses > 0 
      ? enrollments.reduce((sum, e) => sum + e.progress, 0) / totalCourses 
      : 0
    
    return {
      completedCourses,
      inProgressCourses,
      totalCourses,
      averageProgress,
      timeSpentThisWeek: weeklyProgress
    }
  }, [enrollments, weeklyProgress])

  const getProgressVariant = (progress: number) => {
    if (progress >= 80) return 'success'
    if (progress >= 50) return 'warning'
    return 'default'
  }

  const getWeeklyGoalVariant = () => {
    const percentage = (weeklyProgress / weeklyGoal) * 100
    if (percentage >= 100) return 'success'
    if (percentage >= 75) return 'warning'
    return 'default'
  }

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    
    if (hours > 0) {
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
    }
    return `${minutes}m`
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 text-white rounded-lg">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-600">Courses</p>
                <p className="text-2xl font-bold text-blue-900">
                  {stats.completedCourses}/{stats.totalCourses}
                </p>
                <p className="text-xs text-blue-700">
                  {stats.inProgressCourses} in progress
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500 text-white rounded-lg">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-green-600">Avg. Progress</p>
                <p className="text-2xl font-bold text-green-900">
                  {Math.round(stats.averageProgress)}%
                </p>
                <p className="text-xs text-green-700">
                  Across all courses
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500 text-white rounded-lg">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-orange-600">Learning Time</p>
                <p className="text-2xl font-bold text-orange-900">
                  {formatTime(totalLearningTime)}
                </p>
                <p className="text-xs text-orange-700">
                  Total time spent
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500 text-white rounded-lg">
                <Award className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-purple-600">Badges</p>
                <p className="text-2xl font-bold text-purple-900">
                  {badgesEarned}
                </p>
                <p className="text-xs text-purple-700">
                  Earned this month
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly Goal & Streak */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-600" />
              Weekly Learning Goal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">
                  Progress this week
                </span>
                <span className="text-sm font-bold">
                  {formatTime(weeklyProgress)} / {formatTime(weeklyGoal)}
                </span>
              </div>
              
              <Progress 
                value={(weeklyProgress / weeklyGoal) * 100} 
                className="h-3"
              />
              
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  {Math.round((weeklyProgress / weeklyGoal) * 100)}% complete
                </span>
                <Badge 
                  variant={weeklyProgress >= weeklyGoal ? 'success' : 'warning'}
                  className="text-xs"
                >
                  {weeklyProgress >= weeklyGoal ? 'Goal Achieved!' : 'Keep Going!'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-orange-600" />
              Learning Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-4xl font-bold text-orange-600 mb-2">
                {streak}
              </div>
              <p className="text-gray-600 mb-4">
                {streak === 1 ? 'day' : 'days'} in a row
              </p>
              
              <div className="flex justify-center gap-1 mb-4">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      i < streak % 7 || (streak > 7 && i < 7) 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {i < streak % 7 || (streak > 7 && i < 7) ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : null}
                  </div>
                ))}
              </div>
              
              <p className="text-xs text-gray-500">
                Keep learning daily to maintain your streak!
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {enrollments
              .filter(e => e.status === 'active')
              .slice(0, 3)
              .map((enrollment) => (
                <div key={enrollment.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">{enrollment.course.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress 
                        value={enrollment.progress} 
                        className="h-2 flex-1"
                      />
                      <span className="text-sm font-medium text-gray-600">
                        {enrollment.progress}%
                      </span>
                    </div>
                  </div>
                  <Badge 
                    variant={enrollment.progress > 75 ? 'success' : 'warning'}
                    className="text-xs"
                  >
                    {enrollment.progress === 100 ? 'Complete' : 'In Progress'}
                  </Badge>
                </div>
              ))
            }
            
            {enrollments.filter(e => e.status === 'active').length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <BookOpen className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No courses in progress</p>
                <p className="text-sm">Start learning to see your progress here</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ProgressTracker;