// Server-side only Redis client - removed 'server-only' for Vercel compatibility
import Redis, { RedisOptions } from 'ioredis';
import { createHash } from 'crypto';

// Helper function to validate Redis URL
function isValidRedisUrl(url: string | undefined): boolean {
  if (!url) return false;
  // Check if it's a placeholder or invalid URL
  if (url.includes('[') || url.includes(']')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Redis connection configuration
const redisConfig: RedisOptions = (process.env.REDIS_URL && isValidRedisUrl(process.env.REDIS_URL)) ?
  // Use Redis URL if provided and valid (Upstash, etc.)
  process.env.REDIS_URL as any :
  // Otherwise use individual connection params
  {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
    db: parseInt(process.env.REDIS_DB || '0'),

  // Connection pooling
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 5000,
  commandTimeout: 5000,

    // Retry configuration
    retryStrategy: (times: number) => {
      if (times > 3) {
        console.warn('Redis connection failed after 3 attempts');
        return null; // Stop retrying after 3 attempts
      }
      const delay = Math.min(times * 50, 2000);
      return delay;
    },

    // Connection pool settings
    lazyConnect: true,
    keepAlive: 30000,

    // Key prefix for namespacing
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'learning-platform:',
  };

// Create Redis instances
class RedisManager {
  private static instance: RedisManager;
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private isRedisEnabled: boolean = false;

  private constructor() {
    // Only create Redis instances if Redis is properly configured
    const hasValidRedis = (process.env.REDIS_URL && isValidRedisUrl(process.env.REDIS_URL)) ||
                          process.env.REDIS_HOST;

    if (hasValidRedis) {
      try {
        this.client = new Redis(redisConfig);
        this.subscriber = new Redis(redisConfig);
        this.publisher = new Redis(redisConfig);
        this.isRedisEnabled = true;
        this.setupEventHandlers();
      } catch (error) {
        console.warn('Failed to initialize Redis clients:', error);
        this.isRedisEnabled = false;
      }
    } else {
      console.log('Redis not configured, using in-memory cache fallback');
      this.isRedisEnabled = false;
    }
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private setupEventHandlers(): void {
    if (!this.client || !this.subscriber || !this.publisher) return;

    // Main client event handlers
    this.client.on('connect', () => {
      console.log('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('error', (error) => {
      console.error('Redis client error:', error);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('Redis client connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      console.log('Redis client reconnecting...');
    });

    // Subscriber event handlers
    this.subscriber.on('error', (error) => {
      console.error('Redis subscriber error:', error);
    });

    // Publisher event handlers
    this.publisher.on('error', (error) => {
      console.error('Redis publisher error:', error);
    });
  }

  public async connect(): Promise<void> {
    if (!this.isRedisEnabled || !this.client || !this.subscriber || !this.publisher) {
      console.log('Redis not enabled, skipping connection');
      return;
    }

    if (this.isConnected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = Promise.all([
      this.client.connect(),
      this.subscriber.connect(),
      this.publisher.connect(),
    ]).then(() => {
      console.log('All Redis connections established');
      this.connectionPromise = null;
    }).catch((error) => {
      console.error('Failed to connect to Redis:', error);
      this.connectionPromise = null;
      this.isRedisEnabled = false;
      // Don't throw, just disable Redis
    });

    return this.connectionPromise;
  }

  public async disconnect(): Promise<void> {
    if (!this.client || !this.subscriber || !this.publisher) return;

    await Promise.all([
      this.client.disconnect(),
      this.subscriber.disconnect(),
      this.publisher.disconnect(),
    ]);
    this.isConnected = false;
    console.log('All Redis connections closed');
  }

  public getClient(): Redis | null {
    return this.client;
  }

  public getSubscriber(): Redis | null {
    return this.subscriber;
  }

  public getPublisher(): Redis | null {
    return this.publisher;
  }

  public isHealthy(): boolean {
    if (!this.isRedisEnabled || !this.client || !this.subscriber || !this.publisher) {
      return false;
    }
    return this.isConnected &&
           this.client.status === 'ready' &&
           this.subscriber.status === 'ready' &&
           this.publisher.status === 'ready';
  }

  public async ping(): Promise<string> {
    if (!this.client) return 'NO_REDIS';
    try {
      return await this.client.ping();
    } catch {
      return 'ERROR';
    }
  }

  public async getStats(): Promise<{
    connected: boolean;
    clientStatus: string;
    subscriberStatus: string;
    publisherStatus: string;
    memory: any;
    info: any;
  }> {
    if (!this.client || !this.subscriber || !this.publisher) {
      return {
        connected: false,
        clientStatus: 'disabled',
        subscriberStatus: 'disabled',
        publisherStatus: 'disabled',
        memory: null,
        info: null,
      };
    }

    try {
      const info = await this.client.info('memory');
      const memory = await this.client.memory('STATS');

      return {
        connected: this.isConnected,
        clientStatus: this.client.status,
        subscriberStatus: this.subscriber.status,
        publisherStatus: this.publisher.status,
        memory,
        info,
      };
    } catch (error) {
      return {
        connected: false,
        clientStatus: this.client?.status || 'error',
        subscriberStatus: this.subscriber?.status || 'error',
        publisherStatus: this.publisher?.status || 'error',
        memory: null,
        info: null,
      };
    }
  }
}

// Export Redis manager instance
export const redisManager = RedisManager.getInstance();

// Export individual clients for direct use (may be null if Redis is not configured)
export const redis = redisManager.getClient();
export const redisSubscriber = redisManager.getSubscriber();
export const redisPublisher = redisManager.getPublisher();

// Utility functions
export const generateCacheKey = (prefix: string, ...parts: (string | number)[]): string => {
  const key = [prefix, ...parts].join(':');
  return createHash('sha256').update(key).digest('hex').substring(0, 16);
};

export const serializeForCache = <T>(data: T): string => {
  return JSON.stringify({
    data,
    timestamp: Date.now(),
    version: '1.0',
  });
};

export const deserializeFromCache = <T>(serialized: string): T | null => {
  try {
    const parsed = JSON.parse(serialized);
    return parsed.data as T;
  } catch (error) {
    console.error('Error deserializing cache data:', error);
    return null;
  }
};

// Connect to Redis when module is imported (only if Redis is configured)
const hasValidRedis = (process.env.REDIS_URL && isValidRedisUrl(process.env.REDIS_URL)) ||
                      process.env.REDIS_HOST;

if (hasValidRedis) {
  redisManager.connect().catch((error) => {
    console.error('Failed to connect to Redis on startup:', error);
    console.warn('Application will continue without Redis caching');
  });
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing Redis connections...');
  await redisManager.disconnect();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing Redis connections...');
  await redisManager.disconnect();
});