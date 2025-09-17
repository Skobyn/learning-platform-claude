#!/bin/bash

# Google Cloud SQL Deployment and Configuration Script
# Deploys enterprise-grade Cloud SQL instance with optimizations

set -euo pipefail

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-rds-lms}"
INSTANCE_NAME="${DB_INSTANCE_NAME:-learning-platform-prod}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
NETWORK="${NETWORK:-learning-platform-vpc}"
CONFIG_FILE="${CONFIG_FILE:-/home/sbenson/learning-platform/config/database/cloudsql-config.yaml}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v gcloud &> /dev/null; then
        error "gcloud CLI not found. Please install Google Cloud CLI."
        exit 1
    fi

    if ! command -v yq &> /dev/null; then
        warn "yq not found. Installing..."
        sudo snap install yq || (
            wget -qO- https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64.tar.gz | tar xvz &&
            sudo mv yq_linux_amd64 /usr/local/bin/yq
        )
    fi

    # Check authentication
    if ! gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q .; then
        error "Not authenticated with Google Cloud. Run 'gcloud auth login'"
        exit 1
    fi

    # Set project
    gcloud config set project "$PROJECT_ID"

    log "Prerequisites check completed"
}

# Enable required APIs
enable_apis() {
    log "Enabling required Google Cloud APIs..."

    local apis=(
        "sqladmin.googleapis.com"
        "compute.googleapis.com"
        "servicenetworking.googleapis.com"
        "cloudresourcemanager.googleapis.com"
        "monitoring.googleapis.com"
        "logging.googleapis.com"
        "cloudkms.googleapis.com"
    )

    for api in "${apis[@]}"; do
        log "Enabling $api..."
        gcloud services enable "$api" --project="$PROJECT_ID"
    done

    log "APIs enabled successfully"
}

# Create VPC network if not exists
setup_network() {
    log "Setting up VPC network..."

    # Check if network exists
    if ! gcloud compute networks describe "$NETWORK" --project="$PROJECT_ID" &>/dev/null; then
        log "Creating VPC network: $NETWORK"
        gcloud compute networks create "$NETWORK" \
            --subnet-mode=regional \
            --bgp-routing-mode=regional \
            --project="$PROJECT_ID"
    else
        info "VPC network $NETWORK already exists"
    fi

    # Create subnet if not exists
    local subnet_name="${NETWORK}-subnet"
    if ! gcloud compute networks subnets describe "$subnet_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log "Creating subnet: $subnet_name"
        gcloud compute networks subnets create "$subnet_name" \
            --network="$NETWORK" \
            --range="10.0.0.0/16" \
            --region="$REGION" \
            --project="$PROJECT_ID"
    else
        info "Subnet $subnet_name already exists"
    fi

    # Allocate IP range for private services
    local peering_range="google-managed-services-${NETWORK}"
    if ! gcloud compute addresses describe "$peering_range" --global --project="$PROJECT_ID" &>/dev/null; then
        log "Allocating IP range for private services"
        gcloud compute addresses create "$peering_range" \
            --global \
            --purpose=VPC_PEERING \
            --prefix-length=16 \
            --network="projects/$PROJECT_ID/global/networks/$NETWORK" \
            --project="$PROJECT_ID"
    else
        info "IP range $peering_range already allocated"
    fi

    # Create private connection
    if ! gcloud services vpc-peerings list --network="$NETWORK" --project="$PROJECT_ID" | grep -q "ACTIVE"; then
        log "Creating private service connection"
        gcloud services vpc-peerings connect \
            --service=servicenetworking.googleapis.com \
            --ranges="$peering_range" \
            --network="$NETWORK" \
            --project="$PROJECT_ID"
    else
        info "Private service connection already exists"
    fi

    log "Network setup completed"
}

