-- Materialized Views for Analytics and Reporting
-- These views cache frequently accessed aggregated data for better performance

-- ==================================================
-- USER ANALYTICS MATERIALIZED VIEWS
-- ==================================================

-- User learning summary (refreshed daily)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_learning_summary AS
SELECT
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    u.role,
    u.organization_id,
    COUNT(DISTINCT e.course_id) as total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.course_id END) as completed_courses,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e.course_id END) as active_courses,
    AVG(CASE WHEN e.status = 'COMPLETED' THEN e.progress ELSE NULL END) as avg_completion_progress,
    MAX(e.last_accessed_at) as last_learning_activity,
    COUNT(DISTINCT a.id) as total_achievements,
    COUNT(DISTINCT c.id) as total_certificates,
    -- Time-based metrics
    COALESCE(SUM(
        CASE WHEN ae.event_type = 'module_completed'
        THEN (ae.data->>'properties'->>'timeSpent')::INTEGER
        ELSE 0 END
    ), 0) as total_learning_time_minutes,
    -- Engagement score (0-100)
    LEAST(100, GREATEST(0,
        CASE
            WHEN u.created_at > NOW() - INTERVAL '30 days' THEN 50
            ELSE 0
        END +
        CASE
            WHEN MAX(e.last_accessed_at) > NOW() - INTERVAL '7 days' THEN 25
            WHEN MAX(e.last_accessed_at) > NOW() - INTERVAL '30 days' THEN 15
            ELSE 0
        END +
        CASE
            WHEN COUNT(DISTINCT e.course_id) > 0 THEN 15
            ELSE 0
        END +
        CASE
            WHEN COUNT(DISTINCT a.id) > 0 THEN 10
            ELSE 0
        END
    )) as engagement_score,
    NOW() as last_refreshed
FROM users u
LEFT JOIN enrollments e ON u.id = e.user_id
LEFT JOIN achievements a ON u.id = a.user_id
LEFT JOIN certificates c ON u.id = c.user_id
LEFT JOIN analytics_events ae ON u.id = ae.user_id
WHERE u.is_active = true
GROUP BY u.id, u.first_name, u.last_name, u.email, u.role, u.organization_id, u.created_at;

-- Create indexes for the materialized view
CREATE INDEX idx_mv_user_learning_summary_user_id ON mv_user_learning_summary (user_id);
CREATE INDEX idx_mv_user_learning_summary_org ON mv_user_learning_summary (organization_id);
CREATE INDEX idx_mv_user_learning_summary_engagement ON mv_user_learning_summary (engagement_score DESC);
CREATE INDEX idx_mv_user_learning_summary_last_activity ON mv_user_learning_summary (last_learning_activity DESC);

-- ==================================================
-- COURSE ANALYTICS MATERIALIZED VIEWS
-- ==================================================

-- Course performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_course_performance AS
SELECT
    c.id as course_id,
    c.title,
    c.category,
    c.difficulty,
    c.created_by,
    c.organization_id,
    c.price,
    c.currency,
    -- Enrollment metrics
    COUNT(DISTINCT e.user_id) as total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e.user_id END) as active_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.user_id END) as completed_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'SUSPENDED' THEN e.user_id END) as suspended_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'WITHDRAWN' THEN e.user_id END) as withdrawn_enrollments,
    -- Completion metrics
    CASE
        WHEN COUNT(DISTINCT e.user_id) > 0
        THEN ROUND((COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e.user_id END)::NUMERIC / COUNT(DISTINCT e.user_id) * 100), 2)
        ELSE 0
    END as completion_rate_percent,
    AVG(e.progress) as average_progress,
    -- Revenue metrics
    COUNT(DISTINCT e.user_id) * c.price as total_revenue,
    -- Time metrics
    AVG(CASE
        WHEN e.completed_at IS NOT NULL AND e.enrolled_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (e.completed_at - e.enrolled_at)) / 86400 -- days
        ELSE NULL
    END) as avg_completion_days,
    -- Quiz performance
    COUNT(DISTINCT qa.id) as total_quiz_attempts,
    AVG(qa.score) as avg_quiz_score,
    COUNT(DISTINCT CASE WHEN qa.passed = true THEN qa.id END) as passed_quiz_attempts,
    -- Engagement metrics
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'course_viewed') as course_views,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'module_completed') as module_completions,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'video_watched') as video_watches,
    -- Activity dates
    MIN(e.enrolled_at) as first_enrollment_date,
    MAX(e.enrolled_at) as latest_enrollment_date,
    MAX(e.last_accessed_at) as last_activity_date,
    -- Calculated metrics
    CASE
        WHEN COUNT(DISTINCT e.user_id) = 0 THEN 0
        WHEN COUNT(DISTINCT e.user_id) <= 5 THEN 1
        WHEN COUNT(DISTINCT e.user_id) <= 20 THEN 2
        WHEN COUNT(DISTINCT e.user_id) <= 50 THEN 3
        WHEN COUNT(DISTINCT e.user_id) <= 100 THEN 4
        ELSE 5
    END as popularity_tier,
    NOW() as last_refreshed
