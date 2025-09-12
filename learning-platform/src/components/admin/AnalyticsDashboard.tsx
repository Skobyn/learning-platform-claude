'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Chart } from '@/components/ui/Chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Users,
  BookOpen,
  Clock,
  DollarSign,
  Target,
  Award,
  Activity,
  Calendar,
  Download,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  MousePointer,
  PlayCircle,
  CheckCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';

interface AnalyticsMetric {
  label: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  icon: React.ReactNode;
  color: string;
}

interface CoursePerformance {
  courseId: string;
  title: string;
  enrollments: number;
  completions: number;
  avgRating: number;
  avgCompletionTime: number;
  revenue: number;
  completionRate: number;
}

interface LearnerEngagement {
  month: string;
  activeUsers: number;
  newEnrollments: number;
  completedCourses: number;
  avgSessionTime: number;
}

interface RevenueData {
  month: string;
  revenue: number;
  subscriptions: number;
  oneTime: number;
}

export function AnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState('30d');
  const [loading, setLoading] = useState(false);

  // Mock data - in real app, this would come from API
  const metrics: AnalyticsMetric[] = [
    {
      label: 'Total Revenue',
      value: '$45,670',
      change: 12.5,
      trend: 'up',
      icon: <DollarSign className="h-5 w-5" />,
      color: 'text-green-600'
    },
    {
      label: 'Active Learners',
      value: '1,234',
      change: 8.2,
      trend: 'up',
      icon: <Users className="h-5 w-5" />,
      color: 'text-blue-600'
    },
    {
      label: 'Course Completions',
      value: '567',
      change: -3.1,
      trend: 'down',
      icon: <CheckCircle className="h-5 w-5" />,
      color: 'text-purple-600'
    },
    {
      label: 'Avg. Completion Rate',
      value: '73.5%',
      change: 2.8,
      trend: 'up',
      icon: <Target className="h-5 w-5" />,
      color: 'text-orange-600'
    },
    {
      label: 'New Enrollments',
      value: '892',
      change: 15.7,
      trend: 'up',
      icon: <BookOpen className="h-5 w-5" />,
      color: 'text-indigo-600'
    },
    {
      label: 'Avg. Session Time',
      value: '42 min',
      change: -5.2,
      trend: 'down',
      icon: <Clock className="h-5 w-5" />,
      color: 'text-yellow-600'
    }
  ];

  const coursePerformanceData: CoursePerformance[] = [
    {
      courseId: '1',
      title: 'Advanced React Development',
      enrollments: 245,
      completions: 198,
      avgRating: 4.8,
      avgCompletionTime: 180,
      revenue: 12250,
      completionRate: 80.8
    },
    {
      courseId: '2',
      title: 'Python for Data Science',
      enrollments: 189,
      completions: 142,
      avgRating: 4.6,
      avgCompletionTime: 220,
      revenue: 9450,
      completionRate: 75.1
    },
    {
      courseId: '3',
      title: 'Machine Learning Fundamentals',
      enrollments: 156,
      completions: 89,
      avgRating: 4.4,
      avgCompletionTime: 280,
      revenue: 7800,
      completionRate: 57.1
    },
    {
      courseId: '4',
      title: 'DevOps Essentials',
      enrollments: 134,
      completions: 108,
      avgRating: 4.7,
      avgCompletionTime: 160,
      revenue: 6700,
      completionRate: 80.6
    },
    {
      courseId: '5',
      title: 'UI/UX Design Principles',
      enrollments: 112,
      completions: 95,
      avgRating: 4.9,
      avgCompletionTime: 140,
      revenue: 5600,
      completionRate: 84.8
    }
  ];

  const engagementData: LearnerEngagement[] = [
    { month: 'Jan', activeUsers: 850, newEnrollments: 120, completedCourses: 89, avgSessionTime: 45 },
    { month: 'Feb', activeUsers: 920, newEnrollments: 145, completedCourses: 102, avgSessionTime: 48 },
    { month: 'Mar', activeUsers: 1050, newEnrollments: 178, completedCourses: 134, avgSessionTime: 52 },
    { month: 'Apr', activeUsers: 1180, newEnrollments: 203, completedCourses: 167, avgSessionTime: 49 },
    { month: 'May', activeUsers: 1250, newEnrollments: 234, completedCourses: 198, avgSessionTime: 44 },
    { month: 'Jun', activeUsers: 1234, newEnrollments: 189, completedCourses: 156, avgSessionTime: 42 }
  ];

  const revenueData: RevenueData[] = [
    { month: 'Jan', revenue: 32500, subscriptions: 28500, oneTime: 4000 },
    { month: 'Feb', revenue: 35200, subscriptions: 31000, oneTime: 4200 },
    { month: 'Mar', revenue: 38900, subscriptions: 34200, oneTime: 4700 },
    { month: 'Apr', revenue: 42100, subscriptions: 37800, oneTime: 4300 },
    { month: 'May', revenue: 44800, subscriptions: 40200, oneTime: 4600 },
    { month: 'Jun', revenue: 45670, subscriptions: 41200, oneTime: 4470 }
  ];

  const topCategories = [
    { name: 'Development', courses: 45, enrollments: 1234, completionRate: 78.5 },
    { name: 'Data Science', courses: 28, enrollments: 897, completionRate: 72.1 },
    { name: 'Design', courses: 23, enrollments: 654, completionRate: 83.2 },
    { name: 'DevOps', courses: 18, enrollments: 432, completionRate: 76.8 },
    { name: 'Marketing', courses: 15, enrollments: 321, completionRate: 68.9 }
  ];

  const learnerJourney = [
    { stage: 'Discovery', users: 2500, conversion: 100 },
    { stage: 'Course View', users: 1875, conversion: 75 },
    { stage: 'Enrollment', users: 1125, conversion: 45 },
    { stage: 'Started', users: 900, conversion: 36 },
    { stage: '50% Complete', users: 630, conversion: 25.2 },
    { stage: 'Completed', users: 450, conversion: 18 }
  ];

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <ArrowUpRight className="h-4 w-4 text-green-500" />;
      case 'down':
        return <ArrowDownRight className="h-4 w-4 text-red-500" />;
      default:
        return <div className="h-4 w-4" />;
    }
  };

  const getTrendColor = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      // TODO: Implement API call to refresh analytics data
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Failed to refresh analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    // TODO: Implement comprehensive analytics report export
    console.log('Exporting analytics report for:', timeRange);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h2>
          <p className="text-gray-600 mt-1">
            Track performance, engagement, and revenue metrics
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={refreshData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={exportReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {metrics.map((metric, index) => (
          <Card key={index}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{metric.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{metric.value}</p>
                  <div className="flex items-center mt-2 space-x-1">
                    {getTrendIcon(metric.trend)}
                    <span className={`text-sm font-medium ${getTrendColor(metric.trend)}`}>
                      {Math.abs(metric.change)}%
                    </span>
                    <span className="text-sm text-gray-500">vs last period</span>
                  </div>
                </div>
                <div className={`p-3 rounded-full bg-gray-100 ${metric.color}`}>
                  {metric.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="courses">Course Performance</TabsTrigger>
          <TabsTrigger value="engagement">User Engagement</TabsTrigger>
          <TabsTrigger value="revenue">Revenue Analysis</TabsTrigger>
          <TabsTrigger value="funnel">Conversion Funnel</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Growth */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2" />
                  User Growth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Chart
                  type="area"
                  data={engagementData}
                  xKey="month"
                  yKey="activeUsers"
                  className="h-64"
                />
              </CardContent>
            </Card>

            {/* Completion Rates by Category */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Target className="h-5 w-5 mr-2" />
                  Category Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {topCategories.map((category, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium">{category.name}</p>
                          <span className="text-sm text-gray-500">
                            {category.completionRate}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${category.completionRate}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-500">
                            {category.courses} courses
                          </span>
                          <span className="text-xs text-gray-500">
                            {category.enrollments} enrollments
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Activity className="h-5 w-5 mr-2" />
                Platform Activity (Last 7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="p-3 bg-blue-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                    <Eye className="h-6 w-6 text-blue-600" />
                  </div>
                  <p className="text-2xl font-bold">12,456</p>
                  <p className="text-sm text-gray-500">Page Views</p>
                </div>
                <div className="text-center">
                  <div className="p-3 bg-green-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                    <PlayCircle className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="text-2xl font-bold">3,241</p>
                  <p className="text-sm text-gray-500">Video Plays</p>
                </div>
                <div className="text-center">
                  <div className="p-3 bg-purple-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="h-6 w-6 text-purple-600" />
                  </div>
                  <p className="text-2xl font-bold">789</p>
                  <p className="text-sm text-gray-500">Assessments</p>
                </div>
                <div className="text-center">
                  <div className="p-3 bg-orange-100 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                    <Award className="h-6 w-6 text-orange-600" />
                  </div>
                  <p className="text-2xl font-bold">234</p>
                  <p className="text-sm text-gray-500">Certificates</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Top Performing Courses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">Course Title</th>
                      <th className="text-center py-3 px-4">Enrollments</th>
                      <th className="text-center py-3 px-4">Completions</th>
                      <th className="text-center py-3 px-4">Completion Rate</th>
                      <th className="text-center py-3 px-4">Avg Rating</th>
                      <th className="text-center py-3 px-4">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coursePerformanceData.map((course) => (
                      <tr key={course.courseId} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium">{course.title}</td>
                        <td className="py-3 px-4 text-center">{course.enrollments}</td>
                        <td className="py-3 px-4 text-center">{course.completions}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge className={
                            course.completionRate >= 80 ? 'bg-green-100 text-green-800' :
                            course.completionRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }>
                            {course.completionRate.toFixed(1)}%
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center">
                            <span>{course.avgRating.toFixed(1)}</span>
                            <span className="text-yellow-400 ml-1">★</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-medium">
                          ${course.revenue.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engagement" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Enrollments</CardTitle>
              </CardHeader>
              <CardContent>
                <Chart
                  type="bar"
                  data={engagementData}
                  xKey="month"
                  yKey="newEnrollments"
                  className="h-64"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Average Session Time</CardTitle>
              </CardHeader>
              <CardContent>
                <Chart
                  type="line"
                  data={engagementData}
                  xKey="month"
                  yKey="avgSessionTime"
                  className="h-64"
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User Engagement Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <Chart
                type="line"
                data={engagementData}
                xKey="month"
                yKey="activeUsers"
                className="h-80"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Monthly Revenue</p>
                    <p className="text-3xl font-bold text-gray-900">$45,670</p>
                    <p className="text-sm text-green-600 mt-1">+12.5% from last month</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">ARPU (Monthly)</p>
                    <p className="text-3xl font-bold text-gray-900">$37</p>
                    <p className="text-sm text-green-600 mt-1">+8.3% from last month</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Course Sales</p>
                    <p className="text-3xl font-bold text-gray-900">234</p>
                    <p className="text-sm text-green-600 mt-1">+15.7% from last month</p>
                  </div>
                  <BookOpen className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Chart
                type="bar"
                data={revenueData}
                xKey="month"
                yKey="subscriptions"
                className="h-64"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Zap className="h-5 w-5 mr-2" />
                Learning Journey Conversion Funnel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {learnerJourney.map((stage, index) => {
                  const isLast = index === learnerJourney.length - 1;
                  const width = (stage.users / (learnerJourney[0]?.users || 1)) * 100;
                  
                  return (
                    <div key={stage.stage} className="relative">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{stage.stage}</span>
                        <div className="flex items-center space-x-4">
                          <span className="text-sm text-gray-500">
                            {stage.users.toLocaleString()} users
                          </span>
                          <span className="text-sm font-medium">
                            {stage.conversion}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 rounded h-8 relative">
                        <div
                          className={`h-8 rounded flex items-center justify-center text-white text-sm font-medium ${
                            index === 0 ? 'bg-blue-600' :
                            index === 1 ? 'bg-blue-500' :
                            index === 2 ? 'bg-purple-500' :
                            index === 3 ? 'bg-purple-600' :
                            index === 4 ? 'bg-green-500' :
                            'bg-green-600'
                          }`}
                          style={{ width: `${width}%` }}
                        >
                          {stage.users.toLocaleString()}
                        </div>
                      </div>
                      {!isLast && (
                        <div className="flex justify-center mt-2">
                          <div className="text-xs text-gray-500">
                            {((learnerJourney[index + 1]?.users || 0) / stage.users * 100).toFixed(1)}% conversion
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Drop-off Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-red-50 rounded">
                    <div>
                      <p className="font-medium text-red-800">Course View → Enrollment</p>
                      <p className="text-sm text-red-600">Highest drop-off point</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-red-800">40%</p>
                      <p className="text-sm text-red-600">drop-off rate</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-yellow-50 rounded">
                    <div>
                      <p className="font-medium text-yellow-800">Started → 50% Complete</p>
                      <p className="text-sm text-yellow-600">Second highest drop-off</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-yellow-800">30%</p>
                      <p className="text-sm text-yellow-600">drop-off rate</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Optimization Opportunities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Improve Course Previews</p>
                      <p className="text-sm text-gray-600">
                        40% drop-off from view to enrollment suggests preview content needs improvement
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Mid-Course Engagement</p>
                      <p className="text-sm text-gray-600">
                        Add interactive elements at 25-50% completion to reduce mid-course abandonment
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium">Onboarding Flow</p>
                      <p className="text-sm text-gray-600">
                        Streamline enrollment process to reduce friction
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}