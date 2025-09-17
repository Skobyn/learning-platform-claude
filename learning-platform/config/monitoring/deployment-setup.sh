#!/bin/bash

# Learning Platform Monitoring Setup Script
# This script deploys monitoring configurations to Google Cloud Platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="${1:-$(gcloud config get-value project)}"
REGION="${2:-us-central1}"
SERVICE_NAME="learning-platform"
DOMAIN="${3:-your-domain.com}"

echo -e "${BLUE}Starting Learning Platform Monitoring Setup${NC}"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Domain: $DOMAIN"

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 > /dev/null; then
    echo -e "${RED}Error: Not authenticated with gcloud. Please run 'gcloud auth login'${NC}"
    exit 1
fi

# Set the project
gcloud config set project "$PROJECT_ID"

echo -e "${YELLOW}Step 1: Creating notification channels${NC}"

# Create email notification channel
EMAIL_CHANNEL=$(gcloud alpha monitoring channels create --display-name="Learning Platform Operations" \
    --type=email \
    --channel-labels=email_address=ops@learningplatform.com \
    --format="value(name)")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Email notification channel created: $EMAIL_CHANNEL${NC}"
else
    echo -e "${RED}✗ Failed to create email notification channel${NC}"
fi

# Create Slack notification channel (requires manual setup first)
# gcloud alpha monitoring channels create --display-name="Learning Platform Slack" \
#     --type=slack \
#     --channel-labels=channel_name="#learning-platform-alerts",team_domain="your-workspace"

echo -e "${YELLOW}Step 2: Creating uptime check${NC}"

# Create uptime check
UPTIME_CHECK=$(gcloud monitoring uptime create --display-name="Learning Platform Health Check" \
    --http-check-path="/api/health" \
    --hostname="$DOMAIN" \
    --port=443 \
    --use-ssl \
    --format="value(name)")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Uptime check created: $UPTIME_CHECK${NC}"
else
    echo -e "${RED}✗ Failed to create uptime check${NC}"
fi

echo -e "${YELLOW}Step 3: Creating alert policies${NC}"

# High Error Rate Alert
cat > /tmp/error-rate-policy.yaml << EOF
displayName: "Learning Platform - High Error Rate"
conditions:
- displayName: "Error rate above 5%"
  conditionThreshold:
    filter: 'resource.type="cloud_run_revision" resource.label.service_name="$SERVICE_NAME"'
    aggregations:
    - alignmentPeriod: 300s
      perSeriesAligner: ALIGN_RATE
      crossSeriesReducer: REDUCE_SUM
      groupByFields:
      - metric.label.response_code_class
    comparison: COMPARISON_GREATER_THAN
    thresholdValue: 0.05
    duration: 300s
    evaluationMissingData: EVALUATION_MISSING_DATA_INACTIVE
notificationChannels:
- "$EMAIL_CHANNEL"
combiner: OR
enabled: true
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/error-rate-policy.yaml
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Error rate alert policy created${NC}"
else
    echo -e "${RED}✗ Failed to create error rate alert policy${NC}"
fi

# High Latency Alert
cat > /tmp/latency-policy.yaml << EOF
displayName: "Learning Platform - High Latency"
conditions:
- displayName: "95th percentile latency above 2 seconds"
  conditionThreshold:
    filter: 'resource.type="cloud_run_revision" resource.label.service_name="$SERVICE_NAME" metric.type="run.googleapis.com/request_latencies"'
    aggregations:
    - alignmentPeriod: 300s
      perSeriesAligner: ALIGN_DELTA
      crossSeriesReducer: REDUCE_PERCENTILE_95
    comparison: COMPARISON_GREATER_THAN
    thresholdValue: 2000.0
    duration: 300s
notificationChannels:
- "$EMAIL_CHANNEL"
combiner: OR
enabled: true
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/latency-policy.yaml
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Latency alert policy created${NC}"
else
    echo -e "${RED}✗ Failed to create latency alert policy${NC}"
fi

# Memory Utilization Alert
cat > /tmp/memory-policy.yaml << EOF
displayName: "Learning Platform - High Memory Utilization"
conditions:
- displayName: "Memory utilization above 85%"
  conditionThreshold:
    filter: 'resource.type="cloud_run_revision" resource.label.service_name="$SERVICE_NAME" metric.type="run.googleapis.com/container/memory/utilizations"'
    aggregations:
    - alignmentPeriod: 300s
      perSeriesAligner: ALIGN_MEAN
      crossSeriesReducer: REDUCE_MEAN
    comparison: COMPARISON_GREATER_THAN
    thresholdValue: 0.85
    duration: 300s
notificationChannels:
- "$EMAIL_CHANNEL"
combiner: OR
enabled: true
EOF

gcloud alpha monitoring policies create --policy-from-file=/tmp/memory-policy.yaml
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Memory utilization alert policy created${NC}"
else
    echo -e "${RED}✗ Failed to create memory utilization alert policy${NC}"
fi

echo -e "${YELLOW}Step 4: Creating log-based metrics${NC}"

