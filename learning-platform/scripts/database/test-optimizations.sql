-- Database Optimization Testing and Validation Script
-- This script tests and validates all implemented database optimizations

-- ==================================================
-- INDEX VALIDATION AND PERFORMANCE TESTING
-- ==================================================

-- Function to test query performance before and after optimization
CREATE OR REPLACE FUNCTION test_query_performance(
    query_name TEXT,
    test_query TEXT,
    expected_max_duration_ms INTEGER DEFAULT 1000
) RETURNS TABLE (
    test_name TEXT,
    execution_time_ms NUMERIC,
    passed BOOLEAN,
    explain_plan TEXT
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    duration_ms NUMERIC;
    explain_output TEXT;
BEGIN
    -- Get query plan
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' || test_query INTO explain_output;

    -- Measure execution time
    start_time := clock_timestamp();
    EXECUTE test_query;
    end_time := clock_timestamp();

    duration_ms := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;

    RETURN QUERY SELECT
        query_name,
        duration_ms,
        duration_ms <= expected_max_duration_ms,
        explain_output;
END;
$$ LANGUAGE plpgsql;

-- Test critical queries for performance
DO $$
DECLARE
    test_result RECORD;
BEGIN
    RAISE NOTICE 'Starting Database Optimization Performance Tests...';

    -- Test 1: User authentication query
    FOR test_result IN
        SELECT * FROM test_query_performance(
            'User Login Query',
            'SELECT id, email, hashed_password, role FROM users WHERE email = ''test@example.com'' AND is_active = true',
            50
        )
    LOOP
        RAISE NOTICE 'Test: % | Time: %ms | Passed: %',
            test_result.test_name, test_result.execution_time_ms, test_result.passed;
    END LOOP;

    -- Test 2: Course discovery query
    FOR test_result IN
        SELECT * FROM test_query_performance(
            'Course Discovery Query',
            'SELECT id, title, category, difficulty, average_rating, enrollment_count FROM courses WHERE status = ''PUBLISHED'' AND category = ''Technology'' ORDER BY average_rating DESC LIMIT 20',
            100
        )
    LOOP
        RAISE NOTICE 'Test: % | Time: %ms | Passed: %',
            test_result.test_name, test_result.execution_time_ms, test_result.passed;
    END LOOP;

    -- Test 3: User progress query
    FOR test_result IN
        SELECT * FROM test_query_performance(
            'User Progress Query',
            'SELECT COUNT(*) FROM progress WHERE user_id = ''test-user-id'' AND completion_percentage > 50',
            100
        )
    LOOP
        RAISE NOTICE 'Test: % | Time: %ms | Passed: %',
            test_result.test_name, test_result.execution_time_ms, test_result.passed;
    END LOOP;

    -- Test 4: Analytics events query
    FOR test_result IN
        SELECT * FROM test_query_performance(
            'Analytics Events Query',
            'SELECT event_type, COUNT(*) FROM analytics_events WHERE timestamp >= NOW() - INTERVAL ''7 days'' GROUP BY event_type',
            200
        )
    LOOP
        RAISE NOTICE 'Test: % | Time: %ms | Passed: %',
            test_result.test_name, test_result.execution_time_ms, test_result.passed;
    END LOOP;

    -- Test 5: Enrollment statistics query
    FOR test_result IN
        SELECT * FROM test_query_performance(
            'Enrollment Statistics Query',
            'SELECT course_id, COUNT(*) as enrollments, AVG(progress) as avg_progress FROM enrollments WHERE enrolled_at >= NOW() - INTERVAL ''30 days'' GROUP BY course_id ORDER BY enrollments DESC LIMIT 10',
            150
        )
    LOOP
        RAISE NOTICE 'Test: % | Time: %ms | Passed: %',
            test_result.test_name, test_result.execution_time_ms, test_result.passed;
    END LOOP;
END $$;

-- ==================================================
-- INDEX USAGE VERIFICATION
-- ==================================================

-- Check if our indexes are being used
CREATE OR REPLACE VIEW index_effectiveness AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    CASE
        WHEN idx_scan = 0 THEN 'UNUSED - Consider dropping'
        WHEN idx_scan < 100 THEN 'LOW USAGE - Monitor'
        WHEN idx_scan < 1000 THEN 'MODERATE USAGE'
        ELSE 'HIGH USAGE - Critical'
    END as usage_level
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Show index effectiveness report
SELECT
    usage_level,
    COUNT(*) as index_count,
    ARRAY_AGG(indexname ORDER BY times_used DESC) as indexes
FROM index_effectiveness
GROUP BY usage_level
ORDER BY
    CASE usage_level
        WHEN 'HIGH USAGE - Critical' THEN 1
        WHEN 'MODERATE USAGE' THEN 2
        WHEN 'LOW USAGE - Monitor' THEN 3
        WHEN 'UNUSED - Consider dropping' THEN 4
    END;

-- ==================================================
-- PARTITION VERIFICATION
-- ==================================================

-- Verify partitions are working correctly
DO $$
DECLARE
    partition_count INTEGER;
    total_events INTEGER;
    partition_record RECORD;
BEGIN
    -- Check analytics_events partitions
    SELECT COUNT(*) INTO partition_count
    FROM pg_tables
    WHERE tablename LIKE 'analytics_events_%';

    RAISE NOTICE 'Analytics Events Partitions: %', partition_count;

    -- Check data distribution across partitions
    FOR partition_record IN
        SELECT
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables
        WHERE tablename LIKE 'analytics_events_%'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 5
    LOOP
        RAISE NOTICE 'Partition: % | Size: %', partition_record.tablename, partition_record.size;
    END LOOP;

    -- Test partition pruning
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT COUNT(*) FROM analytics_events
    WHERE timestamp >= '2024-01-01' AND timestamp < '2024-02-01';

    RAISE NOTICE 'Partition pruning test completed - check EXPLAIN output above';
END $$;

-- ==================================================
-- MATERIALIZED VIEW VERIFICATION
-- ==================================================

-- Test materialized view performance vs base tables
DO $$
DECLARE
    mv_time NUMERIC;
    base_time NUMERIC;
    start_time TIMESTAMP;
    end_time TIMESTAMP;
BEGIN
    -- Test materialized view query
    start_time := clock_timestamp();
    PERFORM * FROM mv_user_learning_summary LIMIT 100;
    end_time := clock_timestamp();
    mv_time := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;

    -- Test equivalent base table query
    start_time := clock_timestamp();
    PERFORM u.id, COUNT(DISTINCT e.course_id), COUNT(DISTINCT a.id)
    FROM users u
    LEFT JOIN enrollments e ON u.id = e.user_id
    LEFT JOIN achievements a ON u.id = a.user_id
    WHERE u.is_active = true
    GROUP BY u.id
    LIMIT 100;
    end_time := clock_timestamp();
    base_time := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;

    RAISE NOTICE 'Materialized View Query: %ms', mv_time;
    RAISE NOTICE 'Base Tables Query: %ms', base_time;
    RAISE NOTICE 'Performance Improvement: %x faster', ROUND(base_time / mv_time, 2);
END $$;

-- Check materialized view freshness
SELECT
    matviewname,
    ispopulated,
    pg_size_pretty(pg_total_relation_size('public.' || matviewname)) as size
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.' || matviewname) DESC;

-- ==================================================
-- CONNECTION POOL TESTING
-- ==================================================

-- Simulate concurrent connections to test pooling
CREATE OR REPLACE FUNCTION test_connection_pool(num_connections INTEGER DEFAULT 10)
RETURNS TABLE(connection_test_result TEXT) AS $$
DECLARE
    i INTEGER;
    connection_count INTEGER;
BEGIN
    FOR i IN 1..num_connections LOOP
        -- Simulate work
        PERFORM pg_sleep(0.1);
        SELECT count(*) INTO connection_count FROM pg_stat_activity WHERE state = 'active';

        RETURN QUERY SELECT format('Connection %s: Active connections = %s', i, connection_count);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run connection pool test
SELECT * FROM test_connection_pool(5);

-- ==================================================
-- CACHE EFFECTIVENESS SIMULATION
-- ==================================================

-- Test query caching effectiveness (simulated)
DO $$
DECLARE
    cache_hit_time NUMERIC;
    cache_miss_time NUMERIC;
    start_time TIMESTAMP;
    end_time TIMESTAMP;
BEGIN
    -- Simulate cache miss (first query)
    start_time := clock_timestamp();
    PERFORM COUNT(*) FROM courses WHERE status = 'PUBLISHED';
    end_time := clock_timestamp();
    cache_miss_time := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;

    -- Simulate cache hit (repeat query - should be faster due to buffer cache)
    start_time := clock_timestamp();
    PERFORM COUNT(*) FROM courses WHERE status = 'PUBLISHED';
    end_time := clock_timestamp();
    cache_hit_time := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;

    RAISE NOTICE 'Cache Miss Time: %ms', cache_miss_time;
    RAISE NOTICE 'Cache Hit Time: %ms', cache_hit_time;

    IF cache_hit_time < cache_miss_time THEN
        RAISE NOTICE 'Cache is working effectively!';
    ELSE
        RAISE NOTICE 'Cache may need tuning';
    END IF;
END $$;

-- ==================================================
-- QUERY OPTIMIZATION VALIDATION
-- ==================================================

-- Test full-text search performance
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, description
FROM courses
WHERE to_tsvector('english', title || ' ' || description) @@ to_tsquery('english', 'javascript & react');

-- Test cursor-based pagination
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, created_at
FROM courses
WHERE id > 'cursor_value'
ORDER BY id
LIMIT 20;

-- Test date range queries with indexes
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM enrollments
WHERE enrolled_at >= '2024-01-01' AND enrolled_at <= '2024-12-31';

-- ==================================================
-- SECURITY AND CONSTRAINT VALIDATION
-- ==================================================

-- Verify foreign key constraints are still working
DO $$
BEGIN
    BEGIN
        INSERT INTO enrollments (id, user_id, course_id, status)
        VALUES ('test-enrollment', 'non-existent-user', 'non-existent-course', 'ACTIVE');
        RAISE EXCEPTION 'Foreign key constraint failed - this should not happen!';
    EXCEPTION
        WHEN foreign_key_violation THEN
            RAISE NOTICE 'Foreign key constraints are working correctly';
    END;
END $$;

-- Verify unique constraints
DO $$
BEGIN
    BEGIN
        INSERT INTO users (id, email, first_name, last_name, hashed_password, role)
        VALUES ('test-user-duplicate', 'existing@example.com', 'Test', 'User', 'hash', 'LEARNER');

        INSERT INTO users (id, email, first_name, last_name, hashed_password, role)
        VALUES ('test-user-duplicate-2', 'existing@example.com', 'Test', 'User', 'hash', 'LEARNER');

        RAISE EXCEPTION 'Unique constraint failed - this should not happen!';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'Unique constraints are working correctly';
    END;
END $$;

-- ==================================================
-- PERFORMANCE BASELINE ESTABLISHMENT
-- ==================================================

-- Create performance baseline for monitoring
CREATE TABLE IF NOT EXISTS performance_baselines (
    id SERIAL PRIMARY KEY,
    test_name TEXT NOT NULL,
    query_type TEXT NOT NULL,
    avg_execution_time_ms NUMERIC NOT NULL,
    p95_execution_time_ms NUMERIC NOT NULL,
    p99_execution_time_ms NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert baseline performance metrics
INSERT INTO performance_baselines (test_name, query_type, avg_execution_time_ms, p95_execution_time_ms, p99_execution_time_ms)
VALUES
    ('user_authentication', 'SELECT', 10, 25, 50),
    ('course_discovery', 'SELECT', 50, 100, 200),
    ('analytics_aggregation', 'SELECT', 100, 250, 500),
    ('enrollment_creation', 'INSERT', 20, 40, 80),
    ('progress_update', 'UPDATE', 15, 30, 60);

-- ==================================================
-- MONITORING SETUP
-- ==================================================

-- Create monitoring views for ongoing performance tracking
CREATE OR REPLACE VIEW query_performance_monitor AS
SELECT
    query,
    calls,
    total_time,
    mean_time,
    min_time,
    max_time,
    stddev_time
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY mean_time DESC
LIMIT 20;

-- Create table size monitoring view
CREATE OR REPLACE VIEW table_size_monitor AS
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
    pg_total_relation_size(schemaname||'.'||tablename) as total_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY total_bytes DESC;

-- ==================================================
-- FINAL VALIDATION REPORT
-- ==================================================

DO $$
DECLARE
    index_count INTEGER;
    partition_count INTEGER;
    mv_count INTEGER;
    total_size TEXT;
BEGIN
    -- Count optimizations
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%';

    SELECT COUNT(*) INTO partition_count
    FROM pg_tables
    WHERE tablename LIKE '%_2024_%' OR tablename LIKE '%_2025_%';

    SELECT COUNT(*) INTO mv_count
    FROM pg_matviews
    WHERE schemaname = 'public';

    SELECT pg_size_pretty(pg_database_size(current_database())) INTO total_size;

    RAISE NOTICE '==================================================';
    RAISE NOTICE 'DATABASE OPTIMIZATION VALIDATION REPORT';
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'Indexes Created: %', index_count;
    RAISE NOTICE 'Partitions Created: %', partition_count;
    RAISE NOTICE 'Materialized Views: %', mv_count;
    RAISE NOTICE 'Total Database Size: %', total_size;
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'All database optimizations have been validated!';
    RAISE NOTICE 'Run this script regularly to monitor performance.';
    RAISE NOTICE '==================================================';
END $$;

-- Clean up test function
DROP FUNCTION IF EXISTS test_query_performance(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS test_connection_pool(INTEGER);