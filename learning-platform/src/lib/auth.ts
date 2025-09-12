import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { compare } from 'bcryptjs';
import { JWT } from 'next-auth/jwt';
import { Session, User as NextAuthUser } from 'next-auth';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

import db from './db';
import { UserRole, User } from '@prisma/client';

// Extend NextAuth types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      organizationId: string;
      avatar?: string;
    };
  }

  interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    organizationId: string;
    avatar?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    organizationId: string;
    avatar?: string;
  }
}

// NextAuth configuration
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Missing credentials');
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: { organization: true },
        });

        if (!user || !user.hashedPassword) {
          throw new Error('Invalid credentials');
        }

        if (!user.isActive) {
          throw new Error('Account is deactivated');
        }

        const isPasswordValid = await compare(credentials.password, user.hashedPassword);

        if (!isPasswordValid) {
          throw new Error('Invalid credentials');
        }

        // Update last login
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Log activity
        await logActivity(user.id, 'LOGIN', 'auth', {
          timestamp: new Date(),
          userAgent: '', // Will be set by middleware
        });

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
          avatar: user.avatar,
        };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      profile(profile) {
        return {
          id: profile.sub,
          firstName: profile.given_name,
          lastName: profile.family_name,
          email: profile.email,
          avatar: profile.picture,
          role: 'LEARNER' as UserRole,
          organizationId: '', // Will need to be set during onboarding
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
    signUp: '/auth/signup',
    error: '/auth/error',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Initial sign in
      if (user) {
        token.id = user.id;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.avatar = user.avatar;
      }

      // Update session trigger (when user updates profile)
      if (trigger === 'update' && session) {
        token = { ...token, ...session };
      }

      // Check if user still exists and is active
      if (token.id) {
        const dbUser = await db.user.findUnique({
          where: { id: token.id },
          select: {
            id: true,
            isActive: true,
            role: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        });

        if (!dbUser || !dbUser.isActive) {
          return {}; // Force logout
        }

        // Update token with latest user data
        token.firstName = dbUser.firstName;
        token.lastName = dbUser.lastName;
        token.role = dbUser.role;
        token.avatar = dbUser.avatar;
      }

      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email,
        firstName: token.firstName,
        lastName: token.lastName,
        role: token.role,
        organizationId: token.organizationId,
        avatar: token.avatar,
      };
      return session;
    },
    async signIn({ user, account, profile, email, credentials }) {
      // For OAuth providers, check if user exists or create new one
      if (account?.provider !== 'credentials') {
        const existingUser = await db.user.findUnique({
          where: { email: user.email! },
        });

        if (!existingUser) {
          // Create new user for OAuth sign-in
          // Note: organizationId will need to be set during onboarding
          const newUser = await db.user.create({
            data: {
              email: user.email!,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              avatar: user.avatar,
              role: 'LEARNER',
              organizationId: 'default', // This should be handled by admin
              emailVerified: new Date(),
            },
          });
          user.id = newUser.id;
          user.organizationId = newUser.organizationId;
        } else {
          user.id = existingUser.id;
          user.organizationId = existingUser.organizationId;
        }
      }

      return true;
    },
  },
  events: {
    async signIn({ user, account, profile, isNewUser }) {
      if (user.id) {
        await logActivity(user.id, 'SIGNIN', 'auth', {
          provider: account?.provider,
          isNewUser,
        });
      }
    },
    async signOut({ session, token }) {
      if (token?.id) {
        await logActivity(token.id, 'SIGNOUT', 'auth', {});
      }
    },
  },
};

// Custom JWT utilities
export const jwtUtils = {
  sign: (payload: Record<string, any>, expiresIn: string = '24h') => {
    return jwt.sign(payload, process.env.NEXTAUTH_SECRET!, { expiresIn });
  },

  verify: (token: string) => {
    try {
      return jwt.verify(token, process.env.NEXTAUTH_SECRET!);
    } catch (error) {
      return null;
    }
  },

  decode: (token: string) => {
    return jwt.decode(token);
  },
};

// Password utilities
export const passwordUtils = {
  validate: (password: string): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
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

    return {
      isValid: errors.length === 0,
      errors,
    };
  },

  generateTemporary: (length: number = 12): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    
    // Ensure at least one character from each required category
    result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
    result += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
    result += '0123456789'[Math.floor(Math.random() * 10)];
    result += '!@#$%^&*'[Math.floor(Math.random() * 8)];
    
    // Fill the rest randomly
    for (let i = result.length; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // Shuffle the result
    return result.split('').sort(() => Math.random() - 0.5).join('');
  },
};

