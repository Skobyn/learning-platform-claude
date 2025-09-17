/**
 * Course Page Object Model
 * Encapsulates interactions with course pages
 */

import { Page, Locator, expect } from '@playwright/test';

export class CoursePage {
  readonly page: Page;
  readonly courseTitle: Locator;
  readonly courseDescription: Locator;
  readonly enrollButton: Locator;
  readonly continueButton: Locator;
  readonly moduleList: Locator;
  readonly progressBar: Locator;
  readonly instructorInfo: Locator;
  readonly courseRating: Locator;
  readonly reviewsSection: Locator;
  readonly previewButton: Locator;
  readonly shareButton: Locator;
  readonly favoriteButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.courseTitle = page.locator('[data-testid=course-title]');
    this.courseDescription = page.locator('[data-testid=course-description]');
    this.enrollButton = page.locator('[data-testid=enroll-button]');
    this.continueButton = page.locator('[data-testid=continue-learning-button]');
    this.moduleList = page.locator('[data-testid=module-list]');
    this.progressBar = page.locator('[data-testid=course-progress]');
    this.instructorInfo = page.locator('[data-testid=instructor-info]');
    this.courseRating = page.locator('[data-testid=course-rating]');
    this.reviewsSection = page.locator('[data-testid=reviews-section]');
    this.previewButton = page.locator('[data-testid=preview-button]');
    this.shareButton = page.locator('[data-testid=share-button]');
    this.favoriteButton = page.locator('[data-testid=favorite-button]');
  }

  async enrollInCourse() {
    await this.enrollButton.click();
    await expect(this.page.locator('[data-testid=enrollment-success]')).toBeVisible();
    await expect(this.continueButton).toBeVisible();
  }

  async continueLearning() {
    await this.continueButton.click();
  }

  async startModule(moduleIndex: number) {
    const module = this.moduleList.locator(`[data-testid=module-item]:nth-child(${moduleIndex + 1})`);
    await module.click();
  }

  async completeModule() {
    // Watch video if present
    const videoPlayer = this.page.locator('[data-testid=video-player]');
    if (await videoPlayer.isVisible()) {
      await this.page.locator('[data-testid=play-button]').click();
      await this.page.locator('[data-testid=skip-to-end]').click();
    }

    // Complete text content
    const textContent = this.page.locator('[data-testid=text-content]');
    if (await textContent.isVisible()) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.page.locator('[data-testid=mark-as-read]').click();
    }

    // Complete interactive content
    const interactiveContent = this.page.locator('[data-testid=interactive-content]');
    if (await interactiveContent.isVisible()) {
      await this.page.locator('[data-testid=complete-interaction]').click();
    }

    // Mark module as complete
    await this.page.locator('[data-testid=complete-module]').click();
  }

  async previewContent() {
    await this.previewButton.click();
    await expect(this.page.locator('[data-testid=preview-modal]')).toBeVisible();
  }

  async closePreview() {
    await this.page.locator('[data-testid=close-preview]').click();
    await expect(this.page.locator('[data-testid=preview-modal]')).not.toBeVisible();
  }

  async shareViaLink() {
    await this.shareButton.click();
    await expect(this.page.locator('[data-testid=share-modal]')).toBeVisible();
    await this.page.locator('[data-testid=copy-link]').click();
    await expect(this.page.locator('[data-testid=link-copied]')).toBeVisible();
  }

  async addToFavorites() {
    await this.favoriteButton.click();
    await expect(this.favoriteButton).toHaveClass(/favorited/);
  }

  async removeFromFavorites() {
    await this.favoriteButton.click();
    await expect(this.favoriteButton).not.toHaveClass(/favorited/);
  }

  async getProgressPercentage(): Promise<number> {
    const percentage = await this.progressBar.getAttribute('aria-valuenow');
    return parseInt(percentage || '0');
  }

  async getCourseRating(): Promise<number> {
    const ratingText = await this.courseRating.textContent();
    const match = ratingText?.match(/([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  async getModuleCount(): Promise<number> {
    const modules = this.moduleList.locator('[data-testid=module-item]');
    return await modules.count();
  }

  async isModuleCompleted(moduleIndex: number): Promise<boolean> {
    const module = this.moduleList.locator(`[data-testid=module-item]:nth-child(${moduleIndex + 1})`);
    const completedIcon = module.locator('[data-testid=completed-icon]');
    return await completedIcon.isVisible();
  }

  async submitReview(rating: number, reviewText: string) {
    await this.page.locator('[data-testid=write-review]').click();
    
    // Select rating stars
    for (let i = 1; i <= rating; i++) {
      await this.page.locator(`[data-testid=rating-star-${i}]`).click();
    }
    
    // Write review
    await this.page.locator('[data-testid=review-text]').fill(reviewText);
    await this.page.locator('[data-testid=submit-review]').click();
    
    await expect(this.page.locator('[data-testid=review-submitted]')).toBeVisible();
  }

  async expectCourseInfo() {
    await expect(this.courseTitle).toBeVisible();
    await expect(this.courseDescription).toBeVisible();
    await expect(this.instructorInfo).toBeVisible();
    await expect(this.moduleList).toBeVisible();
  }
}