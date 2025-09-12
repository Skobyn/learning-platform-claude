# 🌩️ Google Cloud Platform Complete Deployment Guide

## Prerequisites

### 1. Install Google Cloud SDK
```bash
# For Linux/MacOS
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init

# For Cloud Shell (already installed)
gcloud auth list
```

### 2. Create a GCP Project
```bash
# Create new project
gcloud projects create learning-platform-prod --name="Learning Platform"

# Set as active project
gcloud config set project learning-platform-prod

# Enable billing (required for resources)
# Visit: https://console.cloud.google.com/billing
```

### 3. Set Required Permissions
```bash
# Ensure you have these roles:
# - Project Owner or
# - Editor + Security Admin + Cloud SQL Admin
```

## 🚀 Quick Deployment

### Option 1: Automated Deployment (Recommended)
```bash
# Make the script executable
chmod +x deploy-gcp.sh

# Set your project ID
export GCP_PROJECT_ID="your-project-id"
export GCP_REGION="us-central1"

# Run the deployment
./deploy-gcp.sh
```

### Option 2: Manual Step-by-Step Deployment

## 📋 Manual Deployment Steps

### Step 1: Enable Required APIs
```bash
gcloud services enable \
    compute.googleapis.com \
    container.googleapis.com \
    sqladmin.googleapis.com \
    cloudresourcemanager.googleapis.com \
    redis.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    cloudscheduler.googleapis.com \
    monitoring.googleapis.com
```

### Step 2: Create Artifact Registry
```bash
# Create repository for Docker images
gcloud artifacts repositories create learning-platform \
    --repository-format=docker \
    --location=us-central1 \
    --description="Learning Platform Docker images"

# Configure Docker authentication
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### Step 3: Set Up Cloud SQL (PostgreSQL)
```bash
# Create PostgreSQL instance
gcloud sql instances create learning-platform-db \
    --database-version=POSTGRES_14 \
    --tier=db-standard-2 \
    --region=us-central1 \
    --network=default \
    --backup \
    --backup-start-time=03:00

# Create database
gcloud sql databases create learning_platform \
    --instance=learning-platform-db

# Set root password
gcloud sql users set-password postgres \
    --instance=learning-platform-db \
    --password=YOUR_SECURE_PASSWORD
```

### Step 4: Create Memorystore (Redis)
```bash
# Create Redis instance
gcloud redis instances create learning-platform-redis \
    --size=1 \
    --region=us-central1 \
    --redis-version=redis_6_x \
    --tier=STANDARD

# Get Redis IP
gcloud redis instances describe learning-platform-redis \
    --region=us-central1 \
    --format="get(host)"
```

### Step 5: Create Cloud Storage Bucket
```bash
# Create bucket for media files
gsutil mb -p learning-platform-prod \
    -c STANDARD \
    -l us-central1 \
    gs://learning-platform-media/

# Set public access for media files
gsutil iam ch allUsers:objectViewer gs://learning-platform-media/

# Enable CORS
cat > cors.json <<EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "POST", "PUT", "DELETE"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set cors.json gs://learning-platform-media/
```

### Step 6: Store Secrets in Secret Manager
```bash
# Database URL
DB_CONNECTION_NAME=$(gcloud sql instances describe learning-platform-db --format="value(connectionName)")
echo -n "postgresql://postgres:PASSWORD@/$DB_CONNECTION_NAME/learning_platform" | \
    gcloud secrets create database-url --data-file=-

# Redis URL
REDIS_HOST=$(gcloud redis instances describe learning-platform-redis --region=us-central1 --format="value(host)")
echo -n "redis://$REDIS_HOST:6379" | \
    gcloud secrets create redis-url --data-file=-

# NextAuth Secret
echo -n "$(openssl rand -base64 32)" | \
    gcloud secrets create nextauth-secret --data-file=-

# OpenAI API Key
echo -n "your-openai-api-key" | \
    gcloud secrets create openai-api-key --data-file=-
