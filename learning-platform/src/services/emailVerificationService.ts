import crypto from 'crypto';
import { hash, compare } from 'bcryptjs';
import db from '@/lib/db';
import { emailService } from './emailService';
import { rateLimitUtils } from '@/lib/auth';

export interface EmailVerificationRequest {
  email: string;
}

export interface EmailVerificationResult {
  success: boolean;
  message: string;
  error?: string;
}

class EmailVerificationService {
  private readonly TOKEN_EXPIRES_IN = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_VERIFICATION_ATTEMPTS = 5;
  private readonly RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_RESEND_ATTEMPTS = 3;
  private readonly RESEND_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

  /**
   * Send email verification
   */
  async sendEmailVerification(userId: string, userAgent?: string, ipAddress?: string): Promise<EmailVerificationResult> {
    try {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          emailVerified: true,
          isActive: true,
        }
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found.',
          error: 'USER_NOT_FOUND'
        };
      }

      if (!user.isActive) {
        return {
          success: false,
          message: 'Account is not active.',
          error: 'ACCOUNT_INACTIVE'
        };
      }

      if (user.emailVerified) {
        return {
          success: false,
          message: 'Email is already verified.',
          error: 'ALREADY_VERIFIED'
        };
      }

      // Rate limiting by user ID
      const rateLimitKey = `email_verification:${userId}`;
      if (rateLimitUtils.isRateLimited(rateLimitKey, this.MAX_RESEND_ATTEMPTS, this.RESEND_RATE_LIMIT_WINDOW)) {
        return {
          success: false,
          message: 'Too many verification emails sent. Please try again later.',
          error: 'RATE_LIMIT_EXCEEDED'
        };
      }

      // Invalidate existing verification tokens
      await this.invalidateExistingTokens(userId);

      // Generate secure verification token
      const verificationToken = this.generateSecureToken();
      const hashedToken = await hash(verificationToken, 12);

      // Store token in database
      await db.emailVerificationToken.create({
        data: {
          token: hashedToken,
          userId: user.id,
          email: user.email,
          expiresAt: new Date(Date.now() + this.TOKEN_EXPIRES_IN),
          used: false,
          metadata: {
            userAgent,
            ipAddress,
            sentAt: new Date(),
          }
        }
      });

      // Send verification email
      await emailService.sendEmailVerification(user.email, verificationToken, user.firstName);

      // Log activity
      await this.logActivity(user.id, 'EMAIL_VERIFICATION_SENT', {
        email: user.email,
        userAgent,
        ipAddress,
      });

      return {
        success: true,
        message: 'Verification email has been sent. Please check your inbox.',
      };

    } catch (error) {
      console.error('Email verification sending failed:', error);
      return {
        success: false,
        message: 'Failed to send verification email. Please try again.',
        error: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string, userAgent?: string, ipAddress?: string): Promise<EmailVerificationResult> {
    try {
      // Rate limiting by token (to prevent brute force)
      const rateLimitKey = `email_verify_attempt:${token.substring(0, 10)}`;
      if (rateLimitUtils.isRateLimited(rateLimitKey, this.MAX_VERIFICATION_ATTEMPTS, this.RATE_LIMIT_WINDOW)) {
        return {
          success: false,
          message: 'Too many verification attempts. Please try again later.',
          error: 'RATE_LIMIT_EXCEEDED'
        };
      }

      // Find and validate token
      const verificationTokens = await db.emailVerificationToken.findMany({
        where: {
          used: false,
          expiresAt: {
            gt: new Date(),
          }
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              emailVerified: true,
              isActive: true,
            }
          }
        }
      });

      let validToken = null;
      let matchedUser = null;

      // Check each token to find match (constant time comparison)
      for (const dbToken of verificationTokens) {
        if (await compare(token, dbToken.token)) {
          validToken = dbToken;
          matchedUser = dbToken.user;
          break;
        }
      }

      if (!validToken || !matchedUser) {
        return {
          success: false,
          message: 'Invalid or expired verification token.',
          error: 'INVALID_TOKEN'
        };
      }

      if (!matchedUser.isActive) {
        return {
          success: false,
          message: 'Account is not active.',
          error: 'ACCOUNT_INACTIVE'
        };
      }

      if (matchedUser.emailVerified) {
        // Mark token as used even if already verified
        await db.emailVerificationToken.update({
          where: { id: validToken.id },
          data: {
            used: true,
            usedAt: new Date(),
          }
        });

        return {
          success: false,
          message: 'Email is already verified.',
          error: 'ALREADY_VERIFIED'
        };
      }

      // Verify email and mark token as used
      await db.$transaction([
        db.user.update({
          where: { id: matchedUser.id },
          data: {
            emailVerified: new Date(),
            updatedAt: new Date(),
          }
        }),
        db.emailVerificationToken.update({
          where: { id: validToken.id },
          data: {
            used: true,
            usedAt: new Date(),
            metadata: {
              ...validToken.metadata as any,
              verifiedAt: new Date(),
              userAgent,
              ipAddress,
            }
          }
        })
      ]);

      // Send welcome email
      await emailService.sendWelcomeEmail(matchedUser.email, matchedUser.firstName);

      // Log activity
      await this.logActivity(matchedUser.id, 'EMAIL_VERIFIED', {
        email: matchedUser.email,
        userAgent,
        ipAddress,
      });

      // Clear rate limiting
      rateLimitUtils.resetAttempts(`email_verification:${matchedUser.id}`);
      rateLimitUtils.resetAttempts(rateLimitKey);

      return {
        success: true,
        message: 'Email successfully verified! Welcome to the learning platform.',
      };

    } catch (error) {
      console.error('Email verification failed:', error);
      return {
        success: false,
        message: 'Failed to verify email. Please try again.',
        error: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string, userAgent?: string, ipAddress?: string): Promise<EmailVerificationResult> {
    try {
      const user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          firstName: true,
          emailVerified: true,
          isActive: true,
        }
      });

      if (!user) {
        // Don't reveal if email exists for security
        return {
          success: true,
          message: 'If the email exists and is not verified, a verification email has been sent.',
        };
      }

      if (!user.isActive) {
        return {
          success: true,
          message: 'If the email exists and is not verified, a verification email has been sent.',
        };
      }

      if (user.emailVerified) {
        return {
          success: false,
          message: 'Email is already verified.',
          error: 'ALREADY_VERIFIED'
        };
      }

      return await this.sendEmailVerification(user.id, userAgent, ipAddress);

    } catch (error) {
      console.error('Resend verification email failed:', error);
      return {
        success: false,
        message: 'Failed to resend verification email. Please try again.',
        error: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Check verification status
   */
  async getVerificationStatus(userId: string): Promise<{
    verified: boolean;
    email?: string;
    pendingTokens?: number;
  }> {
    try {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          emailVerified: true,
        }
      });

      if (!user) {
        return { verified: false };
      }

      const pendingTokens = await db.emailVerificationToken.count({
        where: {
          userId,
          used: false,
          expiresAt: { gt: new Date() },
        }
      });

      return {
        verified: !!user.emailVerified,
        email: user.email,
        pendingTokens,
      };

    } catch (error) {
      console.error('Get verification status failed:', error);
      return { verified: false };
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await db.emailVerificationToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true, usedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // Clean up used tokens older than 7 days
          ]
        }
      });

      return result.count;
    } catch (error) {
      console.error('Token cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Get verification statistics for monitoring
   */
  async getVerificationStatistics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    totalSent: number;
    totalVerified: number;
    expiredTokens: number;
    activeTokens: number;
  }> {
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const [totalSent, totalVerified, expiredTokens, activeTokens] = await Promise.all([
      db.emailVerificationToken.count({
        where: { createdAt: { gte: startDate } }
      }),
      db.emailVerificationToken.count({
        where: {
          used: true,
          usedAt: { gte: startDate }
        }
      }),
      db.emailVerificationToken.count({
        where: {
          used: false,
          expiresAt: { lt: now }
        }
      }),
      db.emailVerificationToken.count({
        where: {
          used: false,
          expiresAt: { gt: now }
        }
      })
    ]);

    return {
      totalSent,
      totalVerified,
      expiredTokens,
      activeTokens,
    };
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async invalidateExistingTokens(userId: string): Promise<void> {
    await db.emailVerificationToken.updateMany({
      where: {
        userId,
        used: false,
      },
      data: {
        used: true,
        usedAt: new Date(),
      }
    });
  }

  private async logActivity(userId: string, action: string, details: Record<string, any>): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action,
          resource: 'email_verification',
          details,
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }
}

export const emailVerificationService = new EmailVerificationService();