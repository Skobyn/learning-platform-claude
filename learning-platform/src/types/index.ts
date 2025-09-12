// Core types for the enterprise learning platform

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  department?: string;
  profileImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserRole {
  ADMIN = 'admin',
  INSTRUCTOR = 'instructor',
  LEARNER = 'learner',
  MANAGER = 'manager'
}

export interface Course {
  id: string;
  title: string;
  description: string;
  instructorId: string;
  categoryId: string;
  level: CourseLevel;
  duration: number; // in minutes
  prerequisites: string[];
  tags: string[];
  thumbnailUrl?: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  modules: CourseModule[];
  enrollments: Enrollment[];
}

export enum CourseLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced'
}

export interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  duration: number;
  content: ModuleContent[];
  quiz?: Quiz;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModuleContent {
  id: string;
  moduleId: string;
  type: ContentType;
  title: string;
  content?: string; // For text content
  videoUrl?: string; // For video content
  fileUrl?: string; // For file downloads
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum ContentType {
  TEXT = 'text',
  VIDEO = 'video',
  FILE = 'file',
  INTERACTIVE = 'interactive'
}

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  enrolledAt: Date;
  completedAt?: Date;
  progress: number; // 0-100
  status: EnrollmentStatus;
  certificateId?: string;
}

export enum EnrollmentStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  DROPPED = 'dropped',
  SUSPENDED = 'suspended'
}

export interface Quiz {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  timeLimit?: number; // in minutes
  passingScore: number; // percentage
  questions: Question[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Question {
  id: string;
  quizId: string;
  type: QuestionType;
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string | string[];
  explanation?: string;
  points: number;
  order: number;
}

export enum QuestionType {
  MULTIPLE_CHOICE = 'multiple_choice',
  TRUE_FALSE = 'true_false',
  SHORT_ANSWER = 'short_answer',
  ESSAY = 'essay'
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  userId: string;
  answers: QuizAnswer[];
  score: number;
  passed: boolean;
  startedAt: Date;
  completedAt?: Date;
  submittedAt?: Date;
}

export interface QuizAnswer {
  questionId: string;
  answer: string | string[];
  isCorrect: boolean;
  pointsEarned: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  criteria: BadgeCriteria;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BadgeCriteria {
  type: BadgeType;
  requirements: Record<string, any>;
}

export enum BadgeType {
  COURSE_COMPLETION = 'course_completion',
  QUIZ_MASTERY = 'quiz_mastery',
  STREAK = 'streak',
  PARTICIPATION = 'participation',
  SKILL = 'skill'
}

export interface UserBadge {
  id: string;
  userId: string;
  badgeId: string;
  earnedAt: Date;
  verificationCode: string;
}

export interface Certificate {
  id: string;
  userId: string;
  courseId: string;
  templateId: string;
  issuedAt: Date;
  verificationCode: string;
  pdfUrl: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: Date;
  readAt?: Date;
}

export enum NotificationType {
  COURSE_ENROLLMENT = 'course_enrollment',
  QUIZ_REMINDER = 'quiz_reminder',
  BADGE_EARNED = 'badge_earned',
  CERTIFICATE_ISSUED = 'certificate_issued',
  DEADLINE_REMINDER = 'deadline_reminder',
  ANNOUNCEMENT = 'announcement'
}

export interface AnalyticsEvent {
  id: string;
  userId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  properties: Record<string, any>;
  timestamp: Date;
}

export interface LearningPath {
  id: string;
  name: string;
  description: string;
  courses: Course[];
  estimatedDuration: number;
  difficulty: CourseLevel;
  createdAt: Date;
  updatedAt: Date;
}

export interface Recommendation {
  id: string;
  userId: string;
  type: RecommendationType;
  entityId: string;
  score: number;
  reason: string;
  createdAt: Date;
}

export enum RecommendationType {
  COURSE = 'course',
  LEARNING_PATH = 'learning_path',
  NEXT_MODULE = 'next_module'
}

export interface MediaFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SearchFilters {
  category?: string;
  level?: CourseLevel;
  duration?: {
    min?: number;
    max?: number;
  };
  tags?: string[];
  instructor?: string;
}