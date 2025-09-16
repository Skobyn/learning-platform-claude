/**
 * Memory Management Module for Learning Platform
 * Integrates with Claude Flow memory system for state management
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Types for memory management
export interface SessionState {
  sessionId: string;
  swarmId?: string;
  timestamp: number;
  agents: AgentSpecialization[];
  taskHistory: TaskHistory[];
  performanceMetrics: PerformanceMetrics;
  patterns: CachedPattern[];
  configuration: SwarmConfiguration;
}

export interface AgentSpecialization {
  agentId: string;
  type: string;
  capabilities: string[];
  performance: number;
  tasksCompleted: number;
  specializations: string[];
  lastActive: number;
}

export interface TaskHistory {
  taskId: string;
  description: string;
  agentId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  result?: any;
  metrics?: {
    tokensUsed: number;
    executionTime: number;
    qualityScore: number;
  };
}

export interface PerformanceMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  totalTokensUsed: number;
  qualityScore: number;
  efficiency: number;
  lastUpdated: number;
}

export interface CachedPattern {
  patternId: string;
  type: 'coordination' | 'optimization' | 'prediction';
  pattern: any;
  accuracy: number;
  usageCount: number;
  lastUsed: number;
}

export interface SwarmConfiguration {
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star';
  maxAgents: number;
  strategy: string;
  coordinationRules: Record<string, any>;
  memoryNamespace: string;
}

export class MemoryManager {
  private readonly namespace: string;
  private readonly sessionId: string;

  constructor(sessionId: string, namespace: string = 'learning-platform') {
    this.sessionId = sessionId;
    this.namespace = namespace;
  }

  /**
   * Store session state in Claude Flow memory
   */
  async storeSessionState(state: SessionState): Promise<void> {
    try {
      const key = `${this.namespace}/session/${this.sessionId}`;
      await this.storeMemory(key, JSON.stringify(state), 24 * 60 * 60); // 24 hours TTL

      // Store individual components for quick access
      await this.storeMemory(`${key}/agents`, JSON.stringify(state.agents), 24 * 60 * 60);
      await this.storeMemory(`${key}/metrics`, JSON.stringify(state.performanceMetrics), 24 * 60 * 60);
      await this.storeMemory(`${key}/config`, JSON.stringify(state.configuration), 24 * 60 * 60);

      console.log(`Session state stored for session: ${this.sessionId}`);
    } catch (error) {
      throw new Error(`Failed to store session state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve session state from Claude Flow memory
   */
  async retrieveSessionState(): Promise<SessionState | null> {
    try {
      const key = `${this.namespace}/session/${this.sessionId}`;
      const stateData = await this.retrieveMemory(key);

      if (!stateData) {
        return null;
      }

      return JSON.parse(stateData) as SessionState;
    } catch (error) {
      console.error(`Failed to retrieve session state: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Store agent specialization data
   */
  async storeAgentSpecialization(agent: AgentSpecialization): Promise<void> {
    try {
      const key = `${this.namespace}/agents/${agent.agentId}`;
      await this.storeMemory(key, JSON.stringify(agent), 7 * 24 * 60 * 60); // 7 days TTL

      console.log(`Agent specialization stored for: ${agent.agentId}`);
    } catch (error) {
      throw new Error(`Failed to store agent specialization: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve agent specialization data
   */
  async retrieveAgentSpecialization(agentId: string): Promise<AgentSpecialization | null> {
    try {
      const key = `${this.namespace}/agents/${agentId}`;
      const agentData = await this.retrieveMemory(key);

      if (!agentData) {
        return null;
      }

      return JSON.parse(agentData) as AgentSpecialization;
    } catch (error) {
      console.error(`Failed to retrieve agent specialization: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Store task history
   */
  async storeTaskHistory(task: TaskHistory): Promise<void> {
    try {
      const key = `${this.namespace}/tasks/${task.taskId}`;
      await this.storeMemory(key, JSON.stringify(task), 30 * 24 * 60 * 60); // 30 days TTL

      // Also store in session-specific task list
      const sessionTasksKey = `${this.namespace}/session/${this.sessionId}/tasks`;
      const existingTasks = await this.retrieveMemory(sessionTasksKey);
      const tasks = existingTasks ? JSON.parse(existingTasks) : [];

      // Update or add task
      const taskIndex = tasks.findIndex((t: TaskHistory) => t.taskId === task.taskId);
      if (taskIndex >= 0) {
        tasks[taskIndex] = task;
      } else {
        tasks.push(task);
      }

      await this.storeMemory(sessionTasksKey, JSON.stringify(tasks), 24 * 60 * 60);

      console.log(`Task history stored for: ${task.taskId}`);
    } catch (error) {
      throw new Error(`Failed to store task history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve task history for session
   */
  async retrieveTaskHistory(): Promise<TaskHistory[]> {
    try {
      const key = `${this.namespace}/session/${this.sessionId}/tasks`;
      const tasksData = await this.retrieveMemory(key);

      if (!tasksData) {
        return [];
      }

      return JSON.parse(tasksData) as TaskHistory[];
    } catch (error) {
      console.error(`Failed to retrieve task history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Store performance metrics
   */
  async storePerformanceMetrics(metrics: PerformanceMetrics): Promise<void> {
    try {
      const key = `${this.namespace}/metrics/${this.sessionId}`;
      await this.storeMemory(key, JSON.stringify(metrics), 7 * 24 * 60 * 60); // 7 days TTL

      // Store global metrics aggregation
      const globalKey = `${this.namespace}/metrics/global`;
      const existingGlobal = await this.retrieveMemory(globalKey);
      const globalMetrics = existingGlobal ? JSON.parse(existingGlobal) : {
        totalSessions: 0,
        totalTasks: 0,
        averageQuality: 0,
        averageEfficiency: 0,
        lastUpdated: 0
      };

      // Update global metrics
      globalMetrics.totalSessions += 1;
      globalMetrics.totalTasks += metrics.totalTasks;
      globalMetrics.averageQuality = (globalMetrics.averageQuality + metrics.qualityScore) / 2;
      globalMetrics.averageEfficiency = (globalMetrics.averageEfficiency + metrics.efficiency) / 2;
      globalMetrics.lastUpdated = Date.now();

      await this.storeMemory(globalKey, JSON.stringify(globalMetrics), 30 * 24 * 60 * 60);

      console.log(`Performance metrics stored for session: ${this.sessionId}`);
    } catch (error) {
      throw new Error(`Failed to store performance metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Store cached pattern
   */
  async storeCachedPattern(pattern: CachedPattern): Promise<void> {
    try {
      const key = `${this.namespace}/patterns/${pattern.patternId}`;
      await this.storeMemory(key, JSON.stringify(pattern), 30 * 24 * 60 * 60); // 30 days TTL

      console.log(`Cached pattern stored: ${pattern.patternId}`);
    } catch (error) {
      throw new Error(`Failed to store cached pattern: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retrieve all cached patterns
   */
  async retrieveCachedPatterns(): Promise<CachedPattern[]> {
    try {
      const patterns = await this.searchMemory(`${this.namespace}/patterns/`);
      return patterns.map(p => JSON.parse(p.value) as CachedPattern);
    } catch (error) {
      console.error(`Failed to retrieve cached patterns: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Clean up expired memory entries
   */
  async cleanupExpiredMemory(): Promise<void> {
    try {
      // This would typically be handled by Claude Flow's TTL mechanism
      // But we can implement additional cleanup logic here
      console.log('Memory cleanup initiated');

      // Clean up old sessions (older than 30 days)
      const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const sessions = await this.searchMemory(`${this.namespace}/session/`);

      for (const session of sessions) {
        try {
          const sessionData = JSON.parse(session.value) as SessionState;
          if (sessionData.timestamp < cutoffTime) {
            await this.deleteMemory(session.key);
            console.log(`Cleaned up expired session: ${sessionData.sessionId}`);
          }
        } catch (error) {
          console.error(`Error cleaning up session ${session.key}: ${error}`);
        }
      }
    } catch (error) {
      console.error(`Memory cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Export memory to JSON format
   */
  async exportMemoryToJSON(): Promise<any> {
    try {
      const allMemory = await this.searchMemory(`${this.namespace}/`);
      const exportData = {
        namespace: this.namespace,
        sessionId: this.sessionId,
        exportTime: Date.now(),
        memory: allMemory.reduce((acc, item) => {
          acc[item.key] = JSON.parse(item.value);
          return acc;
        }, {} as Record<string, any>)
      };

      return exportData;
    } catch (error) {
      throw new Error(`Failed to export memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Private helper methods for Claude Flow integration
  private async storeMemory(key: string, value: string, ttl?: number): Promise<void> {
    try {
      const ttlFlag = ttl ? `--ttl ${ttl}` : '';
      const command = `npx claude-flow@alpha memory store --key "${key}" --value "${value}" ${ttlFlag} --namespace "${this.namespace}"`;
      await execAsync(command);
    } catch (error) {
      throw new Error(`Memory store failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async retrieveMemory(key: string): Promise<string | null> {
    try {
      const command = `npx claude-flow@alpha memory retrieve --key "${key}" --namespace "${this.namespace}"`;
      const { stdout } = await execAsync(command);
      return stdout.trim() || null;
    } catch (error) {
      // Memory key not found is not an error
      return null;
    }
  }

  private async searchMemory(pattern: string): Promise<Array<{key: string, value: string}>> {
    try {
      const command = `npx claude-flow@alpha memory search --pattern "${pattern}" --namespace "${this.namespace}"`;
      const { stdout } = await execAsync(command);

      if (!stdout.trim()) {
        return [];
      }

      return JSON.parse(stdout);
    } catch (error) {
      console.error(`Memory search failed: ${error}`);
      return [];
    }
  }

  private async deleteMemory(key: string): Promise<void> {
    try {
      const command = `npx claude-flow@alpha memory delete --key "${key}" --namespace "${this.namespace}"`;
      await execAsync(command);
    } catch (error) {
      throw new Error(`Memory delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Utility functions
export function createMemoryManager(sessionId?: string): MemoryManager {
  const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  return new MemoryManager(id);
}

export async function getCurrentSessionId(): Promise<string | null> {
  try {
    const command = 'npx claude-flow@alpha hooks session-info --format json';
    const { stdout } = await execAsync(command);
    const sessionInfo = JSON.parse(stdout);
    return sessionInfo.sessionId || null;
  } catch (error) {
    console.error('Failed to get current session ID:', error);
    return null;
  }
}

export default MemoryManager;