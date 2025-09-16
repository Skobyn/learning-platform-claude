'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bell,
  MessageSquare,
  Users,
  BookOpen,
  Award,
  Calendar,
  FileText,
  ThumbsUp,
  Star,
  Clock,
  User,
  CheckCircle,
  TrendingUp,
  Activity,
  Filter,
  RefreshCw,
  Settings,
  Eye,
  EyeOff,
} from 'lucide-react';

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  actionUrl?: string;
  metadata: Record<string, any>;
  actor: {
    id: string;
    name: string;
    avatar?: string;
    role: string;
  };
  isRead: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  createdAt: string;
}

type ActivityType =
  | 'DISCUSSION_CREATED'
  | 'DISCUSSION_REPLY'
  | 'STUDY_GROUP_JOINED'
  | 'STUDY_SESSION_SCHEDULED'
  | 'BADGE_EARNED'
  | 'COURSE_COMPLETED'
  | 'ASSIGNMENT_SUBMITTED'
  | 'PEER_REVIEW_COMPLETED'
  | 'INSTRUCTOR_MESSAGE'
  | 'COLLABORATION_INVITE'
  | 'RESOURCE_SHARED'
  | 'ANSWER_ACCEPTED'
  | 'CONTENT_LIKED'
  | 'MILESTONE_REACHED';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  priority: string;
  createdAt: string;
  actionUrl?: string;
}

interface ActivityFeedProps {
  userId?: string;
  showNotifications?: boolean;
  maxItems?: number;
  realTime?: boolean;
}

