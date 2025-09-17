#!/bin/bash

# Simple, working GCP deployment script for Learning Platform
set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"rds-lms"}
REGION=${GCP_REGION:-"us-central1"}
ZONE=${GCP_ZONE:-"us-central1-a"}
APP_NAME="learning-platform"
DB_INSTANCE="${APP_NAME}-db"
BUCKET_NAME="${PROJECT_ID}-media"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Learning Platform GCP Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Project: ${PROJECT_ID}"
echo -e "Region: ${REGION}"
echo ""

# Step 1: Set project
echo -e "${YELLOW}Step 1: Setting project configuration...${NC}"
gcloud config set project ${PROJECT_ID}
gcloud config set compute/region ${REGION}
gcloud config set compute/zone ${ZONE}
echo -e "${GREEN}✓ Project configured${NC}"
echo ""

# Step 2: Enable ALL required APIs at once
echo -e "${YELLOW}Step 2: Enabling all required APIs (this takes 2-3 minutes)...${NC}"
gcloud services enable \
    compute.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    storage.googleapis.com \
    storage-api.googleapis.com \
    storage-component.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    cloudscheduler.googleapis.com \
    monitoring.googleapis.com \
    logging.googleapis.com \
    iam.googleapis.com \
    iamcredentials.googleapis.com \
    servicenetworking.googleapis.com \
    servicecontrol.googleapis.com \
    servicemanagement.googleapis.com

echo -e "${GREEN}✓ All APIs enabled${NC}"
echo ""

# Step 3: Create Artifact Registry
echo -e "${YELLOW}Step 3: Creating Artifact Registry for Docker images...${NC}"
gcloud artifacts repositories create ${APP_NAME} \
    --repository-format=docker \
    --location=${REGION} \
    --description="Learning Platform Docker images" \
    2>/dev/null || echo "Repository already exists"
echo -e "${GREEN}✓ Artifact Registry ready${NC}"
echo ""

# Step 4: Create service account
echo -e "${YELLOW}Step 4: Creating service account...${NC}"
gcloud iam service-accounts create ${APP_NAME}-sa \
    --display-name="Learning Platform Service Account" \
    2>/dev/null || echo "Service account already exists"

# Grant necessary permissions
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${APP_NAME}-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client" \
    --condition=None \
    --quiet 2>/dev/null || true

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${APP_NAME}-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.admin" \
    --condition=None \
    --quiet 2>/dev/null || true

echo -e "${GREEN}✓ Service account configured${NC}"
echo ""

# Step 5: Create Cloud SQL instance
echo -e "${YELLOW}Step 5: Creating Cloud SQL PostgreSQL instance...${NC}"
echo -e "${YELLOW}(This takes 5-10 minutes, please be patient)${NC}"

# Check if instance exists
if gcloud sql instances describe ${DB_INSTANCE} --project=${PROJECT_ID} 2>/dev/null; then
    echo "Database instance already exists"
else
    gcloud sql instances create ${DB_INSTANCE} \
        --database-version=POSTGRES_14 \
        --tier=db-f1-micro \
        --region=${REGION} \
        --project=${PROJECT_ID}
fi

# Create database
gcloud sql databases create learning_platform \
    --instance=${DB_INSTANCE} \
    2>/dev/null || echo "Database already exists"

# Set password
DB_PASSWORD="LearningPlatform2024!"
gcloud sql users set-password postgres \
    --instance=${DB_INSTANCE} \
    --password=${DB_PASSWORD}

DB_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${DB_INSTANCE}"
echo -e "${GREEN}✓ Database ready${NC}"
echo ""

# Step 6: Create Storage bucket
echo -e "${YELLOW}Step 6: Creating storage bucket...${NC}"
gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${BUCKET_NAME}/ 2>/dev/null || echo "Bucket already exists"
gsutil iam ch allUsers:objectViewer gs://${BUCKET_NAME} 2>/dev/null || true
echo -e "${GREEN}✓ Storage bucket ready${NC}"
echo ""

