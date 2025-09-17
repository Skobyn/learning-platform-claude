// Universal cache client that works with or without Redis
import { getCacheClient, CacheClient } from './cache-fallback';

// Re-export cache client and helper functions
export { getCacheClient, cacheGet, cacheSet, cacheDel } from './cache-fallback';
export type { CacheClient } from './cache-fallback';

// Global cache client instance
let globalCacheClient: CacheClient | null = null;

/**
 * Get a cache client that works with or without Redis
 * Falls back to in-memory cache if Redis is unavailable
 */
export function getCache(): CacheClient {
  if (!globalCacheClient) {
    globalCacheClient = getCacheClient();
  }
  return globalCacheClient;
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const cache = getCache();
    const result = await cache.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Cache wrapper with automatic JSON serialization
 */
export class Cache {
  private client: CacheClient;

  constructor() {
    this.client = getCache();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, undefined, ttlSeconds);
      return true;
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      console.error(`Cache expire error for key ${key}:`, error);
      return false;
    }
  }

  async flush(): Promise<void> {
    console.warn('Cache flush requested - not implemented in fallback mode');
  }
}

// Default cache instance
export const cache = new Cache();