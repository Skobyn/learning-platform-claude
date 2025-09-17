# Database Optimization Guide for Learning Platform

This guide documents the comprehensive database optimizations implemented to support 100K+ concurrent users on the Learning Platform.

## 🚀 Overview

The optimizations include:
- **Performance Indexes**: 50+ strategic indexes for query optimization
- **Connection Pooling**: Advanced connection management for high concurrency
- **Read Replicas**: Read/write splitting for load distribution
- **Table Partitioning**: Time-based and hash partitioning for large tables
- **Materialized Views**: Pre-computed aggregations for analytics
- **Query Caching**: Multi-layer caching strategy
- **N+1 Query Optimization**: Fixed inefficient query patterns in services

## 📁 File Structure

```
learning-platform/
├── prisma/
│   └── migrations/
│       └── 20250913_add_performance_indexes/
│           └── migration.sql                    # Performance indexes
├── src/
│   ├── lib/
│   │   └── db-optimized.ts                     # Optimized database client
│   └── services/
│       └── analyticsService.optimized.ts       # Fixed N+1 queries
└── scripts/
    ├── setup-read-replicas.sh                  # Read replica setup
    ├── database-partitioning.sql               # Table partitioning
    ├── create-materialized-views.sql           # Analytics views
    ├── query-caching-strategy.ts               # Caching implementation
    └── database-maintenance.sh                 # Maintenance automation
```

## 🔍 Performance Optimizations

### 1. Strategic Indexing

**File**: `prisma/migrations/20250913_add_performance_indexes/migration.sql`

#### Critical Indexes Added:
- **User Authentication**: `idx_users_email_active`, `idx_user_sessions_token_expires`
- **Course Discovery**: `idx_courses_status_category`, `idx_courses_fulltext` (full-text search)
- **Learning Progress**: `idx_progress_user_lesson`, `idx_enrollments_user_status`
- **Analytics Performance**: `idx_analytics_events_timestamp`, `idx_analytics_events_user_timestamp`
- **Session Management**: `idx_user_sessions_expires_cleanup`

#### Features:
- **Concurrent Index Creation**: Uses `CREATE INDEX CONCURRENTLY` to avoid table locks
- **Partial Indexes**: Optimized for common filter conditions
- **Composite Indexes**: Multi-column indexes for complex query patterns
- **JSON Indexes**: GIN indexes for JSON data in analytics events

### 2. Connection Pooling

**File**: `src/lib/db-optimized.ts`

#### Configuration:
```typescript
const createConnectionPool = () => {
  return new Pool({
    max: 100,           // Maximum connections
    min: 20,            // Minimum connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxUses: 7500,      // Connection refresh threshold
    keepAlive: true,
  });
};
```

#### Features:
- **Dual Client Setup**: Separate clients for read/write operations
- **Connection Reuse**: Optimized connection lifecycle management
- **Retry Logic**: Automatic retry for transient failures
- **Performance Monitoring**: Built-in query performance tracking

### 3. Read Replica Configuration

**File**: `scripts/setup-read-replicas.sh`

#### Setup Process:
1. **Replication User Creation**: Dedicated user with replication privileges
2. **Streaming Replication**: Real-time data synchronization
3. **PgBouncer Integration**: Connection pooling for replicas
4. **Health Monitoring**: Automated replication lag monitoring

#### Usage:
```bash
# Set environment variables
export PRIMARY_DB_HOST="your-primary-host"
export PRIMARY_DB_PASSWORD="your-password"
export REPLICATION_PASSWORD="replication-password"

# Run setup script
./scripts/setup-read-replicas.sh
```

### 4. Table Partitioning

**File**: `scripts/database-partitioning.sql`

#### Partitioned Tables:

1. **analytics_events** (Time-based)
   - Monthly partitions for 18 months
   - Automatic partition management
   - Partition pruning for improved query performance

2. **activity_logs** (Time-based)
   - Monthly partitions with shorter retention
   - Automated cleanup of old partitions

3. **user_sessions** (Hash-based)
   - 8 hash partitions for even distribution
   - Optimized for high-frequency session operations

