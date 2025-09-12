#!/bin/bash

# Production Deployment Script for Learning Platform
# This script handles zero-downtime deployment to production

set -e

# Configuration
DOCKER_REGISTRY="ghcr.io"
IMAGE_NAME="learning-platform"
SERVICE_NAME="learning-platform-production"
CLUSTER_NAME="learning-platform-production"
BACKUP_RETENTION_DAYS=7

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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
    
    # Check if required tools are installed
    command -v aws >/dev/null 2>&1 || { log_error "AWS CLI is required but not installed."; exit 1; }
    command -v docker >/dev/null 2>&1 || { log_error "Docker is required but not installed."; exit 1; }
    command -v jq >/dev/null 2>&1 || { log_error "jq is required but not installed."; exit 1; }
    
    # Check AWS credentials
    aws sts get-caller-identity >/dev/null || { log_error "AWS credentials not configured properly."; exit 1; }
    
    log_success "Prerequisites check passed"
}

# Create database backup before deployment
create_database_backup() {
    log_info "Creating database backup..."
    
    BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
    
    # Create RDS snapshot
    aws rds create-db-snapshot \
        --db-instance-identifier learning-platform-prod \
        --db-snapshot-identifier $BACKUP_NAME \
        >/dev/null
    
    log_success "Database backup created: $BACKUP_NAME"
    
    # Clean up old backups
    log_info "Cleaning up old backups..."
    OLD_SNAPSHOTS=$(aws rds describe-db-snapshots \
        --db-instance-identifier learning-platform-prod \
        --snapshot-type manual \
        --query "DBSnapshots[?SnapshotCreateTime<='$(date -d "$BACKUP_RETENTION_DAYS days ago" -Iseconds)'].DBSnapshotIdentifier" \
        --output text)
    
    if [ ! -z "$OLD_SNAPSHOTS" ]; then
        for snapshot in $OLD_SNAPSHOTS; do
            log_info "Deleting old backup: $snapshot"
            aws rds delete-db-snapshot --db-snapshot-identifier $snapshot >/dev/null
        done
    fi
}

# Build and push Docker image
build_and_push_image() {
    local git_sha=$1
    log_info "Building Docker image for commit: $git_sha"
    
    # Login to ECR
    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $DOCKER_REGISTRY
    
    # Build image
    docker build -t $DOCKER_REGISTRY/$IMAGE_NAME:$git_sha .
    docker build -t $DOCKER_REGISTRY/$IMAGE_NAME:latest .
    
    # Push image
    log_info "Pushing Docker image..."
    docker push $DOCKER_REGISTRY/$IMAGE_NAME:$git_sha
    docker push $DOCKER_REGISTRY/$IMAGE_NAME:latest
    
    log_success "Docker image pushed successfully"
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Create migration task definition if it doesn't exist
    MIGRATION_TASK_DEF=$(cat <<EOF
{
  "family": "learning-platform-migration",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "migration",
      "image": "$DOCKER_REGISTRY/$IMAGE_NAME:latest",
      "command": ["npx", "prisma", "migrate", "deploy"],
      "environment": [
        {
          "name": "DATABASE_URL",
          "value": "$DATABASE_URL"
        },
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/learning-platform-migration",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
)
    
    # Register migration task definition
    aws ecs register-task-definition --cli-input-json "$MIGRATION_TASK_DEF" >/dev/null
    
    # Run migration task
    MIGRATION_TASK_ARN=$(aws ecs run-task \
        --cluster $CLUSTER_NAME \
        --task-definition learning-platform-migration \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUP_ID],assignPublicIp=ENABLED}" \
        --query 'tasks[0].taskArn' \
        --output text)
    
    # Wait for migration to complete
    log_info "Waiting for migration to complete..."
    aws ecs wait tasks-stopped --cluster $CLUSTER_NAME --tasks $MIGRATION_TASK_ARN
    
    # Check migration status
    MIGRATION_EXIT_CODE=$(aws ecs describe-tasks \
        --cluster $CLUSTER_NAME \
        --tasks $MIGRATION_TASK_ARN \
        --query 'tasks[0].containers[0].exitCode' \
        --output text)
    
    if [ "$MIGRATION_EXIT_CODE" != "0" ]; then
        log_error "Database migration failed with exit code: $MIGRATION_EXIT_CODE"
        exit 1
    fi
    
    log_success "Database migration completed successfully"
}

# Deploy application with blue-green strategy
deploy_application() {
    local git_sha=$1
    log_info "Deploying application with blue-green strategy..."
    
    # Get current task definition
    CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition $SERVICE_NAME \
        --query 'taskDefinition')
    
    # Create new task definition with updated image
    NEW_TASK_DEF=$(echo $CURRENT_TASK_DEF | jq --arg IMAGE "$DOCKER_REGISTRY/$IMAGE_NAME:$git_sha" \
        '.containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)')
    
    # Register new task definition
    NEW_TASK_DEF_ARN=$(aws ecs register-task-definition --cli-input-json "$NEW_TASK_DEF" \
        --query 'taskDefinition.taskDefinitionArn' --output text)
    
    log_info "New task definition registered: $NEW_TASK_DEF_ARN"
    
    # Update service
    log_info "Updating ECS service..."
    aws ecs update-service \
        --cluster $CLUSTER_NAME \
        --service $SERVICE_NAME \
        --task-definition $NEW_TASK_DEF_ARN >/dev/null
    
    # Wait for deployment to complete
    log_info "Waiting for deployment to stabilize..."
    aws ecs wait services-stable \
        --cluster $CLUSTER_NAME \
        --services $SERVICE_NAME
    
    log_success "Application deployment completed"
}

