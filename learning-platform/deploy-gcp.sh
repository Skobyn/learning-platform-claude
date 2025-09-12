#!/bin/bash

# Enterprise Learning Platform - Google Cloud Deployment Script
# This script deploys the entire application stack to GCP

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"learning-platform-prod"}
REGION=${GCP_REGION:-"us-central1"}
ZONE=${GCP_ZONE:-"us-central1-a"}
APP_NAME="learning-platform"
CLUSTER_NAME="${APP_NAME}-cluster"
DB_INSTANCE="${APP_NAME}-db"
REDIS_INSTANCE="${APP_NAME}-redis"
BUCKET_NAME="${PROJECT_ID}-media"
SERVICE_ACCOUNT="${APP_NAME}-sa"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Google Cloud Deployment for Learning Platform${NC}"

# 1. Set up project
echo -e "${YELLOW}Setting up GCP project...${NC}"
gcloud config set project ${PROJECT_ID}
gcloud config set compute/region ${REGION}
gcloud config set compute/zone ${ZONE}

# Function to check and enable APIs
check_and_enable_apis() {
    local api=$1
    echo -n "  Checking ${api}... "
    
    # Check if API is already enabled
    if gcloud services list --enabled --format="value(config.name)" | grep -q "^${api}$"; then
        echo -e "${GREEN}✓ Already enabled${NC}"
    else
        echo -e "${YELLOW}Enabling...${NC}"
        if gcloud services enable ${api} --async; then
            echo -e "    ${GREEN}✓ ${api} enabled successfully${NC}"
        else
            echo -e "    ${RED}✗ Failed to enable ${api}${NC}"
            return 1
        fi
    fi
}

# Enable required APIs
echo -e "${YELLOW}Checking and enabling required GCP APIs...${NC}"
echo -e "${YELLOW}This may take a few minutes...${NC}"

# List of all required APIs
REQUIRED_APIS=(
    "compute.googleapis.com"                    # Compute Engine
    "container.googleapis.com"                  # Kubernetes Engine
    "sqladmin.googleapis.com"                  # Cloud SQL
    "cloudresourcemanager.googleapis.com"      # Resource Manager
    "redis.googleapis.com"                     # Memorystore Redis
    "storage-api.googleapis.com"               # Cloud Storage
    "storage-component.googleapis.com"         # Cloud Storage (component)
    "secretmanager.googleapis.com"             # Secret Manager
    "artifactregistry.googleapis.com"          # Artifact Registry
    "run.googleapis.com"                       # Cloud Run
    "cloudbuild.googleapis.com"                # Cloud Build
    "cloudscheduler.googleapis.com"            # Cloud Scheduler
    "monitoring.googleapis.com"                # Cloud Monitoring
    "logging.googleapis.com"                   # Cloud Logging
    "iamcredentials.googleapis.com"            # IAM Service Account Credentials
    "iam.googleapis.com"                       # Identity and Access Management
    "cloudtrace.googleapis.com"                # Cloud Trace
    "servicemanagement.googleapis.com"         # Service Management
    "servicecontrol.googleapis.com"            # Service Control
    "servicenetworking.googleapis.com"         # Service Networking
    "vpcaccess.googleapis.com"                 # Serverless VPC Access
    "dns.googleapis.com"                       # Cloud DNS
    "certificatemanager.googleapis.com"        # Certificate Manager
)