// Role-based access control utilities
export const rbacUtils = {
  hasPermission: (userRole: UserRole, requiredRole: UserRole): boolean => {
    const roleHierarchy = {
      ADMIN: 4,
      INSTRUCTOR: 3,
      MANAGER: 2,
      LEARNER: 1,
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  },

  canAccessResource: (
    userRole: UserRole,
    userId: string,
    resourceOwnerId: string,
    requiredRole: UserRole = 'LEARNER'
  ): boolean => {
    // Admin can access everything
    if (userRole === 'ADMIN') return true;
    
    // Owner can access their own resources
    if (userId === resourceOwnerId) return true;
    
    // Check role permission
    return rbacUtils.hasPermission(userRole, requiredRole);
  },

  getPermissions: (role: UserRole) => {
    const permissions = {
      ADMIN: [
        'user:create', 'user:read', 'user:update', 'user:delete',
        'course:create', 'course:read', 'course:update', 'course:delete',
        'organization:read', 'organization:update',
        'analytics:read', 'system:manage'
      ],
      INSTRUCTOR: [
        'course:create', 'course:read', 'course:update',
        'user:read', 'analytics:read'
      ],
      MANAGER: [
        'course:read', 'user:read', 'analytics:read'
      ],
      LEARNER: [
        'course:read', 'profile:update'
      ],
    };

    return permissions[role] || [];
  },
};

// Session utilities
export const sessionUtils = {
  // Get current user from server components
  getCurrentUser: async (): Promise<User | null> => {
    try {
      const cookieStore = cookies();
      const token = cookieStore.get('next-auth.session-token')?.value ||
                   cookieStore.get('__Secure-next-auth.session-token')?.value;

      if (!token) return null;

      const decoded = jwtUtils.verify(token) as JWT;
      if (!decoded?.id) return null;

      const user = await db.user.findUnique({
        where: { id: decoded.id },
        include: { organization: true },
      });

      return user;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  },

  // Validate session token
  validateSessionToken: async (token: string): Promise<User | null> => {
    try {
      const decoded = jwtUtils.verify(token) as JWT;
      if (!decoded?.id) return null;

      const user = await db.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          organizationId: true,
          isActive: true,
          avatar: true,
        },
      });

      if (!user?.isActive) return null;
      return user as User;
    } catch (error) {
      return null;
    }
  },

  // Extract user from request
  getUserFromRequest: async (request: NextRequest): Promise<User | null> => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      return sessionUtils.validateSessionToken(token);
    }

    const sessionToken = request.cookies.get('next-auth.session-token')?.value ||
                        request.cookies.get('__Secure-next-auth.session-token')?.value;
    
    if (sessionToken) {
      return sessionUtils.validateSessionToken(sessionToken);
    }

    return null;
  },
};

// Activity logging
export const logActivity = async (
  userId: string,
  action: string,
  resource: string,
  details: Record<string, any> = {},
  request?: NextRequest
) => {
  try {
    await db.activityLog.create({
      data: {
        userId,
        action,
        resource,
        details,
        ipAddress: request?.ip || request?.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request?.headers.get('user-agent') || 'unknown',
      },
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

// Rate limiting utilities
export const rateLimitUtils = {
  attempts: new Map<string, { count: number; resetTime: number }>(),

  isRateLimited: (identifier: string, maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000): boolean => {
    const now = Date.now();
    const attempt = rateLimitUtils.attempts.get(identifier);

    if (!attempt || now > attempt.resetTime) {
      rateLimitUtils.attempts.set(identifier, { count: 1, resetTime: now + windowMs });
      return false;
    }

    if (attempt.count >= maxAttempts) {
      return true;
    }

    attempt.count++;
    return false;
  },

  resetAttempts: (identifier: string): void => {
    rateLimitUtils.attempts.delete(identifier);
  },

  getRemainingTime: (identifier: string): number => {
    const attempt = rateLimitUtils.attempts.get(identifier);
    if (!attempt) return 0;
    
    const remaining = attempt.resetTime - Date.now();
    return Math.max(0, remaining);
  },
};