4. **progress** (Hash-based)
   - 16 hash partitions for maximum concurrency
   - Distributed by userId for load balancing

#### Benefits:
- **Query Performance**: Partition pruning reduces scan time
- **Maintenance**: Parallel operations on partitions
- **Storage**: Efficient space utilization and cleanup

### 5. Materialized Views

**File**: `scripts/create-materialized-views.sql`

#### Created Views:

1. **mv_user_learning_summary**
   - Pre-computed user progress and achievements
   - Refreshed every 30 minutes

2. **mv_course_analytics**
   - Course performance metrics
   - Enrollment and completion statistics

3. **mv_daily_platform_metrics**
   - Platform-wide activity metrics
   - Daily active users and engagement

4. **mv_instructor_performance**
   - Instructor dashboard data
   - Student reach and course quality metrics

#### Features:
- **Concurrent Refresh**: Non-blocking updates
- **Dependency Management**: Proper refresh order
- **Performance Monitoring**: Built-in view statistics

### 6. Query Caching Strategy

**File**: `scripts/query-caching-strategy.ts`

#### Multi-Level Cache:
1. **L1 Cache**: In-memory (fastest, 10K entries max)
2. **L2 Cache**: Redis (distributed, persistent)
3. **L3 Cache**: Database (fallback)

#### Cache Configurations:
```typescript
export const CacheConfigs = {
  USER_DATA: { ttl: 5 * 60 * 1000, tags: ['user'] },
  COURSE_CATALOG: { ttl: 30 * 60 * 1000, tags: ['courses'] },
  ANALYTICS: { ttl: 60 * 60 * 1000, tags: ['analytics'] },
  STATIC_CONTENT: { ttl: 24 * 60 * 60 * 1000, tags: ['static'] }
};
```

#### Features:
- **Tag-based Invalidation**: Smart cache clearing
- **Cache Warming**: Preload critical data
- **Hit Rate Monitoring**: Performance metrics
- **Automatic Cleanup**: Memory management

### 7. N+1 Query Optimization

**File**: `src/services/analyticsService.optimized.ts`

#### Optimizations Applied:

1. **Batch Operations**: Replaced loops with single queries
2. **Aggregation Queries**: Use database aggregations instead of application logic
3. **Join Optimization**: Efficient table joins
4. **Read Replica Usage**: Separate read queries to replica

#### Example Optimization:
```typescript
// Before (N+1 queries)
const users = await prisma.user.findMany();
for (const user of users) {
  const progress = await prisma.progress.findMany({
    where: { userId: user.id }
  });
}

// After (Single query)
const usersWithProgress = await prisma.user.findMany({
  include: {
    progress: true
  }
});
```

## 🔧 Configuration

### Environment Variables

```bash
# Primary Database
DATABASE_URL="postgresql://user:password@primary-host:5432/db"

# Read Replica
DATABASE_READ_REPLICA_URL="postgresql://user:password@replica-host:5432/db"

# Connection Pooling
DATABASE_WRITE_POOL_URL="postgresql://user:password@localhost:6432/learning_platform_write"
DATABASE_READ_POOL_URL="postgresql://user:password@localhost:6432/learning_platform_read"

# Redis Cache
REDIS_URL="redis://localhost:6379"

# Pool Settings
DB_POOL_SIZE=100
DB_POOL_MIN=20
DB_POOL_MAX=200
```

### Application Usage

#### Using Optimized Database Client:
```typescript
import { readQuery, writeQuery, withTransaction } from '@/lib/db-optimized';

// Read operations (uses replica)
const courses = await readQuery(async (client) => {
  return client.course.findMany({
    where: { status: 'PUBLISHED' }
  });
});

// Write operations (uses primary)
const user = await writeQuery(async (client) => {
  return client.user.create({ data: userData });
});

// Transactions with retry logic
await withTransaction(async (tx) => {
  await tx.user.update({ where: { id }, data: updates });
  await tx.enrollment.create({ data: enrollmentData });
});
```

