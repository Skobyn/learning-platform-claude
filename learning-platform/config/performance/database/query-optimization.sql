-- Database Performance Optimization Recommendations
-- Learning Platform - PostgreSQL Optimizations

-- ============================================================================
-- INDEX OPTIMIZATION
-- ============================================================================

-- User Performance Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active 
ON users(email) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_role 
ON users(organization_id, role) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login 
ON users(last_login DESC) WHERE is_active = true;

-- Session Management Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_token_valid 
ON user_sessions(token) WHERE expires_at > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_cleanup 
ON user_sessions(expires_at) WHERE expires_at < NOW();

-- Course Performance Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_status_published 
ON courses(status, published_at DESC) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_category_difficulty 
ON courses(category, difficulty) WHERE status = 'PUBLISHED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_creator_org 
ON courses(created_by, organization_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_search 
ON courses USING gin(to_tsvector('english', title || ' ' || description));

-- Module and Lesson Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modules_course_order 
ON modules(course_id, order_index);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lessons_module_order 
ON lessons(module_id, order_index);

-- Progress Tracking Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_user_lesson 
ON progress(user_id, lesson_id, last_accessed_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progress_completion 
ON progress(user_id, completion_percentage) WHERE completion_percentage = 100;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_user_active 
ON enrollments(user_id, status) WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_stats 
ON enrollments(course_id, status, enrolled_at DESC);

-- Quiz and Assessment Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_user_quiz 
ON quiz_attempts(user_id, quiz_id, started_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_attempts_completion 
ON quiz_attempts(quiz_id, passed, score DESC) WHERE submitted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_questions_quiz_order 
ON questions(quiz_id, order_index);

-- Analytics and Reporting Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_type_time 
ON analytics_events(event_type, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_events_user_time 
ON analytics_events(user_id, timestamp DESC) WHERE user_id IS NOT NULL;

-- Notification Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread 
ON notifications(user_id, created_at DESC) WHERE is_read = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_cleanup 
ON notifications(created_at) WHERE created_at < NOW() - INTERVAL '90 days';

-- ============================================================================
-- QUERY PERFORMANCE ANALYSIS
-- ============================================================================

-- View for analyzing slow queries
CREATE OR REPLACE VIEW slow_queries AS
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    stddev_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements
ORDER BY mean_time DESC;

-- Function to analyze table bloat
CREATE OR REPLACE FUNCTION analyze_table_bloat()
RETURNS TABLE(
    schemaname text,
    tablename text,
    attname text,
    n_distinct real,
    correlation real,
    null_frac real,
    avg_width integer,
    n_dead_tup bigint,
    n_live_tup bigint,
    bloat_percent numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::text,
        s.tablename::text,
        a.attname::text,
        s.n_distinct,
        s.correlation,
        s.null_frac,
        s.avg_width,
        st.n_dead_tup,
        st.n_live_tup,
        CASE 
            WHEN st.n_live_tup > 0 
            THEN round((st.n_dead_tup::numeric / st.n_live_tup::numeric) * 100, 2)
            ELSE 0 
        END as bloat_percent
    FROM pg_stats s
    JOIN pg_stat_user_tables st ON s.tablename = st.relname AND s.schemaname = st.schemaname
    JOIN pg_attribute a ON a.attname = s.attname
    JOIN pg_class c ON c.relname = s.tablename
    WHERE s.schemaname = 'public'
    ORDER BY bloat_percent DESC, st.n_dead_tup DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MAINTENANCE PROCEDURES
-- ============================================================================

-- Automated cleanup procedure for old sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions 
    WHERE expires_at < NOW() - INTERVAL '1 day';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO analytics_events (event_type, data, timestamp)
    VALUES ('session_cleanup', jsonb_build_object('deleted_count', deleted_count), NOW());
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Automated cleanup for old notifications
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications 
    WHERE created_at < NOW() - INTERVAL '90 days' AND is_read = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO analytics_events (event_type, data, timestamp)
    VALUES ('notification_cleanup', jsonb_build_object('deleted_count', deleted_count), NOW());
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Update course statistics procedure
CREATE OR REPLACE FUNCTION update_course_statistics()
RETURNS VOID AS $$
BEGIN
    UPDATE courses 
    SET 
        enrollment_count = (
            SELECT COUNT(*) 
            FROM enrollments 
            WHERE course_id = courses.id AND status = 'ACTIVE'
        ),
        average_rating = (
            SELECT AVG(
                CASE 
                    WHEN qa.passed THEN 
                        CASE 
                            WHEN qa.score >= 90 THEN 5
                            WHEN qa.score >= 80 THEN 4
                            WHEN qa.score >= 70 THEN 3
                            WHEN qa.score >= 60 THEN 2
                            ELSE 1
                        END
                    ELSE 1
                END
            )
            FROM quiz_attempts qa
            JOIN quizzes q ON qa.quiz_id = q.id
            JOIN modules m ON q.module_id = m.id
            WHERE m.course_id = courses.id AND qa.submitted_at IS NOT NULL
        )
    WHERE status = 'PUBLISHED';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SCHEDULED MAINTENANCE (to be run with pg_cron)
-- ============================================================================

-- Schedule daily cleanup tasks
-- SELECT cron.schedule('cleanup-sessions', '0 2 * * *', 'SELECT cleanup_expired_sessions();');
-- SELECT cron.schedule('cleanup-notifications', '0 3 * * *', 'SELECT cleanup_old_notifications();');
-- SELECT cron.schedule('update-course-stats', '0 4 * * *', 'SELECT update_course_statistics();');

-- Weekly ANALYZE for statistics update
-- SELECT cron.schedule('weekly-analyze', '0 1 * * 0', 'ANALYZE;');

-- Monthly VACUUM for space reclamation
-- SELECT cron.schedule('monthly-vacuum', '0 0 1 * *', 'VACUUM (ANALYZE, VERBOSE);');

-- ============================================================================
-- PERFORMANCE MONITORING QUERIES
-- ============================================================================

-- Monitor index usage
CREATE OR REPLACE VIEW index_usage AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    CASE 
        WHEN idx_tup_read > 0 
        THEN (idx_tup_fetch / idx_tup_read)::numeric(10,2)
        ELSE 0 
    END as selectivity
FROM pg_stat_user_indexes
ORDER BY idx_tup_read DESC;

-- Monitor table sizes
CREATE OR REPLACE VIEW table_sizes AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================================================
-- QUERY OPTIMIZATION RECOMMENDATIONS
-- ============================================================================

/*
Performance Recommendations:

1. CONNECTION POOLING:
   - Use pgbouncer with transaction pooling mode
   - Configure max 100-200 connections total
   - Set pool size based on CPU cores (4-8 per core)

2. QUERY PATTERNS TO AVOID:
   - N+1 queries (use joins or batch loading)
   - SELECT * without WHERE clauses
   - Missing ORDER BY with LIMIT
   - Unindexed JSON queries

3. CACHING STRATEGY:
   - Cache frequent course listings (Redis)
   - Cache user sessions and preferences
   - Implement query result caching for read-heavy operations
   - Use materialized views for complex aggregations

4. PARTITIONING CONSIDERATIONS:
   - Partition analytics_events by timestamp (monthly)
   - Consider partitioning large progress tables by user_id
   - Partition notifications by created_at (quarterly)

5. REGULAR MAINTENANCE:
   - Run VACUUM ANALYZE weekly
   - Monitor and rebuild bloated indexes
   - Update table statistics after bulk operations
   - Archive old data to separate tables
*/