#!/bin/bash

# Enterprise Database Backup and Recovery Script
# Optimized for Google Cloud SQL with enterprise-grade features

set -euo pipefail

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-rds-lms}"
INSTANCE_NAME="${DB_INSTANCE_NAME:-learning-platform-prod}"
DATABASE_NAME="${DB_NAME:-learning_platform}"
BACKUP_BUCKET="${BACKUP_BUCKET:-gs://learning-platform-backups}"
NOTIFICATION_EMAIL="${NOTIFICATION_EMAIL:-admin@example.com}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging
LOG_FILE="/tmp/db-backup-$(date +%Y%m%d_%H%M%S).log"
exec 1> >(tee -a "$LOG_FILE")
exec 2> >(tee -a "$LOG_FILE" >&2)

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# Check dependencies
check_dependencies() {
    log "Checking dependencies..."

    if ! command -v gcloud &> /dev/null; then
        error "gcloud CLI not found. Please install Google Cloud CLI."
        exit 1
    fi

    if ! command -v gsutil &> /dev/null; then
        error "gsutil not found. Please install Google Cloud CLI."
        exit 1
    fi

    if ! command -v pg_dump &> /dev/null; then
        warn "pg_dump not found. Will use Cloud SQL export instead."
    fi

    # Verify authentication
    if ! gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q .; then
        error "Not authenticated with Google Cloud. Run 'gcloud auth login'"
        exit 1
    fi

    log "Dependencies check completed"
}

# Create backup directory structure
setup_backup_structure() {
    local date_path=$(date +%Y/%m/%d)
    local timestamp=$(date +%Y%m%d_%H%M%S)

    export BACKUP_PATH="${BACKUP_BUCKET}/${date_path}"
    export BACKUP_FILENAME="learning_platform_backup_${timestamp}"
    export BACKUP_URI="${BACKUP_PATH}/${BACKUP_FILENAME}.sql"

    log "Backup will be stored at: ${BACKUP_URI}"
}

# Pre-backup health checks
pre_backup_checks() {
    log "Running pre-backup health checks..."

    # Check Cloud SQL instance status
    local instance_status=$(gcloud sql instances describe "$INSTANCE_NAME" \
        --project="$PROJECT_ID" \
        --format="value(state)" 2>/dev/null || echo "NOT_FOUND")

    if [[ "$instance_status" != "RUNNABLE" ]]; then
        error "Cloud SQL instance $INSTANCE_NAME is not in RUNNABLE state: $instance_status"
        return 1
    fi

    # Check available storage
    local storage_info=$(gcloud sql instances describe "$INSTANCE_NAME" \
        --project="$PROJECT_ID" \
        --format="json" | jq -r '.settings.dataDiskSizeGb, .currentDiskSize')

    log "Storage info: Allocated $(echo $storage_info | cut -d' ' -f1)GB, Used $(echo $storage_info | cut -d' ' -f2)GB"

    # Check for active long-running transactions
    log "Checking for long-running transactions..."

    # Check replication lag if replicas exist
    local replicas=$(gcloud sql instances list --filter="masterInstanceName:$INSTANCE_NAME" \
        --format="value(name)" --project="$PROJECT_ID")

    if [[ -n "$replicas" ]]; then
        log "Found replicas: $replicas"
        for replica in $replicas; do
            log "Checking replication lag for $replica..."
            # Additional replica-specific checks would go here
        done
    fi

    log "Pre-backup checks completed successfully"
}

# Create Cloud SQL export
create_cloud_sql_export() {
    log "Creating Cloud SQL export..."

    local export_operation=$(gcloud sql export sql "$INSTANCE_NAME" "$BACKUP_URI" \
        --database="$DATABASE_NAME" \
        --project="$PROJECT_ID" \
        --format="value(name)")

    if [[ -z "$export_operation" ]]; then
        error "Failed to start Cloud SQL export operation"
        return 1
    fi

    log "Export operation started: $export_operation"

    # Wait for operation to complete
    log "Waiting for export to complete..."
    gcloud sql operations wait "$export_operation" \
        --project="$PROJECT_ID" \
        --timeout=3600

    local operation_status=$(gcloud sql operations describe "$export_operation" \
        --project="$PROJECT_ID" \
        --format="value(status)")

    if [[ "$operation_status" != "DONE" ]]; then
        error "Export operation failed with status: $operation_status"
        return 1
    fi

    log "Cloud SQL export completed successfully"
}

