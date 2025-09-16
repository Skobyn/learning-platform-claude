# Contributing to Learning Platform

## Welcome Contributors! 🎉

Thank you for your interest in contributing to the Learning Platform! This guide will help you get started and ensure a smooth contribution process.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors must follow:

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, personal appearance, race, religion, or sexual identity.

### Expected Behavior

- Use welcoming and inclusive language
- Respect differing viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Trolling, insulting comments, and personal attacks
- Public or private harassment
- Publishing others' private information
- Other conduct that could reasonably be considered inappropriate

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Git
- PostgreSQL (for local development)
- Redis (for local development)
- Docker (optional, for containerized development)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
```bash
git clone https://github.com/YOUR_USERNAME/learning-platform.git
cd learning-platform
```

3. Add the original repository as upstream:
```bash
git remote add upstream https://github.com/ORIGINAL_OWNER/learning-platform.git
```

## Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file:
```bash
cp .env.example .env.local
```

Update `.env.local` with your local configuration:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/learning_platform_dev"
NEXTAUTH_SECRET="your-local-secret"
REDIS_URL="redis://localhost:6379"
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed with test data
npm run db:seed
```

### 4. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### 5. Verify Setup

Run the test suite to ensure everything is working:
```bash
npm run test:all
```

## Contributing Guidelines

### Issue Reporting

Before creating a new issue:

1. **Search existing issues** to avoid duplicates
2. **Use the issue template** provided
3. **Include reproduction steps** for bugs
4. **Provide context** for feature requests

#### Bug Reports

When reporting bugs, include:
- Clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, browser, Node.js version)
- Screenshots or error logs if applicable

#### Feature Requests

For new features:
- Describe the use case and problem it solves
- Provide examples or mockups if possible
- Consider the impact on existing functionality
- Discuss alternatives you've considered

### Types of Contributions

We welcome various types of contributions:

- **Bug fixes**
- **New features**
- **Documentation improvements**
- **Performance optimizations**
- **Test coverage improvements**
- **UI/UX enhancements**
- **Accessibility improvements**
- **Security enhancements**

## Pull Request Process

### 1. Create a Branch

Create a feature branch from `main`:
```bash
git checkout main
git pull upstream main
git checkout -b feature/your-feature-name
```

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes  
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test improvements
- `chore/description` - Maintenance tasks

### 2. Make Changes

- Write clean, readable code
- Follow the coding standards
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

### 3. Commit Changes

Use conventional commit messages:
```bash
git commit -m "feat(courses): add course progress tracking

- Implement progress calculation logic  
- Add progress bar component
- Update database schema for progress tracking
- Add unit tests for progress service

Closes #123"
```

#### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting changes
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

### 4. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Create a pull request using the GitHub interface.

### 5. PR Requirements

Your PR must:

- [ ] Include a clear description
- [ ] Reference related issues
- [ ] Pass all automated checks
- [ ] Include tests for new functionality
- [ ] Update documentation if needed
- [ ] Not break existing functionality
- [ ] Follow the coding standards

### PR Review Process

1. **Automated checks** run (tests, linting, type checking)
2. **Code review** by maintainers
3. **Feedback incorporation** if needed
4. **Final approval** and merge

Reviews typically cover:
- Code quality and style
- Test coverage
- Performance implications
- Security considerations
- Documentation accuracy

## Coding Standards

### TypeScript Guidelines

- Use TypeScript for all new code
- Define proper interfaces and types
- Avoid `any` type when possible
- Use strict mode settings

```typescript
// ✅ Good
interface User {
  id: string;
  email: string;
  role: UserRole;
}

// ❌ Avoid
const user: any = { ... };
```

### React Best Practices

- Use functional components with hooks
- Implement proper prop types
- Handle loading and error states
- Use React Query for data fetching

```tsx
// ✅ Good
interface CourseCardProps {
  course: Course;
  onEnroll: (courseId: string) => void;
}

const CourseCard: React.FC<CourseCardProps> = ({ course, onEnroll }) => {
  // Component implementation
};
```

### API Conventions

- Use RESTful endpoints
- Include proper error handling
- Implement request validation
- Return consistent response formats

```typescript
// ✅ Good API response
{
  success: true,
  data: { ... },
  message: "Operation completed successfully"
}

// Error response
{
  success: false,
  error: "VALIDATION_ERROR",
  message: "Email is required",
  details: { ... }
}
```

### Database Guidelines

- Use Prisma schema definitions
- Include proper relations
- Add database indexes for performance
- Use transactions for multi-table operations

### Styling Guidelines

- Use Tailwind CSS for styling
- Follow responsive design principles
- Maintain consistent spacing and typography
- Use CSS variables for theming

### File Organization

```
src/
├── app/                 # Next.js app router
│   ├── api/            # API routes
│   └── (pages)/        # Page components
├── components/         # Reusable components
│   ├── ui/            # Base UI components
│   └── features/      # Feature-specific components
├── lib/               # Utility libraries
├── services/          # Business logic services
├── types/             # TypeScript type definitions
└── utils/             # Helper functions
```

## Testing Requirements

### Test Categories

1. **Unit Tests** - Test individual functions and components
2. **Integration Tests** - Test API endpoints and database operations
3. **Component Tests** - Test React components with user interactions
4. **E2E Tests** - Test complete user workflows

### Writing Tests

#### Unit Tests Example

```typescript
// services/__tests__/course.service.test.ts
import { CourseService } from '../course.service';

