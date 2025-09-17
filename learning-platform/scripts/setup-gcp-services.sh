#!/bin/bash

# GCP Services Setup Script for Learning Platform
# This script creates and configures all required GCP services

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
ZONE=${ZONE:-"us-central1-a"}
DB_INSTANCE_NAME="learning-platform-db"
REDIS_INSTANCE_NAME="learning-platform-redis"
STORAGE_BUCKET_NAME="${PROJECT_ID}-media-assets"

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

# Generate secure password
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Setup Cloud SQL PostgreSQL
setup_cloud_sql() {
    print_status "Setting up Cloud SQL PostgreSQL..."

    # Generate database password
    DB_PASSWORD=$(generate_password)

    # Create Cloud SQL instance
    if gcloud sql instances describe $DB_INSTANCE_NAME 2>/dev/null; then
        print_warning "Cloud SQL instance already exists"
    else
        gcloud sql instances create $DB_INSTANCE_NAME \
            --database-version=POSTGRES_14 \
            --tier=db-custom-2-4096 \
            --region=$REGION \
            --storage-type=SSD \
            --storage-size=20GB \
            --storage-auto-increase \
            --backup \
            --backup-start-time=03:00 \
            --maintenance-window-day=SUN \
            --maintenance-window-hour=04 \
            --availability-type=REGIONAL \
            --enable-bin-log \
            --deletion-protection
        print_success "Cloud SQL instance created"
    fi

    # Set root password
    gcloud sql users set-password postgres \
        --instance=$DB_INSTANCE_NAME \
        --password=$DB_PASSWORD

    # Create application database
    gcloud sql databases create learning_platform \
        --instance=$DB_INSTANCE_NAME || true

    # Store database password in Secret Manager
    echo -n "$DB_PASSWORD" | gcloud secrets create db-password --data-file=- || \
    echo -n "$DB_PASSWORD" | gcloud secrets versions add db-password --data-file=-

    # Create database URL secret
    DB_URL="postgresql://postgres:${DB_PASSWORD}@/learning_platform?host=/cloudsql/${PROJECT_ID}:${REGION}:${DB_INSTANCE_NAME}&sslmode=require"
    echo -n "$DB_URL" | gcloud secrets create database-url --data-file=- || \
    echo -n "$DB_URL" | gcloud secrets versions add database-url --data-file=-

    print_success "Cloud SQL setup completed"
}

# Setup Cloud SQL Read Replicas
setup_read_replicas() {
    print_status "Setting up read replicas..."

    # Create read replica
    if gcloud sql instances describe "${DB_INSTANCE_NAME}-replica" 2>/dev/null; then
        print_warning "Read replica already exists"
    else
        gcloud sql instances create "${DB_INSTANCE_NAME}-replica" \
            --master-instance-name=$DB_INSTANCE_NAME \
            --tier=db-custom-1-2048 \
            --region=$REGION \
            --replica-type=READ \
            --availability-type=ZONAL
        print_success "Read replica created"
    fi
}

# Setup Cloud Memorystore for Redis
setup_redis() {
    print_status "Setting up Cloud Memorystore for Redis..."

    # Generate Redis auth string
    REDIS_AUTH=$(generate_password)

    # Create Redis instance
    if gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION 2>/dev/null; then
        print_warning "Redis instance already exists"
    else
        gcloud redis instances create $REDIS_INSTANCE_NAME \
            --size=1 \
            --region=$REGION \
            --tier=standard \
            --redis-version=redis_6_x \
            --auth-enabled \
            --redis-config maxmemory-policy=allkeys-lru \
            --display-name="Learning Platform Redis"
        print_success "Redis instance created"
    fi

    # Get Redis connection details
    REDIS_HOST=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(host)")
    REDIS_PORT=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(port)")

    # Store Redis URL in Secret Manager
    REDIS_URL="redis://:${REDIS_AUTH}@${REDIS_HOST}:${REDIS_PORT}"
    echo -n "$REDIS_URL" | gcloud secrets create redis-url --data-file=- || \
    echo -n "$REDIS_URL" | gcloud secrets versions add redis-url --data-file=-

    print_success "Redis setup completed"
}

# Setup Cloud Storage
setup_storage() {
    print_status "Setting up Cloud Storage..."

    # Create storage bucket
    if gsutil ls -b gs://$STORAGE_BUCKET_NAME 2>/dev/null; then
        print_warning "Storage bucket already exists"
    else
        gsutil mb -l $REGION gs://$STORAGE_BUCKET_NAME
        print_success "Storage bucket created"
    fi

    # Set bucket permissions
    gsutil iam ch allUsers:objectViewer gs://$STORAGE_BUCKET_NAME

    # Enable CORS for the bucket
    cat > cors.json << EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "responseHeader": ["Content-Type", "Access-Control-Allow-Origin"],
    "maxAgeSeconds": 3600
  }
]
EOF
    gsutil cors set cors.json gs://$STORAGE_BUCKET_NAME
    rm cors.json

    # Create lifecycle policy
    cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 365}
      }
    ]
  }
}
EOF
    gsutil lifecycle set lifecycle.json gs://$STORAGE_BUCKET_NAME
    rm lifecycle.json

    print_success "Storage setup completed"
}

