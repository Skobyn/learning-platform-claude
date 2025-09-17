/**
 * Performance Monitoring and Auto-scaling Logic
 * Monitors application metrics and triggers scaling decisions
 */

const { Monitoring } = require('@google-cloud/monitoring');
const { AutoScaler } = require('@google-cloud/compute');
const { PubSub } = require('@google-cloud/pubsub');

class PerformanceMonitor {
  constructor() {
    this.monitoring = new Monitoring.MetricServiceClient();
    this.pubsub = new PubSub();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT;
    
    // Scaling thresholds
    this.thresholds = {
      cpu: {
        scaleUp: 70,    // Scale up when CPU > 70%
        scaleDown: 30,  // Scale down when CPU < 30%
      },
      memory: {
        scaleUp: 80,    // Scale up when memory > 80%
        scaleDown: 40,  // Scale down when memory < 40%
      },
      responseTime: {
        scaleUp: 500,   // Scale up when avg response time > 500ms
        scaleDown: 200, // Scale down when avg response time < 200ms
      },
      requestRate: {
        scaleUp: 100,   // Scale up when requests/sec > 100
        scaleDown: 20,  // Scale down when requests/sec < 20
      },
      errorRate: {
        scaleUp: 5,     // Scale up when error rate > 5%
        alert: 10,      // Send alert when error rate > 10%
      }
    };
    
    // Current scaling state
    this.scalingState = {
      lastScaleAction: null,
      lastScaleTime: null,
      cooldownPeriod: 5 * 60 * 1000, // 5 minutes
      currentReplicas: 2,
      minReplicas: 2,
      maxReplicas: 50,
    };
    
    // Metrics buffer for trend analysis
    this.metricsBuffer = {
      cpu: [],
      memory: [],
      responseTime: [],
      requestRate: [],
      errorRate: [],
    };
    
    this.bufferSize = 10; // Keep last 10 data points
  }

  /**
   * Start monitoring and auto-scaling
   */
  async start() {
    console.log('Starting performance monitor...');
    
    // Collect metrics every 30 seconds
    setInterval(async () => {
      await this.collectMetrics();
      await this.analyzeAndScale();
    }, 30000);
    
    // Clean old metrics every 5 minutes
    setInterval(() => {
      this.cleanOldMetrics();
    }, 5 * 60 * 1000);
    
    // Generate performance reports every hour
    setInterval(async () => {
      await this.generatePerformanceReport();
    }, 60 * 60 * 1000);
  }

  /**
   * Collect various performance metrics
   */
  async collectMetrics() {
    try {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      // Collect metrics from Google Cloud Monitoring
      const metrics = await Promise.all([
        this.getCpuUtilization(fiveMinutesAgo, now),
        this.getMemoryUtilization(fiveMinutesAgo, now),
        this.getResponseTime(fiveMinutesAgo, now),
        this.getRequestRate(fiveMinutesAgo, now),
        this.getErrorRate(fiveMinutesAgo, now),
      ]);

      // Store metrics in buffer
      this.addToBuffer('cpu', metrics[0]);
      this.addToBuffer('memory', metrics[1]);
      this.addToBuffer('responseTime', metrics[2]);
      this.addToBuffer('requestRate', metrics[3]);
      this.addToBuffer('errorRate', metrics[4]);

      console.log('Metrics collected:', {
        cpu: `${metrics[0].toFixed(1)}%`,
        memory: `${metrics[1].toFixed(1)}%`,
        responseTime: `${metrics[2].toFixed(0)}ms`,
        requestRate: `${metrics[3].toFixed(1)}/sec`,
        errorRate: `${metrics[4].toFixed(2)}%`,
      });

    } catch (error) {
      console.error('Failed to collect metrics:', error);
    }
  }

  /**
   * Analyze metrics and make scaling decisions
   */
  async analyzeAndScale() {
    try {
      const decision = this.makeScalingDecision();
      
      if (decision.action && this.canScale()) {
        await this.executeScalingDecision(decision);
      }
      
      // Check for alerts
      await this.checkAlerts();
      
    } catch (error) {
      console.error('Failed to analyze and scale:', error);
    }
  }

