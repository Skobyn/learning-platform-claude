-- Materialized Views for Learning Platform Analytics
-- High-performance pre-computed aggregations for 100K+ concurrent users

BEGIN;

-- ============================================================================
-- 1. User Performance Dashboard Views
-- ============================================================================

-- User learning summary with performance metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_learning_summary AS
SELECT
    u.id AS user_id,
    u."firstName",
    u."lastName",
    u.email,
    u.role,
    u."organizationId",

    -- Enrollment metrics
    COUNT(DISTINCT e.id) AS total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.id END) AS completed_courses,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e.id END) AS active_enrollments,

    -- Progress metrics
    COALESCE(AVG(e.progress), 0) AS average_progress,
    COALESCE(SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(e.id), 0), 0) AS completion_rate,

    -- Time-based metrics
    EXTRACT(EPOCH FROM (COALESCE(MAX(p."lastAccessedAt"), u."lastLogin") - MIN(e."enrolledAt"))) / 3600 AS total_learning_hours,

    -- Achievement metrics
    COUNT(DISTINCT a.id) AS total_achievements,
    COUNT(DISTINCT CASE WHEN a.type = 'CERTIFICATE' THEN a.id END) AS certificates_earned,
    COUNT(DISTINCT CASE WHEN a.level = 'GOLD' THEN a.id END) AS gold_badges,

    -- Quiz performance
    COUNT(DISTINCT qa.id) AS quiz_attempts,
    COALESCE(AVG(qa.score), 0) AS average_quiz_score,
    COUNT(DISTINCT CASE WHEN qa.passed = true THEN qa.id END) AS passed_quizzes,

    -- Activity metrics
    u."lastLogin",
    COALESCE(MAX(p."lastAccessedAt"), u."lastLogin") AS last_activity,

    -- Calculated fields
    CASE
        WHEN COALESCE(MAX(p."lastAccessedAt"), u."lastLogin") > NOW() - INTERVAL '7 days' THEN 'ACTIVE'
        WHEN COALESCE(MAX(p."lastAccessedAt"), u."lastLogin") > NOW() - INTERVAL '30 days' THEN 'INACTIVE'
        ELSE 'DORMANT'
    END AS activity_status,

    NOW() AS last_updated
FROM users u
LEFT JOIN enrollments e ON u.id = e."userId"
LEFT JOIN progress p ON u.id = p."userId"
LEFT JOIN achievements a ON u.id = a."userId"
LEFT JOIN quiz_attempts qa ON u.id = qa."userId" AND qa."submittedAt" IS NOT NULL
WHERE u."isActive" = true
GROUP BY u.id, u."firstName", u."lastName", u.email, u.role, u."organizationId", u."lastLogin";

CREATE UNIQUE INDEX ON mv_user_learning_summary (user_id);
CREATE INDEX ON mv_user_learning_summary ("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE INDEX ON mv_user_learning_summary (activity_status);
CREATE INDEX ON mv_user_learning_summary (completion_rate DESC);
CREATE INDEX ON mv_user_learning_summary (total_achievements DESC);

-- ============================================================================
-- 2. Course Performance Analytics Views
-- ============================================================================

-- Comprehensive course analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_course_analytics AS
SELECT
    c.id AS course_id,
    c.title,
    c.description,
    c.category,
    c.difficulty,
    c."estimatedDuration",
    c.price,
    c."averageRating",
    c.status,
    c."publishedAt",

    -- Creator information
    u."firstName" || ' ' || u."lastName" AS creator_name,
    u.id AS creator_id,

    -- Enrollment metrics
    COUNT(DISTINCT e.id) AS total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.id END) AS completed_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e.id END) AS active_enrollments,
    COUNT(DISTINCT CASE WHEN e."enrolledAt" >= NOW() - INTERVAL '30 days' THEN e.id END) AS recent_enrollments,

    -- Progress and completion metrics
    COALESCE(AVG(e.progress), 0) AS average_progress,
    COALESCE(
        COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.id END) * 100.0 /
        NULLIF(COUNT(DISTINCT e.id), 0), 0
    ) AS completion_rate,

    -- Time-based metrics
    COALESCE(AVG(CASE WHEN e."completedAt" IS NOT NULL
        THEN EXTRACT(EPOCH FROM (e."completedAt" - e."enrolledAt")) / (24 * 3600)
    END), 0) AS average_completion_days,

    -- Module and content metrics
    COUNT(DISTINCT m.id) AS total_modules,
    COUNT(DISTINCT l.id) AS total_lessons,
    COUNT(DISTINCT q.id) AS total_quizzes,

    -- Assessment performance
    COUNT(DISTINCT qa.id) AS total_quiz_attempts,
    COALESCE(AVG(qa.score), 0) AS average_quiz_score,
    COALESCE(
        COUNT(DISTINCT CASE WHEN qa.passed = true THEN qa.id END) * 100.0 /
        NULLIF(COUNT(DISTINCT qa.id), 0), 0
    ) AS quiz_pass_rate,

    -- Engagement metrics
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'course_viewed') AS course_views,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'module_completed') AS module_completions,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'video_watched') AS video_watches,

    -- Revenue metrics (if applicable)
    COALESCE(SUM(CASE WHEN c.price > 0 AND e.status IN ('ACTIVE', 'COMPLETED')
        THEN c.price ELSE 0 END), 0) AS total_revenue,

    -- Quality indicators
    CASE
        WHEN COUNT(DISTINCT e.id) >= 100 AND
             AVG(e.progress) >= 75 AND
             COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.id END) * 100.0 /
             NULLIF(COUNT(DISTINCT e.id), 0) >= 60
        THEN 'HIGH_PERFORMING'
        WHEN COUNT(DISTINCT e.id) >= 50 AND
             AVG(e.progress) >= 50
        THEN 'GOOD_PERFORMING'
        WHEN COUNT(DISTINCT e.id) >= 10
        THEN 'AVERAGE_PERFORMING'
        ELSE 'LOW_PERFORMING'
    END AS performance_category,

    NOW() AS last_updated
