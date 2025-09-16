/**
 * Event Handlers for Async Processing
 * Handles various events published to Cloud Pub/Sub topics
 */

const { PubSub } = require('@google-cloud/pubsub');
const { sendEmail } = require('../services/email.service');
const { generateCertificate } = require('../services/certificate.service');
const { updateAnalytics } = require('../services/analytics.service');
const { createNotification } = require('../services/notification.service');
const prisma = require('../lib/db');

class EventHandlers {
  constructor() {
    this.pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
  }

  /**
   * Publishes an event to a Pub/Sub topic
   */
  async publishEvent(topicName, eventData, attributes = {}) {
    try {
      const topic = this.pubsub.topic(topicName);
      
      const message = {
        data: Buffer.from(JSON.stringify(eventData)),
        attributes: {
          eventId: eventData.id || Date.now().toString(),
          eventType: eventData.type,
          timestamp: new Date().toISOString(),
          source: 'learning-platform',
          ...attributes,
        },
      };

      const messageId = await topic.publishMessage(message);
      console.log(`Event published to ${topicName}: ${messageId}`);
      
      return messageId;
    } catch (error) {
      console.error(`Failed to publish event to ${topicName}:`, error);
      throw error;
    }
  }

  // User Event Handlers
  async handleUserRegistration(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, email, firstName, lastName } = eventData;

      // Send welcome email
      await sendEmail({
        to: email,
        subject: 'Welcome to Learning Platform',
        template: 'welcome',
        data: {
          firstName,
          lastName,
          loginUrl: `${process.env.NEXTAUTH_URL}/login`,
        },
      });

      // Create welcome notification
      await createNotification({
        userId,
        type: 'WELCOME',
        title: 'Welcome to Learning Platform!',
        message: 'Start your learning journey by exploring our courses.',
      });

      // Update analytics
      await updateAnalytics({
        eventType: 'user_registered',
        userId,
        properties: {
          registrationSource: eventData.source || 'direct',
        },
      });

      console.log(`User registration processed for user: ${userId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process user registration:', error);
      message.nack();
    }
  }

  async handleUserProfileUpdate(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, changes } = eventData;

      // Send profile update confirmation email if email changed
      if (changes.email) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        
        await sendEmail({
          to: changes.email,
          subject: 'Email Address Updated',
          template: 'email-changed',
          data: {
            firstName: user.firstName,
            oldEmail: user.email,
            newEmail: changes.email,
          },
        });
      }

      // Update analytics
      await updateAnalytics({
        eventType: 'profile_updated',
        userId,
        properties: {
          fieldsChanged: Object.keys(changes),
        },
      });

      console.log(`Profile update processed for user: ${userId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process profile update:', error);
      message.nack();
    }
  }

  // Course Event Handlers
  async handleCourseEnrollment(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, courseId, enrollmentId } = eventData;

      // Get course and user details
      const [course, user] = await Promise.all([
        prisma.course.findUnique({
          where: { id: courseId },
          include: { instructor: true },
        }),
        prisma.user.findUnique({ where: { id: userId } }),
      ]);

      // Send enrollment confirmation email
      await sendEmail({
        to: user.email,
        subject: `Enrollment Confirmed: ${course.title}`,
        template: 'enrollment-confirmation',
        data: {
          firstName: user.firstName,
          courseTitle: course.title,
          instructorName: `${course.instructor.firstName} ${course.instructor.lastName}`,
          courseUrl: `${process.env.NEXTAUTH_URL}/courses/${courseId}`,
        },
      });

      // Create notification
      await createNotification({
        userId,
        type: 'COURSE_ENROLLMENT',
        title: 'Successfully Enrolled!',
        message: `You have been enrolled in ${course.title}. Start learning now!`,
        data: { courseId, enrollmentId },
      });

      // Notify instructor
      await createNotification({
        userId: course.instructorId,
        type: 'NEW_STUDENT',
        title: 'New Student Enrolled',
        message: `${user.firstName} ${user.lastName} enrolled in ${course.title}`,
        data: { courseId, studentId: userId },
      });

      // Update analytics
      await updateAnalytics({
        eventType: 'course_enrolled',
        userId,
        properties: {
          courseId,
          courseLevel: course.level,
          courseCategory: course.categoryId,
        },
      });

