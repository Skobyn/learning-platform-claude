#!/usr/bin/env ts-node

/**
 * Memory Backup Utility for Learning Platform
 * Exports memory to JSON with timestamped backups and selective export options
 */

import { MemoryManager, SessionState } from '../src/lib/memory-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const execAsync = promisify(exec);

interface BackupOptions {
  outputDir?: string;
  sessionId?: string;
  namespace?: string;
  includeAgents?: boolean;
  includePatterns?: boolean;
  includeMetrics?: boolean;
  includeTasks?: boolean;
  compress?: boolean;
  cleanup?: boolean;
  maxBackups?: number;
  format?: 'json' | 'csv' | 'yaml';
  verbose?: boolean;
}

interface BackupMetadata {
  backupId: string;
  timestamp: number;
  sessionId: string;
  namespace: string;
  totalEntries: number;
  size: number;
  checksum: string;
  options: BackupOptions;
}

class MemoryBackupUtility {
  private memoryManager: MemoryManager;
  private options: BackupOptions;
  private backupDir: string;

  constructor(options: BackupOptions = {}) {
    this.options = {
      outputDir: './backups',
      namespace: 'learning-platform',
      includeAgents: true,
      includePatterns: true,
      includeMetrics: true,
      includeTasks: true,
      compress: false,
      cleanup: false,
      maxBackups: 10,
      format: 'json',
      verbose: false,
      ...options
    };

    const sessionId = this.options.sessionId || this.generateSessionId();
    this.memoryManager = new MemoryManager(sessionId, this.options.namespace);
    this.backupDir = path.resolve(this.options.outputDir!);
  }

  /**
   * Main backup process
   */
  async backup(): Promise<string> {
    try {
      this.log('Starting memory backup...');

      // Step 1: Ensure backup directory exists
      await this.ensureBackupDirectory();

      // Step 2: Collect memory data
      const memoryData = await this.collectMemoryData();

      // Step 3: Generate backup metadata
      const metadata = await this.generateBackupMetadata(memoryData);

      // Step 4: Export to file
      const backupPath = await this.exportToFile(memoryData, metadata);

      // Step 5: Compress if requested
      const finalPath = this.options.compress ? await this.compressBackup(backupPath) : backupPath;

      // Step 6: Cleanup old backups if requested
      if (this.options.cleanup) {
        await this.cleanupOldBackups();
      }

      this.log(`Backup completed successfully: ${finalPath}`);
      return finalPath;

    } catch (error) {
      console.error('Backup failed:', error);
      throw error;
    }
  }

