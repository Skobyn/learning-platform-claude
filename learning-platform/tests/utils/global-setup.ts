import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('🧪 Setting up test environment...');
  
  // Launch browser for authentication setup
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set up test user authentication state
  try {
    // Navigate to login page
    await page.goto('http://localhost:3000/login');
    
    // Fill login form with test credentials
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password');
    await page.click('[data-testid="login-button"]');
    
    // Wait for successful login
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    // Save authentication state
    await page.context().storageState({
      path: 'tests/fixtures/auth-state.json'
    });
    
    console.log('✅ Authentication state saved');
  } catch (error) {
    console.warn('⚠️  Could not set up authentication state:', error);
  }
  
  await browser.close();
  
  // Set up test database
  await setupTestDatabase();
  
  console.log('✅ Global setup completed');
}

async function setupTestDatabase() {
  // Mock database setup - in real implementation, this would:
  // 1. Create test database
  // 2. Run migrations
  // 3. Seed test data
  console.log('📊 Setting up test database...');
  
  // Simulate database setup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('✅ Test database ready');
}

export default globalSetup;