```

### Step 7: Build and Deploy to Cloud Run
```bash
# Build and push image using Cloud Build
gcloud builds submit --tag us-central1-docker.pkg.dev/learning-platform-prod/learning-platform/app:latest

# Deploy to Cloud Run
gcloud run deploy learning-platform \
    --image=us-central1-docker.pkg.dev/learning-platform-prod/learning-platform/app:latest \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances=learning-platform-prod:us-central1:learning-platform-db \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="GCS_BUCKET=learning-platform-media" \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --set-secrets="REDIS_URL=redis-url:latest" \
    --set-secrets="NEXTAUTH_SECRET=nextauth-secret:latest" \
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest" \
    --memory=2Gi \
    --cpu=2 \
    --min-instances=1 \
    --max-instances=10 \
    --timeout=300
```

### Step 8: Run Database Migrations
```bash
# Create a Cloud Run job for migrations
gcloud run jobs create migrate-db \
    --image=us-central1-docker.pkg.dev/learning-platform-prod/learning-platform/app:latest \
    --region=us-central1 \
    --add-cloudsql-instances=learning-platform-prod:us-central1:learning-platform-db \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --command="npx" \
    --args="prisma,migrate,deploy"

# Execute the migration
gcloud run jobs execute migrate-db --region=us-central1 --wait

# Create seed job
gcloud run jobs create seed-db \
    --image=us-central1-docker.pkg.dev/learning-platform-prod/learning-platform/app:latest \
    --region=us-central1 \
    --add-cloudsql-instances=learning-platform-prod:us-central1:learning-platform-db \
    --set-secrets="DATABASE_URL=database-url:latest" \
    --command="npx" \
    --args="prisma,db,seed"

# Run initial seed
gcloud run jobs execute seed-db --region=us-central1 --wait
```

### Step 9: Set Up Custom Domain (Optional)
```bash
# Map custom domain
gcloud run domain-mappings create \
    --service=learning-platform \
    --domain=learn.yourdomain.com \
    --region=us-central1

# The command will output DNS records to add to your domain
```

### Step 10: Configure Cloud CDN and Load Balancer
```bash
# Reserve static IP
gcloud compute addresses create learning-platform-ip --global

# Create NEG for Cloud Run
gcloud compute network-endpoint-groups create learning-platform-neg \
    --region=us-central1 \
    --network-endpoint-type=serverless \
    --cloud-run-service=learning-platform

# Create backend service
gcloud compute backend-services create learning-platform-backend \
    --global \
    --protocol=HTTPS \
    --enable-cdn

# Add NEG to backend
gcloud compute backend-services add-backend learning-platform-backend \
    --global \
    --network-endpoint-group=learning-platform-neg \
    --network-endpoint-group-region=us-central1

# Create URL map
gcloud compute url-maps create learning-platform-lb \
    --default-service=learning-platform-backend

# Create SSL certificate
gcloud compute ssl-certificates create learning-platform-cert \
    --domains=learn.yourdomain.com \
    --global

# Create HTTPS proxy
gcloud compute target-https-proxies create learning-platform-https-proxy \
    --ssl-certificates=learning-platform-cert \
    --url-map=learning-platform-lb

# Create forwarding rule
gcloud compute forwarding-rules create learning-platform-https-rule \
    --global \
    --address=learning-platform-ip \
    --target-https-proxy=learning-platform-https-proxy \
    --ports=443
```

## 🔧 Post-Deployment Configuration

### 1. Set Additional Environment Variables
```bash
# Update Cloud Run service with additional configs
gcloud run services update learning-platform \
    --update-env-vars="NEXTAUTH_URL=https://learn.yourdomain.com" \
    --update-env-vars="SMTP_HOST=smtp.gmail.com" \
    --update-env-vars="SMTP_PORT=587" \
    --update-env-vars="SMTP_FROM=noreply@yourdomain.com" \
    --region=us-central1
```

### 2. Set Up Monitoring
```bash
# Create uptime check
gcloud monitoring uptime-check-configs create learning-platform-health \
    --display-name="Learning Platform Health Check" \
    --resource-type="uptime-url" \
    --monitored-resource="{'type':'uptime_url','labels':{'host':'learn.yourdomain.com','project_id':'learning-platform-prod'}}" \
    --http-check="{'path':'/api/health','port':443,'use_ssl':true}" \
    --period="60s"

