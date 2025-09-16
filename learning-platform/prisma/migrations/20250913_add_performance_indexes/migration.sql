-- Performance Optimization Migration for Learning Platform
-- Comprehensive indexing strategy for 100K+ concurrent users

BEGIN;

-- User table performance indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active ON users(email, "isActive") WHERE "isActive" = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_role ON users("organizationId", role) WHERE "isActive" = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login ON users("lastLogin") WHERE "lastLogin" IS NOT NULL;

-- Session table optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_token_expires ON user_sessions(token, "expiresAt") WHERE "expiresAt" > NOW();
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_expires ON user_sessions("userId", "expiresAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_expires_cleanup ON user_sessions("expiresAt") WHERE "expiresAt" < NOW();

-- Course table performance indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_status_category ON courses(status, category) WHERE status = 'PUBLISHED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_creator_status ON courses("createdBy", status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_org_status ON courses("organizationId", status) WHERE "organizationId" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_difficulty_status ON courses(difficulty, status) WHERE status = 'PUBLISHED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_published_rating ON courses("publishedAt", "averageRating") WHERE status = 'PUBLISHED';

-- Full-text search index for courses
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_fulltext ON courses USING gin(to_tsvector('english', title || ' ' || description || ' ' || array_to_string(tags, ' ')));

-- Enrollment table critical indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_status ON enrollments("userId", status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_status ON enrollments("courseId", status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_enrolled_at ON enrollments("enrolledAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_completed_at ON enrollments("completedAt") WHERE "completedAt" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_progress ON enrollments(progress) WHERE progress > 0;

-- Progress table optimization (high-frequency updates)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_lesson ON progress("userId", "lessonId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_module ON progress("userId", "moduleId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_last_accessed ON progress("lastAccessedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_completion ON progress("completionPercentage") WHERE "completionPercentage" > 0;

-- Module and lesson navigation indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modules_course_order ON modules("courseId", "orderIndex");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_module_order ON lessons("moduleId", "orderIndex");

-- Quiz and assessment indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_user_quiz ON quiz_attempts("userId", "quizId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_submitted ON quiz_attempts("submittedAt") WHERE "submittedAt" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_score ON quiz_attempts(score) WHERE score IS NOT NULL;

-- Question response performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_question_responses_attempt ON question_responses("attemptId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_question_responses_question ON question_responses("questionId");

-- Analytics events table partitioning and indexing (critical for performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events("timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_user_timestamp ON analytics_events("userId", "timestamp") WHERE "userId" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_event_type ON analytics_events("eventType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_session ON analytics_events("sessionId") WHERE "sessionId" IS NOT NULL;

-- JSON indexes for analytics data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_data_entity_type ON analytics_events USING gin((data->>'entityType'));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_data_entity_id ON analytics_events USING gin((data->>'entityId'));

-- Notification system indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread ON notifications("userId", "isRead") WHERE "isRead" = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_type_created ON notifications(type, "createdAt");

-- Achievement and gamification indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_user_earned ON achievements("userId", "earnedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_type_level ON achievements(type, level);

-- Certificate indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_user_course ON certificates("userId", "courseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_verification ON certificates("verificationCode");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_issued_at ON certificates("issuedAt");

-- Video streaming indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_course_status ON videos("courseId", status) WHERE "courseId" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_lesson_status ON videos("lessonId", status) WHERE "lessonId" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_watch_progress_user_video ON video_watch_progress("userId", "videoId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_streaming_tokens_expires ON video_streaming_tokens("expiresAt") WHERE "expiresAt" > NOW();

-- Activity log indexes for audit and security
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_user_action ON activity_logs("userId", action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_created_at ON activity_logs("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_resource ON activity_logs(resource);

-- Password reset and email verification cleanup indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens("expiresAt") WHERE used = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_verification_tokens_expires ON email_verification_tokens("expiresAt") WHERE used = false;

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_search_published ON courses(status, category, difficulty, "averageRating") WHERE status = 'PUBLISHED';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_active_progress ON enrollments("userId", status, progress) WHERE status = 'ACTIVE';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_active_completion ON progress("userId", "completionPercentage", "lastAccessedAt") WHERE "completionPercentage" < 100;

-- Partial indexes for common filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_instructors ON users(role, "createdAt") WHERE role = 'INSTRUCTOR' AND "isActive" = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_published_recent ON courses("publishedAt", "averageRating") WHERE status = 'PUBLISHED' AND "publishedAt" IS NOT NULL;

COMMIT;

-- Analytics table partitioning setup (separate transaction)
BEGIN;

-- Create partitioned analytics_events table for better performance
-- This will be implemented in the partitioning strategy script

-- Add table statistics for query planner optimization
ANALYZE users;
ANALYZE courses;
ANALYZE enrollments;
ANALYZE progress;
ANALYZE analytics_events;
ANALYZE quiz_attempts;
ANALYZE notifications;

COMMIT;

-- Performance monitoring views
CREATE OR REPLACE VIEW performance_stats AS
SELECT
    schemaname,
    tablename,
    attname as column_name,
    n_distinct,
    correlation,
    most_common_vals,
    most_common_freqs
FROM pg_stats
WHERE schemaname = 'public'
AND tablename IN ('users', 'courses', 'enrollments', 'progress', 'analytics_events')
ORDER BY tablename, attname;

-- Index usage monitoring
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Slow query identification
CREATE OR REPLACE VIEW slow_queries AS
SELECT
    query,
    calls,
    total_time,
    mean_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements
WHERE mean_time > 100  -- queries slower than 100ms
ORDER BY mean_time DESC
LIMIT 20;