# Redis Cluster and CDN Configuration Guide

This guide covers the implementation of Redis clustering with high availability and CloudFlare CDN configuration for the learning platform.

## Architecture Overview

### Redis Cluster
- **6 Redis nodes** (3 masters, 3 replicas)
- **3 Sentinel nodes** for failover management
- **Distributed caching** across multiple nodes
- **Session management** with cluster support
- **Automatic failover** and recovery

### CDN Configuration
- **CloudFlare CDN** for global content delivery
- **Edge caching** for video content
- **Static asset optimization**
- **Bandwidth optimization** rules
- **Cache invalidation** patterns

## Quick Start

### 1. Environment Setup

Create environment variables:

```bash
export REDIS_PASSWORD="your-secure-redis-password"
export SENTINEL_PASSWORD="your-secure-sentinel-password"
export CLOUDFLARE_ZONE_ID="your-zone-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

### 2. Deploy Redis Cluster

#### Option A: Using Docker Compose (Development)

```bash
cd learning-platform
docker-compose -f config/docker-compose.redis-cluster.yml up -d
```

#### Option B: Production Deployment

```bash
sudo ./scripts/deploy/setup-redis-cluster.sh
```

### 3. Initialize Application Services

```typescript
import { getRedisCluster } from './src/lib/redis-cluster';
import { getCDNManager } from './src/lib/cdn-manager';
import { getDistributedCacheService } from './src/services/cacheService-distributed';

// Initialize services
const redis = getRedisCluster();
const cdn = getCDNManager();
const cache = getDistributedCacheService();

await redis.connect();
await cache.initialize();
```

## Configuration Details

### Redis Cluster Configuration

The cluster consists of:

- **Ports 7000-7005**: Redis cluster nodes
- **Ports 26379-26381**: Sentinel monitoring nodes
- **Cluster bus ports**: 17000-17005 (node communication)

#### Key Features:
- **High Availability**: Automatic failover with Sentinel
- **Data Persistence**: RDB snapshots + AOF logging
- **Memory Management**: LRU eviction with 2GB limit per node
- **Security**: Password authentication, renamed dangerous commands
- **Monitoring**: Slow query logging, latency monitoring

### CDN Configuration

CloudFlare CDN is configured with optimized rules for:

#### Static Assets:
- **Cache TTL**: 1 year (31,536,000 seconds)
- **Browser Cache**: 1 year
- **File Types**: CSS, JS, images, fonts

#### Video Content:
- **Cache TTL**: 7 days (604,800 seconds)
- **Browser Cache**: 1 day (86,400 seconds)
- **Range Requests**: Supported for streaming
- **Device-Specific**: Optimized for mobile/desktop

#### API Responses:
- **Dynamic Content**: Cache bypass for user-specific data
- **Content APIs**: 5-minute edge cache for public content
- **Session APIs**: No caching

## Usage Examples

### Basic Cache Operations

```typescript
const cache = getDistributedCacheService();

// Set data with tags for invalidation
await cache.set('user:123:profile', userData, {
  ttl: 3600, // 1 hour
  tags: ['user:123', 'profiles'],
  namespace: 'users'
});

// Get data
const profile = await cache.get('user:123:profile', { namespace: 'users' });

// Bulk operations
await cache.mset({
  'course:456': courseData,
  'course:789': anotherCourse
}, { ttl: 7200, tags: ['courses'] });

// Tag-based invalidation
await cache.invalidateByTags(['user:123']); // Clears all user data
```

### Session Management

```typescript
// Set session
await cache.setSession('session_id_123', {
  userId: 123,
  role: 'student',
  permissions: ['read', 'write']
}, 86400); // 24 hours

// Get session
const sessionData = await cache.getSession('session_id_123');

// Destroy session
await cache.destroySession('session_id_123');
```

### CDN Management

```typescript
const cdn = getCDNManager();

// Purge video content
await cdn.purgeVideoContent('video_123');

// Purge static assets
await cdn.purgeStaticAssets([
  '/static/css/app.css',
  '/static/js/bundle.js'
]);

// Setup video edge caching
await cdn.setupVideoEdgeCaching();

// Get cache analytics
const analytics = await cdn.getCacheAnalytics('24h');
```

## Monitoring and Maintenance

### Health Checks

```bash
# Check Redis cluster health
/opt/redis/scripts/health-check.sh

# Check individual nodes
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD cluster info
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD cluster nodes

# Check Sentinel status
redis-cli -h localhost -p 26379 -a $SENTINEL_PASSWORD sentinel masters
```

### Performance Monitoring

```typescript
// Get cache statistics
const stats = await cache.getStats();
console.log('Cache hit ratio:', stats.hits / (stats.hits + stats.misses));

