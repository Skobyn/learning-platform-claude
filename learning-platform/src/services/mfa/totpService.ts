import { authenticator, totp } from 'otplib';
import * as speakeasy from 'speakeasy';
import { prisma } from '@/lib/db';
import { auditService } from '../auditService';
import { createHash, randomBytes } from 'crypto';
import QRCode from 'qrcode';

export interface MFASetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
  manualEntryKey: string;
}

export interface MFAVerificationResult {
  success: boolean;
  usedBackupCode?: boolean;
  remainingBackupCodes?: number;
  error?: string;
}

export interface TOTPConfig {
  issuer: string;
  algorithm: 'sha1' | 'sha256' | 'sha512';
  digits: 6 | 8;
  period: number;
  window: number;
}

class TOTPService {
  private config: TOTPConfig;

  constructor() {
    this.config = {
      issuer: process.env.MFA_ISSUER || 'Learning Platform',
      algorithm: 'sha1',
      digits: 6,
      period: 30,
      window: 2
    };

    // Configure otplib
    authenticator.options = {
      issuer: this.config.issuer,
      algorithm: this.config.algorithm,
      digits: this.config.digits,
      period: this.config.period,
      window: this.config.window
    };
  }

  /**
   * Setup MFA for a user
   */
  async setupMFA(userId: string, userEmail: string): Promise<MFASetupResult> {
    // Generate secret
    const secret = authenticator.generateSecret();

    // Create service name for QR code
    const serviceName = `${this.config.issuer} (${userEmail})`;

    // Generate QR code URL
    const otpauthUrl = authenticator.keyuri(userEmail, this.config.issuer, secret);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => this.hashBackupCode(code));

    // Store MFA settings (but don't enable yet)
    await prisma.mfaSetting.upsert({
      where: { userId },
      update: {
        secret,
        backupCodes: hashedBackupCodes,
        isEnabled: false, // Will be enabled after verification
        lastUsedAt: null,
        failedAttempts: 0
      },
      create: {
        userId,
        secret,
        backupCodes: hashedBackupCodes,
        isEnabled: false,
        method: 'TOTP',
        failedAttempts: 0
      }
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Log MFA setup attempt
    await auditService.logAuthenticationEvent({
      userId: userEmail,
      event: 'mfa_setup_initiated',
      provider: 'TOTP',
      success: true,
      metadata: { method: 'TOTP' }
    });

    return {
      secret,
      qrCodeUrl,
      backupCodes,
      manualEntryKey: secret
    };
  }

  /**
   * Verify TOTP token and enable MFA
   */
  async verifyAndEnableMFA(
    userId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<MFAVerificationResult> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings) {
      return { success: false, error: 'MFA not set up' };
    }

    if (mfaSettings.isEnabled) {
      return { success: false, error: 'MFA already enabled' };
    }

    // Verify token
    const isValid = authenticator.check(token, mfaSettings.secret);

    if (isValid) {
      // Enable MFA
      await prisma.mfaSetting.update({
        where: { userId },
        data: {
          isEnabled: true,
          lastUsedAt: new Date(),
          failedAttempts: 0
        }
      });

      // Log successful MFA enablement
      await auditService.logAuthenticationEvent({
        userId,
        event: 'mfa_enabled',
        provider: 'TOTP',
        ipAddress,
        userAgent,
        success: true
      });

      return { success: true };
    } else {
      // Increment failed attempts
      await prisma.mfaSetting.update({
        where: { userId },
        data: {
          failedAttempts: { increment: 1 }
        }
      });

      // Log failed attempt
      await auditService.logAuthenticationEvent({
        userId,
        event: 'mfa_verification_failed',
        provider: 'TOTP',
        ipAddress,
        userAgent,
        success: false,
        metadata: { reason: 'invalid_token' }
      });

      return { success: false, error: 'Invalid verification code' };
    }
  }

