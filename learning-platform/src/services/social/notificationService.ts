import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { emailService } from '@/services/emailService';
import { WebSocket } from 'ws';

export interface NotificationData {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  isRead: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  channels: NotificationChannel[];
  createdAt: Date;
  readAt?: Date;
}

export type NotificationType =
  | 'DISCUSSION_REPLY'
  | 'STUDY_GROUP_INVITE'
  | 'STUDY_SESSION_SCHEDULED'
  | 'STUDY_SESSION_REMINDER'
  | 'PEER_REVIEW_REQUEST'
  | 'INSTRUCTOR_MESSAGE'
  | 'BADGE_EARNED'
  | 'COURSE_UPDATE'
  | 'ASSIGNMENT_DUE'
  | 'COLLABORATION_REQUEST'
  | 'SYSTEM_ANNOUNCEMENT';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS';

export interface NotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  quietHours: {
    enabled: boolean;
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    timezone: string;
  };
  categoryPreferences: {
    [key in NotificationType]: NotificationChannel[];
  };
}

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  channels?: NotificationChannel[];
  scheduleFor?: Date;
}

export interface BulkNotificationData {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  channels?: NotificationChannel[];
  personalizeTitle?: (userId: string, data: any) => string;
  personalizeMessage?: (userId: string, data: any) => string;
}

class NotificationService {
  private wsConnections = new Map<string, WebSocket>();
  private cachePrefix = 'notification:';
  private cacheTTL = 3600; // 1 hour

