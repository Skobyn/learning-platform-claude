import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auditService } from '@/services/auditService';
import geoip from 'geoip-lite';
import { ipRangeCheck } from 'ip-range-check';
import ipaddr from 'ipaddr.js';

export interface IPWhitelistRule {
  id: string;
  organizationId: string;
  name: string;
  ipAddress: string;
  ipRange?: string;
  description?: string;
  isActive: boolean;
  ruleType: 'SINGLE_IP' | 'IP_RANGE' | 'CIDR' | 'COUNTRY' | 'REGION';
  metadata?: {
    country?: string;
    region?: string;
    city?: string;
    isp?: string;
    allowVPN?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IPWhitelistConfig {
  enabled: boolean;
  mode: 'ALLOW' | 'BLOCK'; // Allow only whitelisted IPs, or block blacklisted IPs
  defaultAction: 'ALLOW' | 'BLOCK' | 'CHALLENGE';
  logAllAttempts: boolean;
  enforceForAdmins: boolean;
  exemptLocalNetwork: boolean;
  maxFailedAttempts: number;
  blockDurationMinutes: number;
}

export interface IPValidationResult {
  allowed: boolean;
  reason: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  geoLocation?: {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
  };
  metadata?: any;
}

class IPWhitelistMiddleware {
  private blockedIPs: Map<string, Date> = new Map();
  private failedAttempts: Map<string, number> = new Map();

  /**
   * Main middleware function for IP whitelisting
   */
  async checkIPWhitelist(
    req: NextRequest,
    organizationId?: string,
    userId?: string
  ): Promise<IPValidationResult> {
    const clientIP = this.getClientIP(req);
    const userAgent = req.headers.get('User-Agent') || '';

    // Get geo location
    const geoData = geoip.lookup(clientIP);
    const geoLocation = geoData ? {
      country: geoData.country,
      region: geoData.region,
      city: geoData.city,
      timezone: geoData.timezone
    } : undefined;

    try {
      // Check if IP is temporarily blocked
      if (this.isIPBlocked(clientIP)) {
        await this.logIPAttempt(clientIP, false, 'IP_BLOCKED', {
          userAgent,
          geoLocation,
          userId,
          organizationId
        });

        return {
          allowed: false,
          reason: 'IP temporarily blocked due to repeated violations',
          riskLevel: 'HIGH',
          geoLocation
        };
      }

      // Get organization whitelist configuration
      const config = await this.getWhitelistConfig(organizationId);

      if (!config.enabled) {
        return {
          allowed: true,
          reason: 'IP whitelisting disabled',
          riskLevel: 'LOW',
          geoLocation
        };
      }

      // Exempt local network if configured
      if (config.exemptLocalNetwork && this.isLocalNetwork(clientIP)) {
        return {
          allowed: true,
          reason: 'Local network exemption',
          riskLevel: 'LOW',
          geoLocation
        };
      }

      // Get whitelist rules for organization
      const rules = await this.getWhitelistRules(organizationId);

      // Validate IP against rules
      const validation = await this.validateIPAgainstRules(
        clientIP,
        rules,
        config,
        geoLocation
      );

      // Log the attempt
      await this.logIPAttempt(clientIP, validation.allowed, validation.reason, {
        userAgent,
        geoLocation,
        userId,
        organizationId,
        riskLevel: validation.riskLevel
      });

      // Handle failed attempts
      if (!validation.allowed) {
        this.handleFailedAttempt(clientIP, config);
      } else {
        // Clear failed attempts on success
        this.failedAttempts.delete(clientIP);
      }

      return validation;

    } catch (error) {
      console.error('IP whitelist validation error:', error);

      // Log error and allow by default (fail-open for availability)
      await this.logIPAttempt(clientIP, true, 'VALIDATION_ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userAgent,
        geoLocation,
        userId,
        organizationId
      });

      return {
        allowed: true,
        reason: 'Validation error - allowing by default',
        riskLevel: 'MEDIUM',
        geoLocation
      };
    }
  }

  /**
   * Validate IP against whitelist rules
   */
  private async validateIPAgainstRules(
    clientIP: string,
    rules: IPWhitelistRule[],
    config: IPWhitelistConfig,
    geoLocation?: any
  ): Promise<IPValidationResult> {
    let matched = false;
    let matchReason = '';
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

    // Check each rule
    for (const rule of rules.filter(r => r.isActive)) {
      const ruleMatch = this.checkRuleMatch(clientIP, rule, geoLocation);

      if (ruleMatch.matches) {
        matched = true;
        matchReason = ruleMatch.reason;
        riskLevel = this.calculateRiskLevel(rule, geoLocation);
        break;
      }
    }

    // Apply configuration logic
    if (config.mode === 'ALLOW') {
      // Whitelist mode - only allow matched IPs
      return {
        allowed: matched,
        reason: matched ? matchReason : 'IP not in whitelist',
        riskLevel: matched ? riskLevel : 'HIGH',
        geoLocation
      };
    } else {
      // Blacklist mode - block matched IPs
      return {
        allowed: !matched,
        reason: matched ? `Blocked: ${matchReason}` : 'IP not in blacklist',
        riskLevel: matched ? 'HIGH' : 'LOW',
        geoLocation
      };
    }
  }

  /**
   * Check if IP matches a specific rule
   */
  private checkRuleMatch(
    clientIP: string,
    rule: IPWhitelistRule,
    geoLocation?: any
  ): { matches: boolean; reason: string } {
    try {
      switch (rule.ruleType) {
        case 'SINGLE_IP':
          if (clientIP === rule.ipAddress) {
            return { matches: true, reason: `Exact IP match: ${rule.name}` };
          }
          break;

        case 'IP_RANGE':
          if (rule.ipRange && this.isIPInRange(clientIP, rule.ipRange)) {
            return { matches: true, reason: `IP range match: ${rule.name}` };
          }
          break;

        case 'CIDR':
          if (rule.ipAddress && this.isIPInCIDR(clientIP, rule.ipAddress)) {
            return { matches: true, reason: `CIDR match: ${rule.name}` };
          }
          break;

        case 'COUNTRY':
          if (geoLocation?.country === rule.metadata?.country) {
            return { matches: true, reason: `Country match: ${rule.name}` };
          }
          break;

        case 'REGION':
          if (geoLocation?.region === rule.metadata?.region &&
              geoLocation?.country === rule.metadata?.country) {
            return { matches: true, reason: `Region match: ${rule.name}` };
          }
          break;
      }

      return { matches: false, reason: 'No match' };
    } catch (error) {
      console.error(`Error checking rule ${rule.id}:`, error);
      return { matches: false, reason: 'Rule evaluation error' };
    }
  }

  /**
   * Check if IP is in range
   */
  private isIPInRange(ip: string, range: string): boolean {
    try {
      const [startIP, endIP] = range.split('-').map(ip => ip.trim());
      return ipRangeCheck(ip, [startIP, endIP]);
    } catch (error) {
      console.error('IP range check error:', error);
      return false;
    }
  }

  /**
   * Check if IP is in CIDR
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    try {
      const addr = ipaddr.process(ip);
      const cidrAddr = ipaddr.process(cidr);
      return addr.match(cidrAddr);
    } catch (error) {
      console.error('CIDR check error:', error);
      return false;
    }
  }

  /**
   * Check if IP is local network
   */
  private isLocalNetwork(ip: string): boolean {
    const localRanges = [
      '127.0.0.0/8',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '::1/128',
      'fc00::/7'
    ];

    return localRanges.some(range => {
      try {
        return this.isIPInCIDR(ip, range);
      } catch {
        return false;
      }
    });
  }

  /**
   * Calculate risk level based on rule and location
   */
  private calculateRiskLevel(rule: IPWhitelistRule, geoLocation?: any): 'LOW' | 'MEDIUM' | 'HIGH' {
    // Known good IPs/ranges are low risk
    if (rule.ruleType === 'SINGLE_IP' || rule.ruleType === 'IP_RANGE') {
      return 'LOW';
    }

    // Country-based rules have medium risk
    if (rule.ruleType === 'COUNTRY') {
      const highRiskCountries = ['CN', 'RU', 'NK', 'IR'];
      if (highRiskCountries.includes(geoLocation?.country)) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    return 'MEDIUM';
  }

  /**
   * Handle failed IP validation attempts
   */
  private handleFailedAttempt(clientIP: string, config: IPWhitelistConfig): void {
    const attempts = this.failedAttempts.get(clientIP) || 0;
    this.failedAttempts.set(clientIP, attempts + 1);

    if (attempts + 1 >= config.maxFailedAttempts) {
      const blockUntil = new Date(Date.now() + config.blockDurationMinutes * 60 * 1000);
      this.blockedIPs.set(clientIP, blockUntil);
      this.failedAttempts.delete(clientIP); // Reset counter after blocking
    }
  }

  /**
   * Check if IP is currently blocked
   */
  private isIPBlocked(ip: string): boolean {
    const blockUntil = this.blockedIPs.get(ip);
    if (!blockUntil) return false;

    if (new Date() > blockUntil) {
      this.blockedIPs.delete(ip);
      return false;
    }

    return true;
  }

  /**
   * Get client IP address from request
   */
  private getClientIP(req: NextRequest): string {
    // Check various headers for the real client IP
    const headers = [
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
      'cf-connecting-ip', // Cloudflare
      'x-forwarded',
      'forwarded-for',
      'forwarded'
    ];

    for (const header of headers) {
      const value = req.headers.get(header);
      if (value) {
        // X-Forwarded-For can contain multiple IPs, take the first one
        const ip = value.split(',')[0].trim();
        if (this.isValidIP(ip)) {
          return ip;
        }
      }
    }

    // Fallback to connection IP
    return req.ip || '0.0.0.0';
  }

  /**
   * Validate IP address format
   */
  private isValidIP(ip: string): boolean {
    try {
      ipaddr.process(ip);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get whitelist configuration for organization
   */
  private async getWhitelistConfig(organizationId?: string): Promise<IPWhitelistConfig> {
    const defaultConfig: IPWhitelistConfig = {
      enabled: false,
      mode: 'ALLOW',
      defaultAction: 'BLOCK',
      logAllAttempts: true,
      enforceForAdmins: false,
      exemptLocalNetwork: true,
      maxFailedAttempts: 5,
      blockDurationMinutes: 15
    };

    if (!organizationId) {
      return defaultConfig;
    }

    try {
      const orgSettings = await prisma.organization.findUnique({
        where: { id: organizationId },
        include: { settings: true }
      });

      return {
        ...defaultConfig,
        ...(orgSettings?.settings?.ipWhitelist || {})
      };
    } catch (error) {
      console.error('Error fetching whitelist config:', error);
      return defaultConfig;
    }
  }

  /**
   * Get whitelist rules for organization
   */
  private async getWhitelistRules(organizationId?: string): Promise<IPWhitelistRule[]> {
    if (!organizationId) {
      return [];
    }

    try {
      const rules = await prisma.ipWhitelistRule.findMany({
        where: {
          organizationId,
          isActive: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      return rules as IPWhitelistRule[];
    } catch (error) {
      console.error('Error fetching whitelist rules:', error);
      return [];
    }
  }

  /**
   * Log IP access attempt
   */
  private async logIPAttempt(
    ip: string,
    allowed: boolean,
    reason: string,
    metadata: any
  ): Promise<void> {
    try {
      await auditService.logAuthenticationEvent({
        userId: metadata.userId || ip,
        event: allowed ? 'ip_whitelist_allowed' : 'ip_whitelist_denied',
        provider: 'IP_WHITELIST',
        ipAddress: ip,
        userAgent: metadata.userAgent,
        success: allowed,
        metadata: {
          reason,
          geoLocation: metadata.geoLocation,
          riskLevel: metadata.riskLevel,
          organizationId: metadata.organizationId,
          error: metadata.error
        }
      });
    } catch (error) {
      console.error('Error logging IP attempt:', error);
    }
  }

  /**
   * Create IP whitelist rule
   */
  async createIPWhitelistRule(
    organizationId: string,
    rule: Omit<IPWhitelistRule, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IPWhitelistRule> {
    const created = await prisma.ipWhitelistRule.create({
      data: {
        ...rule,
        organizationId
      }
    });

    await auditService.logAuthenticationEvent({
      userId: 'system',
      event: 'ip_whitelist_rule_created',
      provider: 'IP_WHITELIST',
      success: true,
      metadata: {
        ruleId: created.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        organizationId
      }
    });

    return created as IPWhitelistRule;
  }

  /**
   * Update IP whitelist rule
   */
  async updateIPWhitelistRule(
    ruleId: string,
    updates: Partial<IPWhitelistRule>
  ): Promise<IPWhitelistRule> {
    const updated = await prisma.ipWhitelistRule.update({
      where: { id: ruleId },
      data: updates
    });

    await auditService.logAuthenticationEvent({
      userId: 'system',
      event: 'ip_whitelist_rule_updated',
      provider: 'IP_WHITELIST',
      success: true,
      metadata: {
        ruleId,
        updates
      }
    });

    return updated as IPWhitelistRule;
  }

  /**
   * Delete IP whitelist rule
   */
  async deleteIPWhitelistRule(ruleId: string): Promise<boolean> {
    try {
      const rule = await prisma.ipWhitelistRule.findUnique({
        where: { id: ruleId }
      });

      if (!rule) return false;

      await prisma.ipWhitelistRule.delete({
        where: { id: ruleId }
      });

      await auditService.logAuthenticationEvent({
        userId: 'system',
        event: 'ip_whitelist_rule_deleted',
        provider: 'IP_WHITELIST',
        success: true,
        metadata: {
          ruleId,
          ruleName: rule.name
        }
      });

      return true;
    } catch (error) {
      console.error('Error deleting IP whitelist rule:', error);
      return false;
    }
  }

  /**
   * Get blocked IPs (for admin interface)
   */
  getBlockedIPs(): Array<{ ip: string; blockedUntil: Date }> {
    const result: Array<{ ip: string; blockedUntil: Date }> = [];

    for (const [ip, blockedUntil] of this.blockedIPs.entries()) {
      if (new Date() <= blockedUntil) {
        result.push({ ip, blockedUntil });
      }
    }

    return result;
  }

  /**
   * Manually unblock IP (admin function)
   */
  async unblockIP(ip: string, adminUserId: string): Promise<boolean> {
    if (this.blockedIPs.has(ip)) {
      this.blockedIPs.delete(ip);
      this.failedAttempts.delete(ip);

      await auditService.logAuthenticationEvent({
        userId: adminUserId,
        event: 'ip_manually_unblocked',
        provider: 'IP_WHITELIST',
        ipAddress: ip,
        success: true,
        metadata: { unblocked_ip: ip }
      });

      return true;
    }

    return false;
  }

  /**
   * Clean up expired blocks (should be called periodically)
   */
  cleanupExpiredBlocks(): number {
    let cleaned = 0;
    const now = new Date();

    for (const [ip, blockedUntil] of this.blockedIPs.entries()) {
      if (now > blockedUntil) {
        this.blockedIPs.delete(ip);
        cleaned++;
      }
    }

    return cleaned;
  }
}

export const ipWhitelistMiddleware = new IPWhitelistMiddleware();
export default ipWhitelistMiddleware;