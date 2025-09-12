'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Users, BookOpen, PlayCircle, TrendingUp, 
  AlertTriangle, Clock, CheckCircle, Settings,
  BarChart3, PieChart, Calendar, FileText
} from 'lucide-react';
import { Chart } from '@/components/ui/Chart';
import { DataTable } from '@/components/ui/DataTable';
import { CourseBuilder } from '@/components/admin/CourseBuilder';
import { UserManagement } from '@/components/admin/UserManagement';
import { AnalyticsDashboard } from '@/components/admin/AnalyticsDashboard';
import { MediaManager } from '@/components/admin/MediaManager';
import { QuizBuilder } from '@/components/admin/QuizBuilder';
import { ReportGenerator } from '@/components/admin/ReportGenerator';
import { BulkImport } from '@/components/admin/BulkImport';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalCourses: number;
  publishedCourses: number;
  totalEnrollments: number;
  completionRate: number;
  avgCourseRating: number;
  revenueThisMonth: number;
}

interface RecentActivity {
  id: string;
  type: 'enrollment' | 'completion' | 'course_created' | 'user_registered';
  user: string;
  course?: string;
  timestamp: Date;
  status: 'success' | 'warning' | 'error';
}

interface AlertItem {
  id: string;
  type: 'system' | 'content' | 'user';
  message: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: Date;
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 1234,
    activeUsers: 890,
    totalCourses: 156,
    publishedCourses: 134,
    totalEnrollments: 5678,
    completionRate: 73.5,
    avgCourseRating: 4.2,
    revenueThisMonth: 45670
  });

  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([
    {
      id: '1',
      type: 'enrollment',
      user: 'John Doe',
      course: 'Advanced React Development',
      timestamp: new Date(Date.now() - 1000 * 60 * 30),
      status: 'success'
    },
    {
      id: '2',
      type: 'completion',
      user: 'Sarah Wilson',
      course: 'Data Science Fundamentals',
      timestamp: new Date(Date.now() - 1000 * 60 * 45),
      status: 'success'
    },
    {
      id: '3',
      type: 'course_created',
      user: 'Mike Johnson',
      course: 'Machine Learning Basics',
      timestamp: new Date(Date.now() - 1000 * 60 * 60),
      status: 'success'
    }
  ]);

  const [alerts, setAlerts] = useState<AlertItem[]>([
    {
      id: '1',
      type: 'system',
      message: 'Server response time is above normal (850ms avg)',
      severity: 'medium',
      timestamp: new Date(Date.now() - 1000 * 60 * 15)
    },
    {
      id: '2',
      type: 'content',
      message: '3 courses pending approval for publication',
      severity: 'low',
      timestamp: new Date(Date.now() - 1000 * 60 * 30)
    }
  ]);

  const userGrowthData = [
    { month: 'Jan', users: 800 },
    { month: 'Feb', users: 950 },
    { month: 'Mar', users: 1100 },
    { month: 'Apr', users: 1200 },
    { month: 'May', users: 1300 },
    { month: 'Jun', users: 1234 }
  ];

  const courseCompletionData = [
    { course: 'React Basics', completed: 85, enrolled: 100 },
    { course: 'Node.js API', completed: 72, enrolled: 95 },
    { course: 'Python Data Science', completed: 91, enrolled: 120 },
    { course: 'Machine Learning', completed: 68, enrolled: 88 },
    { course: 'DevOps Fundamentals', completed: 76, enrolled: 102 }
  ];

  const formatActivityTime = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return timestamp.toLocaleDateString();
  };

  const getActivityIcon = (type: RecentActivity['type']) => {
    switch (type) {
      case 'enrollment': return <BookOpen className="h-4 w-4" />;
      case 'completion': return <CheckCircle className="h-4 w-4" />;
      case 'course_created': return <PlayCircle className="h-4 w-4" />;
      case 'user_registered': return <Users className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getAlertColor = (severity: AlertItem['severity']) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-1">Manage your learning platform</p>
          </div>
          <div className="flex space-x-4">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-2" />
              Export Data
            </Button>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button size="sm">
              <Calendar className="h-4 w-4 mr-2" />
              Schedule Report
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-8 lg:w-auto lg:inline-flex">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="courses">Courses</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="quizzes">Quizzes</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Users</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.totalUsers.toLocaleString()}</p>
                      <p className="text-sm text-green-600 mt-1">
                        +{stats.activeUsers} active this month
                      </p>
                    </div>
                    <div className="p-3 bg-blue-100 rounded-full">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Published Courses</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.publishedCourses}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        {stats.totalCourses} total courses
                      </p>
                    </div>
                    <div className="p-3 bg-green-100 rounded-full">
                      <BookOpen className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Enrollments</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.totalEnrollments.toLocaleString()}</p>
                      <p className="text-sm text-green-600 mt-1">
                        {stats.completionRate}% completion rate
                      </p>
                    </div>
                    <div className="p-3 bg-purple-100 rounded-full">
                      <TrendingUp className="h-6 w-6 text-purple-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Revenue</p>
                      <p className="text-3xl font-bold text-gray-900">${stats.revenueThisMonth.toLocaleString()}</p>
                      <p className="text-sm text-green-600 mt-1">
                        This month
                      </p>
                    </div>
                    <div className="p-3 bg-yellow-100 rounded-full">
                      <BarChart3 className="h-6 w-6 text-yellow-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts and Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User Growth Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <TrendingUp className="h-5 w-5 mr-2" />
                    User Growth
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Chart 
                    type="line" 
                    data={userGrowthData}
                    xKey="month"
                    yKey="users"
                    className="h-64"
                  />
                </CardContent>
              </Card>

              {/* Course Completion Rates */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <PieChart className="h-5 w-5 mr-2" />
                    Course Completion Rates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {courseCompletionData.map((course) => {
                      const completionPercentage = (course.completed / course.enrolled) * 100;
                      return (
                        <div key={course.course} className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{course.course}</p>
                            <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                              <div 
                                className="bg-blue-600 h-2 rounded-full" 
                                style={{ width: `${completionPercentage}%` }}
                              />
                            </div>
                          </div>
                          <div className="ml-4 text-sm text-gray-500">
                            {course.completed}/{course.enrolled}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity and Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Clock className="h-5 w-5 mr-2" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {recentActivity.map((activity) => (
                      <div key={activity.id} className="flex items-center space-x-3 p-3 rounded-lg bg-gray-50">
                        <div className={`p-2 rounded-full ${
                          activity.status === 'success' ? 'bg-green-100 text-green-600' :
                          activity.status === 'warning' ? 'bg-yellow-100 text-yellow-600' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {activity.user} 
                            {activity.type === 'enrollment' && ' enrolled in'}
                            {activity.type === 'completion' && ' completed'}
                            {activity.type === 'course_created' && ' created'}
                            {activity.type === 'user_registered' && ' registered'}
                            {activity.course && ` ${activity.course}`}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatActivityTime(activity.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full mt-4">
                    View All Activity
                  </Button>
                </CardContent>
              </Card>

              {/* System Alerts */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <AlertTriangle className="h-5 w-5 mr-2" />
                    System Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {alerts.map((alert) => (
                      <div key={alert.id} className={`p-3 rounded-lg border ${getAlertColor(alert.severity)}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{alert.message}</p>
                            <p className="text-xs mt-1 opacity-75">
                              {formatActivityTime(alert.timestamp)} • {alert.type}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {alert.severity}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full mt-4">
                    View All Alerts
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Other Tabs */}
          <TabsContent value="courses">
            <CourseBuilder />
          </TabsContent>

          <TabsContent value="users">
            <UserManagement />
          </TabsContent>

          <TabsContent value="analytics">
            <AnalyticsDashboard />
          </TabsContent>

          <TabsContent value="media">
            <MediaManager />
          </TabsContent>

          <TabsContent value="quizzes">
            <QuizBuilder />
          </TabsContent>

          <TabsContent value="reports">
            <ReportGenerator />
          </TabsContent>

          <TabsContent value="import">
            <BulkImport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}