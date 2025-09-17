#!/usr/bin/env ts-node

import { Command } from 'commander';
import { elasticsearchClient } from '../../src/services/search/elasticsearchClient';
import { indexingService } from '../../src/services/search/indexingService';
import { logger } from '../../src/services/logger';

interface ReindexOptions {
  type: 'all' | 'courses' | 'lessons' | 'resources' | 'users';
  batchSize: number;
  delay: number;
  skipExisting: boolean;
  updateOnly: boolean;
  dryRun: boolean;
  force: boolean;
  parallel: boolean;
  verbose: boolean;
}

interface ReindexProgress {
  startTime: Date;
  endTime?: Date;
  totalRecords: number;
  processedRecords: number;
  successfulRecords: number;
  failedRecords: number;
  currentBatch: number;
  totalBatches: number;
  estimatedTimeRemaining?: number;
}

class ReindexScript {
  private progress: ReindexProgress | null = null;
  private isRunning = false;
  private shouldStop = false;

  constructor() {
    // Handle graceful shutdown
    process.on('SIGINT', this.handleShutdown.bind(this));
    process.on('SIGTERM', this.handleShutdown.bind(this));
  }

  private handleShutdown() {
    if (this.isRunning) {
      logger.info('Received shutdown signal, stopping gracefully...');
      this.shouldStop = true;
    } else {
      process.exit(0);
    }
  }