#### Using Query Cache:
```typescript
import { queryCacheManager, CachePatterns } from '@/scripts/query-caching-strategy';

const userAnalytics = await queryCacheManager.withCache(
  CachePatterns.userSpecific(userId, 'analytics').key,
  async () => {
    return analyticsService.getUserAnalytics(userId);
  },
  CachePatterns.userSpecific(userId, 'analytics').config
);
```

## 📊 Performance Monitoring

### Database Statistics

```sql
-- Monitor index usage
SELECT * FROM index_usage_stats ORDER BY idx_scan DESC;

-- Check slow queries
SELECT * FROM slow_queries ORDER BY mean_time DESC;

-- View partition sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'analytics_events_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Application Metrics

```typescript
import { metrics } from '@/lib/db-optimized';

// Get performance statistics
const stats = await metrics.getDetailedStats();
console.log('Database Performance:', stats);

// Cache statistics
const cacheStats = queryCacheManager.getCacheStats();
console.log('Cache Performance:', cacheStats);
```

## 🔄 Maintenance

### Automated Maintenance

**File**: `scripts/database-maintenance.sh`

#### Daily Tasks:
- Table statistics updates
- Vacuum operations for bloated tables
- Materialized view refresh
- Old data cleanup

#### Weekly Tasks:
- Index usage analysis
- Partition management
- Performance report generation

#### Usage:
```bash
# Daily maintenance
./scripts/database-maintenance.sh

# Full maintenance (weekly)
./scripts/database-maintenance.sh full

# Specific tasks
./scripts/database-maintenance.sh vacuum
./scripts/database-maintenance.sh partitions
./scripts/database-maintenance.sh views
```

### Manual Operations

#### Create Future Partitions:
```sql
SELECT create_monthly_partitions('analytics_events', 3);
SELECT create_monthly_partitions('activity_logs', 3);
```

#### Refresh Materialized Views:
```sql
SELECT * FROM refresh_all_analytics_views(true);
```

#### Monitor Replication:
```sql
-- Primary database
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn, sync_state
FROM pg_stat_replication;

-- Replica database
SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
```

## 🎯 Performance Targets

With these optimizations, the platform targets:

- **100K+ Concurrent Users**: Supported through connection pooling and read replicas
- **Sub-100ms Query Response**: Achieved through strategic indexing and caching
- **99.9% Uptime**: Ensured through replica failover and connection retry logic
- **Horizontal Scalability**: Enabled through partitioning and connection distribution

## 🚨 Troubleshooting

### Common Issues

1. **High Connection Count**:
   - Monitor: `SELECT count(*) FROM pg_stat_activity;`
   - Solution: Tune connection pool settings

2. **Slow Queries**:
   - Monitor: Check `slow_queries` view
   - Solution: Add missing indexes or optimize queries

3. **Replication Lag**:
   - Monitor: `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()));`
   - Solution: Check network, increase wal_sender_timeout

4. **Cache Miss Rate**:
   - Monitor: `queryCacheManager.getCacheStats()`
   - Solution: Adjust TTL values or cache warming strategy

### Performance Debugging

```sql
-- Find missing indexes
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
  AND correlation < 0.1;

-- Check table bloat
SELECT
  schemaname,
  tablename,
  n_dead_tup,
  n_live_tup,
  ROUND(n_dead_tup * 100.0 / (n_live_tup + n_dead_tup), 2) AS dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY dead_pct DESC;
```

## 📈 Next Steps

1. **Monitoring Setup**: Implement comprehensive monitoring with tools like pgAdmin, DataDog, or Grafana
2. **Load Testing**: Validate performance under realistic load using tools like Artillery or K6
3. **Auto-scaling**: Implement database connection auto-scaling based on demand
4. **Backup Strategy**: Set up point-in-time recovery and automated backups
5. **Security Hardening**: Implement SSL, network security, and audit logging

---

This optimization guide provides a comprehensive foundation for supporting high-traffic learning platforms. Regular monitoring and maintenance are essential for maintaining optimal performance as the platform grows.