# Create KMS key for encryption
setup_encryption() {
    log "Setting up encryption..."

    local keyring_name="database-keys"
    local key_name="database-key"
    local location="us-central1"

    # Create keyring if not exists
    if ! gcloud kms keyrings describe "$keyring_name" --location="$location" --project="$PROJECT_ID" &>/dev/null; then
        log "Creating KMS keyring: $keyring_name"
        gcloud kms keyrings create "$keyring_name" \
            --location="$location" \
            --project="$PROJECT_ID"
    else
        info "KMS keyring $keyring_name already exists"
    fi

    # Create key if not exists
    if ! gcloud kms keys describe "$key_name" --keyring="$keyring_name" --location="$location" --project="$PROJECT_ID" &>/dev/null; then
        log "Creating KMS key: $key_name"
        gcloud kms keys create "$key_name" \
            --keyring="$keyring_name" \
            --location="$location" \
            --purpose="encryption" \
            --project="$PROJECT_ID"
    else
        info "KMS key $key_name already exists"
    fi

    # Grant Cloud SQL service account access to key
    local sql_service_account=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" --filter="bindings.role:roles/cloudsql.serviceAgent" --format="value(bindings.members)" | head -1)

    if [[ -n "$sql_service_account" ]]; then
        log "Granting KMS access to Cloud SQL service account"
        gcloud kms keys add-iam-policy-binding "$key_name" \
            --keyring="$keyring_name" \
            --location="$location" \
            --member="$sql_service_account" \
            --role="roles/cloudkms.cryptoKeyEncrypterDecrypter" \
            --project="$PROJECT_ID"
    fi

    log "Encryption setup completed"
}

# Create Cloud SQL instance
create_instance() {
    log "Creating Cloud SQL instance: $INSTANCE_NAME"

    # Check if instance already exists
    if gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" &>/dev/null; then
        warn "Instance $INSTANCE_NAME already exists. Skipping creation."
        return 0
    fi

    # Read configuration from YAML
    local tier=$(yq eval '.instance.tier' "$CONFIG_FILE")
    local storage_size=$(yq eval '.instance.storage_size' "$CONFIG_FILE")
    local storage_type=$(yq eval '.instance.storage_type' "$CONFIG_FILE")
    local availability_type=$(yq eval '.instance.availability_type' "$CONFIG_FILE")
    local backup_start_time=$(yq eval '.instance.backup_start_time' "$CONFIG_FILE")

    # Create the instance
    log "Creating instance with tier $tier, storage $storage_size GB..."

    gcloud sql instances create "$INSTANCE_NAME" \
        --database-version=POSTGRES_13 \
        --tier="$tier" \
        --region="$REGION" \
        --storage-type="$storage_type" \
        --storage-size="$storage_size" \
        --storage-auto-increase \
        --storage-auto-increase-limit=10000 \
        --availability-type="$availability_type" \
        --backup-start-time="$backup_start_time" \
        --enable-bin-log \
        --maintenance-window-day=SUNDAY \
        --maintenance-window-hour=4 \
        --maintenance-release-channel=production \
        --deletion-protection \
        --network="projects/$PROJECT_ID/global/networks/$NETWORK" \
        --no-assign-ip \
        --project="$PROJECT_ID"

    log "Instance creation initiated. Waiting for completion..."

    # Wait for instance to be ready
    local timeout=1800  # 30 minutes
    local elapsed=0
    local interval=30

    while [[ $elapsed -lt $timeout ]]; do
        local status=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format="value(state)")

        if [[ "$status" == "RUNNABLE" ]]; then
            log "Instance is ready!"
            break
        fi

        info "Instance status: $status. Waiting..."
        sleep $interval
        elapsed=$((elapsed + interval))
    done

    if [[ $elapsed -ge $timeout ]]; then
        error "Timeout waiting for instance to become ready"
        exit 1
    fi
}

