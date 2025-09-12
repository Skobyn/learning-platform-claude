import { signIn, signOut } from 'next-auth/react';

export const authService = {
  async login(email: string, password: string) {
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      
      return { 
        success: !result?.error, 
        error: result?.error,
        requiresTwoFactor: false,
        token: null,
        user: null
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Login failed', requiresTwoFactor: false, token: null, user: null };
    }
  },

  async register(data: any) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: 'Registration failed' };
    }
  },

  async logout() {
    try {
      await signOut({ redirect: false });
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: 'Logout failed' };
    }
  },

  async resetPassword(email: string) {
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: 'Password reset failed' };
    }
  },
};