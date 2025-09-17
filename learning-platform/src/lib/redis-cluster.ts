import { Cluster, Redis } from 'ioredis';
import { logger } from './logger';

interface RedisClusterConfig {
  nodes: Array<{ host: string; port: number }>;
  options: {
    redisOptions: {
      password?: string;
      db?: number;
      connectTimeout?: number;
      commandTimeout?: number;
      retryDelayOnFailover?: number;
      enableReadyCheck?: boolean;
      maxRetriesPerRequest?: number;
    };
    enableOfflineQueue?: boolean;
    readOnly?: boolean;
    scaleReads?: 'master' | 'slave' | 'all';
    maxRedirections?: number;
    retryDelayOnFailover?: number;
    retryDelayOnClusterDown?: number;
    retryDelayOnConnectionError?: number;
    slotsRefreshTimeout?: number;
    slotsRefreshInterval?: number;
  };
}

export class RedisClusterClient {
  private cluster: Cluster;
  private readonly config: RedisClusterConfig;
  private isConnected = false;
  private metrics = {
    hits: 0,
    misses: 0,
    operations: 0,
    errors: 0,
    connectionAttempts: 0,
    lastConnectionTime: 0
  };

  constructor(config?: Partial<RedisClusterConfig>) {
    this.config = {
      nodes: config?.nodes || [
        { host: 'localhost', port: 7001 },
        { host: 'localhost', port: 7002 },
        { host: 'localhost', port: 7003 }
      ],
      options: {
        redisOptions: {
          password: process.env.REDIS_PASSWORD,
          connectTimeout: 10000,
          commandTimeout: 5000,
          retryDelayOnFailover: 100,
          enableReadyCheck: false,
          maxRetriesPerRequest: 3,
          ...config?.options?.redisOptions
        },
        enableOfflineQueue: false,
        scaleReads: 'slave',
        maxRedirections: 16,
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 300,
        retryDelayOnConnectionError: 100,
        slotsRefreshTimeout: 2000,
        slotsRefreshInterval: 5000,
        ...config?.options
      }
    };

    this.initializeCluster();
  }

