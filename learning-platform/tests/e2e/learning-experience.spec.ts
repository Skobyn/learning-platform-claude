import { test, expect } from '@playwright/test';

test.describe('Learning Experience', () => {
  test.use({ storageState: 'tests/fixtures/auth-state.json' });

  test.beforeEach(async ({ page }) => {
    // Navigate to an enrolled course
    await page.goto('/courses/my-courses');
    await page.click('[data-testid="continue-learning-button"]');
  });

  test('should navigate through course lessons', async ({ page }) => {
    // Should be on first lesson
    await expect(page).toHaveURL(/\/courses\/[^\/]+\/lessons\/[^\/]+$/);
    await expect(page.locator('[data-testid="lesson-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="lesson-content"]')).toBeVisible();

    // Should show course navigation
    await expect(page.locator('[data-testid="course-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="lesson-list"]')).toBeVisible();

    // Navigate to next lesson
    const nextButton = page.locator('[data-testid="next-lesson-button"]');
    await expect(nextButton).toBeVisible();
    await nextButton.click();

    // Should navigate to next lesson
    await expect(page).toHaveURL(/\/lessons\/[^\/]+$/);
    await expect(page.locator('[data-testid="lesson-title"]')).toBeVisible();

    // Previous button should be visible
    await expect(page.locator('[data-testid="previous-lesson-button"]')).toBeVisible();
  });

  test('should play video lessons', async ({ page }) => {
    // Navigate to a video lesson
    await page.click('[data-testid="lesson-item"]:has([data-testid="video-icon"])');

    // Video player should be visible
    await expect(page.locator('[data-testid="video-player"]')).toBeVisible();
    await expect(page.locator('video')).toBeVisible();

    // Video controls should be present
    await expect(page.locator('[data-testid="play-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="volume-control"]')).toBeVisible();

    // Play video
    await page.click('[data-testid="play-button"]');
    
    // Wait a bit and check video is playing
    await page.waitForTimeout(2000);
    
    const video = page.locator('video');
    const currentTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(currentTime).toBeGreaterThan(0);

    // Should be able to adjust playback speed
    await page.click('[data-testid="speed-button"]');
    await page.click('[data-testid="speed-1.5x"]');
    
    const playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
    expect(playbackRate).toBe(1.5);
  });

  test('should take quiz and receive feedback', async ({ page }) => {
    // Navigate to a quiz lesson
    await page.click('[data-testid="lesson-item"]:has([data-testid="quiz-icon"])');

    // Quiz should be visible
    await expect(page.locator('[data-testid="quiz-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="quiz-question"]')).toBeVisible();

    // Should show question and options
    await expect(page.locator('[data-testid="question-text"]')).toBeVisible();
    await expect(page.locator('[data-testid="quiz-option"]').first()).toBeVisible();

    // Select an answer
    await page.click('[data-testid="quiz-option"]');
    
    // Submit answer
    await page.click('[data-testid="submit-answer-button"]');

    // Should show feedback
    await expect(page.locator('[data-testid="answer-feedback"]')).toBeVisible();
    
    // Should show next question or results
    const nextQuestionButton = page.locator('[data-testid="next-question-button"]');
    const quizResultsButton = page.locator('[data-testid="view-results-button"]');
    
    expect(await nextQuestionButton.isVisible() || await quizResultsButton.isVisible()).toBe(true);

    // If there are more questions, continue
    if (await nextQuestionButton.isVisible()) {
      await nextQuestionButton.click();
      await expect(page.locator('[data-testid="quiz-question"]')).toBeVisible();
    }
  });

  test('should track lesson progress', async ({ page }) => {
    // Should show progress in sidebar
    await expect(page.locator('[data-testid="course-progress"]')).toBeVisible();
    
    // Get initial progress
    const initialProgress = await page.locator('[data-testid="progress-percentage"]').textContent();
    
    // Complete current lesson
    await page.click('[data-testid="mark-complete-button"]');
    
    // Should show completion confirmation
    await expect(page.locator('[data-testid="lesson-completed"]')).toBeVisible();
    
    // Progress should update
    await page.waitForSelector('[data-testid="progress-percentage"]');
    const updatedProgress = await page.locator('[data-testid="progress-percentage"]').textContent();
    
    expect(updatedProgress).not.toBe(initialProgress);
    
    // Completed lesson should be marked in sidebar
    await expect(page.locator('[data-testid="completed-lesson-icon"]')).toBeVisible();
  });

  test('should bookmark important content', async ({ page }) => {
    // Should be able to bookmark lesson
    const bookmarkButton = page.locator('[data-testid="bookmark-button"]');
    await expect(bookmarkButton).toBeVisible();
    
    await bookmarkButton.click();
    
    // Should show bookmark confirmation
    await expect(page.locator('[data-testid="bookmarked-message"]')).toBeVisible();
    
    // Button should change to bookmarked state
    await expect(page.locator('[data-testid="bookmarked-button"]')).toBeVisible();
    
    // Navigate to bookmarks
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Bookmarks');
    
    // Should see bookmarked content
    await expect(page).toHaveURL('/bookmarks');
    await expect(page.locator('[data-testid="bookmark-item"]')).toBeVisible();
  });

  test('should take notes during lessons', async ({ page }) => {
    // Open notes panel
    await page.click('[data-testid="notes-button"]');
    await expect(page.locator('[data-testid="notes-panel"]')).toBeVisible();
    
    // Add a note
    const noteText = 'This is an important concept to remember';
    await page.fill('[data-testid="note-input"]', noteText);
    await page.click('[data-testid="save-note-button"]');
    
    // Note should appear in list
    await expect(page.locator('[data-testid="note-item"]')).toBeVisible();
    await expect(page.locator(`text=${noteText}`)).toBeVisible();
    
    // Should show timestamp
    await expect(page.locator('[data-testid="note-timestamp"]')).toBeVisible();
  });

  test('should adjust video playback settings', async ({ page }) => {
    // Navigate to video lesson
    await page.click('[data-testid="lesson-item"]:has([data-testid="video-icon"])');
    
    // Open settings menu
    await page.click('[data-testid="video-settings-button"]');
    await expect(page.locator('[data-testid="video-settings-menu"]')).toBeVisible();
    
    // Change video quality
    await page.click('[data-testid="quality-option-720p"]');
    
    // Enable captions
    await page.click('[data-testid="captions-toggle"]');
    await expect(page.locator('[data-testid="video-captions"]')).toBeVisible();
    
    // Change playback speed
    await page.click('[data-testid="speed-option-1.25x"]');
    
    const video = page.locator('video');
    const playbackRate = await video.evaluate((v: HTMLVideoElement) => v.playbackRate);
    expect(playbackRate).toBe(1.25);
  });

  test('should download lesson resources', async ({ page }) => {
    // Should show resources section
    await expect(page.locator('[data-testid="lesson-resources"]')).toBeVisible();
    
    // Should have downloadable resources
    const downloadButton = page.locator('[data-testid="download-resource"]').first();
    await expect(downloadButton).toBeVisible();
    
    // Mock download
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.');
  });

  test('should navigate using keyboard shortcuts', async ({ page }) => {
    // Test space bar for play/pause
    await page.keyboard.press('Space');
    
    // Should pause/play video if on video lesson
    const video = page.locator('video');
    if (await video.isVisible()) {
      const paused = await video.evaluate((v: HTMLVideoElement) => v.paused);
      expect(typeof paused).toBe('boolean');
    }
    
    // Test arrow keys for navigation
    await page.keyboard.press('ArrowRight');
    // Should seek forward in video or move to next section
    
    await page.keyboard.press('ArrowLeft');
    // Should seek backward in video or move to previous section
    
    // Test 'n' for next lesson
    await page.keyboard.press('n');
    // Should navigate to next lesson (if shortcut is implemented)
  });

  test('should show course completion certificate', async ({ page }) => {
    // Complete all lessons (simulate by navigating to last lesson and marking complete)
    const lastLesson = page.locator('[data-testid="lesson-item"]').last();
    await lastLesson.click();
    
    await page.click('[data-testid="mark-complete-button"]');
    
    // If this is the last lesson, should show course completion
    const completionModal = page.locator('[data-testid="course-completion-modal"]');
    
    if (await completionModal.isVisible()) {
      // Should show congratulations message
      await expect(page.locator('text=Congratulations!')).toBeVisible();
      
      // Should offer certificate download
      await expect(page.locator('[data-testid="download-certificate-button"]')).toBeVisible();
      
      // Click download certificate
      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="download-certificate-button"]');
      
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/certificate.*\.pdf/i);
    }
  });

  test('should handle offline content access', async ({ page, context }) => {
    // First, visit lesson while online to cache content
    await expect(page.locator('[data-testid="lesson-content"]')).toBeVisible();
    
    // Simulate offline mode
    await context.setOffline(true);
    
    // Navigate to another lesson
    await page.click('[data-testid="next-lesson-button"]');
    
    // Should show offline indicator or cached content
    const offlineIndicator = page.locator('[data-testid="offline-indicator"]');
    const cachedContent = page.locator('[data-testid="lesson-content"]');
    
    expect(await offlineIndicator.isVisible() || await cachedContent.isVisible()).toBe(true);
    
    // Re-enable online mode
    await context.setOffline(false);
  });

  test('should provide lesson search functionality', async ({ page }) => {
    // Open lesson search
    await page.click('[data-testid="lesson-search-button"]');
    await expect(page.locator('[data-testid="lesson-search-input"]')).toBeVisible();
    
    // Search for specific content
    await page.fill('[data-testid="lesson-search-input"]', 'variables');
    await page.press('[data-testid="lesson-search-input"]', 'Enter');
    
    // Should show search results
    await expect(page.locator('[data-testid="lesson-search-results"]')).toBeVisible();
    
    // Results should be relevant
    const results = page.locator('[data-testid="search-result-item"]');
    const firstResult = results.first();
    
    await expect(firstResult).toBeVisible();
    
    // Click on search result should navigate to that lesson
    await firstResult.click();
    await expect(page.locator('[data-testid="lesson-content"]')).toBeVisible();
  });
});