  async run(options: ReindexOptions) {
    this.isRunning = true;

    try {
      logger.info('Starting reindex operation', options);

      // Validate Elasticsearch connection
      const isHealthy = await elasticsearchClient.healthCheck();
      if (!isHealthy) {
        throw new Error('Elasticsearch is not healthy');
      }

      // Perform reindex based on type
      switch (options.type) {
        case 'courses':
          await this.reindexCourses(options);
          break;
        case 'lessons':
          await this.reindexLessons(options);
          break;
        case 'resources':
          await this.reindexResources(options);
          break;
        case 'users':
          await this.reindexUsers(options);
          break;
        case 'all':
          await this.reindexAll(options);
          break;
        default:
          throw new Error(`Invalid reindex type: ${options.type}`);
      }

      logger.info('Reindex operation completed successfully');

    } catch (error) {
      logger.error('Reindex operation failed', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async reindexCourses(options: ReindexOptions) {
    logger.info('Starting course reindexing');

    if (options.dryRun) {
      logger.info('DRY RUN: Would reindex courses with options:', options);
      return;
    }

    const stats = await indexingService.indexCourses({
      batchSize: options.batchSize,
      delay: options.delay,
      skipExisting: options.skipExisting,
      updateOnly: options.updateOnly
    });

    this.logStats('Courses', stats);
  }

  private async reindexLessons(options: ReindexOptions) {
    logger.info('Starting lesson reindexing');

    if (options.dryRun) {
      logger.info('DRY RUN: Would reindex lessons with options:', options);
      return;
    }

    const stats = await indexingService.indexLessons({
      batchSize: options.batchSize,
      delay: options.delay,
      skipExisting: options.skipExisting,
      updateOnly: options.updateOnly
    });

    this.logStats('Lessons', stats);
  }

  private async reindexResources(options: ReindexOptions) {
    logger.info('Starting resource reindexing');

    if (options.dryRun) {
      logger.info('DRY RUN: Would reindex resources with options:', options);
      return;
    }

    const stats = await indexingService.indexResources({
      batchSize: options.batchSize,
      delay: options.delay,
      skipExisting: options.skipExisting,
      updateOnly: options.updateOnly
    });

    this.logStats('Resources', stats);
  }

  private async reindexUsers(options: ReindexOptions) {
    logger.info('Starting user reindexing');

    if (options.dryRun) {
      logger.info('DRY RUN: Would reindex users with options:', options);
      return;
    }

    // For users, we need a custom implementation since they're indexed individually
    logger.warn('User reindexing not yet implemented');
  }

  private async reindexAll(options: ReindexOptions) {
    logger.info('Starting full reindex');

    if (options.dryRun) {
      logger.info('DRY RUN: Would perform full reindex with options:', options);
      return;
    }

    if (options.parallel) {
      // Parallel execution - faster but more resource intensive
      logger.info('Running parallel reindex');

      const [coursesStats, lessonsStats, resourcesStats] = await Promise.allSettled([
        indexingService.indexCourses({
          batchSize: Math.floor(options.batchSize / 2), // Reduce batch size for parallel
          delay: options.delay,
          skipExisting: options.skipExisting,
          updateOnly: options.updateOnly
        }),
        indexingService.indexLessons({
          batchSize: Math.floor(options.batchSize / 2),
          delay: options.delay,
          skipExisting: options.skipExisting,
          updateOnly: options.updateOnly
        }),
        indexingService.indexResources({
          batchSize: Math.floor(options.batchSize / 2),
          delay: options.delay,
          skipExisting: options.skipExisting,
          updateOnly: options.updateOnly
        })
      ]);

      // Log results
      if (coursesStats.status === 'fulfilled') {
        this.logStats('Courses', coursesStats.value);
      } else {
        logger.error('Course reindexing failed', coursesStats.reason);
      }

      if (lessonsStats.status === 'fulfilled') {
        this.logStats('Lessons', lessonsStats.value);
      } else {
        logger.error('Lesson reindexing failed', lessonsStats.reason);
      }

      if (resourcesStats.status === 'fulfilled') {
        this.logStats('Resources', resourcesStats.value);
      } else {
        logger.error('Resource reindexing failed', resourcesStats.reason);
      }

    } else {
      // Sequential execution - safer and less resource intensive
      logger.info('Running sequential reindex');

      const results = await indexingService.reindexAll({
        batchSize: options.batchSize,
        delay: options.delay,
        skipExisting: options.skipExisting,
        updateOnly: options.updateOnly
      });

      this.logStats('Courses', results.courses);
      this.logStats('Lessons', results.lessons);
      this.logStats('Resources', results.resources);
    }
  }

  private logStats(type: string, stats: any) {
    logger.info(`${type} reindex completed`, {
      type,
      totalProcessed: stats.totalProcessed,
      successful: stats.successful,
      failed: stats.failed,
      duration: stats.duration,
      successRate: stats.totalProcessed > 0
        ? ((stats.successful / stats.totalProcessed) * 100).toFixed(2) + '%'
        : '0%'
    });

    if (stats.errors && stats.errors.length > 0) {
      logger.warn(`${type} reindex errors (showing first 10):`, {
        errorCount: stats.errors.length,
        errors: stats.errors.slice(0, 10)
      });
    }
  }

  async checkIndexStatus() {
    try {
      const progress = await indexingService.getIndexingProgress();

      console.log('\n=== Index Status ===');
      console.log(`Courses: ${progress.courses.indexed}/${progress.courses.total} (${(progress.courses.indexed / progress.courses.total * 100).toFixed(1)}%)`);
      console.log(`Lessons: ${progress.lessons.indexed}/${progress.lessons.total} (${(progress.lessons.indexed / progress.lessons.total * 100).toFixed(1)}%)`);
      console.log(`Resources: ${progress.resources.indexed}/${progress.resources.total} (${(progress.resources.indexed / progress.resources.total * 100).toFixed(1)}%)`);

      // Check Elasticsearch cluster health
      const client = elasticsearchClient.getClient();
      const health = await client.cluster.health();

      console.log('\n=== Elasticsearch Health ===');
      console.log(`Status: ${health.status}`);
      console.log(`Nodes: ${health.number_of_nodes}`);
      console.log(`Active Shards: ${health.active_shards}`);

      // Show index statistics
      const stats = await client.indices.stats({
        index: [
          elasticsearchClient.indexes.courses,
          elasticsearchClient.indexes.lessons,
          elasticsearchClient.indexes.resources
        ]
      });

      console.log('\n=== Index Statistics ===');
      Object.entries(stats.indices).forEach(([indexName, indexStats]) => {
        console.log(`${indexName}:`);
        console.log(`  Documents: ${indexStats.total?.docs?.count || 0}`);
        console.log(`  Size: ${this.formatBytes(indexStats.total?.store?.size_in_bytes || 0)}`);
      });

    } catch (error) {
      logger.error('Failed to get index status', error);
      throw error;
    }
  }

  async deleteIndex(indexName: string, force: boolean = false) {
    try {
      if (!force) {
        throw new Error('Use --force flag to confirm index deletion');
      }

      const client = elasticsearchClient.getClient();

      const exists = await client.indices.exists({ index: indexName });
      if (!exists) {
        logger.info(`Index ${indexName} does not exist`);
        return;
      }

      await client.indices.delete({ index: indexName });
      logger.info(`Index ${indexName} deleted successfully`);

    } catch (error) {
      logger.error(`Failed to delete index ${indexName}`, error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      logger.info('Creating/updating indexes...');

      // This will create indexes if they don't exist
      const client = elasticsearchClient.getClient();

      // Force initialization to create indexes
      await elasticsearchClient.healthCheck();

      logger.info('Indexes created/updated successfully');

    } catch (error) {
      logger.error('Failed to create indexes', error);
      throw error;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// CLI Setup
const program = new Command();
const reindexScript = new ReindexScript();

program
  .name('reindex-content')
  .description('Reindex content in Elasticsearch')
  .version('1.0.0');

program
  .command('reindex')
  .description('Reindex content')
  .option('-t, --type <type>', 'Type to reindex (all|courses|lessons|resources|users)', 'all')
  .option('-b, --batch-size <size>', 'Batch size for processing', '100')
  .option('-d, --delay <ms>', 'Delay between batches in milliseconds', '100')
  .option('-s, --skip-existing', 'Skip documents that already exist', false)
  .option('-u, --update-only', 'Only update existing documents', false)
  .option('--dry-run', 'Show what would be done without actually doing it', false)
  .option('-f, --force', 'Force operation without confirmation', false)
  .option('-p, --parallel', 'Run reindexing operations in parallel (for type=all)', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options) => {
    try {
      const reindexOptions: ReindexOptions = {
        type: options.type,
        batchSize: parseInt(options.batchSize),
        delay: parseInt(options.delay),
        skipExisting: options.skipExisting,
        updateOnly: options.updateOnly,
        dryRun: options.dryRun,
        force: options.force,
        parallel: options.parallel,
        verbose: options.verbose
      };

      if (options.verbose) {
        logger.level = 'debug';
      }

      // Confirm destructive operations
      if (!options.dryRun && !options.force && !options.skipExisting) {
        console.log('WARNING: This will overwrite existing documents in Elasticsearch.');
        console.log('Use --dry-run to see what would happen, or --force to proceed without confirmation.');
        process.exit(1);
      }

      await reindexScript.run(reindexOptions);

    } catch (error) {
      console.error('Reindex failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check indexing status')
  .action(async () => {
    try {
      await reindexScript.checkIndexStatus();
    } catch (error) {
      console.error('Status check failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('delete-index')
  .description('Delete an index')
  .argument('<index-name>', 'Name of the index to delete')
  .option('-f, --force', 'Force deletion without confirmation', false)
  .action(async (indexName, options) => {
    try {
      await reindexScript.deleteIndex(indexName, options.force);
    } catch (error) {
      console.error('Index deletion failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('create-indexes')
  .description('Create/update all indexes with proper mappings')
  .action(async () => {
    try {
      await reindexScript.createIndexes();
    } catch (error) {
      console.error('Index creation failed:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// If no command specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

export { ReindexScript };