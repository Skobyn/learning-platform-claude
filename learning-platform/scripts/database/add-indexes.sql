-- Database Performance Optimization: Missing Indexes
-- This script adds all necessary indexes for the learning platform
-- Based on schema analysis and common query patterns

-- ==================================================
-- USER-RELATED INDEXES
-- ==================================================

-- Users table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active
ON users (email) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_organization_role
ON users (organization_id, role) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login
ON users (last_login) WHERE last_login IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at
ON users (created_at);

-- User sessions indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_token_expires
ON user_sessions (token, expires_at) WHERE expires_at > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_expires
ON user_sessions (user_id, expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_cleanup
ON user_sessions (expires_at) WHERE expires_at <= NOW();

-- ==================================================
-- COURSE-RELATED INDEXES
-- ==================================================

-- Courses table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_status_published
ON courses (status) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_category_difficulty
ON courses (category, difficulty) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_creator_org
ON courses (created_by, organization_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_tags_gin
ON courses USING GIN (tags) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_price_published
ON courses (price, currency) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_rating_enrollments
ON courses (average_rating, enrollment_count) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_published_at
ON courses (published_at) WHERE published_at IS NOT NULL;

-- Modules table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modules_course_order
ON modules (course_id, order_index);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modules_prerequisites_gin
ON modules USING GIN (prerequisites);

-- Lessons table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_module_order
ON lessons (module_id, order_index);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_content_type
ON lessons (content_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_duration
ON lessons (estimated_duration);

-- ==================================================
-- ENROLLMENT AND PROGRESS INDEXES
-- ==================================================

-- Enrollments table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_course_unique
ON enrollments (user_id, course_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_status
ON enrollments (course_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_status_active
ON enrollments (user_id, status) WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_enrolled_at
ON enrollments (enrolled_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_completed_at
ON enrollments (completed_at) WHERE completed_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_last_accessed
ON enrollments (last_accessed_at) WHERE last_accessed_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_progress
ON enrollments (progress) WHERE progress > 0;

-- Progress table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_lesson_unique
ON progress (user_id, lesson_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_module
ON progress (user_id, module_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_lesson_completion
ON progress (lesson_id, completion_percentage);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_last_accessed
ON progress (last_accessed_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_completed
ON progress (completed_at) WHERE completed_at IS NOT NULL;

-- ==================================================
-- ASSESSMENT INDEXES
-- ==================================================

-- Quiz attempts indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_user_quiz
ON quiz_attempts (user_id, quiz_id, started_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_quiz_submitted
ON quiz_attempts (quiz_id, submitted_at) WHERE submitted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_score_passed
ON quiz_attempts (score, passed) WHERE submitted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_user_recent
ON quiz_attempts (user_id, started_at DESC);

-- Questions table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_questions_quiz_order
ON questions (quiz_id, order_index);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_questions_type_difficulty
ON questions (type, difficulty);

-- Question responses indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_question_responses_attempt
ON question_responses (attempt_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_question_responses_question
ON question_responses (question_id, is_correct);

-- ==================================================
-- ANALYTICS AND REPORTING INDEXES
-- ==================================================

-- Analytics events indexes (Critical for performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_user_timestamp
ON analytics_events (user_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_event_type_timestamp
ON analytics_events (event_type, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_timestamp_only
ON analytics_events (timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_session_timestamp
ON analytics_events (session_id, timestamp) WHERE session_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_data_gin
ON analytics_events USING GIN (data);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_metadata_gin
ON analytics_events USING GIN (metadata) WHERE metadata IS NOT NULL;

-- Composite index for common analytics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_user_event_time
ON analytics_events (user_id, event_type, timestamp DESC)
WHERE user_id IS NOT NULL;

-- ==================================================
-- NOTIFICATION INDEXES
-- ==================================================

-- Notifications table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
ON notifications (user_id, is_read, created_at DESC) WHERE is_read = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_type_created
ON notifications (type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_cleanup
ON notifications (created_at) WHERE is_read = true;

-- ==================================================
-- ACHIEVEMENT AND GAMIFICATION INDEXES
-- ==================================================

-- Achievements table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_user_earned
ON achievements (user_id, earned_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_type_level
ON achievements (type, level);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_course_earned
ON achievements (course_id, earned_at) WHERE course_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_verification_code
ON achievements (verification_code) WHERE verification_code IS NOT NULL;

-- ==================================================
-- MEDIA AND FILE INDEXES
-- ==================================================

-- Media files indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_uploader_created
ON media_files (uploaded_by, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_mime_type
ON media_files (mime_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_size
ON media_files (size);

-- Video table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_course_lesson
ON videos (course_id, lesson_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_status_processed
ON videos (status) WHERE status = 'READY';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_media_file
ON videos (media_file_id);

-- Video watch progress indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_watch_progress_user_video
ON video_watch_progress (user_id, video_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_watch_progress_last_watched
ON video_watch_progress (last_watched DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_watch_progress_completed
ON video_watch_progress (completed, last_watched) WHERE completed = true;

-- ==================================================
-- SECURITY AND AUDIT INDEXES
-- ==================================================

-- Activity logs indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_user_action_created
ON activity_logs (user_id, action, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_action_created
ON activity_logs (action, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_resource_created
ON activity_logs (resource, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_ip_address
ON activity_logs (ip_address, created_at) WHERE ip_address IS NOT NULL;

-- Password reset tokens indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_reset_tokens_token_expires
ON password_reset_tokens (token, expires_at) WHERE used = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_reset_tokens_user_used
ON password_reset_tokens (user_id, used, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_reset_tokens_cleanup
ON password_reset_tokens (expires_at, used) WHERE used = false;

-- Email verification tokens indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_verification_tokens_token_expires
ON email_verification_tokens (token, expires_at) WHERE used = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_verification_tokens_email_used
ON email_verification_tokens (email, used, created_at);

-- Video streaming tokens indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_streaming_tokens_token_expires
ON video_streaming_tokens (token, expires_at) WHERE expires_at > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_streaming_tokens_user_video
ON video_streaming_tokens (user_id, video_id, expires_at);

-- Certificates indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_user_issued
ON certificates (user_id, issued_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_course_issued
ON certificates (course_id, issued_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificates_verification_code
ON certificates (verification_code);

-- ==================================================
-- PARTIAL INDEXES FOR COMMON FILTERS
-- ==================================================

-- Active users index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_recent_login
ON users (last_login DESC) WHERE is_active = true AND last_login IS NOT NULL;

-- Published courses with enrollment data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_published_popular
ON courses (enrollment_count DESC, average_rating DESC) WHERE status = 'PUBLISHED';

-- Active enrollments with progress
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_active_progress
ON enrollments (progress DESC, last_accessed_at DESC) WHERE status = 'ACTIVE';

-- Recent analytics events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_recent
ON analytics_events (timestamp DESC) WHERE timestamp >= (NOW() - INTERVAL '30 days');

-- ==================================================
-- FULL-TEXT SEARCH INDEXES
-- ==================================================

-- Full-text search for courses
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_fulltext
ON courses USING GIN (to_tsvector('english', title || ' ' || description));

-- Full-text search for lessons
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_fulltext
ON lessons USING GIN (to_tsvector('english', title || ' ' || content));

-- ==================================================
-- CLEANUP AND MAINTENANCE INDEXES
-- ==================================================

-- Indexes for cleanup operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_expired
ON user_sessions (expires_at) WHERE expires_at <= NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_old_read
ON notifications (created_at)
WHERE is_read = true AND created_at < (NOW() - INTERVAL '90 days');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_old
ON analytics_events (timestamp)
WHERE timestamp < (NOW() - INTERVAL '1 year');

-- ==================================================
-- STATISTICS UPDATE
-- ==================================================

-- Update table statistics for query planner
ANALYZE users;
ANALYZE courses;
ANALYZE enrollments;
ANALYZE progress;
ANALYZE analytics_events;
ANALYZE quiz_attempts;
ANALYZE notifications;
ANALYZE achievements;

-- ==================================================
-- INDEX USAGE MONITORING
-- ==================================================

-- Create a view to monitor index usage
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as index_tuples_read,
    idx_tup_fetch as index_tuples_fetched
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- ==================================================
-- COMMENTS FOR DOCUMENTATION
-- ==================================================

COMMENT ON INDEX idx_analytics_events_user_timestamp IS 'Critical index for user analytics queries';
COMMENT ON INDEX idx_courses_published_popular IS 'Supports course discovery and recommendation queries';
COMMENT ON INDEX idx_enrollments_user_course_unique IS 'Prevents duplicate enrollments and speeds up enrollment checks';
COMMENT ON INDEX idx_progress_user_lesson_unique IS 'Tracks individual lesson progress efficiently';

-- Final vacuum analyze to update statistics
VACUUM ANALYZE;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Database indexes created successfully! Run EXPLAIN ANALYZE on your queries to verify performance improvements.';
END $$;