      console.log(`Course enrollment processed: ${enrollmentId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process course enrollment:', error);
      message.nack();
    }
  }

  async handleCourseCompletion(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, courseId, enrollmentId, completionDate } = eventData;

      // Get course and user details
      const [course, user, enrollment] = await Promise.all([
        prisma.course.findUnique({
          where: { id: courseId },
        }),
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.enrollment.findUnique({
          where: { id: enrollmentId },
        }),
      ]);

      // Generate certificate
      const certificateData = await generateCertificate({
        userId,
        courseId,
        enrollmentId,
        completionDate,
      });

      // Send completion email with certificate
      await sendEmail({
        to: user.email,
        subject: `Course Completed: ${course.title}`,
        template: 'course-completion',
        data: {
          firstName: user.firstName,
          courseTitle: course.title,
          completionDate: new Date(completionDate).toLocaleDateString(),
          certificateUrl: certificateData.pdfUrl,
        },
      });

      // Create notification
      await createNotification({
        userId,
        type: 'CERTIFICATE_ISSUED',
        title: 'Congratulations! Certificate Ready',
        message: `You have completed ${course.title} and earned a certificate!`,
        data: { 
          courseId, 
          certificateId: certificateData.id,
          certificateUrl: certificateData.pdfUrl,
        },
      });

      // Check for badges to award
      await this.checkAndAwardBadges(userId, courseId);

      // Update analytics
      await updateAnalytics({
        eventType: 'course_completed',
        userId,
        properties: {
          courseId,
          courseLevel: course.level,
          completionTime: enrollment.enrolledAt ? 
            Date.now() - new Date(enrollment.enrolledAt).getTime() : null,
          finalScore: enrollment.progress || 100,
        },
      });

      console.log(`Course completion processed for user: ${userId}, course: ${courseId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process course completion:', error);
      message.nack();
    }
  }

  // Progress Event Handlers
  async handleModuleCompletion(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, courseId, moduleId, completionDate } = eventData;

      // Update enrollment progress
      const enrollment = await prisma.enrollment.findFirst({
        where: { userId, courseId },
        include: {
          course: {
            include: { modules: true }
          }
        }
      });

      if (enrollment) {
        // Calculate new progress percentage
        const completedModules = await prisma.moduleProgress.count({
          where: {
            userId,
            moduleId: { in: enrollment.course.modules.map(m => m.id) },
            completed: true,
          },
        });

        const progressPercentage = Math.round(
          (completedModules / enrollment.course.modules.length) * 100
        );

        // Update enrollment progress
        await prisma.enrollment.update({
          where: { id: enrollment.id },
          data: { progress: progressPercentage },
        });

        // Check if course is completed
        if (progressPercentage === 100) {
          await this.publishEvent('course-events', {
            type: 'course.completed',
            userId,
            courseId,
            enrollmentId: enrollment.id,
            completionDate: new Date(),
          });
        }
      }

      // Update analytics
      await updateAnalytics({
        eventType: 'module_completed',
        userId,
        properties: {
          courseId,
          moduleId,
          completionDate,
        },
      });

