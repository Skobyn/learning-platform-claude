import { test, expect } from '@playwright/test';

test.describe('Course Enrollment Flow', () => {
  // Use authenticated state for tests that require login
  test.use({ storageState: 'tests/fixtures/auth-state.json' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should browse and view course details', async ({ page }) => {
    // Navigate to courses page
    await page.click('text=Courses');
    await expect(page).toHaveURL('/courses');

    // Should display course grid
    await expect(page.locator('[data-testid="course-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="course-card"]').first()).toBeVisible();

    // Click on a course to view details
    const firstCourse = page.locator('[data-testid="course-card"]').first();
    await firstCourse.click();

    // Should navigate to course detail page
    await expect(page).toHaveURL(/\/courses\/[^\/]+$/);
    
    // Course details should be visible
    await expect(page.locator('[data-testid="course-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="course-description"]')).toBeVisible();
    await expect(page.locator('[data-testid="course-price"]')).toBeVisible();
    await expect(page.locator('[data-testid="course-lessons"]')).toBeVisible();
    await expect(page.locator('[data-testid="enroll-button"]')).toBeVisible();
  });

  test('should filter courses by category', async ({ page }) => {
    await page.goto('/courses');

    // Wait for courses to load
    await expect(page.locator('[data-testid="course-card"]').first()).toBeVisible();
    
    // Count initial courses
    const initialCourseCount = await page.locator('[data-testid="course-card"]').count();

    // Apply programming filter
    await page.click('[data-testid="filter-programming"]');
    
    // Should show loading state
    await expect(page.locator('[data-testid="courses-loading"]')).toBeVisible();
    
    // Wait for filtered results
    await page.waitForSelector('[data-testid="course-card"]', { state: 'visible' });
    
    // Should show fewer or equal courses
    const filteredCourseCount = await page.locator('[data-testid="course-card"]').count();
    expect(filteredCourseCount).toBeLessThanOrEqual(initialCourseCount);

    // All visible courses should have programming tag
    const courseTags = page.locator('[data-testid="course-tags"]');
    const tagCount = await courseTags.count();
    
    for (let i = 0; i < tagCount; i++) {
      const tags = courseTags.nth(i);
      await expect(tags.locator('text=Programming')).toBeVisible();
    }
  });

  test('should search for courses', async ({ page }) => {
    await page.goto('/courses');

    const searchInput = page.locator('[data-testid="course-search"]');
    await searchInput.fill('JavaScript');
    await searchInput.press('Enter');

    // Should show loading state
    await expect(page.locator('[data-testid="courses-loading"]')).toBeVisible();

    // Should display search results
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
    await expect(page.locator('text=Search results for "JavaScript"')).toBeVisible();

    // Results should contain JavaScript-related courses
    const courseCards = page.locator('[data-testid="course-card"]');
    const courseCount = await courseCards.count();
    
    expect(courseCount).toBeGreaterThan(0);

    // Check that results are relevant
    for (let i = 0; i < Math.min(3, courseCount); i++) {
      const courseTitle = courseCards.nth(i).locator('[data-testid="course-title"]');
      const titleText = await courseTitle.textContent();
      expect(titleText?.toLowerCase()).toContain('javascript');
    }
  });

  test('should enroll in a free course', async ({ page }) => {
    await page.goto('/courses');

    // Find a free course
    const freeCourse = page.locator('[data-testid="course-card"]:has([data-testid="free-badge"])').first();
    await expect(freeCourse).toBeVisible();
    
    await freeCourse.click();

    // Should be on course detail page
    await expect(page.locator('[data-testid="course-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="free-badge"]')).toBeVisible();

    // Click enroll button
    await page.click('[data-testid="enroll-button"]');

    // Should show enrollment confirmation
    await expect(page.locator('[data-testid="enrollment-success"]')).toBeVisible();
    await expect(page.locator('text=Successfully enrolled!')).toBeVisible();

    // Enroll button should change to "Start Learning"
    await expect(page.locator('[data-testid="start-learning-button"]')).toBeVisible();

    // Should be able to access first lesson
    await page.click('[data-testid="start-learning-button"]');
    await expect(page).toHaveURL(/\/courses\/[^\/]+\/lessons\/[^\/]+$/);
  });

  test('should handle paid course enrollment', async ({ page }) => {
    await page.goto('/courses');

    // Find a paid course
    const paidCourse = page.locator('[data-testid="course-card"]:has([data-testid="course-price"]:not(:has-text("Free")))').first();
    await expect(paidCourse).toBeVisible();
    
    await paidCourse.click();

    // Should show price and enroll button
    await expect(page.locator('[data-testid="course-price"]')).toBeVisible();
    await expect(page.locator('[data-testid="enroll-button"]')).toBeVisible();

    // Click enroll button
    await page.click('[data-testid="enroll-button"]');

    // Should redirect to payment page
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.locator('[data-testid="payment-form"]')).toBeVisible();

    // Fill payment form (using test card)
    await page.fill('[data-testid="card-number"]', '4242424242424242');
    await page.fill('[data-testid="card-expiry"]', '12/25');
    await page.fill('[data-testid="card-cvc"]', '123');
    await page.fill('[data-testid="card-name"]', 'Test User');

    // Submit payment
    await page.click('[data-testid="pay-button"]');

    // Should show processing state
    await expect(page.locator('[data-testid="payment-processing"]')).toBeVisible();

    // Should redirect to success page
    await expect(page).toHaveURL(/\/enrollment\/success/);
    await expect(page.locator('text=Payment successful!')).toBeVisible();
    await expect(page.locator('text=You are now enrolled')).toBeVisible();
  });

  test('should add course to wishlist', async ({ page }) => {
    await page.goto('/courses');

    // Find course and add to wishlist
    const course = page.locator('[data-testid="course-card"]').first();
    await course.hover();
    
    const wishlistButton = course.locator('[data-testid="wishlist-button"]');
    await expect(wishlistButton).toBeVisible();
    await wishlistButton.click();

    // Should show success message
    await expect(page.locator('[data-testid="toast-message"]:has-text("Added to wishlist")')).toBeVisible();

    // Button should change state
    await expect(course.locator('[data-testid="wishlist-button-added"]')).toBeVisible();

    // Navigate to wishlist
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Wishlist');

    await expect(page).toHaveURL('/wishlist');
    await expect(page.locator('[data-testid="course-card"]')).toBeVisible();
  });

  test('should view course preview', async ({ page }) => {
    await page.goto('/courses');

    const course = page.locator('[data-testid="course-card"]').first();
    await course.click();

    // Look for preview button
    await expect(page.locator('[data-testid="preview-button"]')).toBeVisible();
    await page.click('[data-testid="preview-button"]');

    // Should open preview modal or navigate to preview
    await expect(page.locator('[data-testid="course-preview"]')).toBeVisible();
    
    // Should show preview content
    await expect(page.locator('[data-testid="preview-video"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-lesson-list"]')).toBeVisible();

    // Should be able to close preview
    const closeButton = page.locator('[data-testid="preview-close"]');
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await expect(page.locator('[data-testid="course-preview"]')).not.toBeVisible();
    }
  });

  test('should sort courses by price', async ({ page }) => {
    await page.goto('/courses');
    
    // Wait for courses to load
    await expect(page.locator('[data-testid="course-card"]').first()).toBeVisible();

    // Open sort dropdown
    await page.click('[data-testid="sort-dropdown"]');
    
    // Sort by price (low to high)
    await page.click('[data-testid="sort-price-asc"]');

    // Wait for results to update
    await page.waitForSelector('[data-testid="course-card"]', { state: 'visible' });

    // Verify sorting (check first few courses)
    const priceElements = page.locator('[data-testid="course-price"]');
    const priceCount = await priceElements.count();
    
    if (priceCount > 1) {
      const firstPrice = await priceElements.nth(0).textContent();
      const secondPrice = await priceElements.nth(1).textContent();
      
      // Parse prices (handle "Free" and "$XX.XX" formats)
      const parsePrice = (priceText: string | null) => {
        if (!priceText || priceText.toLowerCase().includes('free')) return 0;
        return parseFloat(priceText.replace(/[^0-9.]/g, ''));
      };

      expect(parsePrice(firstPrice)).toBeLessThanOrEqual(parsePrice(secondPrice));
    }
  });

  test('should view enrolled courses', async ({ page }) => {
    // First enroll in a course (assuming we have auth state with enrolled courses)
    await page.goto('/dashboard');
    
    // Navigate to my courses
    await page.click('text=My Courses');
    await expect(page).toHaveURL('/courses/my-courses');

    // Should display enrolled courses
    await expect(page.locator('[data-testid="enrolled-courses"]')).toBeVisible();
    await expect(page.locator('[data-testid="course-card"]').first()).toBeVisible();

    // Should show progress for each course
    await expect(page.locator('[data-testid="course-progress"]').first()).toBeVisible();

    // Should be able to continue learning
    const continueButton = page.locator('[data-testid="continue-learning-button"]').first();
    await expect(continueButton).toBeVisible();
    await continueButton.click();

    // Should navigate to course or lesson
    await expect(page).toHaveURL(/\/courses\/[^\/]+/);
  });

  test('should handle course enrollment error', async ({ page }) => {
    await page.goto('/courses');

    // Mock enrollment error
    await page.route('**/api/enrollments', route => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({ message: 'Enrollment failed' })
      });
    });

    const course = page.locator('[data-testid="course-card"]').first();
    await course.click();

    await page.click('[data-testid="enroll-button"]');

    // Should show error message
    await expect(page.locator('[data-testid="error-message"]:has-text("Enrollment failed")')).toBeVisible();

    // Enroll button should be re-enabled
    await expect(page.locator('[data-testid="enroll-button"]')).toBeEnabled();
  });

  test('should view course reviews and ratings', async ({ page }) => {
    await page.goto('/courses');

    const course = page.locator('[data-testid="course-card"]').first();
    await course.click();

    // Should show course rating
    await expect(page.locator('[data-testid="course-rating"]')).toBeVisible();
    await expect(page.locator('[data-testid="rating-stars"]')).toBeVisible();

    // Navigate to reviews section
    await page.click('[data-testid="reviews-tab"]');

    // Should show reviews list
    await expect(page.locator('[data-testid="reviews-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="review-item"]').first()).toBeVisible();

    // Should show review details
    const firstReview = page.locator('[data-testid="review-item"]').first();
    await expect(firstReview.locator('[data-testid="reviewer-name"]')).toBeVisible();
    await expect(firstReview.locator('[data-testid="review-rating"]')).toBeVisible();
    await expect(firstReview.locator('[data-testid="review-text"]')).toBeVisible();
  });

  test('should handle mobile responsive design', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/courses');

    // Course grid should adapt to mobile
    await expect(page.locator('[data-testid="course-grid"]')).toBeVisible();
    
    // Mobile menu should be accessible
    await page.click('[data-testid="mobile-menu-button"]');
    await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible();

    // Course cards should stack vertically
    const courseCards = page.locator('[data-testid="course-card"]');
    const firstCard = courseCards.first();
    const secondCard = courseCards.nth(1);

    const firstCardBox = await firstCard.boundingBox();
    const secondCardBox = await secondCard.boundingBox();

    if (firstCardBox && secondCardBox) {
      // On mobile, second card should be below first card
      expect(secondCardBox.y).toBeGreaterThan(firstCardBox.y + firstCardBox.height - 10);
    }
  });
});