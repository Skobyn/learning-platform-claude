#!/usr/bin/env ts-node

/**
 * Session Restoration Script for Learning Platform
 * Restores previous session state and reinitializes swarm configurations
 */

import { MemoryManager, SessionState, SwarmConfiguration } from '../src/lib/memory-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

interface RestoreOptions {
  sessionId?: string;
  includeAgents?: boolean;
  includePatterns?: boolean;
  includeMetrics?: boolean;
  swarmTopology?: 'hierarchical' | 'mesh' | 'ring' | 'star';
  verbose?: boolean;
}

class SessionRestorer {
  private memoryManager: MemoryManager;
  private options: RestoreOptions;

  constructor(options: RestoreOptions = {}) {
    this.options = {
      includeAgents: true,
      includePatterns: true,
      includeMetrics: true,
      verbose: false,
      ...options
    };

    const sessionId = this.options.sessionId || this.generateSessionId();
    this.memoryManager = new MemoryManager(sessionId);
  }

  /**
   * Main restoration process
   */
  async restore(): Promise<void> {
    try {
      this.log('Starting session restoration...');

      // Step 1: Initialize hooks
      await this.initializeHooks();

      // Step 2: Restore session state
      const sessionState = await this.restoreSessionState();

      if (!sessionState) {
        this.log('No previous session found. Creating new session...');
        await this.createNewSession();
        return;
      }

      // Step 3: Reinitialize swarm configuration
      await this.reinitializeSwarm(sessionState.configuration);

      // Step 4: Restore agent specializations
      if (this.options.includeAgents) {
        await this.restoreAgentSpecializations(sessionState.agents);
      }

      // Step 5: Load cached patterns
      if (this.options.includePatterns) {
        await this.loadCachedPatterns();
      }

      // Step 6: Restore performance metrics
      if (this.options.includeMetrics) {
        await this.restorePerformanceMetrics(sessionState.performanceMetrics);
      }

      // Step 7: Validate restoration
      await this.validateRestoration();

      this.log('Session restoration completed successfully!');

    } catch (error) {
      console.error('Session restoration failed:', error);
      throw error;
    }
  }

