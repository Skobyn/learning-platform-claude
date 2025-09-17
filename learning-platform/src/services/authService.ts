import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { redis } from '@/lib/redis.server';
import { z } from 'zod';

// Environment variables with fallbacks for development
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    'Password must contain uppercase, lowercase, number and special character'
  ),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  organizationId: z.string().optional()
});

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  organizationId?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

class EnterpriseAuthService {
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  private async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  private generateTokens(payload: TokenPayload): AuthTokens {
    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900 // 15 minutes in seconds
    };
  }

  private async checkAccountLockout(email: string): Promise<boolean> {
    const lockoutKey = `lockout:${email}`;
    const lockoutData = await redis.get(lockoutKey);

    if (lockoutData) {
      const { attempts, lockedUntil } = JSON.parse(lockoutData);
      if (lockedUntil && new Date(lockedUntil) > new Date()) {
        throw new Error('Account temporarily locked due to multiple failed login attempts');
      }
    }

    return false;
  }

  private async recordFailedAttempt(email: string): Promise<void> {
    const lockoutKey = `lockout:${email}`;
    const existingData = await redis.get(lockoutKey);

    let attempts = 1;
    let lockedUntil = null;

    if (existingData) {
      const parsed = JSON.parse(existingData);
      attempts = parsed.attempts + 1;

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + LOCKOUT_DURATION);
      }
    }

    await redis.set(
      lockoutKey,
      JSON.stringify({ attempts, lockedUntil }),
      'EX',
      LOCKOUT_DURATION / 1000
    );
  }

  private async clearFailedAttempts(email: string): Promise<void> {
    await redis.del(`lockout:${email}`);
  }

  private async createAuditLog(
    userId: string,
    action: string,
    metadata: Record<string, any>
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        metadata,
        ipAddress: metadata.ipAddress || 'unknown',
        userAgent: metadata.userAgent || 'unknown',
        timestamp: new Date()
      }
    });
  }

  async register(data: any, ipAddress?: string): Promise<{ user: any; tokens: AuthTokens }> {
    const validated = registerSchema.parse(data);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email }
    });

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await this.hashPassword(validated.password);

    // Create user with transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: validated.email,
          password: hashedPassword,
          firstName: validated.firstName,
          lastName: validated.lastName,
          role: 'LEARNER',
          organizationId: validated.organizationId,
          isActive: true,
          emailVerified: false
        }
      });

      // Create user profile
      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          bio: '',
          preferences: {}
        }
      });

      // Audit log
      await this.createAuditLog(newUser.id, 'USER_REGISTERED', {
        email: validated.email,
        ipAddress,
        timestamp: new Date()
      });

      return newUser;
    });

    // Generate tokens
    const tokens = this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    });

    // Store refresh token in Redis
    await redis.set(
      `refresh_token:${user.id}`,
      tokens.refreshToken,
      'EX',
      7 * 24 * 60 * 60 // 7 days
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      tokens
    };
  }

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: any; tokens: AuthTokens }> {
    // Validate input
    const validated = loginSchema.parse({ email, password });

    // Check account lockout
    await this.checkAccountLockout(validated.email);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: validated.email },
      include: {
        organization: true,
        profile: true
      }
    });

    if (!user || !user.isActive) {
      await this.recordFailedAttempt(validated.email);
      throw new Error('Invalid credentials');
    }

    // Verify password
    const isValidPassword = await this.verifyPassword(validated.password, user.password);

    if (!isValidPassword) {
      await this.recordFailedAttempt(validated.email);
      await this.createAuditLog(user.id, 'LOGIN_FAILED', {
        reason: 'Invalid password',
        ipAddress,
        userAgent
      });
      throw new Error('Invalid credentials');
    }

    // Clear failed attempts on successful login
    await this.clearFailedAttempts(validated.email);

    // Generate tokens
    const tokens = this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    });

    // Store refresh token and session
    await Promise.all([
      redis.set(
        `refresh_token:${user.id}`,
        tokens.refreshToken,
        'EX',
        7 * 24 * 60 * 60
      ),
      redis.set(
        `session:${user.id}`,
        JSON.stringify({
          userId: user.id,
          email: user.email,
          role: user.role,
          loginTime: new Date(),
          ipAddress,
          userAgent
        }),
        'EX',
        24 * 60 * 60
      )
    ]);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Audit log
    await this.createAuditLog(user.id, 'LOGIN_SUCCESS', {
      ipAddress,
      userAgent,
      timestamp: new Date()
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organization: user.organization
      },
      tokens
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as TokenPayload & { type: string };

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token exists in Redis
      const storedToken = await redis.get(`refresh_token:${decoded.userId}`);

      if (storedToken !== refreshToken) {
        throw new Error('Invalid refresh token');
      }

      // Get updated user data
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      // Generate new tokens
      const tokens = this.generateTokens({
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId
      });

      // Update refresh token in Redis
      await redis.set(
        `refresh_token:${user.id}`,
        tokens.refreshToken,
        'EX',
        7 * 24 * 60 * 60
      );

      return tokens;
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await Promise.all([
      redis.del(`refresh_token:${userId}`),
      redis.del(`session:${userId}`)
    ]);

    await this.createAuditLog(userId, 'LOGOUT', {
      timestamp: new Date()
    });
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

      // Check if session exists
      const session = await redis.get(`session:${decoded.userId}`);
      if (!session) {
        throw new Error('Session expired');
      }

      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: true
          }
        }
      }
    });

    if (!user || !user.role) {
      return [];
    }

    return user.role.permissions.map(p => p.name);
  }

  async checkPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValid = await this.verifyPassword(currentPassword, user.password);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!passwordRegex.test(newPassword)) {
      throw new Error('Password must contain uppercase, lowercase, number and special character');
    }

    // Hash new password
    const hashedPassword = await this.hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        passwordChangedAt: new Date()
      }
    });

    // Invalidate all sessions
    await redis.del(`refresh_token:${userId}`);
    await redis.del(`session:${userId}`);

    // Audit log
    await this.createAuditLog(userId, 'PASSWORD_CHANGED', {
      timestamp: new Date()
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Don't reveal if user exists
      return;
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Store reset token in Redis
    await redis.set(
      `password_reset:${user.id}`,
      resetToken,
      'EX',
      3600 // 1 hour
    );

    // Send reset email (implement email service)
    // await emailService.sendPasswordResetEmail(email, resetToken);

    // Audit log
    await this.createAuditLog(user.id, 'PASSWORD_RESET_REQUESTED', {
      email,
      timestamp: new Date()
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      if (decoded.type !== 'password_reset') {
        throw new Error('Invalid token type');
      }

      // Check if token exists in Redis
      const storedToken = await redis.get(`password_reset:${decoded.userId}`);

      if (storedToken !== token) {
        throw new Error('Invalid or expired reset token');
      }

      // Validate new password
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
      if (!passwordRegex.test(newPassword)) {
        throw new Error('Password must contain uppercase, lowercase, number and special character');
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update password
      await prisma.user.update({
        where: { id: decoded.userId },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date()
        }
      });

      // Clean up Redis
      await redis.del(`password_reset:${decoded.userId}`);

      // Audit log
      await this.createAuditLog(decoded.userId, 'PASSWORD_RESET_COMPLETED', {
        timestamp: new Date()
      });
    } catch (error) {
      throw new Error('Invalid or expired reset token');
    }
  }
}

export const authService = new EnterpriseAuthService();
export default authService;