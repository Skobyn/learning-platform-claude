-- Database Partitioning Strategy for Analytics Tables
-- Optimized for time-series data and high-volume analytics
-- Supports automatic partition creation and maintenance

-- Enable partitioning extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Drop existing tables if they exist (for migration)
-- NOTE: In production, use proper data migration procedures
-- DROP TABLE IF EXISTS "UserAnalytics" CASCADE;
-- DROP TABLE IF EXISTS "CourseAnalytics" CASCADE;
-- DROP TABLE IF EXISTS "SystemAnalytics" CASCADE;
-- DROP TABLE IF EXISTS "AuditLog" CASCADE;

-- Create partitioned UserAnalytics table
CREATE TABLE IF NOT EXISTS "UserAnalytics_partitioned" (
    id SERIAL,
    "userId" TEXT NOT NULL,
    date DATE NOT NULL,
    "timeSpent" INTEGER NOT NULL DEFAULT 0,
    "lessonsCompleted" INTEGER NOT NULL DEFAULT 0,
    "quizzesTaken" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DECIMAL(5,2),
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "badgesEarned" INTEGER NOT NULL DEFAULT 0,
    "discussionPosts" INTEGER NOT NULL DEFAULT 0,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "deviceType" TEXT,
    "browser" TEXT,
    "ipAddress" TEXT,
    "countryCode" TEXT,
    "sessionDuration" INTEGER,
    "pagesVisited" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Partition key must be part of primary key
    PRIMARY KEY (id, date),

    -- Constraints
    CONSTRAINT "UserAnalytics_partitioned_userId_date_key" UNIQUE ("userId", date)
) PARTITION BY RANGE (date);

-- Create initial partitions for UserAnalytics (current month and next 12 months)
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    i INTEGER;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE);

    FOR i IN 0..12 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'UserAnalytics_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF "UserAnalytics_partitioned"
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Create indexes on each partition
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("userId", date)',
            partition_name || '_user_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date, "timeSpent")',
            partition_name || '_date_time_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("createdAt")',
            partition_name || '_created_idx', partition_name);

        start_date := end_date;
    END LOOP;
END $$;

-- Create partitioned CourseAnalytics table
CREATE TABLE IF NOT EXISTS "CourseAnalytics_partitioned" (
    id SERIAL,
    "courseId" TEXT NOT NULL,
    date DATE NOT NULL,
    "enrollments" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "dropouts" INTEGER NOT NULL DEFAULT 0,
    "averageProgress" DECIMAL(5,2),
    "averageRating" DECIMAL(3,2),
    "totalRevenue" DECIMAL(10,2),
    "activeStudents" INTEGER NOT NULL DEFAULT 0,
    "newStudents" INTEGER NOT NULL DEFAULT 0,
    "returningStudents" INTEGER NOT NULL DEFAULT 0,
    "avgSessionTime" INTEGER,
    "bounceRate" DECIMAL(5,2),
    "conversionRate" DECIMAL(5,2),
    "refundRate" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, date),
    CONSTRAINT "CourseAnalytics_partitioned_courseId_date_key" UNIQUE ("courseId", date)
) PARTITION BY RANGE (date);

-- Create initial partitions for CourseAnalytics
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    i INTEGER;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE);

    FOR i IN 0..12 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'CourseAnalytics_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF "CourseAnalytics_partitioned"
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Create indexes on each partition
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("courseId", date)',
            partition_name || '_course_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date, "enrollments")',
            partition_name || '_date_enroll_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("averageRating", "completions")',
            partition_name || '_rating_completion_idx', partition_name);

        start_date := end_date;
    END LOOP;
END $$;

-- Create partitioned SystemAnalytics table
CREATE TABLE IF NOT EXISTS "SystemAnalytics_partitioned" (
    id SERIAL,
    date DATE NOT NULL,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "newEnrollments" INTEGER NOT NULL DEFAULT 0,
    "completedCourses" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(10,2),
    "averageSessionTime" INTEGER,
    "bounceRate" DECIMAL(5,2),
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" DECIMAL(5,2),
    "churnRate" DECIMAL(5,2),
    "supportTickets" INTEGER NOT NULL DEFAULT 0,
    "systemUptime" DECIMAL(5,2),
    "apiResponseTime" DECIMAL(8,2),
    "errorRate" DECIMAL(5,4),
    "diskUsage" DECIMAL(5,2),
    "memoryUsage" DECIMAL(5,2),
    "cpuUsage" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, date),
    CONSTRAINT "SystemAnalytics_partitioned_date_key" UNIQUE (date)
) PARTITION BY RANGE (date);

