#!/bin/bash

# GCP Deployment Script for Learning Platform
# This script deploys the Learning Platform to Google Cloud Platform

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${PROJECT_ID:-"learning-platform-prod"}
REGION=${REGION:-"us-central1"}
SERVICE_NAME="learning-platform"
REPOSITORY_NAME="learning-platform-repo"

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    print_status "Checking requirements..."

    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install it first."
        exit 1
    fi

    print_success "All requirements satisfied"
}

# Set up GCP project and authentication
setup_gcp() {
    print_status "Setting up GCP project..."

    # Set project
    gcloud config set project $PROJECT_ID

    # Enable required APIs
    print_status "Enabling required GCP APIs..."
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable run.googleapis.com
    gcloud services enable sql-component.googleapis.com
    gcloud services enable redis.googleapis.com
    gcloud services enable storage-component.googleapis.com
    gcloud services enable cloudresourcemanager.googleapis.com
    gcloud services enable artifactregistry.googleapis.com
    gcloud services enable compute.googleapis.com
    gcloud services enable monitoring.googleapis.com
    gcloud services enable logging.googleapis.com

    print_success "GCP setup completed"
}

# Create Artifact Registry repository
create_artifact_registry() {
    print_status "Creating Artifact Registry repository..."

    # Check if repository exists
    if gcloud artifacts repositories describe $REPOSITORY_NAME --location=$REGION --format="value(name)" 2>/dev/null; then
        print_warning "Repository $REPOSITORY_NAME already exists"
    else
        gcloud artifacts repositories create $REPOSITORY_NAME \
            --repository-format=docker \
            --location=$REGION \
            --description="Learning Platform Docker repository"
        print_success "Created Artifact Registry repository"
    fi

    # Configure Docker to use gcloud as credential helper
    gcloud auth configure-docker $REGION-docker.pkg.dev
}

# Build and push Docker image
build_and_push() {
    print_status "Building and pushing Docker image..."

    IMAGE_URL="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME"

    # Build the image
    docker build -f Dockerfile.prod -t $IMAGE_URL:latest .
    docker tag $IMAGE_URL:latest $IMAGE_URL:$(git rev-parse --short HEAD)

    # Push the image
    docker push $IMAGE_URL:latest
    docker push $IMAGE_URL:$(git rev-parse --short HEAD)

    print_success "Docker image built and pushed"
    echo "Image URL: $IMAGE_URL:latest"
}

# Deploy to Cloud Run
deploy_cloud_run() {
    print_status "Deploying to Cloud Run..."

    IMAGE_URL="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME:latest"

    gcloud run deploy $SERVICE_NAME \
        --image=$IMAGE_URL \
        --platform=managed \
        --region=$REGION \
        --allow-unauthenticated \
        --port=3000 \
        --memory=2Gi \
        --cpu=2 \
        --min-instances=1 \
        --max-instances=10 \
        --concurrency=100 \
        --timeout=300 \
        --set-env-vars=NODE_ENV=production,PORT=3000 \
        --set-secrets=DATABASE_URL=database-url:latest,NEXTAUTH_SECRET=nextauth-secret:latest,REDIS_URL=redis-url:latest

    # Get the service URL
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

    print_success "Application deployed to Cloud Run"
    echo "Service URL: $SERVICE_URL"
}

# Set up Cloud Build trigger
setup_cloud_build() {
    print_status "Setting up Cloud Build trigger..."

    # Check if trigger exists
    if gcloud builds triggers list --filter="name:learning-platform-trigger" --format="value(name)" | grep -q "learning-platform-trigger"; then
        print_warning "Cloud Build trigger already exists"
    else
        gcloud builds triggers create github \
            --repo-name=learning-platform \
            --repo-owner=your-github-username \
            --branch-pattern="^main$" \
            --build-config=cloudbuild.yaml \
            --name=learning-platform-trigger \
            --description="Automated build and deploy for Learning Platform"
        print_success "Cloud Build trigger created"
    fi
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."

    # Get Cloud SQL connection string
    INSTANCE_CONNECTION_NAME="${PROJECT_ID}:${REGION}:learning-platform-db"

    # Run migrations using Cloud SQL Proxy
    print_status "Setting up Cloud SQL Proxy..."
    wget -q https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64 -O cloud_sql_proxy
    chmod +x cloud_sql_proxy

    # Start proxy in background
    ./cloud_sql_proxy -instances=$INSTANCE_CONNECTION_NAME=tcp:5432 &
    PROXY_PID=$!

    # Wait for proxy to start
    sleep 10

    # Run migrations
    DATABASE_URL="postgresql://postgres:$(gcloud secrets versions access latest --secret="db-password")@127.0.0.1:5432/learning_platform?schema=public" \
    npx prisma migrate deploy

    # Stop proxy
    kill $PROXY_PID

    print_success "Database migrations completed"
}

# Health check
health_check() {
    print_status "Performing health check..."

    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

    # Wait for service to be ready
    sleep 30

    # Check health endpoint
    if curl -f "$SERVICE_URL/api/health" > /dev/null 2>&1; then
        print_success "Health check passed"
        echo "Application is running at: $SERVICE_URL"
    else
        print_warning "Health check failed. Please check the logs."
        gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" --limit=50
    fi
}

# Main deployment function
main() {
    print_status "Starting GCP deployment for Learning Platform..."

    check_requirements
    setup_gcp
    create_artifact_registry
    build_and_push
    deploy_cloud_run
    setup_cloud_build
    run_migrations
    health_check

    print_success "Deployment completed successfully!"

    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
    echo ""
    echo "🎉 Learning Platform is now live at: $SERVICE_URL"
    echo ""
    echo "Next steps:"
    echo "1. Configure your domain name to point to this URL"
    echo "2. Set up monitoring and alerting"
    echo "3. Configure backup policies"
    echo "4. Review security settings"
}

# Run main function
main "$@"