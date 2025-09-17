// Enterprise Database Pool Configuration
// Optimized for Google Cloud SQL with 100K+ concurrent connections

export interface PoolConfiguration {
  // Primary database pool settings
  primary: {
    minConnections: number;
    maxConnections: number;
    acquireTimeoutMs: number;
    createTimeoutMs: number;
    destroyTimeoutMs: number;
    idleTimeoutMs: number;
    reapIntervalMs: number;
    createRetryIntervalMs: number;
    propagateCreateError: boolean;
  };

  // Read replica pool settings
  replicas: {
    minConnections: number;
    maxConnections: number;
    acquireTimeoutMs: number;
    idleTimeoutMs: number;
    loadBalancing: 'round_robin' | 'least_connections' | 'weighted';
    healthCheck: {
      enabled: boolean;
      intervalMs: number;
      timeoutMs: number;
      retries: number;
    };
  };

  // Connection routing and failover
  routing: {
    readWriteSplit: boolean;
    stickySessions: boolean;
    failoverEnabled: boolean;
    maxRetries: number;
    retryDelayMs: number;
  };

  // Performance monitoring
  monitoring: {
    slowQueryThresholdMs: number;
    connectionPoolMetrics: boolean;
    queryAnalytics: boolean;
    alertThresholds: {
      connectionPoolUtilization: number;
      averageResponseTime: number;
      errorRate: number;
    };
  };
}

// Production configuration for Google Cloud SQL
export const productionPoolConfig: PoolConfiguration = {
  primary: {
    minConnections: 20,
    maxConnections: 100, // Per Cloud SQL instance
    acquireTimeoutMs: 60000,
    createTimeoutMs: 30000,
    destroyTimeoutMs: 5000,
    idleTimeoutMs: 300000, // 5 minutes
    reapIntervalMs: 1000,
    createRetryIntervalMs: 2000,
    propagateCreateError: false
  },

  replicas: {
    minConnections: 10,
    maxConnections: 80, // Per replica
    acquireTimeoutMs: 30000,
    idleTimeoutMs: 300000,
    loadBalancing: 'least_connections',
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      retries: 3
    }
  },

  routing: {
    readWriteSplit: true,
    stickySessions: false,
    failoverEnabled: true,
    maxRetries: 3,
    retryDelayMs: 1000
  },

  monitoring: {
    slowQueryThresholdMs: 1000,
    connectionPoolMetrics: true,
    queryAnalytics: true,
    alertThresholds: {
      connectionPoolUtilization: 0.85, // 85%
      averageResponseTime: 100, // 100ms
      errorRate: 0.01 // 1%
    }
  }
};

// Development configuration (scaled down)
export const developmentPoolConfig: PoolConfiguration = {
  primary: {
    minConnections: 5,
    maxConnections: 20,
    acquireTimeoutMs: 30000,
    createTimeoutMs: 10000,
    destroyTimeoutMs: 5000,
    idleTimeoutMs: 180000, // 3 minutes
    reapIntervalMs: 1000,
    createRetryIntervalMs: 1000,
    propagateCreateError: true
  },

  replicas: {
    minConnections: 2,
    maxConnections: 10,
    acquireTimeoutMs: 15000,
    idleTimeoutMs: 180000,
    loadBalancing: 'round_robin',
    healthCheck: {
      enabled: true,
      intervalMs: 60000,
      timeoutMs: 3000,
      retries: 2
    }
  },

  routing: {
    readWriteSplit: false,
    stickySessions: false,
    failoverEnabled: false,
    maxRetries: 1,
    retryDelayMs: 500
  },

  monitoring: {
    slowQueryThresholdMs: 2000,
    connectionPoolMetrics: false,
    queryAnalytics: false,
    alertThresholds: {
      connectionPoolUtilization: 0.9,
      averageResponseTime: 500,
      errorRate: 0.05
    }
  }
};

