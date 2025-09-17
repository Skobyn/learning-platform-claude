/**
 * Database Connection Pooling Configuration
 * Optimized for Learning Platform with high concurrency
 */

const { Pool } = require('pg');
const Redis = require('ioredis');

/**
 * PostgreSQL Connection Pool Configuration
 */
const databaseConfig = {
  // Primary database pool
  primary: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'learning_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    
    // Connection Pool Settings
    max: parseInt(process.env.DB_POOL_MAX) || 20, // Maximum connections
    min: parseInt(process.env.DB_POOL_MIN) || 5,  // Minimum connections
    idle: parseInt(process.env.DB_POOL_IDLE) || 10000, // Idle timeout (10s)
    acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000, // Acquire timeout (60s)
    evict: parseInt(process.env.DB_POOL_EVICT) || 1000, // Eviction run interval (1s)
    
    // Connection Settings
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
    query_timeout: 30000,
    
    // Performance Settings
    application_name: 'learning-platform',
    
    // SSL Configuration
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false,
      ca: process.env.DB_SSL_CA,
      key: process.env.DB_SSL_KEY,
      cert: process.env.DB_SSL_CERT
    } : false,
    
    // Advanced Settings
    options: {
      statement_timeout: '30s',
      idle_in_transaction_session_timeout: '30s',
      lock_timeout: '10s',
      log_statement: process.env.NODE_ENV === 'development' ? 'all' : 'error'
    }
  },

  // Read replica pool (for analytics and reporting)
  replica: {
    host: process.env.DB_REPLICA_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_REPLICA_PORT) || parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'learning_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    
    // Replica Pool Settings (can be larger for read operations)
    max: parseInt(process.env.DB_REPLICA_POOL_MAX) || 15,
    min: parseInt(process.env.DB_REPLICA_POOL_MIN) || 3,
    idle: parseInt(process.env.DB_REPLICA_POOL_IDLE) || 10000,
    acquire: parseInt(process.env.DB_REPLICA_POOL_ACQUIRE) || 60000,
    evict: parseInt(process.env.DB_REPLICA_POOL_EVICT) || 1000,
    
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 60000, // Longer timeout for analytics queries
    query_timeout: 60000,
    
    application_name: 'learning-platform-replica',
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false,
      ca: process.env.DB_SSL_CA,
      key: process.env.DB_SSL_KEY,
      cert: process.env.DB_SSL_CERT
    } : false
  }
};

/**
 * Redis Connection Configuration
 */
const redisConfig = {
  // Primary Redis instance
  primary: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    
    // Connection Pool Settings
    family: 4,
    keepAlive: true,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    lazyConnect: true,
    
    // Performance Settings
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    // TLS Settings
    tls: process.env.REDIS_TLS === 'true' ? {
      servername: process.env.REDIS_HOST
    } : undefined
  },

  // Session store configuration
  session: {
    host: process.env.REDIS_SESSION_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_SESSION_PORT) || parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_SESSION_PASSWORD || process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_SESSION_DB) || 1,
    
    family: 4,
    keepAlive: true,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    lazyConnect: true,
    
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    tls: process.env.REDIS_SESSION_TLS === 'true' ? {
      servername: process.env.REDIS_SESSION_HOST || process.env.REDIS_HOST
    } : undefined
  },

  // Cache configuration
  cache: {
    host: process.env.REDIS_CACHE_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_CACHE_PORT) || parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_CACHE_PASSWORD || process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_CACHE_DB) || 2,
    
    family: 4,
    keepAlive: true,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    lazyConnect: true,
    
    connectTimeout: 10000,
    commandTimeout: 5000,
    
    tls: process.env.REDIS_CACHE_TLS === 'true' ? {
      servername: process.env.REDIS_CACHE_HOST || process.env.REDIS_HOST
    } : undefined
  }
};

/**
 * Connection Pool Manager
 */
class ConnectionManager {
  constructor() {
    this.pools = {
      primary: null,
      replica: null
    };
    this.redis = {
      primary: null,
      session: null,
      cache: null
    };
    this.initialized = false;
  }

