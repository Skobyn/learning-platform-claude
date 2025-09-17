import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { ThemeProvider } from '../../src/contexts/ThemeContext';

// Test user mock
export const mockUser = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'student' as const,
  avatar: null,
  enrollments: [],
  progress: []
};

// Test course mock
export const mockCourse = {
  id: '1',
  title: 'JavaScript Fundamentals',
  description: 'Learn the basics of JavaScript programming',
  price: 99.99,
  level: 'beginner' as const,
  duration: 3600,
  rating: 4.5,
  studentCount: 150,
  instructorId: '2',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lessons: [
    {
      id: '1',
      title: 'Variables and Data Types',
      content: 'Understanding JavaScript variables',
      type: 'video' as const,
      duration: 900,
      order: 1,
      courseId: '1'
    }
  ]
};

// Custom render with providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialAuthState?: {
    user?: typeof mockUser | null;
    isAuthenticated?: boolean;
    loading?: boolean;
  };
  queryClient?: QueryClient;
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
) {
  const {
    initialAuthState = { 
      user: mockUser, 
      isAuthenticated: true, 
      loading: false 
    },
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          cacheTime: 0,
        },
      },
    }),
    initialRoute = '/',
    ...renderOptions
  } = options;

  // Mock AuthContext
  const mockAuthContext = {
    ...initialAuthState,
    login: jest.fn(),
    logout: jest.fn(),
    register: jest.fn(),
    updateProfile: jest.fn()
  };

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider value={mockAuthContext}>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Custom hook testing utility
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Wait for async operations
export const waitFor = (ms: number) => 
  new Promise(resolve => setTimeout(resolve, ms));

// Mock API responses
export const mockApiResponse = <T>(data: T, delay = 0) => {
  return new Promise<T>(resolve => {
    setTimeout(() => resolve(data), delay);
  });
};

// Mock API error
export const mockApiError = (message: string, status = 400, delay = 0) => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(message);
      (error as any).response = { status, data: { message } };
      reject(error);
    }, delay);
  });
};

// Form testing helpers
export const fillForm = async (
  container: HTMLElement,
  data: Record<string, string>
) => {
  const { fireEvent } = await import('@testing-library/react');
  
  Object.entries(data).forEach(([name, value]) => {
    const input = container.querySelector(`[name="${name}"]`) as HTMLInputElement;
    if (input) {
      fireEvent.change(input, { target: { value } });
    }
  });
};

// Local storage helpers for testing
export const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

// Session storage helpers for testing
export const mockSessionStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

// Mock fetch
export const mockFetch = (response: any, ok = true, status = 200) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(response),
    text: jest.fn().mockResolvedValue(JSON.stringify(response)),
  });
};

// Accessibility testing helper
export const checkA11y = async (container: HTMLElement) => {
  const { axe, toHaveNoViolations } = await import('jest-axe');
  expect.extend(toHaveNoViolations);
  
  const results = await axe(container);
  expect(results).toHaveNoViolations();
};

// Performance testing helper
export const measurePerformance = async (fn: () => Promise<void> | void) => {
  const start = performance.now();
  await fn();
  const end = performance.now();
  return end - start;
};