# Configure database flags
configure_flags() {
    log "Configuring database flags..."

    # Read flags from YAML configuration
    local flags_yaml=$(yq eval '.database_flags | to_entries | .[] | .key + "=" + .value' "$CONFIG_FILE")
    local flags_array=()

    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            flags_array+=("--database-flags=$line")
        fi
    done <<< "$flags_yaml"

    if [[ ${#flags_array[@]} -gt 0 ]]; then
        log "Applying ${#flags_array[@]} database flags..."

        gcloud sql instances patch "$INSTANCE_NAME" \
            "${flags_array[@]}" \
            --project="$PROJECT_ID"

        log "Database flags applied successfully"
    else
        warn "No database flags found in configuration"
    fi
}

# Create database and users
setup_database() {
    log "Setting up database and users..."

    # Create main database
    local database_name="learning_platform"
    if ! gcloud sql databases describe "$database_name" --instance="$INSTANCE_NAME" --project="$PROJECT_ID" &>/dev/null; then
        log "Creating database: $database_name"
        gcloud sql databases create "$database_name" \
            --instance="$INSTANCE_NAME" \
            --project="$PROJECT_ID"
    else
        info "Database $database_name already exists"
    fi

    # Create users
    local users_config=$(yq eval '.users[]' "$CONFIG_FILE" -o=json)

    echo "$users_config" | while IFS= read -r user_json; do
        local username=$(echo "$user_json" | jq -r '.name')
        local password_var=$(echo "$user_json" | jq -r '.password' | sed 's/\${//' | sed 's/}//')
        local password="${!password_var:-}"

        if [[ -z "$password" ]]; then
            warn "Password not set for user $username (expected in $password_var). Skipping."
            continue
        fi

        if ! gcloud sql users describe "$username" --instance="$INSTANCE_NAME" --project="$PROJECT_ID" &>/dev/null; then
            log "Creating user: $username"
            gcloud sql users create "$username" \
                --instance="$INSTANCE_NAME" \
                --password="$password" \
                --project="$PROJECT_ID"
        else
            info "User $username already exists"
        fi
    done
}

# Create read replicas
create_replicas() {
    log "Creating read replicas..."

    local replicas_config=$(yq eval '.replicas[]' "$CONFIG_FILE" -o=json)

    echo "$replicas_config" | while IFS= read -r replica_json; do
        local replica_name=$(echo "$replica_json" | jq -r '.name')
        local replica_region=$(echo "$replica_json" | jq -r '.region')
        local replica_tier=$(echo "$replica_json" | jq -r '.tier')

        if gcloud sql instances describe "$replica_name" --project="$PROJECT_ID" &>/dev/null; then
            info "Replica $replica_name already exists"
            continue
        fi

        log "Creating read replica: $replica_name in $replica_region"

        gcloud sql instances create "$replica_name" \
            --master-instance-name="$INSTANCE_NAME" \
            --tier="$replica_tier" \
            --region="$replica_region" \
            --replica-type=READ \
            --storage-auto-increase \
            --deletion-protection \
            --project="$PROJECT_ID"

        log "Replica $replica_name creation initiated"
    done
}

# Setup monitoring and alerting
setup_monitoring() {
    log "Setting up monitoring and alerting..."

    # Enable Query Insights
    log "Enabling Query Insights..."
    gcloud sql instances patch "$INSTANCE_NAME" \
        --insights-config-query-insights-enabled \
        --insights-config-record-application-tags \
        --insights-config-record-client-address \
        --insights-config-query-sample-rate=1.0 \
        --insights-config-query-plans-per-minute=20 \
        --project="$PROJECT_ID"

    # Create notification channels (if webhook/email provided)
    local notification_email="${NOTIFICATION_EMAIL:-}"
    local slack_webhook="${SLACK_WEBHOOK:-}"

    if [[ -n "$notification_email" ]]; then
        log "Creating email notification channel..."
        # Implementation would depend on specific requirements
        # This is a placeholder for actual notification channel creation
    fi

    log "Monitoring setup completed"
}

# Apply schema migrations
apply_migrations() {
    log "Applying database schema migrations..."

    local migration_file="/home/sbenson/learning-platform/prisma/migrations/enterprise_optimization.sql"
    local partition_file="/home/sbenson/learning-platform/scripts/db-partition.sql"

    # Get connection information
    local connection_name=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format="value(connectionName)")
    local private_ip=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format="value(ipAddresses[0].ipAddress)")

    info "Instance connection name: $connection_name"
    info "Private IP: $private_ip"

    # Apply optimizations if Cloud SQL proxy is available
    if command -v cloud_sql_proxy &> /dev/null; then
        log "Applying database optimizations via Cloud SQL proxy..."

        # Start proxy in background
        cloud_sql_proxy -instances="$connection_name"=tcp:5432 &
        local proxy_pid=$!

        # Wait for proxy to be ready
        sleep 10

        # Apply migrations (would need proper credentials setup)
        # PGPASSWORD="$APP_USER_PASSWORD" psql -h localhost -p 5432 -U app-user -d learning_platform -f "$migration_file"
        # PGPASSWORD="$APP_USER_PASSWORD" psql -h localhost -p 5432 -U app-user -d learning_platform -f "$partition_file"

        # Clean up proxy
        kill $proxy_pid

        info "Migrations would be applied here with proper credentials"
    else
        info "Cloud SQL proxy not available. Apply migrations manually using:"
        echo "  1. Connect to the instance using Cloud SQL proxy or authorized network"
        echo "  2. Run: psql -h <IP> -U <user> -d learning_platform -f $migration_file"
        echo "  3. Run: psql -h <IP> -U <user> -d learning_platform -f $partition_file"
    fi
}

# Generate connection information
generate_connection_info() {
    log "Generating connection information..."

    local connection_name=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format="value(connectionName)")
    local private_ip=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format="value(ipAddresses[0].ipAddress)")

    cat > "/tmp/cloudsql-connection-info.txt" << EOF
