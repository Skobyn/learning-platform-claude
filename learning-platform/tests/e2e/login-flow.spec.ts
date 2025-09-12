import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should complete successful login flow', async ({ page }) => {
    // Navigate to login page
    await page.click('text=Sign In');
    await expect(page).toHaveURL('/login');

    // Verify login form elements
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Fill login form
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');

    // Submit form
    await page.click('[data-testid="login-button"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();

    // Should show user name in header
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await expect(page.locator('text=Test User')).toBeVisible();
  });

  test('should show validation errors for empty fields', async ({ page }) => {
    await page.goto('/login');

    // Try to submit empty form
    await page.click('[data-testid="login-button"]');

    // Should show validation errors
    await expect(page.locator('text=Email is required')).toBeVisible();
    await expect(page.locator('text=Password is required')).toBeVisible();
    
    // Should remain on login page
    await expect(page).toHaveURL('/login');
  });

  test('should show error for invalid email format', async ({ page }) => {
    await page.goto('/login');

    await page.fill('[data-testid="email-input"]', 'invalid-email');
    await page.fill('[data-testid="password-input"]', 'password123');
    await page.blur('[data-testid="email-input"]');

    await expect(page.locator('text=Invalid email format')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('[data-testid="email-input"]', 'wrong@example.com');
    await page.fill('[data-testid="password-input"]', 'wrongpassword');
    await page.click('[data-testid="login-button"]');

    await expect(page.locator('[role="alert"]:has-text("Invalid credentials")')).toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    await page.goto('/login');

    const passwordInput = page.locator('[data-testid="password-input"]');
    const toggleButton = page.locator('[data-testid="password-toggle"]');

    // Initially password should be hidden
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click toggle to show password
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Click toggle to hide password again
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('should handle remember me functionality', async ({ page }) => {
    await page.goto('/login');

    const rememberCheckbox = page.locator('[data-testid="remember-checkbox"]');
    
    // Check remember me
    await rememberCheckbox.check();
    await expect(rememberCheckbox).toBeChecked();

    // Complete login
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');
    await page.click('[data-testid="login-button"]');

    // Should be logged in
    await expect(page).toHaveURL('/dashboard');

    // Simulate browser restart by clearing session storage but keeping local storage
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    // Should still be logged in due to remember me
    await expect(page).toHaveURL('/dashboard');
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/login');

    await page.click('text=Sign up');
    await expect(page).toHaveURL('/register');
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.goto('/login');

    await page.click('text=Forgot password?');
    await expect(page).toHaveURL('/forgot-password');
  });

  test('should handle keyboard navigation', async ({ page }) => {
    await page.goto('/login');

    // Tab through form elements
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="email-input"]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="password-input"]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="remember-checkbox"]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="login-button"]')).toBeFocused();

    // Fill form using keyboard
    await page.keyboard.press('Shift+Tab'); // Go back to remember checkbox
    await page.keyboard.press('Shift+Tab'); // Go back to password
    await page.keyboard.press('Shift+Tab'); // Go back to email
    
    await page.keyboard.type('test@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('password123');
    
    // Submit using Enter key
    await page.keyboard.press('Enter');
    
    await expect(page).toHaveURL('/dashboard');
  });

  test('should handle social login', async ({ page }) => {
    await page.goto('/login');

    // Check if social login buttons are present
    await expect(page.locator('[data-testid="google-login-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="facebook-login-button"]')).toBeVisible();

    // Click Google login (in real app this would redirect to OAuth)
    const googleButton = page.locator('[data-testid="google-login-button"]');
    await googleButton.click();

    // In a real test, you would handle OAuth flow
    // For now, just verify button interaction
    await expect(googleButton).toHaveAttribute('data-provider', 'google');
  });

  test('should show loading state during login', async ({ page }) => {
    await page.goto('/login');

    // Fill form
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');

    // Intercept login request to add delay
    await page.route('**/api/auth/login', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });

    // Submit form
    await page.click('[data-testid="login-button"]');

    // Should show loading state
    await expect(page.locator('[data-testid="login-button"]:has-text("Signing in...")')).toBeVisible();
    await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();

    // Button should be disabled
    await expect(page.locator('[data-testid="login-button"]')).toBeDisabled();

    // Should eventually succeed
    await expect(page).toHaveURL('/dashboard', { timeout: 10000 });
  });

  test('should redirect to intended page after login', async ({ page }) => {
    // Try to access protected route
    await page.goto('/courses/my-courses');

    // Should redirect to login with redirect parameter
    await expect(page).toHaveURL(/.*login.*redirect/);

    // Complete login
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');
    await page.click('[data-testid="login-button"]');

    // Should redirect to originally requested page
    await expect(page).toHaveURL('/courses/my-courses');
  });

  test('should logout user', async ({ page }) => {
    // First login
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');
    await page.click('[data-testid="login-button"]');
    
    await expect(page).toHaveURL('/dashboard');

    // Open user menu and logout
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Logout');

    // Should redirect to home page
    await expect(page).toHaveURL('/');

    // Should show login link again
    await expect(page.locator('text=Sign In')).toBeVisible();

    // Trying to access protected route should redirect to login
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
  });

  test('should handle session expiry', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');
    await page.click('[data-testid="login-button"]');
    
    await expect(page).toHaveURL('/dashboard');

    // Simulate token expiry by intercepting API calls
    await page.route('**/api/**', async route => {
      const response = await page.request.fetch(route.request());
      if (route.request().url().includes('/api/')) {
        await route.fulfill({
          status: 401,
          body: JSON.stringify({ message: 'Token expired' })
        });
      } else {
        await route.fulfill({ response });
      }
    });

    // Try to access API endpoint
    await page.click('[data-testid="profile-link"]');

    // Should redirect to login due to expired token
    await expect(page).toHaveURL('/login');
    await expect(page.locator('[role="alert"]:has-text("Session expired")')).toBeVisible();
  });
});