-- Create initial partitions for SystemAnalytics
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
    i INTEGER;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE);

    FOR i IN 0..12 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'SystemAnalytics_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF "SystemAnalytics_partitioned"
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Create indexes on each partition
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date)',
            partition_name || '_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("activeUsers", "newUsers")',
            partition_name || '_users_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("totalRevenue", "conversionRate")',
            partition_name || '_revenue_idx', partition_name);

        start_date := end_date;
    END LOOP;
END $$;

-- Create partitioned AuditLog table for compliance and security
CREATE TABLE IF NOT EXISTS "AuditLog_partitioned" (
    id SERIAL,
    "userId" TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    "resourceId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    success BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    metadata JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, "createdAt")
) PARTITION BY RANGE ("createdAt");

-- Create initial partitions for AuditLog (monthly partitions)
DO $$
DECLARE
    start_date TIMESTAMP;
    end_date TIMESTAMP;
    partition_name TEXT;
    i INTEGER;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_TIMESTAMP);

    FOR i IN 0..12 LOOP
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'AuditLog_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF "AuditLog_partitioned"
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Create indexes on each partition
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("userId", "createdAt")',
            partition_name || '_user_created_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (action, resource)',
            partition_name || '_action_resource_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("createdAt")',
            partition_name || '_created_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (metadata)',
            partition_name || '_metadata_gin_idx', partition_name);

        start_date := end_date;
    END LOOP;
END $$;

-- Create function for automatic partition creation
CREATE OR REPLACE FUNCTION create_monthly_partition(
    table_name TEXT,
    start_date DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
BEGIN
    end_date := start_date + INTERVAL '1 month';
    partition_name := table_name || '_' || TO_CHAR(start_date, 'YYYY_MM');

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
        FOR VALUES FROM (%L) TO (%L)',
        partition_name, table_name || '_partitioned', start_date, end_date
    );

    -- Create appropriate indexes based on table type
    IF table_name = 'UserAnalytics' THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("userId", date)',
            partition_name || '_user_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date, "timeSpent")',
            partition_name || '_date_time_idx', partition_name);
    ELSIF table_name = 'CourseAnalytics' THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("courseId", date)',
            partition_name || '_course_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date, "enrollments")',
            partition_name || '_date_enroll_idx', partition_name);
    ELSIF table_name = 'SystemAnalytics' THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (date)',
            partition_name || '_date_idx', partition_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("activeUsers", "newUsers")',
            partition_name || '_users_idx', partition_name);
    END IF;

    RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

-- Create function for automatic partition maintenance
CREATE OR REPLACE FUNCTION maintain_partitions() RETURNS VOID AS $$
DECLARE
    next_month DATE;
    old_month DATE;
    partition_name TEXT;
    table_names TEXT[] := ARRAY['UserAnalytics', 'CourseAnalytics', 'SystemAnalytics'];
    table_name TEXT;
BEGIN
    next_month := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '2 months');
    old_month := DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months');

    -- Create next month's partitions
    FOREACH table_name IN ARRAY table_names LOOP
        PERFORM create_monthly_partition(table_name, next_month);
    END LOOP;

    -- Drop old partitions (older than 12 months)
    FOREACH table_name IN ARRAY table_names LOOP
        partition_name := table_name || '_' || TO_CHAR(old_month, 'YYYY_MM');
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);
        RAISE NOTICE 'Dropped old partition: %', partition_name;
    END LOOP;

    -- Special handling for AuditLog (keep for 3 years for compliance)
    old_month := DATE_TRUNC('month', CURRENT_TIMESTAMP - INTERVAL '36 months');
    partition_name := 'AuditLog_' || TO_CHAR(old_month, 'YYYY_MM');
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);

    -- Create next month's AuditLog partition
    next_month := DATE_TRUNC('month', CURRENT_TIMESTAMP + INTERVAL '2 months');
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I PARTITION OF "AuditLog_partitioned"
        FOR VALUES FROM (%L) TO (%L)',
        'AuditLog_' || TO_CHAR(next_month, 'YYYY_MM'),
        next_month,
        next_month + INTERVAL '1 month'
    );

    RAISE NOTICE 'Partition maintenance completed';
END;
$$ LANGUAGE plpgsql;

-- Schedule automatic partition maintenance (requires pg_cron extension)
-- Run maintenance on the 1st of each month at 2 AM
-- SELECT cron.schedule('partition-maintenance', '0 2 1 * *', 'SELECT maintain_partitions();');