// Monitor cluster status
const clusterInfo = await redis.getClusterInfo();
const nodes = await redis.getClusterNodes();
```

### Backup and Recovery

```bash
# Automated backup (runs daily at 2 AM)
/opt/redis/scripts/backup.sh

# Manual backup
for port in {7000..7005}; do
  redis-cli -p $port -a $REDIS_PASSWORD --rdb backup_$(date +%Y%m%d)_$port.rdb
done
```

## Failover Testing

### Simulate Node Failure

```bash
# Stop a master node
sudo systemctl stop redis-7000

# Watch Sentinel logs
sudo journalctl -f -u redis-sentinel-26379

# Check cluster status
redis-cli -h localhost -p 7001 -a $REDIS_PASSWORD cluster nodes
```

### Manual Failover

```bash
# Force failover via Sentinel
redis-cli -h localhost -p 26379 -a $SENTINEL_PASSWORD sentinel failover redis-master-1
```

## Scaling

### Adding New Nodes

```bash
# Start new Redis node on port 7006
sudo systemctl start redis-7006

# Add to cluster
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000 -a $REDIS_PASSWORD

# Rebalance slots
redis-cli --cluster rebalance 127.0.0.1:7000 -a $REDIS_PASSWORD
```

### Horizontal Scaling

For larger deployments:

1. **Multi-Region Setup**: Deploy clusters in multiple regions
2. **Read Replicas**: Add read-only replicas for read-heavy workloads
3. **Sharding Strategy**: Implement application-level sharding
4. **Load Balancing**: Use HAProxy or similar for connection distribution

## Security Best Practices

### Network Security
- **Firewall Rules**: Restrict access to Redis ports
- **VPN/Private Networks**: Keep Redis traffic internal
- **SSL/TLS**: Enable encryption for production

### Authentication
- **Strong Passwords**: Use complex passwords for Redis and Sentinel
- **Command Renaming**: Dangerous commands are renamed/disabled
- **Regular Rotation**: Rotate passwords periodically

### Monitoring
- **Log Analysis**: Monitor for suspicious access patterns
- **Rate Limiting**: Implement connection rate limiting
- **Alerting**: Set up alerts for failover events

## Troubleshooting

### Common Issues

#### Split-Brain Prevention
```bash
# Check quorum status
redis-cli -h localhost -p 26379 -a $SENTINEL_PASSWORD sentinel ckquorum redis-master-1
```

#### Memory Issues
```bash
# Check memory usage
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD info memory

# Check for memory fragmentation
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD memory doctor
```

#### Performance Issues
```bash
# Check slow queries
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD slowlog get 10

# Monitor latency
redis-cli -h localhost -p 7000 -a $REDIS_PASSWORD --latency-history
```

## Environment Variables

Required environment variables for production:

```bash
# Redis Configuration
REDIS_PASSWORD=your-secure-password
SENTINEL_PASSWORD=your-sentinel-password
REDIS_NODE_1_HOST=127.0.0.1
REDIS_NODE_1_PORT=7000
# ... (additional nodes)

# CDN Configuration
CLOUDFLARE_ZONE_ID=your-zone-id
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_EMAIL=your-email
CLOUDFLARE_ZONE_NAME=your-domain.com

# Application Configuration
CACHE_DEFAULT_TTL=3600
CACHE_NAMESPACE=lms
SESSION_TTL=86400
```

## Performance Benchmarks

Expected performance metrics:

- **Throughput**: 100K+ ops/sec per node
- **Latency**: < 1ms for cache hits
- **Availability**: 99.99% with proper failover
- **Memory Efficiency**: ~80% utilization before eviction
- **Network**: < 100ms failover time

## Cost Optimization

### CDN Costs
- Use appropriate cache TTLs to reduce origin requests
- Optimize image formats (WebP, AVIF)
- Implement smart purging strategies
- Monitor bandwidth usage patterns

### Redis Costs
- Right-size memory allocation
- Use compression for large objects
- Implement TTL policies
- Monitor and optimize data structures

## Support and Maintenance

### Log Locations
- **Redis Logs**: `/var/log/redis/redis-{port}.log`
- **Sentinel Logs**: `/var/log/redis/sentinel-{port}.log`
- **System Logs**: `journalctl -u redis-{port}`

### Configuration Files
- **Redis Config**: `/etc/redis/redis-{port}.conf`
- **Sentinel Config**: `/etc/redis/sentinel-{port}.conf`
- **Environment**: `/opt/redis/.env`

### Monitoring Tools
- **Built-in**: Redis INFO commands
- **External**: Prometheus + Grafana
- **Cloud**: CloudFlare Analytics Dashboard

For additional support, refer to the Redis documentation and CloudFlare API documentation.