-- Database Partitioning Strategy for Learning Platform Analytics
-- Optimized for high-volume time-series data and 100K+ concurrent users

BEGIN;

-- ============================================================================
-- Analytics Events Table Partitioning (Time-based partitioning)
-- ============================================================================

-- Create partitioned analytics_events table
DROP TABLE IF EXISTS analytics_events_new CASCADE;
CREATE TABLE analytics_events_new (
    id text NOT NULL,
    "userId" text,
    "eventType" text NOT NULL,
    data jsonb NOT NULL,
    metadata jsonb,
    "sessionId" text,
    timestamp timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT analytics_events_new_pkey PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for the current year and next 6 months
DO $partition$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
    current_month date;
BEGIN
    -- Start from 6 months ago
    current_month := date_trunc('month', CURRENT_DATE - interval '6 months');

    FOR i IN 0..18 LOOP  -- 18 months total (6 past + 12 future)
        start_date := current_month + (i || ' months')::interval;
        end_date := start_date + interval '1 month';
        partition_name := 'analytics_events_' || to_char(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE %I PARTITION OF analytics_events_new
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Add indexes for each partition
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", "eventType")',
            'idx_' || partition_name || '_user_event', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("eventType", timestamp)',
            'idx_' || partition_name || '_event_time', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("sessionId") WHERE "sessionId" IS NOT NULL',
            'idx_' || partition_name || '_session', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I USING gin(data)',
            'idx_' || partition_name || '_data', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I USING gin((data->>''entityType''))',
            'idx_' || partition_name || '_entity_type', partition_name);
    END LOOP;
END
$partition$;

-- Create default partition for data outside the range
CREATE TABLE analytics_events_default PARTITION OF analytics_events_new DEFAULT;

-- Migrate existing data (if any) to the partitioned table
INSERT INTO analytics_events_new
SELECT * FROM analytics_events
ON CONFLICT (id, timestamp) DO NOTHING;

-- Rename tables to swap them
ALTER TABLE analytics_events RENAME TO analytics_events_old;
ALTER TABLE analytics_events_new RENAME TO analytics_events;

-- Update sequence if exists
DO $sequence$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_name = 'analytics_events_old_id_seq') THEN
        ALTER SEQUENCE analytics_events_old_id_seq RENAME TO analytics_events_id_seq;
    END IF;
END
$sequence$;

-- ============================================================================
-- Activity Logs Table Partitioning (Time-based partitioning)
-- ============================================================================

-- Create partitioned activity_logs table
DROP TABLE IF EXISTS activity_logs_new CASCADE;
CREATE TABLE activity_logs_new (
    id text NOT NULL,
    "userId" text NOT NULL,
    action text NOT NULL,
    resource text NOT NULL,
    details jsonb,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT activity_logs_new_pkey PRIMARY KEY (id, "createdAt")
) PARTITION BY RANGE ("createdAt");

-- Create monthly partitions for activity logs
DO $partition$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
    current_month date;
BEGIN
    -- Start from 3 months ago (shorter retention for activity logs)
    current_month := date_trunc('month', CURRENT_DATE - interval '3 months');

    FOR i IN 0..15 LOOP  -- 15 months total (3 past + 12 future)
        start_date := current_month + (i || ' months')::interval;
        end_date := start_date + interval '1 month';
        partition_name := 'activity_logs_' || to_char(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE %I PARTITION OF activity_logs_new
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Add indexes for each partition
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", action)',
            'idx_' || partition_name || '_user_action', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I (action, "createdAt")',
            'idx_' || partition_name || '_action_time', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I (resource)',
            'idx_' || partition_name || '_resource', partition_name);
    END LOOP;
END
$partition$;

-- Create default partition
CREATE TABLE activity_logs_default PARTITION OF activity_logs_new DEFAULT;

-- Migrate existing data
INSERT INTO activity_logs_new
SELECT * FROM activity_logs
ON CONFLICT (id, "createdAt") DO NOTHING;

-- Swap tables
ALTER TABLE activity_logs RENAME TO activity_logs_old;
ALTER TABLE activity_logs_new RENAME TO activity_logs;