-- Create views for seamless access to partitioned tables
CREATE OR REPLACE VIEW "UserAnalytics" AS
SELECT * FROM "UserAnalytics_partitioned";

CREATE OR REPLACE VIEW "CourseAnalytics" AS
SELECT * FROM "CourseAnalytics_partitioned";

CREATE OR REPLACE VIEW "SystemAnalytics" AS
SELECT * FROM "SystemAnalytics_partitioned";

CREATE OR REPLACE VIEW "AuditLog" AS
SELECT * FROM "AuditLog_partitioned";

-- Create materialized views for common analytics queries
CREATE MATERIALIZED VIEW IF NOT EXISTS "UserAnalyticsSummary" AS
SELECT
    "userId",
    DATE_TRUNC('month', date) as month,
    SUM("timeSpent") as "totalTimeSpent",
    SUM("lessonsCompleted") as "totalLessonsCompleted",
    AVG("avgScore") as "averageScore",
    MAX("streakDays") as "maxStreak",
    COUNT(DISTINCT date) as "activeDays"
FROM "UserAnalytics_partitioned"
WHERE date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY "userId", DATE_TRUNC('month', date)
WITH DATA;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_analytics_summary_user_month
ON "UserAnalyticsSummary" ("userId", month);

CREATE INDEX IF NOT EXISTS idx_user_analytics_summary_month
ON "UserAnalyticsSummary" (month);

-- Create materialized view for course performance
CREATE MATERIALIZED VIEW IF NOT EXISTS "CoursePerformanceSummary" AS
SELECT
    "courseId",
    DATE_TRUNC('month', date) as month,
    SUM("enrollments") as "totalEnrollments",
    SUM("completions") as "totalCompletions",
    CASE
        WHEN SUM("enrollments") > 0
        THEN (SUM("completions")::DECIMAL / SUM("enrollments")) * 100
        ELSE 0
    END as "completionRate",
    AVG("averageRating") as "avgRating",
    SUM("totalRevenue") as "totalRevenue"
FROM "CourseAnalytics_partitioned"
WHERE date >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY "courseId", DATE_TRUNC('month', date)
WITH DATA;

-- Create index on course performance view
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_performance_summary_course_month
ON "CoursePerformanceSummary" ("courseId", month);

-- Create refresh functions for materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views() RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY "UserAnalyticsSummary";
    REFRESH MATERIALIZED VIEW CONCURRENTLY "CoursePerformanceSummary";
    RAISE NOTICE 'Analytics materialized views refreshed';
END;
$$ LANGUAGE plpgsql;

-- Schedule materialized view refresh (daily at 3 AM)
-- SELECT cron.schedule('refresh-analytics', '0 3 * * *', 'SELECT refresh_analytics_views();');

-- Grant appropriate permissions
GRANT SELECT ON "UserAnalytics" TO PUBLIC;
GRANT SELECT ON "CourseAnalytics" TO PUBLIC;
GRANT SELECT ON "SystemAnalytics" TO PUBLIC;
GRANT SELECT ON "AuditLog" TO PUBLIC;
GRANT SELECT ON "UserAnalyticsSummary" TO PUBLIC;
GRANT SELECT ON "CoursePerformanceSummary" TO PUBLIC;

-- Create partition pruning configuration
ALTER SYSTEM SET enable_partition_pruning = on;
ALTER SYSTEM SET constraint_exclusion = partition;

-- Analyze tables for better query planning
ANALYZE "UserAnalytics_partitioned";
ANALYZE "CourseAnalytics_partitioned";
ANALYZE "SystemAnalytics_partitioned";
ANALYZE "AuditLog_partitioned";

-- Create stored procedure for partition statistics
CREATE OR REPLACE FUNCTION get_partition_stats(table_name TEXT)
RETURNS TABLE(partition_name TEXT, row_count BIGINT, size_bytes BIGINT, last_updated TIMESTAMP) AS $$
BEGIN
    RETURN QUERY
    SELECT
        schemaname||'.'||tablename as partition_name,
        n_tup_ins + n_tup_upd - n_tup_del as row_count,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
        last_analyze as last_updated
    FROM pg_stat_user_tables
    WHERE tablename LIKE table_name || '_%'
    ORDER BY tablename;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- Usage examples:
-- SELECT * FROM get_partition_stats('UserAnalytics');
-- SELECT maintain_partitions();
-- SELECT refresh_analytics_views();