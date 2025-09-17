#!/bin/bash

# Learning Platform Deployment Script for Google Cloud Run

set -e

# Configuration
PROJECT_ID="rds-lms"
SERVICE_NAME="learning-platform"
REGION="us-central1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting deployment of Learning Platform to Google Cloud Run${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Please install it first.${NC}"
    exit 1
fi

# Set the project
echo -e "${YELLOW}Setting project to ${PROJECT_ID}...${NC}"
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo -e "${YELLOW}Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com

# Build the Docker image
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t ${IMAGE_NAME} .

# Push to Container Registry
echo -e "${YELLOW}Pushing image to Container Registry...${NC}"
docker push ${IMAGE_NAME}

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 2 \
    --port 3000 \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="DATABASE_URL=${DATABASE_URL}" \
    --set-env-vars="NEXTAUTH_URL=https://${SERVICE_NAME}-${PROJECT_ID}.a.run.app" \
    --set-env-vars="NEXTAUTH_SECRET=${NEXTAUTH_SECRET}"

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')

echo -e "${GREEN}✅ Deployment successful!${NC}"
echo -e "${GREEN}🌐 Your app is running at: ${SERVICE_URL}${NC}"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Set up Cloud SQL for production database"
echo "2. Configure Redis/Memorystore for caching"
echo "3. Set up Cloud Storage for file uploads"
echo "4. Configure custom domain if needed"