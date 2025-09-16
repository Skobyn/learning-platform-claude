// Database Monitoring and Alerting System
// Provides comprehensive monitoring for database performance, slow queries, and system health

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

interface MonitoringConfig {
  slowQueryThresholdMs: number;
  connectionPoolWarningThreshold: number;
  connectionPoolCriticalThreshold: number;
  queryAnalysisWindowMinutes: number;
  alertingEnabled: boolean;
  metricsRetentionDays: number;
  webhookUrl?: string;
  emailAlerts?: string[];
}

interface DatabaseMetrics {
  connections: {
    active: number;
    idle: number;
    total: number;
    maxConnections: number;
    utilization: number;
  };
  queries: {
    totalCount: number;
    slowQueries: number;
    averageExecutionTime: number;
    queriesPerSecond: number;
    errorRate: number;
  };
  performance: {
    responseTime: {
      p50: number;
      p95: number;
      p99: number;
    };
    throughput: number;
    cacheHitRatio: number;
  };
  replication: {
    lag: number;
    healthy: boolean;
    lastCheck: Date;
  };
  storage: {
    totalSize: number;
    usedSize: number;
    utilization: number;
    indexSize: number;
  };
}

interface SlowQuery {
  query: string;
  executionTime: number;
  timestamp: Date;
  frequency: number;
  parameters?: any[];
  stackTrace?: string;
}

interface Alert {
  id: string;
  type: 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
  metadata?: any;
}