  private initializeCluster(): void {
    this.cluster = new Cluster(this.config.nodes, this.config.options);

    this.cluster.on('connect', () => {
      this.isConnected = true;
      this.metrics.connectionAttempts++;
      this.metrics.lastConnectionTime = Date.now();
      logger.info('Redis cluster connected successfully');
    });

    this.cluster.on('error', (error) => {
      this.isConnected = false;
      this.metrics.errors++;
      logger.error('Redis cluster error:', error);
    });

    this.cluster.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis cluster connection closed');
    });

    this.cluster.on('reconnecting', () => {
      logger.info('Redis cluster reconnecting...');
    });

    this.cluster.on('end', () => {
      this.isConnected = false;
      logger.warn('Redis cluster connection ended');
    });

    this.cluster.on('failover', () => {
      logger.info('Redis cluster failover occurred');
    });

    this.cluster.on('ready', () => {
      logger.info('Redis cluster is ready');
    });
  }

  // Basic Operations
  async get(key: string): Promise<string | null> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.get(key);
      if (result) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<'OK'> {
    try {
      this.metrics.operations++;
      if (ttl) {
        return await this.cluster.setex(key, ttl, value);
      }
      return await this.cluster.set(key, value);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.del(key);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.exists(key);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  async expire(key: string, ttl: number): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.expire(key, ttl);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.ttl(key);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis TTL error for key ${key}:`, error);
      throw error;
    }
  }

  // Hash Operations
  async hget(key: string, field: string): Promise<string | null> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.hget(key, field);
      if (result) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.hset(key, field, value);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.hgetall(key);
      if (Object.keys(result).length > 0) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.hdel(key, ...fields);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis HDEL error for key ${key}, fields ${fields.join(', ')}:`, error);
      throw error;
    }
  }

  // Set Operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.sadd(key, ...members);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis SADD error for key ${key}:`, error);
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.smembers(key);
      if (result.length > 0) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  }

  async sismember(key: string, member: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.sismember(key, member);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis SISMEMBER error for key ${key}, member ${member}:`, error);
      throw error;
    }
  }

  // List Operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.lpush(key, ...values);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      throw error;
    }
  }

  async rpop(key: string): Promise<string | null> {
    try {
      this.metrics.operations++;
      return await this.cluster.rpop(key);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis RPOP error for key ${key}:`, error);
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.lrange(key, start, stop);
      if (result.length > 0) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis LRANGE error for key ${key}:`, error);
      throw error;
    }
  }

  // Sorted Set Operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.zadd(key, score, member);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis ZADD error for key ${key}:`, error);
      throw error;
    }
  }

  async zrange(key: string, start: number, stop: number, withScores = false): Promise<string[]> {
    try {
      this.metrics.operations++;
      const result = withScores
        ? await this.cluster.zrange(key, start, stop, 'WITHSCORES')
        : await this.cluster.zrange(key, start, stop);
      if (result.length > 0) {
        this.metrics.hits++;
      } else {
        this.metrics.misses++;
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis ZRANGE error for key ${key}:`, error);
      throw error;
    }
  }

  // Advanced Operations
  async mget(...keys: string[]): Promise<(string | null)[]> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.mget(...keys);
      const hitCount = result.filter(r => r !== null).length;
      this.metrics.hits += hitCount;
      this.metrics.misses += (result.length - hitCount);
      return result;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis MGET error for keys ${keys.join(', ')}:`, error);
      throw error;
    }
  }

  async mset(keyValues: Record<string, string>): Promise<'OK'> {
    try {
      this.metrics.operations++;
      const flatArray = Object.entries(keyValues).flat();
      return await this.cluster.mset(...flatArray);
    } catch (error) {
      this.metrics.errors++;
      logger.error('Redis MSET error:', error);
      throw error;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.incr(key);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis INCR error for key ${key}:`, error);
      throw error;
    }
  }

  async incrby(key: string, increment: number): Promise<number> {
    try {
      this.metrics.operations++;
      return await this.cluster.incrby(key, increment);
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis INCRBY error for key ${key}:`, error);
      throw error;
    }
  }

  // Distributed Locking
  async acquireLock(
    lockKey: string,
    identifier: string,
    timeout: number = 10000
  ): Promise<boolean> {
    try {
      this.metrics.operations++;
      const result = await this.cluster.set(
        lockKey,
        identifier,
        'PX',
        timeout,
        'NX'
      );
      return result === 'OK';
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis ACQUIRE_LOCK error for key ${lockKey}:`, error);
      throw error;
    }
  }

  async releaseLock(lockKey: string, identifier: string): Promise<boolean> {
    try {
      this.metrics.operations++;
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      const result = await this.cluster.eval(script, 1, lockKey, identifier);
      return result === 1;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis RELEASE_LOCK error for key ${lockKey}:`, error);
      throw error;
    }
  }

  // Pipeline Operations
  pipeline() {
    return this.cluster.pipeline();
  }

  // Transaction Operations
  multi() {
    return this.cluster.multi();
  }

  // Pattern-based Operations
  async keys(pattern: string): Promise<string[]> {
    try {
      this.metrics.operations++;
      const nodes = this.cluster.nodes('master');
      const allKeys: string[] = [];

      for (const node of nodes) {
        const keys = await node.keys(pattern);
        allKeys.push(...keys);
      }

      return [...new Set(allKeys)]; // Remove duplicates
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      throw error;
    }
  }

  async deleteByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) return 0;

      const pipeline = this.pipeline();
      keys.forEach(key => pipeline.del(key));
      const results = await pipeline.exec();

      return results?.reduce((sum, [err, result]) => {
        if (!err && typeof result === 'number') {
          return sum + result;
        }
        return sum;
      }, 0) || 0;
    } catch (error) {
      this.metrics.errors++;
      logger.error(`Redis DELETE_BY_PATTERN error for pattern ${pattern}:`, error);
      throw error;
    }
  }

  // Cluster Management
  async getClusterInfo(): Promise<any> {
    try {
      return await this.cluster.cluster('info');
    } catch (error) {
      logger.error('Redis CLUSTER_INFO error:', error);
      throw error;
    }
  }

  async getClusterNodes(): Promise<any> {
    try {
      return await this.cluster.cluster('nodes');
    } catch (error) {
      logger.error('Redis CLUSTER_NODES error:', error);
      throw error;
    }
  }

  // Health and Metrics
  async ping(): Promise<string> {
    try {
      return await this.cluster.ping();
    } catch (error) {
      logger.error('Redis PING error:', error);
      throw error;
    }
  }

  getMetrics() {
    const hitRate = this.metrics.hits / (this.metrics.hits + this.metrics.misses) || 0;
    const errorRate = this.metrics.errors / this.metrics.operations || 0;

    return {
      ...this.metrics,
      hitRate: Math.round(hitRate * 100 * 100) / 100, // Two decimal places
      errorRate: Math.round(errorRate * 100 * 100) / 100,
      isConnected: this.isConnected
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      operations: 0,
      errors: 0,
      connectionAttempts: this.metrics.connectionAttempts,
      lastConnectionTime: this.metrics.lastConnectionTime
    };
  }

  // Connection Management
  async disconnect(): Promise<void> {
    try {
      await this.cluster.disconnect();
      this.isConnected = false;
      logger.info('Redis cluster disconnected successfully');
    } catch (error) {
      logger.error('Redis disconnect error:', error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.isConnected && this.cluster.status === 'ready';
  }
}

// Singleton instance
let redisClient: RedisClusterClient;

export function getRedisClient(): RedisClusterClient {
  if (!redisClient) {
    redisClient = new RedisClusterClient();
  }
  return redisClient;
}

export default RedisClusterClient;