# Create alert policy
gcloud alpha monitoring policies create \
    --notification-channels=YOUR_CHANNEL_ID \
    --display-name="Learning Platform Alerts" \
    --condition-display-name="High Error Rate" \
    --condition-threshold-value=0.01 \
    --condition-threshold-duration=60s
```

### 3. Set Up Scheduled Tasks
```bash
# Daily cleanup job
gcloud scheduler jobs create http cleanup-sessions \
    --location=us-central1 \
    --schedule="0 2 * * *" \
    --uri="https://learning-platform-xxx.run.app/api/cron/cleanup" \
    --http-method=POST

# Weekly report generation
gcloud scheduler jobs create http generate-reports \
    --location=us-central1 \
    --schedule="0 9 * * MON" \
    --uri="https://learning-platform-xxx.run.app/api/cron/reports" \
    --http-method=POST
```

## 📊 Monitoring & Management

### View Logs
```bash
# Cloud Run logs
gcloud run logs read --service=learning-platform --region=us-central1

# Cloud SQL logs
gcloud sql operations list --instance=learning-platform-db

# Continuous log streaming
gcloud run logs tail --service=learning-platform --region=us-central1
```

### Scale Resources
```bash
# Scale Cloud Run
gcloud run services update learning-platform \
    --min-instances=2 \
    --max-instances=20 \
    --region=us-central1

# Scale Cloud SQL
gcloud sql instances patch learning-platform-db \
    --tier=db-standard-4

# Scale Redis
gcloud redis instances update learning-platform-redis \
    --size=5 \
    --region=us-central1
```

### Backup & Recovery
```bash
# Manual database backup
gcloud sql backups create \
    --instance=learning-platform-db \
    --description="Manual backup $(date +%Y%m%d)"

# List backups
gcloud sql backups list --instance=learning-platform-db

# Restore from backup
gcloud sql backups restore BACKUP_ID \
    --restore-instance=learning-platform-db
```

## 💰 Cost Optimization

### Estimated Monthly Costs (USD)
- **Cloud Run**: $50-200 (based on traffic)
- **Cloud SQL**: $100-200 (db-standard-2)
- **Memorystore Redis**: $40 (1GB standard)
- **Cloud Storage**: $10-50 (based on usage)
- **Load Balancer**: $25
- **Total**: ~$225-515/month

### Cost Saving Tips
1. Use Cloud Run min-instances=0 for dev/staging
2. Schedule Cloud SQL to stop during off-hours
3. Use Cloud Storage lifecycle policies
4. Enable Cloud CDN for static assets
5. Use committed use discounts for production

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Issues**
```bash
# Check Cloud SQL proxy
gcloud sql instances describe learning-platform-db

# Test connection
gcloud sql connect learning-platform-db --user=postgres
```

2. **Redis Connection Issues**
```bash
# Check Redis instance
gcloud redis instances describe learning-platform-redis --region=us-central1

# Get connection details
gcloud redis instances get-auth-string learning-platform-redis --region=us-central1
```

3. **Permission Issues**
```bash
# Grant Cloud Run service account permissions
gcloud projects add-iam-policy-binding learning-platform-prod \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/cloudsql.client"
```

## 📚 Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Documentation](https://cloud.google.com/sql/docs)
- [Memorystore Documentation](https://cloud.google.com/memorystore/docs)
- [Cloud Storage Documentation](https://cloud.google.com/storage/docs)
- [GCP Best Practices](https://cloud.google.com/docs/enterprise/best-practices-for-enterprise-organizations)

## 🎯 Next Steps

1. Configure monitoring dashboards
2. Set up CI/CD with Cloud Build
3. Implement backup strategies
4. Configure security policies
5. Set up staging environment
6. Enable audit logging
7. Configure budget alerts

---

Your Learning Platform is now fully deployed on Google Cloud Platform! 🎉