export default function ActivityFeed({
  userId,
  showNotifications = true,
  maxItems = 20,
  realTime = true,
}: ActivityFeedProps) {
  const { data: session } = useSession();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [filterType, setFilterType] = useState<ActivityType | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadActivities = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: maxItems.toString(),
        ...(filterType !== 'all' && { type: filterType }),
        ...(unreadOnly && { unreadOnly: 'true' }),
        ...(userId && { userId }),
      });

      const response = await fetch(`/api/social/activities?${params}`);
      if (response.ok) {
        const data = await response.json();
        setActivities(data.activities);
      }
    } catch (error) {
      console.error('Error loading activities:', error);
    }
  }, [maxItems, filterType, unreadOnly, userId]);

  const loadNotifications = useCallback(async () => {
    if (!showNotifications || !session?.user) return;

    try {
      const response = await fetch('/api/social/notifications');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  }, [showNotifications, session?.user]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        loadActivities(),
        loadNotifications(),
      ]);
      setLoading(false);
    };

    loadData();
  }, [loadActivities, loadNotifications]);

  // Real-time updates using WebSocket
  useEffect(() => {
    if (!realTime || !session?.user) return;

    const ws = new WebSocket(`${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}/notifications`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'notification:new':
          setNotifications(prev => [data.data, ...prev]);
          setUnreadCount(prev => prev + 1);
          break;
        case 'notification:read':
          setNotifications(prev =>
            prev.map(n =>
              n.id === data.data.notificationId
                ? { ...n, isRead: true }
                : n
            )
          );
          setUnreadCount(data.data.unreadCount);
          break;
        case 'activity:new':
          setActivities(prev => [data.data, ...prev.slice(0, maxItems - 1)]);
          break;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [realTime, session?.user, maxItems]);

  const handleMarkNotificationRead = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/social/notifications/${notificationId}/read`, {
        method: 'POST',
      });

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n =>
            n.id === notificationId
              ? { ...n, isRead: true }
              : n
          )
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const response = await fetch('/api/social/notifications/read-all', {
        method: 'POST',
      });

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n => ({ ...n, isRead: true }))
        );
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'DISCUSSION_CREATED':
      case 'DISCUSSION_REPLY':
        return <MessageSquare className="w-5 h-5 text-blue-500" />;
      case 'STUDY_GROUP_JOINED':
        return <Users className="w-5 h-5 text-green-500" />;
      case 'STUDY_SESSION_SCHEDULED':
        return <Calendar className="w-5 h-5 text-purple-500" />;
      case 'BADGE_EARNED':
        return <Award className="w-5 h-5 text-yellow-500" />;
      case 'COURSE_COMPLETED':
        return <BookOpen className="w-5 h-5 text-indigo-500" />;
      case 'ASSIGNMENT_SUBMITTED':
        return <FileText className="w-5 h-5 text-orange-500" />;
      case 'PEER_REVIEW_COMPLETED':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'INSTRUCTOR_MESSAGE':
        return <Bell className="w-5 h-5 text-red-500" />;
      case 'RESOURCE_SHARED':
        return <FileText className="w-5 h-5 text-teal-500" />;
      case 'ANSWER_ACCEPTED':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'CONTENT_LIKED':
        return <ThumbsUp className="w-5 h-5 text-pink-500" />;
      case 'MILESTONE_REACHED':
        return <TrendingUp className="w-5 h-5 text-emerald-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-100 border-red-200 text-red-800';
      case 'HIGH':
        return 'bg-orange-100 border-orange-200 text-orange-800';
      case 'MEDIUM':
        return 'bg-blue-100 border-blue-200 text-blue-800';
      default:
        return 'bg-gray-100 border-gray-200 text-gray-800';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const renderActivityItem = (activity: ActivityItem) => (
    <Card key={activity.id} className={`mb-3 ${!activity.isRead ? 'border-l-4 border-l-blue-500' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0 mt-1">
            {getActivityIcon(activity.type)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-900 mb-1">
                  {activity.title}
                </h4>
                <p className="text-sm text-gray-600 mb-2">
                  {activity.description}
                </p>

                <div className="flex items-center space-x-4 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <img
                      src={activity.actor.avatar || '/default-avatar.png'}
                      alt={activity.actor.name}
                      className="w-4 h-4 rounded-full"
                    />
                    <span>{activity.actor.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimeAgo(activity.createdAt)}</span>
                  </div>
                  {activity.priority !== 'LOW' && (
                    <Badge className={`text-xs ${getPriorityColor(activity.priority)}`}>
                      {activity.priority}
                    </Badge>
                  )}
                </div>
              </div>

              {activity.actionUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-3"
                  asChild
                >
                  <a href={activity.actionUrl}>
                    View
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderNotificationItem = (notification: NotificationItem) => (
    <Card
      key={notification.id}
      className={`mb-3 cursor-pointer transition-colors ${
        !notification.isRead
          ? 'border-l-4 border-l-blue-500 bg-blue-50'
          : 'hover:bg-gray-50'
      }`}
      onClick={() => {
        if (!notification.isRead) {
          handleMarkNotificationRead(notification.id);
        }
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className={`text-sm font-medium mb-1 ${
              !notification.isRead ? 'text-blue-900' : 'text-gray-900'
            }`}>
              {notification.title}
            </h4>
            <p className="text-sm text-gray-600 mb-2">
              {notification.message}
            </p>

            <div className="flex items-center space-x-4 text-xs text-gray-500">
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{formatTimeAgo(notification.createdAt)}</span>
              </div>
              {notification.priority !== 'LOW' && (
                <Badge className={`text-xs ${getPriorityColor(notification.priority)}`}>
                  {notification.priority}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 ml-3">
            {!notification.isRead && (
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-lg">Loading activity feed...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Activity Feed</h2>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadActivities();
              loadNotifications();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All Activity</TabsTrigger>
          <TabsTrigger value="notifications" className="relative">
            Notifications
            {unreadCount > 0 && (
              <Badge className="ml-2 bg-red-500 text-white text-xs px-1 py-0">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
        </TabsList>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="px-3 py-1 border rounded-lg text-sm"
                >
                  <option value="all">All Types</option>
                  <option value="DISCUSSION_CREATED">Discussions</option>
                  <option value="STUDY_GROUP_JOINED">Study Groups</option>
                  <option value="BADGE_EARNED">Achievements</option>
                  <option value="COURSE_COMPLETED">Course Progress</option>
                  <option value="INSTRUCTOR_MESSAGE">Messages</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="unreadOnly"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="unreadOnly" className="text-sm">
                  Unread only
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="all" className="space-y-4">
          {activities.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No recent activity</h3>
                <p className="text-gray-500">Activity from your courses and groups will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {activities.map(renderActivityItem)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Notifications
              {unreadCount > 0 && (
                <Badge className="ml-2 bg-red-500 text-white">
                  {unreadCount}
                </Badge>
              )}
            </h3>
            {unreadCount > 0 && (
              <Button size="sm" variant="outline" onClick={handleMarkAllRead}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Mark All Read
              </Button>
            )}
          </div>

          {notifications.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Bell className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No notifications</h3>
                <p className="text-gray-500">You're all caught up! New notifications will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notifications.map(renderNotificationItem)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="social" className="space-y-4">
          {activities
            .filter(activity =>
              ['DISCUSSION_CREATED', 'DISCUSSION_REPLY', 'STUDY_GROUP_JOINED', 'CONTENT_LIKED'].includes(activity.type)
            )
            .length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No social activity</h3>
                <p className="text-gray-500">Join discussions and study groups to see social activity here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {activities
                .filter(activity =>
                  ['DISCUSSION_CREATED', 'DISCUSSION_REPLY', 'STUDY_GROUP_JOINED', 'CONTENT_LIKED'].includes(activity.type)
                )
                .map(renderActivityItem)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}