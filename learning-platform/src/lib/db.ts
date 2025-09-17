import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const createPrismaClient = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'pretty',
    datasources: {
      db: {
        url: process.env.DATABASE_URL!,
      },
    },
  });
};

// Prevent multiple instances of Prisma Client in development
const db = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = db;
}

// Connection helper
export const connectDB = async () => {
  try {
    await db.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
};

// Disconnect helper
export const disconnectDB = async () => {
  try {
    await db.$disconnect();
    console.log('Database disconnected successfully');
  } catch (error) {
    console.error('Database disconnection failed:', error);
    throw error;
  }
};

// Health check
export const checkDBHealth = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: 'healthy', timestamp: new Date().toISOString() };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString() 
    };
  }
};

// Transaction helper
export const withTransaction = async <T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> => {
  return db.$transaction(callback as any, {
    maxWait: 5000, // 5 seconds
    timeout: 10000, // 10 seconds
  }) as Promise<T>;
};

// Batch operations helper
export const batchOperations = {
  async createMany<T extends Record<string, any>>(
    model: string,
    data: T[],
    batchSize = 1000
  ) {
    const results = [];
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const result = await (db as any)[model].createMany({
        data: batch,
        skipDuplicates: true,
      });
      results.push(result);
    }
    return results;
  },

  async updateMany<T extends Record<string, any>>(
    model: string,
    operations: Array<{ where: any; data: T }>,
    batchSize = 500
  ) {
    return withTransaction(async (tx) => {
      const results = [];
      for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        const promises = batch.map(op => 
          (tx as any)[model].updateMany({
            where: op.where,
            data: op.data,
          })
        );
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
      }
      return results;
    });
  }
};

// Query helpers
export const queryHelpers = {
  // Pagination helper
  paginate: (page: number = 1, limit: number = 10) => ({
    skip: (page - 1) * limit,
    take: limit,
  }),

  // Search helper for full-text search
  searchQuery: (searchTerm: string, fields: string[]) => ({
    OR: fields.map(field => ({
      [field]: {
        contains: searchTerm,
        mode: 'insensitive' as const,
      },
    })),
  }),

  // Date range filter
  dateRange: (startDate?: Date, endDate?: Date) => {
    if (!startDate && !endDate) return undefined;
    
    const filter: any = {};
    if (startDate) filter.gte = startDate;
    if (endDate) filter.lte = endDate;
    
    return filter;
  },

  // Include common relations
  includeUser: {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    avatar: true,
    role: true,
  },

  includeCourse: {
    id: true,
    title: true,
    slug: true,
    thumbnail: true,
    difficulty: true,
    estimatedMinutes: true,
    topic: {
      select: {
        name: true,
        slug: true,
      },
    },
    author: {
      select: {
        firstName: true,
        lastName: true,
      },
    },
  },
};

// Cache helpers for frequently accessed data
export const cacheHelpers = {
  // Simple in-memory cache with TTL
  cache: new Map<string, { data: any; expiry: number }>(),

  get(key: string) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  },

  set(key: string, data: any, ttlMs: number = 5 * 60 * 1000) { // 5 minutes default
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlMs,
    });
  },

  delete(key: string) {
    this.cache.delete(key);
  },

  clear() {
    this.cache.clear();
  },

  // Helper for cached queries
  async withCache<T>(
    key: string,
    queryFn: () => Promise<T>,
    ttlMs: number = 5 * 60 * 1000
  ): Promise<T> {
    const cached = this.get(key);
    if (cached) return cached;

    const result = await queryFn();
    this.set(key, result, ttlMs);
    return result;
  },
};

// Metrics collection
export const metrics = {
  queryCount: 0,
  slowQueries: [] as Array<{ query: string; duration: number; timestamp: Date }>,

  trackQuery(query: string, duration: number) {
    this.queryCount++;
    if (duration > 1000) { // Log slow queries (>1s)
      this.slowQueries.push({
        query,
        duration,
        timestamp: new Date(),
      });
      
      // Keep only last 100 slow queries
      if (this.slowQueries.length > 100) {
        this.slowQueries = this.slowQueries.slice(-100);
      }
    }
  },

  getStats() {
    return {
      totalQueries: this.queryCount,
      slowQueriesCount: this.slowQueries.length,
      recentSlowQueries: this.slowQueries.slice(-10),
      cacheSize: cacheHelpers.cache.size,
    };
  },
};

// Middleware for query logging
if (process.env.NODE_ENV === 'development') {
  db.$use(async (params, next) => {
    const start = Date.now();
    const result = await next(params);
    const duration = Date.now() - start;
    
    metrics.trackQuery(`${params.model}.${params.action}`, duration);
    
    if (duration > 100) { // Log queries > 100ms
      console.log(`Slow Query: ${params.model}.${params.action} took ${duration}ms`);
    }
    
    return result;
  });
}

export default db;
export { db as prisma };