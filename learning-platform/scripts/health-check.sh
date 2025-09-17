#!/bin/bash

# Health Check and Monitoring Script for Learning Platform
# This script performs comprehensive health checks and monitoring

set -e

# Configuration
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-http://localhost:3000/api/health}"
DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/learning_platform}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
LOG_FILE="/var/log/learning-platform-health.log"
METRICS_FILE="/var/log/learning-platform-metrics.log"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging function
log_with_timestamp() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local color_code=""
    
    case $level in
        "INFO") color_code=$BLUE ;;
        "SUCCESS") color_code=$GREEN ;;
        "WARNING") color_code=$YELLOW ;;
        "ERROR") color_code=$RED ;;
    esac
    
    echo -e "${color_code}[$timestamp] [$level]${NC} $message" | tee -a $LOG_FILE
}

# Send alert notification
send_alert() {
    local severity=$1
    local service=$2
    local message=$3
    local timestamp=$(date -Iseconds)
    
    log_with_timestamp "ERROR" "ALERT [$severity] $service: $message"
    
    if [ ! -z "$ALERT_WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{
                \"text\": \"🚨 Learning Platform Alert\",
                \"attachments\": [{
                    \"color\": \"danger\",
                    \"fields\": [
                        {\"title\": \"Severity\", \"value\": \"$severity\", \"short\": true},
                        {\"title\": \"Service\", \"value\": \"$service\", \"short\": true},
                        {\"title\": \"Message\", \"value\": \"$message\", \"short\": false},
                        {\"title\": \"Timestamp\", \"value\": \"$timestamp\", \"short\": true}
                    ]
                }]
            }" \
            $ALERT_WEBHOOK >/dev/null 2>&1 || true
    fi
}

# Check application health endpoint
check_application_health() {
    log_with_timestamp "INFO" "Checking application health..."
    
    local response
    local http_code
    local response_time
    
    # Measure response time and get HTTP status
    response=$(curl -s -w "%{http_code}|%{time_total}" --max-time 10 "$HEALTH_ENDPOINT" 2>/dev/null || echo "000|0")
    http_code=$(echo "$response" | cut -d'|' -f2)
    response_time=$(echo "$response" | cut -d'|' -f3)
    
    if [ "$http_code" = "200" ]; then
        log_with_timestamp "SUCCESS" "Application health check passed (${response_time}s)"
        echo "app_response_time:$response_time" >> $METRICS_FILE
        return 0
    else
        send_alert "HIGH" "Application" "Health check failed with HTTP $http_code"
        return 1
    fi
}

# Check database connectivity
check_database_health() {
    log_with_timestamp "INFO" "Checking database health..."
    
    local start_time=$(date +%s.%N)
    
    # Extract database connection details
    local db_host=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
    local db_port=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    local db_name=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
    local db_user=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    
    # Test database connection
    if PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
       psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -c "SELECT 1;" >/dev/null 2>&1; then
        
        local end_time=$(date +%s.%N)
        local response_time=$(echo "$end_time - $start_time" | bc)
        
        log_with_timestamp "SUCCESS" "Database health check passed (${response_time}s)"
        echo "db_response_time:$response_time" >> $METRICS_FILE
        
        # Check database performance
        check_database_performance "$db_host" "$db_port" "$db_user" "$db_name"
        return 0
    else
        send_alert "CRITICAL" "Database" "Database connection failed"
        return 1
    fi
}

# Check database performance metrics
check_database_performance() {
    local db_host=$1
    local db_port=$2
    local db_user=$3
    local db_name=$4
    
    log_with_timestamp "INFO" "Checking database performance metrics..."
    
    # Get connection count
    local connections=$(PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
        psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -t -c \
        "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | xargs)
    
    # Get database size
    local db_size=$(PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
        psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -t -c \
        "SELECT pg_size_pretty(pg_database_size('$db_name'));" 2>/dev/null | xargs)
    
    # Log metrics
    echo "db_active_connections:$connections" >> $METRICS_FILE
    log_with_timestamp "INFO" "Database metrics - Active connections: $connections, Size: $db_size"
    
    # Alert if too many connections
    if [ "$connections" -gt 80 ]; then
        send_alert "HIGH" "Database" "High number of active connections: $connections"
    fi
}

# Check Redis connectivity
check_redis_health() {
    log_with_timestamp "INFO" "Checking Redis health..."
    
    local redis_host=$(echo $REDIS_URL | sed -n 's/redis:\/\/\([^:]*\):.*/\1/p')
    local redis_port=$(echo $REDIS_URL | sed -n 's/.*:\([0-9]*\)/\1/p')
    
    local start_time=$(date +%s.%N)
    
    if redis-cli -h "$redis_host" -p "$redis_port" ping >/dev/null 2>&1; then
        local end_time=$(date +%s.%N)
        local response_time=$(echo "$end_time - $start_time" | bc)
        
        log_with_timestamp "SUCCESS" "Redis health check passed (${response_time}s)"
        echo "redis_response_time:$response_time" >> $METRICS_FILE
        
        # Get Redis metrics
        local memory_usage=$(redis-cli -h "$redis_host" -p "$redis_port" info memory | grep used_memory_human | cut -d: -f2 | tr -d '\r')
        local connected_clients=$(redis-cli -h "$redis_host" -p "$redis_port" info clients | grep connected_clients | cut -d: -f2 | tr -d '\r')
        
        echo "redis_memory_usage:$memory_usage" >> $METRICS_FILE
        echo "redis_connected_clients:$connected_clients" >> $METRICS_FILE
        
        log_with_timestamp "INFO" "Redis metrics - Memory: $memory_usage, Clients: $connected_clients"
        return 0
    else
        send_alert "HIGH" "Redis" "Redis connection failed"
        return 1
    fi
}

# Check system resources
check_system_resources() {
    log_with_timestamp "INFO" "Checking system resources..."
    
    # CPU usage
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
    cpu_usage=$(echo "$cpu_usage" | sed 's/[^0-9.]//g')
    
    # Memory usage
    local memory_info=$(free | grep Mem)
    local total_memory=$(echo $memory_info | awk '{print $2}')
    local used_memory=$(echo $memory_info | awk '{print $3}')
    local memory_usage=$(echo "scale=2; $used_memory * 100 / $total_memory" | bc)
    
    # Disk usage
    local disk_usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    
    # Log metrics
    echo "cpu_usage:$cpu_usage" >> $METRICS_FILE
    echo "memory_usage:$memory_usage" >> $METRICS_FILE
    echo "disk_usage:$disk_usage" >> $METRICS_FILE
    
    log_with_timestamp "INFO" "System metrics - CPU: ${cpu_usage}%, Memory: ${memory_usage}%, Disk: ${disk_usage}%"
    
    # Check thresholds and send alerts
    if (( $(echo "$cpu_usage > 80" | bc -l) )); then
        send_alert "HIGH" "System" "High CPU usage: ${cpu_usage}%"
    fi
    
    if (( $(echo "$memory_usage > 85" | bc -l) )); then
        send_alert "HIGH" "System" "High memory usage: ${memory_usage}%"
    fi
    
    if [ "$disk_usage" -gt 85 ]; then
        send_alert "HIGH" "System" "High disk usage: ${disk_usage}%"
    fi
}

# Check SSL certificate expiration
check_ssl_certificate() {
    local domain=${1:-"learning-platform.com"}
    log_with_timestamp "INFO" "Checking SSL certificate for $domain..."
    
    local expiry_date=$(echo | openssl s_client -servername $domain -connect $domain:443 2>/dev/null | \
        openssl x509 -noout -dates | grep notAfter | cut -d= -f2)
    
    if [ ! -z "$expiry_date" ]; then
        local expiry_epoch=$(date -d "$expiry_date" +%s)
        local current_epoch=$(date +%s)
        local days_until_expiry=$(( (expiry_epoch - current_epoch) / 86400 ))
        
        log_with_timestamp "INFO" "SSL certificate expires in $days_until_expiry days"
        echo "ssl_days_until_expiry:$days_until_expiry" >> $METRICS_FILE
        
        if [ "$days_until_expiry" -lt 30 ]; then
            send_alert "HIGH" "SSL" "SSL certificate expires in $days_until_expiry days"
        fi
    else
        send_alert "HIGH" "SSL" "Unable to retrieve SSL certificate information"
    fi
}

# Check backup status
check_backup_status() {
    log_with_timestamp "INFO" "Checking backup status..."
    
    # Check latest RDS backup
    local latest_backup=$(aws rds describe-db-snapshots \
        --db-instance-identifier learning-platform-prod \
        --snapshot-type automated \
        --query 'DBSnapshots[0].SnapshotCreateTime' \
        --output text 2>/dev/null || echo "")
    
    if [ ! -z "$latest_backup" ] && [ "$latest_backup" != "None" ]; then
        local backup_epoch=$(date -d "$latest_backup" +%s)
        local current_epoch=$(date +%s)
        local hours_since_backup=$(( (current_epoch - backup_epoch) / 3600 ))
        
        log_with_timestamp "INFO" "Latest backup was $hours_since_backup hours ago"
        echo "hours_since_backup:$hours_since_backup" >> $METRICS_FILE
        
        if [ "$hours_since_backup" -gt 25 ]; then
            send_alert "HIGH" "Backup" "No backup in the last 25 hours"
        fi
    else
        send_alert "HIGH" "Backup" "Unable to retrieve backup information"
    fi
}

# Generate health report
generate_health_report() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local total_checks=0
    local passed_checks=0
    
    echo "========================================" >> $LOG_FILE
    echo "Health Check Report - $timestamp" >> $LOG_FILE
    echo "========================================" >> $LOG_FILE
    
    # Run all health checks
    checks=(
        "check_application_health"
        "check_database_health"
        "check_redis_health"
        "check_system_resources"
        "check_ssl_certificate"
        "check_backup_status"
    )
    
    for check in "${checks[@]}"; do
        total_checks=$((total_checks + 1))
        if $check; then
            passed_checks=$((passed_checks + 1))
        fi
    done
    
    local health_score=$(echo "scale=2; $passed_checks * 100 / $total_checks" | bc)
    echo "health_score:$health_score" >> $METRICS_FILE
    
    log_with_timestamp "INFO" "Health check completed - Score: ${health_score}% ($passed_checks/$total_checks checks passed)"
    
    if (( $(echo "$health_score < 80" | bc -l) )); then
        send_alert "HIGH" "System" "Overall health score is low: ${health_score}%"
    fi
}

# Cleanup old logs
cleanup_old_logs() {
    find /var/log -name "learning-platform-*.log" -mtime +7 -delete 2>/dev/null || true
}

# Main function
main() {
    # Ensure log directory exists
    mkdir -p $(dirname $LOG_FILE)
    mkdir -p $(dirname $METRICS_FILE)
    
    # Add timestamp to metrics file
    echo "timestamp:$(date -Iseconds)" >> $METRICS_FILE
    
    log_with_timestamp "INFO" "Starting health check monitoring..."
    
    generate_health_report
    cleanup_old_logs
    
    log_with_timestamp "INFO" "Health check monitoring completed"
}

# Handle script arguments
case "${1:-}" in
    --continuous)
        log_with_timestamp "INFO" "Starting continuous monitoring mode..."
        while true; do
            main
            sleep 300  # Run every 5 minutes
        done
        ;;
    --help|-h)
        echo "Usage: $0 [--continuous] [--help]"
        echo "  --continuous  Run health checks continuously every 5 minutes"
        echo "  --help        Show this help message"
        exit 0
        ;;
    *)
        main
        ;;
esac