FROM courses c
LEFT JOIN users u ON c."createdBy" = u.id
LEFT JOIN enrollments e ON c.id = e."courseId"
LEFT JOIN modules m ON c.id = m."courseId"
LEFT JOIN lessons l ON m.id = l."moduleId"
LEFT JOIN quizzes q ON m.id = q."moduleId"
LEFT JOIN quiz_attempts qa ON q.id = qa."quizId" AND qa."submittedAt" IS NOT NULL
LEFT JOIN analytics_events ae ON ae.data->>'entityId' = c.id AND ae.data->>'entityType' = 'course'
WHERE c.status = 'PUBLISHED'
GROUP BY c.id, c.title, c.description, c.category, c.difficulty, c."estimatedDuration",
         c.price, c."averageRating", c.status, c."publishedAt", u."firstName", u."lastName", u.id;

CREATE UNIQUE INDEX ON mv_course_analytics (course_id);
CREATE INDEX ON mv_course_analytics (category);
CREATE INDEX ON mv_course_analytics (difficulty);
CREATE INDEX ON mv_course_analytics (performance_category);
CREATE INDEX ON mv_course_analytics (completion_rate DESC);
CREATE INDEX ON mv_course_analytics (total_enrollments DESC);
CREATE INDEX ON mv_course_analytics (total_revenue DESC);

-- ============================================================================
-- 3. Platform-wide Dashboard Views
-- ============================================================================

-- Daily platform metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_platform_metrics AS
SELECT
    DATE(ae."timestamp") AS metric_date,

    -- User activity metrics
    COUNT(DISTINCT ae."userId") FILTER (WHERE ae."userId" IS NOT NULL) AS daily_active_users,
    COUNT(DISTINCT ae."sessionId") FILTER (WHERE ae."sessionId" IS NOT NULL) AS unique_sessions,

    -- Content consumption metrics
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'course_viewed') AS course_views,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'lesson_started') AS lessons_started,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'lesson_completed') AS lessons_completed,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'module_completed') AS modules_completed,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'video_watched') AS videos_watched,

    -- Assessment metrics
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'quiz_attempted') AS quiz_attempts,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae."eventType" = 'quiz_passed') AS quiz_passes,

    -- Enrollment metrics from same day
    COUNT(DISTINCT e.id) FILTER (WHERE DATE(e."enrolledAt") = DATE(ae."timestamp")) AS new_enrollments,
    COUNT(DISTINCT e.id) FILTER (WHERE DATE(e."completedAt") = DATE(ae."timestamp")) AS course_completions,

    -- Engagement quality metrics
    COUNT(DISTINCT ae.id) AS total_events,
    ROUND(AVG(
        CASE WHEN ae."eventType" IN ('lesson_completed', 'module_completed', 'quiz_passed')
        THEN 1.0 ELSE 0.0 END
    ), 3) AS engagement_quality_score,

    -- Time-based insights
    EXTRACT(DOW FROM DATE(ae."timestamp")) AS day_of_week,
    CASE
        WHEN EXTRACT(DOW FROM DATE(ae."timestamp")) IN (0, 6) THEN 'WEEKEND'
        ELSE 'WEEKDAY'
    END AS day_type

