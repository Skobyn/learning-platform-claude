/**
 * TypeScript types for memory management system
 */

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
  metrics?: TaskMetrics;
}

export interface TaskMetrics {
  tokensUsed: number;
  executionTime: number;
  qualityScore: number;
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

export interface MemoryEntry {
  key: string;
  value: string;
  ttl?: number;
  timestamp: number;
}

export interface BackupMetadata {
  backupId: string;
  timestamp: number;
  sessionId: string;
  namespace: string;
  totalEntries: number;
  size: number;
  checksum: string;
  options: BackupOptions;
}

export interface BackupOptions {
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

export interface RestoreOptions {
  sessionId?: string;
  includeAgents?: boolean;
  includePatterns?: boolean;
  includeMetrics?: boolean;
  swarmTopology?: 'hierarchical' | 'mesh' | 'ring' | 'star';
  verbose?: boolean;
}

export interface MemorySearchResult {
  key: string;
  value: string;
  score?: number;
}

export interface MemoryNamespace {
  name: string;
  entryCount: number;
  totalSize: number;
  lastAccessed: number;
}

export interface GlobalMetrics {
  totalSessions: number;
  totalTasks: number;
  averageQuality: number;
  averageEfficiency: number;
  lastUpdated: number;
}