FROM courses c
LEFT JOIN enrollments e ON c.id = e.course_id
LEFT JOIN modules m ON c.id = m.course_id
LEFT JOIN quizzes q ON m.id = q.module_id
LEFT JOIN quiz_attempts qa ON q.id = qa.quiz_id
LEFT JOIN analytics_events ae ON c.id = (ae.data->>'entityId')::text AND ae.data->>'entityType' = 'course'
WHERE c.status = 'PUBLISHED'
GROUP BY c.id, c.title, c.category, c.difficulty, c.created_by, c.organization_id, c.price, c.currency;

-- Create indexes for course performance view
CREATE INDEX idx_mv_course_performance_course_id ON mv_course_performance (course_id);
CREATE INDEX idx_mv_course_performance_category ON mv_course_performance (category);
CREATE INDEX idx_mv_course_performance_completion_rate ON mv_course_performance (completion_rate_percent DESC);
CREATE INDEX idx_mv_course_performance_enrollments ON mv_course_performance (total_enrollments DESC);
CREATE INDEX idx_mv_course_performance_revenue ON mv_course_performance (total_revenue DESC);
CREATE INDEX idx_mv_course_performance_popularity ON mv_course_performance (popularity_tier DESC);

-- ==================================================
-- DAILY ANALYTICS MATERIALIZED VIEW
-- ==================================================

-- Daily analytics summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_analytics AS
SELECT
    date_trunc('day', ae.timestamp) as analytics_date,
    -- User activity metrics
    COUNT(DISTINCT ae.user_id) as active_users,
    COUNT(DISTINCT ae.id) as total_events,
    -- Event type breakdown
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'course_viewed') as course_views,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'module_completed') as module_completions,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'quiz_attempted') as quiz_attempts,
    COUNT(DISTINCT ae.id) FILTER (WHERE ae.event_type = 'video_watched') as video_watches,
    -- New users and enrollments
    COUNT(DISTINCT u.id) FILTER (WHERE date_trunc('day', u.created_at) = date_trunc('day', ae.timestamp)) as new_users,
    COUNT(DISTINCT e.id) FILTER (WHERE date_trunc('day', e.enrolled_at) = date_trunc('day', ae.timestamp)) as new_enrollments,
    COUNT(DISTINCT e.id) FILTER (WHERE date_trunc('day', e.completed_at) = date_trunc('day', ae.timestamp)) as course_completions,
    -- Time spent (in minutes)
    COALESCE(SUM(
        CASE WHEN ae.event_type = 'module_completed'
        THEN (ae.data->>'properties'->>'timeSpent')::INTEGER
        ELSE 0 END
    ), 0) as total_learning_time_minutes,
    -- Unique courses accessed
    COUNT(DISTINCT
        CASE WHEN ae.data->>'entityType' = 'course'
        THEN ae.data->>'entityId'
        ELSE NULL END
    ) as unique_courses_accessed,
    NOW() as last_refreshed
