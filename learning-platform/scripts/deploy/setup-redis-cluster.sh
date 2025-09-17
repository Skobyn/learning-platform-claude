#!/bin/bash

# Redis Cluster Setup Script
# Production-ready Redis cluster deployment with high availability

set -e

# Configuration
REDIS_VERSION="7.2.4"
CLUSTER_NODES=6
MASTER_NODES=3
REPLICA_NODES=3
BASE_PORT=7000
SENTINEL_PORT=26379
REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -base64 32)}"
SENTINEL_PASSWORD="${SENTINEL_PASSWORD:-$(openssl rand -base64 32)}"

# Directories
REDIS_DIR="/opt/redis"
CONFIG_DIR="/etc/redis"
LOG_DIR="/var/log/redis"
DATA_DIR="/var/lib/redis"
SYSTEMD_DIR="/etc/systemd/system"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi

    # Check required commands
    local required_commands=("wget" "tar" "systemctl" "openssl")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "Required command '$cmd' not found"
            exit 1
        fi
    done

    # Check available memory
    local mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_gb=$((mem_kb / 1024 / 1024))
    if [[ $mem_gb -lt 4 ]]; then
        log_warn "System has less than 4GB RAM. Redis cluster may not perform optimally."
    fi
}

install_redis() {
    log_info "Installing Redis $REDIS_VERSION..."

    # Create redis user if not exists
    if ! id -u redis &>/dev/null; then
        useradd -r -s /bin/false redis
        log_info "Created redis user"
    fi

    # Create directories
    mkdir -p "$REDIS_DIR" "$CONFIG_DIR" "$LOG_DIR" "$DATA_DIR" "$SYSTEMD_DIR"

    # Download and compile Redis
    cd /tmp
    wget "http://download.redis.io/releases/redis-$REDIS_VERSION.tar.gz"
    tar xzf "redis-$REDIS_VERSION.tar.gz"
    cd "redis-$REDIS_VERSION"

    make
    make install PREFIX="$REDIS_DIR"

    # Create symlinks
    ln -sf "$REDIS_DIR/bin/redis-server" /usr/local/bin/
    ln -sf "$REDIS_DIR/bin/redis-cli" /usr/local/bin/
    ln -sf "$REDIS_DIR/bin/redis-sentinel" /usr/local/bin/

    log_info "Redis installed successfully"
}

generate_redis_config() {
    local port=$1
    local node_id=$2
    local config_file="$CONFIG_DIR/redis-$port.conf"

    log_info "Generating Redis config for port $port..."

    cat > "$config_file" << EOF
# Redis Cluster Node Configuration - Port $port
cluster-enabled yes
cluster-config-file nodes-$port.conf
cluster-node-timeout 15000
cluster-announce-ip $(hostname -I | awk '{print $1}')
cluster-announce-port $port
cluster-announce-bus-port $((port + 10000))

# Network
bind 0.0.0.0
protected-mode yes
port $port
tcp-backlog 511
timeout 0
tcp-keepalive 300

# Authentication
requirepass $REDIS_PASSWORD
masterauth $REDIS_PASSWORD

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Persistence
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump-$port.rdb
dir $DATA_DIR/$port

# AOF
appendonly yes
appendfilename "appendonly-$port.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes

# Logging
loglevel notice
logfile $LOG_DIR/redis-$port.log
syslog-enabled yes
syslog-ident redis-$port

# Performance
tcp-keepalive 60
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit slave 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# Slow log
slowlog-log-slower-than 10000
slowlog-max-len 128

# Latency monitoring
latency-monitor-threshold 100

# Security
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command DEBUG ""
rename-command CONFIG "CONFIG_$RANDOM"

# Cluster settings
cluster-require-full-coverage no
cluster-allow-reads-when-down no
EOF

    # Create data directory for this node
    mkdir -p "$DATA_DIR/$port"
    chown -R redis:redis "$DATA_DIR/$port"
    chmod 755 "$DATA_DIR/$port"
}