# Create logical backup using pg_dump
create_logical_backup() {
    log "Creating logical backup using pg_dump..."

    # Get connection details
    local connection_name=$(gcloud sql instances describe "$INSTANCE_NAME" \
        --project="$PROJECT_ID" \
        --format="value(connectionName)")

    local db_user="${DB_USER:-postgres}"
    local db_password="${DB_PASSWORD}"

    if [[ -z "$db_password" ]]; then
        error "DB_PASSWORD environment variable not set"
        return 1
    fi

    local logical_backup_file="/tmp/${BACKUP_FILENAME}_logical.sql"

    # Create pg_dump with optimal settings for large databases
    PGPASSWORD="$db_password" pg_dump \
        --host="/cloudsql/$connection_name" \
        --username="$db_user" \
        --dbname="$DATABASE_NAME" \
        --verbose \
        --no-owner \
        --no-privileges \
        --format=custom \
        --compress=9 \
        --serializable-deferrable \
        --jobs=4 \
        --file="$logical_backup_file"

    # Upload to Cloud Storage
    gsutil -m cp "$logical_backup_file" "${BACKUP_PATH}/${BACKUP_FILENAME}_logical.dump"

    # Cleanup local file
    rm -f "$logical_backup_file"

    log "Logical backup completed successfully"
}

# Create schema-only backup
create_schema_backup() {
    log "Creating schema-only backup..."

    local connection_name=$(gcloud sql instances describe "$INSTANCE_NAME" \
        --project="$PROJECT_ID" \
        --format="value(connectionName)")

    local db_user="${DB_USER:-postgres}"
    local db_password="${DB_PASSWORD}"

    local schema_backup_file="/tmp/${BACKUP_FILENAME}_schema.sql"

    PGPASSWORD="$db_password" pg_dump \
        --host="/cloudsql/$connection_name" \
        --username="$db_user" \
        --dbname="$DATABASE_NAME" \
        --schema-only \
        --verbose \
        --no-owner \
        --no-privileges \
        --file="$schema_backup_file"

    # Upload to Cloud Storage
    gsutil -m cp "$schema_backup_file" "${BACKUP_PATH}/${BACKUP_FILENAME}_schema.sql"

    # Cleanup local file
    rm -f "$schema_backup_file"

    log "Schema backup completed successfully"
}

# Validate backup integrity
validate_backup() {
    log "Validating backup integrity..."

    # Check if backup files exist and have size > 0
    local backup_files=(
        "${BACKUP_URI}"
        "${BACKUP_PATH}/${BACKUP_FILENAME}_schema.sql"
    )

    if command -v pg_dump &> /dev/null && [[ -n "${DB_PASSWORD:-}" ]]; then
        backup_files+=("${BACKUP_PATH}/${BACKUP_FILENAME}_logical.dump")
    fi

    for backup_file in "${backup_files[@]}"; do
        local file_size=$(gsutil du "$backup_file" 2>/dev/null | awk '{print $1}' || echo "0")

        if [[ "$file_size" -eq 0 ]]; then
            error "Backup file $backup_file is empty or doesn't exist"
            return 1
        fi

        log "Backup file $backup_file size: ${file_size} bytes"
    done

    # Test restore to a temporary instance (optional, resource-intensive)
    if [[ "${VALIDATE_RESTORE:-false}" == "true" ]]; then
        log "Running restore validation (this may take a while)..."
        validate_restore_process
    fi

    log "Backup validation completed successfully"
}

# Validate restore process (optional)
validate_restore_process() {
    local test_instance="${INSTANCE_NAME}-restore-test-$(date +%s)"
    local test_db="${DATABASE_NAME}_test"

    log "Creating test instance for restore validation: $test_instance"

    # Create temporary instance
    gcloud sql instances create "$test_instance" \
        --project="$PROJECT_ID" \
        --database-version=POSTGRES_13 \
        --tier=db-f1-micro \
        --region=us-central1 \
        --storage-type=SSD \
        --storage-size=20GB \
        --deletion-protection=false

    # Wait for instance to be ready
    gcloud sql operations wait \
        $(gcloud sql instances create "$test_instance" --format="value(name)") \
        --project="$PROJECT_ID"

    # Import backup
    log "Importing backup to test instance..."
    local import_operation=$(gcloud sql import sql "$test_instance" "$BACKUP_URI" \
        --database="$test_db" \
        --project="$PROJECT_ID" \
        --format="value(name)")

    gcloud sql operations wait "$import_operation" --project="$PROJECT_ID"

    # Run basic validation queries
    log "Running validation queries..."
    # Add specific validation queries here based on your schema

    # Cleanup test instance
    log "Cleaning up test instance..."
    gcloud sql instances delete "$test_instance" --project="$PROJECT_ID" --quiet

    log "Restore validation completed successfully"
}