FROM analytics_events ae
LEFT JOIN enrollments e ON DATE(e."enrolledAt") = DATE(ae."timestamp") OR DATE(e."completedAt") = DATE(ae."timestamp")
WHERE ae."timestamp" >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(ae."timestamp")
ORDER BY metric_date DESC;

CREATE UNIQUE INDEX ON mv_daily_platform_metrics (metric_date);
CREATE INDEX ON mv_daily_platform_metrics (day_of_week);
CREATE INDEX ON mv_daily_platform_metrics (day_type);
CREATE INDEX ON mv_daily_platform_metrics (daily_active_users DESC);

-- ============================================================================
-- 4. Learning Path Performance Views
-- ============================================================================

-- Module completion funnel analysis
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_module_completion_funnel AS
SELECT
    c.id AS course_id,
    c.title AS course_title,
    c.category,
    m.id AS module_id,
    m.title AS module_title,
    m."orderIndex",

    -- Enrollment funnel metrics
    COUNT(DISTINCT e."userId") AS enrolled_users,
    COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0) AS users_started,
    COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" >= 50) AS users_halfway,
    COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" = 100) AS users_completed,

    -- Conversion rates
    ROUND(
        COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0) * 100.0 /
        NULLIF(COUNT(DISTINCT e."userId"), 0), 2
    ) AS start_rate,

    ROUND(
        COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" = 100) * 100.0 /
        NULLIF(COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0), 0), 2
    ) AS completion_rate,

    -- Dropoff analysis
    COUNT(DISTINCT e."userId") - COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0) AS never_started,
    COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0 AND p."completionPercentage" < 100) AS started_not_completed,

    -- Time metrics
    AVG(p."timeSpent") FILTER (WHERE p."completionPercentage" = 100) AS avg_completion_time_minutes,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p."timeSpent") FILTER (WHERE p."completionPercentage" = 100) AS median_completion_time,

    -- Difficulty indicators
    CASE
        WHEN ROUND(
            COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" = 100) * 100.0 /
            NULLIF(COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0), 0), 2
        ) >= 80 THEN 'EASY'
        WHEN ROUND(
            COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" = 100) * 100.0 /
            NULLIF(COUNT(DISTINCT p."userId") FILTER (WHERE p."completionPercentage" > 0), 0), 2
        ) >= 60 THEN 'MODERATE'
        ELSE 'DIFFICULT'
    END AS difficulty_assessment,

    NOW() AS last_updated

FROM courses c
JOIN modules m ON c.id = m."courseId"
LEFT JOIN enrollments e ON c.id = e."courseId"
LEFT JOIN progress p ON m.id = p."moduleId" AND e."userId" = p."userId"
WHERE c.status = 'PUBLISHED'
GROUP BY c.id, c.title, c.category, m.id, m.title, m."orderIndex"
ORDER BY c.id, m."orderIndex";

CREATE UNIQUE INDEX ON mv_module_completion_funnel (course_id, module_id);
CREATE INDEX ON mv_module_completion_funnel (course_id);
CREATE INDEX ON mv_module_completion_funnel (completion_rate DESC);
CREATE INDEX ON mv_module_completion_funnel (difficulty_assessment);

-- ============================================================================
-- 5. Real-time Analytics Views
-- ============================================================================

-- Hourly activity heatmap
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_activity_heatmap AS
SELECT
    EXTRACT(HOUR FROM ae."timestamp") AS hour_of_day,
    EXTRACT(DOW FROM ae."timestamp") AS day_of_week,
    DATE_TRUNC('day', ae."timestamp") AS activity_date,

    COUNT(DISTINCT ae."userId") AS unique_users,
    COUNT(DISTINCT ae."sessionId") AS unique_sessions,
    COUNT(*) AS total_events,

    -- Event type breakdown
    COUNT(*) FILTER (WHERE ae."eventType" = 'course_viewed') AS course_views,
    COUNT(*) FILTER (WHERE ae."eventType" = 'lesson_started') AS lesson_starts,
    COUNT(*) FILTER (WHERE ae."eventType" = 'lesson_completed') AS lesson_completions,
    COUNT(*) FILTER (WHERE ae."eventType" = 'quiz_attempted') AS quiz_attempts,
    COUNT(*) FILTER (WHERE ae."eventType" = 'video_watched') AS video_views,

    -- Peak activity indicator
    CASE
        WHEN EXTRACT(HOUR FROM ae."timestamp") BETWEEN 9 AND 11 OR
             EXTRACT(HOUR FROM ae."timestamp") BETWEEN 14 AND 16 OR
             EXTRACT(HOUR FROM ae."timestamp") BETWEEN 19 AND 21
        THEN 'PEAK'
        WHEN EXTRACT(HOUR FROM ae."timestamp") BETWEEN 0 AND 6
        THEN 'OFF_PEAK'
        ELSE 'NORMAL'
    END AS activity_period,

    AVG(COUNT(*)) OVER (
        PARTITION BY EXTRACT(HOUR FROM ae."timestamp"), EXTRACT(DOW FROM ae."timestamp")
    ) AS avg_events_this_hour_dow