# Counter for progress
TOTAL_APIS=${#REQUIRED_APIS[@]}
ENABLED_COUNT=0
FAILED_COUNT=0

echo -e "${YELLOW}Checking ${TOTAL_APIS} required APIs...${NC}"
echo ""

# Check and enable each API
for api in "${REQUIRED_APIS[@]}"; do
    if check_and_enable_apis "$api"; then
        ((ENABLED_COUNT++))
    else
        ((FAILED_COUNT++))
    fi
done

# Wait for async operations to complete
echo ""
echo -e "${YELLOW}Waiting for API enablement to complete...${NC}"
sleep 10

# Verify all APIs are enabled
echo ""
echo -e "${YELLOW}Verifying API status...${NC}"
ALL_ENABLED=true
for api in "${REQUIRED_APIS[@]}"; do
    if ! gcloud services list --enabled --format="value(config.name)" | grep -q "^${api}$"; then
        echo -e "${RED}✗ ${api} is not enabled${NC}"
        ALL_ENABLED=false
    fi
done

if [ "$ALL_ENABLED" = true ]; then
    echo -e "${GREEN}✅ All ${TOTAL_APIS} APIs are enabled and ready!${NC}"
else
    echo -e "${RED}⚠️ Some APIs failed to enable. Please check the errors above.${NC}"
    echo -e "${YELLOW}You can manually enable them using:${NC}"
    echo "gcloud services enable [API_NAME]"
    exit 1
fi

echo ""

# 2. Create Artifact Registry repository
echo -e "${YELLOW}Creating Artifact Registry repository...${NC}"
gcloud artifacts repositories create ${APP_NAME} \
    --repository-format=docker \
    --location=${REGION} \
    --description="Learning Platform Docker images" \
    || echo "Repository already exists"

# 3. Create service account
echo -e "${YELLOW}Creating service account...${NC}"
gcloud iam service-accounts create ${SERVICE_ACCOUNT} \
    --display-name="Learning Platform Service Account" \
    || echo "Service account already exists"

# Grant necessary roles
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

# 4. Create Cloud SQL PostgreSQL instance
echo -e "${YELLOW}Creating Cloud SQL PostgreSQL instance...${NC}"
gcloud sql instances create ${DB_INSTANCE} \
    --database-version=POSTGRES_14 \
    --tier=db-standard-2 \
    --region=${REGION} \
    --network=default \
    --backup \
    --backup-start-time=03:00 \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=03 \
    --maintenance-window-duration=4 \
    --database-flags=max_connections=100 \
    || echo "Database instance already exists"

# Create database
gcloud sql databases create learning_platform \
    --instance=${DB_INSTANCE} \
    || echo "Database already exists"

# Set database password
DB_PASSWORD=$(openssl rand -base64 32)
gcloud sql users set-password postgres \
    --instance=${DB_INSTANCE} \
    --password=${DB_PASSWORD}

# Get database connection name
DB_CONNECTION_NAME=$(gcloud sql instances describe ${DB_INSTANCE} --format="value(connectionName)")

# 5. Create Memorystore Redis instance
echo -e "${YELLOW}Creating Memorystore Redis instance...${NC}"
gcloud redis instances create ${REDIS_INSTANCE} \
    --size=1 \
    --region=${REGION} \
    --redis-version=redis_6_x \
    --tier=STANDARD \
    || echo "Redis instance already exists"

# Get Redis host
REDIS_HOST=$(gcloud redis instances describe ${REDIS_INSTANCE} --region=${REGION} --format="value(host)")

# 6. Create Cloud Storage bucket
echo -e "${YELLOW}Creating Cloud Storage bucket for media...${NC}"
gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${BUCKET_NAME}/ || echo "Bucket already exists"
gsutil iam ch allUsers:objectViewer gs://${BUCKET_NAME}

# 7. Store secrets in Secret Manager
echo -e "${YELLOW}Storing secrets in Secret Manager...${NC}"

# Database URL
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@/${DB_INSTANCE}?host=/cloudsql/${DB_CONNECTION_NAME}"
echo -n "${DATABASE_URL}" | gcloud secrets create database-url --data-file=- || \
    echo -n "${DATABASE_URL}" | gcloud secrets versions add database-url --data-file=-

# Redis URL
echo -n "redis://${REDIS_HOST}:6379" | gcloud secrets create redis-url --data-file=- || \
    echo -n "redis://${REDIS_HOST}:6379" | gcloud secrets versions add redis-url --data-file=-

# NextAuth Secret
NEXTAUTH_SECRET=$(openssl rand -base64 32)
echo -n "${NEXTAUTH_SECRET}" | gcloud secrets create nextauth-secret --data-file=- || \
    echo -n "${NEXTAUTH_SECRET}" | gcloud secrets versions add nextauth-secret --data-file=-

# 8. Build and push Docker image
echo -e "${YELLOW}Building and pushing Docker image...${NC}"
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/${APP_NAME}:latest"

# Create cloudbuild.yaml if not exists
cat > cloudbuild.yaml <<EOF
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${IMAGE_URL}', '.']
  
  # Push the container image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${IMAGE_URL}']

images:
  - '${IMAGE_URL}'

options:
  logging: CLOUD_LOGGING_ONLY
EOF

# Submit build
gcloud builds submit --config=cloudbuild.yaml .

# 9. Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run deploy ${APP_NAME} \
    --image=${IMAGE_URL} \
    --platform=managed \
    --region=${REGION} \
    --allow-unauthenticated \
    --add-cloudsql-instances=${DB_CONNECTION_NAME} \
    --service-account=${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
    --set-env-vars="GCS_BUCKET=${BUCKET_NAME}" \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --set-secrets="REDIS_URL=redis-url:latest" \
    --set-secrets="NEXTAUTH_SECRET=nextauth-secret:latest" \
    --memory=2Gi \
    --cpu=2 \
    --min-instances=1 \
    --max-instances=10 \
    --timeout=300

# 10. Get service URL
SERVICE_URL=$(gcloud run services describe ${APP_NAME} --region=${REGION} --format="value(status.url)")

# 11. Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
gcloud run jobs create migrate-db \
    --image=${IMAGE_URL} \
    --region=${REGION} \
    --add-cloudsql-instances=${DB_CONNECTION_NAME} \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --command="npx" \
    --args="prisma,migrate,deploy" \
    || echo "Migration job already exists"

gcloud run jobs execute migrate-db --region=${REGION} --wait

# 12. Set up monitoring
echo -e "${YELLOW}Setting up monitoring...${NC}"
gcloud monitoring dashboards create --config-from-file=- <<EOF
{
  "displayName": "Learning Platform Dashboard",
  "gridLayout": {
    "widgets": [
      {
        "title": "Cloud Run Request Count",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\""
              }
            }
          }]
        }
      },
      {
        "title": "Cloud SQL CPU Utilization",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
              }
            }
          }]
        }
      }
    ]
  }
}
EOF

