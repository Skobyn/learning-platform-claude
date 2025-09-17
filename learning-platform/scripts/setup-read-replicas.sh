#!/bin/bash

# Database Read Replica Setup Script for Learning Platform
# Optimized for 100K+ concurrent users with high-availability requirements

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PRIMARY_DB_HOST="${PRIMARY_DB_HOST:-localhost}"
PRIMARY_DB_PORT="${PRIMARY_DB_PORT:-5432}"
PRIMARY_DB_NAME="${PRIMARY_DB_NAME:-learning_platform}"
PRIMARY_DB_USER="${PRIMARY_DB_USER:-postgres}"
PRIMARY_DB_PASSWORD="${PRIMARY_DB_PASSWORD}"

REPLICA_DB_HOST="${REPLICA_DB_HOST:-localhost-replica}"
REPLICA_DB_PORT="${REPLICA_DB_PORT:-5433}"
REPLICA_DB_DATA_DIR="${REPLICA_DB_DATA_DIR:-/var/lib/postgresql/13/replica}"

# Replication user
REPLICATION_USER="${REPLICATION_USER:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD}"

# Logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v psql &> /dev/null; then
        log_error "PostgreSQL client (psql) is not installed"
        exit 1
    fi

    if ! command -v pg_basebackup &> /dev/null; then
        log_error "pg_basebackup is not available"
        exit 1
    fi

    if [[ -z "${PRIMARY_DB_PASSWORD:-}" ]]; then
        log_error "PRIMARY_DB_PASSWORD environment variable is required"
        exit 1
    fi

    if [[ -z "${REPLICATION_PASSWORD:-}" ]]; then
        log_error "REPLICATION_PASSWORD environment variable is required"
        exit 1
    fi

    log_success "Prerequisites check completed"
}

# Setup replication user on primary database
setup_replication_user() {
    log_info "Setting up replication user on primary database..."

    PGPASSWORD="$PRIMARY_DB_PASSWORD" psql \
        -h "$PRIMARY_DB_HOST" \
        -p "$PRIMARY_DB_PORT" \
        -U "$PRIMARY_DB_USER" \
        -d "$PRIMARY_DB_NAME" \
        -c "DO \$\$
        BEGIN
            IF NOT EXISTS (
                SELECT FROM pg_catalog.pg_roles
                WHERE rolname = '$REPLICATION_USER'
            ) THEN
                CREATE ROLE $REPLICATION_USER WITH REPLICATION LOGIN PASSWORD '$REPLICATION_PASSWORD';
            END IF;
        END
        \$\$;"

    log_success "Replication user created/verified"
}

# Configure primary database for replication
configure_primary_database() {
    log_info "Configuring primary database for replication..."

    # Note: These commands typically require direct file system access
    # In cloud environments, these would be configured through the cloud provider's interface

    cat << 'EOF'
Primary database configuration requirements:
1. Edit postgresql.conf:
   wal_level = replica
   max_wal_senders = 10
   max_replication_slots = 10
   synchronous_commit = on
   archive_mode = on
   archive_command = 'test ! -f /var/lib/postgresql/13/main/archive/%f && cp %p /var/lib/postgresql/13/main/archive/%f'
   hot_standby = on
   hot_standby_feedback = on

2. Edit pg_hba.conf:
   host replication replicator PRIMARY_REPLICA_SUBNET/24 md5
   host replication replicator SECONDARY_REPLICA_SUBNET/24 md5

3. Restart PostgreSQL service:
   sudo systemctl restart postgresql
EOF

    log_warning "Manual configuration required - see output above"
}

# Create physical replication slot
create_replication_slot() {
    log_info "Creating replication slot..."

    PGPASSWORD="$PRIMARY_DB_PASSWORD" psql \
        -h "$PRIMARY_DB_HOST" \
        -p "$PRIMARY_DB_PORT" \
        -U "$PRIMARY_DB_USER" \
        -d "$PRIMARY_DB_NAME" \
        -c "SELECT pg_create_physical_replication_slot('replica_slot');" \
        2>/dev/null || log_warning "Replication slot may already exist"

    log_success "Replication slot created/verified"
}

# Create base backup for replica
create_base_backup() {
    log_info "Creating base backup for replica..."

    # Create data directory
    sudo mkdir -p "$REPLICA_DB_DATA_DIR"
    sudo chown postgres:postgres "$REPLICA_DB_DATA_DIR"

    # Create base backup
    sudo -u postgres PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
        -h "$PRIMARY_DB_HOST" \
        -p "$PRIMARY_DB_PORT" \
        -U "$REPLICATION_USER" \
        -D "$REPLICA_DB_DATA_DIR" \
        -P \
        -W \
        -R \
        -X stream \
        -S replica_slot

    log_success "Base backup created"
}