# Perform health checks
perform_health_checks() {
    log_info "Performing health checks..."
    
    # Get service endpoint
    LOAD_BALANCER_DNS=$(aws elbv2 describe-load-balancers \
        --names learning-platform-prod \
        --query 'LoadBalancers[0].DNSName' \
        --output text)
    
    # Health check with retry logic
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f -s "https://$LOAD_BALANCER_DNS/api/health" >/dev/null; then
            log_success "Health check passed"
            return 0
        fi
        
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_info "Health check failed, retrying... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 10
    done
    
    log_error "Health checks failed after $MAX_RETRIES attempts"
    return 1
}

# Rollback deployment
rollback_deployment() {
    log_warning "Rolling back deployment..."
    
    # Get previous task definition
    PREVIOUS_TASK_DEF=$(aws ecs describe-services \
        --cluster $CLUSTER_NAME \
        --services $SERVICE_NAME \
        --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition' \
        --output text)
    
    if [ -z "$PREVIOUS_TASK_DEF" ]; then
        log_error "No previous task definition found for rollback"
        exit 1
    fi
    
    # Rollback to previous version
    aws ecs update-service \
        --cluster $CLUSTER_NAME \
        --service $SERVICE_NAME \
        --task-definition $PREVIOUS_TASK_DEF >/dev/null
    
    # Wait for rollback to complete
    aws ecs wait services-stable \
        --cluster $CLUSTER_NAME \
        --services $SERVICE_NAME
    
    log_success "Rollback completed"
}

# Send notification
send_notification() {
    local status=$1
    local message=$2
    
    if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚀 Learning Platform Deployment $status: $message\"}" \
            $SLACK_WEBHOOK_URL
    fi
    
    if [ ! -z "$SNS_TOPIC_ARN" ]; then
        aws sns publish \
            --topic-arn $SNS_TOPIC_ARN \
            --message "Learning Platform Deployment $status: $message"
    fi
}

# Main deployment function
main() {
    local git_sha=${1:-$(git rev-parse HEAD)}
    
    log_info "Starting deployment for commit: $git_sha"
    
    # Trap to handle rollback on failure
    trap 'rollback_deployment; send_notification "FAILED" "Deployment failed and was rolled back"; exit 1' ERR
    
    check_prerequisites
    create_database_backup
    build_and_push_image $git_sha
    run_migrations
    deploy_application $git_sha
    
    if ! perform_health_checks; then
        log_error "Health checks failed, initiating rollback"
        rollback_deployment
        send_notification "FAILED" "Health checks failed, deployment rolled back"
        exit 1
    fi
    
    log_success "Deployment completed successfully!"
    send_notification "SUCCESS" "Deployment completed successfully for commit: $git_sha"
}

# Script usage
usage() {
    echo "Usage: $0 [git-sha]"
    echo "  git-sha: Git commit SHA to deploy (defaults to current HEAD)"
    exit 1
}

# Handle script arguments
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
fi

# Run main function
main "$@"