  /**
   * Restore from backup file
   */
  async restore(backupPath: string): Promise<void> {
    try {
      this.log(`Restoring from backup: ${backupPath}`);

      // Step 1: Read backup file
      const backupData = await this.readBackupFile(backupPath);

      // Step 2: Validate backup integrity
      await this.validateBackup(backupData);

      // Step 3: Restore memory data
      await this.restoreMemoryData(backupData.memory);

      this.log('Restore completed successfully');

    } catch (error) {
      console.error('Restore failed:', error);
      throw error;
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const backupFiles = await fs.readdir(this.backupDir);
      const metadataFiles = backupFiles.filter(file => file.endsWith('.metadata.json'));

      const backups: BackupMetadata[] = [];

      for (const metadataFile of metadataFiles) {
        try {
          const metadataPath = path.join(this.backupDir, metadataFile);
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent) as BackupMetadata;
          backups.push(metadata);
        } catch (error) {
          console.warn(`Failed to read metadata file ${metadataFile}:`, error);
        }
      }

      // Sort by timestamp (newest first)
      return backups.sort((a, b) => b.timestamp - a.timestamp);

    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      this.log('Cleaning up old backups...');

      const backups = await this.listBackups();

      if (backups.length <= this.options.maxBackups!) {
        this.log('No cleanup needed');
        return;
      }

      const backupsToDelete = backups.slice(this.options.maxBackups!);

      for (const backup of backupsToDelete) {
        try {
          // Delete backup file
          const backupFile = path.join(this.backupDir, `${backup.backupId}.${this.options.format}`);
          const compressedFile = `${backupFile}.gz`;
          const metadataFile = path.join(this.backupDir, `${backup.backupId}.metadata.json`);

          await this.safeDelete(backupFile);
          await this.safeDelete(compressedFile);
          await this.safeDelete(metadataFile);

          this.log(`Deleted old backup: ${backup.backupId}`);
        } catch (error) {
          console.warn(`Failed to delete backup ${backup.backupId}:`, error);
        }
      }

      this.log(`Cleaned up ${backupsToDelete.length} old backups`);

    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<any> {
    try {
      const backups = await this.listBackups();

      const stats = {
        totalBackups: backups.length,
        totalSize: backups.reduce((sum, backup) => sum + backup.size, 0),
        oldestBackup: backups.length > 0 ? new Date(Math.min(...backups.map(b => b.timestamp))) : null,
        newestBackup: backups.length > 0 ? new Date(Math.max(...backups.map(b => b.timestamp))) : null,
        averageSize: backups.length > 0 ? backups.reduce((sum, backup) => sum + backup.size, 0) / backups.length : 0,
        namespaces: [...new Set(backups.map(b => b.namespace))],
        sessions: [...new Set(backups.map(b => b.sessionId))]
      };

      return stats;

    } catch (error) {
      console.error('Failed to get backup stats:', error);
      return null;
    }
  }

  // Private helper methods

  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create backup directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async collectMemoryData(): Promise<any> {
    try {
      this.log('Collecting memory data...');

      const data: any = {
        sessions: {},
        agents: {},
        patterns: {},
        metrics: {},
        tasks: {}
      };

      // Export all memory using the memory manager
      const allMemory = await this.memoryManager.exportMemoryToJSON();

      // Organize data by category
      for (const [key, value] of Object.entries(allMemory.memory)) {
        if (key.includes('/session/') && this.options.includeTasks) {
          data.sessions[key] = value;
        } else if (key.includes('/agents/') && this.options.includeAgents) {
          data.agents[key] = value;
        } else if (key.includes('/patterns/') && this.options.includePatterns) {
          data.patterns[key] = value;
        } else if (key.includes('/metrics/') && this.options.includeMetrics) {
          data.metrics[key] = value;
        } else if (key.includes('/tasks/') && this.options.includeTasks) {
          data.tasks[key] = value;
        }
      }

      this.log(`Collected ${Object.keys(allMemory.memory).length} memory entries`);
      return data;

    } catch (error) {
      throw new Error(`Failed to collect memory data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateBackupMetadata(memoryData: any): Promise<BackupMetadata> {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dataString = JSON.stringify(memoryData);

    return {
      backupId,
      timestamp: Date.now(),
      sessionId: this.memoryManager['sessionId'],
      namespace: this.options.namespace!,
      totalEntries: Object.keys(memoryData).reduce((total, category) => total + Object.keys(memoryData[category]).length, 0),
      size: Buffer.byteLength(dataString, 'utf8'),
      checksum: await this.calculateChecksum(dataString),
      options: { ...this.options }
    };
  }

  private async exportToFile(memoryData: any, metadata: BackupMetadata): Promise<string> {
    const filename = `${metadata.backupId}.${this.options.format}`;
    const filepath = path.join(this.backupDir, filename);
    const metadataPath = path.join(this.backupDir, `${metadata.backupId}.metadata.json`);

    try {
      // Export data based on format
      switch (this.options.format) {
        case 'json':
          await fs.writeFile(filepath, JSON.stringify(memoryData, null, 2), 'utf-8');
          break;
        case 'csv':
          await this.exportToCSV(memoryData, filepath);
          break;
        case 'yaml':
          await this.exportToYAML(memoryData, filepath);
          break;
        default:
          throw new Error(`Unsupported format: ${this.options.format}`);
      }

      // Export metadata
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      this.log(`Exported to: ${filepath}`);
      return filepath;

    } catch (error) {
      throw new Error(`Failed to export to file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async exportToCSV(data: any, filepath: string): Promise<void> {
    // Simple CSV export - flatten the data structure
    const rows = ['category,key,value'];

    for (const [category, items] of Object.entries(data)) {
      for (const [key, value] of Object.entries(items as any)) {
        const escapedValue = JSON.stringify(value).replace(/"/g, '""');
        rows.push(`"${category}","${key}","${escapedValue}"`);
      }
    }

    await fs.writeFile(filepath, rows.join('\n'), 'utf-8');
  }

  private async exportToYAML(data: any, filepath: string): Promise<void> {
    // Simple YAML export
    const yamlContent = this.convertToYAML(data);
    await fs.writeFile(filepath, yamlContent, 'utf-8');
  }

  private convertToYAML(obj: any, indent: number = 0): string {
    const spaces = ' '.repeat(indent);
    let yaml = '';

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        yaml += `${spaces}${key}:\n${this.convertToYAML(value, indent + 2)}`;
      } else {
        yaml += `${spaces}${key}: ${JSON.stringify(value)}\n`;
      }
    }

    return yaml;
  }

  private async compressBackup(filepath: string): Promise<string> {
    try {
      const { createGzip } = require('zlib');
      const compressedPath = `${filepath}.gz`;

      const source = require('fs').createReadStream(filepath);
      const destination = createWriteStream(compressedPath);
      const gzip = createGzip();

      await pipeline(source, gzip, destination);

      // Remove original file
      await fs.unlink(filepath);

      this.log(`Compressed to: ${compressedPath}`);
      return compressedPath;

    } catch (error) {
      throw new Error(`Failed to compress backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async readBackupFile(backupPath: string): Promise<any> {
    try {
      let content: string;

      if (backupPath.endsWith('.gz')) {
        // Decompress first
        const { createGunzip } = require('zlib');
        const source = require('fs').createReadStream(backupPath);
        const gunzip = createGunzip();

        const chunks: Buffer[] = [];
        await pipeline(
          source,
          gunzip,
          async function* (source) {
            for await (const chunk of source) {
              chunks.push(chunk);
            }
          }
        );

        content = Buffer.concat(chunks).toString('utf-8');
      } else {
        content = await fs.readFile(backupPath, 'utf-8');
      }

      // Parse based on format
      const format = backupPath.split('.').slice(-1)[0].replace('.gz', '');

      switch (format) {
        case 'json':
          return JSON.parse(content);
        case 'csv':
          return this.parseCSV(content);
        case 'yaml':
          return this.parseYAML(content);
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

    } catch (error) {
      throw new Error(`Failed to read backup file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseCSV(content: string): any {
    const lines = content.split('\n');
    const data: any = {};

    for (let i = 1; i < lines.length; i++) {
      const [category, key, value] = lines[i].split(',').map(cell =>
        cell.replace(/^"(.*)"$/, '$1').replace(/""/g, '"')
      );

      if (!data[category]) {
        data[category] = {};
      }

      try {
        data[category][key] = JSON.parse(value);
      } catch {
        data[category][key] = value;
      }
    }

    return data;
  }

  private parseYAML(content: string): any {
    // Simple YAML parser - in production, use a proper YAML library
    const lines = content.split('\n');
    const data: any = {};
    let currentCategory = '';

    for (const line of lines) {
      if (line.trim() === '') continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      if (indent === 0 && trimmed.endsWith(':')) {
        currentCategory = trimmed.slice(0, -1);
        data[currentCategory] = {};
      } else if (indent === 2 && trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':');
        const value = valueParts.join(':').trim();

        try {
          data[currentCategory][key.trim()] = JSON.parse(value);
        } catch {
          data[currentCategory][key.trim()] = value;
        }
      }
    }

    return data;
  }

  private async validateBackup(backupData: any): Promise<void> {
    // Basic validation - ensure required structure exists
    if (!backupData || typeof backupData !== 'object') {
      throw new Error('Invalid backup data structure');
    }
  }

  private async restoreMemoryData(memoryData: any): Promise<void> {
    try {
      this.log('Restoring memory data...');

      let restoredCount = 0;

      for (const [category, items] of Object.entries(memoryData)) {
        for (const [key, value] of Object.entries(items as any)) {
          try {
            await this.memoryManager['storeMemory'](key, JSON.stringify(value));
            restoredCount++;
          } catch (error) {
            console.warn(`Failed to restore memory entry ${key}:`, error);
          }
        }
      }

      this.log(`Restored ${restoredCount} memory entries`);

    } catch (error) {
      throw new Error(`Failed to restore memory data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async calculateChecksum(data: string): Promise<string> {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async safeDelete(filepath: string): Promise<void> {
    try {
      await fs.access(filepath);
      await fs.unlink(filepath);
    } catch (error) {
      // File doesn't exist, ignore
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[MemoryBackup] ${message}`);
    }
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const options: BackupOptions = {};

  // Parse command line arguments
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir':
        options.outputDir = args[++i];
        break;
      case '--session-id':
        options.sessionId = args[++i];
        break;
      case '--namespace':
        options.namespace = args[++i];
        break;
      case '--format':
        options.format = args[++i] as any;
        break;
      case '--max-backups':
        options.maxBackups = parseInt(args[++i]);
        break;
      case '--no-agents':
        options.includeAgents = false;
        break;
      case '--no-patterns':
        options.includePatterns = false;
        break;
      case '--no-metrics':
        options.includeMetrics = false;
        break;
      case '--no-tasks':
        options.includeTasks = false;
        break;
      case '--compress':
        options.compress = true;
        break;
      case '--cleanup':
        options.cleanup = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
Usage: ts-node backup-memory.ts <command> [options]

Commands:
  backup        Create a new backup
  restore       Restore from backup file
  list          List available backups
  cleanup       Clean up old backups
  stats         Show backup statistics

Options:
  --output-dir <dir>    Backup directory (default: ./backups)
  --session-id <id>     Specific session ID
  --namespace <name>    Memory namespace (default: learning-platform)
  --format <format>     Export format: json|csv|yaml (default: json)
  --max-backups <n>     Maximum backups to keep (default: 10)
  --no-agents          Exclude agent data
  --no-patterns        Exclude pattern data
  --no-metrics         Exclude metrics data
  --no-tasks           Exclude task data
  --compress           Compress backup files
  --cleanup            Clean up old backups after creating new one
  --verbose            Enable verbose logging
  --help               Show this help message
        `);
        process.exit(0);
    }
  }

  try {
    const utility = new MemoryBackupUtility(options);

    switch (command) {
      case 'backup':
        const backupPath = await utility.backup();
        console.log(`Backup created: ${backupPath}`);
        break;

      case 'restore':
        const restorePath = args[1];
        if (!restorePath) {
          console.error('Error: Backup file path required for restore');
          process.exit(1);
        }
        await utility.restore(restorePath);
        console.log('Restore completed successfully');
        break;

      case 'list':
        const backups = await utility.listBackups();
        console.log('Available backups:');
        backups.forEach(backup => {
          console.log(`  ${backup.backupId} - ${new Date(backup.timestamp).toISOString()} (${backup.totalEntries} entries, ${Math.round(backup.size / 1024)} KB)`);
        });
        break;

      case 'cleanup':
        await utility.cleanupOldBackups();
        console.log('Cleanup completed');
        break;

      case 'stats':
        const stats = await utility.getBackupStats();
        console.log('Backup Statistics:');
        console.log(JSON.stringify(stats, null, 2));
        break;

      default:
        console.error('Error: Unknown command. Use --help for usage information.');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Export for use as module
export { MemoryBackupUtility, BackupOptions, BackupMetadata };

// Run as CLI if called directly
if (require.main === module) {
  main().catch(console.error);
}