  /**
   * Verify TOTP token for authentication
   */
  async verifyTOTP(
    userId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<MFAVerificationResult> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!mfaSettings || !mfaSettings.isEnabled) {
      return { success: false, error: 'MFA not enabled' };
    }

    // Check if account is locked due to too many failed attempts
    if (mfaSettings.failedAttempts >= 5) {
      const lockoutTime = 15 * 60 * 1000; // 15 minutes
      const timeSinceLastAttempt = Date.now() - (mfaSettings.lastFailedAt?.getTime() || 0);

      if (timeSinceLastAttempt < lockoutTime) {
        await auditService.logAuthenticationEvent({
          userId: mfaSettings.user.email,
          event: 'mfa_account_locked',
          provider: 'TOTP',
          ipAddress,
          userAgent,
          success: false,
          metadata: { lockoutRemaining: Math.ceil((lockoutTime - timeSinceLastAttempt) / 1000) }
        });

        return {
          success: false,
          error: `Account temporarily locked. Try again in ${Math.ceil((lockoutTime - timeSinceLastAttempt) / 60000)} minutes.`
        };
      } else {
        // Reset failed attempts after lockout period
        await prisma.mfaSetting.update({
          where: { userId },
          data: { failedAttempts: 0 }
        });
      }
    }

    // First try to verify as TOTP token
    const isValidTOTP = authenticator.check(token, mfaSettings.secret);

    if (isValidTOTP) {
      // Update successful verification
      await prisma.mfaSetting.update({
        where: { userId },
        data: {
          lastUsedAt: new Date(),
          failedAttempts: 0
        }
      });

      // Log successful verification
      await auditService.logAuthenticationEvent({
        userId: mfaSettings.user.email,
        event: 'mfa_verification_success',
        provider: 'TOTP',
        ipAddress,
        userAgent,
        success: true,
        metadata: { method: 'totp' }
      });

      return { success: true };
    }

    // If TOTP failed, try backup codes
    const backupResult = await this.verifyBackupCode(userId, token, ipAddress, userAgent);
    if (backupResult.success) {
      return backupResult;
    }

    // Both TOTP and backup code failed
    await prisma.mfaSetting.update({
      where: { userId },
      data: {
        failedAttempts: { increment: 1 },
        lastFailedAt: new Date()
      }
    });

    // Log failed verification
    await auditService.logAuthenticationEvent({
      userId: mfaSettings.user.email,
      event: 'mfa_verification_failed',
      provider: 'TOTP',
      ipAddress,
      userAgent,
      success: false,
      metadata: { reason: 'invalid_code_and_backup' }
    });

