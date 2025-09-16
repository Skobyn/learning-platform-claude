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
  userId: string | null;
  eventType: string;
  data: Record<string, any>;
  metadata?: Record<string, any> | null;
  sessionId?: string | null;
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

// Learning Paths and Collections Types

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimatedDuration: number;
  tags: string[];
  skills: string[];
  prerequisites: string[];
  learningObjectives: string[];
  isPublic: boolean;
  isFeatured: boolean;
  isTemplate: boolean;
  templateCategory?: string;
  status: string;
  createdBy: string;
  organizationId?: string;
  enrollmentCount: number;
  completionCount: number;
  averageRating: number;
  createdAt: Date;
  updatedAt: Date;
  items: PathItem[];
  dependencies?: PathDependency[];
  userEnrollment?: LearningPathEnrollment;
}

export interface PathItem {
  id: string;
  learningPathId: string;
  itemType: 'COURSE' | 'MODULE' | 'LEARNING_PATH' | 'ASSESSMENT' | 'RESOURCE';
  itemId: string;
  title: string;
  description?: string;
  orderIndex: number;
  section?: string;
  isRequired: boolean;
  prerequisites: string[];
  estimatedDuration: number;
  unlockDelay: number;
  metadata: Record<string, unknown>;
  progress?: PathItemProgress;
  createdAt: Date;
  updatedAt: Date;
}

export interface PathDependency {
  id: string;
  dependentPathId: string;
  prerequisitePathId: string;
  dependencyType: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  minimumCompletionPercentage: number;
  requiredScore?: number;
  requiredSkills: string[];
}

export interface LearningPathEnrollment {
  id: string;
  userId: string;
  learningPathId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'DROPPED';
  progressPercentage: number;
  currentItemId?: string;
  enrolledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastAccessedAt?: Date;
  estimatedCompletionDate?: Date;
  timeSpent: number;
  completionScore?: number;
  autoEnrollCourses: boolean;
  notificationPreferences: Record<string, unknown>;
}

export interface PathItemProgress {
  id: string;
  enrollmentId: string;
  itemId: string;
  userId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  progressPercentage: number;
  startedAt?: Date;
  completedAt?: Date;
  lastAccessedAt?: Date;
  score?: number;
  attempts: number;
  timeSpent: number;
  notes?: string;
  metadata: Record<string, unknown>;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  category: string;
  tags: string[];
  targetAudience: string[];
  thumbnailUrl?: string;
  bannerUrl?: string;
  colorTheme: string;
  learningPathCount: number;
  totalEstimatedDuration: number;
  isPublic: boolean;
  isFeatured: boolean;
  isCurated: boolean;
  createdBy: string;
  organizationId?: string;
  status: string;
  publishedAt?: Date;
  viewCount: number;
  enrollmentCount: number;
  createdAt: Date;
  updatedAt: Date;
  items?: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  learningPathId: string;
  orderIndex: number;
  section?: string;
  featured: boolean;
  customTitle?: string;
  customDescription?: string;
  difficultyBoost: number;
  priority: number;
  addedAt: Date;
  addedBy: string;
  learningPath: {
    id: string;
    title: string;
    description: string;
    category: string;
    difficulty: string;
    estimatedDuration: number;
    enrollmentCount: number;
    averageRating: number;
    tags: string[];
    skills: string[];
  };
}

export interface LearningPathRecommendation {
  pathId: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  estimatedDuration: number;
  skills: string[];
  enrollmentCount: number;
  averageRating: number;
  recommendationType: 'SKILL_BASED' | 'ROLE_BASED' | 'COLLABORATIVE' | 'TRENDING' | 'SIMILAR_USERS';
  confidenceScore: number;
  reasoning: string;
  factors: {
    skillMatchScore: number;
    roleMatchScore: number;
    difficultyFitScore: number;
    timeAvailabilityScore: number;
    popularityScore: number;
  };
  prerequisites: string[];
  estimatedCompletionDate?: Date;
}

export interface SkillGapAnalysis {
  userId: string;
  targetRole?: string;
  skillGaps: {
    skill: string;
    currentLevel: number;
    targetLevel: number;
    gap: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendedPaths: string[];
  }[];
  recommendations: LearningPathRecommendation[];
}

export interface LearningPathTemplate {
  id: string;
  title: string;
  description: string;
  category: 'ROLE' | 'SKILL' | 'INDUSTRY' | 'CERTIFICATION';
  templateType: string;
  targetRoles: string[];
  targetDepartments: string[];
  targetSkillLevel?: string;
  industry?: string;
  templateStructure: {
    sections: {
      title: string;
      description?: string;
      items: {
        type: 'COURSE' | 'MODULE' | 'ASSESSMENT' | 'RESOURCE';
        title: string;
        description?: string;
        skills?: string[];
        estimatedDuration?: number;
        difficulty?: string;
        isRequired?: boolean;
        prerequisites?: string[];
        metadata?: Record<string, unknown>;
      }[];
      orderIndex: number;
    }[];
    totalEstimatedDuration?: number;
    totalItems?: number;
    difficulty?: string;
    skills?: string[];
    learningObjectives?: string[];
  };
  variableFields: string[];
  usageCount: number;
  isFeatured: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Memory Management Types
export * from './memory';