generate_sentinel_config() {
    local sentinel_port=$1
    local config_file="$CONFIG_DIR/sentinel-$sentinel_port.conf"

    log_info "Generating Sentinel config for port $sentinel_port..."

    cat > "$config_file" << EOF
# Redis Sentinel Configuration - Port $sentinel_port
port $sentinel_port
bind 0.0.0.0
dir $DATA_DIR/sentinel

# Authentication
requirepass $SENTINEL_PASSWORD

# Sentinel monitoring
sentinel monitor redis-master-1 $(hostname -I | awk '{print $1}') $BASE_PORT 2
sentinel monitor redis-master-2 $(hostname -I | awk '{print $1}') $((BASE_PORT + 1)) 2
sentinel monitor redis-master-3 $(hostname -I | awk '{print $1}') $((BASE_PORT + 2)) 2

sentinel auth-pass redis-master-1 $REDIS_PASSWORD
sentinel auth-pass redis-master-2 $REDIS_PASSWORD
sentinel auth-pass redis-master-3 $REDIS_PASSWORD

# Failover settings
sentinel down-after-milliseconds redis-master-1 30000
sentinel down-after-milliseconds redis-master-2 30000
sentinel down-after-milliseconds redis-master-3 30000

sentinel parallel-syncs redis-master-1 1
sentinel parallel-syncs redis-master-2 1
sentinel parallel-syncs redis-master-3 1

sentinel failover-timeout redis-master-1 180000
sentinel failover-timeout redis-master-2 180000
sentinel failover-timeout redis-master-3 180000

# Logging
logfile $LOG_DIR/sentinel-$sentinel_port.log
loglevel notice

# Configuration
sentinel deny-scripts-reconfig yes
sentinel resolve-hostnames yes
sentinel announce-hostnames yes

# Notification scripts
# sentinel notification-script redis-master-1 /opt/redis/scripts/notify.sh
# sentinel client-reconfig-script redis-master-1 /opt/redis/scripts/reconfig.sh
EOF

    # Create sentinel data directory
    mkdir -p "$DATA_DIR/sentinel"
    chown -R redis:redis "$DATA_DIR/sentinel"
}

create_systemd_services() {
    log_info "Creating systemd services..."

    # Redis cluster node services
    for ((i=0; i<CLUSTER_NODES; i++)); do
        local port=$((BASE_PORT + i))
        local service_file="$SYSTEMD_DIR/redis-$port.service"

        cat > "$service_file" << EOF
[Unit]
Description=Redis Cluster Node on port $port
After=network.target

[Service]
Type=notify
ExecStart=$REDIS_DIR/bin/redis-server $CONFIG_DIR/redis-$port.conf
ExecStop=/bin/kill -s QUIT \$MAINPID
TimeoutStopSec=0
Restart=always
User=redis
Group=redis
RuntimeDirectory=redis
RuntimeDirectoryMode=0755

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $LOG_DIR
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes

[Install]
WantedBy=multi-user.target
EOF
    done

    # Sentinel services
    for ((i=0; i<3; i++)); do
        local sentinel_port=$((SENTINEL_PORT + i))
        local service_file="$SYSTEMD_DIR/redis-sentinel-$sentinel_port.service"

        cat > "$service_file" << EOF
[Unit]
Description=Redis Sentinel on port $sentinel_port
After=network.target

[Service]
Type=notify
ExecStart=$REDIS_DIR/bin/redis-sentinel $CONFIG_DIR/sentinel-$sentinel_port.conf
ExecStop=/bin/kill -s QUIT \$MAINPID
TimeoutStopSec=0
Restart=always
User=redis
Group=redis
RuntimeDirectory=redis-sentinel
RuntimeDirectoryMode=0755

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $LOG_DIR
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF
    done

    # Reload systemd
    systemctl daemon-reload
}

setup_firewall() {
    log_info "Configuring firewall..."

    if command -v ufw &> /dev/null; then
        # Allow Redis cluster ports
        for ((i=0; i<CLUSTER_NODES; i++)); do
            local port=$((BASE_PORT + i))
            local bus_port=$((port + 10000))
            ufw allow "$port/tcp"
            ufw allow "$bus_port/tcp"
        done

        # Allow Sentinel ports
        for ((i=0; i<3; i++)); do
            local sentinel_port=$((SENTINEL_PORT + i))
            ufw allow "$sentinel_port/tcp"
        done

        log_info "UFW rules added for Redis cluster and Sentinel"
    elif command -v firewall-cmd &> /dev/null; then
        # CentOS/RHEL firewalld
        for ((i=0; i<CLUSTER_NODES; i++)); do
            local port=$((BASE_PORT + i))
            local bus_port=$((port + 10000))
            firewall-cmd --permanent --add-port="$port/tcp"
            firewall-cmd --permanent --add-port="$bus_port/tcp"
        done

        for ((i=0; i<3; i++)); do
            local sentinel_port=$((SENTINEL_PORT + i))
            firewall-cmd --permanent --add-port="$sentinel_port/tcp"
        done

        firewall-cmd --reload
        log_info "Firewalld rules added for Redis cluster and Sentinel"
    fi
}

