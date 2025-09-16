import { PrismaClient } from '@prisma/client';
import { Notification, NotificationType } from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();

export class NotificationService {
  private emailTransporter: nodemailer.Transporter;

  constructor() {
    // Initialize email transporter
    this.emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  /**
   * Create and send a notification
   */
  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
    channels: ('in_app' | 'email' | 'push')[] = ['in_app']
  ): Promise<Notification> {
    try {
      logger.info('Creating notification', { userId, type, title });
      
      // Create in-app notification
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: type as any,
          title,
          message,
          data: data || {},
          isRead: false
        }
      });

      // Send via additional channels
      const promises = [];
      
      if (channels.includes('email')) {
        promises.push(this.sendEmailNotification(userId, title, message, data));
      }
      
      if (channels.includes('push')) {
        promises.push(this.sendPushNotification(userId, title, message, data));
      }

      await Promise.allSettled(promises);

      logger.info('Notification created and sent', { 
        notificationId: notification.id,
        channels: channels.join(', ')
      });
      
      return notification as Notification;
    } catch (error) {
      logger.error('Error creating notification', { userId, type, error });
      throw new ValidationError('Failed to create notification');
    }
  }

  /**
   * Get user's notifications with pagination
   */
  async getUserNotifications(
    userId: string,
    page = 1,
    limit = 20,
    unreadOnly = false
  ): Promise<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
  }> {
    try {
      const skip = (page - 1) * limit;
      
      const where = {
        userId,
        ...(unreadOnly && { isRead: false })
      };

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { userId, isRead: false }
        })
      ]);

      return {
        notifications: notifications as Notification[],
        total,
        unreadCount
      };
    } catch (error) {
      logger.error('Error fetching user notifications', { userId, error });
      throw new ValidationError('Failed to fetch notifications');
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId }
      });

      if (!notification) {
        throw new NotFoundError('Notification not found');
      }

      const updated = await prisma.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date()
        }
      });

      logger.info('Notification marked as read', { notificationId });
      return updated as Notification;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Error marking notification as read', { notificationId, error });
      throw new ValidationError('Failed to mark notification as read');
    }
  }

  /**
   * Mark all user notifications as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    try {
      const result = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: {
          isRead: true,
          readAt: new Date()
        }
      });

      logger.info('All notifications marked as read', { userId, count: result.count });
      return result.count;
    } catch (error) {
      logger.error('Error marking all notifications as read', { userId, error });
      throw new ValidationError('Failed to mark all notifications as read');
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId }
      });

      if (!notification) {
        throw new NotFoundError('Notification not found');
      }

      await prisma.notification.delete({
        where: { id: notificationId }
      });

      logger.info('Notification deleted', { notificationId });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error('Error deleting notification', { notificationId, error });
      throw new ValidationError('Failed to delete notification');
    }
  }

  /**
   * Send course enrollment notification
   */
  async sendCourseEnrollmentNotification(userId: string, courseId: string): Promise<void> {
    try {
      const course = await prisma.course.findUnique({
        where: { id: courseId }
      });

      if (course) {
        await this.createNotification(
          userId,
          NotificationType.COURSE_ENROLLMENT,
          'Course Enrollment Confirmed',
          `You have successfully enrolled in "${course.title}". Start learning now!`,
          { courseId },
          ['in_app', 'email']
        );
      }
    } catch (error) {
      logger.error('Error sending course enrollment notification', { userId, courseId, error });
    }
  }

  /**
   * Send quiz reminder notification
   */
  async sendQuizReminderNotification(userId: string, quizId: string, moduleTitle: string): Promise<void> {
    try {
      await this.createNotification(
        userId,
        NotificationType.QUIZ_REMINDER,
        'Quiz Reminder',
        `Don't forget to complete the quiz for "${moduleTitle}".`,
        { quizId },
        ['in_app', 'push']
      );
    } catch (error) {
      logger.error('Error sending quiz reminder', { userId, quizId, error });
    }
  }

  /**
   * Send deadline reminder notifications
   */
  async sendDeadlineReminders(): Promise<void> {
    try {
      logger.info('Sending deadline reminders');
      
      // Find enrollments with upcoming deadlines (courses with time limits)
      const upcomingDeadlines = await prisma.enrollment.findMany({
        where: {
          status: 'active',
          // Add deadline logic based on course duration
        },
        include: {
          user: true,
          course: true
        }
      });

      const promises = upcomingDeadlines.map(async (enrollment) => {
        return this.createNotification(
          enrollment.userId,
          NotificationType.DEADLINE_REMINDER,
          'Course Deadline Approaching',
          `Your course "${enrollment.course.title}" has a deadline approaching. Complete it soon!`,
          { courseId: enrollment.courseId },
          ['in_app', 'email']
        );
      });

      await Promise.allSettled(promises);
      
      logger.info('Deadline reminders sent', { count: upcomingDeadlines.length });
    } catch (error) {
      logger.error('Error sending deadline reminders', error);
    }
  }

  /**
   * Send announcement to multiple users
   */
  async sendAnnouncement(
    userIds: string[],
    title: string,
    message: string,
    data?: Record<string, any>,
    channels: ('in_app' | 'email' | 'push')[] = ['in_app']
  ): Promise<number> {
    try {
      logger.info('Sending announcement', { 
        title, 
        recipientCount: userIds.length,
        channels: channels.join(', ')
      });
      
      const promises = userIds.map(userId =>
        this.createNotification(
          userId,
          NotificationType.ANNOUNCEMENT,
          title,
          message,
          data,
          channels
        ).catch(error => {
          logger.error('Failed to send announcement to user', { userId, error });
          return null;
        })
      );

      const results = await Promise.allSettled(promises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
      
      logger.info('Announcement sent', { successCount, totalUsers: userIds.length });
      return successCount;
    } catch (error) {
      logger.error('Error sending announcement', { title, error });
      throw new ValidationError('Failed to send announcement');
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    userId: string,
    title: string,
    message: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user || !user.email) {
        throw new Error('User email not found');
      }

      const emailContent = this.formatEmailContent(title, message, data);
      
      await this.emailTransporter.sendMail({
        from: process.env.FROM_EMAIL || 'noreply@learningplatform.com',
        to: user.email,
        subject: title,
        html: emailContent.html,
        text: emailContent.text
      });

      logger.info('Email notification sent', { userId, email: user.email });
    } catch (error) {
      logger.error('Error sending email notification', { userId, error });
      throw error;
    }
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(
    userId: string,
    title: string,
    message: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      // In a real implementation, this would integrate with push notification services
      // like Firebase Cloud Messaging, Apple Push Notifications, etc.
      
      logger.info('Push notification sent', { userId, title });
      
      // TODO: Implement actual push notification sending
      // Example with Firebase:
      // await admin.messaging().send({
      //   token: userPushToken,
      //   notification: { title, body: message },
      //   data: data || {}
      // });
      
    } catch (error) {
      logger.error('Error sending push notification', { userId, error });
      throw error;
    }
  }

  /**
   * Format email content
   */
  private formatEmailContent(
    title: string,
    message: string,
    data?: Record<string, any>
  ): { html: string; text: string } {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; }
            .header { background-color: #007bff; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f8f9fa; }
            .footer { padding: 20px; text-align: center; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${title}</h1>
            </div>
            <div class="content">
              <p>${message}</p>
              ${data?.courseId ? `<p><a href="${process.env.FRONTEND_URL}/courses/${data.courseId}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Course</a></p>` : ''}
            </div>
            <div class="footer">
              <p>© 2024 Learning Platform. All rights reserved.</p>
              <p><a href="${process.env.FRONTEND_URL}/notifications/unsubscribe">Unsubscribe</a></p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `${title}\n\n${message}\n\n© 2024 Learning Platform. All rights reserved.`;

    return { html, text };
  }

  /**
   * Get notification preferences for user
   */
  async getNotificationPreferences(userId: string): Promise<{
    email: boolean;
    push: boolean;
    inApp: boolean;
    types: Record<NotificationType, boolean>;
  }> {
    try {
      // In a real implementation, this would fetch user preferences from database
      // For now, return default preferences
      return {
        email: true,
        push: true,
        inApp: true,
        types: {
          [NotificationType.COURSE_ENROLLMENT]: true,
          [NotificationType.QUIZ_REMINDER]: true,
          [NotificationType.BADGE_EARNED]: true,
          [NotificationType.CERTIFICATE_ISSUED]: true,
          [NotificationType.DEADLINE_REMINDER]: true,
          [NotificationType.ANNOUNCEMENT]: true
        }
      };
    } catch (error) {
      logger.error('Error fetching notification preferences', { userId, error });
      throw new ValidationError('Failed to fetch notification preferences');
    }
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    preferences: {
      email?: boolean;
      push?: boolean;
      inApp?: boolean;
      types?: Partial<Record<NotificationType, boolean>>;
    }
  ): Promise<void> {
    try {
      logger.info('Updating notification preferences', { userId });
      
      // In a real implementation, save to database
      // await prisma.userNotificationPreferences.upsert({...});
      
      logger.info('Notification preferences updated', { userId });
    } catch (error) {
      logger.error('Error updating notification preferences', { userId, error });
      throw new ValidationError('Failed to update notification preferences');
    }
  }

  /**
   * Clean up old notifications
   */
  async cleanupOldNotifications(days = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await prisma.notification.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          isRead: true
        }
      });

      logger.info('Old notifications cleaned up', { deletedCount: result.count });
      return result.count;
    } catch (error) {
      logger.error('Error cleaning up old notifications', error);
      throw new ValidationError('Failed to cleanup old notifications');
    }
  }

  /**
   * Send bulk notifications (for system-wide announcements)
   */
  async sendBulkNotifications(
    title: string,
    message: string,
    filters?: {
      roles?: string[];
      departments?: string[];
      courseIds?: string[];
    },
    channels: ('in_app' | 'email' | 'push')[] = ['in_app']
  ): Promise<number> {
    try {
      logger.info('Sending bulk notifications', { title, filters });
      
      // Build user query based on filters
      let userWhere: any = {};
      
      if (filters?.roles) {
        userWhere.role = { in: filters.roles };
      }
      
      if (filters?.departments) {
        userWhere.department = { in: filters.departments };
      }
      
      if (filters?.courseIds) {
        userWhere.enrollments = {
          some: {
            courseId: { in: filters.courseIds }
          }
        };
      }

      const users = await prisma.user.findMany({
        where: userWhere,
        select: { id: true }
      });

      const userIds = users.map(u => u.id);
      
      return await this.sendAnnouncement(userIds, title, message, {}, channels);
    } catch (error) {
      logger.error('Error sending bulk notifications', { title, error });
      throw new ValidationError('Failed to send bulk notifications');
    }
  }
}

export const notificationService = new NotificationService();