-- ============================================================================
-- User Sessions Table Partitioning (Hash-based for even distribution)
-- ============================================================================

-- Create partitioned user_sessions table based on userId hash
DROP TABLE IF EXISTS user_sessions_new CASCADE;
CREATE TABLE user_sessions_new (
    id text NOT NULL,
    "userId" text NOT NULL,
    token text NOT NULL,
    "expiresAt" timestamp(3) NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_sessions_new_pkey PRIMARY KEY (id, "userId"),
    CONSTRAINT user_sessions_new_token_key UNIQUE (token)
) PARTITION BY HASH ("userId");

-- Create hash partitions (8 partitions for good distribution)
DO $hash_partition$
DECLARE
    partition_name text;
BEGIN
    FOR i IN 0..7 LOOP
        partition_name := 'user_sessions_' || i;

        EXECUTE format('
            CREATE TABLE %I PARTITION OF user_sessions_new
            FOR VALUES WITH (modulus 8, remainder %s)',
            partition_name, i
        );

        -- Add indexes for each hash partition
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I (token)',
            'idx_' || partition_name || '_token', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("expiresAt")',
            'idx_' || partition_name || '_expires', partition_name);
    END LOOP;
END
$hash_partition$;

-- Migrate existing data
INSERT INTO user_sessions_new
SELECT * FROM user_sessions
ON CONFLICT (id, "userId") DO NOTHING;

-- Swap tables
ALTER TABLE user_sessions RENAME TO user_sessions_old;
ALTER TABLE user_sessions_new RENAME TO user_sessions;

-- ============================================================================
-- Progress Table Partitioning (Hash-based on userId for even load distribution)
-- ============================================================================

-- Create partitioned progress table
DROP TABLE IF EXISTS progress_new CASCADE;
CREATE TABLE progress_new (
    id text NOT NULL,
    "userId" text NOT NULL,
    "lessonId" text NOT NULL,
    "moduleId" text NOT NULL,
    "completionPercentage" double precision NOT NULL DEFAULT 0,
    "timeSpent" integer NOT NULL DEFAULT 0,
    notes text,
    "startedAt" timestamp(3),
    "completedAt" timestamp(3),
    "lastAccessedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT progress_new_pkey PRIMARY KEY (id, "userId"),
    CONSTRAINT progress_new_userId_lessonId_key UNIQUE ("userId", "lessonId")
) PARTITION BY HASH ("userId");

-- Create hash partitions for progress (16 partitions for high concurrency)
DO $progress_partition$
DECLARE
    partition_name text;
BEGIN
    FOR i IN 0..15 LOOP
        partition_name := 'progress_' || i;

        EXECUTE format('
            CREATE TABLE %I PARTITION OF progress_new
            FOR VALUES WITH (modulus 16, remainder %s)',
            partition_name, i
        );

        -- Add indexes for each partition
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("lessonId")',
            'idx_' || partition_name || '_lesson', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("moduleId")',
            'idx_' || partition_name || '_module', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("lastAccessedAt")',
            'idx_' || partition_name || '_last_accessed', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("completionPercentage") WHERE "completionPercentage" > 0',
            'idx_' || partition_name || '_completion', partition_name);
    END LOOP;
END
$progress_partition$;

-- Migrate existing data
INSERT INTO progress_new
SELECT * FROM progress
ON CONFLICT (id, "userId") DO NOTHING;

-- Swap tables
ALTER TABLE progress RENAME TO progress_old;
ALTER TABLE progress_new RENAME TO progress;

-- ============================================================================
-- Quiz Attempts Partitioning (Time-based with monthly partitions)
-- ============================================================================

-- Create partitioned quiz_attempts table
DROP TABLE IF EXISTS quiz_attempts_new CASCADE;
CREATE TABLE quiz_attempts_new (
    id text NOT NULL,
    "userId" text NOT NULL,
    "quizId" text NOT NULL,
    score double precision,
    passed boolean NOT NULL DEFAULT false,
    "timeSpent" integer,
    "startedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" timestamp(3),
    CONSTRAINT quiz_attempts_new_pkey PRIMARY KEY (id, "startedAt")
) PARTITION BY RANGE ("startedAt");

