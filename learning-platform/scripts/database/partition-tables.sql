-- Database Partitioning Strategy
-- Implements table partitioning for high-volume tables to improve performance
-- Focus on analytics_events and activity_logs tables

-- ==================================================
-- ANALYTICS EVENTS TABLE PARTITIONING
-- ==================================================

-- First, rename the existing table to backup
ALTER TABLE analytics_events RENAME TO analytics_events_backup;

-- Create the main partitioned table
CREATE TABLE analytics_events (
    id text NOT NULL,
    user_id text,
    event_type text NOT NULL,
    data jsonb NOT NULL,
    metadata jsonb,
    session_id text,
    timestamp timestamp with time zone NOT NULL DEFAULT now()
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for the current year and next year
-- This ensures we always have partitions ready for new data

-- 2024 Partitions
CREATE TABLE analytics_events_2024_01 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE analytics_events_2024_02 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE analytics_events_2024_03 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE analytics_events_2024_04 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE analytics_events_2024_05 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE analytics_events_2024_06 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE analytics_events_2024_07 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE analytics_events_2024_08 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE analytics_events_2024_09 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE analytics_events_2024_10 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE analytics_events_2024_11 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE analytics_events_2024_12 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025 Partitions
CREATE TABLE analytics_events_2025_01 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE analytics_events_2025_02 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE analytics_events_2025_03 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE analytics_events_2025_04 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE analytics_events_2025_05 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE analytics_events_2025_06 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE analytics_events_2025_07 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE analytics_events_2025_08 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE analytics_events_2025_09 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE analytics_events_2025_10 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE analytics_events_2025_11 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE analytics_events_2025_12 PARTITION OF analytics_events
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Create indexes on each partition for optimal performance
-- Note: These will be created on all existing and future partitions

-- Primary key and unique constraints
ALTER TABLE analytics_events ADD PRIMARY KEY (id, timestamp);

-- Indexes for common query patterns
CREATE INDEX idx_analytics_events_user_timestamp ON analytics_events (user_id, timestamp DESC);
CREATE INDEX idx_analytics_events_event_type_timestamp ON analytics_events (event_type, timestamp DESC);
CREATE INDEX idx_analytics_events_session_timestamp ON analytics_events (session_id, timestamp) WHERE session_id IS NOT NULL;
CREATE INDEX idx_analytics_events_data_gin ON analytics_events USING GIN (data);
CREATE INDEX idx_analytics_events_metadata_gin ON analytics_events USING GIN (metadata) WHERE metadata IS NOT NULL;

-- Migrate existing data from backup table
INSERT INTO analytics_events (id, user_id, event_type, data, metadata, session_id, timestamp)
SELECT id, user_id, event_type, data, metadata, session_id, timestamp
FROM analytics_events_backup;

-- Verify data migration
DO $$
DECLARE
    backup_count INTEGER;
    new_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO backup_count FROM analytics_events_backup;
    SELECT COUNT(*) INTO new_count FROM analytics_events;

    IF backup_count = new_count THEN
        RAISE NOTICE 'Data migration successful: % rows migrated', new_count;
    ELSE
        RAISE EXCEPTION 'Data migration failed: backup has % rows, new table has % rows', backup_count, new_count;
    END IF;
END $$;

-- ==================================================
-- ACTIVITY LOGS TABLE PARTITIONING
-- ==================================================

-- Rename existing activity_logs table
ALTER TABLE activity_logs RENAME TO activity_logs_backup;

-- Create partitioned activity_logs table
CREATE TABLE activity_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    action text NOT NULL,
    resource text NOT NULL,
    details jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for activity logs
CREATE TABLE activity_logs_2024_01 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE activity_logs_2024_02 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE activity_logs_2024_03 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE activity_logs_2024_04 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE activity_logs_2024_05 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE activity_logs_2024_06 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE activity_logs_2024_07 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE activity_logs_2024_08 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE activity_logs_2024_09 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE activity_logs_2024_10 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE activity_logs_2024_11 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE activity_logs_2024_12 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025 Activity log partitions
CREATE TABLE activity_logs_2025_01 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE activity_logs_2025_02 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE activity_logs_2025_03 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE activity_logs_2025_04 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE activity_logs_2025_05 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE activity_logs_2025_06 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE activity_logs_2025_07 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE activity_logs_2025_08 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE activity_logs_2025_09 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE activity_logs_2025_10 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE activity_logs_2025_11 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE activity_logs_2025_12 PARTITION OF activity_logs
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Add constraints and indexes to activity_logs
ALTER TABLE activity_logs ADD PRIMARY KEY (id, created_at);

-- Create indexes for activity logs
CREATE INDEX idx_activity_logs_user_action_created ON activity_logs (user_id, action, created_at DESC);
CREATE INDEX idx_activity_logs_action_created ON activity_logs (action, created_at DESC);
CREATE INDEX idx_activity_logs_resource_created ON activity_logs (resource, created_at DESC);
CREATE INDEX idx_activity_logs_ip_address ON activity_logs (ip_address, created_at) WHERE ip_address IS NOT NULL;

-- Migrate existing data
INSERT INTO activity_logs (id, user_id, action, resource, details, ip_address, user_agent, created_at)
SELECT id, user_id, action, resource, details, ip_address, user_agent, created_at
FROM activity_logs_backup;

-- ==================================================
-- PARTITION MANAGEMENT FUNCTIONS
-- ==================================================

-- Function to create new partitions automatically
CREATE OR REPLACE FUNCTION create_monthly_partitions(
    table_name TEXT,
    start_date DATE,
    months_ahead INTEGER DEFAULT 3
) RETURNS VOID AS $$
DECLARE
    partition_start DATE;
    partition_end DATE;
    partition_name TEXT;
    sql_command TEXT;
    i INTEGER;
BEGIN
    FOR i IN 0..months_ahead LOOP
        partition_start := date_trunc('month', start_date) + (i || ' months')::INTERVAL;
        partition_end := partition_start + INTERVAL '1 month';
        partition_name := table_name || '_' || to_char(partition_start, 'YYYY_MM');

        -- Check if partition already exists
        IF NOT EXISTS (
            SELECT 1 FROM pg_class
            WHERE relname = partition_name
        ) THEN
            sql_command := format(
                'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                table_name,
                partition_start,
                partition_end
            );

            EXECUTE sql_command;
            RAISE NOTICE 'Created partition: %', partition_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions
CREATE OR REPLACE FUNCTION drop_old_partitions(
    table_name TEXT,
    months_to_keep INTEGER DEFAULT 12
) RETURNS VOID AS $$
DECLARE
    cutoff_date DATE;
    partition_record RECORD;
    sql_command TEXT;
BEGIN
    cutoff_date := date_trunc('month', CURRENT_DATE) - (months_to_keep || ' months')::INTERVAL;

    FOR partition_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE tablename LIKE table_name || '_%'
        AND substring(tablename from length(table_name) + 2)::DATE < cutoff_date
    LOOP
        sql_command := format('DROP TABLE IF EXISTS %I.%I', partition_record.schemaname, partition_record.tablename);
        EXECUTE sql_command;
        RAISE NOTICE 'Dropped old partition: %', partition_record.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- PARTITION MAINTENANCE PROCEDURES
-- ==================================================

-- Create a procedure to maintain partitions automatically
CREATE OR REPLACE FUNCTION maintain_partitions() RETURNS VOID AS $$
BEGIN
    -- Create new partitions 3 months ahead
    PERFORM create_monthly_partitions('analytics_events', CURRENT_DATE, 3);
    PERFORM create_monthly_partitions('activity_logs', CURRENT_DATE, 3);

    -- Keep only the last 24 months of data
    PERFORM drop_old_partitions('analytics_events', 24);
    PERFORM drop_old_partitions('activity_logs', 24);

    RAISE NOTICE 'Partition maintenance completed successfully';
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- SCHEDULED PARTITION MAINTENANCE
-- ==================================================

-- Create a function to be called by cron job or scheduler
CREATE OR REPLACE FUNCTION monthly_partition_maintenance() RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    BEGIN
        PERFORM maintain_partitions();
        result := 'Partition maintenance completed successfully at ' || now();

        -- Log the maintenance activity
        INSERT INTO activity_logs (id, user_id, action, resource, details, created_at)
        VALUES (
            'maint_' || extract(epoch from now()),
            'system',
            'partition_maintenance',
            'database',
            jsonb_build_object(
                'type', 'automatic',
                'timestamp', now(),
                'status', 'success'
            ),
            now()
        );

        RETURN result;
    EXCEPTION WHEN OTHERS THEN
        result := 'Partition maintenance failed: ' || SQLERRM;

        -- Log the error
        INSERT INTO activity_logs (id, user_id, action, resource, details, created_at)
        VALUES (
            'maint_error_' || extract(epoch from now()),
            'system',
            'partition_maintenance_error',
            'database',
            jsonb_build_object(
                'type', 'automatic',
                'timestamp', now(),
                'status', 'error',
                'error', SQLERRM
            ),
            now()
        );

        RETURN result;
    END;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- PARTITION PRUNING OPTIMIZATION
-- ==================================================

-- Enable constraint exclusion for better query performance
SET constraint_exclusion = partition;

-- Set work_mem higher for partition operations
SET work_mem = '256MB';

-- ==================================================
-- MONITORING VIEWS
-- ==================================================

-- View to monitor partition sizes
CREATE OR REPLACE VIEW partition_info AS
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables
WHERE tablename LIKE 'analytics_events_%' OR tablename LIKE 'activity_logs_%'
ORDER BY size_bytes DESC;

-- View to monitor partition pruning effectiveness
CREATE OR REPLACE VIEW partition_pruning_stats AS
WITH partition_scans AS (
    SELECT
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    AND (tablename LIKE 'analytics_events_%' OR tablename LIKE 'activity_logs_%')
)
SELECT
    schemaname,
    tablename,
    seq_scan as sequential_scans,
    seq_tup_read as sequential_tuples_read,
    idx_scan as index_scans,
    idx_tup_fetch as index_tuples_fetched,
    CASE
        WHEN seq_scan + idx_scan = 0 THEN 0
        ELSE ROUND((idx_scan::NUMERIC / (seq_scan + idx_scan)) * 100, 2)
    END as index_usage_percentage
FROM partition_scans
ORDER BY tablename;

-- ==================================================
-- CLEANUP
-- ==================================================

-- Update statistics
ANALYZE analytics_events;
ANALYZE activity_logs;

-- Success notification
DO $$
BEGIN
    RAISE NOTICE 'Partitioning setup completed successfully!';
    RAISE NOTICE 'Analytics events and activity logs are now partitioned by month.';
    RAISE NOTICE 'Run maintain_partitions() regularly to create new partitions and drop old ones.';
    RAISE NOTICE 'Use the partition_info view to monitor partition sizes.';
END $$;

-- Optional: Drop backup tables after verification
-- Uncomment these lines after verifying the migration was successful:
-- DROP TABLE analytics_events_backup;
-- DROP TABLE activity_logs_backup;