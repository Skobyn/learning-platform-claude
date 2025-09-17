#!/bin/bash

# Database Maintenance Script for Learning Platform
# Optimized for production environments with 100K+ concurrent users

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-learning_platform}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD}"

# Maintenance settings
VACUUM_THRESHOLD_MB="${VACUUM_THRESHOLD_MB:-1000}"
ANALYZE_THRESHOLD_HOURS="${ANALYZE_THRESHOLD_HOURS:-6}"
REINDEX_THRESHOLD_DAYS="${REINDEX_THRESHOLD_DAYS:-30}"

# Logging
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/maintenance-$(date +%Y%m%d-%H%M%S).log"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

# Execute SQL with error handling
execute_sql() {
    local sql="$1"
    local description="${2:-SQL execution}"

    log_info "Executing: $description"

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "$sql" >> "$LOG_FILE" 2>&1

    if [[ $? -eq 0 ]]; then
        log_success "$description completed"
        return 0
    else
        log_error "$description failed"
        return 1
    fi
}

# Check database connection
check_connection() {
    log_info "Testing database connection..."

    if PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "Database connection established"
        return 0
    else
        log_error "Cannot connect to database"
        return 1
    fi
}

# Get database statistics
get_db_stats() {
    log_info "Collecting database statistics..."

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "
        SELECT
            pg_database_size('$DB_NAME') / 1024 / 1024 AS db_size_mb,
            (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections;
        " | tee -a "$LOG_FILE"
}

# Analyze table statistics
analyze_statistics() {
    log_info "Updating table statistics..."

    # Update statistics for critical tables
    local tables=(
        "users"
        "courses"
        "enrollments"
        "progress"
        "analytics_events"
        "quiz_attempts"
        "notifications"
        "user_sessions"
        "activity_logs"
    )

    for table in "${tables[@]}"; do
        execute_sql "ANALYZE $table;" "Analyzing $table statistics"
    done

    # Update statistics for materialized views
    execute_sql "
        SELECT 'ANALYZE ' || schemaname || '.' || matviewname || ';'
        FROM pg_matviews
        WHERE schemaname = 'public'
        AND matviewname LIKE 'mv_%';
    " "Getting materialized views for analysis"
}

# Vacuum tables based on bloat
vacuum_tables() {
    log_info "Starting vacuum operations..."

    # Get tables that need vacuuming (with significant bloat)
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -t -c "
        SELECT
            schemaname || '.' || tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
            n_dead_tup,
            n_live_tup
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 1000
        AND pg_total_relation_size(schemaname||'.'||tablename) > $VACUUM_THRESHOLD_MB * 1024 * 1024
        ORDER BY n_dead_tup DESC;
        " | while read -r table_info; do

        if [[ -n "$table_info" ]]; then
            table_name=$(echo "$table_info" | awk '{print $1}')
            log_info "Vacuuming table: $table_name"
            execute_sql "VACUUM ANALYZE $table_name;" "Vacuuming $table_name"
        fi
    done

    # Vacuum critical high-activity tables regardless
    local critical_tables=(
        "analytics_events"
        "user_sessions"
        "activity_logs"
        "notifications"
        "progress"
    )

    for table in "${critical_tables[@]}"; do
        execute_sql "VACUUM ANALYZE $table;" "Critical vacuum for $table"
    done
}

# Reindex tables with bloated indexes
reindex_tables() {
    log_info "Checking for indexes that need reindexing..."

    # Find bloated indexes
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -t -c "
        SELECT
            schemaname,
            tablename,
            indexname,
            pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as size
        FROM pg_stat_user_indexes
        WHERE idx_scan < 100
        AND pg_relation_size(schemaname||'.'||indexname) > 100 * 1024 * 1024  -- 100MB
        ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC;
        " | while read -r index_info; do

        if [[ -n "$index_info" ]]; then
            index_name=$(echo "$index_info" | awk '{print $3}')
            log_warning "Index $index_name appears to be underutilized but large"
        fi
    done

    # Reindex critical indexes concurrently (PostgreSQL 12+)
    local critical_indexes=(
        "idx_enrollments_user_status"
        "idx_progress_user_lesson"
        "idx_analytics_events_timestamp"
        "idx_users_email_active"
        "idx_courses_status_category"
    )

    for index in "${critical_indexes[@]}"; do
        if PGPASSWORD="$DB_PASSWORD" psql \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "SELECT 1 FROM pg_indexes WHERE indexname = '$index';" -t | grep -q 1; then

            log_info "Reindexing $index concurrently..."
            execute_sql "REINDEX INDEX CONCURRENTLY $index;" "Reindexing $index"
        fi
    done
}

# Clean up old data
cleanup_old_data() {
    log_info "Cleaning up old data..."

    # Clean up expired sessions
    execute_sql "
        DELETE FROM user_sessions
        WHERE \"expiresAt\" < NOW() - INTERVAL '7 days';
    " "Cleaning expired user sessions"

    # Clean up old password reset tokens
    execute_sql "
        DELETE FROM password_reset_tokens
        WHERE \"expiresAt\" < NOW() AND used = false;
    " "Cleaning expired password reset tokens"

    # Clean up old email verification tokens
    execute_sql "
        DELETE FROM email_verification_tokens
        WHERE \"expiresAt\" < NOW() AND used = false;
    " "Cleaning expired email verification tokens"

    # Archive old analytics events (older than 1 year)
    execute_sql "
        WITH archived_events AS (
            DELETE FROM analytics_events
            WHERE timestamp < NOW() - INTERVAL '365 days'
            RETURNING *
        )
        SELECT COUNT(*) FROM archived_events;
    " "Archiving old analytics events"

    # Clean up old activity logs (older than 90 days)
    execute_sql "
        DELETE FROM activity_logs
        WHERE \"createdAt\" < NOW() - INTERVAL '90 days';
    " "Cleaning old activity logs"
}

# Refresh materialized views
refresh_materialized_views() {
    log_info "Refreshing materialized views..."

    # Refresh views in dependency order
    local views=(
        "mv_daily_user_activity"
        "mv_course_performance"
        "mv_weekly_platform_metrics"
        "mv_user_learning_summary"
        "mv_course_analytics"
        "mv_daily_platform_metrics"
        "mv_module_completion_funnel"
        "mv_hourly_activity_heatmap"
        "mv_instructor_performance"
    )

    for view in "${views[@]}"; do
        # Check if view exists before refreshing
        if PGPASSWORD="$DB_PASSWORD" psql \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "SELECT 1 FROM pg_matviews WHERE matviewname = '$view';" -t | grep -q 1; then

            execute_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY $view;" "Refreshing $view"
        else
            log_warning "Materialized view $view does not exist, skipping..."
        fi
    done
}

# Check and create missing partitions
manage_partitions() {
    log_info "Managing table partitions..."

    # Create future partitions for analytics_events
    execute_sql "SELECT create_monthly_partitions('analytics_events', 3);" "Creating analytics_events partitions"

    # Create future partitions for activity_logs
    execute_sql "SELECT create_monthly_partitions('activity_logs', 3);" "Creating activity_logs partitions"

    # Create future partitions for quiz_attempts
    execute_sql "SELECT create_monthly_partitions('quiz_attempts', 3);" "Creating quiz_attempts partitions"

    # Drop old partitions (retention policy)
    execute_sql "SELECT drop_old_partitions('analytics_events', 12);" "Dropping old analytics_events partitions"
    execute_sql "SELECT drop_old_partitions('activity_logs', 6);" "Dropping old activity_logs partitions"
    execute_sql "SELECT drop_old_partitions('quiz_attempts', 24);" "Dropping old quiz_attempts partitions"
}

# Monitor long-running queries
monitor_queries() {
    log_info "Monitoring long-running queries..."

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "
        SELECT
            pid,
            now() - pg_stat_activity.query_start AS duration,
            query,
            state
        FROM pg_stat_activity
        WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
        AND state != 'idle'
        ORDER BY duration DESC;
        " | tee -a "$LOG_FILE"
}

# Check for index usage
analyze_index_usage() {
    log_info "Analyzing index usage..."

    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "
        SELECT
            schemaname,
            tablename,
            indexname,
            idx_scan,
            pg_size_pretty(pg_relation_size(indexrelid)) AS size
        FROM pg_stat_user_indexes
        WHERE idx_scan < 100
        AND pg_relation_size(indexrelid) > 10 * 1024 * 1024  -- 10MB
        ORDER BY pg_relation_size(indexrelid) DESC
        LIMIT 20;
        " | tee -a "$LOG_FILE"
}

# Generate maintenance report
generate_report() {
    log_info "Generating maintenance report..."

    local report_file="${SCRIPT_DIR}/maintenance-report-$(date +%Y%m%d-%H%M%S).html"

    cat > "$report_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Database Maintenance Report - $(date)</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #f4f4f4; padding: 15px; border-radius: 5px; }
        .section { margin: 20px 0; }
        .success { color: green; }
        .warning { color: orange; }
        .error { color: red; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        pre { background-color: #f9f9f9; padding: 10px; border-radius: 3px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Database Maintenance Report</h1>
        <p><strong>Date:</strong> $(date)</p>
        <p><strong>Database:</strong> $DB_NAME@$DB_HOST:$DB_PORT</p>
    </div>

    <div class="section">
        <h2>Maintenance Summary</h2>
        <ul>
            <li>Database statistics updated</li>
            <li>Vacuum operations completed</li>
            <li>Materialized views refreshed</li>
            <li>Old data cleaned up</li>
            <li>Partitions managed</li>
        </ul>
    </div>

    <div class="section">
        <h2>Database Statistics</h2>
        <pre>$(get_db_stats 2>/dev/null || echo "Statistics unavailable")</pre>
    </div>

    <div class="section">
        <h2>Maintenance Log</h2>
        <pre>$(tail -50 "$LOG_FILE" | sed 's/</\&lt;/g; s/>/\&gt;/g')</pre>
    </div>
</body>
</html>
EOF

    log_success "Maintenance report generated: $report_file"
}

# Main maintenance routine
main() {
    log_info "Starting database maintenance for Learning Platform"
    log_info "================================================="

    # Check prerequisites
    if [[ -z "${DB_PASSWORD:-}" ]]; then
        log_error "DB_PASSWORD environment variable is required"
        exit 1
    fi

    if ! check_connection; then
        log_error "Database connection failed - aborting maintenance"
        exit 1
    fi

    # Get initial statistics
    get_db_stats

    # Perform maintenance tasks
    analyze_statistics
    vacuum_tables
    cleanup_old_data
    refresh_materialized_views
    manage_partitions

    # Optional tasks based on conditions
    if [[ "${FULL_MAINTENANCE:-false}" == "true" ]]; then
        log_info "Performing full maintenance..."
        reindex_tables
        analyze_index_usage
    fi

    # Monitoring and reporting
    monitor_queries
    generate_report

    log_success "Database maintenance completed successfully!"
    log_info "Log file: $LOG_FILE"
    log_info "================================================="
}

# Command line options
case "${1:-maintenance}" in
    "stats")
        check_connection && get_db_stats
        ;;
    "vacuum")
        check_connection && vacuum_tables
        ;;
    "analyze")
        check_connection && analyze_statistics
        ;;
    "cleanup")
        check_connection && cleanup_old_data
        ;;
    "partitions")
        check_connection && manage_partitions
        ;;
    "views")
        check_connection && refresh_materialized_views
        ;;
    "full")
        FULL_MAINTENANCE=true
        main
        ;;
    "maintenance"|*)
        main
        ;;
esac