-- Create monthly partitions for quiz attempts
DO $quiz_partition$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
    current_month date;
BEGIN
    -- Start from 6 months ago
    current_month := date_trunc('month', CURRENT_DATE - interval '6 months');

    FOR i IN 0..18 LOOP  -- 18 months total
        start_date := current_month + (i || ' months')::interval;
        end_date := start_date + interval '1 month';
        partition_name := 'quiz_attempts_' || to_char(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE %I PARTITION OF quiz_attempts_new
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Add indexes for each partition
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", "quizId")',
            'idx_' || partition_name || '_user_quiz', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("submittedAt") WHERE "submittedAt" IS NOT NULL',
            'idx_' || partition_name || '_submitted', partition_name);
        EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I (score) WHERE score IS NOT NULL',
            'idx_' || partition_name || '_score', partition_name);
    END LOOP;
END
$quiz_partition$;

-- Create default partition
CREATE TABLE quiz_attempts_default PARTITION OF quiz_attempts_new DEFAULT;

-- Migrate existing data
INSERT INTO quiz_attempts_new
SELECT * FROM quiz_attempts
ON CONFLICT (id, "startedAt") DO NOTHING;

-- Swap tables
ALTER TABLE quiz_attempts RENAME TO quiz_attempts_old;
ALTER TABLE quiz_attempts_new RENAME TO quiz_attempts;

-- ============================================================================
-- Materialized Views for Performance
-- ============================================================================

-- Daily user activity aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_user_activity AS
SELECT
    DATE("timestamp") AS activity_date,
    "userId",
    COUNT(*) AS event_count,
    COUNT(DISTINCT "eventType") AS unique_event_types,
    COUNT(DISTINCT "sessionId") AS session_count,
    MIN("timestamp") AS first_activity,
    MAX("timestamp") AS last_activity
FROM analytics_events
WHERE "userId" IS NOT NULL
    AND "timestamp" >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE("timestamp"), "userId";

CREATE UNIQUE INDEX ON mv_daily_user_activity (activity_date, "userId");
CREATE INDEX ON mv_daily_user_activity (activity_date);
CREATE INDEX ON mv_daily_user_activity ("userId");

-- Course performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_course_performance AS
SELECT
    c.id AS course_id,
    c.title,
    c.category,
    COUNT(DISTINCT e."userId") AS total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e."userId" END) AS completed_enrollments,
    ROUND(
        CASE
            WHEN COUNT(DISTINCT e."userId") > 0
            THEN (COUNT(DISTINCT CASE WHEN e.status = 'COMPLETED' THEN e."userId" END) * 100.0 / COUNT(DISTINCT e."userId"))
            ELSE 0
        END, 2
    ) AS completion_rate,
    AVG(e.progress) AS average_progress,
    COUNT(DISTINCT CASE WHEN e."enrolledAt" >= CURRENT_DATE - INTERVAL '30 days' THEN e."userId" END) AS recent_enrollments
FROM courses c
LEFT JOIN enrollments e ON c.id = e."courseId"
WHERE c.status = 'PUBLISHED'
GROUP BY c.id, c.title, c.category;

CREATE UNIQUE INDEX ON mv_course_performance (course_id);
CREATE INDEX ON mv_course_performance (category);
CREATE INDEX ON mv_course_performance (completion_rate DESC);

-- Weekly platform metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_weekly_platform_metrics AS
SELECT
    DATE_TRUNC('week', "timestamp") AS week_start,
    COUNT(DISTINCT "userId") AS active_users,
    COUNT(*) AS total_events,
    COUNT(DISTINCT "eventType") AS unique_event_types,
    COUNT(DISTINCT "sessionId") AS total_sessions,
    COUNT(CASE WHEN "eventType" = 'course_viewed' THEN 1 END) AS course_views,
    COUNT(CASE WHEN "eventType" = 'module_completed' THEN 1 END) AS module_completions,
    COUNT(CASE WHEN "eventType" = 'quiz_attempted' THEN 1 END) AS quiz_attempts
FROM analytics_events
WHERE "timestamp" >= CURRENT_DATE - INTERVAL '52 weeks'
    AND "userId" IS NOT NULL