describe('CourseService', () => {
  describe('calculateProgress', () => {
    it('should calculate correct progress percentage', () => {
      const completed = 3;
      const total = 10;
      const progress = CourseService.calculateProgress(completed, total);
      
      expect(progress).toBe(30);
    });
  });
});
```

#### Component Tests Example

```tsx
// components/__tests__/CourseCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CourseCard } from '../CourseCard';

describe('CourseCard', () => {
  it('should call onEnroll when enroll button is clicked', () => {
    const mockOnEnroll = jest.fn();
    const mockCourse = { id: '1', title: 'Test Course' };
    
    render(<CourseCard course={mockCourse} onEnroll={mockOnEnroll} />);
    
    fireEvent.click(screen.getByText('Enroll'));
    expect(mockOnEnroll).toHaveBeenCalledWith('1');
  });
});
```

### Test Coverage Requirements

- Minimum 80% code coverage
- All public API endpoints must have tests
- Critical user workflows must have E2E tests
- UI components must have interaction tests

### Running Tests

```bash
# Run all tests
npm run test:all

# Run specific test types
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Documentation

### Required Documentation

1. **Code Comments** - For complex logic
2. **API Documentation** - OpenAPI/Swagger specs
3. **Component Documentation** - Props and usage examples
4. **README Updates** - For new features or setup changes

### Documentation Style

- Use clear, concise language
- Include code examples
- Keep documentation up-to-date
- Use proper markdown formatting

### JSDoc Comments

```typescript
/**
 * Calculates the progress percentage for a course
 * @param completedModules - Number of completed modules
 * @param totalModules - Total number of modules in the course
 * @returns Progress percentage (0-100)
 * @throws {Error} When totalModules is 0 or negative
 */
function calculateProgress(completedModules: number, totalModules: number): number {
  // Implementation
}
```

## Performance Considerations

### Frontend Performance

- Use React.memo for component optimization
- Implement virtual scrolling for large lists
- Optimize images and assets
- Use code splitting for large bundles

### Backend Performance

- Implement proper database indexing
- Use Redis caching effectively
- Optimize API queries
- Monitor performance metrics

### Database Optimization

- Use proper database indexes
- Implement query optimization
- Use connection pooling
- Monitor slow queries

## Security Guidelines

### Input Validation

- Validate all user inputs
- Use Zod for schema validation
- Sanitize data before database operations
- Implement rate limiting

### Authentication & Authorization

- Use NextAuth.js for authentication
- Implement proper role-based access control
- Secure API endpoints
- Use HTTPS in production

### Data Protection

- Never log sensitive information
- Use environment variables for secrets
- Implement proper error handling
- Follow GDPR guidelines for user data

## Accessibility

### Requirements

- Follow WCAG 2.1 AA guidelines
- Implement proper ARIA attributes
- Ensure keyboard navigation works
- Test with screen readers

### Implementation

```tsx
// ✅ Good accessibility
<button
  aria-label="Enroll in JavaScript Fundamentals course"
  onClick={handleEnroll}
  disabled={isEnrolling}
>
  {isEnrolling ? 'Enrolling...' : 'Enroll Now'}
</button>
```

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):
- `MAJOR.MINOR.PATCH`
- Major: Breaking changes
- Minor: New features (backward compatible)
- Patch: Bug fixes

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] Version number bumped
- [ ] CHANGELOG.md updated
- [ ] Security scan completed
- [ ] Performance benchmarks reviewed

## Getting Help

### Communication Channels

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - General questions and community discussions
- **Discord** - Real-time chat with other contributors
- **Email** - maintainers@learning-platform.com

### Asking Questions

When asking for help:

1. Search existing issues and discussions first
2. Provide context and relevant details
3. Include code snippets or screenshots
4. Be respectful and patient

### Mentorship Program

New contributors can request mentorship:
- Pair programming sessions
- Code review guidance
- Architecture discussions
- Career development advice

## Recognition

### Contributor Recognition

We recognize contributors through:
- **All Contributors** bot on GitHub
- **Contributors page** on our website
- **Monthly contributor highlights**
- **Swag and rewards** for significant contributions

### Contribution Types

We recognize various contribution types:
- Code contributions
- Documentation improvements
- Bug reports and testing
- Design and UX feedback
- Community support and mentoring
- Translations and internationalization

## FAQ

### Common Questions

**Q: How do I set up the development environment on Windows?**
A: Use WSL2 for the best development experience on Windows. Follow our Windows setup guide in the wiki.

**Q: Can I work on multiple issues at the same time?**
A: It's better to focus on one issue at a time to avoid conflicts and ensure quality.

**Q: How long does the PR review process take?**
A: Most PRs are reviewed within 2-3 business days. Complex changes may take longer.

**Q: What if my PR conflicts with recent changes?**
A: Rebase your branch against the latest main branch and resolve conflicts locally.

**Q: Can I contribute if I'm a beginner?**
A: Absolutely! Look for issues labeled "good first issue" or "beginner-friendly".

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

## Thank You

Thank you for taking the time to contribute! Your efforts help make the Learning Platform better for everyone. We appreciate your dedication to creating an inclusive, high-quality educational platform.

---

*This contributing guide is a living document. Please suggest improvements through issues or pull requests.*