FROM analytics_events ae
WHERE ae."timestamp" >= CURRENT_DATE - INTERVAL '30 days'
    AND ae."userId" IS NOT NULL
GROUP BY EXTRACT(HOUR FROM ae."timestamp"), EXTRACT(DOW FROM ae."timestamp"), DATE_TRUNC('day', ae."timestamp")
ORDER BY activity_date DESC, hour_of_day;

CREATE INDEX ON mv_hourly_activity_heatmap (hour_of_day, day_of_week);
CREATE INDEX ON mv_hourly_activity_heatmap (activity_date);
CREATE INDEX ON mv_hourly_activity_heatmap (activity_period);
CREATE INDEX ON mv_hourly_activity_heatmap (unique_users DESC);

-- ============================================================================
-- 6. Instructor Performance Views
-- ============================================================================

-- Instructor dashboard metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_instructor_performance AS
SELECT
    u.id AS instructor_id,
    u."firstName" || ' ' || u."lastName" AS instructor_name,
    u.email,
    u."organizationId",

    -- Course creation metrics
    COUNT(DISTINCT c.id) AS total_courses,
    COUNT(DISTINCT CASE WHEN c.status = 'PUBLISHED' THEN c.id END) AS published_courses,
    COUNT(DISTINCT CASE WHEN c."publishedAt" >= NOW() - INTERVAL '30 days' THEN c.id END) AS recent_courses,

    -- Student reach metrics
    COUNT(DISTINCT e."userId") AS total_students,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e."userId" END) AS active_students,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e."userId" END) AS students_completed,

    -- Course performance metrics
    COALESCE(AVG(c."averageRating"), 0) AS average_course_rating,
    COALESCE(AVG(e.progress), 0) AS average_student_progress,
    COALESCE(
        COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e."userId" END) * 100.0 /
        NULLIF(COUNT(DISTINCT e."userId"), 0), 0
    ) AS student_completion_rate,

    -- Content volume metrics
    COUNT(DISTINCT m.id) AS total_modules,
    COUNT(DISTINCT l.id) AS total_lessons,
    COUNT(DISTINCT q.id) AS total_quizzes,
    SUM(DISTINCT c."estimatedDuration") AS total_content_hours,

    -- Assessment performance
    COUNT(DISTINCT qa.id) AS total_quiz_attempts,
    COALESCE(AVG(qa.score), 0) AS average_quiz_score,
    COALESCE(
        COUNT(DISTINCT CASE WHEN qa.passed = true THEN qa.id END) * 100.0 /
        NULLIF(COUNT(DISTINCT qa.id), 0), 0
    ) AS quiz_pass_rate,

    -- Revenue metrics
    COALESCE(SUM(CASE WHEN c.price > 0 AND e.status IN ('ACTIVE', 'COMPLETED')
        THEN c.price ELSE 0 END), 0) AS total_revenue,

    -- Engagement metrics
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.data->>'entityType' = 'course') AS course_interactions,

    -- Quality indicators
    CASE
        WHEN AVG(c."averageRating") >= 4.5 AND
             COUNT(DISTINCT e."userId") >= 100 AND
             AVG(e.progress) >= 75
        THEN 'TOP_PERFORMER'
        WHEN AVG(c."averageRating") >= 4.0 AND
             COUNT(DISTINCT e."userId") >= 50
        THEN 'HIGH_PERFORMER'
        WHEN AVG(c."averageRating") >= 3.5 AND
             COUNT(DISTINCT e."userId") >= 10
        THEN 'GOOD_PERFORMER'
        ELSE 'DEVELOPING'
    END AS performance_tier,

    NOW() AS last_updated

