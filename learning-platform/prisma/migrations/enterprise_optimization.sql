-- Enterprise Database Optimization Migration
-- Optimized for Google Cloud SQL with 100K+ concurrent connections
-- Target: <100ms response time for 95th percentile queries

-- Performance Indexes for Core Tables
-- User table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active ON "User" (email) WHERE "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role_created ON "User" (role, "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login ON "User" ("lastLogin") WHERE "lastLogin" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_subscription_status ON "User" ("subscriptionStatus", "subscriptionEndDate");

-- Course table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_category_published ON "Course" (category, published);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_difficulty_rating ON "Course" (difficulty, rating);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_created_published ON "Course" ("createdAt", published);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_instructor_category ON "Course" ("instructorId", category);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_fulltext_search ON "Course" USING gin(to_tsvector('english', title || ' ' || description));

-- Lesson table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_course_order ON "Lesson" ("courseId", "order");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_type_duration ON "Lesson" (type, duration);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_course_published ON "Lesson" ("courseId", published);

-- Enrollment table optimizations (high-frequency queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_active ON "Enrollment" ("userId", "completedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_progress ON "Enrollment" ("courseId", progress);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_created_progress ON "Enrollment" ("createdAt", progress);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_course_unique ON "Enrollment" ("userId", "courseId") WHERE "deletedAt" IS NULL;

-- Progress table optimizations (high-write table)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_lesson ON "Progress" ("userId", "lessonId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_enrollment_completed ON "Progress" ("enrollmentId", "completedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_lesson_completion_rate ON "Progress" ("lessonId", "completedAt") WHERE "completedAt" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_updated ON "Progress" ("userId", "updatedAt");

-- Quiz and Assessment optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quizzes_lesson_type ON "Quiz" ("lessonId", "quizType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_user_quiz ON "QuizAttempt" ("userId", "quizId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_score_completed ON "QuizAttempt" (score, "completedAt") WHERE "completedAt" IS NOT NULL;

-- Certificate table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_user_course ON "Certificate" ("userId", "courseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_issued_date ON "Certificate" ("issuedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_verification ON "Certificate" ("verificationCode") WHERE "verificationCode" IS NOT NULL;

-- Discussion and Forum optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discussions_course_created ON "Discussion" ("courseId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discussions_user_pinned ON "Discussion" ("userId", pinned);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_discussion_created ON "Comment" ("discussionId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_user_created ON "Comment" ("userId", "createdAt");

-- Analytics and Reporting Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_analytics_user_date ON "UserAnalytics" ("userId", date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_analytics_date_metric ON "UserAnalytics" (date, "timeSpent", "lessonsCompleted");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_course_analytics_course_date ON "CourseAnalytics" ("courseId", date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_analytics_date_metric ON "SystemAnalytics" (date, "activeUsers", "newEnrollments");

-- Badge and Achievement optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_badges_user_earned ON "UserBadge" ("userId", "earnedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_badges_badge_earned ON "UserBadge" ("badgeId", "earnedAt");

-- Notification optimizations (high-volume table)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read_created ON "Notification" ("userId", read, "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_type_created ON "Notification" (type, "createdAt");

-- Composite indexes for complex queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_course_progress_completed ON "Enrollment" ("userId", "courseId", progress, "completedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_completion_stats ON "Progress" ("userId", "completedAt", "timeSpent") WHERE "completedAt" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_course_enrollment_stats ON "Enrollment" ("courseId", "createdAt", progress) WHERE "deletedAt" IS NULL;

-- Partial indexes for soft deletes (memory efficient)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_email ON "User" (email) WHERE "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_published_active ON "Course" (published, "createdAt") WHERE "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_active_course ON "Lesson" ("courseId", "order") WHERE "deletedAt" IS NULL;

-- Covering indexes for read-heavy queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_dashboard_data ON "User" ("id", "firstName", "lastName", "email", "role", "lastLogin") WHERE "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_catalog_data ON "Course" ("id", "title", "description", "thumbnailUrl", "rating", "price", "category", "difficulty") WHERE published = true AND "deletedAt" IS NULL;

-- Foreign key performance indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_course_fk ON "Lesson" ("courseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_fk ON "Enrollment" ("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_fk ON "Enrollment" ("courseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_fk ON "Progress" ("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_lesson_fk ON "Progress" ("lessonId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_enrollment_fk ON "Progress" ("enrollmentId");

-- Time-based partitioning support indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_analytics_partition ON "UserAnalytics" (date, "userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_course_analytics_partition ON "CourseAnalytics" (date, "courseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_analytics_partition ON "SystemAnalytics" (date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_partition ON "AuditLog" ("createdAt", "userId");

-- Update table statistics for query planner
ANALYZE "User";
ANALYZE "Course";
ANALYZE "Lesson";
ANALYZE "Enrollment";
ANALYZE "Progress";
ANALYZE "Quiz";
ANALYZE "QuizAttempt";
ANALYZE "Certificate";
ANALYZE "Discussion";
ANALYZE "Comment";
ANALYZE "UserAnalytics";
ANALYZE "CourseAnalytics";
ANALYZE "SystemAnalytics";
ANALYZE "Notification";
ANALYZE "UserBadge";

-- Vacuum and reindex for optimal performance
VACUUM ANALYZE;

-- Enable query plan caching
SET shared_preload_libraries = 'pg_stat_statements';
SELECT pg_stat_statements_reset();

COMMIT;