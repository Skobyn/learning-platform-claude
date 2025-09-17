import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { Twilio } from 'twilio';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { z } from 'zod';

interface MFAMethod {
  id: string;
  userId: string;
  type: 'totp' | 'sms' | 'email' | 'backup_codes' | 'push' | 'hardware_token';
  isEnabled: boolean;
  isPrimary: boolean;
  metadata: any;
  createdAt: Date;
  lastUsed?: Date;
}

interface TOTPSetup {
  secret: string;
  qrCodeUrl: string;
  manualEntryKey: string;
  backupCodes: string[];
}

interface SMSVerification {
  phone: string;
  code: string;
  expiresAt: Date;
  attempts: number;
}

const mfaConfigSchema = z.object({
  type: z.enum(['totp', 'sms', 'email', 'backup_codes', 'push', 'hardware_token']),
  metadata: z.object({
    phone: z.string().optional(),
    email: z.string().email().optional(),
    deviceId: z.string().optional(),
    publicKey: z.string().optional(),
  }).optional(),
});

const verificationSchema = z.object({
  userId: z.string().cuid(),
  methodId: z.string().cuid(),
  code: z.string().min(4).max(8),
  trustDevice: z.boolean().default(false),
});

export class MfaService {
  private twilioClient?: Twilio;
  private readonly maxAttempts = 3;
  private readonly codeValidityMinutes = 5;
  private readonly backupCodeCount = 10;

