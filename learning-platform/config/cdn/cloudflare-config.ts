import axios from 'axios';
import { logger } from '../../src/lib/logger';

export interface CloudflareZoneConfig {
  zoneId: string;
  apiToken: string;
  zoneName: string;
  accountId: string;
}

export interface CloudflareStreamConfig {
  accountId: string;
  apiToken: string;
  streamDomain: string;
}

export interface CDNPurgeConfig {
  files?: string[];
  tags?: string[];
  hosts?: string[];
  prefixes?: string[];
}

export interface SecuritySettings {
  securityLevel: 'off' | 'essentially_off' | 'low' | 'medium' | 'high' | 'under_attack';
  sslMode: 'off' | 'flexible' | 'full' | 'strict';
  alwaysUseHttps: boolean;
  minTlsVersion: '1.0' | '1.1' | '1.2' | '1.3';
  opportunisticEncryption: boolean;
  automaticHttpsRewrites: boolean;
}

export interface CachingSettings {
  cachingLevel: 'aggressive' | 'basic' | 'simplified';
  browserCacheTtl: number;
  edgeCacheTtl: number;
  developmentMode: boolean;
  alwaysOnline: boolean;
  opportunisticOnion: boolean;
}

export interface PerformanceSettings {
  minify: {
    css: boolean;
    html: boolean;
    js: boolean;
  };
  brotli: boolean;
  earlyHints: boolean;
  http2: boolean;
  http3: boolean;
  zeroRtt: boolean;
  ipv6: boolean;
  websockets: boolean;
  pseudoIpv4: boolean;
}

export class CloudflareCDNService {
  private zoneConfig: CloudflareZoneConfig;
  private streamConfig: CloudflareStreamConfig;
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(
    zoneConfig: CloudflareZoneConfig,
    streamConfig?: CloudflareStreamConfig
  ) {
    this.zoneConfig = zoneConfig;
    this.streamConfig = streamConfig!;
  }

  /**
   * Configure optimal CDN settings for video streaming
   */
  async configureVideoStreamingSettings(): Promise<void> {
    try {
      // Security settings for video protection
      await this.updateSecuritySettings({
        securityLevel: 'medium',
        sslMode: 'strict',
        alwaysUseHttps: true,
        minTlsVersion: '1.2',
        opportunisticEncryption: true,
        automaticHttpsRewrites: true
      });

      // Caching settings optimized for video content
      await this.updateCachingSettings({
        cachingLevel: 'aggressive',
        browserCacheTtl: 86400, // 24 hours
        edgeCacheTtl: 2592000, // 30 days
        developmentMode: false,
        alwaysOnline: true,
        opportunisticOnion: false
      });

      // Performance optimizations
      await this.updatePerformanceSettings({
        minify: {
          css: true,
          html: true,
          js: true
        },
        brotli: true,
        earlyHints: true,
        http2: true,
        http3: true,
        zeroRtt: true,
        ipv6: true,
        websockets: true,
        pseudoIpv4: false
      });

      // Create page rules for video content
      await this.createVideoPageRules();

      logger.info('Cloudflare CDN configured for video streaming');
    } catch (error) {
      logger.error('Failed to configure Cloudflare CDN:', error);
      throw error;
    }
  }

  /**
   * Create Cloudflare Stream video upload URL
   */
  async createStreamUploadUrl(metadata: {
    maxDurationSeconds?: number;
    requireSignedUrls?: boolean;
    allowedOrigins?: string[];
    thumbnailTimestampPct?: number;
  } = {}): Promise<{
    uploadUrl: string;
    uid: string;
    watermark?: any;
  }> {
    try {
      const response = await this.makeCloudflareRequest(
        'POST',
        `/accounts/${this.streamConfig.accountId}/stream/direct_upload`,
        {
          maxDurationSeconds: metadata.maxDurationSeconds || 3600,
          requireSignedURLs: metadata.requireSignedUrls || true,
          allowedOrigins: metadata.allowedOrigins || ['https://your-domain.com'],
          thumbnailTimestampPct: metadata.thumbnailTimestampPct || 0.5
        }
      );

      return response.result;
    } catch (error) {
      logger.error('Failed to create stream upload URL:', error);
      throw error;
    }
  }

