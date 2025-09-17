"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import CourseCard from './CourseCard'
import { Course, Recommendation, RecommendationType } from '@/types'
import { Sparkles, TrendingUp, User, BookOpen, ArrowRight } from 'lucide-react'

interface RecommendedCoursesProps {
  recommendations: (Recommendation & { course?: Course })[]
  className?: string
}

interface RecommendationGroup {
  type: RecommendationType
  title: string
  description: string
  icon: React.ReactNode
  color: string
  recommendations: (Recommendation & { course?: Course })[]
}

const getRecommendationIcon = (type: RecommendationType) => {
  switch (type) {
    case RecommendationType.COURSE:
      return <BookOpen className="h-5 w-5" />
    case RecommendationType.LEARNING_PATH:
      return <TrendingUp className="h-5 w-5" />
    case RecommendationType.NEXT_MODULE:
      return <ArrowRight className="h-5 w-5" />
    default:
      return <Sparkles className="h-5 w-5" />
  }
}

const getRecommendationTypeInfo = (type: RecommendationType) => {
  switch (type) {
    case RecommendationType.COURSE:
      return {
        title: 'Recommended for You',
        description: 'AI-powered course suggestions based on your learning history and interests',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50'
      }
    case RecommendationType.LEARNING_PATH:
      return {
        title: 'Learning Paths',
        description: 'Structured learning journeys to help you achieve your goals',
        color: 'text-green-600',
        bgColor: 'bg-green-50'
      }
    case RecommendationType.NEXT_MODULE:
      return {
        title: 'Continue Learning',
        description: 'Pick up where you left off in your current courses',
        color: 'text-purple-600',
        bgColor: 'bg-purple-50'
      }
    default:
      return {
        title: 'Suggestions',
        description: 'Personalized recommendations',
        color: 'text-gray-600',
        bgColor: 'bg-gray-50'
      }
  }
}

const getScoreBadgeVariant = (score: number) => {
  if (score >= 0.8) return 'success'
  if (score >= 0.6) return 'warning'
  return 'info'
}

const getScoreLabel = (score: number) => {
  if (score >= 0.9) return 'Perfect Match'
  if (score >= 0.8) return 'Great Match'
  if (score >= 0.7) return 'Good Match'
  if (score >= 0.6) return 'Recommended'
  return 'Suggested'
}

export function RecommendedCourses({ 
  recommendations, 
  className = '' 
}: RecommendedCoursesProps) {
  const recommendationGroups: RecommendationGroup[] = React.useMemo(() => {
    const groups = recommendations.reduce((acc, rec) => {
      const existing = acc.find(g => g.type === rec.type)
      if (existing) {
        existing.recommendations.push(rec)
      } else {
        const typeInfo = getRecommendationTypeInfo(rec.type)
        acc.push({
          type: rec.type,
          title: typeInfo.title,
          description: typeInfo.description,
          icon: getRecommendationIcon(rec.type),
          color: typeInfo.color,
          recommendations: [rec]
        })
      }
      return acc
    }, [] as RecommendationGroup[])

    // Sort recommendations within each group by score
    groups.forEach(group => {
      group.recommendations.sort((a, b) => b.score - a.score)
    })

    return groups
  }, [recommendations])

  if (recommendations.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-8 text-center">
          <Sparkles className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Recommendations Yet
          </h3>
          <p className="text-gray-600">
            Start learning to get personalized course recommendations based on your interests and progress.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`space-y-8 ${className}`}>
      {recommendationGroups.map((group) => (
        <Card key={group.type}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${group.color}`}>
              {group.icon}
              {group.title}
            </CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              {group.description}
            </p>
          </CardHeader>
          <CardContent>
            {group.type === RecommendationType.COURSE && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {group.recommendations
                  .filter(rec => rec.course)
                  .slice(0, 6)
                  .map((rec) => (
                    <div key={rec.id} className="relative">
                      <CourseCard 
                        course={rec.course!}
                        variant="default"
                      />
                      
                      {/* Recommendation Score Badge */}
                      <div className="absolute top-3 right-3 z-10">
                        <Badge 
                          variant={getScoreBadgeVariant(rec.score)}
                          className="text-xs font-medium"
                        >
                          {getScoreLabel(rec.score)}
                        </Badge>
                      </div>
                      
                      {/* Recommendation Reason */}
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="flex items-start gap-2">
                          <Sparkles className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-blue-900 mb-1">
                              Why this course?
                            </p>
                            <p className="text-xs text-blue-700">
                              {rec.reason}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            
            {group.type === RecommendationType.NEXT_MODULE && (
              <div className="space-y-4">
                {group.recommendations.slice(0, 3).map((rec) => (
                  <div key={rec.id} className="flex items-center gap-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <div className="p-2 bg-purple-500 text-white rounded-lg">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">
                        Continue Learning
                      </h4>
                      <p className="text-sm text-gray-600 mb-2">
                        {rec.reason}
                      </p>
                      <Badge variant="info" className="text-xs">
                        {Math.round(rec.score * 100)}% progress remaining
                      </Badge>
                    </div>
                    
                    <ArrowRight className="h-5 w-5 text-purple-500" />
                  </div>
                ))}
              </div>
            )}
            
            {group.type === RecommendationType.LEARNING_PATH && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {group.recommendations.slice(0, 4).map((rec) => (
                  <Card key={rec.id} className="border border-green-200 bg-green-50/50">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-green-500 text-white rounded-lg">
                          <TrendingUp className="h-5 w-5" />
                        </div>
                        
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 mb-2">
                            Learning Path
                          </h4>
                          <p className="text-sm text-gray-600 mb-3">
                            {rec.reason}
                          </p>
                          
                          <div className="flex items-center justify-between">
                            <Badge 
                              variant={getScoreBadgeVariant(rec.score)}
                              className="text-xs"
                            >
                              {Math.round(rec.score * 100)}% match
                            </Badge>
                            
                            <ArrowRight className="h-4 w-4 text-green-500" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      
      {/* View More Section */}
      <Card className="border-2 border-dashed border-gray-200 hover:border-gray-300 transition-colors">
        <CardContent className="p-6 text-center">
          <User className="h-8 w-8 mx-auto mb-3 text-gray-400" />
          <h3 className="font-semibold text-gray-900 mb-2">
            Want more personalized recommendations?
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Complete your profile and take a few more courses to get better AI-powered suggestions.
          </p>
          <Badge variant="outline" className="cursor-pointer hover:bg-gray-50">
            Update Profile
          </Badge>
        </CardContent>
      </Card>
    </div>
  )
}

export default RecommendedCourses;