"use client"

import React from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UserBadge, Badge as BadgeType, BadgeType as BadgeTypeEnum } from '@/types'
import { Award, Trophy, Star, Target, Zap, Calendar, Medal, Crown } from 'lucide-react'

interface BadgeShowcaseProps {
  userBadges: (UserBadge & { badge: BadgeType })[]
  className?: string
}

interface BadgeStats {
  total: number
  bronze: number
  silver: number
  gold: number
  recent: number
}

const getBadgeIcon = (type: BadgeTypeEnum) => {
  switch (type) {
    case BadgeTypeEnum.COURSE_COMPLETION:
      return <Trophy className="h-5 w-5" />
    case BadgeTypeEnum.QUIZ_MASTERY:
      return <Star className="h-5 w-5" />
    case BadgeTypeEnum.STREAK:
      return <Calendar className="h-5 w-5" />
    case BadgeTypeEnum.PARTICIPATION:
      return <Target className="h-5 w-5" />
    case BadgeTypeEnum.SKILL:
      return <Zap className="h-5 w-5" />
    default:
      return <Medal className="h-5 w-5" />
  }
}

const getBadgeTier = (badgeName: string): 'bronze' | 'silver' | 'gold' => {
  const name = badgeName.toLowerCase()
  if (name.includes('gold') || name.includes('master') || name.includes('expert')) return 'gold'
  if (name.includes('silver') || name.includes('advanced') || name.includes('pro')) return 'silver'
  return 'bronze'
}

const getTierBadgeVariant = (tier: 'bronze' | 'silver' | 'gold') => {
  switch (tier) {
    case 'gold':
      return 'warning'
    case 'silver':
      return 'secondary'
    case 'bronze':
      return 'default'
    default:
      return 'default'
  }
}

const getTierIcon = (tier: 'bronze' | 'silver' | 'gold') => {
  switch (tier) {
    case 'gold':
      return <Crown className="h-4 w-4" />
    case 'silver':
      return <Trophy className="h-4 w-4" />
    case 'bronze':
      return <Medal className="h-4 w-4" />
    default:
      return <Award className="h-4 w-4" />
  }
}

export function BadgeShowcase({ userBadges, className = '' }: BadgeShowcaseProps) {
  const badgeStats: BadgeStats = React.useMemo(() => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    return {
      total: userBadges.length,
      bronze: userBadges.filter(ub => getBadgeTier(ub.badge.name) === 'bronze').length,
      silver: userBadges.filter(ub => getBadgeTier(ub.badge.name) === 'silver').length,
      gold: userBadges.filter(ub => getBadgeTier(ub.badge.name) === 'gold').length,
      recent: userBadges.filter(ub => new Date(ub.earnedAt) >= thirtyDaysAgo).length
    }
  }, [userBadges])

  const recentBadges = userBadges
    .sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime())
    .slice(0, 6)

  const featuredBadges = userBadges
    .filter(ub => getBadgeTier(ub.badge.name) === 'gold')
    .slice(0, 3)

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Badge Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-900 mb-1">
              {badgeStats.total}
            </div>
            <p className="text-sm font-medium text-blue-600">Total Badges</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Medal className="h-5 w-5 text-amber-600" />
              <span className="text-2xl font-bold text-amber-900">
                {badgeStats.bronze}
              </span>
            </div>
            <p className="text-sm font-medium text-amber-600">Bronze</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-gray-50 to-gray-100 border-gray-200">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Trophy className="h-5 w-5 text-gray-600" />
              <span className="text-2xl font-bold text-gray-900">
                {badgeStats.silver}
              </span>
            </div>
            <p className="text-sm font-medium text-gray-600">Silver</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Crown className="h-5 w-5 text-yellow-600" />
              <span className="text-2xl font-bold text-yellow-900">
                {badgeStats.gold}
              </span>
            </div>
            <p className="text-sm font-medium text-yellow-600">Gold</p>
          </CardContent>
        </Card>
      </div>

      {/* Featured Badges */}
      {featuredBadges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-yellow-500" />
              Featured Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {featuredBadges.map((userBadge) => {
                const tier = getBadgeTier(userBadge.badge.name)
                return (
                  <div
                    key={userBadge.id}
                    className="flex flex-col items-center p-6 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg border border-yellow-200"
                  >
                    <div className="relative mb-4">
                      <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Image
                          src={userBadge.badge.imageUrl || '/images/badge-placeholder.png'}
                          alt={userBadge.badge.name}
                          width={32}
                          height={32}
                          className="text-white"
                        />
                      </div>
                      <div className="absolute -top-1 -right-1">
                        <Badge variant={getTierBadgeVariant(tier)} className="text-xs px-2">
                          {getTierIcon(tier)}
                        </Badge>
                      </div>
                    </div>
                    
                    <h3 className="font-semibold text-center text-gray-900 mb-2">
                      {userBadge.badge.name}
                    </h3>
                    
                    <p className="text-sm text-gray-600 text-center mb-3">
                      {userBadge.badge.description}
                    </p>
                    
                    <p className="text-xs text-gray-500">
                      Earned {formatDate(userBadge.earnedAt)}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Badges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-blue-500" />
            Recent Achievements
            {badgeStats.recent > 0 && (
              <Badge variant="success" className="text-xs">
                {badgeStats.recent} new
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentBadges.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {recentBadges.map((userBadge) => {
                const tier = getBadgeTier(userBadge.badge.name)
                return (
                  <div
                    key={userBadge.id}
                    className="flex flex-col items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer group"
                  >
                    <div className="relative mb-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        tier === 'gold' ? 'bg-yellow-500' : 
                        tier === 'silver' ? 'bg-gray-400' : 'bg-amber-600'
                      }`}>
                        {getBadgeIcon(userBadge.badge.criteria.type)}
                      </div>
                      <div className="absolute -top-1 -right-1">
                        <Badge variant={getTierBadgeVariant(tier)} className="text-xs p-1">
                          {getTierIcon(tier)}
                        </Badge>
                      </div>
                    </div>
                    
                    <h4 className="font-medium text-center text-gray-900 text-sm mb-1 group-hover:text-blue-600 transition-colors">
                      {userBadge.badge.name}
                    </h4>
                    
                    <p className="text-xs text-gray-500">
                      {formatDate(userBadge.earnedAt)}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Award className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium mb-2">No badges earned yet</p>
              <p className="text-sm">
                Complete courses and quizzes to earn your first badges!
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Badges */}
      {userBadges.length > 6 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-purple-500" />
              All Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {userBadges.slice(6).map((userBadge) => {
                const tier = getBadgeTier(userBadge.badge.name)
                return (
                  <div
                    key={userBadge.id}
                    className="flex flex-col items-center p-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group"
                    title={`${userBadge.badge.name} - ${formatDate(userBadge.earnedAt)}`}
                  >
                    <div className="relative">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tier === 'gold' ? 'bg-yellow-500' : 
                        tier === 'silver' ? 'bg-gray-400' : 'bg-amber-600'
                      }`}>
                        {getBadgeIcon(userBadge.badge.criteria.type)}
                      </div>
                      <div className="absolute -top-0.5 -right-0.5">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                          tier === 'gold' ? 'bg-yellow-400' : 
                          tier === 'silver' ? 'bg-gray-300' : 'bg-amber-500'
                        }`}>
                          {getTierIcon(tier)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default BadgeShowcase;