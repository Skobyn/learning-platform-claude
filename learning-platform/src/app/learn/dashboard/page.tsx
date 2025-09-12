'use client';

import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TopicTiles } from '@/components/learner/TopicTiles';
import { CourseCard } from '@/components/learner/CourseCard';
import { ProgressTracker } from '@/components/learner/ProgressTracker';
import { BadgeShowcase } from '@/components/learner/BadgeShowcase';
import { RecommendedCourses } from '@/components/learner/RecommendedCourses';
import { LearningPath } from '@/components/learner/LearningPath';
import { 
  BookOpen, 
  TrendingUp, 
  Award, 
  Clock, 
  Target,
  ChevronRight,
  PlayCircle,
  Users,
  Star,
  Calendar
} from 'lucide-react';

// Loading components
const DashboardSkeleton = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
    <div className="container mx-auto px-4 py-8">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-300 rounded-md w-1/3 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded-md w-2/3 mb-8"></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg p-6 h-48"></div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// Sample data - replace with real API calls
const mockUser = {
  name: 'Alex Johnson',
  role: 'Senior Developer',
  avatar: '/api/placeholder/64/64',
  totalCourses: 24,
  completedCourses: 18,
  totalHours: 156,
  currentStreak: 7,
  level: 'Advanced',
  xp: 2450
};

const recentActivity = [
  {
    id: 1,
    type: 'course_completed',
    title: 'Advanced React Patterns',
    timestamp: '2 hours ago',
    icon: Award,
    color: 'text-green-600'
  },
  {
    id: 2,
    type: 'badge_earned',
    title: 'JavaScript Expert Badge',
    timestamp: '1 day ago',
    icon: Star,
    color: 'text-yellow-600'
  },
  {
    id: 3,
    type: 'course_started',
    title: 'GraphQL Fundamentals',
    timestamp: '3 days ago',
    icon: PlayCircle,
    color: 'text-blue-600'
  }
];

const upcomingDeadlines = [
  {
    id: 1,
    course: 'Cloud Architecture Certification',
    deadline: '2024-09-15',
    daysLeft: 5,
    progress: 78
  },
  {
    id: 2,
    course: 'Machine Learning Basics',
    deadline: '2024-09-20',
    daysLeft: 10,
    progress: 45
  },
  {
    id: 3,
    course: 'DevOps Pipeline Design',
    deadline: '2024-09-25',
    daysLeft: 15,
    progress: 92
  }
];

const DashboardStats = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
    <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium opacity-90">Courses Completed</CardTitle>
          <BookOpen className="h-4 w-4 opacity-90" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{mockUser.completedCourses}</div>
        <p className="text-xs opacity-75">of {mockUser.totalCourses} enrolled</p>
      </CardContent>
    </Card>

    <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white border-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium opacity-90">Learning Hours</CardTitle>
          <Clock className="h-4 w-4 opacity-90" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{mockUser.totalHours}h</div>
        <p className="text-xs opacity-75">This month: +32h</p>
      </CardContent>
    </Card>

    <Card className="bg-gradient-to-r from-purple-500 to-purple-600 text-white border-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium opacity-90">Current Streak</CardTitle>
          <TrendingUp className="h-4 w-4 opacity-90" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{mockUser.currentStreak} days</div>
        <p className="text-xs opacity-75">Personal best: 12 days</p>
      </CardContent>
    </Card>

    <Card className="bg-gradient-to-r from-orange-500 to-orange-600 text-white border-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium opacity-90">Experience Points</CardTitle>
          <Target className="h-4 w-4 opacity-90" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{mockUser.xp.toLocaleString()}</div>
        <p className="text-xs opacity-75">Level: {mockUser.level}</p>
      </CardContent>
    </Card>
  </div>
);

const RecentActivity = () => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Clock className="h-5 w-5" />
        Recent Activity
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {recentActivity.map((activity) => {
          const Icon = activity.icon;
          return (
            <div key={activity.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div className={`p-2 rounded-full bg-white dark:bg-gray-700 ${activity.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{activity.title}</p>
                <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
              </div>
            </div>
          );
        })}
      </div>
    </CardContent>
  </Card>
);

const UpcomingDeadlines = () => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Calendar className="h-5 w-5" />
        Upcoming Deadlines
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {upcomingDeadlines.map((item) => (
          <div key={item.id} className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-medium text-sm">{item.course}</h4>
              <Badge variant={item.daysLeft <= 5 ? 'destructive' : 'secondary'}>
                {item.daysLeft} days left
              </Badge>
            </div>
            <Progress value={item.progress} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">
              {item.progress}% complete • Due {item.deadline}
            </p>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

export default function LearnDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Welcome back, {mockUser.name}! 👋
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-2">
                Continue your learning journey • {mockUser.role}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="px-3 py-1">
                {mockUser.level} Learner
              </Badge>
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                {mockUser.name.split(' ').map(n => n[0]).join('')}
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Stats */}
        <DashboardStats />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column - Main Content */}
          <div className="xl:col-span-2 space-y-8">
            {/* Topic Navigation */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                  Explore Topics
                </h2>
                <button className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors">
                  View all
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Suspense fallback={<DashboardSkeleton />}>
                <TopicTiles />
              </Suspense>
            </section>

            {/* Learning Path */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                  Your Learning Path
                </h2>
                <button className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors">
                  Customize
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Suspense fallback={<div className="h-64 bg-white rounded-lg animate-pulse"></div>}>
                <LearningPath />
              </Suspense>
            </section>

            {/* Recommended Courses */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                  Recommended for You
                </h2>
                <button className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors">
                  See all
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Suspense fallback={<div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="h-48 bg-white rounded-lg animate-pulse"></div><div className="h-48 bg-white rounded-lg animate-pulse"></div></div>}>
                <RecommendedCourses />
              </Suspense>
            </section>
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            {/* Progress Tracker */}
            <Suspense fallback={<div className="h-64 bg-white rounded-lg animate-pulse"></div>}>
              <ProgressTracker />
            </Suspense>

            {/* Badge Showcase */}
            <Suspense fallback={<div className="h-48 bg-white rounded-lg animate-pulse"></div>}>
              <BadgeShowcase />
            </Suspense>

            {/* Recent Activity */}
            <RecentActivity />

            {/* Upcoming Deadlines */}
            <UpcomingDeadlines />
          </div>
        </div>
      </div>
    </div>
  );
}