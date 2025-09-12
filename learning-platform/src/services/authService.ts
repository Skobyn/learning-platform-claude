import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

// Types
export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  firstName: string
  lastName: string
  email: string
  password: string
  role: 'LEARNER' | 'INSTRUCTOR' | 'ADMIN'
  organizationCode?: string
}

export interface AuthResult {
  success: boolean
  user?: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    verified: boolean
  }
  token?: string
  error?: string
  requiresTwoFactor?: boolean
}

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'LEARNER' | 'INSTRUCTOR' | 'ADMIN'
  hashedPassword: string
  verified: boolean
  requires2FA: boolean
  createdAt: Date
  updatedAt: Date
  organizationId?: string
}

class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret'
  private readonly TOKEN_EXPIRES_IN = '7d'
  
  // Mock database - replace with actual database calls
  private users: User[] = [
    {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      hashedPassword: '$2a$10$dummy.hash.for.password123', // password123
      verified: true,
      requires2FA: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]
  
  async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Find user by email
      const user = this.users.find(u => u.email.toLowerCase() === credentials.email.toLowerCase())
      
      if (!user) {
        return {
          success: false,
          error: 'User not found'
        }
      }
      
      // Verify password
      const isValidPassword = await bcrypt.compare(credentials.password, user.hashedPassword)
      
      if (!isValidPassword) {
        return {
          success: false,
          error: 'Invalid credentials'
        }
      }
      
      // Check if email is verified
      if (!user.verified) {
        return {
          success: false,
          error: 'Please verify your email address before signing in'
        }
      }
      
      // Check if 2FA is required
      if (user.requires2FA) {
        // In real implementation, send 2FA code here
        return {
          success: true,
          requiresTwoFactor: true
        }
      }
      
      // Generate JWT token
      const token = this.generateToken(user)
      
      // Set HTTP-only cookie
      this.setAuthCookie(token)
      
      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          verified: user.verified
        },
        token
      }
      
    } catch (error) {
      console.error('Login error:', error)
      return {
        success: false,
        error: 'Login failed. Please try again.'
      }
    }
  }
  
  async register(userData: RegisterData): Promise<AuthResult> {
    try {
      // Check if email already exists
      const existingUser = this.users.find(u => u.email.toLowerCase() === userData.email.toLowerCase())
      
      if (existingUser) {
        return {
          success: false,
          error: 'Email already registered'
        }
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10)
      
      // Create new user
      const newUser: User = {
        id: Math.random().toString(36).substr(2, 9), // Generate random ID
        email: userData.email.toLowerCase(),
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        hashedPassword,
        verified: false, // Email verification required
        requires2FA: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId: userData.organizationCode ? this.findOrganizationByCode(userData.organizationCode) : undefined
      }
      
      // Save user to mock database
      this.users.push(newUser)
      
      // Send welcome email (mock)
      await this.sendWelcomeEmail(newUser)
      
      // If organization invite, add user to organization
      if (userData.organizationCode) {
        await this.addUserToOrganization(newUser, userData.organizationCode)
      }
      
      return {
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
          verified: newUser.verified
        }
      }
      
    } catch (error) {
      console.error('Registration error:', error)
      return {
        success: false,
        error: 'Registration failed. Please try again.'
      }
    }
  }
  
  async logout(): Promise<void> {
    // Clear authentication cookie
    this.clearAuthCookie()
    
    // In real implementation, you might want to:
    // - Invalidate refresh tokens
    // - Log the logout event
    // - Clear any cached session data
  }
  
  async validateToken(token: string): Promise<AuthResult> {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as any
      
      // Find user to ensure they still exist and are active
      const user = this.users.find(u => u.id === decoded.sub)
      
      if (!user) {
        return {
          success: false,
          error: 'User not found'
        }
      }
      
      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          verified: user.verified
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: 'Invalid or expired token'
      }
    }
  }
  
  async forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = this.users.find(u => u.email.toLowerCase() === email.toLowerCase())
      
      if (!user) {
        // Don't reveal if email exists for security
        return { success: true }
      }
      
      // Generate reset token (mock implementation)
      const resetToken = Math.random().toString(36).substr(2, 32)
      
      // In real implementation, save reset token with expiration
      // await this.savePasswordResetToken(user.id, resetToken)
      
      // Send password reset email (mock)
      await this.sendPasswordResetEmail(user.email, resetToken)
      
      return { success: true }
      
    } catch (error) {
      console.error('Forgot password error:', error)
      return {
        success: false,
        error: 'Failed to process password reset request'
      }
    }
  }
  
  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      // In real implementation, validate reset token and find user
      // const userId = await this.validatePasswordResetToken(token)
      
      // Mock validation - in reality you'd check token expiration, etc.
      const userId = '1' // Mock user ID
      
      if (!userId) {
        return {
          success: false,
          error: 'Invalid or expired reset token'
        }
      }
      
      // Find user and update password
      const user = this.users.find(u => u.id === userId)
      if (!user) {
        return {
          success: false,
          error: 'User not found'
        }
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10)
      user.hashedPassword = hashedPassword
      user.updatedAt = new Date()
      
      // Clear reset token in real implementation
      // await this.clearPasswordResetToken(userId)
      
      return { success: true }
      
    } catch (error) {
      console.error('Reset password error:', error)
      return {
        success: false,
        error: 'Failed to reset password'
      }
    }
  }
  
  private generateToken(user: User): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        verified: user.verified
      },
      this.JWT_SECRET,
      { expiresIn: this.TOKEN_EXPIRES_IN }
    )
  }
  
  private setAuthCookie(token: string): void {
    // In real implementation with Next.js 13+ app directory
    // This would be handled differently, possibly in an API route
    if (typeof window === 'undefined') {
      // Server-side cookie setting would go here
      // cookies().set('auth-token', token, { httpOnly: true, secure: true, maxAge: 7 * 24 * 60 * 60 * 1000 })
    }
  }
  
  private clearAuthCookie(): void {
    if (typeof window === 'undefined') {
      // Server-side cookie clearing would go here
      // cookies().delete('auth-token')
    }
  }
  
  private findOrganizationByCode(code: string): string | undefined {
    // Mock organization lookup
    const organizations: Record<string, string> = {
      'ACME-001': 'org-acme-123',
      'TECH-002': 'org-tech-456'
    }
    return organizations[code]
  }
  
  private async sendWelcomeEmail(user: User): Promise<void> {
    // Mock email sending
    console.log(`Sending welcome email to ${user.email}`)
    // In real implementation, integrate with email service
  }
  
  private async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    // Mock email sending
    console.log(`Sending password reset email to ${email} with token: ${token}`)
    // In real implementation, integrate with email service
  }
  
  private async addUserToOrganization(user: User, organizationCode: string): Promise<void> {
    // Mock organization assignment
    console.log(`Adding user ${user.id} to organization with code: ${organizationCode}`)
    // In real implementation, update user's organization membership
  }
}

// Export singleton instance
export const authService = new AuthService()