  /**
   * Get video details from Cloudflare Stream
   */
  async getStreamVideo(videoId: string): Promise<any> {
    try {
      const response = await this.makeCloudflareRequest(
        'GET',
        `/accounts/${this.streamConfig.accountId}/stream/${videoId}`
      );

      return response.result;
    } catch (error) {
      logger.error(`Failed to get stream video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Generate signed URL for video access
   */
  async generateSignedVideoUrl(
    videoId: string,
    options: {
      exp?: number; // Expiration timestamp
      nbf?: number; // Not before timestamp
      downloadable?: boolean;
      aud?: string; // Audience
    } = {}
  ): Promise<string> {
    try {
      const response = await this.makeCloudflareRequest(
        'POST',
        `/accounts/${this.streamConfig.accountId}/stream/${videoId}/token`,
        {
          exp: options.exp || Math.floor(Date.now() / 1000) + 3600, // 1 hour
          nbf: options.nbf,
          downloadable: options.downloadable || false,
          aud: options.aud
        }
      );

      const token = response.result.token;
      return `https://${this.streamConfig.streamDomain}/${videoId}/manifest/video.m3u8?token=${token}`;
    } catch (error) {
      logger.error(`Failed to generate signed URL for video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Purge CDN cache for specific files or patterns
   */
  async purgeCache(config: CDNPurgeConfig): Promise<void> {
    try {
      const purgeData: any = {};

      if (config.files?.length) {
        purgeData.files = config.files;
      }
      if (config.tags?.length) {
        purgeData.tags = config.tags;
      }
      if (config.hosts?.length) {
        purgeData.hosts = config.hosts;
      }
      if (config.prefixes?.length) {
        purgeData.prefixes = config.prefixes;
      }

      await this.makeCloudflareRequest(
        'POST',
        `/zones/${this.zoneConfig.zoneId}/purge_cache`,
        purgeData
      );

      logger.info('CDN cache purged successfully');
    } catch (error) {
      logger.error('Failed to purge CDN cache:', error);
      throw error;
    }
  }

  /**
   * Get CDN analytics for video delivery
   */
  async getVideoDeliveryAnalytics(
    since: Date,
    until: Date,
    dimensions?: string[]
  ): Promise<any> {
    try {
      const params = new URLSearchParams({
        since: since.toISOString(),
        until: until.toISOString(),
        dimensions: dimensions?.join(',') || 'datetime,clientCountryName,clientRequestHTTPProtocol'
      });

      const response = await this.makeCloudflareRequest(
        'GET',
        `/zones/${this.zoneConfig.zoneId}/analytics/dashboard?${params.toString()}`
      );

      return response.result;
    } catch (error) {
      logger.error('Failed to get video delivery analytics:', error);
      throw error;
    }
  }

  /**
   * Configure geographic restrictions for video content
   */
  async setGeographicRestrictions(
    allowedCountries?: string[],
    blockedCountries?: string[]
  ): Promise<void> {
    try {
      if (allowedCountries?.length) {
        await this.makeCloudflareRequest(
          'POST',
          `/zones/${this.zoneConfig.zoneId}/firewall/rules`,
          {
            action: 'allow',
            filter: {
              expression: `(ip.geoip.country in {${allowedCountries.map(c => `"${c}"`).join(' ')}})`
            },
            description: 'Allow video access from specific countries',
            paused: false
          }
        );
      }

      if (blockedCountries?.length) {
        await this.makeCloudflareRequest(
          'POST',
          `/zones/${this.zoneConfig.zoneId}/firewall/rules`,
          {
            action: 'block',
            filter: {
              expression: `(ip.geoip.country in {${blockedCountries.map(c => `"${c}"`).join(' ')}})`
            },
            description: 'Block video access from specific countries',
            paused: false
          }
        );
      }

      logger.info('Geographic restrictions configured');
    } catch (error) {
      logger.error('Failed to set geographic restrictions:', error);
      throw error;
    }
  }

  /**
   * Setup rate limiting for video endpoints
   */
  async setupVideoRateLimiting(): Promise<void> {
    try {
      // Rate limit for video uploads
      await this.makeCloudflareRequest(
        'POST',
        `/zones/${this.zoneConfig.zoneId}/rate_limits`,
        {
          threshold: 10,
          period: 60,
          action: {
            mode: 'simulate',
            timeout: 86400,
            response: {
              content_type: 'application/json',
              body: JSON.stringify({
                error: 'Rate limit exceeded for video uploads'
              })
            }
          },
          match: {
            request: {
              methods: ['POST'],
              schemes: ['HTTPS'],
              url: '*/api/video/upload*'
            }
          },
          description: 'Video upload rate limiting',
          disabled: false,
          correlate: {
            by: 'nat'
          }
        }
      );

      // Rate limit for video streaming
      await this.makeCloudflareRequest(
        'POST',
        `/zones/${this.zoneConfig.zoneId}/rate_limits`,
        {
          threshold: 100,
          period: 60,
          action: {
            mode: 'simulate',
            timeout: 300
          },
          match: {
            request: {
              methods: ['GET'],
              schemes: ['HTTPS'],
              url: '*/video/*'
            }
          },
          description: 'Video streaming rate limiting',
          disabled: false,
          correlate: {
            by: 'nat'
          }
        }
      );

      logger.info('Video rate limiting configured');
    } catch (error) {
      logger.error('Failed to setup video rate limiting:', error);
      throw error;
    }
  }

  /**
   * Monitor CDN health and performance
   */
  async getHealthMetrics(): Promise<{
    status: string;
    responseTime: number;
    cacheHitRatio: number;
    bandwidth: number;
    requests: number;
    errors: number;
  }> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const analytics = await this.getVideoDeliveryAnalytics(oneHourAgo, now);

      // Calculate metrics from analytics data
      const totalRequests = analytics.totals.requests.all || 0;
      const cachedRequests = analytics.totals.requests.cached || 0;
      const bandwidth = analytics.totals.bandwidth.all || 0;
      const errors = analytics.totals.requests.http_status_4xx + analytics.totals.requests.http_status_5xx || 0;

      return {
        status: errors / totalRequests < 0.01 ? 'healthy' : 'degraded',
        responseTime: 0, // Would need separate monitoring
        cacheHitRatio: totalRequests > 0 ? cachedRequests / totalRequests : 0,
        bandwidth,
        requests: totalRequests,
        errors
      };
    } catch (error) {
      logger.error('Failed to get health metrics:', error);
      return {
        status: 'unknown',
        responseTime: 0,
        cacheHitRatio: 0,
        bandwidth: 0,
        requests: 0,
        errors: 0
      };
    }
  }

  // Private helper methods

  private async updateSecuritySettings(settings: SecuritySettings): Promise<void> {
    const updates = [
      { id: 'security_level', value: settings.securityLevel },
      { id: 'ssl', value: settings.sslMode },
      { id: 'always_use_https', value: settings.alwaysUseHttps ? 'on' : 'off' },
      { id: 'min_tls_version', value: settings.minTlsVersion },
      { id: 'opportunistic_encryption', value: settings.opportunisticEncryption ? 'on' : 'off' },
      { id: 'automatic_https_rewrites', value: settings.automaticHttpsRewrites ? 'on' : 'off' }
    ];

    for (const update of updates) {
      await this.makeCloudflareRequest(
        'PATCH',
        `/zones/${this.zoneConfig.zoneId}/settings/${update.id}`,
        { value: update.value }
      );
    }
  }

  private async updateCachingSettings(settings: CachingSettings): Promise<void> {
    const updates = [
      { id: 'cache_level', value: settings.cachingLevel },
      { id: 'browser_cache_ttl', value: settings.browserCacheTtl },
      { id: 'edge_cache_ttl', value: settings.edgeCacheTtl },
      { id: 'development_mode', value: settings.developmentMode ? 'on' : 'off' },
      { id: 'always_online', value: settings.alwaysOnline ? 'on' : 'off' },
      { id: 'opportunistic_onion', value: settings.opportunisticOnion ? 'on' : 'off' }
    ];

    for (const update of updates) {
      await this.makeCloudflareRequest(
        'PATCH',
        `/zones/${this.zoneConfig.zoneId}/settings/${update.id}`,
        { value: update.value }
      );
    }
  }

  private async updatePerformanceSettings(settings: PerformanceSettings): Promise<void> {
    const updates = [
      { id: 'minify', value: settings.minify },
      { id: 'brotli', value: settings.brotli ? 'on' : 'off' },
      { id: 'early_hints', value: settings.earlyHints ? 'on' : 'off' },
      { id: 'http2', value: settings.http2 ? 'on' : 'off' },
      { id: 'http3', value: settings.http3 ? 'on' : 'off' },
      { id: '0rtt', value: settings.zeroRtt ? 'on' : 'off' },
      { id: 'ipv6', value: settings.ipv6 ? 'on' : 'off' },
      { id: 'websockets', value: settings.websockets ? 'on' : 'off' },
      { id: 'pseudo_ipv4', value: settings.pseudoIpv4 ? 'on' : 'off' }
    ];

    for (const update of updates) {
      await this.makeCloudflareRequest(
        'PATCH',
        `/zones/${this.zoneConfig.zoneId}/settings/${update.id}`,
        { value: update.value }
      );
    }
  }

  private async createVideoPageRules(): Promise<void> {
    const rules = [
      {
        targets: [
          {
            target: 'url',
            constraint: {
              operator: 'matches',
              value: `*${this.zoneConfig.zoneName}/video/*`
            }
          }
        ],
        actions: [
          { id: 'cache_level', value: 'cache_everything' },
          { id: 'edge_cache_ttl', value: 2592000 }, // 30 days
          { id: 'browser_cache_ttl', value: 86400 }, // 1 day
          { id: 'security_level', value: 'medium' }
        ],
        priority: 1,
        status: 'active'
      },
      {
        targets: [
          {
            target: 'url',
            constraint: {
              operator: 'matches',
              value: `*${this.zoneConfig.zoneName}/*.m3u8`
            }
          }
        ],
        actions: [
          { id: 'cache_level', value: 'cache_everything' },
          { id: 'edge_cache_ttl', value: 300 }, // 5 minutes for playlists
          { id: 'browser_cache_ttl', value: 60 } // 1 minute
        ],
        priority: 2,
        status: 'active'
      }
    ];

    for (const rule of rules) {
      await this.makeCloudflareRequest(
        'POST',
        `/zones/${this.zoneConfig.zoneId}/pagerules`,
        rule
      );
    }
  }

  private async makeCloudflareRequest(method: string, endpoint: string, data?: any): Promise<any> {
    try {
      const config = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.zoneConfig.apiToken}`,
          'Content-Type': 'application/json'
        },
        ...(data && { data })
      };

      const response = await axios(config);

      if (!response.data.success) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error('Cloudflare API error:', error.response.data);
      }
      throw error;
    }
  }
}

// Configuration factory
export function createCloudflareCDN(config: {
  zoneId: string;
  apiToken: string;
  zoneName: string;
  accountId: string;
  streamDomain?: string;
}): CloudflareCDNService {
  const zoneConfig: CloudflareZoneConfig = {
    zoneId: config.zoneId,
    apiToken: config.apiToken,
    zoneName: config.zoneName,
    accountId: config.accountId
  };

  const streamConfig: CloudflareStreamConfig = {
    accountId: config.accountId,
    apiToken: config.apiToken,
    streamDomain: config.streamDomain || 'videodelivery.net'
  };

  return new CloudflareCDNService(zoneConfig, streamConfig);
}

export default CloudflareCDNService;