# User Login Metric
gcloud logging metrics create learning_platform_user_logins \
    --description="Count of successful user login events" \
    --log-filter='resource.type="cloud_run_revision" jsonPayload.event="user_login" jsonPayload.status="success"' \
    --value-extractor='EXTRACT(jsonPayload.user_id)'

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ User login metric created${NC}"
else
    echo -e "${YELLOW}⚠ User login metric may already exist${NC}"
fi

# Course Completion Metric
gcloud logging metrics create learning_platform_course_completions \
    --description="Count of course completion events" \
    --log-filter='resource.type="cloud_run_revision" jsonPayload.event="course_completed"' \
    --value-extractor='EXTRACT(jsonPayload.course_id)'

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Course completion metric created${NC}"
else
    echo -e "${YELLOW}⚠ Course completion metric may already exist${NC}"
fi

# API Error Metric
gcloud logging metrics create learning_platform_api_errors \
    --description="Count of API error responses" \
    --log-filter='resource.type="cloud_run_revision" httpRequest.status>=400'

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ API error metric created${NC}"
else
    echo -e "${YELLOW}⚠ API error metric may already exist${NC}"
fi

echo -e "${YELLOW}Step 5: Creating log sinks${NC}"

# Error Log Sink to BigQuery
bq mk --dataset --location=US --description="Learning Platform Error Logs" \
    "$PROJECT_ID:learning_platform_logs" 2>/dev/null || echo "Dataset may already exist"

gcloud logging sinks create learning-platform-errors \
    bigquery.googleapis.com/projects/"$PROJECT_ID"/datasets/learning_platform_logs \
    --log-filter='resource.type="cloud_run_revision" (severity="ERROR" OR severity="CRITICAL" OR httpRequest.status>=400)' \
    --include-children

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Error log sink created${NC}"
else
    echo -e "${YELLOW}⚠ Error log sink may already exist${NC}"
fi

# Audit Log Sink to Cloud Storage
gsutil mb -p "$PROJECT_ID" -c STANDARD -l US gs://learning-platform-audit-logs-"$PROJECT_ID" 2>/dev/null || echo "Bucket may already exist"

gcloud logging sinks create learning-platform-audit \
    storage.googleapis.com/learning-platform-audit-logs-"$PROJECT_ID" \
    --log-filter='resource.type="cloud_run_revision" (jsonPayload.event="user_login" OR jsonPayload.event="course_completed" OR jsonPayload.event="admin_action")' \
    --include-children

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Audit log sink created${NC}"
else
    echo -e "${YELLOW}⚠ Audit log sink may already exist${NC}"
fi

echo -e "${YELLOW}Step 6: Setting up custom dashboards${NC}"

# Create custom dashboard
cat > /tmp/dashboard.json << EOF
{
  "displayName": "Learning Platform - Operations Dashboard",
  "mosaicLayout": {
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Request Rate",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.label.service_name=\"$SERVICE_NAME\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }]
          }
        }
      }
    ]
  }
}
EOF

gcloud monitoring dashboards create --config-from-file=/tmp/dashboard.json
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Custom dashboard created${NC}"
else
    echo -e "${RED}✗ Failed to create custom dashboard${NC}"
fi

echo -e "${YELLOW}Step 7: Configuring Application Performance Monitoring${NC}"

# Enable Cloud Trace API
gcloud services enable cloudtrace.googleapis.com
echo -e "${GREEN}✓ Cloud Trace API enabled${NC}"

# Enable Cloud Profiler API
gcloud services enable cloudprofiler.googleapis.com
echo -e "${GREEN}✓ Cloud Profiler API enabled${NC}"

# Enable Cloud Debugger API
gcloud services enable clouddebugger.googleapis.com
echo -e "${GREEN}✓ Cloud Debugger API enabled${NC}"

echo -e "${YELLOW}Step 8: Setting up synthetic monitoring (manual setup required)${NC}"

echo "To complete synthetic monitoring setup:"
echo "1. Go to Cloud Console > Monitoring > Uptime checks"
echo "2. Configure additional synthetic monitoring for critical user journeys"
echo "3. Set up browser-based uptime checks for login flow"
echo "4. Configure API monitoring for key endpoints"

echo -e "${YELLOW}Step 9: Clean up temporary files${NC}"
rm -f /tmp/error-rate-policy.yaml /tmp/latency-policy.yaml /tmp/memory-policy.yaml /tmp/dashboard.json

echo -e "${GREEN}✅ Monitoring setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Update notification channels with your actual email addresses and Slack webhooks"
echo "2. Configure Google Analytics 4 for user behavior tracking"
echo "3. Set up custom application instrumentation using the monitoring configurations"
echo "4. Test alert policies by triggering test conditions"
echo "5. Customize dashboards based on your specific monitoring needs"
echo ""
echo "Monitoring URLs:"
echo "- Cloud Monitoring: https://console.cloud.google.com/monitoring/overview?project=$PROJECT_ID"
echo "- Uptime Checks: https://console.cloud.google.com/monitoring/uptime?project=$PROJECT_ID"
echo "- Alert Policies: https://console.cloud.google.com/monitoring/alerting/policies?project=$PROJECT_ID"
echo "- Dashboards: https://console.cloud.google.com/monitoring/dashboards?project=$PROJECT_ID"