  constructor() {
    // Initialize Twilio client if credentials are available
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = new Twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }
  }

  // MFA Method Management
  async setupTOTP(userId: string, appName: string = 'Learning Platform'): Promise<TOTPSetup> {
    // Check if user already has TOTP enabled
    const existingTotp = await prisma.mfaMethod.findFirst({
      where: {
        userId,
        type: 'totp',
        isEnabled: true,
      },
    });

    if (existingTotp) {
      throw new Error('TOTP is already enabled for this user');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${appName} (${userId})`,
      issuer: appName,
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();

    // Store temporary setup data
    await redis.setex(
      `mfa:totp:setup:${userId}`,
      600, // 10 minutes
      JSON.stringify({
        secret: secret.base32,
        backupCodes,
        timestamp: Date.now(),
      })
    );

    return {
      secret: secret.base32!,
      qrCodeUrl,
      manualEntryKey: secret.base32!,
      backupCodes,
    };
  }

  async confirmTOTPSetup(userId: string, token: string): Promise<{ backupCodes: string[] }> {
    const setupData = await redis.get(`mfa:totp:setup:${userId}`);
    if (!setupData) {
      throw new Error('TOTP setup not found or expired');
    }

    const { secret, backupCodes } = JSON.parse(setupData);

    // Verify the TOTP token
    const verified = speakeasy.totp.verify({
      secret,
      token,
      window: 2, // Allow 2 time steps tolerance
      encoding: 'base32',
    });

    if (!verified) {
      throw new Error('Invalid TOTP token');
    }

    // Create MFA method
    await prisma.mfaMethod.create({
      data: {
        userId,
        type: 'totp',
        isEnabled: true,
        isPrimary: true,
        metadata: {
          secret: this.encryptSecret(secret),
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        },
      },
    });

    // Store encrypted backup codes
    await this.storeBackupCodes(userId, backupCodes);

    // Clear setup data
    await redis.del(`mfa:totp:setup:${userId}`);

    // Update user MFA status
    await prisma.user.update({
      where: { id: userId },
      data: { requires2FA: true },
    });

    await this.createAuditLog(userId, 'MFA_TOTP_ENABLED', { type: 'totp' });

    return { backupCodes };
  }

  async setupSMS(userId: string, phoneNumber: string): Promise<void> {
    if (!this.twilioClient) {
      throw new Error('SMS service not configured');
    }

    // Validate phone number format
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      throw new Error('Invalid phone number');
    }

    // Generate verification code
    const code = this.generateSMSCode();
    const expiresAt = new Date(Date.now() + this.codeValidityMinutes * 60 * 1000);

    // Store verification data
    await redis.setex(
      `mfa:sms:verification:${userId}`,
      this.codeValidityMinutes * 60,
      JSON.stringify({
        phone: cleanPhone,
        code,
        expiresAt,
        attempts: 0,
      })
    );

    // Send SMS
    try {
      await this.twilioClient.messages.create({
        body: `Your verification code is: ${code}. Valid for ${this.codeValidityMinutes} minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `+${cleanPhone}`,
      });

      await this.createAuditLog(userId, 'MFA_SMS_CODE_SENT', { phone: this.maskPhone(cleanPhone) });
    } catch (error) {
      console.error('Failed to send SMS:', error);
      throw new Error('Failed to send verification code');
    }
  }

  async confirmSMSSetup(userId: string, code: string): Promise<void> {
    const verificationData = await redis.get(`mfa:sms:verification:${userId}`);
    if (!verificationData) {
      throw new Error('SMS verification not found or expired');
    }

    const verification: SMSVerification = JSON.parse(verificationData);

    if (verification.attempts >= this.maxAttempts) {
      await redis.del(`mfa:sms:verification:${userId}`);
      throw new Error('Maximum verification attempts exceeded');
    }

    if (verification.code !== code) {
      verification.attempts++;
      await redis.setex(
        `mfa:sms:verification:${userId}`,
        this.codeValidityMinutes * 60,
        JSON.stringify(verification)
      );
      throw new Error('Invalid verification code');
    }

    // Create SMS MFA method
    await prisma.mfaMethod.create({
      data: {
        userId,
        type: 'sms',
        isEnabled: true,
        isPrimary: false,
        metadata: {
          phone: this.encryptData(verification.phone),
          verified: true,
        },
      },
    });

    // Clear verification data
    await redis.del(`mfa:sms:verification:${userId}`);

    // Update user MFA status
    await prisma.user.update({
      where: { id: userId },
      data: { requires2FA: true },
    });

    await this.createAuditLog(userId, 'MFA_SMS_ENABLED', {
      phone: this.maskPhone(verification.phone)
    });
  }

  async setupEmailMFA(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Generate verification code
    const code = this.generateEmailCode();
    const expiresAt = new Date(Date.now() + this.codeValidityMinutes * 60 * 1000);

    // Store verification data
    await redis.setex(
      `mfa:email:verification:${userId}`,
      this.codeValidityMinutes * 60,
      JSON.stringify({
        email: user.email,
        code,
        expiresAt,
        attempts: 0,
      })
    );

    // Send email (implement your email service)
    await this.sendVerificationEmail(user.email, code);

    await this.createAuditLog(userId, 'MFA_EMAIL_CODE_SENT', { email: this.maskEmail(user.email) });
  }

  async confirmEmailMFA(userId: string, code: string): Promise<void> {
    const verificationData = await redis.get(`mfa:email:verification:${userId}`);
    if (!verificationData) {
      throw new Error('Email verification not found or expired');
    }

    const verification = JSON.parse(verificationData);

    if (verification.attempts >= this.maxAttempts) {
      await redis.del(`mfa:email:verification:${userId}`);
      throw new Error('Maximum verification attempts exceeded');
    }

    if (verification.code !== code) {
      verification.attempts++;
      await redis.setex(
        `mfa:email:verification:${userId}`,
        this.codeValidityMinutes * 60,
        JSON.stringify(verification)
      );
      throw new Error('Invalid verification code');
    }

    // Create email MFA method
    await prisma.mfaMethod.create({
      data: {
        userId,
        type: 'email',
        isEnabled: true,
        isPrimary: false,
        metadata: {
          email: verification.email,
          verified: true,
        },
      },
    });

    // Clear verification data
    await redis.del(`mfa:email:verification:${userId}`);

    await this.createAuditLog(userId, 'MFA_EMAIL_ENABLED', {
      email: this.maskEmail(verification.email)
    });
  }

  // MFA Verification
  async verifyTOTP(userId: string, token: string): Promise<boolean> {
    const method = await prisma.mfaMethod.findFirst({
      where: {
        userId,
        type: 'totp',
        isEnabled: true,
      },
    });

    if (!method) {
      throw new Error('TOTP not enabled for this user');
    }

    const secret = this.decryptSecret(method.metadata.secret);

    const verified = speakeasy.totp.verify({
      secret,
      token,
      window: 2,
      encoding: 'base32',
    });

    if (verified) {
      // Update last used timestamp
      await prisma.mfaMethod.update({
        where: { id: method.id },
        data: { lastUsed: new Date() },
      });

      await this.createAuditLog(userId, 'MFA_TOTP_VERIFIED', { methodId: method.id });
    } else {
      await this.createAuditLog(userId, 'MFA_TOTP_FAILED', { methodId: method.id });
    }

    return verified;
  }

  async sendSMSCode(userId: string): Promise<void> {
    if (!this.twilioClient) {
      throw new Error('SMS service not configured');
    }

    const method = await prisma.mfaMethod.findFirst({
      where: {
        userId,
        type: 'sms',
        isEnabled: true,
      },
    });

    if (!method) {
      throw new Error('SMS MFA not enabled for this user');
    }

    const phone = this.decryptData(method.metadata.phone);
    const code = this.generateSMSCode();

    // Store verification code
    await redis.setex(
      `mfa:sms:challenge:${userId}`,
      this.codeValidityMinutes * 60,
      JSON.stringify({
        code,
        methodId: method.id,
        attempts: 0,
      })
    );

    // Send SMS
    try {
      await this.twilioClient.messages.create({
        body: `Your verification code is: ${code}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `+${phone}`,
      });

      await this.createAuditLog(userId, 'MFA_SMS_CHALLENGE_SENT', {
        methodId: method.id,
        phone: this.maskPhone(phone)
      });
    } catch (error) {
      console.error('Failed to send SMS:', error);
      throw new Error('Failed to send verification code');
    }
  }

  async verifySMSCode(userId: string, code: string): Promise<boolean> {
    const challengeData = await redis.get(`mfa:sms:challenge:${userId}`);
    if (!challengeData) {
      throw new Error('SMS challenge not found or expired');
    }

    const challenge = JSON.parse(challengeData);

    if (challenge.attempts >= this.maxAttempts) {
      await redis.del(`mfa:sms:challenge:${userId}`);
      throw new Error('Maximum verification attempts exceeded');
    }

    const verified = challenge.code === code;

    if (verified) {
      await redis.del(`mfa:sms:challenge:${userId}`);

      // Update last used timestamp
      await prisma.mfaMethod.update({
        where: { id: challenge.methodId },
        data: { lastUsed: new Date() },
      });

      await this.createAuditLog(userId, 'MFA_SMS_VERIFIED', { methodId: challenge.methodId });
    } else {
      challenge.attempts++;
      await redis.setex(
        `mfa:sms:challenge:${userId}`,
        this.codeValidityMinutes * 60,
        JSON.stringify(challenge)
      );

      await this.createAuditLog(userId, 'MFA_SMS_FAILED', { methodId: challenge.methodId });
    }

    return verified;
  }

  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const backupCodes = await this.getBackupCodes(userId);
    const hashedCode = this.hashBackupCode(code);

    const validCode = backupCodes.find(bc => bc.code === hashedCode && !bc.used);

    if (validCode) {
      // Mark backup code as used
      await prisma.mfaBackupCode.update({
        where: { id: validCode.id },
        data: {
          used: true,
          usedAt: new Date(),
        },
      });

      await this.createAuditLog(userId, 'MFA_BACKUP_CODE_USED', { codeId: validCode.id });
      return true;
    }

    await this.createAuditLog(userId, 'MFA_BACKUP_CODE_FAILED', { code: 'masked' });
    return false;
  }

  // MFA Method Management
  async getUserMFAMethods(userId: string): Promise<MFAMethod[]> {
    const methods = await prisma.mfaMethod.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Decrypt sensitive data for display
    return methods.map(method => ({
      ...method,
      metadata: this.sanitizeMetadataForDisplay(method.metadata, method.type),
    })) as MFAMethod[];
  }

  async disableMFAMethod(userId: string, methodId: string): Promise<void> {
    const method = await prisma.mfaMethod.findFirst({
      where: {
        id: methodId,
        userId,
      },
    });

    if (!method) {
      throw new Error('MFA method not found');
    }

    await prisma.mfaMethod.update({
      where: { id: methodId },
      data: { isEnabled: false },
    });

    // Check if user has any remaining MFA methods
    const remainingMethods = await prisma.mfaMethod.count({
      where: {
        userId,
        isEnabled: true,
      },
    });

    if (remainingMethods === 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { requires2FA: false },
      });
    }

    await this.createAuditLog(userId, 'MFA_METHOD_DISABLED', {
      methodId,
      type: method.type
    });
  }

  async setPrimaryMFAMethod(userId: string, methodId: string): Promise<void> {
    // Remove primary flag from all methods
    await prisma.mfaMethod.updateMany({
      where: { userId },
      data: { isPrimary: false },
    });

    // Set new primary method
    await prisma.mfaMethod.update({
      where: {
        id: methodId,
        userId,
      },
      data: { isPrimary: true },
    });

    await this.createAuditLog(userId, 'MFA_PRIMARY_METHOD_CHANGED', { methodId });
  }

  // Backup Codes
  async generateNewBackupCodes(userId: string): Promise<string[]> {
    // Disable existing backup codes
    await prisma.mfaBackupCode.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    // Generate new backup codes
    const backupCodes = this.generateBackupCodes();
    await this.storeBackupCodes(userId, backupCodes);

    await this.createAuditLog(userId, 'MFA_BACKUP_CODES_REGENERATED', { count: backupCodes.length });

    return backupCodes;
  }

  async getBackupCodesStatus(userId: string): Promise<{ total: number; used: number; remaining: number }> {
    const codes = await prisma.mfaBackupCode.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    const total = codes.length;
    const used = codes.filter(code => code.used).length;
    const remaining = total - used;

    return { total, used, remaining };
  }

  // Trusted Devices
  async trustDevice(userId: string, deviceFingerprint: string, userAgent: string): Promise<string> {
    const trustToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.trustedDevice.create({
      data: {
        userId,
        deviceFingerprint,
        trustToken,
        userAgent,
        expiresAt,
        isActive: true,
      },
    });

    await this.createAuditLog(userId, 'DEVICE_TRUSTED', { deviceFingerprint });

    return trustToken;
  }

  async isDeviceTrusted(userId: string, deviceFingerprint: string, trustToken?: string): Promise<boolean> {
    const device = await prisma.trustedDevice.findFirst({
      where: {
        userId,
        deviceFingerprint,
        isActive: true,
        expiresAt: {
          gt: new Date(),
        },
        ...(trustToken && { trustToken }),
      },
    });

    return !!device;
  }

  async revokeTrustedDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.trustedDevice.update({
      where: {
        id: deviceId,
        userId,
      },
      data: { isActive: false },
    });

    await this.createAuditLog(userId, 'TRUSTED_DEVICE_REVOKED', { deviceId });
  }

  // Utility Methods
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.backupCodeCount; i++) {
      codes.push(this.generateBackupCode());
    }
    return codes;
  }

  private generateBackupCode(): string {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  private generateSMSCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateEmailCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private async storeBackupCodes(userId: string, codes: string[]): Promise<void> {
    const backupCodeData = codes.map(code => ({
      userId,
      code: this.hashBackupCode(code),
      isActive: true,
    }));

    await prisma.mfaBackupCode.createMany({
      data: backupCodeData,
    });
  }

  private async getBackupCodes(userId: string): Promise<any[]> {
    return prisma.mfaBackupCode.findMany({
      where: {
        userId,
        isActive: true,
      },
    });
  }

  private encryptSecret(secret: string): string {
    const algorithm = 'aes-256-gcm';
    const key = process.env.MFA_ENCRYPTION_KEY || 'default-key-change-in-production';

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipher(algorithm, key);

    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return encrypted;
  }

  private decryptSecret(encryptedSecret: string): string {
    const algorithm = 'aes-256-gcm';
    const key = process.env.MFA_ENCRYPTION_KEY || 'default-key-change-in-production';

    const decipher = crypto.createDecipher(algorithm, key);
    let decrypted = decipher.update(encryptedSecret, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private encryptData(data: string): string {
    return this.encryptSecret(data);
  }

  private decryptData(encryptedData: string): string {
    return this.decryptSecret(encryptedData);
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    return `****${phone.slice(-4)}`;
  }

  private maskEmail(email: string): string {
    const [username, domain] = email.split('@');
    if (username.length <= 2) return email;
    return `${username.slice(0, 2)}****@${domain}`;
  }

  private sanitizeMetadataForDisplay(metadata: any, type: string): any {
    const sanitized = { ...metadata };

    switch (type) {
      case 'sms':
        if (sanitized.phone) {
          sanitized.phone = this.maskPhone(this.decryptData(sanitized.phone));
        }
        break;
      case 'email':
        if (sanitized.email) {
          sanitized.email = this.maskEmail(sanitized.email);
        }
        break;
      case 'totp':
        delete sanitized.secret; // Never expose TOTP secret
        break;
    }

    return sanitized;
  }

  private async sendVerificationEmail(email: string, code: string): Promise<void> {
    // Implement your email service here
    // Example: await emailService.sendMFAVerificationEmail(email, code);
    console.log(`MFA Email code for ${email}: ${code}`);
  }

  private async createAuditLog(userId: string, action: string, details: any): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          resource: 'mfa',
          details,
          timestamp: new Date(),
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'system',
        },
      });
    } catch (error) {
      console.error('Failed to create MFA audit log:', error);
    }
  }

  // Admin and Reporting
  async getMFAStatistics(organizationId?: string): Promise<any> {
    const whereClause = organizationId ? { organizationId } : {};

    const [
      totalUsers,
      mfaEnabledUsers,
      totpUsers,
      smsUsers,
      emailUsers,
      trustedDevices,
    ] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.count({ where: { ...whereClause, requires2FA: true } }),
      prisma.mfaMethod.count({ where: { type: 'totp', isEnabled: true } }),
      prisma.mfaMethod.count({ where: { type: 'sms', isEnabled: true } }),
      prisma.mfaMethod.count({ where: { type: 'email', isEnabled: true } }),
      prisma.trustedDevice.count({ where: { isActive: true } }),
    ]);

    return {
      totalUsers,
      mfaEnabledUsers,
      mfaAdoptionRate: totalUsers > 0 ? (mfaEnabledUsers / totalUsers) * 100 : 0,
      methodBreakdown: {
        totp: totpUsers,
        sms: smsUsers,
        email: emailUsers,
      },
      trustedDevices,
    };
  }

  async resetUserMFA(userId: string, adminUserId: string): Promise<void> {
    // Disable all MFA methods
    await prisma.mfaMethod.updateMany({
      where: { userId },
      data: { isEnabled: false },
    });

    // Deactivate backup codes
    await prisma.mfaBackupCode.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    // Revoke trusted devices
    await prisma.trustedDevice.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    // Update user MFA requirement
    await prisma.user.update({
      where: { id: userId },
      data: { requires2FA: false },
    });

    await this.createAuditLog(adminUserId, 'MFA_ADMIN_RESET', {
      targetUserId: userId,
      action: 'reset_all_mfa'
    });
  }
}

export const mfaService = new MfaService();
export default mfaService;