import { AuthService } from '../../src/services/auth.service';
import { mockApiResponse, mockApiError } from '../utils/test-helpers';

// Mock axios
jest.mock('axios');

describe('AuthService', () => {
  let authService: AuthService;
  let mockAxios: any;

  beforeEach(() => {
    const axios = require('axios');
    mockAxios = {
      post: jest.fn(),
      get: jest.fn(),
      defaults: { headers: { common: {} } }
    };
    axios.create = jest.fn().mockReturnValue(mockAxios);
    
    authService = new AuthService();
    
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    const loginData = {
      email: 'test@example.com',
      password: 'password123'
    };

    const mockLoginResponse = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'student'
      },
      token: 'mock-jwt-token',
      refreshToken: 'mock-refresh-token'
    };

    it('should successfully login with valid credentials', async () => {
      mockAxios.post.mockResolvedValue({
        data: mockLoginResponse
      });

      const result = await authService.login(loginData);

      expect(mockAxios.post).toHaveBeenCalledWith('/auth/login', loginData);
      expect(result).toEqual(mockLoginResponse);
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'mock-jwt-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('refreshToken', 'mock-refresh-token');
      expect(mockAxios.defaults.headers.common['Authorization']).toBe('Bearer mock-jwt-token');
    });

    it('should throw error with invalid credentials', async () => {
      mockAxios.post.mockRejectedValue({
        response: {
          status: 401,
          data: { message: 'Invalid credentials' }
        }
      });

      await expect(authService.login(loginData)).rejects.toThrow('Invalid credentials');
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should validate email format', async () => {
      const invalidEmailData = {
        email: 'invalid-email',
        password: 'password123'
      };

      await expect(authService.login(invalidEmailData)).rejects.toThrow('Invalid email format');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should validate password length', async () => {
      const shortPasswordData = {
        email: 'test@example.com',
        password: '123'
      };

      await expect(authService.login(shortPasswordData)).rejects.toThrow('Password must be at least 6 characters');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      mockAxios.post.mockRejectedValue(new Error('Network Error'));

      await expect(authService.login(loginData)).rejects.toThrow('Network Error');
    });
  });

  describe('register', () => {
    const registerData = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      confirmPassword: 'password123'
    };

    const mockRegisterResponse = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'student'
      },
      token: 'mock-jwt-token',
      refreshToken: 'mock-refresh-token'
    };

    it('should successfully register new user', async () => {
      mockAxios.post.mockResolvedValue({
        data: mockRegisterResponse
      });

      const result = await authService.register(registerData);

      expect(mockAxios.post).toHaveBeenCalledWith('/auth/register', {
        name: registerData.name,
        email: registerData.email,
        password: registerData.password
      });
      expect(result).toEqual(mockRegisterResponse);
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'mock-jwt-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('refreshToken', 'mock-refresh-token');
    });

    it('should validate password confirmation', async () => {
      const mismatchPasswordData = {
        ...registerData,
        confirmPassword: 'different-password'
      };

      await expect(authService.register(mismatchPasswordData)).rejects.toThrow('Passwords do not match');
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      const incompleteData = {
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'password123'
        // missing name
      };

      await expect(authService.register(incompleteData as any)).rejects.toThrow('Name is required');
    });

    it('should handle duplicate email error', async () => {
      mockAxios.post.mockRejectedValue({
        response: {
          status: 409,
          data: { message: 'Email already exists' }
        }
      });

      await expect(authService.register(registerData)).rejects.toThrow('Email already exists');
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      localStorage.setItem('token', 'mock-token');
      localStorage.setItem('refreshToken', 'mock-refresh-token');
      mockAxios.defaults.headers.common['Authorization'] = 'Bearer mock-token';
    });

    it('should clear authentication data', async () => {
      await authService.logout();

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(mockAxios.defaults.headers.common['Authorization']).toBeUndefined();
    });

    it('should call logout endpoint if token exists', async () => {
      mockAxios.post.mockResolvedValue({});

      await authService.logout();

      expect(mockAxios.post).toHaveBeenCalledWith('/auth/logout');
    });

    it('should handle logout endpoint errors gracefully', async () => {
      mockAxios.post.mockRejectedValue(new Error('Network Error'));

      // Should not throw error
      await expect(authService.logout()).resolves.toBeUndefined();
      
      // But should still clear local data
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    });
  });

  describe('getCurrentUser', () => {
    const mockUser = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'student'
    };

    it('should return current user when authenticated', async () => {
      localStorage.setItem('token', 'mock-token');
      mockAxios.get.mockResolvedValue({ data: mockUser });

      const result = await authService.getCurrentUser();

      expect(mockAxios.get).toHaveBeenCalledWith('/users/me');
      expect(result).toEqual(mockUser);
    });

    it('should return null when no token', async () => {
      localStorage.removeItem('token');

      const result = await authService.getCurrentUser();

      expect(result).toBeNull();
      expect(mockAxios.get).not.toHaveBeenCalled();
    });

    it('should handle expired token', async () => {
      localStorage.setItem('token', 'expired-token');
      mockAxios.get.mockRejectedValue({
        response: { status: 401 }
      });

      const result = await authService.getCurrentUser();

      expect(result).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      localStorage.setItem('refreshToken', 'mock-refresh-token');
      const mockRefreshResponse = {
        token: 'new-token',
        refreshToken: 'new-refresh-token'
      };
      
      mockAxios.post.mockResolvedValue({ data: mockRefreshResponse });

      const result = await authService.refreshToken();

      expect(mockAxios.post).toHaveBeenCalledWith('/auth/refresh', {
        refreshToken: 'mock-refresh-token'
      });
      expect(result).toEqual(mockRefreshResponse);
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'new-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh-token');
    });

    it('should throw error when no refresh token', async () => {
      localStorage.removeItem('refreshToken');

      await expect(authService.refreshToken()).rejects.toThrow('No refresh token available');
    });

    it('should handle invalid refresh token', async () => {
      localStorage.setItem('refreshToken', 'invalid-token');
      mockAxios.post.mockRejectedValue({
        response: { status: 401 }
      });

      await expect(authService.refreshToken()).rejects.toThrow();
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when token exists', () => {
      localStorage.setItem('token', 'mock-token');

      const result = authService.isAuthenticated();

      expect(result).toBe(true);
    });

    it('should return false when no token', () => {
      localStorage.removeItem('token');

      const result = authService.isAuthenticated();

      expect(result).toBe(false);
    });
  });
});