optimize_system() {
    log_info "Optimizing system settings..."

    # Kernel parameters for Redis
    cat > /etc/sysctl.d/redis.conf << EOF
# Redis optimizations
vm.overcommit_memory = 1
net.core.somaxconn = 1024
net.core.netdev_max_backlog = 5000
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_max_syn_backlog = 8192
EOF

    sysctl -p /etc/sysctl.d/redis.conf

    # Disable transparent huge pages
    echo 'never' > /sys/kernel/mm/transparent_hugepage/enabled
    echo 'never' > /sys/kernel/mm/transparent_hugepage/defrag

    # Make it persistent
    cat > /etc/systemd/system/disable-thp.service << EOF
[Unit]
Description=Disable Transparent Huge Pages
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=redis.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled'
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/defrag'

[Install]
WantedBy=basic.target
EOF

    systemctl enable disable-thp.service

    log_info "System optimizations applied"
}

start_services() {
    log_info "Starting Redis cluster nodes..."

    # Start Redis nodes
    for ((i=0; i<CLUSTER_NODES; i++)); do
        local port=$((BASE_PORT + i))
        systemctl enable "redis-$port.service"
        systemctl start "redis-$port.service"

        # Wait for node to be ready
        sleep 2
        if systemctl is-active "redis-$port.service" &>/dev/null; then
            log_info "Redis node on port $port started successfully"
        else
            log_error "Failed to start Redis node on port $port"
            exit 1
        fi
    done

    # Create cluster
    log_info "Creating Redis cluster..."
    sleep 5

    local cluster_nodes=""
    for ((i=0; i<CLUSTER_NODES; i++)); do
        local port=$((BASE_PORT + i))
        cluster_nodes+="$(hostname -I | awk '{print $1}'):$port "
    done

    # Create cluster with masters and replicas
    echo "yes" | redis-cli --cluster create $cluster_nodes \
        --cluster-replicas 1 \
        -a "$REDIS_PASSWORD"

    if [[ $? -eq 0 ]]; then
        log_info "Redis cluster created successfully"
    else
        log_error "Failed to create Redis cluster"
        exit 1
    fi

    # Start Sentinel services
    log_info "Starting Redis Sentinel services..."
    for ((i=0; i<3; i++)); do
        local sentinel_port=$((SENTINEL_PORT + i))
        systemctl enable "redis-sentinel-$sentinel_port.service"
        systemctl start "redis-sentinel-$sentinel_port.service"

        if systemctl is-active "redis-sentinel-$sentinel_port.service" &>/dev/null; then
            log_info "Redis Sentinel on port $sentinel_port started successfully"
        else
            log_error "Failed to start Redis Sentinel on port $sentinel_port"
        fi
    done
}