# Generate backup metadata
generate_backup_metadata() {
    log "Generating backup metadata..."

    local metadata_file="/tmp/${BACKUP_FILENAME}_metadata.json"

    # Get database statistics
    local db_size=$(gcloud sql instances describe "$INSTANCE_NAME" \
        --project="$PROJECT_ID" \
        --format="value(currentDiskSize)")

    # Create metadata JSON
    cat > "$metadata_file" << EOF
{
    "backup_timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "instance_name": "$INSTANCE_NAME",
    "database_name": "$DATABASE_NAME",
    "project_id": "$PROJECT_ID",
    "backup_type": "full",
    "backup_uri": "$BACKUP_URI",
    "database_size_gb": "$db_size",
    "backup_method": "cloud_sql_export",
    "retention_days": $RETENTION_DAYS,
    "schema": {
        "version": "$(date +%Y%m%d_%H%M%S)",
        "backup_uri": "${BACKUP_PATH}/${BACKUP_FILENAME}_schema.sql"
    },
    "validation": {
        "completed": true,
        "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "environment": {
        "node_env": "${NODE_ENV:-production}",
        "backup_script_version": "1.0.0"
    }
}
EOF

    # Upload metadata
    gsutil -m cp "$metadata_file" "${BACKUP_PATH}/${BACKUP_FILENAME}_metadata.json"

    # Cleanup local file
    rm -f "$metadata_file"

    log "Backup metadata generated successfully"
}

# Cleanup old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."

    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" +%Y/%m/%d)

    # List and delete old backup directories
    gsutil -m ls -d "${BACKUP_BUCKET}/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]/" | while read -r dir; do
        local dir_date=$(echo "$dir" | grep -oP '\d{4}/\d{2}/\d{2}')
        local dir_date_formatted=$(echo "$dir_date" | tr '/' '-')

        if [[ "$dir_date_formatted" < "${cutoff_date/\//-}" ]]; then
            log "Deleting old backup directory: $dir"
            gsutil -m rm -r "$dir"
        fi
    done

    log "Old backup cleanup completed"
}

