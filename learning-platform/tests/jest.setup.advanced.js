/**
 * Advanced Jest Setup Configuration
 * Comprehensive test environment setup for the learning platform
 */

import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { setupServer } from 'msw/node';
import { rest } from 'msw';
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

// Polyfills for Node.js environment
Object.assign(global, { TextDecoder, TextEncoder });

// Mock Prisma Client
export const prismaMock = mockDeep<PrismaClient>();

jest.mock('../../src/lib/db', () => ({
  __esModule: true,
  default: prismaMock,
}));

// Mock Redis
jest.mock('ioredis', () => {
  const Redis = require('ioredis-mock');
  return {
    __esModule: true,
    default: Redis,
  };
});

// Mock NextAuth
jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock file upload
const mockMulter = {
  single: () => (req, res, next) => {
    req.file = {
      filename: 'test-file.jpg',
      originalname: 'original-test-file.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-data'),
    };
    next();
  },
};

jest.mock('multer', () => () => mockMulter);

// Mock Google Cloud Storage
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn(() => Promise.resolve()),
        makePublic: jest.fn(() => Promise.resolve()),
        getSignedUrl: jest.fn(() => Promise.resolve(['https://fake-url.com'])),
      })),
    })),
  })),
}));

// Mock Cloud Pub/Sub
jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn(() => ({
    topic: jest.fn(() => ({
      publishMessage: jest.fn(() => Promise.resolve('message-id')),
    })),
  })),
}));

// MSW Server Setup for API mocking
export const server = setupServer(
  // Auth endpoints
  rest.post('/api/auth/login', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        data: {
          user: {
            id: 'user123',
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
            role: 'learner',
          },
          token: 'mock-jwt-token',
        },
      })
    );
  }),

  // Course endpoints
  rest.get('/api/courses', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        data: [
          {
            id: 'course123',
            title: 'Test Course',
            description: 'A test course',
            level: 'beginner',
            duration: 60,
            isPublished: true,
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      })
    );
  }),

  // User endpoints
  rest.get('/api/users/profile', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        data: {
          id: 'user123',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'learner',
        },
      })
    );
  }),

  // Health check
  rest.get('/api/health', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database: 'connected',
          redis: 'connected',
        },
      })
    );
  })
);

// Global test setup
beforeAll(() => {
  // Start MSW server
  server.listen({ onUnhandledRequest: 'warn' });
  
  // Mock console methods to reduce noise in tests
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

beforeEach(() => {
  // Reset all mocks between tests
  mockReset(prismaMock);
  jest.clearAllMocks();
});

afterEach(() => {
  // Reset MSW handlers
  server.resetHandlers();
});

afterAll(() => {
  // Close MSW server
  server.close();
  
  // Restore console
  jest.restoreAllMocks();
});

// Custom matchers
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
  
  toBeValidEmail(received) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid email`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid email`,
        pass: false,
      };
    }
  },
});

// Test utilities
export const createMockUser = (overrides = {}) => ({
  id: 'user123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'learner',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockCourse = (overrides = {}) => ({
  id: 'course123',
  title: 'Test Course',
  description: 'A test course for learning',
  instructorId: 'instructor123',
  categoryId: 'category123',
  level: 'beginner',
  duration: 120,
  prerequisites: [],
  tags: ['test', 'learning'],
  isPublished: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockEnrollment = (overrides = {}) => ({
  id: 'enrollment123',
  userId: 'user123',
  courseId: 'course123',
  enrolledAt: new Date(),
  progress: 0,
  status: 'active',
  ...overrides,
});

// Database test utilities
export const resetDatabase = async () => {
  // Clear all mock data
  mockReset(prismaMock);
};

export const seedTestData = async () => {
  // Seed mock data for tests
  prismaMock.user.findMany.mockResolvedValue([createMockUser()]);
  prismaMock.course.findMany.mockResolvedValue([createMockCourse()]);
  prismaMock.enrollment.findMany.mockResolvedValue([createMockEnrollment()]);
};

// Performance testing utilities
export const measureExecutionTime = async (fn) => {
  const start = performance.now();
  await fn();
  const end = performance.now();
  return end - start;
};

// Mock API response helpers
export const mockApiSuccess = (data, options = {}) => ({
  success: true,
  data,
  message: options.message,
  pagination: options.pagination,
});

export const mockApiError = (error, message, details = {}) => ({
  success: false,
  error,
  message,
  details,
  timestamp: new Date().toISOString(),
});

// Test data factories
export class TestDataFactory {
  static user(overrides = {}) {
    return createMockUser(overrides);
  }
  
  static course(overrides = {}) {
    return createMockCourse(overrides);
  }
  
  static enrollment(overrides = {}) {
    return createMockEnrollment(overrides);
  }
  
  static quiz(overrides = {}) {
    return {
      id: 'quiz123',
      moduleId: 'module123',
      title: 'Test Quiz',
      description: 'A test quiz',
      timeLimit: 30,
      passingScore: 70,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }
  
  static question(overrides = {}) {
    return {
      id: 'question123',
      quizId: 'quiz123',
      type: 'multiple_choice',
      question: 'What is 2 + 2?',
      options: ['3', '4', '5', '6'],
      correctAnswer: ['4'],
      points: 10,
      order: 1,
      ...overrides,
    };
  }
}

// Environment variables for testing
process.env.NODE_ENV = 'test';
process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret';