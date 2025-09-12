#!/bin/bash

# Quick fix and deploy script
set -e

PROJECT_ID=${GCP_PROJECT_ID:-"rds-lms"}
REGION=${GCP_REGION:-"us-central1"}
APP_NAME="learning-platform"

echo "🔧 Fixing package-lock.json issue..."

# Generate package-lock.json
npm install

echo "✅ package-lock.json generated"

# Now continue with deployment
echo "🚀 Deploying to Cloud Run..."

# Build with Cloud Build
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/${APP_NAME}:latest"

gcloud builds submit --tag ${IMAGE_URL} .

# Deploy to Cloud Run
gcloud run deploy ${APP_NAME} \
    --image=${IMAGE_URL} \
    --platform=managed \
    --region=${REGION} \
    --allow-unauthenticated \
    --add-cloudsql-instances=${PROJECT_ID}:${REGION}:${APP_NAME}-db \
    --service-account=${APP_NAME}-sa@${PROJECT_ID}.iam.gserviceaccount.com \
    --set-env-vars="NODE_ENV=production" \
    --set-secrets="DATABASE_URL=database-url:latest,NEXTAUTH_SECRET=nextauth-secret:latest" \
    --memory=2Gi \
    --cpu=2 \
    --min-instances=0 \
    --max-instances=10

SERVICE_URL=$(gcloud run services describe ${APP_NAME} --region=${REGION} --format='value(status.url)')

echo ""
echo "✅ Deployment Complete!"
echo "🌐 Your app is live at: ${SERVICE_URL}"