class DatabaseMonitor extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private config: MonitoringConfig;
  private metrics: DatabaseMetrics;
  private slowQueries: SlowQuery[] = [];
  private activeAlerts: Map<string, Alert> = new Map();
  private metricsHistory: DatabaseMetrics[] = [];
  private queryPatterns: Map<string, { count: number; totalTime: number; lastSeen: Date }> = new Map();

  constructor(
    prismaClient: PrismaClient,
    redisClient: Redis,
    config: Partial<MonitoringConfig> = {}
  ) {
    super();

    this.prisma = prismaClient;
    this.redis = redisClient;
    this.config = {
      slowQueryThresholdMs: 1000,
      connectionPoolWarningThreshold: 0.7,
      connectionPoolCriticalThreshold: 0.9,
      queryAnalysisWindowMinutes: 60,
      alertingEnabled: true,
      metricsRetentionDays: 7,
      ...config
    };

    this.metrics = this.initializeMetrics();
    this.startMonitoring();
  }

  private initializeMetrics(): DatabaseMetrics {
    return {
      connections: {
        active: 0,
        idle: 0,
        total: 0,
        maxConnections: 100,
        utilization: 0
      },
      queries: {
        totalCount: 0,
        slowQueries: 0,
        averageExecutionTime: 0,
        queriesPerSecond: 0,
        errorRate: 0
      },
      performance: {
        responseTime: { p50: 0, p95: 0, p99: 0 },
        throughput: 0,
        cacheHitRatio: 0
      },
      replication: {
        lag: 0,
        healthy: true,
        lastCheck: new Date()
      },
      storage: {
        totalSize: 0,
        usedSize: 0,
        utilization: 0,
        indexSize: 0
      }
    };
  }

  private startMonitoring(): void {
    // Collect metrics every 30 seconds
    setInterval(() => {
      this.collectMetrics().catch(error =>
        console.error('Failed to collect metrics:', error)
      );
    }, 30000);

    // Analyze queries every 5 minutes
    setInterval(() => {
      this.analyzeQueries().catch(error =>
        console.error('Failed to analyze queries:', error)
      );
    }, 300000);

    // Clean up old data every hour
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000);

    // Health check every minute
    setInterval(() => {
      this.performHealthCheck().catch(error =>
        console.error('Health check failed:', error)
      );
    }, 60000);
  }

  // Collect comprehensive database metrics
  private async collectMetrics(): Promise<void> {
    try {
      // Connection pool metrics
      await this.collectConnectionMetrics();

      // Query performance metrics
      await this.collectQueryMetrics();

      // Storage metrics
      await this.collectStorageMetrics();

      // Replication metrics
      await this.collectReplicationMetrics();

      // Update metrics history
      this.updateMetricsHistory();

      // Check for alerts
      this.checkAlertConditions();

      // Emit metrics event
      this.emit('metrics', this.metrics);

    } catch (error) {
      console.error('Failed to collect metrics:', error);
      this.createAlert('critical', 'Metrics Collection Failed', error.message);
    }
  }

  private async collectConnectionMetrics(): Promise<void> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
      `;

      if (result.length > 0) {
        const row = result[0];
        this.metrics.connections = {
          active: Number(row.active_connections) || 0,
          idle: Number(row.idle_connections) || 0,
          total: Number(row.total_connections) || 0,
          maxConnections: Number(row.max_connections) || 100,
          utilization: (Number(row.total_connections) || 0) / (Number(row.max_connections) || 100)
        };
      }
    } catch (error) {
      console.error('Failed to collect connection metrics:', error);
    }
  }

  private async collectQueryMetrics(): Promise<void> {
    try {
      // Get query statistics from pg_stat_statements if available
      const queryStats = await this.prisma.$queryRaw<any[]>`
        SELECT
          calls as total_queries,
          total_time / calls as avg_execution_time,
          calls / GREATEST(EXTRACT(epoch FROM (now() - stats_reset)), 1) as queries_per_second
        FROM pg_stat_statements_info
        WHERE stats_reset IS NOT NULL
      `.catch(() => []);

      if (queryStats.length > 0) {
        const stats = queryStats[0];
        this.metrics.queries.totalCount = Number(stats.total_queries) || 0;
        this.metrics.queries.averageExecutionTime = Number(stats.avg_execution_time) || 0;
        this.metrics.queries.queriesPerSecond = Number(stats.queries_per_second) || 0;
      }

      // Count slow queries from our tracking
      const recentSlowQueries = this.slowQueries.filter(
        query => query.timestamp > new Date(Date.now() - 3600000) // Last hour
      );
      this.metrics.queries.slowQueries = recentSlowQueries.length;

    } catch (error) {
      console.error('Failed to collect query metrics:', error);
    }
  }

  private async collectStorageMetrics(): Promise<void> {
    try {
      const storageStats = await this.prisma.$queryRaw<any[]>`
        SELECT
          pg_database_size(current_database()) as database_size,
          (SELECT sum(pg_relation_size(indexrelid)) FROM pg_index) as index_size,
          (SELECT sum(pg_total_relation_size(oid)) FROM pg_class WHERE relkind = 'r') as table_size
      `;

      if (storageStats.length > 0) {
        const stats = storageStats[0];
        this.metrics.storage = {
          totalSize: Number(stats.database_size) || 0,
          usedSize: Number(stats.table_size) || 0,
          utilization: ((Number(stats.table_size) || 0) / (Number(stats.database_size) || 1)),
          indexSize: Number(stats.index_size) || 0
        };
      }
    } catch (error) {
      console.error('Failed to collect storage metrics:', error);
    }
  }

  private async collectReplicationMetrics(): Promise<void> {
    try {
      // Check replication lag if replicas exist
      const replicationStats = await this.prisma.$queryRaw<any[]>`
        SELECT
          client_addr,
          state,
          EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag_seconds
        FROM pg_stat_replication
      `.catch(() => []);

      if (replicationStats.length > 0) {
        const maxLag = Math.max(...replicationStats.map(r => Number(r.lag_seconds) || 0));
        this.metrics.replication = {
          lag: maxLag,
          healthy: maxLag < 10, // Consider healthy if lag < 10 seconds
          lastCheck: new Date()
        };
      } else {
        // No replicas configured
        this.metrics.replication = {
          lag: 0,
          healthy: true,
          lastCheck: new Date()
        };
      }
    } catch (error) {
      console.error('Failed to collect replication metrics:', error);
    }
  }

  // Track slow queries
  public trackSlowQuery(query: string, executionTime: number, parameters?: any[]): void {
    if (executionTime < this.config.slowQueryThresholdMs) return;

    const slowQuery: SlowQuery = {
      query: this.sanitizeQuery(query),
      executionTime,
      timestamp: new Date(),
      frequency: 1,
      parameters
    };

    // Check if we've seen this query pattern before
    const existingIndex = this.slowQueries.findIndex(
      sq => sq.query === slowQuery.query
    );

    if (existingIndex >= 0) {
      this.slowQueries[existingIndex].frequency++;
      this.slowQueries[existingIndex].timestamp = new Date();
    } else {
      this.slowQueries.push(slowQuery);
    }

    // Keep only recent slow queries
    this.slowQueries = this.slowQueries.filter(
      sq => sq.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    // Create alert for very slow queries
    if (executionTime > this.config.slowQueryThresholdMs * 5) {
      this.createAlert(
        'warning',
        'Very Slow Query Detected',
        `Query executed in ${executionTime}ms: ${slowQuery.query.substring(0, 100)}...`
      );
    }

    this.emit('slowQuery', slowQuery);
  }

  // Analyze query patterns and suggest optimizations
  private async analyzeQueries(): Promise<void> {
    try {
      // Get most frequent slow queries
      const frequentSlowQueries = this.slowQueries
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10);

      // Update query patterns
      frequentSlowQueries.forEach(sq => {
        const pattern = this.extractQueryPattern(sq.query);
        const existing = this.queryPatterns.get(pattern) || {
          count: 0,
          totalTime: 0,
          lastSeen: new Date()
        };

        existing.count += sq.frequency;
        existing.totalTime += sq.executionTime * sq.frequency;
        existing.lastSeen = sq.timestamp;

        this.queryPatterns.set(pattern, existing);
      });

      // Generate optimization suggestions
      const suggestions = this.generateOptimizationSuggestions();
      if (suggestions.length > 0) {
        this.emit('optimizationSuggestions', suggestions);
      }

    } catch (error) {
      console.error('Query analysis failed:', error);
    }
  }

  private generateOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];

    // Analyze slow queries
    this.slowQueries.forEach(sq => {
      if (sq.frequency > 10) {
        suggestions.push(
          `Frequent slow query detected (${sq.frequency} times): Consider adding an index for: ${sq.query.substring(0, 100)}...`
        );
      }
    });

    // Analyze connection utilization
    if (this.metrics.connections.utilization > 0.8) {
      suggestions.push('High connection pool utilization detected. Consider increasing pool size or optimizing connection usage.');
    }

    // Analyze storage utilization
    if (this.metrics.storage.utilization > 0.8) {
      suggestions.push('High storage utilization detected. Consider archiving old data or increasing storage capacity.');
    }

    // Analyze replication lag
    if (this.metrics.replication.lag > 5) {
      suggestions.push('High replication lag detected. Check replica performance and network connectivity.');
    }

    return suggestions;
  }

  // Check for alert conditions
  private checkAlertConditions(): void {
    if (!this.config.alertingEnabled) return;

    // Connection pool alerts
    if (this.metrics.connections.utilization > this.config.connectionPoolCriticalThreshold) {
      this.createAlert(
        'critical',
        'Connection Pool Critical',
        `Connection pool utilization: ${(this.metrics.connections.utilization * 100).toFixed(1)}%`
      );
    } else if (this.metrics.connections.utilization > this.config.connectionPoolWarningThreshold) {
      this.createAlert(
        'warning',
        'Connection Pool Warning',
        `Connection pool utilization: ${(this.metrics.connections.utilization * 100).toFixed(1)}%`
      );
    }

    // Query performance alerts
    if (this.metrics.queries.averageExecutionTime > 500) {
      this.createAlert(
        'warning',
        'High Average Query Time',
        `Average query execution time: ${this.metrics.queries.averageExecutionTime.toFixed(2)}ms`
      );
    }

    // Storage alerts
    if (this.metrics.storage.utilization > 0.9) {
      this.createAlert(
        'critical',
        'Storage Critical',
        `Storage utilization: ${(this.metrics.storage.utilization * 100).toFixed(1)}%`
      );
    }

    // Replication alerts
    if (this.metrics.replication.lag > 30) {
      this.createAlert(
        'critical',
        'Replication Lag Critical',
        `Replication lag: ${this.metrics.replication.lag.toFixed(2)} seconds`
      );
    }
  }

  // Create and manage alerts
  private createAlert(type: Alert['type'], title: string, message: string, metadata?: any): void {
    const alertId = `${type}-${title.toLowerCase().replace(/\s+/g, '-')}`;

    // Check if alert already exists and is not resolved
    if (this.activeAlerts.has(alertId)) {
      const existingAlert = this.activeAlerts.get(alertId)!;
      if (!existingAlert.resolved) {
        return; // Don't duplicate active alerts
      }
    }

    const alert: Alert = {
      id: alertId,
      type,
      title,
      message,
      timestamp: new Date(),
      resolved: false,
      metadata
    };

    this.activeAlerts.set(alertId, alert);
    this.emit('alert', alert);

    // Send external notifications
    this.sendAlertNotification(alert).catch(error =>
      console.error('Failed to send alert notification:', error)
    );
  }

  private async sendAlertNotification(alert: Alert): Promise<void> {
    // Webhook notification
    if (this.config.webhookUrl) {
      try {
        const response = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'database_alert',
            alert,
            metrics: this.metrics
          })
        });

        if (!response.ok) {
          throw new Error(`Webhook failed: ${response.status}`);
        }
      } catch (error) {
        console.error('Webhook notification failed:', error);
      }
    }

    // Store alert in Redis for external consumption
    try {
      await this.redis.lpush(
        'db:alerts',
        JSON.stringify(alert)
      );
      await this.redis.ltrim('db:alerts', 0, 999); // Keep last 1000 alerts
    } catch (error) {
      console.error('Failed to store alert in Redis:', error);
    }
  }

  // Health check
  private async performHealthCheck(): Promise<void> {
    try {
      const startTime = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      // Update performance metrics
      this.updateResponseTimeMetrics(responseTime);

      // Check if database is responsive
      if (responseTime > 5000) {
        this.createAlert(
          'critical',
          'Database Unresponsive',
          `Health check took ${responseTime}ms`
        );
      }
    } catch (error) {
      this.createAlert(
        'critical',
        'Database Health Check Failed',
        error.message
      );
    }
  }

  private updateResponseTimeMetrics(responseTime: number): void {
    // Simple implementation - in production, use a proper percentile calculation
    const recent = this.metricsHistory.slice(-20);
    const responseTimes = recent
      .map(m => [m.performance.responseTime.p50, m.performance.responseTime.p95, m.performance.responseTime.p99])
      .flat()
      .filter(rt => rt > 0);

    responseTimes.push(responseTime);
    responseTimes.sort((a, b) => a - b);

    this.metrics.performance.responseTime = {
      p50: responseTimes[Math.floor(responseTimes.length * 0.5)] || responseTime,
      p95: responseTimes[Math.floor(responseTimes.length * 0.95)] || responseTime,
      p99: responseTimes[Math.floor(responseTimes.length * 0.99)] || responseTime
    };
  }

  private updateMetricsHistory(): void {
    this.metricsHistory.push({ ...this.metrics });

    // Keep only recent history
    const maxHistory = this.config.metricsRetentionDays * 24 * 2; // 2 entries per hour
    if (this.metricsHistory.length > maxHistory) {
      this.metricsHistory = this.metricsHistory.slice(-maxHistory);
    }
  }

  private cleanupOldData(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

    // Clean up slow queries
    this.slowQueries = this.slowQueries.filter(sq => sq.timestamp > cutoff);

    // Clean up resolved alerts
    for (const [id, alert] of this.activeAlerts) {
      if (alert.resolved && alert.timestamp < cutoff) {
        this.activeAlerts.delete(id);
      }
    }

    // Clean up old query patterns
    for (const [pattern, data] of this.queryPatterns) {
      if (data.lastSeen < cutoff) {
        this.queryPatterns.delete(pattern);
      }
    }
  }

  // Utility methods
  private sanitizeQuery(query: string): string {
    // Remove sensitive data and normalize query
    return query
      .replace(/\$\d+/g, '$?')  // Replace parameter placeholders
      .replace(/\b\d+\b/g, '?') // Replace numeric literals
      .replace(/'[^']*'/g, "'?'") // Replace string literals
      .trim();
  }

  private extractQueryPattern(query: string): string {
    // Extract the basic structure of the query for pattern matching
    return query
      .replace(/\bWHERE\s+.*/i, 'WHERE ...')
      .replace(/\bORDER\s+BY\s+.*/i, 'ORDER BY ...')
      .replace(/\bLIMIT\s+.*/i, 'LIMIT ...')
      .trim();
  }

  // Public API
  public getCurrentMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }

  public getMetricsHistory(hours: number = 24): DatabaseMetrics[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.metricsHistory.filter(m => new Date() > cutoff);
  }

  public getSlowQueries(limit: number = 50): SlowQuery[] {
    return this.slowQueries
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, limit);
  }

  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  public resolveAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      this.emit('alertResolved', alert);
      return true;
    }
    return false;
  }

  public async generateReport(): Promise<{
    summary: any;
    metrics: DatabaseMetrics;
    slowQueries: SlowQuery[];
    alerts: Alert[];
    suggestions: string[];
  }> {
    const suggestions = this.generateOptimizationSuggestions();

    return {
      summary: {
        reportTime: new Date(),
        overallHealth: this.calculateOverallHealth(),
        totalQueries: this.metrics.queries.totalCount,
        slowQueryCount: this.slowQueries.length,
        activeAlertCount: this.getActiveAlerts().length
      },
      metrics: this.getCurrentMetrics(),
      slowQueries: this.getSlowQueries(20),
      alerts: this.getActiveAlerts(),
      suggestions
    };
  }

  private calculateOverallHealth(): 'healthy' | 'warning' | 'critical' {
    const activeAlerts = this.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(a => a.type === 'critical');
    const warningAlerts = activeAlerts.filter(a => a.type === 'warning');

    if (criticalAlerts.length > 0) return 'critical';
    if (warningAlerts.length > 0) return 'warning';
    return 'healthy';
  }

  public async shutdown(): Promise<void> {
    // Clean up any resources, timers, etc.
    this.removeAllListeners();
  }
}

// Factory function
export function createDatabaseMonitor(
  prismaClient: PrismaClient,
  redisClient: Redis,
  config?: Partial<MonitoringConfig>
): DatabaseMonitor {
  return new DatabaseMonitor(prismaClient, redisClient, config);
}

export default DatabaseMonitor;