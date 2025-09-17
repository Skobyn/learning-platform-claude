import crypto from 'crypto';
import { hash, compare } from 'bcryptjs';
import db from '@/lib/db';
import { emailService } from './emailService';
import { rateLimitUtils } from '@/lib/auth';

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetVerification {
  token: string;
  newPassword: string;
}

export interface PasswordResetToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

class PasswordResetService {
  private readonly TOKEN_EXPIRES_IN = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_RESET_ATTEMPTS = 3;
  private readonly RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

  /**
   * Initiate password reset process
   */
  async initiatePasswordReset(email: string, userAgent?: string, ipAddress?: string): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      // Rate limiting by email
      const rateLimitKey = `password_reset:${email}`;
      if (rateLimitUtils.isRateLimited(rateLimitKey, this.MAX_RESET_ATTEMPTS, this.RATE_LIMIT_WINDOW)) {
        return {
          success: false,
          message: 'Too many reset attempts. Please try again later.',
          error: 'RATE_LIMIT_EXCEEDED'
        };
      }

      // Find user by email
      const user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
        }
      });

      // Always return success for security (don't reveal if email exists)
      if (!user || !user.isActive) {
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent.',
        };
      }

      // Invalidate any existing tokens
      await this.invalidateExistingTokens(user.id);

      // Generate secure reset token
      const resetToken = this.generateSecureToken();
      const hashedToken = await hash(resetToken, 12);

      // Store token in database
      await db.passwordResetToken.create({
        data: {
          token: hashedToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + this.TOKEN_EXPIRES_IN),
          used: false,
          metadata: {
            userAgent,
            ipAddress,
            requestedAt: new Date(),
          }
        }
      });

      // Send reset email
      await emailService.sendPasswordResetEmail(user.email, resetToken);

      // Log security event
      await this.logSecurityEvent(user.id, 'PASSWORD_RESET_REQUESTED', {
        userAgent,
        ipAddress,
        email: user.email,
      });

      return {
        success: true,
        message: 'If the email exists, a password reset link has been sent.',
      };

    } catch (error) {
      console.error('Password reset initiation failed:', error);
      return {
        success: false,
        message: 'Failed to process password reset request. Please try again.',
        error: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Verify and process password reset
   */
  async resetPassword(token: string, newPassword: string, userAgent?: string, ipAddress?: string): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      // Validate password strength
      const passwordValidation = this.validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message: 'Password does not meet security requirements.',
          error: 'WEAK_PASSWORD',
        };
      }

      // Find and validate token
      const resetTokens = await db.passwordResetToken.findMany({
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
              hashedPassword: true,
              isActive: true,
            }
          }
        }
      });

      let validToken = null;
      let matchedUser = null;

      // Check each token to find match (constant time comparison)
      for (const dbToken of resetTokens) {
        if (await compare(token, dbToken.token)) {
          validToken = dbToken;
          matchedUser = dbToken.user;
          break;
        }
      }

      if (!validToken || !matchedUser || !matchedUser.isActive) {
        return {
          success: false,
          message: 'Invalid or expired reset token.',
          error: 'INVALID_TOKEN'
        };
      }

      // Check if new password is different from current
      if (matchedUser.hashedPassword && await compare(newPassword, matchedUser.hashedPassword)) {
        return {
          success: false,
          message: 'New password must be different from your current password.',
          error: 'SAME_PASSWORD'
        };
      }

      // Hash new password
      const hashedPassword = await hash(newPassword, 12);

      // Update password and mark token as used
      await db.$transaction([
        db.user.update({
          where: { id: matchedUser.id },
          data: {
            hashedPassword,
            updatedAt: new Date(),
          }
        }),
        db.passwordResetToken.update({
          where: { id: validToken.id },
          data: {
            used: true,
            usedAt: new Date(),
            metadata: {
              ...validToken.metadata as any,
              resetCompletedAt: new Date(),
              userAgent,
              ipAddress,
            }
          }
        })
      ]);

      // Invalidate all user sessions (force re-login)
      await db.userSession.deleteMany({
        where: { userId: matchedUser.id }
      });

      // Log security event
      await this.logSecurityEvent(matchedUser.id, 'PASSWORD_RESET_COMPLETED', {
        userAgent,
        ipAddress,
        email: matchedUser.email,
      });

      // Clear rate limiting
      rateLimitUtils.resetAttempts(`password_reset:${matchedUser.email}`);

      return {
        success: true,
        message: 'Password has been successfully reset. Please log in with your new password.',
      };

    } catch (error) {
      console.error('Password reset failed:', error);
      return {
        success: false,
        message: 'Failed to reset password. Please try again.',
        error: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Validate password reset token (without using it)
   */
  async validateResetToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    expiresAt?: Date;
  }> {
    try {
      const resetTokens = await db.passwordResetToken.findMany({
        where: {
          used: false,
          expiresAt: {
            gt: new Date(),
          }
        },
        select: {
          id: true,
          token: true,
          userId: true,
          expiresAt: true,
        }
      });

      for (const dbToken of resetTokens) {
        if (await compare(token, dbToken.token)) {
          return {
            valid: true,
            userId: dbToken.userId,
            expiresAt: dbToken.expiresAt,
          };
        }
      }

      return { valid: false };
    } catch (error) {
      console.error('Token validation failed:', error);
      return { valid: false };
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await db.passwordResetToken.deleteMany({
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
   * Get password reset statistics for monitoring
   */
  async getResetStatistics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    totalRequests: number;
    completedResets: number;
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

    const [totalRequests, completedResets, expiredTokens, activeTokens] = await Promise.all([
      db.passwordResetToken.count({
        where: { createdAt: { gte: startDate } }
      }),
      db.passwordResetToken.count({
        where: {
          used: true,
          usedAt: { gte: startDate }
        }
      }),
      db.passwordResetToken.count({
        where: {
          used: false,
          expiresAt: { lt: now }
        }
      }),
      db.passwordResetToken.count({
        where: {
          used: false,
          expiresAt: { gt: now }
        }
      })
    ]);

    return {
      totalRequests,
      completedResets,
      expiredTokens,
      activeTokens,
    };
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async invalidateExistingTokens(userId: string): Promise<void> {
    await db.passwordResetToken.updateMany({
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

  private validatePasswordStrength(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (password.length > 128) {
      errors.push('Password must be less than 128 characters');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check for common passwords
    const commonPasswords = [
      'password', '123456', '123456789', 'qwerty', 'abc123', 'password123',
      'admin', 'letmein', 'welcome', 'monkey', '1234567890'
    ];
    
    if (commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common, please choose a stronger password');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private async logSecurityEvent(userId: string, event: string, details: Record<string, any>): Promise<void> {
    try {
      await db.activityLog.create({
        data: {
          userId,
          action: event,
          resource: 'auth',
          details,
          ipAddress: details.ipAddress || 'unknown',
          userAgent: details.userAgent || 'unknown',
        }
      });
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }
}

export const passwordResetService = new PasswordResetService();