Cloud SQL Instance Connection Information
==========================================

Instance Name: $INSTANCE_NAME
Project ID: $PROJECT_ID
Connection Name: $connection_name
Private IP: $private_ip

Connection Strings:
------------------
# For applications using Cloud SQL connector
DATABASE_URL="postgresql://app-user:\${APP_USER_PASSWORD}@/$connection_name/learning_platform?host=/cloudsql"

# For applications using private IP
DATABASE_URL="postgresql://app-user:\${APP_USER_PASSWORD}@$private_ip:5432/learning_platform?sslmode=require"

# Read replica connections (update IPs as needed)
DATABASE_REPLICA_1_URL="postgresql://app-user:\${APP_USER_PASSWORD}@<REPLICA_1_IP>:5432/learning_platform?sslmode=require"
DATABASE_REPLICA_2_URL="postgresql://app-user:\${APP_USER_PASSWORD}@<REPLICA_2_IP>:5432/learning_platform?sslmode=require"

Environment Variables to Set:
-----------------------------
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
export DB_INSTANCE_NAME="$INSTANCE_NAME"
export DB_NAME="learning_platform"
export DATABASE_URL="postgresql://app-user:\${APP_USER_PASSWORD}@$private_ip:5432/learning_platform?sslmode=require"

# Set these passwords securely
export APP_USER_PASSWORD="<secure-password>"
export ANALYTICS_USER_PASSWORD="<secure-password>"
export BACKUP_USER_PASSWORD="<secure-password>"

Next Steps:
-----------
1. Set user passwords securely using Google Secret Manager or similar
2. Configure application connection pooling
3. Apply database schema migrations
4. Setup monitoring dashboards
5. Configure backup verification

Files to Apply:
---------------
1. Schema migrations: /home/sbenson/learning-platform/prisma/migrations/enterprise_optimization.sql
2. Partitioning: /home/sbenson/learning-platform/scripts/db-partition.sql
3. Connection config: /home/sbenson/learning-platform/src/lib/db-optimized.ts
EOF

    log "Connection information saved to /tmp/cloudsql-connection-info.txt"
    cat "/tmp/cloudsql-connection-info.txt"
}

# Main deployment function
deploy_cloudsql() {
    log "Starting Cloud SQL deployment..."

    local start_time=$(date +%s)

    check_prerequisites
    enable_apis
    setup_network
    setup_encryption
    create_instance
    configure_flags
    setup_database
    create_replicas
    setup_monitoring
    apply_migrations
    generate_connection_info

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log "Cloud SQL deployment completed successfully in ${duration}s"
    log "Instance: $INSTANCE_NAME"
    log "Project: $PROJECT_ID"
    log "Region: $REGION"

    info "Please review /tmp/cloudsql-connection-info.txt for connection details"
}

# Cleanup function
cleanup_resources() {
    warn "This will DELETE the Cloud SQL instance and all data. Are you sure? (y/N)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        log "Deleting Cloud SQL resources..."

        # Delete replicas first
        local replicas=$(gcloud sql instances list --filter="masterInstanceName:$INSTANCE_NAME" --format="value(name)" --project="$PROJECT_ID")
        for replica in $replicas; do
            log "Deleting replica: $replica"
            gcloud sql instances delete "$replica" --project="$PROJECT_ID" --quiet
        done

        # Delete main instance
        log "Deleting main instance: $INSTANCE_NAME"
        gcloud sql instances delete "$INSTANCE_NAME" --project="$PROJECT_ID" --quiet

        log "Cleanup completed"
    else
        log "Cleanup cancelled"
    fi
}

# Command line interface
case "${1:-deploy}" in
    "deploy")
        deploy_cloudsql
        ;;
    "cleanup")
        cleanup_resources
        ;;
    "info")
        generate_connection_info
        ;;
    *)
        echo "Usage: $0 {deploy|cleanup|info}"
        echo ""
        echo "Commands:"
        echo "  deploy  - Deploy Cloud SQL instance with full configuration"
        echo "  cleanup - Delete Cloud SQL resources (destructive!)"
        echo "  info    - Generate connection information"
        exit 1
        ;;
esac