  /**
   * Create and send a notification
   */
  async createNotification(data: CreateNotificationData): Promise<NotificationData> {
    try {
      // Get user preferences
      const preferences = await this.getUserPreferences(data.userId);

      // Determine channels based on preferences and notification type
      const channels = data.channels || this.getDefaultChannels(data.type, preferences);

      // Check quiet hours
      if (this.isQuietHours(preferences)) {
        // Only send urgent notifications during quiet hours
        if (data.priority !== 'URGENT') {
          return this.scheduleNotification(data, this.getNextActiveTime(preferences));
        }
      }

      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          entityType: data.entityType,
          entityId: data.entityId,
          actionUrl: data.actionUrl,
          metadata: data.metadata || {},
          priority: data.priority || 'MEDIUM',
          channels,
          isRead: false,
        },
      });

      const notificationData: NotificationData = {
        ...notification,
        metadata: notification.metadata as Record<string, any>,
        channels: notification.channels as NotificationChannel[],
      };

      // Send through various channels
      await this.sendThroughChannels(notificationData, preferences);

      // Clear user's notification cache
      await this.clearUserNotificationCache(data.userId);

      return notificationData;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw new Error('Failed to create notification');
    }
  }

  /**
   * Create bulk notifications for multiple users
   */
  async createBulkNotifications(data: BulkNotificationData): Promise<void> {
    try {
      const notifications = await Promise.all(
        data.userIds.map(async (userId) => {
          const title = data.personalizeTitle ?
            data.personalizeTitle(userId, data.metadata) :
            data.title;

          const message = data.personalizeMessage ?
            data.personalizeMessage(userId, data.metadata) :
            data.message;

          return {
            userId,
            type: data.type,
            title,
            message,
            entityType: data.entityType,
            entityId: data.entityId,
            actionUrl: data.actionUrl,
            metadata: data.metadata || {},
            priority: data.priority || 'MEDIUM',
            channels: data.channels || ['IN_APP'],
            isRead: false,
          };
        })
      );

      // Batch create notifications
      await prisma.notification.createMany({
        data: notifications,
      });

      // Send through channels for each user
      await Promise.all(
        data.userIds.map(async (userId) => {
          const userPreferences = await this.getUserPreferences(userId);
          const userNotification = notifications.find(n => n.userId === userId);

          if (userNotification) {
            await this.sendThroughChannels(userNotification as NotificationData, userPreferences);
          }
        })
      );

      // Clear caches
      await Promise.all(
        data.userIds.map(userId => this.clearUserNotificationCache(userId))
      );
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw new Error('Failed to create bulk notifications');
    }
  }

  /**
   * Get user's notifications with pagination
   */
  async getUserNotifications(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
      types?: NotificationType[];
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    } = {}
  ): Promise<{
    notifications: NotificationData[];
    total: number;
    unreadCount: number;
    hasMore: boolean;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `${this.cachePrefix}user:${userId}:${JSON.stringify(options)}:${page}`;

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const where: any = { userId };

      if (options.unreadOnly) {
        where.isRead = false;
      }

      if (options.types?.length) {
        where.type = { in: options.types };
      }

      if (options.priority) {
        where.priority = options.priority;
      }

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: [
            { priority: 'desc' },
            { createdAt: 'desc' },
          ],
          skip: offset,
          take: limit,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { userId, isRead: false },
        }),
      ]);

      const result = {
        notifications: notifications.map(n => ({
          ...n,
          metadata: n.metadata as Record<string, any>,
          channels: n.channels as NotificationChannel[],
        })),
        total,
        unreadCount,
        hasMore: total > page * limit,
      };

      // Cache for shorter time due to real-time nature
      await redis.setex(cacheKey, 300, JSON.stringify(result));

      return result;
    } catch (error) {
      console.error('Error fetching user notifications:', error);
      throw new Error('Failed to fetch notifications');
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      if (!notification.isRead) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: {
            isRead: true,
            readAt: new Date(),
          },
        });

        await this.clearUserNotificationCache(userId);

        // Send real-time update
        await this.sendRealtimeUpdate(userId, 'notification:read', {
          notificationId,
          unreadCount: await this.getUnreadCount(userId),
        });
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw new Error('Failed to mark notification as read');
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    try {
      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      await this.clearUserNotificationCache(userId);

      // Send real-time update
      await this.sendRealtimeUpdate(userId, 'notification:all_read', {
        unreadCount: 0,
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw new Error('Failed to mark all notifications as read');
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    try {
      const result = await prisma.notification.deleteMany({
        where: { id: notificationId, userId },
      });

      if (result.count === 0) {
        throw new Error('Notification not found');
      }

      await this.clearUserNotificationCache(userId);

      // Send real-time update
      await this.sendRealtimeUpdate(userId, 'notification:deleted', {
        notificationId,
        unreadCount: await this.getUnreadCount(userId),
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw new Error('Failed to delete notification');
    }
  }

  /**
   * Get or create user notification preferences
   */
  async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    const cacheKey = `${this.cachePrefix}preferences:${userId}`;

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      let preferences = await prisma.notificationPreferences.findUnique({
        where: { userId },
      });

      if (!preferences) {
        // Create default preferences
        preferences = await prisma.notificationPreferences.create({
          data: {
            userId,
            emailEnabled: true,
            pushEnabled: true,
            smsEnabled: false,
            quietHours: {
              enabled: false,
              startTime: '22:00',
              endTime: '08:00',
              timezone: 'UTC',
            },
            categoryPreferences: this.getDefaultCategoryPreferences(),
          },
        });
      }

      const result: NotificationPreferences = {
        userId: preferences.userId,
        emailEnabled: preferences.emailEnabled,
        pushEnabled: preferences.pushEnabled,
        smsEnabled: preferences.smsEnabled,
        quietHours: preferences.quietHours as any,
        categoryPreferences: preferences.categoryPreferences as any,
      };

      // Cache for longer time as preferences don't change often
      await redis.setex(cacheKey, 3600, JSON.stringify(result));

      return result;
    } catch (error) {
      console.error('Error getting user preferences:', error);
      throw new Error('Failed to get notification preferences');
    }
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: string,
    updates: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    try {
      const updatedPreferences = await prisma.notificationPreferences.upsert({
        where: { userId },
        update: updates,
        create: {
          userId,
          emailEnabled: updates.emailEnabled ?? true,
          pushEnabled: updates.pushEnabled ?? true,
          smsEnabled: updates.smsEnabled ?? false,
          quietHours: updates.quietHours ?? {
            enabled: false,
            startTime: '22:00',
            endTime: '08:00',
            timezone: 'UTC',
          },
          categoryPreferences: updates.categoryPreferences ?? this.getDefaultCategoryPreferences(),
        },
      });

      // Clear cache
      await redis.del(`${this.cachePrefix}preferences:${userId}`);

      return {
        userId: updatedPreferences.userId,
        emailEnabled: updatedPreferences.emailEnabled,
        pushEnabled: updatedPreferences.pushEnabled,
        smsEnabled: updatedPreferences.smsEnabled,
        quietHours: updatedPreferences.quietHours as any,
        categoryPreferences: updatedPreferences.categoryPreferences as any,
      };
    } catch (error) {
      console.error('Error updating user preferences:', error);
      throw new Error('Failed to update notification preferences');
    }
  }

  /**
   * Register WebSocket connection for real-time notifications
   */
  registerWebSocket(userId: string, ws: WebSocket): void {
    this.wsConnections.set(userId, ws);

    ws.on('close', () => {
      this.wsConnections.delete(userId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.wsConnections.delete(userId);
    });
  }

  /**
   * Send real-time update to user
   */
  private async sendRealtimeUpdate(
    userId: string,
    event: string,
    data: any
  ): Promise<void> {
    const ws = this.wsConnections.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: event,
          data,
          timestamp: new Date().toISOString(),
        }));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        this.wsConnections.delete(userId);
      }
    }
  }

  /**
   * Send notification through configured channels
   */
  private async sendThroughChannels(
    notification: NotificationData,
    preferences: NotificationPreferences
  ): Promise<void> {
    const channelsToUse = notification.channels.filter(channel => {
      // Check if user has enabled this channel globally
      switch (channel) {
        case 'EMAIL':
          return preferences.emailEnabled;
        case 'PUSH':
          return preferences.pushEnabled;
        case 'SMS':
          return preferences.smsEnabled;
        case 'IN_APP':
          return true; // Always enabled
        default:
          return false;
      }
    });

    // Check if this notification type is enabled for these channels
    const typePreferences = preferences.categoryPreferences[notification.type] || ['IN_APP'];
    const finalChannels = channelsToUse.filter(channel =>
      typePreferences.includes(channel)
    );

    await Promise.all([
      // In-app notification (real-time)
      finalChannels.includes('IN_APP') && this.sendInAppNotification(notification),

      // Email notification
      finalChannels.includes('EMAIL') && this.sendEmailNotification(notification),

      // Push notification
      finalChannels.includes('PUSH') && this.sendPushNotification(notification),

      // SMS notification
      finalChannels.includes('SMS') && this.sendSMSNotification(notification),
    ].filter(Boolean));
  }

  private async sendInAppNotification(notification: NotificationData): Promise<void> {
    await this.sendRealtimeUpdate(notification.userId, 'notification:new', notification);
  }

  private async sendEmailNotification(notification: NotificationData): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { email: true, name: true },
      });

      if (user) {
        await emailService.sendNotificationEmail({
          to: user.email,
          userName: user.name,
          title: notification.title,
          message: notification.message,
          actionUrl: notification.actionUrl,
          priority: notification.priority,
        });
      }
    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  }

  private async sendPushNotification(notification: NotificationData): Promise<void> {
    try {
      // TODO: Implement push notification service integration
      console.log('Push notification would be sent:', notification.title);
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  private async sendSMSNotification(notification: NotificationData): Promise<void> {
    try {
      // TODO: Implement SMS service integration
      console.log('SMS notification would be sent:', notification.message);
    } catch (error) {
      console.error('Error sending SMS notification:', error);
    }
  }

  private async scheduleNotification(
    data: CreateNotificationData,
    scheduleFor: Date
  ): Promise<NotificationData> {
    // TODO: Implement job queue for scheduled notifications
    // For now, just create the notification with a future timestamp
    return this.createNotification({
      ...data,
      scheduleFor,
    });
  }

  private isQuietHours(preferences: NotificationPreferences): boolean {
    if (!preferences.quietHours.enabled) return false;

    const now = new Date();
    const timezone = preferences.quietHours.timezone || 'UTC';

    // TODO: Implement proper timezone handling
    const currentTime = now.toTimeString().substring(0, 5); // HH:mm
    const startTime = preferences.quietHours.startTime;
    const endTime = preferences.quietHours.endTime;

    // Simple time comparison (doesn't handle cross-day ranges properly)
    return currentTime >= startTime || currentTime <= endTime;
  }

  private getNextActiveTime(preferences: NotificationPreferences): Date {
    // TODO: Implement proper next active time calculation
    const now = new Date();
    now.setHours(8, 0, 0, 0); // Default to 8 AM next day
    return now;
  }

  private getDefaultChannels(
    type: NotificationType,
    preferences: NotificationPreferences
  ): NotificationChannel[] {
    const typePreferences = preferences.categoryPreferences[type];
    if (typePreferences) {
      return typePreferences;
    }

    // Default channels based on notification type
    switch (type) {
      case 'SYSTEM_ANNOUNCEMENT':
        return ['IN_APP', 'EMAIL'];
      case 'ASSIGNMENT_DUE':
        return ['IN_APP', 'EMAIL', 'PUSH'];
      case 'INSTRUCTOR_MESSAGE':
        return ['IN_APP', 'EMAIL'];
      default:
        return ['IN_APP'];
    }
  }

  private getDefaultCategoryPreferences(): Record<NotificationType, NotificationChannel[]> {
    return {
      DISCUSSION_REPLY: ['IN_APP'],
      STUDY_GROUP_INVITE: ['IN_APP', 'EMAIL'],
      STUDY_SESSION_SCHEDULED: ['IN_APP', 'EMAIL'],
      STUDY_SESSION_REMINDER: ['IN_APP', 'PUSH'],
      PEER_REVIEW_REQUEST: ['IN_APP', 'EMAIL'],
      INSTRUCTOR_MESSAGE: ['IN_APP', 'EMAIL'],
      BADGE_EARNED: ['IN_APP'],
      COURSE_UPDATE: ['IN_APP'],
      ASSIGNMENT_DUE: ['IN_APP', 'EMAIL', 'PUSH'],
      COLLABORATION_REQUEST: ['IN_APP', 'EMAIL'],
      SYSTEM_ANNOUNCEMENT: ['IN_APP', 'EMAIL'],
    };
  }

  private async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  private async clearUserNotificationCache(userId: string): Promise<void> {
    try {
      const keys = await redis.keys(`${this.cachePrefix}user:${userId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error('Error clearing notification cache:', error);
    }
  }
}

export const notificationService = new NotificationService();