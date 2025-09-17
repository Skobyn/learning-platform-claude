# Learning Platform Monitoring Configuration

## Overview

This directory contains comprehensive monitoring and observability configurations for the Learning Platform. The monitoring setup includes dashboards, alerts, analytics, performance monitoring, and automated deployment scripts.

## Directory Structure

```
monitoring/
├── dashboards/
│   └── cloud-run-dashboard.json          # Cloud Run service dashboard
├── alerts/
│   ├── error-rate-policy.json           # High error rate alerts
│   ├── latency-policy.json              # High latency alerts
│   ├── uptime-check.json                # Service uptime monitoring
│   ├── resource-alerts.json             # CPU/Memory utilization alerts
│   └── notification-channels.json       # Email/Slack/PagerDuty channels
├── logs/
│   └── log-based-metrics.json           # Custom log-based metrics & sinks
├── analytics/
│   ├── google-analytics-config.json     # GA4 configuration
│   └── learning-analytics-dashboard.json # Business analytics dashboard
├── performance-monitoring.json          # APM, RUM, synthetic monitoring
├── deployment-setup.sh                 # Automated deployment script
├── monitoring-best-practices.md        # Best practices documentation
└── README.md                          # This file
```

## Key Features

### 🎯 Dashboards
- **Cloud Run Dashboard**: Comprehensive monitoring of Cloud Run service metrics
- **Learning Analytics Dashboard**: Business and learning metrics visualization

### 🚨 Alerting
- **Error Rate Monitoring**: Alerts when error rate exceeds 5%
- **Latency Monitoring**: Alerts when 95th percentile exceeds 2 seconds
- **Resource Monitoring**: CPU/Memory utilization alerts
- **Uptime Checks**: Service availability monitoring
- **Multi-channel Notifications**: Email, Slack, PagerDuty integration

### 📊 Analytics
- **Google Analytics 4**: User behavior and conversion tracking
- **Custom Events**: Learning-specific event tracking
- **Business Metrics**: Revenue, engagement, and completion tracking

### 📈 Performance Monitoring
- **Application Performance Monitoring (APM)**: Distributed tracing
- **Real User Monitoring (RUM)**: Core Web Vitals tracking
- **Synthetic Monitoring**: Automated critical path testing
- **SLA Monitoring**: 99.9% availability tracking

### 📝 Logging
- **Structured Logging**: JSON-formatted logs with correlation IDs
- **Log-based Metrics**: Custom metrics from log data
- **Log Sinks**: BigQuery and Cloud Storage exports
- **Retention Policies**: Compliance-aware retention

## Quick Setup

### 1. Automated Deployment
```bash
# Run the automated setup script
cd /home/sbenson/learning-platform/config/monitoring
./deployment-setup.sh [PROJECT_ID] [REGION] [DOMAIN]
```

### 2. Manual Configuration Steps

#### Enable Required APIs
```bash
gcloud services enable monitoring.googleapis.com
gcloud services enable logging.googleapis.com
gcloud services enable cloudtrace.googleapis.com
gcloud services enable cloudprofiler.googleapis.com
```

#### Create Notification Channels
```bash
# Email channel
gcloud alpha monitoring channels create \
  --display-name="Ops Team" \
  --type=email \
  --channel-labels=email_address=ops@yourcompany.com

# Slack channel (requires webhook setup)
gcloud alpha monitoring channels create \
  --display-name="Engineering Slack" \
  --type=slack \
  --channel-labels=url=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

#### Deploy Dashboards
```bash
# Cloud Run dashboard
gcloud monitoring dashboards create \
  --config-from-file=dashboards/cloud-run-dashboard.json
```

#### Create Alert Policies
```bash
# Error rate alerts
gcloud alpha monitoring policies create \
  --policy-from-file=alerts/error-rate-policy.json

# Latency alerts
gcloud alpha monitoring policies create \
  --policy-from-file=alerts/latency-policy.json
```

## Monitoring Checklist

### Pre-Deployment
- [ ] Update PROJECT_ID placeholders in configuration files
- [ ] Set up notification channels (email, Slack, PagerDuty)
- [ ] Configure Google Analytics 4 measurement ID
- [ ] Review alert thresholds for your environment
- [ ] Set up log retention policies

### Post-Deployment
- [ ] Test alert policies with synthetic failures
- [ ] Verify dashboard metrics are populating
- [ ] Validate log-based metrics are working
- [ ] Configure synthetic monitoring tests
- [ ] Set up automated reports and summaries

### Ongoing Maintenance
- [ ] Weekly alert noise review
- [ ] Monthly SLA compliance review
- [ ] Quarterly monitoring strategy assessment
- [ ] Regular cost optimization review

## Key Metrics to Monitor

### Golden Signals
1. **Latency**: 95th percentile response time < 2 seconds
2. **Traffic**: Requests per minute trending
3. **Errors**: Error rate < 1%
4. **Saturation**: CPU < 80%, Memory < 85%

### Business Metrics
1. **User Engagement**: Daily/Monthly active users
2. **Learning Progress**: Course completion rates
3. **Revenue**: Conversion and subscription metrics
4. **Content Performance**: Popular courses and dropout points

### Technical Metrics
1. **Infrastructure**: Resource utilization and scaling
2. **Database**: Query performance and connection pooling
3. **Cache**: Hit/miss ratios and performance
4. **Security**: Failed authentication and suspicious activity

## Integration Points

### Applications
- Instrument code with structured logging
- Add custom metrics for business events
- Implement distributed tracing
- Configure error reporting

### CI/CD Pipeline
- Monitor deployment success/failure rates
- Track performance impact of releases
- Automated rollback triggers
- Performance regression detection

### External Services
- Monitor third-party API dependencies
- Track payment processor health
- Content delivery network performance
- Email service delivery rates

## Troubleshooting

### Common Issues

#### No Data in Dashboards
- Check service account permissions
- Verify API is enabled for the project
- Confirm metric names match service labels
- Check time range selection

#### Alerts Not Firing
- Verify notification channels are correctly configured
- Check alert policy conditions and thresholds
- Confirm alerting API is enabled
- Test with manual threshold breaches

#### High Monitoring Costs
- Review metric ingestion volume
- Optimize log retention policies
- Use intelligent sampling for high-volume metrics
- Implement cost budgets and alerts

### Support Resources
- [Cloud Monitoring Documentation](https://cloud.google.com/monitoring/docs)
- [Best Practices Guide](monitoring-best-practices.md)
- Internal monitoring team: monitoring@yourcompany.com
- Emergency escalation: oncall@yourcompany.com

## Security Considerations

### Data Privacy
- Ensure PII is not logged in monitoring data
- Implement data retention policies
- Use secure channels for alert notifications
- Regular access review for monitoring systems

### Access Control
- Principle of least privilege for monitoring access
- Separate monitoring service accounts
- Regular rotation of API keys and tokens
- Audit monitoring configuration changes

---

**Last Updated**: 2024-09-12  
**Maintained By**: Monitoring Specialist Agent  
**Next Review**: 2024-12-12