  /**
   * Initialize Claude Flow hooks
   */
  private async initializeHooks(): Promise<void> {
    try {
      this.log('Initializing hooks...');

      const sessionId = this.memoryManager['sessionId'];
      await execAsync(`npx claude-flow@alpha hooks session-restore --session-id "${sessionId}"`);

      this.log('Hooks initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize hooks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Restore session state from memory
   */
  private async restoreSessionState(): Promise<SessionState | null> {
    try {
      this.log('Restoring session state...');

      const sessionState = await this.memoryManager.retrieveSessionState();

      if (sessionState) {
        this.log(`Session state restored: ${sessionState.sessionId}`);
        this.log(`- Agents: ${sessionState.agents.length}`);
        this.log(`- Tasks: ${sessionState.taskHistory.length}`);
        this.log(`- Patterns: ${sessionState.patterns.length}`);
      }

      return sessionState;
    } catch (error) {
      console.error('Failed to restore session state:', error);
      return null;
    }
  }

  /**
   * Reinitialize swarm configuration
   */
  private async reinitializeSwarm(config: SwarmConfiguration): Promise<void> {
    try {
      this.log('Reinitializing swarm...');

      // Use provided topology or default from config
      const topology = this.options.swarmTopology || config.topology;

      const initCommand = `npx claude-flow@alpha swarm init --topology "${topology}" --max-agents ${config.maxAgents} --strategy "${config.strategy}"`;
      await execAsync(initCommand);

      // Apply coordination rules if available
      if (config.coordinationRules) {
        for (const [rule, value] of Object.entries(config.coordinationRules)) {
          try {
            const ruleCommand = `npx claude-flow@alpha config set "${rule}" "${JSON.stringify(value)}"`;
            await execAsync(ruleCommand);
          } catch (error) {
            console.warn(`Failed to apply coordination rule ${rule}:`, error);
          }
        }
      }

      this.log(`Swarm reinitialized with topology: ${topology}`);
    } catch (error) {
      throw new Error(`Failed to reinitialize swarm: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Restore agent specializations
   */
  private async restoreAgentSpecializations(agents: any[]): Promise<void> {
    try {
      this.log('Restoring agent specializations...');

      for (const agent of agents) {
        try {
          // Spawn agent with previous specializations
          const spawnCommand = `npx claude-flow@alpha agent spawn --type "${agent.type}" --capabilities "${agent.capabilities.join(',')}"`;
          await execAsync(spawnCommand);

          // Restore agent-specific memory
          await this.memoryManager.storeAgentSpecialization(agent);

          this.log(`Restored agent: ${agent.agentId} (${agent.type})`);
        } catch (error) {
          console.warn(`Failed to restore agent ${agent.agentId}:`, error);
        }
      }

      this.log(`Restored ${agents.length} agent specializations`);
    } catch (error) {
      console.error('Failed to restore agent specializations:', error);
    }
  }

  /**
   * Load cached patterns
   */
  private async loadCachedPatterns(): Promise<void> {
    try {
      this.log('Loading cached patterns...');

      const patterns = await this.memoryManager.retrieveCachedPatterns();

      for (const pattern of patterns) {
        try {
          // Load pattern into neural system
          const loadCommand = `npx claude-flow@alpha neural load-pattern --pattern-id "${pattern.patternId}" --type "${pattern.type}"`;
          await execAsync(loadCommand);

          this.log(`Loaded pattern: ${pattern.patternId} (accuracy: ${pattern.accuracy})`);
        } catch (error) {
          console.warn(`Failed to load pattern ${pattern.patternId}:`, error);
        }
      }

      this.log(`Loaded ${patterns.length} cached patterns`);
    } catch (error) {
      console.error('Failed to load cached patterns:', error);
    }
  }

  /**
   * Restore performance metrics
   */
  private async restorePerformanceMetrics(metrics: any): Promise<void> {
    try {
      this.log('Restoring performance metrics...');

      // Store metrics in current session
      await this.memoryManager.storePerformanceMetrics(metrics);

      // Initialize performance tracking
      const metricsCommand = `npx claude-flow@alpha metrics init --baseline-quality ${metrics.qualityScore} --baseline-efficiency ${metrics.efficiency}`;
      await execAsync(metricsCommand);

      this.log('Performance metrics restored');
    } catch (error) {
      console.error('Failed to restore performance metrics:', error);
    }
  }

  /**
   * Create new session if no previous state found
   */
  private async createNewSession(): Promise<void> {
    try {
      this.log('Creating new session...');

      // Initialize default swarm
      const topology = this.options.swarmTopology || 'mesh';
      const initCommand = `npx claude-flow@alpha swarm init --topology "${topology}" --max-agents 8 --strategy "adaptive"`;
      await execAsync(initCommand);

      // Create initial session state
      const sessionState: SessionState = {
        sessionId: this.memoryManager['sessionId'],
        timestamp: Date.now(),
        agents: [],
        taskHistory: [],
        performanceMetrics: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          averageExecutionTime: 0,
          totalTokensUsed: 0,
          qualityScore: 0,
          efficiency: 0,
          lastUpdated: Date.now()
        },
        patterns: [],
        configuration: {
          topology: topology as any,
          maxAgents: 8,
          strategy: 'adaptive',
          coordinationRules: {},
          memoryNamespace: 'learning-platform'
        }
      };

      await this.memoryManager.storeSessionState(sessionState);

      this.log('New session created successfully');
    } catch (error) {
      throw new Error(`Failed to create new session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate restoration was successful
   */
  private async validateRestoration(): Promise<void> {
    try {
      this.log('Validating restoration...');

      // Check swarm status
      const statusCommand = 'npx claude-flow@alpha swarm status';
      const { stdout: status } = await execAsync(statusCommand);

      if (!status.includes('active')) {
        throw new Error('Swarm is not active after restoration');
      }

      // Check memory connectivity
      const testKey = `test_${Date.now()}`;
      await this.memoryManager['storeMemory'](testKey, 'test_value');
      const testValue = await this.memoryManager['retrieveMemory'](testKey);

      if (testValue !== 'test_value') {
        throw new Error('Memory system not functioning properly');
      }

      // Clean up test
      await this.memoryManager['deleteMemory'](testKey);

      this.log('Validation completed successfully');
    } catch (error) {
      throw new Error(`Restoration validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log message with optional verbose mode
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[SessionRestorer] ${message}`);
    }
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: RestoreOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--session-id':
        options.sessionId = args[++i];
        break;
      case '--topology':
        options.swarmTopology = args[++i] as any;
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
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
Usage: ts-node restore-session.ts [options]

Options:
  --session-id <id>     Specific session ID to restore
  --topology <type>     Override swarm topology (hierarchical|mesh|ring|star)
  --no-agents          Skip agent specializations restoration
  --no-patterns        Skip cached patterns loading
  --no-metrics         Skip performance metrics restoration
  --verbose            Enable verbose logging
  --help               Show this help message
        `);
        process.exit(0);
    }
  }

  try {
    const restorer = new SessionRestorer(options);
    await restorer.restore();
    console.log('Session restoration completed successfully!');
  } catch (error) {
    console.error('Session restoration failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { SessionRestorer, RestoreOptions };

// Run as CLI if called directly
if (require.main === module) {
  main().catch(console.error);
}