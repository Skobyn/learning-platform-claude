import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { server } from './utils/mock-server';

// Configure testing library
configure({ testIdAttribute: 'data-testid' });

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.sessionStorage = sessionStorageMock;

// Mock window.location
delete (window as any).location;
window.location = {
  ...window.location,
  assign: jest.fn(),
  reload: jest.fn(),
  replace: jest.fn(),
  href: 'http://localhost:3000',
};

// Setup MSW (Mock Service Worker)
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'warn',
  });
});

afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
  localStorageMock.clear();
  sessionStorageMock.clear();
});

afterAll(() => {
  server.close();
});

// Global test utilities
global.testUtils = {
  mockUser: {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'student',
    avatar: null,
    enrollments: [],
    progress: []
  },
  mockCourse: {
    id: '1',
    title: 'Test Course',
    description: 'Test course description',
    price: 99.99,
    level: 'beginner',
    duration: 3600,
    rating: 4.5,
    studentCount: 100,
    lessons: []
  },
  mockLesson: {
    id: '1',
    title: 'Test Lesson',
    content: 'Test lesson content',
    type: 'video',
    duration: 600,
    order: 1,
    courseId: '1'
  }
};