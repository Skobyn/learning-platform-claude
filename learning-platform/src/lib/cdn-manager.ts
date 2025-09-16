import axios, { AxiosInstance } from 'axios';

export interface CloudflareConfig {
  zoneId: string;
  apiToken: string;
  email?: string;
  baseUrl?: string;
}

export interface PurgeRequest {
  files?: string[];
  tags?: string[];
  hosts?: string[];
  prefixes?: string[];
}

export interface CacheRule {
  expression: string;
  action: 'cache' | 'bypass';
  edge_ttl?: number;
  browser_ttl?: number;
  cache_key?: {
    cache_by_device_type?: boolean;
    include_protocol?: boolean;
    custom_key?: {
      query_string?: {
        include?: string[];
        exclude?: string[];
      };
      header?: {
        include?: string[];
        exclude?: string[];
      };
    };
  };
}

export interface BandwidthOptimization {
  polish?: boolean;
  webp?: boolean;
  lossy?: boolean;
  mirage?: boolean;
  rocket_loader?: boolean;
  auto_minify?: {
    css?: boolean;
    html?: boolean;
    js?: boolean;
  };
  brotli?: boolean;
}

export class CloudflareCDNManager {
  private api: AxiosInstance;
  private config: CloudflareConfig;

  constructor(config: CloudflareConfig) {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl || 'https://api.cloudflare.com/client/v4',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        ...(config.email && { 'X-Auth-Email': config.email }),
      },
      timeout: 30000,
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.api.interceptors.request.use((config) => {
      console.log(`CDN API Request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.api.interceptors.response.use(
      (response) => {
        if (!response.data.success) {
          throw new Error(`Cloudflare API Error: ${JSON.stringify(response.data.errors)}`);
        }
        return response;
      },
      (error) => {
        console.error('CDN API Error:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  // Cache Management
  async purgeCache(request: PurgeRequest): Promise<void> {
    const endpoint = `/zones/${this.config.zoneId}/purge_cache`;

    try {
      await this.api.post(endpoint, request);
      console.log('Cache purged successfully:', request);
    } catch (error) {
      console.error('Failed to purge cache:', error);
      throw error;
    }
  }

  async purgeEverything(): Promise<void> {
    return this.purgeCache({ files: ['*'] });
  }

  async purgeByTags(tags: string[]): Promise<void> {
    return this.purgeCache({ tags });
  }

  async purgeByUrls(urls: string[]): Promise<void> {
    return this.purgeCache({ files: urls });
  }

  async purgeByPrefixes(prefixes: string[]): Promise<void> {
    return this.purgeCache({ prefixes });
  }

  // Video Content Purging
  async purgeVideoContent(videoId: string): Promise<void> {
    const prefixes = [
      `/videos/${videoId}/`,
      `/api/videos/${videoId}/`,
      `/thumbnails/${videoId}/`,
    ];

    await this.purgeByPrefixes(prefixes);
  }

  async purgeStaticAssets(assetPaths: string[]): Promise<void> {
    const urls = assetPaths.map(path =>
      path.startsWith('http') ? path : `https://${this.getZoneName()}${path}`
    );

    await this.purgeByUrls(urls);
  }

  // Cache Rules Management
  async createCacheRule(rule: CacheRule): Promise<string> {
    const endpoint = `/zones/${this.config.zoneId}/cache/cache_rules`;

    try {
      const response = await this.api.post(endpoint, rule);
      const ruleId = response.data.result.id;
      console.log('Cache rule created:', ruleId);
      return ruleId;
    } catch (error) {
      console.error('Failed to create cache rule:', error);
      throw error;
    }
  }

  async updateCacheRule(ruleId: string, rule: Partial<CacheRule>): Promise<void> {
    const endpoint = `/zones/${this.config.zoneId}/cache/cache_rules/${ruleId}`;

    try {
      await this.api.patch(endpoint, rule);
      console.log('Cache rule updated:', ruleId);
    } catch (error) {
      console.error('Failed to update cache rule:', error);
      throw error;
    }
  }

  async deleteCacheRule(ruleId: string): Promise<void> {
    const endpoint = `/zones/${this.config.zoneId}/cache/cache_rules/${ruleId}`;

    try {
      await this.api.delete(endpoint);
      console.log('Cache rule deleted:', ruleId);
    } catch (error) {
      console.error('Failed to delete cache rule:', error);
      throw error;
    }
  }

  async getCacheRules(): Promise<CacheRule[]> {
    const endpoint = `/zones/${this.config.zoneId}/cache/cache_rules`;

    try {
      const response = await this.api.get(endpoint);
      return response.data.result;
    } catch (error) {
      console.error('Failed to get cache rules:', error);
      throw error;
    }
  }

  // Bandwidth Optimization
  async updateBandwidthOptimization(settings: BandwidthOptimization): Promise<void> {
    const updates: Promise<any>[] = [];

    // Polish (image optimization)
    if (settings.polish !== undefined) {
      updates.push(this.updateZoneSetting('polish', settings.polish ? 'lossy' : 'off'));
    }

    // Mirage (image lazy loading)
    if (settings.mirage !== undefined) {
      updates.push(this.updateZoneSetting('mirage', settings.mirage ? 'on' : 'off'));
    }

    // Rocket Loader (JavaScript optimization)
    if (settings.rocket_loader !== undefined) {
      updates.push(this.updateZoneSetting('rocket_loader', settings.rocket_loader ? 'on' : 'off'));
    }

    // Auto Minify
    if (settings.auto_minify) {
      updates.push(this.updateZoneSetting('minify', settings.auto_minify));
    }

    // Brotli compression
    if (settings.brotli !== undefined) {
      updates.push(this.updateZoneSetting('brotli', settings.brotli ? 'on' : 'off'));
    }

    try {
      await Promise.all(updates);
      console.log('Bandwidth optimization settings updated');
    } catch (error) {
      console.error('Failed to update bandwidth optimization:', error);
      throw error;
    }
  }

  private async updateZoneSetting(setting: string, value: any): Promise<void> {
    const endpoint = `/zones/${this.config.zoneId}/settings/${setting}`;

    await this.api.patch(endpoint, { value });
  }

  // Edge Caching for Videos
  async setupVideoEdgeCaching(): Promise<void> {
    const videoRules: CacheRule[] = [
      {
        expression: '(http.request.uri.path matches "^/videos/.*\\.(mp4|webm|m3u8|ts)$")',
        action: 'cache',
        edge_ttl: 604800, // 7 days
        browser_ttl: 86400, // 1 day
        cache_key: {
          cache_by_device_type: true,
          include_protocol: false,
          custom_key: {
            query_string: {
              include: ['quality', 'format', 'start', 'end']
            },
            header: {
              include: ['Accept-Encoding', 'Accept', 'Range']
            }
          }
        }
      },
      {
        expression: '(http.request.uri.path matches "^/thumbnails/.*\\.(jpg|jpeg|png|webp)$")',
        action: 'cache',
        edge_ttl: 2592000, // 30 days
        browser_ttl: 86400, // 1 day
        cache_key: {
          cache_by_device_type: true,
          custom_key: {
            query_string: {
              include: ['w', 'h', 'q', 'format']
            }
          }
        }
      },
      {
        expression: '(http.request.uri.path matches "^/api/videos/.*/progress$")',
        action: 'bypass'
      }
    ];

    for (const rule of videoRules) {
      try {
        await this.createCacheRule(rule);
      } catch (error) {
        console.warn('Cache rule may already exist:', error);
      }
    }
  }

  // Cache Analytics
  async getCacheAnalytics(timeframe: '1h' | '6h' | '24h' | '7d' = '24h'): Promise<any> {
    const endpoint = `/zones/${this.config.zoneId}/analytics/dashboard`;

    const since = new Date();
    switch (timeframe) {
      case '1h':
        since.setHours(since.getHours() - 1);
        break;
      case '6h':
        since.setHours(since.getHours() - 6);
        break;
      case '24h':
        since.setDate(since.getDate() - 1);
        break;
      case '7d':
        since.setDate(since.getDate() - 7);
        break;
    }

    try {
      const response = await this.api.get(endpoint, {
        params: {
          since: since.toISOString(),
          until: new Date().toISOString(),
          continuous: true
        }
      });

      return response.data.result;
    } catch (error) {
      console.error('Failed to get cache analytics:', error);
      throw error;
    }
  }

  // Health Check
  async healthCheck(): Promise<boolean> {
    try {
      const endpoint = `/zones/${this.config.zoneId}`;
      const response = await this.api.get(endpoint);
      return response.data.success && response.data.result.status === 'active';
    } catch (error) {
      console.error('CDN health check failed:', error);
      return false;
    }
  }

  // Utility Methods
  private getZoneName(): string {
    // This would typically be retrieved from the zone info
    return process.env.CLOUDFLARE_ZONE_NAME || 'learning-platform.example.com';
  }

  async getZoneInfo(): Promise<any> {
    const endpoint = `/zones/${this.config.zoneId}`;

    try {
      const response = await this.api.get(endpoint);
      return response.data.result;
    } catch (error) {
      console.error('Failed to get zone info:', error);
      throw error;
    }
  }

  // Preload Popular Content
  async preloadContent(urls: string[]): Promise<void> {
    // Use Cloudflare's Cache Reserve or preload via warm-up requests
    const warmupPromises = urls.map(async (url) => {
      try {
        await axios.head(url, {
          headers: {
            'User-Agent': 'Learning-Platform-CDN-Warmup/1.0',
            'Cache-Control': 'no-cache'
          },
          timeout: 10000
        });
        console.log(`Preloaded: ${url}`);
      } catch (error) {
        console.warn(`Failed to preload: ${url}`, error.message);
      }
    });

    await Promise.allSettled(warmupPromises);
  }
}

// Factory function
export function createCDNManager(config?: Partial<CloudflareConfig>): CloudflareCDNManager {
  const fullConfig: CloudflareConfig = {
    zoneId: process.env.CLOUDFLARE_ZONE_ID!,
    apiToken: process.env.CLOUDFLARE_API_TOKEN!,
    email: process.env.CLOUDFLARE_EMAIL,
    ...config
  };

  if (!fullConfig.zoneId || !fullConfig.apiToken) {
    throw new Error('Cloudflare zone ID and API token are required');
  }

  return new CloudflareCDNManager(fullConfig);
}

// Singleton instance
let cdnManagerInstance: CloudflareCDNManager | null = null;

export function getCDNManager(): CloudflareCDNManager {
  if (!cdnManagerInstance) {
    cdnManagerInstance = createCDNManager();
  }
  return cdnManagerInstance;
}