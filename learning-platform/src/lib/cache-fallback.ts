// Cache fallback for when Redis is not available
import { LRUCache } from 'lru-cache';

// In-memory LRU cache as fallback when Redis is unavailable
const memoryCache = new LRUCache<string, any>({
  max: 100, // Maximum number of items
  ttl: 1000 * 60 * 5, // 5 minutes default TTL
  allowStale: false,
  updateAgeOnGet: true,
  updateAgeOnHas: false,
});

export interface CacheClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode?: string, duration?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
  expire: (key: string, seconds: number) => Promise<void>;
  ttl: (key: string) => Promise<number>;
  ping: () => Promise<string>;
  isHealthy: () => boolean;
}

// Fallback cache implementation using in-memory LRU
export class FallbackCache implements CacheClient {
  async get(key: string): Promise<string | null> {
    const value = memoryCache.get(key);
    return value ? String(value) : null;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<void> {
    const ttl = duration ? duration * 1000 : undefined; // Convert seconds to ms
    memoryCache.set(key, value, { ttl });
  }

  async del(key: string): Promise<void> {
    memoryCache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return memoryCache.has(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    const value = memoryCache.get(key);
    if (value !== undefined) {
      memoryCache.set(key, value, { ttl: seconds * 1000 });
    }
  }

  async ttl(key: string): Promise<number> {
    const remaining = memoryCache.getRemainingTTL(key);
    return remaining ? Math.floor(remaining / 1000) : -1;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  isHealthy(): boolean {
    return true;
  }
}

// Create a cache client that automatically falls back to in-memory cache
export function createCacheClient(redisClient?: any): CacheClient {
  // If Redis client is provided and healthy, use it
  if (redisClient && redisClient.status === 'ready') {
    return {
      get: (key: string) => redisClient.get(key),
      set: (key: string, value: string, mode?: string, duration?: number) => {
        if (duration) {
          return redisClient.setex(key, duration, value);
        }
        return redisClient.set(key, value);
      },
      del: (key: string) => redisClient.del(key),
      exists: async (key: string) => {
        const result = await redisClient.exists(key);
        return result === 1;
      },
      expire: (key: string, seconds: number) => redisClient.expire(key, seconds),
      ttl: (key: string) => redisClient.ttl(key),
      ping: () => redisClient.ping(),
      isHealthy: () => redisClient.status === 'ready',
    };
  }

  // Otherwise, use fallback in-memory cache
  console.warn('Redis not available, using in-memory cache fallback');
  return new FallbackCache();
}

// Export a default cache client
let cacheClient: CacheClient | null = null;

export function getCacheClient(): CacheClient {
  if (!cacheClient) {
    // Try to get Redis client if available
    try {
      const { redis } = require('./redis.server');
      // Only use Redis if it's actually available
      if (redis && redis.status === 'ready') {
        cacheClient = createCacheClient(redis);
      } else {
        console.log('Redis not ready, using in-memory cache');
        cacheClient = new FallbackCache();
      }
    } catch (error) {
      console.warn('Redis module not available, using in-memory cache');
      cacheClient = new FallbackCache();
    }
  }
  return cacheClient;
}

// Helper functions for common cache operations
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getCacheClient();
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  try {
    const client = getCacheClient();
    await client.set(key, JSON.stringify(value), undefined, ttlSeconds);
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const client = getCacheClient();
    await client.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}