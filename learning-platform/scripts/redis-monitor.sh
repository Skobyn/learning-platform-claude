#!/bin/bash

# Redis Cluster Monitoring Script for Learning Platform
# Monitors cluster health, performance metrics, and alerts on issues

set -euo pipefail

# Configuration
REDIS_HOSTS=(
    "redis-master-1:7001"
    "redis-master-2:7002"
    "redis-master-3:7003"
    "redis-replica-1:7004"
    "redis-replica-2:7005"
    "redis-replica-3:7006"
)

LOG_FILE="/var/log/redis-monitor.log"
METRICS_FILE="/var/log/redis-metrics.json"
CHECK_INTERVAL=30
ALERT_THRESHOLD_MEMORY=80
ALERT_THRESHOLD_CONNECTIONS=8000
ALERT_THRESHOLD_CPU=80

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Error logging function
log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: $1" | tee -a "$LOG_FILE" >&2
}

# Check if Redis CLI is available
check_redis_cli() {
    if ! command -v redis-cli &> /dev/null; then
        log_error "redis-cli not found. Please install Redis CLI."
        exit 1
    fi
}

# Test connection to a Redis node
test_connection() {
    local host=$1
    local port=$2

    if timeout 5 redis-cli -h "$host" -p "$port" ping > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Get Redis info for a node
get_redis_info() {
    local host=$1
    local port=$2

    redis-cli -h "$host" -p "$port" info 2>/dev/null || echo ""
}

# Get cluster info
get_cluster_info() {
    local host=$1
    local port=$2

    redis-cli -h "$host" -p "$port" cluster info 2>/dev/null || echo ""
}

# Get cluster nodes
get_cluster_nodes() {
    local host=$1
    local port=$2

    redis-cli -h "$host" -p "$port" cluster nodes 2>/dev/null || echo ""
}

# Parse Redis info and extract metrics
parse_redis_info() {
    local info=$1
    local node=$2

    # Extract key metrics
    local memory_used=$(echo "$info" | grep "^used_memory:" | cut -d: -f2 | tr -d '\r\n')
    local memory_peak=$(echo "$info" | grep "^used_memory_peak:" | cut -d: -f2 | tr -d '\r\n')
    local memory_total=$(echo "$info" | grep "^total_system_memory:" | cut -d: -f2 | tr -d '\r\n')
    local connected_clients=$(echo "$info" | grep "^connected_clients:" | cut -d: -f2 | tr -d '\r\n')
    local ops_per_sec=$(echo "$info" | grep "^instantaneous_ops_per_sec:" | cut -d: -f2 | tr -d '\r\n')
    local keyspace_hits=$(echo "$info" | grep "^keyspace_hits:" | cut -d: -f2 | tr -d '\r\n')
    local keyspace_misses=$(echo "$info" | grep "^keyspace_misses:" | cut -d: -f2 | tr -d '\r\n')
    local uptime=$(echo "$info" | grep "^uptime_in_seconds:" | cut -d: -f2 | tr -d '\r\n')
    local role=$(echo "$info" | grep "^role:" | cut -d: -f2 | tr -d '\r\n')

    # Calculate memory percentage
    local memory_pct=0
    if [[ -n "$memory_total" && "$memory_total" -gt 0 ]]; then
        memory_pct=$((memory_used * 100 / memory_total))
    fi

    # Calculate hit ratio
    local hit_ratio=0
    if [[ -n "$keyspace_hits" && -n "$keyspace_misses" ]]; then
        local total_requests=$((keyspace_hits + keyspace_misses))
        if [[ $total_requests -gt 0 ]]; then
            hit_ratio=$((keyspace_hits * 100 / total_requests))
        fi
    fi

    # Create metrics JSON
    cat << EOF
{
    "node": "$node",
    "role": "$role",
    "memory_used": ${memory_used:-0},
    "memory_peak": ${memory_peak:-0},
    "memory_total": ${memory_total:-0},
    "memory_percentage": $memory_pct,
    "connected_clients": ${connected_clients:-0},
    "ops_per_sec": ${ops_per_sec:-0},
    "keyspace_hits": ${keyspace_hits:-0},
    "keyspace_misses": ${keyspace_misses:-0},
    "hit_ratio": $hit_ratio,
    "uptime_seconds": ${uptime:-0},
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

# Check cluster health
check_cluster_health() {
    log "Checking Redis cluster health..."

    local healthy_nodes=0
    local total_nodes=${#REDIS_HOSTS[@]}
    local cluster_state="unknown"

    for host_port in "${REDIS_HOSTS[@]}"; do
        IFS=':' read -r host port <<< "$host_port"

        if test_connection "$host" "$port"; then
            echo -e "${GREEN}✓${NC} $host:$port - Connected"
            ((healthy_nodes++))

            # Get cluster info from first responsive node
            if [[ "$cluster_state" == "unknown" ]]; then
                local cluster_info=$(get_cluster_info "$host" "$port")
                cluster_state=$(echo "$cluster_info" | grep "^cluster_state:" | cut -d: -f2 | tr -d '\r\n')
            fi
        else
            echo -e "${RED}✗${NC} $host:$port - Connection failed"
            log_error "Connection failed to Redis node $host:$port"
        fi
    done

    echo ""
    echo "Cluster Summary:"
    echo "  Healthy nodes: $healthy_nodes/$total_nodes"
    echo "  Cluster state: ${cluster_state:-unknown}"

    if [[ $healthy_nodes -eq $total_nodes ]]; then
        echo -e "  Status: ${GREEN}Healthy${NC}"
        return 0
    elif [[ $healthy_nodes -gt $((total_nodes / 2)) ]]; then
        echo -e "  Status: ${YELLOW}Degraded${NC}"
        return 1
    else
        echo -e "  Status: ${RED}Critical${NC}"
        return 2
    fi
}

# Monitor performance metrics
monitor_performance() {
    log "Collecting performance metrics..."

    local metrics_array=()
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    for host_port in "${REDIS_HOSTS[@]}"; do
        IFS=':' read -r host port <<< "$host_port"

        if test_connection "$host" "$port"; then
            local info=$(get_redis_info "$host" "$port")
            if [[ -n "$info" ]]; then
                local metrics=$(parse_redis_info "$info" "$host:$port")
                metrics_array+=("$metrics")

                # Check for alerts
                local memory_pct=$(echo "$metrics" | jq -r '.memory_percentage')
                local connected_clients=$(echo "$metrics" | jq -r '.connected_clients')
                local hit_ratio=$(echo "$metrics" | jq -r '.hit_ratio')

                # Memory usage alert
                if [[ "$memory_pct" -gt $ALERT_THRESHOLD_MEMORY ]]; then
                    log_error "High memory usage on $host:$port: ${memory_pct}%"
                fi

                # Connection count alert
                if [[ "$connected_clients" -gt $ALERT_THRESHOLD_CONNECTIONS ]]; then
                    log_error "High connection count on $host:$port: $connected_clients"
                fi

                # Low hit ratio alert
                if [[ "$hit_ratio" -lt 85 && "$hit_ratio" -gt 0 ]]; then
                    log "Low cache hit ratio on $host:$port: ${hit_ratio}%"
                fi
            fi
        fi
    done

    # Save metrics to file
    if [[ ${#metrics_array[@]} -gt 0 ]]; then
        echo "{" > "$METRICS_FILE"
        echo "  \"timestamp\": \"$timestamp\"," >> "$METRICS_FILE"
        echo "  \"nodes\": [" >> "$METRICS_FILE"

        for i in "${!metrics_array[@]}"; do
            echo "    ${metrics_array[$i]}" >> "$METRICS_FILE"
            if [[ $i -lt $((${#metrics_array[@]} - 1)) ]]; then
                echo "," >> "$METRICS_FILE"
            fi
        done

        echo "  ]" >> "$METRICS_FILE"
        echo "}" >> "$METRICS_FILE"
    fi
}

# Display cluster topology
show_cluster_topology() {
    log "Displaying cluster topology..."

    for host_port in "${REDIS_HOSTS[@]}"; do
        IFS=':' read -r host port <<< "$host_port"

        if test_connection "$host" "$port"; then
            echo ""
            echo -e "${BLUE}Node: $host:$port${NC}"

            local nodes_info=$(get_cluster_nodes "$host" "$port")
            if [[ -n "$nodes_info" ]]; then
                echo "$nodes_info" | while IFS= read -r line; do
                    local node_id=$(echo "$line" | cut -d' ' -f1)
                    local node_addr=$(echo "$line" | cut -d' ' -f2)
                    local node_flags=$(echo "$line" | cut -d' ' -f3)
                    local node_slots=$(echo "$line" | cut -d' ' -f9-)

                    if [[ "$node_flags" == *"master"* ]]; then
                        echo -e "  ${GREEN}Master${NC}: $node_addr (slots: $node_slots)"
                    elif [[ "$node_flags" == *"slave"* ]]; then
                        echo -e "  ${YELLOW}Replica${NC}: $node_addr"
                    fi
                done
            fi
            break
        fi
    done
}

# Cleanup old log files
cleanup_logs() {
    # Keep only last 7 days of logs
    find /var/log -name "redis-*.log" -mtime +7 -delete 2>/dev/null || true
}

# Main monitoring loop
main() {
    check_redis_cli

    log "Starting Redis cluster monitoring..."

    # Create log directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    mkdir -p "$(dirname "$METRICS_FILE")"

    while true; do
        echo ""
        echo "========================================"
        echo "Redis Cluster Monitor - $(date)"
        echo "========================================"

        # Check cluster health
        if ! check_cluster_health; then
            log_error "Cluster health check failed"
        fi

        echo ""

        # Monitor performance
        monitor_performance

        # Show topology every 10 minutes (20 cycles of 30s)
        if [[ $(($(date +%s) % 600)) -lt $CHECK_INTERVAL ]]; then
            show_cluster_topology
        fi

        # Cleanup old logs every hour
        if [[ $(($(date +%s) % 3600)) -lt $CHECK_INTERVAL ]]; then
            cleanup_logs
        fi

        echo ""
        echo "Next check in $CHECK_INTERVAL seconds..."
        sleep $CHECK_INTERVAL
    done
}

# Signal handlers
cleanup() {
    log "Redis monitor stopped"
    exit 0
}

trap cleanup SIGTERM SIGINT

# Run main function
main