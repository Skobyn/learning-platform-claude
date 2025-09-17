# Learning Platform Deployment Guide

## Overview

This guide covers deploying the Learning Platform to Google Cloud Platform using Cloud Run, Cloud SQL, and other GCP services.

## Prerequisites

### Required Tools
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
- [Docker](https://docs.docker.com/get-docker/)
- [Node.js](https://nodejs.org/) (v18+)
- [Git](https://git-scm.com/)

### GCP Services Required
- Cloud Run (container hosting)
- Cloud SQL (PostgreSQL database)
- Cloud Storage (file storage)
- Cloud Build (CI/CD)
- Cloud Monitoring (observability)
- Identity and Access Management (IAM)

## Initial Setup

### 1. GCP Project Setup

```bash
# Set project ID
export PROJECT_ID="your-learning-platform-project"

# Create new project (if needed)
gcloud projects create $PROJECT_ID

# Set as current project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sql-component.googleapis.com \
  storage-component.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com \
  secretmanager.googleapis.com
```

### 2. Database Setup

#### Create Cloud SQL Instance
```bash
# Create PostgreSQL instance
gcloud sql instances create learning-platform-db \
  --database-version=POSTGRES_14 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=10GB \
  --backup-start-time=03:00 \
  --enable-bin-log

# Create database
gcloud sql databases create learning_platform \
  --instance=learning-platform-db

# Create database user
gcloud sql users create app_user \
  --instance=learning-platform-db \
  --password=secure_password_here
```

#### Production Database Configuration
```bash
# For production, use higher-tier instances
gcloud sql instances create learning-platform-prod \
  --database-version=POSTGRES_14 \
  --tier=db-n1-standard-2 \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=100GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=06 \
  --availability-type=REGIONAL
```

### 3. Storage Setup

```bash
# Create Cloud Storage bucket for file uploads
gsutil mb gs://$PROJECT_ID-uploads

# Set public read access for thumbnails (optional)
gsutil iam ch allUsers:objectViewer gs://$PROJECT_ID-uploads

# Create bucket for backups
gsutil mb gs://$PROJECT_ID-backups
```

### 4. Redis Setup (Cloud Memorystore)

```bash
# Create Redis instance
gcloud redis instances create learning-platform-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_6_x \
  --tier=basic
```

## Environment Configuration

### 1. Secrets Management

```bash
# Store database URL
gcloud secrets create DATABASE_URL --data-file=-
# Paste: postgresql://app_user:password@/learning_platform?host=/cloudsql/PROJECT_ID:REGION:INSTANCE

# Store JWT secret
echo "your-super-secure-jwt-secret" | gcloud secrets create JWT_SECRET --data-file=-

# Store NextAuth secret
echo "your-nextauth-secret" | gcloud secrets create NEXTAUTH_SECRET --data-file=-

# Store Google OAuth credentials (if using)
echo "your-google-client-id" | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-
echo "your-google-client-secret" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
```

### 2. Environment Variables

Create `.env.production`:

```env
# Application
NODE_ENV=production
NEXTAUTH_URL=https://your-app.run.app
NEXTAUTH_SECRET=your-nextauth-secret

# Database
DATABASE_URL=postgresql://user:password@/db?host=/cloudsql/project:region:instance

# Redis
REDIS_URL=redis://10.x.x.x:6379

# File Storage
GOOGLE_CLOUD_PROJECT=your-project-id
STORAGE_BUCKET=your-project-id-uploads

# OAuth (if using)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Monitoring
ENABLE_MONITORING=true
LOG_LEVEL=info
```

## Docker Configuration

### 1. Production Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./

# Dependencies
FROM base AS deps
RUN npm ci --only=production --ignore-scripts

# Build
FROM base AS builder
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build

# Runtime
FROM node:18-alpine AS runtime
WORKDIR /app

# Add non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

USER nextjs

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
```

### 2. Docker Compose for Local Development

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:password@db:5432/learning_platform
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:14
    environment:
      POSTGRES_DB: learning_platform
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Deployment Methods

### Method 1: Cloud Build (Recommended)

#### 1. Create `cloudbuild.yaml`:

```yaml
steps:
  # Build Docker image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/learning-platform:$COMMIT_SHA', '.']

  # Push to Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/learning-platform:$COMMIT_SHA']

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
    - 'run'
    - 'deploy'
    - 'learning-platform'
    - '--image'
    - 'gcr.io/$PROJECT_ID/learning-platform:$COMMIT_SHA'
    - '--region'
    - 'us-central1'
    - '--platform'
    - 'managed'
    - '--allow-unauthenticated'
    - '--set-env-vars'
    - 'NODE_ENV=production'
    - '--set-secrets'
    - 'DATABASE_URL=DATABASE_URL:latest'
    - '--set-secrets'
    - 'JWT_SECRET=JWT_SECRET:latest'
    - '--add-cloudsql-instances'
    - '$PROJECT_ID:us-central1:learning-platform-db'

options:
  machineType: 'E2_HIGHCPU_8'
  
timeout: '1200s'
```

#### 2. Deploy with Cloud Build:

```bash
# Submit build
gcloud builds submit --config=cloudbuild.yaml .

# Or set up automatic builds from Git
gcloud builds triggers create github \
  --repo-name=learning-platform \
  --repo-owner=your-username \
  --branch-pattern="main" \
  --build-config=cloudbuild.yaml
```

### Method 2: Direct Cloud Run Deployment

```bash
# Build and deploy directly
gcloud run deploy learning-platform \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=DATABASE_URL:latest \
  --set-secrets JWT_SECRET=JWT_SECRET:latest \
  --add-cloudsql-instances $PROJECT_ID:us-central1:learning-platform-db \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 100 \
  --concurrency 1000 \
  --timeout 300
```

### Method 3: GitHub Actions CI/CD

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3

    - id: 'auth'
      uses: 'google-github-actions/auth@v1'
      with:
        credentials_json: '${{ secrets.GCP_SA_KEY }}'

    - name: 'Set up Cloud SDK'
      uses: 'google-github-actions/setup-gcloud@v1'

    - name: Configure Docker
      run: gcloud auth configure-docker

    - name: Build Docker image
      run: |
        docker build -t gcr.io/${{ secrets.GCP_PROJECT_ID }}/learning-platform:$GITHUB_SHA .

    - name: Push Docker image
      run: |
        docker push gcr.io/${{ secrets.GCP_PROJECT_ID }}/learning-platform:$GITHUB_SHA

    - name: Deploy to Cloud Run
      run: |
        gcloud run deploy learning-platform \
          --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/learning-platform:$GITHUB_SHA \
          --platform managed \
          --region us-central1 \
          --allow-unauthenticated
```

## Database Migration

### 1. Run Migrations

```bash
# Install Cloud SQL Proxy
curl -o cloud_sql_proxy https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64
chmod +x cloud_sql_proxy

# Start proxy
./cloud_sql_proxy -instances=$PROJECT_ID:us-central1:learning-platform-db=tcp:5432 &

# Run Prisma migrations
npx prisma migrate deploy
```

### 2. Seed Database

```bash
# Seed with initial data
npm run db:seed
```

## Monitoring and Observability

### 1. Set up Monitoring

```bash
# Create alerting policies
gcloud alpha monitoring policies create --policy-from-file=monitoring-policy.yaml
```

### 2. Configure Logging

```yaml
# logging.yaml
apiVersion: logging.coreos.com/v1
kind: ClusterLogForwarder
metadata:
  name: learning-platform
spec:
  outputs:
  - name: google-cloud-logging
    type: googleCloudLogging
    googleCloudLogging:
      projectId: your-project-id
      logId: learning-platform
```

### 3. Health Checks

```bash
# Configure uptime checks
gcloud monitoring uptime create learning-platform-uptime \
  --hostname=your-app.run.app \
  --path=/api/health \
  --port=443 \
  --protocol=https \
  --period=60s \
  --timeout=10s
```

## Performance Optimization

### 1. Cloud CDN Setup

```bash
# Create Cloud CDN for static assets
gcloud compute backend-buckets create learning-platform-assets \
  --gcs-bucket-name=$PROJECT_ID-assets

gcloud compute url-maps create learning-platform-lb \
  --default-service=learning-platform-backend

gcloud compute target-https-proxies create learning-platform-proxy \
  --url-map=learning-platform-lb \
  --ssl-certificates=learning-platform-ssl
```

### 2. Autoscaling Configuration

```yaml
# cloud-run-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: learning-platform
  annotations:
    run.googleapis.com/cpu-throttling: "false"
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "100"
        run.googleapis.com/memory: "2Gi"
        run.googleapis.com/cpu: "2000m"
    spec:
      containerConcurrency: 1000
      timeoutSeconds: 300
```

## Security Configuration

### 1. IAM Roles

```bash
# Create service account
gcloud iam service-accounts create learning-platform-sa \
  --display-name="Learning Platform Service Account"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### 2. VPC Configuration

```bash
# Create VPC connector for private resources
gcloud compute networks vpc-access connectors create learning-platform-connector \
  --network=default \
  --region=us-central1 \
  --range=10.8.0.0/28
```

### 3. SSL Certificate

```bash
# Create managed SSL certificate
gcloud compute ssl-certificates create learning-platform-ssl \
  --domains=your-domain.com,www.your-domain.com \
  --global
```

## Backup and Disaster Recovery

### 1. Database Backups

```bash
# Automated backups are enabled by default
# Manual backup
gcloud sql backups create \
  --instance=learning-platform-db \
  --description="Pre-deployment backup"
```

### 2. Application Backups

```bash
# Backup uploaded files
gsutil -m rsync -r -d gs://$PROJECT_ID-uploads gs://$PROJECT_ID-backups/uploads/$(date +%Y%m%d)
```

### 3. Disaster Recovery Plan

1. **RTO (Recovery Time Objective)**: 4 hours
2. **RPO (Recovery Point Objective)**: 1 hour
3. **Multi-region deployment** for high availability
4. **Automated failover** using Cloud Load Balancer

## Cost Optimization

### 1. Resource Right-sizing

```bash
# Monitor usage and adjust
gcloud run services update learning-platform \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=50
```

### 2. Cost Monitoring

```bash
# Set up budget alerts
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="Learning Platform Budget" \
  --budget-amount=1000USD \
  --threshold-percent=50,90 \
  --threshold-type=PERCENT
```

## Troubleshooting

### Common Issues

1. **Container startup failures**
   - Check Cloud Build logs
   - Verify environment variables
   - Check database connectivity

2. **Database connection issues**
   - Verify Cloud SQL instance is running
   - Check VPC connector configuration
   - Validate connection string

3. **Performance issues**
   - Review Cloud Monitoring metrics
   - Check Cloud SQL performance insights
   - Analyze Cloud Trace data

### Debug Commands

```bash
# View Cloud Run logs
gcloud run logs read learning-platform --region=us-central1

# Check service status
gcloud run services describe learning-platform --region=us-central1

# Test database connection
gcloud sql connect learning-platform-db --user=app_user

# Monitor resources
gcloud monitoring metrics list --filter="resource.type=cloud_run_revision"
```

## Maintenance

### 1. Regular Updates

```bash
# Update dependencies
npm audit fix
npm update

# Database maintenance
gcloud sql instances patch learning-platform-db --maintenance-window-hour=3
```

### 2. Monitoring Checklist

- [ ] Application uptime > 99.9%
- [ ] Response time < 200ms
- [ ] Error rate < 1%
- [ ] Database performance within limits
- [ ] Storage usage monitored
- [ ] Security patches applied

### 3. Scaling Considerations

- Monitor concurrent users and scale accordingly
- Consider horizontal scaling with multiple regions
- Implement caching strategies
- Optimize database queries
- Use Cloud CDN for static assets

## Support and Documentation

- **GCP Documentation**: https://cloud.google.com/docs
- **Cloud Run Guide**: https://cloud.google.com/run/docs
- **Cloud SQL Guide**: https://cloud.google.com/sql/docs
- **Support**: Create tickets through Google Cloud Console

---

This deployment guide ensures a production-ready, scalable, and maintainable Learning Platform deployment on Google Cloud Platform.