create_monitoring_scripts() {
    log_info "Creating monitoring scripts..."

    # Health check script
    cat > /opt/redis/scripts/health-check.sh << 'EOF'
#!/bin/bash
# Redis Cluster Health Check Script

check_redis_node() {
    local port=$1
    local password=$2

    if redis-cli -p "$port" -a "$password" ping >/dev/null 2>&1; then
        echo "✓ Redis node on port $port is healthy"
        return 0
    else
        echo "✗ Redis node on port $port is not responding"
        return 1
    fi
}

check_cluster_status() {
    local port=$1
    local password=$2

    local cluster_info=$(redis-cli -p "$port" -a "$password" cluster info 2>/dev/null)
    if echo "$cluster_info" | grep -q "cluster_state:ok"; then
        echo "✓ Cluster state is OK"
        return 0
    else
        echo "✗ Cluster state is not OK"
        echo "$cluster_info"
        return 1
    fi
}

main() {
    echo "Redis Cluster Health Check - $(date)"
    echo "========================================"

    local failed=0

    # Check all Redis nodes
    for port in {7000..7005}; do
        check_redis_node "$port" "$REDIS_PASSWORD" || ((failed++))
    done

    # Check cluster status
    check_cluster_status 7000 "$REDIS_PASSWORD" || ((failed++))

    # Check Sentinel services
    for port in {26379..26381}; do
        if redis-cli -p "$port" -a "$SENTINEL_PASSWORD" ping >/dev/null 2>&1; then
            echo "✓ Sentinel on port $port is healthy"
        else
            echo "✗ Sentinel on port $port is not responding"
            ((failed++))
        fi
    done

    echo "========================================"
    if [[ $failed -eq 0 ]]; then
        echo "All checks passed ✓"
        exit 0
    else
        echo "$failed checks failed ✗"
        exit 1
    fi
}

main "$@"
EOF

    chmod +x /opt/redis/scripts/health-check.sh

    # Backup script
    cat > /opt/redis/scripts/backup.sh << 'EOF'
#!/bin/bash
# Redis Cluster Backup Script

BACKUP_DIR="/opt/redis/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

for port in {7000..7005}; do
    echo "Backing up Redis node on port $port..."
    redis-cli -p "$port" -a "$REDIS_PASSWORD" --rdb "$BACKUP_DIR/dump_${port}_${DATE}.rdb"
done

# Clean old backups (keep last 7 days)
find "$BACKUP_DIR" -name "*.rdb" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR"
EOF

    chmod +x /opt/redis/scripts/backup.sh

    # Add to crontab for automated backups
    (crontab -l 2>/dev/null; echo "0 2 * * * /opt/redis/scripts/backup.sh") | crontab -
}

create_env_file() {
    log_info "Creating environment configuration..."

    cat > /opt/redis/.env << EOF
# Redis Cluster Configuration
REDIS_PASSWORD=$REDIS_PASSWORD
SENTINEL_PASSWORD=$SENTINEL_PASSWORD
REDIS_NODES=6
BASE_PORT=$BASE_PORT
SENTINEL_PORT=$SENTINEL_PORT

# Connection strings for applications
REDIS_CLUSTER_NODES="$(hostname -I | awk '{print $1}'):7000,$(hostname -I | awk '{print $1}'):7001,$(hostname -I | awk '{print $1}'):7002,$(hostname -I | awk '{print $1}'):7003,$(hostname -I | awk '{print $1}'):7004,$(hostname -I | awk '{print $1}'):7005"
REDIS_SENTINEL_NODES="$(hostname -I | awk '{print $1}'):26379,$(hostname -I | awk '{print $1}'):26380,$(hostname -I | awk '{print $1}'):26381"
EOF

    chmod 600 /opt/redis/.env
    chown redis:redis /opt/redis/.env

    log_info "Environment file created at /opt/redis/.env"
}

print_summary() {
    log_info "Redis Cluster Setup Complete!"
    echo
    echo "========================================"
    echo "Cluster Information:"
    echo "========================================"
    echo "Redis Nodes: 6 (3 masters, 3 replicas)"
    echo "Base Port: $BASE_PORT"
    echo "Sentinel Nodes: 3"
    echo "Sentinel Port: $SENTINEL_PORT"
    echo
    echo "Connection Details:"
    echo "Redis Password: $REDIS_PASSWORD"
    echo "Sentinel Password: $SENTINEL_PASSWORD"
    echo
    echo "Service Management:"
    echo "systemctl status redis-{7000..7005}"
    echo "systemctl status redis-sentinel-{26379..26381}"
    echo
    echo "Health Check:"
    echo "/opt/redis/scripts/health-check.sh"
    echo
    echo "Configuration stored in: /opt/redis/.env"
    echo "========================================"
}

main() {
    log_info "Starting Redis Cluster Setup..."

    check_prerequisites
    install_redis
    optimize_system

    # Generate configurations
    for ((i=0; i<CLUSTER_NODES; i++)); do
        local port=$((BASE_PORT + i))
        generate_redis_config "$port" "$i"
    done

    for ((i=0; i<3; i++)); do
        local sentinel_port=$((SENTINEL_PORT + i))
        generate_sentinel_config "$sentinel_port"
    done

    create_systemd_services
    setup_firewall

    # Set permissions
    chown -R redis:redis "$CONFIG_DIR" "$LOG_DIR" "$DATA_DIR"
    chmod -R 755 "$CONFIG_DIR" "$LOG_DIR" "$DATA_DIR"

    start_services
    create_monitoring_scripts
    create_env_file

    print_summary
}

# Run main function
main "$@"