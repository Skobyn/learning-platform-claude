// Export all services for easy importing
export { courseService, CourseService } from './courseService';
export { assessmentService, AssessmentService } from './assessmentService';
export { badgeService, BadgeService } from './badgeService';
export { notificationService, NotificationService } from './notificationService';
export { analyticsService, AnalyticsService } from './analyticsService';
export { mediaService, MediaService } from './mediaService';
export { recommendationService, RecommendationService } from './recommendationService';

// Export utility functions
export { default as logger } from '../utils/logger';
export * from '../utils/errors';

// Export types
export * from '../types';