  /**
   * Make scaling decision based on current metrics
   */
  makeScalingDecision() {
    const latest = this.getLatestMetrics();
    const trends = this.calculateTrends();
    
    let scaleUpReasons = [];
    let scaleDownReasons = [];
    
    // CPU-based scaling
    if (latest.cpu > this.thresholds.cpu.scaleUp) {
      scaleUpReasons.push(`High CPU: ${latest.cpu.toFixed(1)}%`);
    } else if (latest.cpu < this.thresholds.cpu.scaleDown && trends.cpu < 0) {
      scaleDownReasons.push(`Low CPU: ${latest.cpu.toFixed(1)}%`);
    }
    
    // Memory-based scaling
    if (latest.memory > this.thresholds.memory.scaleUp) {
      scaleUpReasons.push(`High Memory: ${latest.memory.toFixed(1)}%`);
    } else if (latest.memory < this.thresholds.memory.scaleDown && trends.memory < 0) {
      scaleDownReasons.push(`Low Memory: ${latest.memory.toFixed(1)}%`);
    }
    
    // Response time-based scaling
    if (latest.responseTime > this.thresholds.responseTime.scaleUp) {
      scaleUpReasons.push(`High Response Time: ${latest.responseTime.toFixed(0)}ms`);
    } else if (latest.responseTime < this.thresholds.responseTime.scaleDown && trends.responseTime < 0) {
      scaleDownReasons.push(`Low Response Time: ${latest.responseTime.toFixed(0)}ms`);
    }
    
    // Request rate-based scaling
    if (latest.requestRate > this.thresholds.requestRate.scaleUp) {
      scaleUpReasons.push(`High Request Rate: ${latest.requestRate.toFixed(1)}/sec`);
    } else if (latest.requestRate < this.thresholds.requestRate.scaleDown && trends.requestRate < 0) {
      scaleDownReasons.push(`Low Request Rate: ${latest.requestRate.toFixed(1)}/sec`);
    }
    
    // Error rate-based scaling
    if (latest.errorRate > this.thresholds.errorRate.scaleUp) {
      scaleUpReasons.push(`High Error Rate: ${latest.errorRate.toFixed(2)}%`);
    }
    
    // Make decision
    let action = null;
    let reasons = [];
    
    if (scaleUpReasons.length >= 2) {
      action = 'scale-up';
      reasons = scaleUpReasons;
    } else if (scaleDownReasons.length >= 3 && scaleUpReasons.length === 0) {
      action = 'scale-down';
      reasons = scaleDownReasons;
    }
    
    return { action, reasons, metrics: latest };
  }

  /**
   * Execute scaling decision
   */
  async executeScalingDecision(decision) {
    try {
      let targetReplicas = this.scalingState.currentReplicas;
      
      if (decision.action === 'scale-up') {
        // Scale up by 50% or minimum 2 pods
        const increment = Math.max(2, Math.ceil(this.scalingState.currentReplicas * 0.5));
        targetReplicas = Math.min(
          this.scalingState.maxReplicas,
          this.scalingState.currentReplicas + increment
        );
      } else if (decision.action === 'scale-down') {
        // Scale down by 25% or minimum 1 pod
        const decrement = Math.max(1, Math.ceil(this.scalingState.currentReplicas * 0.25));
        targetReplicas = Math.max(
          this.scalingState.minReplicas,
          this.scalingState.currentReplicas - decrement
        );
      }
      
      if (targetReplicas !== this.scalingState.currentReplicas) {
        console.log(`Scaling ${decision.action}: ${this.scalingState.currentReplicas} → ${targetReplicas}`);
        console.log(`Reasons: ${decision.reasons.join(', ')}`);
        
        // Execute scaling via Cloud Run API or Kubernetes HPA
        await this.scaleCloudRunService(targetReplicas);
        
        // Update state
        this.scalingState.lastScaleAction = decision.action;
        this.scalingState.lastScaleTime = new Date();
        this.scalingState.currentReplicas = targetReplicas;
        
        // Publish scaling event
        await this.publishScalingEvent(decision, targetReplicas);
      }
      
    } catch (error) {
      console.error('Failed to execute scaling decision:', error);
    }
  }

  /**
   * Check if scaling is allowed (cooldown period)
   */
  canScale() {
    if (!this.scalingState.lastScaleTime) return true;
    
    const timeSinceLastScale = Date.now() - this.scalingState.lastScaleTime.getTime();
    return timeSinceLastScale >= this.scalingState.cooldownPeriod;
  }

  /**
   * Scale Cloud Run service
   */
  async scaleCloudRunService(targetReplicas) {
    // This would integrate with Cloud Run Admin API
    // For now, we'll log the scaling action
    console.log(`Would scale Cloud Run service to ${targetReplicas} instances`);
    
    // In a real implementation:
    // const run = new CloudRunClient();
    // await run.updateService({
    //   service: 'learning-platform',
    //   updateMask: { paths: ['spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]'] },
    //   service: {
    //     spec: {
    //       template: {
    //         metadata: {
    //           annotations: {
    //             'autoscaling.knative.dev/minScale': Math.max(2, Math.floor(targetReplicas * 0.5)).toString(),
    //             'autoscaling.knative.dev/maxScale': targetReplicas.toString(),
    //           }
    //         }
    //       }
    //     }
    //   }
    // });
  }