# Step 7: Store secrets
echo -e "${YELLOW}Step 7: Configuring secrets...${NC}"

# Database URL
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost/learning_platform?host=/cloudsql/${DB_CONNECTION_NAME}"
echo -n "${DATABASE_URL}" | gcloud secrets create database-url --data-file=- 2>/dev/null || \
    echo -n "${DATABASE_URL}" | gcloud secrets versions add database-url --data-file=-

# NextAuth Secret
NEXTAUTH_SECRET="your-secret-key-change-this-in-production"
echo -n "${NEXTAUTH_SECRET}" | gcloud secrets create nextauth-secret --data-file=- 2>/dev/null || \
    echo -n "${NEXTAUTH_SECRET}" | gcloud secrets versions add nextauth-secret --data-file=-

# Redis URL (using memory cache for now)
echo -n "memory://" | gcloud secrets create redis-url --data-file=- 2>/dev/null || \
    echo -n "memory://" | gcloud secrets versions add redis-url --data-file=-

echo -e "${GREEN}✓ Secrets configured${NC}"
echo ""

# Step 8: Build and deploy
echo -e "${YELLOW}Step 8: Building and deploying application...${NC}"

# Configure Docker auth
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# Build using Cloud Build
echo -e "${YELLOW}Building Docker image with Cloud Build...${NC}"
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/${APP_NAME}:latest"

# Create a simple Cloud Build config
cat > cloudbuild-simple.yaml <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${IMAGE_URL}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${IMAGE_URL}']
images:
  - '${IMAGE_URL}'
EOF

# Submit build
gcloud builds submit --config=cloudbuild-simple.yaml .

echo -e "${GREEN}✓ Docker image built and pushed${NC}"
echo ""

# Step 9: Deploy to Cloud Run
echo -e "${YELLOW}Step 9: Deploying to Cloud Run...${NC}"
gcloud run deploy ${APP_NAME} \
    --image=${IMAGE_URL} \
    --platform=managed \
    --region=${REGION} \
    --allow-unauthenticated \
    --add-cloudsql-instances=${DB_CONNECTION_NAME} \
    --service-account=${APP_NAME}-sa@${PROJECT_ID}.iam.gserviceaccount.com \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="GCS_BUCKET=${BUCKET_NAME}" \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --set-secrets="NEXTAUTH_SECRET=nextauth-secret:latest" \
    --set-secrets="REDIS_URL=redis-url:latest" \
    --memory=2Gi \
    --cpu=2 \
    --min-instances=0 \
    --max-instances=10 \
    --timeout=300

# Get service URL
SERVICE_URL=$(gcloud run services describe ${APP_NAME} --region=${REGION} --format='value(status.url)')

# Step 10: Run database migrations
echo -e "${YELLOW}Step 10: Setting up database migrations job...${NC}"
gcloud run jobs create migrate-db \
    --image=${IMAGE_URL} \
    --region=${REGION} \
    --add-cloudsql-instances=${DB_CONNECTION_NAME} \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --command="npx" \
    --args="prisma,migrate,deploy" \
    2>/dev/null || echo "Migration job already exists"

echo -e "${YELLOW}Running migrations...${NC}"
gcloud run jobs execute migrate-db --region=${REGION} --wait

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Your Learning Platform is now live at:${NC}"
echo -e "${YELLOW}${SERVICE_URL}${NC}"
echo ""
echo -e "${GREEN}Project Details:${NC}"
echo "  • Project ID: ${PROJECT_ID}"
echo "  • Region: ${REGION}"
echo "  • Database: ${DB_INSTANCE}"
echo "  • Storage: gs://${BUCKET_NAME}"
echo ""
echo -e "${GREEN}Useful Commands:${NC}"
echo "  • View logs: gcloud run logs read --service=${APP_NAME} --region=${REGION}"
echo "  • Update app: gcloud run deploy ${APP_NAME} --image=${IMAGE_URL} --region=${REGION}"
echo "  • Check health: curl ${SERVICE_URL}/api/health"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"