// High-scale configuration for massive concurrent load
export const hyperScalePoolConfig: PoolConfiguration = {
  primary: {
    minConnections: 50,
    maxConnections: 200, // Higher for primary writes
    acquireTimeoutMs: 90000,
    createTimeoutMs: 45000,
    destroyTimeoutMs: 10000,
    idleTimeoutMs: 600000, // 10 minutes
    reapIntervalMs: 500,
    createRetryIntervalMs: 3000,
    propagateCreateError: false
  },

  replicas: {
    minConnections: 30,
    maxConnections: 150, // Per replica for massive reads
    acquireTimeoutMs: 45000,
    idleTimeoutMs: 600000,
    loadBalancing: 'weighted', // More sophisticated balancing
    healthCheck: {
      enabled: true,
      intervalMs: 15000, // More frequent health checks
      timeoutMs: 3000,
      retries: 5
    }
  },

  routing: {
    readWriteSplit: true,
    stickySessions: true, // For session consistency
    failoverEnabled: true,
    maxRetries: 5,
    retryDelayMs: 2000
  },

  monitoring: {
    slowQueryThresholdMs: 500, // Stricter for high scale
    connectionPoolMetrics: true,
    queryAnalytics: true,
    alertThresholds: {
      connectionPoolUtilization: 0.8, // More conservative
      averageResponseTime: 50, // Stricter SLA
      errorRate: 0.005 // 0.5%
    }
  }
};

// Google Cloud SQL specific optimizations
export const cloudSQLOptimizations = {
  // Connection flags for Cloud SQL
  connectionFlags: {
    'cloudsql.iam_authentication': 'on',
    'log_statement': 'ddl',
    'log_min_duration_statement': '1000', // Log queries > 1 second
    'shared_preload_libraries': 'pg_stat_statements',
    'track_activity_query_size': '2048',
    'max_connections': '200', // Per instance
    'shared_buffers': '256MB',
    'effective_cache_size': '1GB',
    'work_mem': '4MB',
    'maintenance_work_mem': '64MB',
    'checkpoint_completion_target': '0.7',
    'wal_buffers': '16MB',
    'default_statistics_target': '100'
  },

  // High availability settings
  highAvailability: {
    enablePointInTimeRecovery: true,
    backupRetentionDays: 30,
    backupStartTime: '03:00', // UTC
    maintenanceWindow: {
      day: 'sunday',
      hour: 4, // UTC
      updateTrack: 'stable'
    }
  },

  // Performance insights
  performanceInsights: {
    enabled: true,
    retentionPeriod: 7 // days
  },

  // Auto-scaling configuration
  autoScaling: {
    cpu: {
      enabled: true,
      targetUtilization: 0.7,
      minReplicas: 1,
      maxReplicas: 5
    },
    storage: {
      enabled: true,
      limitGB: 1000,
      increaseThreshold: 0.9
    }
  }
};

// Connection string builders
export function buildConnectionString(
  host: string,
  database: string,
  user: string,
  password: string,
  options: Record<string, string> = {}
): string {
  const baseUrl = `postgresql://${user}:${password}@${host}/${database}`;

  const defaultOptions = {
    'sslmode': 'require',
    'connect_timeout': '60',
    'application_name': 'learning-platform',
    'statement_timeout': '30000ms',
    'idle_in_transaction_session_timeout': '300000ms',
    ...options
  };

  const optionString = Object.entries(defaultOptions)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return `${baseUrl}?${optionString}`;
}

// Environment-specific configurations
export function getPoolConfig(): PoolConfiguration {
  const env = process.env.NODE_ENV || 'development';

  switch (env) {
    case 'production':
      return productionPoolConfig;
    case 'staging':
      return productionPoolConfig; // Use production settings for staging
    case 'development':
      return developmentPoolConfig;
    case 'test':
      return developmentPoolConfig;
    default:
      return developmentPoolConfig;
  }
}

// Pool health monitoring utilities
export interface PoolHealth {
  primary: {
    active: number;
    idle: number;
    total: number;
    utilization: number;
    averageAcquireTime: number;
  };
  replicas: Array<{
    id: string;
    active: number;
    idle: number;
    total: number;
    utilization: number;
    healthy: boolean;
    lastHealthCheck: Date;
  }>;
  overall: {
    totalConnections: number;
    healthy: boolean;
    lastUpdated: Date;
  };
}

// Export configuration getter
export default getPoolConfig;