  /**
   * Initialize all connections
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize PostgreSQL pools
      this.pools.primary = new Pool(databaseConfig.primary);
      this.pools.replica = new Pool(databaseConfig.replica);

      // Initialize Redis connections
      this.redis.primary = new Redis(redisConfig.primary);
      this.redis.session = new Redis(redisConfig.session);
      this.redis.cache = new Redis(redisConfig.cache);

      // Test connections
      await Promise.all([
        this.pools.primary.query('SELECT NOW()'),
        this.pools.replica.query('SELECT NOW()'),
        this.redis.primary.ping(),
        this.redis.session.ping(),
        this.redis.cache.ping()
      ]);

      // Set up error handlers
      this.setupErrorHandlers();

      // Set up monitoring
      this.setupMonitoring();

      this.initialized = true;
      console.log('Connection pools initialized successfully');
    } catch (error) {
      console.error('Failed to initialize connection pools:', error);
      throw error;
    }
  }

  /**
   * Get database connection for read/write operations
   */
  async getDatabase(readOnly = false) {
    if (!this.initialized) await this.initialize();
    
    return readOnly && this.pools.replica ? 
      this.pools.replica : 
      this.pools.primary;
  }

  /**
   * Get Redis connection by type
   */
  async getRedis(type = 'primary') {
    if (!this.initialized) await this.initialize();
    
    if (!this.redis[type]) {
      throw new Error(`Redis connection type '${type}' not found`);
    }
    
    return this.redis[type];
  }

  /**
   * Execute query with automatic pool selection
   */
  async query(sql, params = [], readOnly = false) {
    const pool = await this.getDatabase(readOnly);
    
    const start = Date.now();
    try {
      const result = await pool.query(sql, params);
      const duration = Date.now() - start;
      
      // Log slow queries
      if (duration > 1000) {
        console.warn(`Slow query detected (${duration}ms):`, sql.substring(0, 100));
      }
      
      return result;
    } catch (error) {
      console.error('Database query error:', error, sql.substring(0, 100));
      throw error;
    }
  }

  /**
   * Execute transaction
   */
  async transaction(callback) {
    const client = await this.pools.primary.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cache operations
   */
  async cache(key, value = null, ttl = 3600) {
    const redis = await this.getRedis('cache');
    
    if (value === null) {
      // Get operation
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } else {
      // Set operation
      await redis.setex(key, ttl, JSON.stringify(value));
      return true;
    }
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    // PostgreSQL error handlers
    this.pools.primary.on('error', (err) => {
      console.error('Primary database pool error:', err);
    });

    this.pools.replica.on('error', (err) => {
      console.error('Replica database pool error:', err);
    });

    // Redis error handlers
    Object.entries(this.redis).forEach(([name, client]) => {
      client.on('error', (err) => {
        console.error(`Redis ${name} error:`, err);
      });

      client.on('connect', () => {
        console.log(`Redis ${name} connected`);
      });

      client.on('ready', () => {
        console.log(`Redis ${name} ready`);
      });
    });
  }

  /**
   * Setup monitoring
   */
  setupMonitoring() {
    setInterval(() => {
      // Log pool statistics
      const primaryStats = {
        totalCount: this.pools.primary.totalCount,
        idleCount: this.pools.primary.idleCount,
        waitingCount: this.pools.primary.waitingCount
      };

      const replicaStats = {
        totalCount: this.pools.replica.totalCount,
        idleCount: this.pools.replica.idleCount,
        waitingCount: this.pools.replica.waitingCount
      };

      console.log('Pool stats - Primary:', primaryStats, 'Replica:', replicaStats);
    }, 60000); // Log every minute
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('Shutting down connection pools...');
    
    try {
      await Promise.all([
        this.pools.primary?.end(),
        this.pools.replica?.end(),
        this.redis.primary?.quit(),
        this.redis.session?.quit(),
        this.redis.cache?.quit()
      ]);
      
      console.log('Connection pools shut down successfully');
    } catch (error) {
      console.error('Error during connection pool shutdown:', error);
    }
  }
}

// Create singleton instance
const connectionManager = new ConnectionManager();

// Graceful shutdown handling
process.on('SIGTERM', () => connectionManager.shutdown());
process.on('SIGINT', () => connectionManager.shutdown());

module.exports = {
  databaseConfig,
  redisConfig,
  ConnectionManager,
  connectionManager
};