FROM analytics_events ae
LEFT JOIN users u ON ae.user_id = u.id
LEFT JOIN enrollments e ON ae.user_id = e.user_id
    AND date_trunc('day', ae.timestamp) = date_trunc('day', e.enrolled_at)
WHERE ae.timestamp >= NOW() - INTERVAL '90 days'  -- Keep 90 days of daily data
GROUP BY date_trunc('day', ae.timestamp)
ORDER BY analytics_date DESC;

-- Create indexes for daily analytics
CREATE INDEX idx_mv_daily_analytics_date ON mv_daily_analytics (analytics_date DESC);
CREATE INDEX idx_mv_daily_analytics_active_users ON mv_daily_analytics (active_users DESC);
CREATE INDEX idx_mv_daily_analytics_total_events ON mv_daily_analytics (total_events DESC);

-- ==================================================
-- LEARNING PATH ANALYTICS
-- ==================================================

-- Learning path performance (if learning paths exist)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_learning_path_analytics AS
SELECT
    'path_placeholder' as path_id,
    'Sample Learning Path' as path_name,
    0 as total_enrollments,
    0 as completion_rate,
    0 as avg_time_to_complete,
    NOW() as last_refreshed
WHERE FALSE;  -- Placeholder view for future learning path feature

-- ==================================================
-- ORGANIZATION ANALYTICS
-- ==================================================

-- Organization performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_organization_analytics AS
SELECT
    o.id as organization_id,
    o.name as organization_name,
    o.code as organization_code,
    -- User metrics
    COUNT(DISTINCT u.id) as total_users,
    COUNT(DISTINCT u.id) FILTER (WHERE u.is_active = true) as active_users,
    COUNT(DISTINCT u.id) FILTER (WHERE u.last_login > NOW() - INTERVAL '30 days') as users_active_30d,
    COUNT(DISTINCT u.id) FILTER (WHERE u.last_login > NOW() - INTERVAL '7 days') as users_active_7d,
    -- Learning metrics
    COUNT(DISTINCT e.id) as total_enrollments,
    COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'COMPLETED') as completed_enrollments,
    COUNT(DISTINCT c_created.id) as courses_created,
    COUNT(DISTINCT c_published.id) as courses_published,
    -- Achievement metrics
    COUNT(DISTINCT a.id) as total_achievements,
    COUNT(DISTINCT cert.id) as total_certificates,
    -- Engagement metrics
    COALESCE(AVG(uls.engagement_score), 0) as avg_engagement_score,
    COALESCE(SUM(uls.total_learning_time_minutes), 0) as total_learning_time_minutes,
    -- Financial metrics (if applicable)
    COALESCE(SUM(cp.total_revenue), 0) as total_revenue,
    NOW() as last_refreshed
FROM organizations o
LEFT JOIN users u ON o.id = u.organization_id
LEFT JOIN enrollments e ON u.id = e.user_id
LEFT JOIN courses c_created ON o.id = c_created.organization_id
LEFT JOIN courses c_published ON o.id = c_published.organization_id AND c_published.status = 'PUBLISHED'
LEFT JOIN achievements a ON u.id = a.user_id
LEFT JOIN certificates cert ON u.id = cert.user_id
LEFT JOIN mv_user_learning_summary uls ON u.id = uls.user_id
LEFT JOIN mv_course_performance cp ON c_created.id = cp.course_id
WHERE o.is_active = true
GROUP BY o.id, o.name, o.code;

-- Create indexes for organization analytics
CREATE INDEX idx_mv_organization_analytics_org_id ON mv_organization_analytics (organization_id);
CREATE INDEX idx_mv_organization_analytics_total_users ON mv_organization_analytics (total_users DESC);
CREATE INDEX idx_mv_organization_analytics_engagement ON mv_organization_analytics (avg_engagement_score DESC);

-- ==================================================
-- QUIZ AND ASSESSMENT ANALYTICS
-- ==================================================