# Setup Cloud CDN and Load Balancer
setup_cdn_lb() {
    print_status "Setting up Cloud CDN and Load Balancer..."

    # Create global static IP
    if gcloud compute addresses describe learning-platform-ip --global 2>/dev/null; then
        print_warning "Global IP already exists"
    else
        gcloud compute addresses create learning-platform-ip --global
        print_success "Global IP created"
    fi

    # Create SSL certificate
    if gcloud compute ssl-certificates describe learning-platform-ssl --global 2>/dev/null; then
        print_warning "SSL certificate already exists"
    else
        gcloud compute ssl-certificates create learning-platform-ssl \
            --domains=learning-platform.example.com \
            --global
        print_success "SSL certificate created"
    fi

    # Create backend service for Cloud Run
    if gcloud compute backend-services describe learning-platform-backend --global 2>/dev/null; then
        print_warning "Backend service already exists"
    else
        gcloud compute backend-services create learning-platform-backend \
            --protocol=HTTP \
            --port-name=http \
            --health-checks-region=$REGION \
            --global
        print_success "Backend service created"
    fi

    # Create URL map
    if gcloud compute url-maps describe learning-platform-lb --global 2>/dev/null; then
        print_warning "URL map already exists"
    else
        gcloud compute url-maps create learning-platform-lb \
            --default-backend-service=learning-platform-backend \
            --global
        print_success "URL map created"
    fi

    # Create target HTTPS proxy
    if gcloud compute target-https-proxies describe learning-platform-proxy --global 2>/dev/null; then
        print_warning "HTTPS proxy already exists"
    else
        gcloud compute target-https-proxies create learning-platform-proxy \
            --ssl-certificates=learning-platform-ssl \
            --url-map=learning-platform-lb \
            --global
        print_success "HTTPS proxy created"
    fi

    # Create forwarding rule
    if gcloud compute forwarding-rules describe learning-platform-rule --global 2>/dev/null; then
        print_warning "Forwarding rule already exists"
    else
        gcloud compute forwarding-rules create learning-platform-rule \
            --address=learning-platform-ip \
            --target-https-proxy=learning-platform-proxy \
            --ports=443 \
            --global
        print_success "Forwarding rule created"
    fi

    print_success "CDN and Load Balancer setup completed"
}

# Setup monitoring and logging
setup_monitoring() {
    print_status "Setting up monitoring and logging..."

    # Create notification channel
    gcloud alpha monitoring channels create \
        --display-name="Learning Platform Alerts" \
        --type=email \
        --channel-labels=email_address=admin@example.com \
        --enabled || true

    # Create uptime check
    gcloud alpha monitoring uptime create \
        --display-name="Learning Platform Uptime" \
        --http-check-path="/api/health" \
        --hostname="learning-platform.example.com" \
        --port=443 \
        --use-ssl || true

    print_success "Monitoring setup completed"
}

# Setup secrets
setup_secrets() {
    print_status "Setting up additional secrets..."

    # NextAuth secret
    NEXTAUTH_SECRET=$(generate_password)
    echo -n "$NEXTAUTH_SECRET" | gcloud secrets create nextauth-secret --data-file=- || \
    echo -n "$NEXTAUTH_SECRET" | gcloud secrets versions add nextauth-secret --data-file=-

    # JWT secret
    JWT_SECRET=$(generate_password)
    echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret --data-file=- || \
    echo -n "$JWT_SECRET" | gcloud secrets versions add jwt-secret --data-file=-

    print_success "Secrets setup completed"
}

# Setup IAM roles and service accounts
setup_iam() {
    print_status "Setting up IAM roles and service accounts..."

    # Create service account for Cloud Run
    if gcloud iam service-accounts describe learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com 2>/dev/null; then
        print_warning "Service account already exists"
    else
        gcloud iam service-accounts create learning-platform-sa \
            --display-name="Learning Platform Service Account"
        print_success "Service account created"
    fi

    # Grant necessary permissions
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com" \
        --role="roles/cloudsql.client"

    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor"

    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:learning-platform-sa@$PROJECT_ID.iam.gserviceaccount.com" \
        --role="roles/storage.objectAdmin"

    print_success "IAM setup completed"
}

# Main setup function
main() {
    print_status "Starting GCP services setup for Learning Platform..."

    # Check if gcloud is authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n 1; then
        print_error "Please authenticate with gcloud first: gcloud auth login"
        exit 1
    fi

    # Set project
    gcloud config set project $PROJECT_ID

    # Enable required APIs
    print_status "Enabling required APIs..."
    gcloud services enable cloudsql.googleapis.com
    gcloud services enable redis.googleapis.com
    gcloud services enable storage.googleapis.com
    gcloud services enable compute.googleapis.com
    gcloud services enable secretmanager.googleapis.com
    gcloud services enable monitoring.googleapis.com
    gcloud services enable logging.googleapis.com
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable run.googleapis.com

    # Run setup functions
    setup_secrets
    setup_iam
    setup_cloud_sql
    setup_read_replicas
    setup_redis
    setup_storage
    setup_cdn_lb
    setup_monitoring

    print_success "GCP services setup completed successfully!"

    echo ""
    echo "📋 Summary of created resources:"
    echo "- Cloud SQL instance: $DB_INSTANCE_NAME"
    echo "- Redis instance: $REDIS_INSTANCE_NAME"
    echo "- Storage bucket: $STORAGE_BUCKET_NAME"
    echo "- Global IP: learning-platform-ip"
    echo "- SSL certificate: learning-platform-ssl"
    echo ""
    echo "🔐 Secrets created in Secret Manager:"
    echo "- database-url"
    echo "- redis-url"
    echo "- nextauth-secret"
    echo "- jwt-secret"
    echo "- db-password"
    echo ""
    echo "Next step: Run ./scripts/deploy-gcp.sh to deploy the application"
}

# Run main function
main "$@"