  /**
   * Get CPU utilization metric
   */
  async getCpuUtilization(startTime, endTime) {
    const request = {
      name: `projects/${this.projectId}`,
      filter: 'resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/container/cpu/utilizations"',
      interval: {
        startTime: { seconds: startTime.getTime() / 1000 },
        endTime: { seconds: endTime.getTime() / 1000 },
      },
    };

    try {
      const [timeSeries] = await this.monitoring.listTimeSeries(request);
      
      if (timeSeries.length > 0) {
        const values = timeSeries[0].points.map(point => point.value.doubleValue * 100);
        return values.reduce((sum, val) => sum + val, 0) / values.length;
      }
    } catch (error) {
      console.error('Failed to get CPU utilization:', error);
    }
    
    return 50; // Default value
  }

  /**
   * Get memory utilization metric
   */
  async getMemoryUtilization(startTime, endTime) {
    const request = {
      name: `projects/${this.projectId}`,
      filter: 'resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/container/memory/utilizations"',
      interval: {
        startTime: { seconds: startTime.getTime() / 1000 },
        endTime: { seconds: endTime.getTime() / 1000 },
      },
    };

    try {
      const [timeSeries] = await this.monitoring.listTimeSeries(request);
      
      if (timeSeries.length > 0) {
        const values = timeSeries[0].points.map(point => point.value.doubleValue * 100);
        return values.reduce((sum, val) => sum + val, 0) / values.length;
      }
    } catch (error) {
      console.error('Failed to get memory utilization:', error);
    }
    
    return 60; // Default value
  }

  /**
   * Get average response time
   */
  async getResponseTime(startTime, endTime) {
    const request = {
      name: `projects/${this.projectId}`,
      filter: 'resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/request_latencies"',
      interval: {
        startTime: { seconds: startTime.getTime() / 1000 },
        endTime: { seconds: endTime.getTime() / 1000 },
      },
    };

    try {
      const [timeSeries] = await this.monitoring.listTimeSeries(request);
      
      if (timeSeries.length > 0) {
        const values = timeSeries[0].points.map(point => point.value.distributionValue.mean);
        return values.reduce((sum, val) => sum + val, 0) / values.length;
      }
    } catch (error) {
      console.error('Failed to get response time:', error);
    }
    
    return 250; // Default value
  }

  /**
   * Get request rate
   */
  async getRequestRate(startTime, endTime) {
    const request = {
      name: `projects/${this.projectId}`,
      filter: 'resource.type="cloud_run_revision" AND metric.type="run.googleapis.com/request_count"',
      interval: {
        startTime: { seconds: startTime.getTime() / 1000 },
        endTime: { seconds: endTime.getTime() / 1000 },
      },
    };

    try {
      const [timeSeries] = await this.monitoring.listTimeSeries(request);
      
      if (timeSeries.length > 0) {
        const totalRequests = timeSeries[0].points.reduce(
          (sum, point) => sum + point.value.int64Value, 0
        );
        const timeRange = (endTime.getTime() - startTime.getTime()) / 1000;
        return totalRequests / timeRange;
      }
    } catch (error) {
      console.error('Failed to get request rate:', error);
    }
    
    return 50; // Default value
  }

  /**
   * Get error rate
   */
  async getErrorRate(startTime, endTime) {
    try {
      const [errorCount, totalCount] = await Promise.all([
        this.getErrorCount(startTime, endTime),
        this.getTotalRequestCount(startTime, endTime),
      ]);
      
      return totalCount > 0 ? (errorCount / totalCount) * 100 : 0;
    } catch (error) {
      console.error('Failed to get error rate:', error);
      return 2; // Default value
    }
  }

  /**
   * Helper methods for metric buffer management
   */
  addToBuffer(metricName, value) {
    this.metricsBuffer[metricName].push({
      value,
      timestamp: new Date(),
    });
    
    // Keep only last N values
    if (this.metricsBuffer[metricName].length > this.bufferSize) {
      this.metricsBuffer[metricName].shift();
    }
  }

  getLatestMetrics() {
    return {
      cpu: this.getLatestValue('cpu'),
      memory: this.getLatestValue('memory'),
      responseTime: this.getLatestValue('responseTime'),
      requestRate: this.getLatestValue('requestRate'),
      errorRate: this.getLatestValue('errorRate'),
    };
  }

  getLatestValue(metricName) {
    const buffer = this.metricsBuffer[metricName];
    return buffer.length > 0 ? buffer[buffer.length - 1].value : 0;
  }

  calculateTrends() {
    return {
      cpu: this.calculateTrend('cpu'),
      memory: this.calculateTrend('memory'),
      responseTime: this.calculateTrend('responseTime'),
      requestRate: this.calculateTrend('requestRate'),
      errorRate: this.calculateTrend('errorRate'),
    };
  }

  calculateTrend(metricName) {
    const buffer = this.metricsBuffer[metricName];
    if (buffer.length < 3) return 0;
    
    const recent = buffer.slice(-3).map(item => item.value);
    const older = buffer.slice(0, 3).map(item => item.value);
    
    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;
    
    return recentAvg - olderAvg; // Positive = trending up, Negative = trending down
  }

  /**
   * Check for alert conditions
   */
  async checkAlerts() {
    const latest = this.getLatestMetrics();
    
    // High error rate alert
    if (latest.errorRate > this.thresholds.errorRate.alert) {
      await this.sendAlert('high-error-rate', {
        errorRate: latest.errorRate,
        threshold: this.thresholds.errorRate.alert,
      });
    }
    
    // Response time degradation alert
    if (latest.responseTime > 1000) {
      await this.sendAlert('high-response-time', {
        responseTime: latest.responseTime,
        threshold: 1000,
      });
    }
    
    // Resource exhaustion warning
    if (latest.cpu > 90 || latest.memory > 90) {
      await this.sendAlert('resource-exhaustion', {
        cpu: latest.cpu,
        memory: latest.memory,
      });
    }
  }

  /**
   * Send alert notification
   */
  async sendAlert(alertType, data) {
    try {
      const topic = this.pubsub.topic('monitoring-alerts');
      
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify({
          alertType,
          data,
          timestamp: new Date().toISOString(),
          service: 'learning-platform',
        })),
        attributes: {
          alertType,
          severity: this.getAlertSeverity(alertType),
        },
      });
      
      console.log(`Alert sent: ${alertType}`, data);
    } catch (error) {
      console.error('Failed to send alert:', error);
    }
  }

  getAlertSeverity(alertType) {
    const severities = {
      'high-error-rate': 'critical',
      'high-response-time': 'warning',
      'resource-exhaustion': 'critical',
    };
    
    return severities[alertType] || 'info';
  }

  /**
   * Publish scaling event for audit trail
   */
  async publishScalingEvent(decision, targetReplicas) {
    try {
      const topic = this.pubsub.topic('scaling-events');
      
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify({
          action: decision.action,
          reasons: decision.reasons,
          metrics: decision.metrics,
          previousReplicas: this.scalingState.currentReplicas,
          targetReplicas,
          timestamp: new Date().toISOString(),
        })),
        attributes: {
          action: decision.action,
          service: 'learning-platform',
        },
      });
    } catch (error) {
      console.error('Failed to publish scaling event:', error);
    }
  }

  /**
   * Generate periodic performance report
   */
  async generatePerformanceReport() {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        currentMetrics: this.getLatestMetrics(),
        trends: this.calculateTrends(),
        scalingState: this.scalingState,
        bufferStats: this.getBufferStats(),
      };
      
      console.log('Performance Report:', JSON.stringify(report, null, 2));
      
      // Store report for later analysis
      const topic = this.pubsub.topic('performance-reports');
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify(report)),
        attributes: {
          reportType: 'hourly',
          service: 'learning-platform',
        },
      });
      
    } catch (error) {
      console.error('Failed to generate performance report:', error);
    }
  }

  getBufferStats() {
    const stats = {};
    
    Object.keys(this.metricsBuffer).forEach(metricName => {
      const buffer = this.metricsBuffer[metricName];
      const values = buffer.map(item => item.value);
      
      if (values.length > 0) {
        stats[metricName] = {
          count: values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, val) => sum + val, 0) / values.length,
        };
      }
    });
    
    return stats;
  }

  /**
   * Clean old metrics from buffer
   */
  cleanOldMetrics() {
    const cutoffTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    
    Object.keys(this.metricsBuffer).forEach(metricName => {
      this.metricsBuffer[metricName] = this.metricsBuffer[metricName].filter(
        item => item.timestamp > cutoffTime
      );
    });
  }
}

module.exports = PerformanceMonitor;