-- Quiz performance analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_quiz_analytics AS
SELECT
    q.id as quiz_id,
    q.title as quiz_title,
    m.id as module_id,
    m.title as module_title,
    c.id as course_id,
    c.title as course_title,
    -- Attempt metrics
    COUNT(DISTINCT qa.id) as total_attempts,
    COUNT(DISTINCT qa.user_id) as unique_test_takers,
    COUNT(DISTINCT qa.id) FILTER (WHERE qa.passed = true) as passed_attempts,
    -- Score metrics
    AVG(qa.score) as average_score,
    MIN(qa.score) as minimum_score,
    MAX(qa.score) as maximum_score,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qa.score) as median_score,
    -- Pass rate
    CASE
        WHEN COUNT(DISTINCT qa.id) > 0
        THEN ROUND((COUNT(DISTINCT qa.id) FILTER (WHERE qa.passed = true)::NUMERIC / COUNT(DISTINCT qa.id) * 100), 2)
        ELSE 0
    END as pass_rate_percent,
    -- Time metrics
    AVG(qa.time_spent) as avg_time_spent_seconds,
    -- Question performance
    COUNT(DISTINCT qu.id) as total_questions,
    AVG(qr.points_earned) as avg_points_per_question,
    -- Difficulty analysis
    CASE
        WHEN AVG(qa.score) >= 90 THEN 'Easy'
        WHEN AVG(qa.score) >= 70 THEN 'Moderate'
        WHEN AVG(qa.score) >= 50 THEN 'Challenging'
        ELSE 'Very Difficult'
    END as difficulty_rating,
    NOW() as last_refreshed
FROM quizzes q
JOIN modules m ON q.module_id = m.id
JOIN courses c ON m.course_id = c.id
LEFT JOIN quiz_attempts qa ON q.id = qa.quiz_id
LEFT JOIN questions qu ON q.id = qu.quiz_id
LEFT JOIN question_responses qr ON qa.id = qr.attempt_id
GROUP BY q.id, q.title, m.id, m.title, c.id, c.title;

-- Create indexes for quiz analytics
CREATE INDEX idx_mv_quiz_analytics_quiz_id ON mv_quiz_analytics (quiz_id);
CREATE INDEX idx_mv_quiz_analytics_course_id ON mv_quiz_analytics (course_id);
CREATE INDEX idx_mv_quiz_analytics_pass_rate ON mv_quiz_analytics (pass_rate_percent DESC);
CREATE INDEX idx_mv_quiz_analytics_difficulty ON mv_quiz_analytics (difficulty_rating);

-- ==================================================
-- VIDEO ENGAGEMENT ANALYTICS
-- ==================================================

-- Video watching analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_video_analytics AS
SELECT
    v.id as video_id,
    v.original_filename,
    v.course_id,
    c.title as course_title,
    v.lesson_id,
    l.title as lesson_title,
    -- Viewing metrics
    COUNT(DISTINCT vwp.user_id) as unique_viewers,
    COUNT(DISTINCT vwp.id) as total_watch_sessions,
    -- Completion metrics
    COUNT(DISTINCT vwp.id) FILTER (WHERE vwp.completed = true) as completed_watches,
    CASE
        WHEN COUNT(DISTINCT vwp.id) > 0
        THEN ROUND((COUNT(DISTINCT vwp.id) FILTER (WHERE vwp.completed = true)::NUMERIC / COUNT(DISTINCT vwp.id) * 100), 2)
        ELSE 0
    END as completion_rate_percent,
    -- Engagement metrics
    AVG(vwp.position) as avg_watch_position_seconds,
    AVG(vwp.duration) as avg_video_duration_seconds,
    AVG(CASE WHEN vwp.duration > 0 THEN (vwp.position::NUMERIC / vwp.duration * 100) ELSE 0 END) as avg_completion_percentage,
    -- Time-based metrics
    MAX(vwp.last_watched) as last_watched_date,
    MIN(vwp.last_watched) as first_watched_date,
    NOW() as last_refreshed