FROM users u
LEFT JOIN courses c ON u.id = c."createdBy"
LEFT JOIN enrollments e ON c.id = e."courseId"
LEFT JOIN modules m ON c.id = m."courseId"
LEFT JOIN lessons l ON m.id = l."moduleId"
LEFT JOIN quizzes q ON m.id = q."moduleId"
LEFT JOIN quiz_attempts qa ON q.id = qa."quizId" AND qa."submittedAt" IS NOT NULL
LEFT JOIN analytics_events ae ON ae.data->>'entityId' = c.id
WHERE u.role = 'INSTRUCTOR' AND u."isActive" = true
GROUP BY u.id, u."firstName", u."lastName", u.email, u."organizationId"
HAVING COUNT(DISTINCT c.id) > 0;

CREATE UNIQUE INDEX ON mv_instructor_performance (instructor_id);
CREATE INDEX ON mv_instructor_performance ("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE INDEX ON mv_instructor_performance (performance_tier);
CREATE INDEX ON mv_instructor_performance (total_students DESC);
CREATE INDEX ON mv_instructor_performance (total_revenue DESC);

-- ============================================================================
-- 7. View Refresh Management
-- ============================================================================

-- Function to refresh all materialized views efficiently
CREATE OR REPLACE FUNCTION refresh_all_analytics_views(concurrent_refresh boolean DEFAULT true)
RETURNS TABLE(view_name text, refresh_time interval, status text) AS $$
DECLARE
    view_record RECORD;
    start_time timestamp;
    end_time timestamp;
    refresh_command text;
BEGIN
    FOR view_record IN
        SELECT schemaname, matviewname
        FROM pg_matviews
        WHERE schemaname = 'public'
        AND matviewname LIKE 'mv_%'
        ORDER BY matviewname
    LOOP
        start_time := clock_timestamp();

        BEGIN
            refresh_command := format('REFRESH MATERIALIZED VIEW %s %I.%I',
                CASE WHEN concurrent_refresh THEN 'CONCURRENTLY' ELSE '' END,
                view_record.schemaname,
                view_record.matviewname
            );

            EXECUTE refresh_command;

            end_time := clock_timestamp();

            RETURN QUERY SELECT
                view_record.matviewname::text,
                end_time - start_time,
                'SUCCESS'::text;

        EXCEPTION WHEN OTHERS THEN
            end_time := clock_timestamp();

            RETURN QUERY SELECT
                view_record.matviewname::text,
                end_time - start_time,
                ('ERROR: ' || SQLERRM)::text;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to get materialized view statistics
CREATE OR REPLACE FUNCTION get_materialized_view_stats()
RETURNS TABLE(
    view_name text,
    size_pretty text,
    row_count bigint,
    last_refresh timestamp,
    index_count bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mv.matviewname::text,
        pg_size_pretty(pg_total_relation_size(mv.schemaname||'.'||mv.matviewname))::text,
        COALESCE(c.reltuples::bigint, 0),
        GREATEST(
            pg_stat_get_last_analyze_time(c.oid),
            pg_stat_get_last_autoanalyze_time(c.oid)
        ),
        COUNT(i.indexrelid)
    FROM pg_matviews mv
    LEFT JOIN pg_class c ON c.relname = mv.matviewname
    LEFT JOIN pg_index i ON i.indrelid = c.oid
    WHERE mv.schemaname = 'public'
    AND mv.matviewname LIKE 'mv_%'
    GROUP BY mv.schemaname, mv.matviewname, c.reltuples, c.oid
    ORDER BY pg_total_relation_size(mv.schemaname||'.'||mv.matviewname) DESC;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- Initial refresh of all views (run this after creating the views)
-- SELECT * FROM refresh_all_analytics_views(false);

-- Example queries to test the materialized views:

-- Get top performing courses
-- SELECT * FROM mv_course_analytics
-- WHERE performance_category = 'HIGH_PERFORMING'
-- ORDER BY total_enrollments DESC
-- LIMIT 10;

-- Get instructor leaderboard
-- SELECT * FROM mv_instructor_performance
-- WHERE performance_tier IN ('TOP_PERFORMER', 'HIGH_PERFORMER')
-- ORDER BY total_students DESC
-- LIMIT 20;

-- Get daily platform activity
-- SELECT * FROM mv_daily_platform_metrics
-- WHERE metric_date >= CURRENT_DATE - INTERVAL '7 days'
-- ORDER BY metric_date DESC;

-- Get user learning progress
-- SELECT * FROM mv_user_learning_summary
-- WHERE activity_status = 'ACTIVE'
-- ORDER BY completion_rate DESC
-- LIMIT 50;