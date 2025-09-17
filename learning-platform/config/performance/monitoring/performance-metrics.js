/**
 * Performance Monitoring Configuration
 * Comprehensive metrics collection for Learning Platform
 */

const { performance, PerformanceObserver } = require('perf_hooks');
const { connectionManager } = require('../database/connection-pooling');

/**
 * Performance Metrics Collector
 */
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        responseTime: {
          min: Infinity,
          max: 0,
          avg: 0,
          p95: 0,
          p99: 0
        }
      },
      database: {
        queries: {
          total: 0,
          slow: 0,
          failed: 0,
          avgExecutionTime: 0
        },
        connections: {
          active: 0,
          idle: 0,
          waiting: 0
        }
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRatio: 0,
        evictions: 0
      },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0
      },
      cpu: {
        usage: 0,
        load: [0, 0, 0]
      },
      gc: {
        collections: 0,
        duration: 0,
        freed: 0
      }
    };
    
    this.responseTimes = [];
    this.queryTimes = [];
    this.startTime = Date.now();
    
    this.initializeMonitoring();
  }

  /**
   * Initialize performance monitoring
   */
  initializeMonitoring() {
    // Monitor HTTP requests
    this.setupRequestMonitoring();
    
    // Monitor database queries
    this.setupDatabaseMonitoring();
    
    // Monitor system resources
    this.setupSystemMonitoring();
    
    // Monitor garbage collection
    this.setupGCMonitoring();
    
    // Setup periodic reporting
    this.setupPeriodicReporting();
  }

  /**
   * Setup HTTP request monitoring
   */
  setupRequestMonitoring() {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes('http-request')) {
          this.recordRequest(entry.duration, entry.detail?.statusCode);
        }
      }
    });
    obs.observe({ entryTypes: ['measure'] });
  }

  /**
   * Setup database query monitoring
   */
  setupDatabaseMonitoring() {
    setInterval(async () => {
      try {
        if (connectionManager.pools.primary) {
          const pool = connectionManager.pools.primary;
          this.metrics.database.connections = {
            active: pool.totalCount - pool.idleCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount
          };
        }
      } catch (error) {
        console.error('Error collecting database metrics:', error);
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Setup system resource monitoring
   */
  setupSystemMonitoring() {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.memory = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024) // MB
      };

      // CPU usage calculation
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        this.metrics.cpu.usage = Math.round((totalUsage / 1000000) * 100); // Percentage
      }, 100);

      // Load average (Unix-like systems)
      if (process.platform !== 'win32') {
        try {
          const os = require('os');
          this.metrics.cpu.load = os.loadavg();
        } catch (error) {
          // Ignore on platforms without loadavg
        }
      }
    }, 5000); // Every 5 seconds
  }

  /**
   * Setup garbage collection monitoring
   */
  setupGCMonitoring() {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.kind) {
          this.metrics.gc.collections++;
          this.metrics.gc.duration += entry.duration;
        }
      }
    });
    obs.observe({ entryTypes: ['gc'] });
  }

  /**
   * Setup periodic reporting
   */
  setupPeriodicReporting() {
    setInterval(() => {
      this.calculateDerivedMetrics();
      this.reportMetrics();
      this.resetCounters();
    }, 60000); // Every minute
  }

  /**
   * Record HTTP request metrics
   */
  recordRequest(duration, statusCode = 200) {
    this.metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }
    
    this.responseTimes.push(duration);
    
    // Update response time stats
    this.metrics.requests.responseTime.min = Math.min(this.metrics.requests.responseTime.min, duration);
    this.metrics.requests.responseTime.max = Math.max(this.metrics.requests.responseTime.max, duration);
  }

  /**
   * Record database query metrics
   */
  recordQuery(duration, success = true) {
    this.metrics.database.queries.total++;
    
    if (success) {
      this.queryTimes.push(duration);
      if (duration > 1000) { // Slow query threshold: 1 second
        this.metrics.database.queries.slow++;
      }
    } else {
      this.metrics.database.queries.failed++;
    }
  }

  /**
   * Record cache metrics
   */
  recordCacheHit() {
    this.metrics.cache.hits++;
  }

  recordCacheMiss() {
    this.metrics.cache.misses++;
  }

  recordCacheEviction() {
    this.metrics.cache.evictions++;
  }

  /**
   * Calculate derived metrics
   */
  calculateDerivedMetrics() {
    // Response time percentiles
    if (this.responseTimes.length > 0) {
      this.responseTimes.sort((a, b) => a - b);
      const len = this.responseTimes.length;
      
      this.metrics.requests.responseTime.avg = this.responseTimes.reduce((sum, time) => sum + time, 0) / len;
      this.metrics.requests.responseTime.p95 = this.responseTimes[Math.floor(len * 0.95)];
      this.metrics.requests.responseTime.p99 = this.responseTimes[Math.floor(len * 0.99)];
    }

    // Database query average time
    if (this.queryTimes.length > 0) {
      this.metrics.database.queries.avgExecutionTime = this.queryTimes.reduce((sum, time) => sum + time, 0) / this.queryTimes.length;
    }

    // Cache hit ratio
    const totalCacheRequests = this.metrics.cache.hits + this.metrics.cache.misses;
    if (totalCacheRequests > 0) {
      this.metrics.cache.hitRatio = (this.metrics.cache.hits / totalCacheRequests) * 100;
    }
  }

  /**
   * Reset periodic counters
   */
  resetCounters() {
    // Keep cumulative counters, reset rate-based ones
    this.responseTimes = [];
    this.queryTimes = [];
    
    // Reset response time min/max for next period
    this.metrics.requests.responseTime.min = Infinity;
    this.metrics.requests.responseTime.max = 0;
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics() {
    this.calculateDerivedMetrics();
    
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Report metrics (can be extended to send to monitoring services)
   */
  reportMetrics() {
    const metrics = this.getMetrics();
    
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Performance Metrics:', JSON.stringify(metrics, null, 2));
    }
    
    // Send to monitoring service (implement as needed)
    this.sendToMonitoringService(metrics);
  }

  /**
   * Send metrics to external monitoring service
   */
  async sendToMonitoringService(metrics) {
    try {
      // Store in Redis for short-term access
      const redis = await connectionManager.getRedis('cache');
      await redis.setex('performance:metrics', 300, JSON.stringify(metrics));
      
      // Store in database for historical analysis
      await connectionManager.query(
        `INSERT INTO analytics_events (event_type, data, timestamp) 
         VALUES ($1, $2, $3)`,
        ['performance_metrics', JSON.stringify(metrics), new Date()]
      );
      
      // Send to external services (Prometheus, DataDog, etc.)
      if (process.env.MONITORING_WEBHOOK_URL) {
        const fetch = require('node-fetch');
        await fetch(process.env.MONITORING_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metrics),
          timeout: 5000
        });
      }
    } catch (error) {
      console.error('Error sending metrics to monitoring service:', error);
    }
  }

  /**
   * Get health check status
   */
  getHealthStatus() {
    const metrics = this.getMetrics();
    
    const health = {
      status: 'healthy',
      checks: {
        memory: metrics.memory.heapUsed < 1500, // Less than 1.5GB
        cpu: metrics.cpu.usage < 80, // Less than 80%
        responseTime: metrics.requests.responseTime.avg < 1000, // Less than 1s average
        errorRate: (metrics.requests.failed / metrics.requests.total) < 0.05, // Less than 5% error rate
        databaseConnections: metrics.database.connections.waiting < 10, // Less than 10 waiting connections
        cacheHitRatio: metrics.cache.hitRatio > 70 // Greater than 70% hit rate
      },
      timestamp: new Date().toISOString(),
      uptime: metrics.uptime
    };
    
    // Determine overall status
    const unhealthyChecks = Object.values(health.checks).filter(check => !check);
    if (unhealthyChecks.length > 0) {
      health.status = unhealthyChecks.length > 2 ? 'unhealthy' : 'degraded';
    }
    
    return health;
  }

  /**
   * Create middleware for Express.js
   */
  middleware() {
    return (req, res, next) => {
      const start = performance.now();
      
      // Track request start
      performance.mark(`request-start-${req.id}`);
      
      // Override res.end to capture metrics
      const originalEnd = res.end;
      res.end = (...args) => {
        const end = performance.now();
        const duration = end - start;
        
        // Record request metrics
        this.recordRequest(duration, res.statusCode);
        
        // Create performance measure
        performance.mark(`request-end-${req.id}`);
        performance.measure(
          `http-request-${req.id}`,
          `request-start-${req.id}`,
          `request-end-${req.id}`
        );
        
        // Call original end method
        originalEnd.apply(res, args);
      };
      
      next();
    };
  }
}

// Create singleton instance
const performanceMetrics = new PerformanceMetrics();

module.exports = {
  PerformanceMetrics,
  performanceMetrics
};