FROM videos v
LEFT JOIN courses c ON v.course_id = c.id
LEFT JOIN lessons l ON v.lesson_id = l.id
LEFT JOIN video_watch_progress vwp ON v.id = vwp.video_id
WHERE v.status = 'READY'
GROUP BY v.id, v.original_filename, v.course_id, c.title, v.lesson_id, l.title;

-- Create indexes for video analytics
CREATE INDEX idx_mv_video_analytics_video_id ON mv_video_analytics (video_id);
CREATE INDEX idx_mv_video_analytics_course_id ON mv_video_analytics (course_id);
CREATE INDEX idx_mv_video_analytics_completion_rate ON mv_video_analytics (completion_rate_percent DESC);
CREATE INDEX idx_mv_video_analytics_viewers ON mv_video_analytics (unique_viewers DESC);

-- ==================================================
-- REFRESH FUNCTIONS
-- ==================================================

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_analytics_views() RETURNS TEXT AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    duration INTERVAL;
    result TEXT;
BEGIN
    start_time := clock_timestamp();

    -- Refresh all materialized views
    REFRESH MATERIALIZED VIEW mv_user_learning_summary;
    REFRESH MATERIALIZED VIEW mv_course_performance;
    REFRESH MATERIALIZED VIEW mv_daily_analytics;
    REFRESH MATERIALIZED VIEW mv_organization_analytics;
    REFRESH MATERIALIZED VIEW mv_quiz_analytics;
    REFRESH MATERIALIZED VIEW mv_video_analytics;

    end_time := clock_timestamp();
    duration := end_time - start_time;

    result := format('All materialized views refreshed successfully in %s', duration);

    -- Log the refresh activity
    INSERT INTO analytics_events (id, user_id, event_type, data, timestamp)
    VALUES (
        'mv_refresh_' || extract(epoch from now()),
        'system',
        'materialized_views_refreshed',
        jsonb_build_object(
            'duration_seconds', extract(epoch from duration),
            'refresh_time', now(),
            'views_refreshed', 6
        ),
        now()
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh views concurrently (PostgreSQL 9.4+)
CREATE OR REPLACE FUNCTION refresh_analytics_views_concurrent() RETURNS TEXT AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    duration INTERVAL;
    result TEXT;
BEGIN
    start_time := clock_timestamp();

    -- Refresh materialized views concurrently for better performance
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_learning_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_course_performance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_analytics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_organization_analytics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_quiz_analytics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_video_analytics;

    end_time := clock_timestamp();
    duration := end_time - start_time;

    result := format('All materialized views refreshed concurrently in %s', duration);

    -- Log the refresh activity
    INSERT INTO analytics_events (id, user_id, event_type, data, timestamp)
    VALUES (
        'mv_refresh_concurrent_' || extract(epoch from now()),
        'system',
        'materialized_views_refreshed_concurrent',
        jsonb_build_object(
            'duration_seconds', extract(epoch from duration),
            'refresh_time', now(),
            'views_refreshed', 6
        ),
        now()
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- MONITORING AND MAINTENANCE
-- ==================================================

-- View to monitor materialized view sizes and last refresh times
CREATE OR REPLACE VIEW mv_monitoring AS
SELECT
    schemaname,
    matviewname as view_name,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) as size,
    pg_total_relation_size(schemaname||'.'||matviewname) as size_bytes,
    ispopulated,
    definition
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;

-- Function to get materialized view refresh recommendations
CREATE OR REPLACE FUNCTION get_mv_refresh_recommendations() RETURNS TABLE(
    view_name TEXT,
    size TEXT,
    last_refreshed TIMESTAMP,
    hours_since_refresh NUMERIC,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mv.matviewname::TEXT,
        pg_size_pretty(pg_total_relation_size('public.' || mv.matviewname))::TEXT,
        CASE
            WHEN mv.matviewname = 'mv_user_learning_summary' THEN
                (SELECT max(last_refreshed) FROM mv_user_learning_summary)
            WHEN mv.matviewname = 'mv_course_performance' THEN
                (SELECT max(last_refreshed) FROM mv_course_performance)
            WHEN mv.matviewname = 'mv_daily_analytics' THEN
                (SELECT max(last_refreshed) FROM mv_daily_analytics)
            WHEN mv.matviewname = 'mv_organization_analytics' THEN
                (SELECT max(last_refreshed) FROM mv_organization_analytics)
            WHEN mv.matviewname = 'mv_quiz_analytics' THEN
                (SELECT max(last_refreshed) FROM mv_quiz_analytics)
            WHEN mv.matviewname = 'mv_video_analytics' THEN
                (SELECT max(last_refreshed) FROM mv_video_analytics)
            ELSE NULL
        END as last_refresh_time,
        CASE
            WHEN mv.matviewname = 'mv_user_learning_summary' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_user_learning_summary))) / 3600
            WHEN mv.matviewname = 'mv_course_performance' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_course_performance))) / 3600
            WHEN mv.matviewname = 'mv_daily_analytics' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_daily_analytics))) / 3600
            WHEN mv.matviewname = 'mv_organization_analytics' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_organization_analytics))) / 3600
            WHEN mv.matviewname = 'mv_quiz_analytics' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_quiz_analytics))) / 3600
            WHEN mv.matviewname = 'mv_video_analytics' THEN
                EXTRACT(EPOCH FROM (NOW() - (SELECT max(last_refreshed) FROM mv_video_analytics))) / 3600
            ELSE NULL
        END as hours_since,
        CASE
            WHEN mv.matviewname IN ('mv_daily_analytics') AND
                 EXTRACT(EPOCH FROM (NOW() - COALESCE(
                     (SELECT max(last_refreshed) FROM mv_daily_analytics),
                     NOW() - INTERVAL '1 day'
                 ))) / 3600 > 6 THEN
                'URGENT: Refresh every 6 hours'
            WHEN mv.matviewname IN ('mv_user_learning_summary', 'mv_course_performance') AND
                 EXTRACT(EPOCH FROM (NOW() - COALESCE(
                     CASE mv.matviewname
                         WHEN 'mv_user_learning_summary' THEN (SELECT max(last_refreshed) FROM mv_user_learning_summary)
                         WHEN 'mv_course_performance' THEN (SELECT max(last_refreshed) FROM mv_course_performance)
                     END,
                     NOW() - INTERVAL '1 day'
                 ))) / 3600 > 24 THEN
                'RECOMMENDED: Refresh daily'
            WHEN mv.matviewname IN ('mv_organization_analytics', 'mv_quiz_analytics', 'mv_video_analytics') AND
                 EXTRACT(EPOCH FROM (NOW() - COALESCE(
                     CASE mv.matviewname
                         WHEN 'mv_organization_analytics' THEN (SELECT max(last_refreshed) FROM mv_organization_analytics)
                         WHEN 'mv_quiz_analytics' THEN (SELECT max(last_refreshed) FROM mv_quiz_analytics)
                         WHEN 'mv_video_analytics' THEN (SELECT max(last_refreshed) FROM mv_video_analytics)
                     END,
                     NOW() - INTERVAL '1 day'
                 ))) / 3600 > 168 THEN
                'SUGGESTED: Refresh weekly'
            ELSE
                'OK: No immediate refresh needed'
        END::TEXT
    FROM pg_matviews mv
    WHERE mv.schemaname = 'public'
    AND mv.matviewname LIKE 'mv_%'
    ORDER BY hours_since DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

-- Final success message
DO $$
BEGIN
    RAISE NOTICE 'Materialized views created successfully!';
    RAISE NOTICE 'Use refresh_all_analytics_views() to refresh all views.';
    RAISE NOTICE 'Use get_mv_refresh_recommendations() to get refresh recommendations.';
    RAISE NOTICE 'Monitor view performance with the mv_monitoring view.';
END $$;