"use client"

import React from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { BookOpen, Code, Database, Globe, Palette, Users, Zap, Brain } from 'lucide-react'

interface TopicTile {
  id: string
  name: string
  description: string
  courseCount: number
  icon: React.ReactNode
  color: string
  bgColor: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedTime: string
}

const topicTiles: TopicTile[] = [
  {
    id: '1',
    name: 'Web Development',
    description: 'Learn modern web technologies including React, Next.js, and TypeScript',
    courseCount: 12,
    icon: <Globe className="h-8 w-8" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    difficulty: 'intermediate',
    estimatedTime: '40 hours'
  },
  {
    id: '2',
    name: 'Programming Fundamentals',
    description: 'Master the basics of programming with Python, JavaScript, and algorithms',
    courseCount: 8,
    icon: <Code className="h-8 w-8" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    difficulty: 'beginner',
    estimatedTime: '30 hours'
  },
  {
    id: '3',
    name: 'Data Science & AI',
    description: 'Explore machine learning, data analysis, and artificial intelligence',
    courseCount: 15,
    icon: <Brain className="h-8 w-8" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    difficulty: 'advanced',
    estimatedTime: '60 hours'
  },
  {
    id: '4',
    name: 'Database Management',
    description: 'Learn SQL, NoSQL, and database design principles',
    courseCount: 6,
    icon: <Database className="h-8 w-8" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    difficulty: 'intermediate',
    estimatedTime: '25 hours'
  },
  {
    id: '5',
    name: 'UI/UX Design',
    description: 'Master user interface design and user experience principles',
    courseCount: 10,
    icon: <Palette className="h-8 w-8" />,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50',
    difficulty: 'beginner',
    estimatedTime: '35 hours'
  },
  {
    id: '6',
    name: 'Project Management',
    description: 'Learn Agile, Scrum, and modern project management methodologies',
    courseCount: 7,
    icon: <Users className="h-8 w-8" />,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    difficulty: 'intermediate',
    estimatedTime: '20 hours'
  },
  {
    id: '7',
    name: 'DevOps & Cloud',
    description: 'Master AWS, Docker, Kubernetes, and DevOps best practices',
    courseCount: 9,
    icon: <Zap className="h-8 w-8" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    difficulty: 'advanced',
    estimatedTime: '45 hours'
  },
  {
    id: '8',
    name: 'Soft Skills',
    description: 'Develop communication, leadership, and professional skills',
    courseCount: 5,
    icon: <BookOpen className="h-8 w-8" />,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: 'beginner',
    estimatedTime: '15 hours'
  }
]

const getDifficultyBadgeVariant = (difficulty: string) => {
  switch (difficulty) {
    case 'beginner':
      return 'success'
    case 'intermediate':
      return 'warning'
    case 'advanced':
      return 'destructive'
    default:
      return 'default'
  }
}

export function TopicTiles() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {topicTiles.map((topic) => (
        <Link key={topic.id} href={`/learn/topics/${topic.id}`}>
          <Card className="group hover:shadow-lg transition-all duration-300 cursor-pointer border-0 bg-white overflow-hidden h-full">
            <div className={`${topic.bgColor} p-6 h-full flex flex-col justify-between`}>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className={`${topic.color} p-2 rounded-lg bg-white/80`}>
                    {topic.icon}
                  </div>
                  <Badge variant={getDifficultyBadgeVariant(topic.difficulty)} className="text-xs">
                    {topic.difficulty}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-gray-700 transition-colors">
                  {topic.name}
                </h3>
                
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {topic.description}
                </p>
              </div>
              
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <BookOpen className="h-4 w-4" />
                  {topic.courseCount} courses
                </span>
                <span>{topic.estimatedTime}</span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}

export default TopicTiles;