      console.log(`Module completion processed: ${moduleId} for user: ${userId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process module completion:', error);
      message.nack();
    }
  }

  async handleQuizSubmission(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, quizId, attemptId, score, passed } = eventData;

      // Get quiz and user details
      const [quiz, user, attempt] = await Promise.all([
        prisma.quiz.findUnique({
          where: { id: quizId },
          include: { module: { include: { course: true } } },
        }),
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.quizAttempt.findUnique({ where: { id: attemptId } }),
      ]);

      // Send quiz result email if significant (first attempt or passing after failing)
      const previousAttempts = await prisma.quizAttempt.count({
        where: { quizId, userId, id: { not: attemptId } },
      });

      const shouldNotify = previousAttempts === 0 || (passed && score >= quiz.passingScore);

      if (shouldNotify) {
        await sendEmail({
          to: user.email,
          subject: `Quiz ${passed ? 'Passed' : 'Results'}: ${quiz.title}`,
          template: 'quiz-result',
          data: {
            firstName: user.firstName,
            quizTitle: quiz.title,
            courseTitle: quiz.module.course.title,
            score,
            passed,
            passingScore: quiz.passingScore,
            attemptNumber: previousAttempts + 1,
          },
        });
      }

      // Create notification for passing quiz
      if (passed) {
        await createNotification({
          userId,
          type: 'QUIZ_PASSED',
          title: 'Quiz Passed!',
          message: `Congratulations! You passed the quiz "${quiz.title}" with ${score}%.`,
          data: { quizId, attemptId, score },
        });
      }

      // Update analytics
      await updateAnalytics({
        eventType: 'quiz_submitted',
        userId,
        properties: {
          quizId,
          courseId: quiz.module.courseId,
          score,
          passed,
          attemptNumber: previousAttempts + 1,
        },
      });

      console.log(`Quiz submission processed: ${attemptId} for user: ${userId}`);
      message.ack();
    } catch (error) {
      console.error('Failed to process quiz submission:', error);
      message.nack();
    }
  }

  // Notification Event Handlers
  async handleEmailNotification(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { recipient, subject, template, data } = eventData;

      await sendEmail({
        to: recipient,
        subject,
        template,
        data,
      });

      console.log(`Email notification sent to: ${recipient}`);
      message.ack();
    } catch (error) {
      console.error('Failed to send email notification:', error);
      message.nack();
    }
  }

  async handlePushNotification(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      // Push notification logic would go here
      // This would integrate with FCM or another push service

      console.log('Push notification processed:', eventData);
      message.ack();
    } catch (error) {
      console.error('Failed to send push notification:', error);
      message.nack();
    }
  }

  // Analytics Event Handlers
  async handleAnalyticsEvent(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      
      await updateAnalytics(eventData);

      console.log('Analytics event processed:', eventData.eventType);
      message.ack();
    } catch (error) {
      console.error('Failed to process analytics event:', error);
      message.nack();
    }
  }

  // Certificate Event Handlers
  async handleCertificateGeneration(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      const { userId, courseId, requestId } = eventData;

      const certificate = await generateCertificate({
        userId,
        courseId,
        requestId,
      });

      // Publish certificate ready event
      await this.publishEvent('certificate-events', {
        type: 'certificate.generated',
        userId,
        courseId,
        certificateId: certificate.id,
        pdfUrl: certificate.pdfUrl,
      });

      console.log(`Certificate generated: ${certificate.id}`);
      message.ack();
    } catch (error) {
      console.error('Failed to generate certificate:', error);
      message.nack();
    }
  }

  // Dead Letter Handler
  async handleDeadLetter(message) {
    try {
      const eventData = JSON.parse(message.data.toString());
      
      // Log failed message for manual inspection
      console.error('Dead letter message received:', {
        eventData,
        attributes: message.attributes,
        deliveryAttempt: message.deliveryAttempt,
      });

      // Store in database for later analysis
      await prisma.deadLetterEvent.create({
        data: {
          messageId: message.id,
          eventType: message.attributes.eventType || 'unknown',
          eventData: JSON.stringify(eventData),
          attributes: JSON.stringify(message.attributes),
          deliveryAttempt: message.deliveryAttempt,
          createdAt: new Date(),
        },
      });

      // Send alert to administrators
      if (message.deliveryAttempt >= 3) {
        await sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: 'Dead Letter Alert: Failed Event Processing',
          template: 'dead-letter-alert',
          data: {
            eventType: message.attributes.eventType,
            messageId: message.id,
            deliveryAttempt: message.deliveryAttempt,
            eventData: JSON.stringify(eventData, null, 2),
          },
        });
      }

      message.ack();
    } catch (error) {
      console.error('Failed to process dead letter:', error);
      message.nack();
    }
  }

  // Helper Methods
  async checkAndAwardBadges(userId, courseId) {
    try {
      // Get user's completed courses
      const completedCourses = await prisma.enrollment.count({
        where: {
          userId,
          status: 'COMPLETED',
        },
      });

      // Award badges based on milestones
      const badgeChecks = [
        { courses: 1, badgeId: 'first-course' },
        { courses: 5, badgeId: 'course-explorer' },
        { courses: 10, badgeId: 'learning-enthusiast' },
        { courses: 25, badgeId: 'knowledge-seeker' },
        { courses: 50, badgeId: 'learning-master' },
      ];

      for (const check of badgeChecks) {
        if (completedCourses === check.courses) {
          // Check if badge already awarded
          const existingBadge = await prisma.userBadge.findFirst({
            where: { userId, badgeId: check.badgeId },
          });

          if (!existingBadge) {
            await prisma.userBadge.create({
              data: {
                userId,
                badgeId: check.badgeId,
                earnedAt: new Date(),
                verificationCode: this.generateVerificationCode(),
              },
            });

            // Publish badge earned event
            await this.publishEvent('notification-events', {
              type: 'badge.earned',
              userId,
              badgeId: check.badgeId,
              courses: completedCourses,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to check and award badges:', error);
    }
  }

  generateVerificationCode() {
    return Math.random().toString(36).substr(2, 9).toUpperCase();
  }
}

module.exports = EventHandlers;