# Configure replica database
configure_replica_database() {
    log_info "Configuring replica database..."

    # Create recovery.conf (for PostgreSQL < 12) or update postgresql.conf (for PostgreSQL >= 12)
    POSTGRESQL_VERSION=$(sudo -u postgres psql --version | grep -oE '[0-9]+\.[0-9]+' | head -1)
    MAJOR_VERSION=$(echo "$POSTGRESQL_VERSION" | cut -d. -f1)

    if [[ "$MAJOR_VERSION" -ge 12 ]]; then
        # PostgreSQL 12+ configuration
        sudo tee -a "$REPLICA_DB_DATA_DIR/postgresql.conf" << EOF
# Replica configuration
primary_conninfo = 'host=$PRIMARY_DB_HOST port=$PRIMARY_DB_PORT user=$REPLICATION_USER password=$REPLICATION_PASSWORD application_name=replica1'
primary_slot_name = 'replica_slot'
promote_trigger_file = '/tmp/promote_replica'
hot_standby = on
hot_standby_feedback = on
max_standby_streaming_delay = 30s
max_standby_archive_delay = 30s
wal_receiver_status_interval = 10s
recovery_min_apply_delay = 0
EOF
        # Create standby.signal file
        sudo touch "$REPLICA_DB_DATA_DIR/standby.signal"
    else
        # PostgreSQL < 12 configuration
        sudo tee "$REPLICA_DB_DATA_DIR/recovery.conf" << EOF
standby_mode = 'on'
primary_conninfo = 'host=$PRIMARY_DB_HOST port=$PRIMARY_DB_PORT user=$REPLICATION_USER password=$REPLICATION_PASSWORD application_name=replica1'
primary_slot_name = 'replica_slot'
trigger_file = '/tmp/promote_replica'
hot_standby = on
hot_standby_feedback = on
max_standby_streaming_delay = 30s
max_standby_archive_delay = 30s
wal_receiver_status_interval = 10s
recovery_min_apply_delay = 0
EOF
    fi

    # Update postgresql.conf for replica-specific settings
    sudo tee -a "$REPLICA_DB_DATA_DIR/postgresql.conf" << EOF
# Replica specific settings
port = $REPLICA_DB_PORT
listen_addresses = '*'
log_destination = 'stderr'
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = 1d
log_rotation_size = 100MB
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0
log_autovacuum_min_duration = 0
log_error_verbosity = default
log_statement = 'ddl'
log_replication_commands = on
EOF

    log_success "Replica database configured"
}

# Setup systemd service for replica
setup_replica_service() {
    log_info "Setting up systemd service for replica..."

    sudo tee /etc/systemd/system/postgresql-replica.service << EOF
[Unit]
Description=PostgreSQL Read Replica
Documentation=man:postgres(1)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=postgres
ExecStart=/usr/lib/postgresql/13/bin/postgres -D $REPLICA_DB_DATA_DIR
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
KillSignal=SIGINT
TimeoutSec=0

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable postgresql-replica

    log_success "Systemd service configured"
}

# Start replica database
start_replica() {
    log_info "Starting replica database..."

    sudo systemctl start postgresql-replica

    # Wait for replica to start
    sleep 5

    # Check if replica is running
    if sudo systemctl is-active --quiet postgresql-replica; then
        log_success "Replica database started successfully"
    else
        log_error "Failed to start replica database"
        exit 1
    fi
}

# Verify replication status
verify_replication() {
    log_info "Verifying replication status..."

    # Check replication status on primary
    log_info "Primary database replication status:"
    PGPASSWORD="$PRIMARY_DB_PASSWORD" psql \
        -h "$PRIMARY_DB_HOST" \
        -p "$PRIMARY_DB_PORT" \
        -U "$PRIMARY_DB_USER" \
        -d "$PRIMARY_DB_NAME" \
        -c "SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn, sync_state FROM pg_stat_replication;"

    # Check replica status
    log_info "Replica database status:"
    PGPASSWORD="$REPLICATION_PASSWORD" psql \
        -h "$REPLICA_DB_HOST" \
        -p "$REPLICA_DB_PORT" \
        -U "$REPLICATION_USER" \
        -d "$PRIMARY_DB_NAME" \
        -c "SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp();" \
        || log_warning "Could not connect to replica - it may still be starting up"

    log_success "Replication verification completed"
}

