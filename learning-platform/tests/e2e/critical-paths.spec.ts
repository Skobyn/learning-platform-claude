/**
 * Critical Path E2E Tests
 * Tests for the most important user workflows in the learning platform
 */

import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../page-objects/LoginPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { CoursePage } from '../page-objects/CoursePage';
import { QuizPage } from '../page-objects/QuizPage';

// Test data
const testUsers = {
  learner: {
    email: 'learner@test.com',
    password: 'password123',
    firstName: 'John',
    lastName: 'Learner'
  },
  instructor: {
    email: 'instructor@test.com',
    password: 'password123',
    firstName: 'Jane',
    lastName: 'Instructor'
  },
  admin: {
    email: 'admin@test.com',
    password: 'password123',
    firstName: 'Admin',
    lastName: 'User'
  }
};

const testCourse = {
  title: 'JavaScript Fundamentals',
  description: 'Learn the basics of JavaScript programming',
  level: 'beginner'
};

test.describe('Critical User Workflows', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;
  let coursePage: CoursePage;
  let quizPage: QuizPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    coursePage = new CoursePage(page);
    quizPage = new QuizPage(page);
  });

  test.describe('User Authentication Flow', () => {
    test('should complete full registration and login flow', async ({ page }) => {
      // Navigate to registration page
      await page.goto('/register');
      
      // Fill registration form
      await page.fill('[data-testid=firstName]', testUsers.learner.firstName);
      await page.fill('[data-testid=lastName]', testUsers.learner.lastName);
      await page.fill('[data-testid=email]', testUsers.learner.email);
      await page.fill('[data-testid=password]', testUsers.learner.password);
      await page.fill('[data-testid=confirmPassword]', testUsers.learner.password);
      
      // Submit registration
      await page.click('[data-testid=register-submit]');
      
      // Should redirect to email verification page
      await expect(page).toHaveURL('/verify-email');
      await expect(page.locator('[data-testid=verification-message]')).toBeVisible();
      
      // Simulate email verification (in real test, would check email)
      await page.goto('/login');
      
      // Login with new account
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      
      // Should redirect to dashboard
      await expect(page).toHaveURL('/dashboard');
      await expect(page.locator('[data-testid=welcome-message]')).toBeVisible();
    });

    test('should handle login with invalid credentials', async ({ page }) => {
      await page.goto('/login');
      
      // Attempt login with invalid credentials
      await loginPage.login('invalid@email.com', 'wrongpassword');
      
      // Should show error message
      await expect(page.locator('[data-testid=error-message]')).toContainText('Invalid credentials');
      await expect(page).toHaveURL('/login');
    });

    test('should complete password reset flow', async ({ page }) => {
      await page.goto('/forgot-password');
      
      // Request password reset
      await page.fill('[data-testid=email]', testUsers.learner.email);
      await page.click('[data-testid=reset-submit]');
      
      // Should show success message
      await expect(page.locator('[data-testid=success-message]')).toBeVisible();
      
      // Simulate clicking reset link (would come from email)
      await page.goto('/reset-password?token=mock-reset-token');
      
      // Reset password
      await page.fill('[data-testid=new-password]', 'newpassword123');
      await page.fill('[data-testid=confirm-password]', 'newpassword123');
      await page.click('[data-testid=reset-password-submit]');
      
      // Should redirect to login
      await expect(page).toHaveURL('/login');
      await expect(page.locator('[data-testid=success-message]')).toContainText('Password reset successful');
      
      // Login with new password
      await loginPage.login(testUsers.learner.email, 'newpassword123');
      await expect(page).toHaveURL('/dashboard');
    });
  });

  test.describe('Course Discovery and Enrollment', () => {
    test.beforeEach(async ({ page }) => {
      // Login as learner
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      await expect(page).toHaveURL('/dashboard');
    });

    test('should discover and enroll in a course', async ({ page }) => {
      // Navigate to course catalog
      await page.click('[data-testid=browse-courses]');
      await expect(page).toHaveURL('/courses');
      
      // Search for courses
      await page.fill('[data-testid=search-input]', 'JavaScript');
      await page.press('[data-testid=search-input]', 'Enter');
      
      // Wait for search results
      await page.waitForSelector('[data-testid=course-card]');
      
      // Apply filters
      await page.selectOption('[data-testid=level-filter]', 'beginner');
      await page.selectOption('[data-testid=category-filter]', 'programming');
      
      // Click on first course
      const firstCourse = page.locator('[data-testid=course-card]').first();
      await expect(firstCourse).toBeVisible();
      await firstCourse.click();
      
      // Should navigate to course detail page
      await expect(page.url()).toContain('/courses/');
      
      // Check course information
      await expect(page.locator('[data-testid=course-title]')).toBeVisible();
      await expect(page.locator('[data-testid=course-description]')).toBeVisible();
      await expect(page.locator('[data-testid=course-modules]')).toBeVisible();
      
      // Enroll in course
      await page.click('[data-testid=enroll-button]');
      
      // Should show enrollment confirmation
      await expect(page.locator('[data-testid=enrollment-success]')).toBeVisible();
      
      // Button should change to "Continue Learning"
      await expect(page.locator('[data-testid=continue-learning-button]')).toBeVisible();
      
      // Navigate back to dashboard
      await page.click('[data-testid=dashboard-link]');
      
      // Should see enrolled course in dashboard
      await expect(page.locator('[data-testid=enrolled-courses]')).toBeVisible();
      await expect(page.locator('[data-testid=course-progress]')).toBeVisible();
    });

    test('should preview course content before enrollment', async ({ page }) => {
      // Navigate to a course
      await page.goto('/courses');
      await page.locator('[data-testid=course-card]').first().click();
      
      // Check preview content
      await page.click('[data-testid=preview-module]');
      
      // Should open preview modal
      await expect(page.locator('[data-testid=preview-modal]')).toBeVisible();
      await expect(page.locator('[data-testid=preview-video]')).toBeVisible();
      
      // Close preview
      await page.click('[data-testid=close-preview]');
      await expect(page.locator('[data-testid=preview-modal]')).not.toBeVisible();
      
      // Check course curriculum
      await expect(page.locator('[data-testid=module-list]')).toBeVisible();
      const modules = page.locator('[data-testid=module-item]');
      await expect(modules).toHaveCount(expect.any(Number));
    });
  });

  test.describe('Learning Experience', () => {
    test.beforeEach(async ({ page }) => {
      // Login and enroll in a course
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      await dashboardPage.navigateToCourse('JavaScript Fundamentals');
    });

    test('should complete a full learning module', async ({ page }) => {
      // Start first module
      await page.click('[data-testid=start-module-1]');
      
      // Watch video content
      await expect(page.locator('[data-testid=video-player]')).toBeVisible();
      await page.click('[data-testid=play-button]');
      
      // Simulate video completion (skip to end)
      await page.click('[data-testid=skip-to-end]');
      await expect(page.locator('[data-testid=video-completed]')).toBeVisible();
      
      // Navigate to next content item
      await page.click('[data-testid=next-content]');
      
      // Read text content
      await expect(page.locator('[data-testid=text-content]')).toBeVisible();
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Mark as read
      await page.click('[data-testid=mark-as-read]');
      
      // Complete interactive exercise
      await page.click('[data-testid=next-content]');
      await expect(page.locator('[data-testid=code-exercise]')).toBeVisible();
      
      // Fill code input
      await page.fill('[data-testid=code-input]', 'console.log("Hello World");');
      await page.click('[data-testid=run-code]');
      
      // Should show success
      await expect(page.locator('[data-testid=exercise-success]')).toBeVisible();
      
      // Complete module
      await page.click('[data-testid=complete-module]');
      
      // Should show module completion
      await expect(page.locator('[data-testid=module-completed]')).toBeVisible();
      
      // Check progress update
      await page.goto('/dashboard');
      await expect(page.locator('[data-testid=progress-bar]')).toHaveAttribute('aria-valuenow', expect.any(String));
    });

    test('should take and pass a quiz', async ({ page }) => {
      // Navigate to quiz
      await page.click('[data-testid=module-quiz]');
      
      // Start quiz
      await expect(page.locator('[data-testid=quiz-instructions]')).toBeVisible();
      await page.click('[data-testid=start-quiz]');
      
      // Answer questions
      const questions = page.locator('[data-testid=quiz-question]');
      const questionCount = await questions.count();
      
      for (let i = 0; i < questionCount; i++) {
        // Multiple choice question
        await page.click(`[data-testid=question-${i}] [data-testid=option-0]`);
        
        if (i < questionCount - 1) {
          await page.click('[data-testid=next-question]');
        }
      }
      
      // Submit quiz
      await page.click('[data-testid=submit-quiz]');
      
      // Confirm submission
      await page.click('[data-testid=confirm-submit]');
      
      // Check results
      await expect(page.locator('[data-testid=quiz-results]')).toBeVisible();
      await expect(page.locator('[data-testid=quiz-score]')).toBeVisible();
      await expect(page.locator('[data-testid=passing-status]')).toContainText('Passed');
      
      // Review answers
      await page.click('[data-testid=review-answers]');
      await expect(page.locator('[data-testid=answer-review]')).toBeVisible();
      
      // Return to course
      await page.click('[data-testid=return-to-course]');
      await expect(page.locator('[data-testid=quiz-completed]')).toBeVisible();
    });

    test('should handle quiz failure and retake', async ({ page }) => {
      // Take quiz and fail intentionally
      await page.click('[data-testid=module-quiz]');
      await page.click('[data-testid=start-quiz]');
      
      // Answer incorrectly
      const questions = page.locator('[data-testid=quiz-question]');
      const questionCount = await questions.count();
      
      for (let i = 0; i < questionCount; i++) {
        // Select last option (likely wrong)
        await page.click(`[data-testid=question-${i}] [data-testid=option-3]`);
        
        if (i < questionCount - 1) {
          await page.click('[data-testid=next-question]');
        }
      }
      
      await page.click('[data-testid=submit-quiz]');
      await page.click('[data-testid=confirm-submit]');
      
      // Should show failure
      await expect(page.locator('[data-testid=quiz-failed]')).toBeVisible();
      await expect(page.locator('[data-testid=retake-button]')).toBeVisible();
      
      // Retake quiz
      await page.click('[data-testid=retake-button]');
      
      // Should start new attempt
      await expect(page.locator('[data-testid=quiz-instructions]')).toBeVisible();
      await expect(page.locator('[data-testid=attempt-number]')).toContainText('Attempt 2');
    });
  });

  test.describe('Course Completion and Certification', () => {
    test.beforeEach(async ({ page }) => {
      // Setup: Login and complete most of course
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
    });

    test('should complete course and receive certificate', async ({ page }) => {
      // Navigate to nearly completed course
      await dashboardPage.navigateToCourse('JavaScript Fundamentals');
      
      // Complete final module
      await page.click('[data-testid=final-module]');
      await coursePage.completeModule();
      
      // Take final assessment
      await page.click('[data-testid=final-assessment]');
      await quizPage.takeQuiz();
      await quizPage.passQuiz();
      
      // Should trigger course completion
      await expect(page.locator('[data-testid=course-completed-modal]')).toBeVisible();
      await expect(page.locator('[data-testid=celebration-animation]')).toBeVisible();
      
      // Generate certificate
      await page.click('[data-testid=generate-certificate]');
      
      // Should show certificate generation progress
      await expect(page.locator('[data-testid=certificate-generating]')).toBeVisible();
      
      // Certificate should be ready
      await expect(page.locator('[data-testid=certificate-ready]')).toBeVisible();
      await expect(page.locator('[data-testid=download-certificate]')).toBeVisible();
      await expect(page.locator('[data-testid=share-certificate]')).toBeVisible();
      
      // Download certificate
      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid=download-certificate]');
      const download = await downloadPromise;
      
      expect(download.suggestedFilename()).toMatch(/certificate.*\.pdf$/);
      
      // Share certificate
      await page.click('[data-testid=share-certificate]');
      await expect(page.locator('[data-testid=share-modal]')).toBeVisible();
      
      // Copy share link
      await page.click('[data-testid=copy-share-link]');
      await expect(page.locator('[data-testid=link-copied]')).toBeVisible();
      
      // Verify certificate appears in profile
      await page.goto('/profile');
      await expect(page.locator('[data-testid=certificates-section]')).toBeVisible();
      await expect(page.locator('[data-testid=certificate-item]')).toBeVisible();
      
      // Badge should be awarded
      await expect(page.locator('[data-testid=badges-section]')).toBeVisible();
      await expect(page.locator('[data-testid=course-completion-badge]')).toBeVisible();
    });

    test('should verify certificate authenticity', async ({ page }) => {
      // Get certificate verification code
      await page.goto('/profile');
      const verificationCode = await page.locator('[data-testid=certificate-code]').textContent();
      
      // Navigate to verification page
      await page.goto('/verify-certificate');
      
      // Enter verification code
      await page.fill('[data-testid=verification-code]', verificationCode);
      await page.click('[data-testid=verify-button]');
      
      // Should show certificate details
      await expect(page.locator('[data-testid=certificate-valid]')).toBeVisible();
      await expect(page.locator('[data-testid=certificate-details]')).toBeVisible();
      await expect(page.locator('[data-testid=certificate-holder]')).toContainText('John Learner');
      await expect(page.locator('[data-testid=course-name]')).toContainText('JavaScript Fundamentals');
      await expect(page.locator('[data-testid=completion-date]')).toBeVisible();
    });
  });

  test.describe('Performance and Accessibility', () => {
    test('should meet performance benchmarks', async ({ page }) => {
      // Navigate to dashboard
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      
      // Measure page load time
      const startTime = Date.now();
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;
      
      // Should load within 3 seconds
      expect(loadTime).toBeLessThan(3000);
      
      // Check Core Web Vitals
      const vitals = await page.evaluate(() => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const vitals = {};
            
            entries.forEach((entry) => {
              if (entry.name === 'first-contentful-paint') {
                vitals.fcp = entry.startTime;
              }
              if (entry.name === 'largest-contentful-paint') {
                vitals.lcp = entry.startTime;
              }
            });
            
            resolve(vitals);
          }).observe({ entryTypes: ['paint', 'largest-contentful-paint'] });
          
          // Timeout after 5 seconds
          setTimeout(() => resolve({}), 5000);
        });
      });
      
      // FCP should be under 1.8 seconds
      if (vitals.fcp) {
        expect(vitals.fcp).toBeLessThan(1800);
      }
      
      // LCP should be under 2.5 seconds
      if (vitals.lcp) {
        expect(vitals.lcp).toBeLessThan(2500);
      }
    });

    test('should be accessible with keyboard navigation', async ({ page }) => {
      await page.goto('/login');
      
      // Navigate using Tab key
      await page.keyboard.press('Tab'); // Email field
      await expect(page.locator('[data-testid=email]')).toBeFocused();
      
      await page.keyboard.press('Tab'); // Password field
      await expect(page.locator('[data-testid=password]')).toBeFocused();
      
      await page.keyboard.press('Tab'); // Login button
      await expect(page.locator('[data-testid=login-submit]')).toBeFocused();
      
      // Should be able to submit with Enter
      await page.fill('[data-testid=email]', testUsers.learner.email);
      await page.fill('[data-testid=password]', testUsers.learner.password);
      await page.keyboard.press('Enter');
      
      await expect(page).toHaveURL('/dashboard');
    });

    test('should support screen readers', async ({ page }) => {
      await page.goto('/login');
      
      // Check ARIA labels
      await expect(page.locator('[data-testid=email]')).toHaveAttribute('aria-label', 'Email address');
      await expect(page.locator('[data-testid=password]')).toHaveAttribute('aria-label', 'Password');
      await expect(page.locator('[data-testid=login-submit]')).toHaveAttribute('aria-label', 'Sign in');
      
      // Check form labels
      await expect(page.locator('label[for="email"]')).toBeVisible();
      await expect(page.locator('label[for="password"]')).toBeVisible();
      
      // Check error announcements
      await page.fill('[data-testid=email]', 'invalid-email');
      await page.click('[data-testid=login-submit]');
      
      const errorElement = page.locator('[data-testid=email-error]');
      await expect(errorElement).toHaveAttribute('role', 'alert');
      await expect(errorElement).toHaveAttribute('aria-live', 'polite');
    });
  });

  test.describe('Mobile Responsive Design', () => {
    test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE
    
    test('should work on mobile devices', async ({ page }) => {
      await page.goto('/login');
      
      // Check mobile navigation
      await expect(page.locator('[data-testid=mobile-menu-button]')).toBeVisible();
      
      // Login on mobile
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      
      // Check mobile dashboard
      await expect(page.locator('[data-testid=mobile-dashboard]')).toBeVisible();
      
      // Open mobile menu
      await page.click('[data-testid=mobile-menu-button]');
      await expect(page.locator('[data-testid=mobile-menu]')).toBeVisible();
      
      // Navigate to courses
      await page.click('[data-testid=mobile-courses-link]');
      await expect(page).toHaveURL('/courses');
      
      // Course cards should be stacked on mobile
      const courseCards = page.locator('[data-testid=course-card]');
      const firstCard = courseCards.first();
      const secondCard = courseCards.nth(1);
      
      if (await firstCard.isVisible() && await secondCard.isVisible()) {
        const firstBox = await firstCard.boundingBox();
        const secondBox = await secondCard.boundingBox();
        
        // Cards should be vertically stacked
        expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height);
      }
    });
  });

  test.describe('Error Handling and Recovery', () => {
    test('should handle network errors gracefully', async ({ page }) => {
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      
      // Simulate network failure
      await page.route('**/api/**', (route) => {
        route.abort('failed');
      });
      
      // Try to navigate to courses
      await page.click('[data-testid=browse-courses]');
      
      // Should show error message
      await expect(page.locator('[data-testid=network-error]')).toBeVisible();
      await expect(page.locator('[data-testid=retry-button]')).toBeVisible();
      
      // Restore network and retry
      await page.unroute('**/api/**');
      await page.click('[data-testid=retry-button]');
      
      // Should load successfully
      await expect(page.locator('[data-testid=course-list]')).toBeVisible();
    });

    test('should handle expired sessions', async ({ page }) => {
      await page.goto('/login');
      await loginPage.login(testUsers.learner.email, testUsers.learner.password);
      
      // Simulate expired session
      await page.evaluate(() => {
        document.cookie = 'next-auth.session-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      });
      
      // Try to access protected route
      await page.goto('/dashboard');
      
      // Should redirect to login
      await expect(page).toHaveURL('/login');
      await expect(page.locator('[data-testid=session-expired-message]')).toBeVisible();
    });
  });
});

// Utility functions for page objects
test.describe('Page Object Utilities', () => {
  test('should validate all page objects work correctly', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    const coursePage = new CoursePage(page);
    const quizPage = new QuizPage(page);
    
    // Test login page
    await page.goto('/login');
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    
    // Login and test other pages
    await loginPage.login(testUsers.learner.email, testUsers.learner.password);
    
    // Test dashboard page
    await expect(dashboardPage.welcomeMessage).toBeVisible();
    await expect(dashboardPage.enrolledCourses).toBeVisible();
    
    // Navigate to course and test course page
    if (await dashboardPage.firstCourse.isVisible()) {
      await dashboardPage.firstCourse.click();
      await expect(coursePage.courseTitle).toBeVisible();
      await expect(coursePage.moduleList).toBeVisible();
    }
  });
});