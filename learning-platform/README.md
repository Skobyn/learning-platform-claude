# 🎓 Enterprise Learning Platform

A comprehensive, AI-powered learning management system built with Next.js 14, TypeScript, and PostgreSQL. This platform enables organizations to deliver training, track progress, and certify skills through an intuitive, modern interface.

## 📁 Testing Structure

```
/tests/
├── unit/                    # Unit tests for services and utilities
│   ├── auth.service.test.ts
│   ├── course.service.test.ts
│   └── progress.service.test.ts
├── integration/             # API endpoint integration tests
│   ├── auth.api.test.ts
│   └── courses.api.test.ts
├── components/              # React component tests
│   ├── LoginForm.test.tsx
│   ├── CourseCard.test.tsx
│   └── ProgressTracker.test.tsx
├── e2e/                     # End-to-end user workflow tests
│   ├── login-flow.spec.ts
│   ├── course-enrollment.spec.ts
│   └── learning-experience.spec.ts
├── fixtures/                # Test data and setup utilities
│   ├── test-data.ts
│   └── database-setup.ts
└── utils/                   # Testing utilities and helpers
    ├── test-helpers.ts
    ├── mock-server.ts
    ├── global-setup.ts
    └── global-teardown.ts
```

## 🚀 Running Tests

### All Tests
```bash
npm run test:all          # Run all test suites
npm run test             # Run unit and integration tests
npm run test:watch       # Run tests in watch mode
```

### Specific Test Types
```bash
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:components  # Component tests only
npm run test:e2e         # End-to-end tests only
```

### Coverage and Reports
```bash
npm run test:coverage    # Generate coverage report
npm run coverage:open    # Open coverage report in browser
```

### Playwright E2E Tests
```bash
npm run test:e2e:ui      # Run E2E tests with UI
npm run test:e2e:debug   # Run E2E tests in debug mode
npm run playwright:codegen # Generate test code
```

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)
- TypeScript support with ts-jest
- React Testing Library integration
- 80%+ coverage thresholds
- MSW for API mocking
- Custom test utilities

### Playwright Configuration (`playwright.config.ts`)
- Multi-browser testing (Chrome, Firefox, Safari)
- Mobile viewport testing
- Screenshot and video capture on failures
- Parallel test execution

### Coverage Requirements
```javascript
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

## 📊 Test Types and Examples

### Unit Tests
Test individual functions, services, and utilities:

```typescript
describe('AuthService', () => {
  it('should login with valid credentials', async () => {
    const result = await authService.login({
      email: 'test@example.com',
      password: 'password123'
    });
    expect(result).toHaveProperty('token');
  });
});
```

### Integration Tests
Test API endpoints with real database:

```typescript
describe('POST /api/auth/login', () => {
  it('should return 200 for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);
  });
});
```

### Component Tests
Test React components with user interactions:

```typescript
describe('LoginForm', () => {
  it('should submit form with valid data', async () => {
    render(<LoginForm onSuccess={mockOnSuccess} />);
    
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });
});
```

### End-to-End Tests
Test complete user workflows:

```typescript
test('should complete course enrollment flow', async ({ page }) => {
  await page.goto('/courses');
  await page.click('[data-testid="course-card"]');
  await page.click('[data-testid="enroll-button"]');
  await expect(page.locator('text=Successfully enrolled')).toBeVisible();
});
```

## 🎯 Testing Best Practices

### 1. Test Organization
- Group related tests in `describe` blocks
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

### 2. Test Data Management
- Use factories for generating test data
- Maintain clean test fixtures
- Isolate tests with proper setup/teardown

### 3. Mocking Strategy
- Mock external dependencies
- Use MSW for API mocking
- Keep mocks simple and focused

### 4. Accessibility Testing
- Include accessibility tests with jest-axe
- Test keyboard navigation
- Verify ARIA attributes

### 5. Performance Testing
- Measure component render times
- Test with large datasets
- Monitor memory usage

## 📋 Test Utilities

### Test Helpers (`tests/utils/test-helpers.ts`)
- `renderWithProviders`: Render components with context providers
- `createQueryClient`: Create test query client
- `mockApiResponse`: Mock API responses
- `fillForm`: Fill form inputs programmatically

### Mock Server (`tests/utils/mock-server.ts`)
- MSW request handlers for all API endpoints
- Realistic test data responses
- Error condition simulation

### Database Setup (`tests/fixtures/database-setup.ts`)
- Test database initialization
- Seed data management
- Transaction helpers for complex scenarios

## 🔄 CI/CD Integration

### GitHub Actions (`.github/workflows/test.yml`)
- Run tests on multiple Node.js versions
- PostgreSQL service for integration tests
- Coverage reporting with Codecov
- Lighthouse performance audits
- Security vulnerability scanning

### Pre-commit Hooks
```bash
# Install pre-commit hooks
npm run prepare

# Hooks run automatically on commit:
# - Linting with ESLint
# - Type checking with TypeScript
# - Unit tests for changed files
```

## 📈 Coverage Reports

Coverage reports are generated in multiple formats:
- **HTML**: `coverage/lcov-report/index.html`
- **LCOV**: `coverage/lcov.info`
- **JSON**: `coverage/coverage-final.json`

### Viewing Coverage
```bash
npm run test:coverage     # Generate coverage
npm run coverage:open     # Open HTML report
```

## 🐛 Debugging Tests

### Unit/Integration Tests
```bash
# Debug with VS Code
# Set breakpoints and run "Debug Jest Tests" configuration

# Debug with Node inspector
node --inspect-brk ./node_modules/.bin/jest --runInBand
```

### E2E Tests
```bash
# Debug mode with browser
npm run test:e2e:debug

# Headed mode
npx playwright test --headed

# Record test actions
npm run playwright:codegen
```

## 📝 Writing New Tests

### 1. Unit Test Template
```typescript
import { ServiceName } from '../../src/services/service-name';

describe('ServiceName', () => {
  let service: ServiceName;
  
  beforeEach(() => {
    service = new ServiceName();
  });
  
  describe('methodName', () => {
    it('should handle expected behavior', () => {
      // Arrange
      const input = 'test input';
      
      // Act
      const result = service.methodName(input);
      
      // Assert
      expect(result).toBe('expected output');
    });
  });
});
```

### 2. Component Test Template
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../utils/test-helpers';
import { ComponentName } from '../../src/components/ComponentName';

describe('ComponentName', () => {
  const defaultProps = {
    prop1: 'value1',
    onAction: jest.fn()
  };
  
  it('should render correctly', () => {
    renderWithProviders(<ComponentName {...defaultProps} />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### 3. E2E Test Template
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should complete user workflow', async ({ page }) => {
    await page.goto('/start-page');
    
    // Perform actions
    await page.click('[data-testid="action-button"]');
    
    // Verify results
    await expect(page.locator('text=Success Message')).toBeVisible();
  });
});
```

## 🎯 Test Quality Metrics

- **Coverage**: 80%+ for all categories
- **Performance**: <100ms for unit tests
- **Reliability**: <1% flaky test rate
- **Maintainability**: Clear, readable test code
- **Isolation**: No test interdependencies

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Setup test database**:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

3. **Install Playwright browsers**:
   ```bash
   npm run playwright:install
   ```

4. **Run tests**:
   ```bash
   npm run test:all
   ```

## 📚 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library Guide](https://testing-library.com/docs/)
- [Playwright Documentation](https://playwright.dev/)
- [MSW Documentation](https://mswjs.io/docs/)

---

This comprehensive testing framework ensures reliable, maintainable code with excellent user experience validation through multiple testing layers.