# Setup connection pooling with PgBouncer
setup_pgbouncer() {
    log_info "Setting up PgBouncer for connection pooling..."

    # Install PgBouncer
    sudo apt-get update
    sudo apt-get install -y pgbouncer

    # Configure PgBouncer
    sudo tee /etc/pgbouncer/pgbouncer.ini << EOF
[databases]
learning_platform_write = host=$PRIMARY_DB_HOST port=$PRIMARY_DB_PORT dbname=$PRIMARY_DB_NAME
learning_platform_read = host=$REPLICA_DB_HOST port=$REPLICA_DB_PORT dbname=$PRIMARY_DB_NAME

[pgbouncer]
listen_port = 6432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
admin_users = postgres
stats_users = postgres

# Pool settings optimized for high concurrency
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 100
min_pool_size = 20
reserve_pool_size = 10
reserve_pool_timeout = 5
max_db_connections = 100
max_user_connections = 100

# Connection settings
server_reset_query = DISCARD ALL
server_check_query = SELECT 1
server_check_delay = 30

# Timeouts
server_connect_timeout = 15
server_login_retry = 15
query_timeout = 0
query_wait_timeout = 120
client_idle_timeout = 0
server_idle_timeout = 600
server_lifetime = 3600
client_login_timeout = 60

# Logging
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
syslog = 1
syslog_ident = pgbouncer
syslog_facility = daemon

# Performance tuning
so_reuseport = 1
tcp_keepalive = 1
tcp_keepidle = 600
tcp_keepintvl = 30
tcp_keepcnt = 3
EOF

    # Setup user authentication
    sudo tee /etc/pgbouncer/userlist.txt << EOF
"$PRIMARY_DB_USER" "md5$(echo -n "$PRIMARY_DB_PASSWORD$PRIMARY_DB_USER" | md5sum | cut -d' ' -f1)"
"$REPLICATION_USER" "md5$(echo -n "$REPLICATION_PASSWORD$REPLICATION_USER" | md5sum | cut -d' ' -f1)"
EOF

    sudo chown postgres:postgres /etc/pgbouncer/userlist.txt
    sudo chmod 640 /etc/pgbouncer/userlist.txt

    # Start PgBouncer
    sudo systemctl enable pgbouncer
    sudo systemctl start pgbouncer

    log_success "PgBouncer configured and started"
}

# Setup monitoring and alerting
setup_monitoring() {
    log_info "Setting up replication monitoring..."

    # Create monitoring script
    sudo tee /usr/local/bin/check-replication.sh << 'EOF'
#!/bin/bash

# Check replication lag
LAG=$(PGPASSWORD="$REPLICATION_PASSWORD" psql \
    -h "$REPLICA_DB_HOST" \
    -p "$REPLICA_DB_PORT" \
    -U "$REPLICATION_USER" \
    -d "$PRIMARY_DB_NAME" \
    -t -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()));" \
    2>/dev/null | tr -d ' ')

if [[ -n "$LAG" ]] && [[ "$LAG" != "" ]]; then
    if (( $(echo "$LAG > 300" | bc -l) )); then
        echo "CRITICAL: Replication lag is ${LAG} seconds"
        exit 2
    elif (( $(echo "$LAG > 60" | bc -l) )); then
        echo "WARNING: Replication lag is ${LAG} seconds"
        exit 1
    else
        echo "OK: Replication lag is ${LAG} seconds"
        exit 0
    fi
else
    echo "CRITICAL: Unable to determine replication lag"
    exit 2
fi
EOF

    sudo chmod +x /usr/local/bin/check-replication.sh

    # Setup cron job for monitoring
    echo "*/5 * * * * root /usr/local/bin/check-replication.sh >> /var/log/replication-check.log 2>&1" | sudo tee -a /etc/crontab

    log_success "Monitoring setup completed"
}

# Create environment configuration
create_env_config() {
    log_info "Creating environment configuration..."

    cat << EOF > /tmp/database-config.env
# Primary Database (Write operations)
DATABASE_URL="postgresql://$PRIMARY_DB_USER:$PRIMARY_DB_PASSWORD@$PRIMARY_DB_HOST:$PRIMARY_DB_PORT/$PRIMARY_DB_NAME"

# Read Replica Database (Read operations)
DATABASE_READ_REPLICA_URL="postgresql://$PRIMARY_DB_USER:$PRIMARY_DB_PASSWORD@$REPLICA_DB_HOST:$REPLICA_DB_PORT/$PRIMARY_DB_NAME"

# PgBouncer Connection Pools
DATABASE_WRITE_POOL_URL="postgresql://$PRIMARY_DB_USER:$PRIMARY_DB_PASSWORD@localhost:6432/learning_platform_write"
DATABASE_READ_POOL_URL="postgresql://$PRIMARY_DB_USER:$PRIMARY_DB_PASSWORD@localhost:6432/learning_platform_read"

# Connection Pool Settings
DB_POOL_SIZE=100
DB_POOL_MIN=20
DB_POOL_MAX=200
DB_POOL_TIMEOUT=5000
DB_CONNECTION_TIMEOUT=15000
EOF

    log_success "Environment configuration created at /tmp/database-config.env"
    log_info "Copy these environment variables to your application configuration"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    # Add any cleanup logic here
}

# Main execution
main() {
    log_info "Starting PostgreSQL Read Replica Setup for Learning Platform"
    log_info "=============================================================="

    # Set trap for cleanup
    trap cleanup EXIT

    check_prerequisites
    setup_replication_user
    configure_primary_database
    create_replication_slot
    create_base_backup
    configure_replica_database
    setup_replica_service
    start_replica
    verify_replication
    setup_pgbouncer
    setup_monitoring
    create_env_config

    log_success "Read replica setup completed successfully!"
    log_info "============================================"
    log_info "Next steps:"
    log_info "1. Update your application to use the read replica for SELECT queries"
    log_info "2. Configure your load balancer to route read traffic to the replica"
    log_info "3. Monitor replication lag and performance"
    log_info "4. Test failover procedures"
    log_info "============================================"
}

# Execute main function
main "$@"