    return { success: false, error: 'Invalid verification code' };
  }

  /**
   * Verify backup code
   */
  async verifyBackupCode(
    userId: string,
    code: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<MFAVerificationResult> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!mfaSettings) {
      return { success: false, error: 'MFA not set up' };
    }

    const hashedCode = this.hashBackupCode(code);
    const codeIndex = mfaSettings.backupCodes.indexOf(hashedCode);

    if (codeIndex === -1) {
      return { success: false, error: 'Invalid backup code' };
    }

    // Remove used backup code
    const updatedBackupCodes = [...mfaSettings.backupCodes];
    updatedBackupCodes.splice(codeIndex, 1);

    await prisma.mfaSetting.update({
      where: { userId },
      data: {
        backupCodes: updatedBackupCodes,
        lastUsedAt: new Date(),
        failedAttempts: 0
      }
    });

    // Log successful backup code usage
    await auditService.logAuthenticationEvent({
      userId: mfaSettings.user.email,
      event: 'mfa_backup_code_used',
      provider: 'TOTP',
      ipAddress,
      userAgent,
      success: true,
      metadata: {
        remainingCodes: updatedBackupCodes.length,
        method: 'backup_code'
      }
    });

    return {
      success: true,
      usedBackupCode: true,
      remainingBackupCodes: updatedBackupCodes.length
    };
  }

  /**
   * Generate new backup codes
   */
  async generateNewBackupCodes(userId: string): Promise<string[]> {
    const backupCodes = this.generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => this.hashBackupCode(code));

    await prisma.mfaSetting.update({
      where: { userId },
      data: { backupCodes: hashedBackupCodes }
    });

    // Log backup codes regeneration
    await auditService.logAuthenticationEvent({
      userId,
      event: 'mfa_backup_codes_regenerated',
      provider: 'TOTP',
      success: true,
      metadata: { codesCount: backupCodes.length }
    });

    return backupCodes;
  }

  /**
   * Disable MFA for a user
   */
  async disableMFA(
    userId: string,
    verificationToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<MFAVerificationResult> {
    // First verify the token
    const verifyResult = await this.verifyTOTP(userId, verificationToken, ipAddress, userAgent);

    if (!verifyResult.success) {
      return verifyResult;
    }

    // Disable MFA
    await prisma.mfaSetting.update({
      where: { userId },
      data: {
        isEnabled: false,
        secret: '',
        backupCodes: []
      }
    });

    // Log MFA disablement
    await auditService.logAuthenticationEvent({
      userId,
      event: 'mfa_disabled',
      provider: 'TOTP',
      ipAddress,
      userAgent,
      success: true
    });

    return { success: true };
  }

  /**
   * Get MFA status for a user
   */
  async getMFAStatus(userId: string): Promise<{
    isEnabled: boolean;
    backupCodesCount: number;
    lastUsedAt?: Date;
    failedAttempts: number;
  } | null> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings) {
      return null;
    }

    return {
      isEnabled: mfaSettings.isEnabled,
      backupCodesCount: mfaSettings.backupCodes.length,
      lastUsedAt: mfaSettings.lastUsedAt || undefined,
      failedAttempts: mfaSettings.failedAttempts
    };
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }

    return codes;
  }

  /**
   * Hash backup code for secure storage
   */
  private hashBackupCode(code: string): string {
    return createHash('sha256').update(code + process.env.MFA_BACKUP_SECRET || 'default-secret').digest('hex');
  }

  /**
   * Validate TOTP configuration
   */
  public validateConfig(): boolean {
    try {
      const testSecret = authenticator.generateSecret();
      const token = authenticator.generate(testSecret);
      const isValid = authenticator.check(token, testSecret);
      return isValid;
    } catch (error) {
      console.error('TOTP configuration validation failed:', error);
      return false;
    }
  }

  /**
   * Generate QR code for manual setup
   */
  async generateQRCode(secret: string, userEmail: string): Promise<string> {
    const otpauthUrl = authenticator.keyuri(userEmail, this.config.issuer, secret);
    return await QRCode.toDataURL(otpauthUrl);
  }

  /**
   * Reset failed attempts (admin function)
   */
  async resetFailedAttempts(userId: string): Promise<void> {
    await prisma.mfaSetting.update({
      where: { userId },
      data: {
        failedAttempts: 0,
        lastFailedAt: null
      }
    });

    await auditService.logAuthenticationEvent({
      userId,
      event: 'mfa_failed_attempts_reset',
      provider: 'TOTP',
      success: true,
      metadata: { resetBy: 'admin' }
    });
  }

  /**
   * Get recovery information
   */
  async getRecoveryInfo(userId: string): Promise<{
    hasBackupCodes: boolean;
    backupCodesCount: number;
    canRecover: boolean;
  }> {
    const mfaSettings = await prisma.mfaSetting.findUnique({
      where: { userId }
    });

    if (!mfaSettings) {
      return {
        hasBackupCodes: false,
        backupCodesCount: 0,
        canRecover: false
      };
    }

    return {
      hasBackupCodes: mfaSettings.backupCodes.length > 0,
      backupCodesCount: mfaSettings.backupCodes.length,
      canRecover: mfaSettings.backupCodes.length > 0 || !mfaSettings.isEnabled
    };
  }
}

export const totpService = new TOTPService();
export default totpService;