GROUP BY DATE_TRUNC('week', "timestamp")
ORDER BY week_start DESC;

CREATE UNIQUE INDEX ON mv_weekly_platform_metrics (week_start);

-- ============================================================================
-- Partition Management Functions
-- ============================================================================

-- Function to create new monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partitions(
    table_name text,
    months_ahead int DEFAULT 3
) RETURNS void AS $$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
    current_month date;
BEGIN
    current_month := date_trunc('month', CURRENT_DATE);

    FOR i IN 1..months_ahead LOOP
        start_date := current_month + (i || ' months')::interval;
        end_date := start_date + interval '1 month';
        partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');

        -- Check if partition already exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = partition_name
        ) THEN
            EXECUTE format('
                CREATE TABLE %I PARTITION OF %I
                FOR VALUES FROM (%L) TO (%L)',
                partition_name, table_name, start_date, end_date
            );

            -- Add appropriate indexes based on table
            CASE table_name
                WHEN 'analytics_events' THEN
                    EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", "eventType")',
                        'idx_' || partition_name || '_user_event', partition_name);
                    EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I USING gin(data)',
                        'idx_' || partition_name || '_data', partition_name);
                WHEN 'activity_logs' THEN
                    EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", action)',
                        'idx_' || partition_name || '_user_action', partition_name);
                WHEN 'quiz_attempts' THEN
                    EXECUTE format('CREATE INDEX CONCURRENTLY %I ON %I ("userId", "quizId")',
                        'idx_' || partition_name || '_user_quiz', partition_name);
            END CASE;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions (data retention policy)
CREATE OR REPLACE FUNCTION drop_old_partitions(
    table_name text,
    retention_months int
) RETURNS void AS $$
DECLARE
    partition_record RECORD;
    cutoff_date date;
BEGIN
    cutoff_date := date_trunc('month', CURRENT_DATE - (retention_months || ' months')::interval);

    FOR partition_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE tablename LIKE table_name || '_%'
        AND tablename ~ '\d{4}_\d{2}$'
        AND to_date(RIGHT(tablename, 7), 'YYYY_MM') < cutoff_date
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE',
            partition_record.schemaname, partition_record.tablename);

        RAISE NOTICE 'Dropped old partition: %', partition_record.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_user_activity;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_course_performance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_weekly_platform_metrics;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Automated Maintenance Jobs
-- ============================================================================

-- Create extension for cron-like functionality (requires pg_cron extension)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule monthly partition creation (uncomment if pg_cron is available)
-- SELECT cron.schedule('create-partitions', '0 0 1 * *', 'SELECT create_monthly_partitions(''analytics_events''); SELECT create_monthly_partitions(''activity_logs''); SELECT create_monthly_partitions(''quiz_attempts'');');

-- Schedule old partition cleanup (uncomment if pg_cron is available)
-- SELECT cron.schedule('cleanup-old-partitions', '0 2 1 * *', 'SELECT drop_old_partitions(''analytics_events'', 12); SELECT drop_old_partitions(''activity_logs'', 6); SELECT drop_old_partitions(''quiz_attempts'', 24);');

-- Schedule materialized view refresh (uncomment if pg_cron is available)
-- SELECT cron.schedule('refresh-analytics-views', '0 */4 * * *', 'SELECT refresh_analytics_views();');

COMMIT;

-- ============================================================================
-- Performance Verification Queries
-- ============================================================================

-- Test partition pruning
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT COUNT(*) FROM analytics_events
-- WHERE timestamp >= '2023-01-01' AND timestamp < '2023-02-01';

-- Test hash partition distribution
-- SELECT
--     schemaname,
--     tablename,
--     n_tup_ins,
--     n_tup_upd,
--     n_tup_del,
--     n_live_tup,
--     n_dead_tup
-- FROM pg_stat_user_tables
-- WHERE tablename LIKE 'progress_%' OR tablename LIKE 'user_sessions_%'
-- ORDER BY tablename;

-- Check constraint exclusion working
-- SELECT
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE tablename LIKE 'analytics_events_%'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;