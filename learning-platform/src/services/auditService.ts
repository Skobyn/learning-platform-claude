import { prisma } from '@/lib/db';
import { createHash } from 'crypto';

export interface AuditEvent {
  userId?: string;
  sessionId?: string;
  event: string;
  provider?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  metadata?: Record<string, any>;
  timestamp?: Date;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  organizationId?: string;
  resourceId?: string;
  resourceType?: string;
}

export interface SecurityAlert {
  id: string;
  type: 'SUSPICIOUS_LOGIN' | 'MULTIPLE_FAILURES' | 'UNUSUAL_LOCATION' | 'PRIVILEGE_ESCALATION' | 'DATA_BREACH';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string;
  organizationId?: string;
  description: string;
  metadata: Record<string, any>;
  isResolved: boolean;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface AuditQuery {
  userId?: string;
  organizationId?: string;
  event?: string;
  provider?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
  riskLevel?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStatistics {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  uniqueUsers: number;
  uniqueIPs: number;
  eventsByProvider: Record<string, number>;
  eventsByType: Record<string, number>;
  riskDistribution: Record<string, number>;
  topFailureReasons: Array<{ reason: string; count: number }>;
}

class AuditService {
  private alertQueue: SecurityAlert[] = [];
  private suspiciousPatterns: Map<string, number> = new Map();
  private riskThresholds = {
    multipleFailures: 5,
    suspiciousLocationWindow: 60, // minutes
    privilegeEscalationWindow: 30 // minutes
  };

  constructor() {
    // Process alerts periodically
    setInterval(() => {
      this.processSecurityAlerts();
    }, 60 * 1000); // Every minute

    // Clean up old audit logs
    setInterval(() => {
      this.cleanupOldAuditLogs();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Log an authentication event
   */
  async logAuthenticationEvent(event: AuditEvent): Promise<void> {
    try {
      const auditRecord = {
        id: this.generateAuditId(),
        userId: event.userId,
        sessionId: event.sessionId,
        event: event.event,
        provider: event.provider,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        success: event.success,
        metadata: event.metadata || {},
        timestamp: event.timestamp || new Date(),
        riskLevel: event.riskLevel || this.calculateRiskLevel(event),
        organizationId: event.organizationId,
        resourceId: event.resourceId,
        resourceType: event.resourceType
      };

      // Store in database
      await prisma.auditLog.create({
        data: auditRecord
      });

      // Check for security patterns
      await this.analyzeSecurityPatterns(auditRecord);

      // Real-time alerting for critical events
      if (auditRecord.riskLevel === 'CRITICAL' || this.isCriticalEvent(event.event)) {
        await this.generateSecurityAlert(auditRecord);
      }

    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw - audit logging shouldn't break main functionality
    }
  }

  /**
   * Log a data access event
   */
  async logDataAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    action: string,
    success: boolean,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logAuthenticationEvent({
      userId,
      event: `data_${action}`,
      provider: 'DATA_ACCESS',
      success,
      resourceType,
      resourceId,
      riskLevel: this.calculateDataAccessRisk(action, resourceType),
      metadata
    });
  }

  /**
   * Log an administrative action
   */
  async logAdminAction(
    adminUserId: string,
    action: string,
    targetUserId?: string,
    organizationId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logAuthenticationEvent({
      userId: adminUserId,
      event: `admin_${action}`,
      provider: 'ADMIN',
      success: true,
      organizationId,
      riskLevel: this.calculateAdminRisk(action),
      metadata: {
        ...metadata,
        targetUserId,
        adminAction: action
      }
    });
  }

  /**
   * Log a system event
   */
  async logSystemEvent(
    event: string,
    success: boolean,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logAuthenticationEvent({
      event: `system_${event}`,
      provider: 'SYSTEM',
      success,
      riskLevel: success ? 'LOW' : 'MEDIUM',
      metadata
    });
  }

  /**
   * Query audit logs
   */
  async queryAuditLogs(query: AuditQuery): Promise<{
    events: any[];
    total: number;
    hasMore: boolean;
  }> {
    const whereClause: any = {};

    if (query.userId) whereClause.userId = query.userId;
    if (query.organizationId) whereClause.organizationId = query.organizationId;
    if (query.event) whereClause.event = { contains: query.event };
    if (query.provider) whereClause.provider = query.provider;
    if (query.success !== undefined) whereClause.success = query.success;
    if (query.ipAddress) whereClause.ipAddress = query.ipAddress;
    if (query.riskLevel) whereClause.riskLevel = query.riskLevel;

    if (query.startDate || query.endDate) {
      whereClause.timestamp = {};
      if (query.startDate) whereClause.timestamp.gte = query.startDate;
      if (query.endDate) whereClause.timestamp.lte = query.endDate;
    }

    const limit = Math.min(query.limit || 100, 1000); // Max 1000 records
    const offset = query.offset || 0;

    const [events, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      }),
      prisma.auditLog.count({ where: whereClause })
    ]);

    return {
      events,
      total,
      hasMore: offset + limit < total
    };
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(
    organizationId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AuditStatistics> {
    const whereClause: any = {};
    if (organizationId) whereClause.organizationId = organizationId;
    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) whereClause.timestamp.gte = startDate;
      if (endDate) whereClause.timestamp.lte = endDate;
    }

    const [
      totalEvents,
      successfulEvents,
      failedEvents,
      uniqueUsers,
      uniqueIPs,
      eventsByProvider,
      eventsByType,
      riskDistribution,
      failureReasons
    ] = await Promise.all([
      prisma.auditLog.count({ where: whereClause }),
      prisma.auditLog.count({ where: { ...whereClause, success: true } }),
      prisma.auditLog.count({ where: { ...whereClause, success: false } }),
      prisma.auditLog.groupBy({
        by: ['userId'],
        where: { ...whereClause, userId: { not: null } },
        _count: true
      }),
      prisma.auditLog.groupBy({
        by: ['ipAddress'],
        where: { ...whereClause, ipAddress: { not: null } },
        _count: true
      }),
      prisma.auditLog.groupBy({
        by: ['provider'],
        where: whereClause,
        _count: true
      }),
      prisma.auditLog.groupBy({
        by: ['event'],
        where: whereClause,
        _count: true
      }),
      prisma.auditLog.groupBy({
        by: ['riskLevel'],
        where: whereClause,
        _count: true
      }),
      prisma.auditLog.findMany({
        where: { ...whereClause, success: false },
        select: { metadata: true },
        take: 100
      })
    ]);

    // Process group by results
    const providerStats = eventsByProvider.reduce((acc, item) => {
      acc[item.provider || 'unknown'] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const typeStats = eventsByType.reduce((acc, item) => {
      acc[item.event] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const riskStats = riskDistribution.reduce((acc, item) => {
      acc[item.riskLevel || 'unknown'] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // Extract failure reasons
    const reasonCounts = new Map<string, number>();
    failureReasons.forEach(record => {
      const reason = record.metadata?.reason || 'unknown';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const topFailureReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents,
      successfulEvents,
      failedEvents,
      uniqueUsers: uniqueUsers.length,
      uniqueIPs: uniqueIPs.length,
      eventsByProvider: providerStats,
      eventsByType: typeStats,
      riskDistribution: riskStats,
      topFailureReasons
    };
  }

  /**
   * Get security alerts
   */
  async getSecurityAlerts(
    organizationId?: string,
    isResolved?: boolean,
    severity?: string,
    limit: number = 50
  ): Promise<SecurityAlert[]> {
    const whereClause: any = {};
    if (organizationId) whereClause.organizationId = organizationId;
    if (isResolved !== undefined) whereClause.isResolved = isResolved;
    if (severity) whereClause.severity = severity;

    const alerts = await prisma.securityAlert.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return alerts as SecurityAlert[];
  }

  /**
   * Resolve a security alert
   */
  async resolveSecurityAlert(
    alertId: string,
    resolvedBy: string,
    resolution?: string
  ): Promise<boolean> {
    try {
      await prisma.securityAlert.update({
        where: { id: alertId },
        data: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy,
          metadata: {
            resolution
          }
        }
      });

      await this.logAuthenticationEvent({
        userId: resolvedBy,
        event: 'security_alert_resolved',
        provider: 'AUDIT',
        success: true,
        metadata: { alertId, resolution }
      });

      return true;
    } catch (error) {
      console.error('Failed to resolve security alert:', error);
      return false;
    }
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(
    query: AuditQuery,
    format: 'CSV' | 'JSON' = 'JSON'
  ): Promise<string> {
    const result = await this.queryAuditLogs({
      ...query,
      limit: 10000 // Large export limit
    });

    if (format === 'CSV') {
      return this.convertToCSV(result.events);
    } else {
      return JSON.stringify(result.events, null, 2);
    }
  }

  /**
   * Calculate risk level for an event
   */
  private calculateRiskLevel(event: AuditEvent): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    let risk = 0;

    // Failed authentication events are higher risk
    if (!event.success) risk += 2;

    // Certain events are inherently risky
    const highRiskEvents = [
      'password_reset',
      'privilege_escalation',
      'admin_access',
      'data_export',
      'config_change'
    ];
    if (highRiskEvents.some(e => event.event.includes(e))) risk += 3;

    // Multiple failures from same IP
    const ipKey = `failures_${event.ipAddress}`;
    const failureCount = this.suspiciousPatterns.get(ipKey) || 0;
    if (failureCount > 3) risk += 2;

    // MFA-related events
    if (event.event.includes('mfa') && !event.success) risk += 2;

    // Admin actions
    if (event.event.includes('admin')) risk += 1;

    // System events
    if (event.provider === 'SYSTEM' && !event.success) risk += 2;

    if (risk >= 6) return 'CRITICAL';
    if (risk >= 4) return 'HIGH';
    if (risk >= 2) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate data access risk
   */
  private calculateDataAccessRisk(action: string, resourceType: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    let risk = 0;

    // High-value resources
    const highValueResources = ['user_data', 'financial_data', 'pii', 'admin_config'];
    if (highValueResources.includes(resourceType)) risk += 2;

    // Risky actions
    const riskyActions = ['delete', 'export', 'modify'];
    if (riskyActions.includes(action)) risk += 2;

    // Bulk operations
    if (action.includes('bulk')) risk += 1;

    if (risk >= 4) return 'CRITICAL';
    if (risk >= 3) return 'HIGH';
    if (risk >= 1) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate admin action risk
   */
  private calculateAdminRisk(action: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const criticalActions = ['user_delete', 'org_delete', 'config_reset'];
    const highRiskActions = ['privilege_grant', 'permission_change', 'user_impersonate'];
    const mediumRiskActions = ['user_create', 'user_modify', 'setting_change'];

    if (criticalActions.includes(action)) return 'CRITICAL';
    if (highRiskActions.includes(action)) return 'HIGH';
    if (mediumRiskActions.includes(action)) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Check if event is critical
   */
  private isCriticalEvent(event: string): boolean {
    const criticalEvents = [
      'data_breach',
      'unauthorized_access',
      'privilege_escalation',
      'system_compromise',
      'multiple_failures'
    ];

    return criticalEvents.some(e => event.includes(e));
  }

  /**
   * Analyze security patterns
   */
  private async analyzeSecurityPatterns(auditRecord: any): Promise<void> {
    // Track failed attempts per IP
    if (!auditRecord.success && auditRecord.ipAddress) {
      const ipKey = `failures_${auditRecord.ipAddress}`;
      const count = this.suspiciousPatterns.get(ipKey) || 0;
      this.suspiciousPatterns.set(ipKey, count + 1);

      if (count + 1 >= this.riskThresholds.multipleFailures) {
        await this.generateSecurityAlert({
          ...auditRecord,
          riskLevel: 'HIGH'
        });
      }
    } else if (auditRecord.success && auditRecord.ipAddress) {
      // Clear failures on successful auth
      const ipKey = `failures_${auditRecord.ipAddress}`;
      this.suspiciousPatterns.delete(ipKey);
    }

    // Track unusual locations
    if (auditRecord.success && auditRecord.userId && auditRecord.ipAddress) {
      await this.checkUnusualLocation(auditRecord);
    }

    // Track privilege escalations
    if (auditRecord.event.includes('privilege') || auditRecord.event.includes('admin')) {
      await this.checkPrivilegeEscalation(auditRecord);
    }
  }

  /**
   * Check for unusual location access
   */
  private async checkUnusualLocation(auditRecord: any): Promise<void> {
    const recentLogins = await prisma.auditLog.findMany({
      where: {
        userId: auditRecord.userId,
        event: { contains: 'login' },
        success: true,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      orderBy: { timestamp: 'desc' },
      take: 10
    });

    const uniqueIPs = new Set(recentLogins.map(l => l.ipAddress));

    if (uniqueIPs.size > 3 && !uniqueIPs.has(auditRecord.ipAddress)) {
      await this.generateSecurityAlert({
        ...auditRecord,
        riskLevel: 'MEDIUM'
      });
    }
  }

  /**
   * Check for privilege escalation
   */
  private async checkPrivilegeEscalation(auditRecord: any): Promise<void> {
    if (!auditRecord.userId) return;

    const recentPrivilegeEvents = await prisma.auditLog.count({
      where: {
        userId: auditRecord.userId,
        event: { contains: 'privilege' },
        timestamp: {
          gte: new Date(Date.now() - this.riskThresholds.privilegeEscalationWindow * 60 * 1000)
        }
      }
    });

    if (recentPrivilegeEvents > 1) {
      await this.generateSecurityAlert({
        ...auditRecord,
        riskLevel: 'HIGH'
      });
    }
  }

  /**
   * Generate security alert
   */
  private async generateSecurityAlert(auditRecord: any): Promise<void> {
    const alertType = this.determineAlertType(auditRecord);
    const severity = this.mapRiskToSeverity(auditRecord.riskLevel);

    const alert: Omit<SecurityAlert, 'id' | 'createdAt'> = {
      type: alertType,
      severity,
      userId: auditRecord.userId,
      organizationId: auditRecord.organizationId,
      description: this.generateAlertDescription(auditRecord, alertType),
      metadata: {
        auditRecordId: auditRecord.id,
        event: auditRecord.event,
        ipAddress: auditRecord.ipAddress,
        userAgent: auditRecord.userAgent,
        ...auditRecord.metadata
      },
      isResolved: false
    };

    try {
      const createdAlert = await prisma.securityAlert.create({
        data: {
          ...alert,
          id: this.generateAuditId()
        }
      });

      this.alertQueue.push(createdAlert as SecurityAlert);
    } catch (error) {
      console.error('Failed to generate security alert:', error);
    }
  }

  /**
   * Determine alert type
   */
  private determineAlertType(auditRecord: any): SecurityAlert['type'] {
    if (auditRecord.event.includes('login') && !auditRecord.success) {
      const ipKey = `failures_${auditRecord.ipAddress}`;
      const count = this.suspiciousPatterns.get(ipKey) || 0;
      if (count >= this.riskThresholds.multipleFailures) {
        return 'MULTIPLE_FAILURES';
      }
      return 'SUSPICIOUS_LOGIN';
    }

    if (auditRecord.event.includes('privilege')) {
      return 'PRIVILEGE_ESCALATION';
    }

    if (auditRecord.event.includes('data_export') || auditRecord.event.includes('data_breach')) {
      return 'DATA_BREACH';
    }

    return 'SUSPICIOUS_LOGIN';
  }

  /**
   * Map risk level to severity
   */
  private mapRiskToSeverity(riskLevel: string): SecurityAlert['severity'] {
    switch (riskLevel) {
      case 'CRITICAL': return 'CRITICAL';
      case 'HIGH': return 'HIGH';
      case 'MEDIUM': return 'MEDIUM';
      default: return 'LOW';
    }
  }

  /**
   * Generate alert description
   */
  private generateAlertDescription(auditRecord: any, alertType: SecurityAlert['type']): string {
    switch (alertType) {
      case 'MULTIPLE_FAILURES':
        return `Multiple failed authentication attempts detected from IP ${auditRecord.ipAddress}`;
      case 'SUSPICIOUS_LOGIN':
        return `Suspicious login attempt detected for user ${auditRecord.userId}`;
      case 'PRIVILEGE_ESCALATION':
        return `Potential privilege escalation detected for user ${auditRecord.userId}`;
      case 'UNUSUAL_LOCATION':
        return `Login from unusual location detected for user ${auditRecord.userId}`;
      case 'DATA_BREACH':
        return `Potential data breach detected - ${auditRecord.event}`;
      default:
        return `Security event detected: ${auditRecord.event}`;
    }
  }

  /**
   * Process security alerts
   */
  private async processSecurityAlerts(): Promise<void> {
    if (this.alertQueue.length === 0) return;

    const alertsToProcess = [...this.alertQueue];
    this.alertQueue.length = 0;

    for (const alert of alertsToProcess) {
      try {
        // Send notifications, trigger automated responses, etc.
        await this.processAlert(alert);
      } catch (error) {
        console.error('Failed to process security alert:', error);
      }
    }
  }

  /**
   * Process individual alert
   */
  private async processAlert(alert: SecurityAlert): Promise<void> {
    // This is where you would integrate with notification services,
    // SIEM systems, automated response systems, etc.
    console.log(`Security Alert [${alert.severity}]: ${alert.description}`);
  }

  /**
   * Generate audit ID
   */
  private generateAuditId(): string {
    return createHash('sha256')
      .update(Date.now().toString())
      .update(Math.random().toString())
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Convert audit logs to CSV
   */
  private convertToCSV(events: any[]): string {
    if (events.length === 0) return '';

    const headers = ['timestamp', 'userId', 'event', 'provider', 'success', 'ipAddress', 'riskLevel'];
    const rows = events.map(event =>
      headers.map(header => event[header] || '').join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Clean up old audit logs
   */
  private async cleanupOldAuditLogs(): Promise<void> {
    const retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS || '365');
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await prisma.auditLog.deleteMany({
        where: {
          timestamp: { lt: cutoffDate }
        }
      });

      if (result.count > 0) {
        await this.logSystemEvent('audit_cleanup', true, {
          deletedRecords: result.count,
          cutoffDate
        });
      }
    } catch (error) {
      console.error('Failed to clean up old audit logs:', error);
      await this.logSystemEvent('audit_cleanup', false, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const auditService = new AuditService();
export default auditService;