# 13. Set up Cloud Scheduler for periodic tasks
echo -e "${YELLOW}Setting up Cloud Scheduler...${NC}"
gcloud scheduler jobs create http cleanup-sessions \
    --location=${REGION} \
    --schedule="0 2 * * *" \
    --uri="${SERVICE_URL}/api/cron/cleanup" \
    --http-method=POST \
    || echo "Scheduler job already exists"

# 14. Configure Cloud CDN
echo -e "${YELLOW}Setting up Cloud CDN...${NC}"
gcloud compute backend-services create ${APP_NAME}-backend \
    --global \
    --load-balancing-scheme=EXTERNAL \
    --protocol=HTTPS \
    || echo "Backend service already exists"

# 15. Output summary
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "🎉 Your Learning Platform is now live on Google Cloud!"
echo ""
echo "📋 Deployment Summary:"
echo "  - Service URL: ${SERVICE_URL}"
echo "  - Project ID: ${PROJECT_ID}"
echo "  - Region: ${REGION}"
echo "  - Database: ${DB_INSTANCE}"
echo "  - Redis: ${REDIS_INSTANCE}"
echo "  - Storage Bucket: gs://${BUCKET_NAME}"
echo ""
echo "📊 Next Steps:"
echo "  1. Update DNS to point to: ${SERVICE_URL}"
echo "  2. Configure custom domain in Cloud Run"
echo "  3. Set up SSL certificate"
echo "  4. Configure environment variables for external services (OpenAI, Email, etc.)"
echo "  5. Run initial seed: gcloud run jobs execute seed-db --region=${REGION}"
echo ""
echo "🔧 Useful Commands:"
echo "  - View logs: gcloud run logs read --service=${APP_NAME} --region=${REGION}"
echo "  - Update env vars: gcloud run services update ${APP_NAME} --update-env-vars KEY=VALUE --region=${REGION}"
echo "  - Scale instances: gcloud run services update ${APP_NAME} --min-instances=2 --max-instances=20 --region=${REGION}"
echo ""
echo "📚 Documentation: https://cloud.google.com/run/docs"