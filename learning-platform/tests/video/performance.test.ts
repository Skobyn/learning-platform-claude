import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { performance } from 'perf_hooks';
import { enhancedVideoStreamingService } from '@/services/videoStreamingService.enhanced';
import VideoTranscodingService from '@/services/videoTranscodingService';
import { videoAnalyticsService } from '@/services/videoAnalyticsService';
import { offlineDownloadService } from '@/services/offlineDownloadService';

describe('Video Infrastructure Performance Tests', () => {
  let transcodingService: VideoTranscodingService;

  beforeAll(() => {
    transcodingService = new VideoTranscodingService({
      maxConcurrentJobs: 3,
      workingDirectory: './test-storage',
      tempDirectory: './test-temp'
    });

    // Mock dependencies
    jest.mock('@/lib/db');
  });

  describe('Upload Performance', () => {
    it('should handle 100 concurrent upload sessions', async () => {
      const startTime = performance.now();
      const concurrentUploads = 100;
      const promises = [];

      for (let i = 0; i < concurrentUploads; i++) {
        promises.push(
          enhancedVideoStreamingService.createUploadSession(
            `user-${i}`,
            `video-${i}.mp4`,
            100 * 1024 * 1024, // 100MB
            5 * 1024 * 1024    // 5MB chunks
          )
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // All uploads should succeed
      expect(results.every(r => r.success)).toBe(true);

      // Should complete within reasonable time (adjust based on your requirements)
      expect(duration).toBeLessThan(5000); // 5 seconds

      console.log(`100 concurrent uploads completed in ${duration.toFixed(2)}ms`);
    });

    it('should handle large file upload sessions efficiently', async () => {
      const startTime = performance.now();

      const result = await enhancedVideoStreamingService.createUploadSession(
        'test-user',
        'large-video.mp4',
        5 * 1024 * 1024 * 1024, // 5GB
        10 * 1024 * 1024        // 10MB chunks
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(1000); // Should create session quickly

      console.log(`Large file session created in ${duration.toFixed(2)}ms`);
    });

    it('should measure chunk upload throughput', async () => {
      const sessionResult = await enhancedVideoStreamingService.createUploadSession(
        'test-user',
        'test-video.mp4',
        50 * 1024 * 1024, // 50MB
        1024 * 1024       // 1MB chunks
      );

      expect(sessionResult.success).toBe(true);
      const sessionId = sessionResult.uploadSession!.id;

      const chunkData = Buffer.alloc(1024 * 1024); // 1MB chunk
      const startTime = performance.now();

      // Upload 10 chunks
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          enhancedVideoStreamingService.uploadChunk(sessionId, i, chunkData)
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.every(r => r.success)).toBe(true);

      const throughputMBps = (10 * 1024 * 1024) / (duration / 1000) / (1024 * 1024);
      console.log(`Upload throughput: ${throughputMBps.toFixed(2)} MB/s`);

      // Should achieve reasonable throughput
      expect(throughputMBps).toBeGreaterThan(0.1);
    });
  });

  describe('Streaming Performance', () => {
    it('should generate streaming tokens quickly', async () => {
      const iterations = 1000;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < iterations; i++) {
        promises.push(
          enhancedVideoStreamingService.generateStreamingToken(
            'test-video-id',
            `user-${i}`
          )
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.every(r => r.success)).toBe(true);

      const tokensPerSecond = iterations / (duration / 1000);
      console.log(`Token generation: ${tokensPerSecond.toFixed(2)} tokens/second`);

      // Should generate tokens efficiently
      expect(tokensPerSecond).toBeGreaterThan(100);
    });

    it('should handle concurrent playlist generation', async () => {
      const concurrentRequests = 50;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          enhancedVideoStreamingService.generateMasterPlaylist(`video-${i % 10}`)
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Check success rate
      const successCount = results.filter(r => r.success).length;
      const successRate = (successCount / concurrentRequests) * 100;

      console.log(`Playlist generation: ${successRate}% success rate in ${duration.toFixed(2)}ms`);

      // Should maintain high success rate under load
      expect(successRate).toBeGreaterThan(80);
    });

    it('should measure streaming latency', async () => {
      const measurements = [];

      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();

        const tokenResult = await enhancedVideoStreamingService.generateStreamingToken(
          'test-video-id',
          'test-user'
        );

        if (tokenResult.success) {
          const playlistResult = await enhancedVideoStreamingService.generateMasterPlaylist('test-video-id');
          const endTime = performance.now();

          if (playlistResult.success) {
            measurements.push(endTime - startTime);
          }
        }
      }

      const avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const maxLatency = Math.max(...measurements);
      const minLatency = Math.min(...measurements);

      console.log(`Streaming latency - Avg: ${avgLatency.toFixed(2)}ms, Min: ${minLatency.toFixed(2)}ms, Max: ${maxLatency.toFixed(2)}ms`);

      // Should have low latency
      expect(avgLatency).toBeLessThan(100); // 100ms average
      expect(maxLatency).toBeLessThan(500); // 500ms max
    });
  });

  describe('Analytics Performance', () => {
    it('should handle high-frequency event tracking', async () => {
      const eventsPerSecond = 1000;
      const duration = 5; // seconds
      const totalEvents = eventsPerSecond * duration;

      const deviceInfo = {
        userAgent: 'test-agent',
        platform: 'web',
        browser: 'chrome',
        browserVersion: '95.0',
        os: 'windows',
        osVersion: '10',
        screenWidth: 1920,
        screenHeight: 1080,
        pixelRatio: 1,
        touchEnabled: false
      };

      const sessionResult = await videoAnalyticsService.startWatchSession(
        'test-user',
        'test-video',
        deviceInfo
      );

      const startTime = performance.now();
      const promises = [];

      for (let i = 0; i < totalEvents; i++) {
        promises.push(
          videoAnalyticsService.trackEvent({
            userId: 'test-user',
            videoId: 'test-video',
            sessionId: sessionResult.sessionId,
            eventType: i % 2 === 0 ? 'VIDEO_PROGRESS' : 'VIDEO_PLAY',
            position: Math.random() * 3600,
            deviceInfo
          })
        );

        // Spread out requests over time
        if (i > 0 && i % eventsPerSecond === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await Promise.all(promises);
      const endTime = performance.now();
      const actualDuration = (endTime - startTime) / 1000;

      const actualEventsPerSecond = totalEvents / actualDuration;
      console.log(`Analytics throughput: ${actualEventsPerSecond.toFixed(2)} events/second`);

      // Should handle high event rates
      expect(actualEventsPerSecond).toBeGreaterThan(100);
    });

    it('should generate metrics efficiently', async () => {
      // Mock some data
      require('@/lib/db').default = {
        analyticsEvent: {
          findMany: jest.fn().mockResolvedValue(
            Array.from({ length: 10000 }, (_, i) => ({
              eventType: 'VIDEO_VIEW',
              userId: `user-${i % 100}`,
              timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
            }))
          )
        },
        videoWatchSession: {
          findMany: jest.fn().mockResolvedValue(
            Array.from({ length: 1000 }, (_, i) => ({
              userId: `user-${i % 100}`,
              totalWatchTime: Math.random() * 3600,
              completionRate: Math.random(),
              engagementScore: Math.random()
            }))
          )
        }
      };

      const startTime = performance.now();

      const metrics = await videoAnalyticsService.getVideoMetrics('test-video-id', '7d');

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Metrics generation completed in ${duration.toFixed(2)}ms`);

      expect(metrics).toBeDefined();
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle concurrent analytics requests', async () => {
      const concurrentRequests = 20;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          videoAnalyticsService.getLearnerInsights(`user-${i}`, '30d')
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.every(r => r !== null)).toBe(true);
      console.log(`${concurrentRequests} concurrent analytics requests completed in ${duration.toFixed(2)}ms`);

      // Should handle concurrent requests efficiently
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Offline Download Performance', () => {
    it('should create packages efficiently', async () => {
      require('@/lib/db').default = {
        video: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'test-video-id',
            status: 'ready',
            originalFilename: 'test-video.mp4',
            metadata: { duration: 3600 }
          })
        },
        offlinePackage: {
          create: jest.fn().mockImplementation(data => Promise.resolve(data.data)),
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };

      const concurrentPackages = 10;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < concurrentPackages; i++) {
        promises.push(
          offlineDownloadService.createOfflinePackage(
            `user-${i}`,
            'test-video-id',
            { quality: '720p', format: 'mp4' }
          )
        );
      }

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.every(r => r.success)).toBe(true);
      console.log(`${concurrentPackages} offline packages created in ${duration.toFixed(2)}ms`);

      expect(duration).toBeLessThan(3000);
    });

    it('should handle large package creation', async () => {
      require('@/lib/db').default = {
        video: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'large-video-id',
            status: 'ready',
            originalFilename: 'large-video.mp4',
            metadata: {
              duration: 7200, // 2 hours
              qualityVariants: [
                { quality: '1080p', size: 5 * 1024 * 1024 * 1024 } // 5GB
              ]
            }
          })
        },
        offlinePackage: {
          create: jest.fn().mockImplementation(data => Promise.resolve(data.data)),
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };

      const startTime = performance.now();

      const result = await offlineDownloadService.createOfflinePackage(
        'test-user',
        'large-video-id',
        {
          quality: '1080p',
          format: 'mp4',
          includeSubtitles: true,
          includeChapters: true
        }
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      console.log(`Large package creation initiated in ${duration.toFixed(2)}ms`);

      // Package creation initiation should be fast
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should monitor memory usage during operations', async () => {
      const getMemoryUsage = () => {
        const used = process.memoryUsage();
        return {
          rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
          heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
          heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
          external: Math.round(used.external / 1024 / 1024 * 100) / 100
        };
      };

      const initialMemory = getMemoryUsage();
      console.log('Initial memory usage:', initialMemory);

      // Perform memory-intensive operations
      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(
          enhancedVideoStreamingService.createUploadSession(
            `user-${i}`,
            `video-${i}.mp4`,
            100 * 1024 * 1024,
            1024 * 1024
          )
        );
      }

      await Promise.all(operations);

      const peakMemory = getMemoryUsage();
      console.log('Peak memory usage:', peakMemory);

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const finalMemory = getMemoryUsage();
      console.log('Final memory usage:', finalMemory);

      // Memory should not grow excessively
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      console.log(`Memory growth: ${memoryGrowth.toFixed(2)} MB`);

      expect(memoryGrowth).toBeLessThan(100); // Less than 100MB growth
    });

    it('should handle resource cleanup', async () => {
      const sessionIds = [];

      // Create multiple sessions
      for (let i = 0; i < 10; i++) {
        const result = await enhancedVideoStreamingService.createUploadSession(
          `user-${i}`,
          `video-${i}.mp4`,
          1024,
          512
        );

        if (result.success) {
          sessionIds.push(result.uploadSession!.id);
        }
      }

      // Cancel all sessions to test cleanup
      const cleanupPromises = sessionIds.map(sessionId =>
        enhancedVideoStreamingService.cancelUploadSession(sessionId)
      );

      const results = await Promise.all(cleanupPromises);

      // All cleanups should succeed
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('Stress Testing', () => {
    it('should handle system under load', async () => {
      const loadTest = async (duration: number) => {
        const endTime = Date.now() + duration;
        const operations = [];

        while (Date.now() < endTime) {
          operations.push(
            enhancedVideoStreamingService.generateStreamingToken(
              `video-${Math.floor(Math.random() * 100)}`,
              `user-${Math.floor(Math.random() * 1000)}`
            )
          );

          operations.push(
            videoAnalyticsService.trackEvent({
              userId: `user-${Math.floor(Math.random() * 1000)}`,
              videoId: `video-${Math.floor(Math.random() * 100)}`,
              sessionId: `session-${Math.floor(Math.random() * 1000)}`,
              eventType: 'VIDEO_PROGRESS',
              position: Math.random() * 3600,
              deviceInfo: {
                userAgent: 'test-agent',
                platform: 'web',
                browser: 'chrome',
                browserVersion: '95.0',
                os: 'windows',
                osVersion: '10',
                screenWidth: 1920,
                screenHeight: 1080,
                pixelRatio: 1,
                touchEnabled: false
              }
            })
          );

          // Prevent overwhelming the system
          if (operations.length >= 100) {
            await Promise.all(operations);
            operations.length = 0;
          }

          await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Complete remaining operations
        if (operations.length > 0) {
          await Promise.all(operations);
        }
      };

      const startTime = performance.now();

      // Run load test for 10 seconds
      await loadTest(10000);

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Stress test completed in ${duration.toFixed(2)} seconds`);

      // System should remain stable under load
      expect(duration).toBeLessThan(15); // Should complete within reasonable time
    });
  });
});

describe('Scalability Tests', () => {
  it('should measure scaling characteristics', async () => {
    const testSizes = [10, 50, 100, 200];
    const results = [];

    for (const size of testSizes) {
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < size; i++) {
        promises.push(
          enhancedVideoStreamingService.generateStreamingToken(
            `video-${i}`,
            `user-${i}`
          )
        );
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;
      const throughput = size / (duration / 1000);

      results.push({
        size,
        duration: duration.toFixed(2),
        throughput: throughput.toFixed(2)
      });
    }

    console.log('Scaling characteristics:');
    results.forEach(result => {
      console.log(`Size: ${result.size}, Duration: ${result.duration}ms, Throughput: ${result.throughput} ops/sec`);
    });

    // Throughput should scale reasonably
    const firstThroughput = parseFloat(results[0].throughput);
    const lastThroughput = parseFloat(results[results.length - 1].throughput);

    // Throughput degradation should be reasonable (adjust threshold as needed)
    const degradationRatio = lastThroughput / firstThroughput;
    expect(degradationRatio).toBeGreaterThan(0.5); // No more than 50% degradation
  });
});