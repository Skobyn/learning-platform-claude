import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { MfaMethod, TrustLevel } from '@prisma/client';
import { MFASetup, MFAVerification, MFASettings, MFAError } from '@/types/enterprise';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import crypto from 'crypto';
import speakeasy from 'speakeasy';

class MFAService {
  private readonly BACKUP_CODE_LENGTH = 10;
  private readonly BACKUP_CODE_COUNT = 10;
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 60; // 30 minutes

  /**
   * Setup TOTP MFA for user
   */
  async setupTOTP(userId: string): Promise<MFASetup> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true }
    });

    if (!user) {
      throw new MFAError('User not found');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${user.firstName} ${user.lastName} (${user.email})`,
      issuer: process.env.APP_NAME || 'Learning Platform',
      length: 32
    });

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();

    // Create QR code URL
    const qrCodeUrl = await toDataURL(secret.otpauth_url!);

    // Store temporary setup data (not yet enabled)
    await redis.set(
      `mfa_setup:${userId}`,
      JSON.stringify({
        secret: secret.base32,
        backupCodes: backupCodes.map(code => this.hashBackupCode(code))
      }),
      'EX',
      15 * 60 // 15 minutes
    );

    return {
      secret: secret.base32!,
      qrCodeUrl,
      backupCodes
    };
  }

  /**
   * Verify and enable TOTP MFA
   */
  async enableTOTP(userId: string, token: string): Promise<MFASettings> {
    const setupData = await redis.get(`mfa_setup:${userId}`);
    if (!setupData) {
      throw new MFAError('MFA setup not found or expired');
    }

    const { secret, backupCodes } = JSON.parse(setupData);

    // Verify the token
    const isValid = speakeasy.totp.verify({
      secret,
      token,
      window: 2, // Allow 2 time steps of variance
      encoding: 'base32'
    });

    if (!isValid) {
      throw new MFAError('Invalid MFA token');
    }

    // Save MFA settings to database
    const mfaSettings = await prisma.mfaSetting.upsert({
      where: { userId },
      update: {
        isEnabled: true,
        method: MfaMethod.TOTP,
        secret: this.encryptSecret(secret),
        backupCodes,
        failedAttempts: 0,
        lastFailedAt: null
      },
      create: {
        userId,
        isEnabled: true,
        method: MfaMethod.TOTP,
        secret: this.encryptSecret(secret),
        backupCodes
      }
    });

    // Update user to require 2FA
    await prisma.user.update({
      where: { id: userId },
      data: { requires2FA: true }
    });

    // Clean up temporary setup data
    await redis.del(`mfa_setup:${userId}`);

    return {
      isEnabled: mfaSettings.isEnabled,
      method: mfaSettings.method,
      backupCodes: [], // Don't return actual backup codes
      lastUsedAt: mfaSettings.lastUsedAt,
      failedAttempts: mfaSettings.failedAttempts,
      lastFailedAt: mfaSettings.lastFailedAt
    };
  }

  /**
   * Verify MFA token
   */
  async verifyMFA(userId: string, verification: MFAVerification): Promise<boolean> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings || !mfaSettings.isEnabled) {
      throw new MFAError('MFA not enabled for user');
    }

    // Check if user is locked out
    if (mfaSettings.failedAttempts >= this.MAX_FAILED_ATTEMPTS) {
      const lockoutExpiry = mfaSettings.lastFailedAt
        ? new Date(mfaSettings.lastFailedAt.getTime() + this.LOCKOUT_DURATION * 1000)
        : new Date();

      if (new Date() < lockoutExpiry) {
        throw new MFAError(`Account locked due to too many failed MFA attempts. Try again after ${Math.ceil((lockoutExpiry.getTime() - Date.now()) / 60000)} minutes`);
      }
    }

    let isValid = false;

    if (verification.backupCode) {
      // Verify backup code
      isValid = await this.verifyBackupCode(userId, verification.token);
    } else {
      // Verify TOTP token
      const decryptedSecret = this.decryptSecret(mfaSettings.secret);
      isValid = speakeasy.totp.verify({
        secret: decryptedSecret,
        token: verification.token,
        window: 2,
        encoding: 'base32'
      });

      // Prevent replay attacks
      if (isValid) {
        const replayKey = `mfa_token:${userId}:${verification.token}`;
        const wasUsed = await redis.get(replayKey);
        if (wasUsed) {
          isValid = false;
        } else {
          // Mark token as used for 90 seconds (3 time windows)
          await redis.set(replayKey, '1', 'EX', 90);
        }
      }
    }

    if (isValid) {
      // Reset failed attempts on successful verification
      await prisma.mfaSetting.update({
        where: { userId },
        data: {
          failedAttempts: 0,
          lastUsedAt: new Date(),
          lastFailedAt: null
        }
      });

      // Log successful MFA verification
      await this.logMFAEvent(userId, 'MFA_SUCCESS', { method: mfaSettings.method });
    } else {
      // Increment failed attempts
      await prisma.mfaSetting.update({
        where: { userId },
        data: {
          failedAttempts: { increment: 1 },
          lastFailedAt: new Date()
        }
      });

      // Log failed MFA verification
      await this.logMFAEvent(userId, 'MFA_FAILED', {
        method: mfaSettings.method,
        failedAttempts: mfaSettings.failedAttempts + 1
      });

      throw new MFAError('Invalid MFA token');
    }

    return isValid;
  }

  /**
   * Disable MFA for user
   */
  async disableMFA(userId: string, currentPassword?: string): Promise<void> {
    // Verify current password if provided
    if (currentPassword) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { hashedPassword: true }
      });

      if (!user?.hashedPassword) {
        throw new MFAError('User not found or no password set');
      }

      const bcrypt = await import('bcryptjs');
      const isValidPassword = await bcrypt.compare(currentPassword, user.hashedPassword);

      if (!isValidPassword) {
        throw new MFAError('Invalid current password');
      }
    }

    // Disable MFA
    await prisma.mfaSetting.update({
      where: { userId },
      data: { isEnabled: false }
    });

    // Update user to not require 2FA
    await prisma.user.update({
      where: { id: userId },
      data: { requires2FA: false }
    });

    // Log MFA disabled event
    await this.logMFAEvent(userId, 'MFA_DISABLED', {});
  }

  /**
   * Generate new backup codes
   */
  async generateNewBackupCodes(userId: string): Promise<string[]> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings || !mfaSettings.isEnabled) {
      throw new MFAError('MFA not enabled for user');
    }

    const newBackupCodes = this.generateBackupCodes();
    const hashedCodes = newBackupCodes.map(code => this.hashBackupCode(code));

    await prisma.mfaSetting.update({
      where: { userId },
      data: { backupCodes: hashedCodes }
    });

    // Log backup codes regenerated
    await this.logMFAEvent(userId, 'MFA_BACKUP_CODES_GENERATED', {});

    return newBackupCodes;
  }

  /**
   * Get MFA settings for user
   */
  async getMFASettings(userId: string): Promise<MFASettings | null> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings) {
      return null;
    }

    return {
      isEnabled: mfaSettings.isEnabled,
      method: mfaSettings.method,
      backupCodes: [], // Never return actual backup codes
      lastUsedAt: mfaSettings.lastUsedAt,
      failedAttempts: mfaSettings.failedAttempts,
      lastFailedAt: mfaSettings.lastFailedAt
    };
  }

  /**
   * Check if user has MFA enabled
   */
  async hasMFAEnabled(userId: string): Promise<boolean> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId },
      select: { isEnabled: true }
    });

    return mfaSettings?.isEnabled || false;
  }

  /**
   * Verify backup code
   */
  private async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings) {
      return false;
    }

    const hashedCode = this.hashBackupCode(code);
    const codeIndex = mfaSettings.backupCodes.indexOf(hashedCode);

    if (codeIndex === -1) {
      return false;
    }

    // Remove used backup code
    const updatedCodes = [...mfaSettings.backupCodes];
    updatedCodes.splice(codeIndex, 1);

    await prisma.mfaSetting.update({
      where: { userId },
      data: { backupCodes: updatedCodes }
    });

    return true;
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];

    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      let code = '';
      for (let j = 0; j < this.BACKUP_CODE_LENGTH; j++) {
        code += Math.floor(Math.random() * 10).toString();
      }
      codes.push(code);
    }

    return codes;
  }

  /**
   * Hash backup code for secure storage
   */
  private hashBackupCode(code: string): string {
    return crypto
      .createHash('sha256')
      .update(code + process.env.MFA_SALT)
      .digest('hex');
  }

  /**
   * Encrypt MFA secret
   */
  private encryptSecret(secret: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.MFA_ENCRYPTION_KEY || 'default-mfa-key', 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipher(algorithm, key);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt MFA secret
   */
  private decryptSecret(encryptedSecret: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.MFA_ENCRYPTION_KEY || 'default-mfa-key', 'salt', 32);

    const parts = encryptedSecret.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Log MFA events for audit trail
   */
  private async logMFAEvent(userId: string, event: string, metadata: Record<string, any>): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          event,
          provider: 'MFA',
          success: event.includes('SUCCESS'),
          metadata,
          timestamp: new Date(),
          riskLevel: event.includes('FAILED') ? 'MEDIUM' : 'LOW'
        }
      });
    } catch (error) {
      console.error('Failed to log MFA event:', error);
    }
  }

  /**
   * Check if device should skip MFA (trusted device)
   */
  async shouldSkipMFA(userId: string, deviceFingerprint: string): Promise<boolean> {
    const trustedDevice = await prisma.trustedDevice.findFirst({
      where: {
        userId,
        fingerprint: deviceFingerprint,
        isTrusted: true,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });

    if (trustedDevice) {
      // Update last used timestamp
      await prisma.trustedDevice.update({
        where: { id: trustedDevice.id },
        data: { lastUsedAt: new Date() }
      });

      return trustedDevice.trustLevel === TrustLevel.HIGH || trustedDevice.trustLevel === TrustLevel.VERIFIED;
    }

    return false;
  }

  /**
   * Mark device as trusted after successful MFA
   */
  async markDeviceAsTrusted(
    userId: string,
    deviceFingerprint: string,
    deviceName: string,
    trustDuration: number = 30 // days
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + trustDuration * 24 * 60 * 60 * 1000);

    await prisma.trustedDevice.upsert({
      where: {
        userId_fingerprint: {
          userId,
          fingerprint: deviceFingerprint
        }
      },
      update: {
        isTrusted: true,
        trustLevel: TrustLevel.MEDIUM,
        lastUsedAt: new Date(),
        expiresAt
      },
      create: {
        userId,
        fingerprint: deviceFingerprint,
        name: deviceName,
        deviceInfo: {},
        isTrusted: true,
        trustLevel: TrustLevel.MEDIUM,
        expiresAt
      }
    });
  }

  /**
   * Get MFA statistics for organization
   */
  async getMFAStatistics(organizationId: string): Promise<{
    totalUsers: number;
    mfaEnabledUsers: number;
    mfaEnabledPercentage: number;
    recentMFAEvents: number;
  }> {
    const [totalUsers, mfaEnabledUsers, recentEvents] = await Promise.all([
      prisma.user.count({
        where: { organizationId }
      }),
      prisma.user.count({
        where: {
          organizationId,
          requires2FA: true
        }
      }),
      prisma.auditLog.count({
        where: {
          event: { in: ['MFA_SUCCESS', 'MFA_FAILED'] },
          timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
        }
      })
    ]);

    return {
      totalUsers,
      mfaEnabledUsers,
      mfaEnabledPercentage: totalUsers > 0 ? Math.round((mfaEnabledUsers / totalUsers) * 100) : 0,
      recentMFAEvents: recentEvents
    };
  }
}

export const mfaService = new MFAService();
export default mfaService;