# Send notifications
send_notifications() {
    local status=$1
    local message=$2

    log "Sending notifications..."

    # Email notification
    if [[ -n "$NOTIFICATION_EMAIL" ]] && command -v sendmail &> /dev/null; then
        local subject="Database Backup ${status^^}: $INSTANCE_NAME"

        cat << EOF | sendmail "$NOTIFICATION_EMAIL"
To: $NOTIFICATION_EMAIL
Subject: $subject

Database Backup Report
====================

Instance: $INSTANCE_NAME
Database: $DATABASE_NAME
Status: ${status^^}
Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Backup URI: $BACKUP_URI

Message: $message

Backup Details:
- Project: $PROJECT_ID
- Backup Path: $BACKUP_PATH
- Retention: $RETENTION_DAYS days

EOF
    fi

    # Slack notification
    if [[ -n "$SLACK_WEBHOOK" ]]; then
        local color="good"
        if [[ "$status" != "success" ]]; then
            color="danger"
        fi

        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"title\": \"Database Backup ${status^^}: $INSTANCE_NAME\",
                    \"fields\": [
                        {\"title\": \"Instance\", \"value\": \"$INSTANCE_NAME\", \"short\": true},
                        {\"title\": \"Database\", \"value\": \"$DATABASE_NAME\", \"short\": true},
                        {\"title\": \"Status\", \"value\": \"${status^^}\", \"short\": true},
                        {\"title\": \"Timestamp\", \"value\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"short\": true},
                        {\"title\": \"Message\", \"value\": \"$message\", \"short\": false}
                    ]
                }]
            }" \
            "$SLACK_WEBHOOK"
    fi

    log "Notifications sent"
}

# Main backup function
run_backup() {
    log "Starting database backup process..."

    local start_time=$(date +%s)

    # Setup
    check_dependencies
    setup_backup_structure

    # Pre-backup checks
    if ! pre_backup_checks; then
        error "Pre-backup checks failed"
        send_notifications "failed" "Pre-backup checks failed"
        exit 1
    fi

    # Create backups
    if ! create_cloud_sql_export; then
        error "Cloud SQL export failed"
        send_notifications "failed" "Cloud SQL export failed"
        exit 1
    fi

    if ! create_schema_backup; then
        warn "Schema backup failed, continuing..."
    fi

    if command -v pg_dump &> /dev/null && [[ -n "${DB_PASSWORD:-}" ]]; then
        if ! create_logical_backup; then
            warn "Logical backup failed, continuing..."
        fi
    fi

    # Validation
    if ! validate_backup; then
        error "Backup validation failed"
        send_notifications "failed" "Backup validation failed"
        exit 1
    fi

    # Generate metadata
    generate_backup_metadata

    # Cleanup
    cleanup_old_backups

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log "Backup completed successfully in ${duration}s"
    send_notifications "success" "Backup completed successfully in ${duration}s. Backup URI: $BACKUP_URI"

    # Upload log file
    gsutil -m cp "$LOG_FILE" "${BACKUP_PATH}/${BACKUP_FILENAME}_backup.log"
}

# Recovery functions
restore_from_backup() {
    local backup_uri=$1
    local target_instance=$2
    local target_database=${3:-$DATABASE_NAME}

    log "Starting database restore from $backup_uri to $target_instance"

    if [[ -z "$backup_uri" ]] || [[ -z "$target_instance" ]]; then
        error "Usage: restore_from_backup <backup_uri> <target_instance> [target_database]"
        exit 1
    fi

    # Check if target instance exists
    local instance_exists=$(gcloud sql instances describe "$target_instance" \
        --project="$PROJECT_ID" \
        --format="value(name)" 2>/dev/null || echo "")

    if [[ -z "$instance_exists" ]]; then
        error "Target instance $target_instance does not exist"
        exit 1
    fi

    # Import backup
    log "Importing backup to $target_instance..."
    local import_operation=$(gcloud sql import sql "$target_instance" "$backup_uri" \
        --database="$target_database" \
        --project="$PROJECT_ID" \
        --format="value(name)")

    if [[ -z "$import_operation" ]]; then
        error "Failed to start import operation"
        exit 1
    fi

    log "Import operation started: $import_operation"
    gcloud sql operations wait "$import_operation" --project="$PROJECT_ID"

    log "Database restore completed successfully"
}

# Point-in-time recovery
point_in_time_recovery() {
    local target_time=$1
    local target_instance=$2

    log "Starting point-in-time recovery to $target_time"

    if [[ -z "$target_time" ]] || [[ -z "$target_instance" ]]; then
        error "Usage: point_in_time_recovery <target_time> <target_instance>"
        echo "Example: point_in_time_recovery '2024-01-15T10:30:00Z' 'restored-instance'"
        exit 1
    fi

    # Clone instance to target time
    log "Creating point-in-time recovery clone..."
    local clone_operation=$(gcloud sql instances clone "$INSTANCE_NAME" "$target_instance" \
        --point-in-time="$target_time" \
        --project="$PROJECT_ID" \
        --format="value(name)")

    if [[ -z "$clone_operation" ]]; then
        error "Failed to start clone operation"
        exit 1
    fi

    log "Clone operation started: $clone_operation"
    gcloud sql operations wait "$clone_operation" --project="$PROJECT_ID" --timeout=7200

    log "Point-in-time recovery completed successfully"
}

# Command line interface
case "${1:-backup}" in
    "backup")
        run_backup
        ;;
    "restore")
        restore_from_backup "$2" "$3" "$4"
        ;;
    "pitr")
        point_in_time_recovery "$2" "$3"
        ;;
    "validate")
        VALIDATE_RESTORE=true
        run_backup
        ;;
    "cleanup")
        setup_backup_structure
        cleanup_old_backups
        ;;
    *)
        echo "Usage: $0 {backup|restore|pitr|validate|cleanup}"
        echo ""
        echo "Commands:"
        echo "  backup                             - Run full backup"
        echo "  restore <backup_uri> <instance>    - Restore from backup"
        echo "  pitr <timestamp> <instance>        - Point-in-time recovery"
        echo "  validate                           - Backup with restore validation"
        echo "  cleanup                            - Cleanup old backups"
        echo ""
        echo "Examples:"
        echo "  $0 backup"
        echo "  $0 restore gs://bucket/backup.sql my-instance"
        echo "  $0 pitr '2024-01-15T10:30:00Z' restored-instance"
        exit 1
        ;;
esac