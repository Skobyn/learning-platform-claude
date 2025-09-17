/**
 * Dashboard Page Object Model
 * Encapsulates interactions with the dashboard page
 */

import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly welcomeMessage: Locator;
  readonly enrolledCourses: Locator;
  readonly progressCards: Locator;
  readonly upcomingDeadlines: Locator;
  readonly achievements: Locator;
  readonly learningStreak: Locator;
  readonly browseCourses: Locator;
  readonly profileLink: Locator;
  readonly notificationBell: Locator;
  readonly searchBar: Locator;
  readonly firstCourse: Locator;

  constructor(page: Page) {
    this.page = page;
    this.welcomeMessage = page.locator('[data-testid=welcome-message]');
    this.enrolledCourses = page.locator('[data-testid=enrolled-courses]');
    this.progressCards = page.locator('[data-testid=progress-card]');
    this.upcomingDeadlines = page.locator('[data-testid=upcoming-deadlines]');
    this.achievements = page.locator('[data-testid=achievements-section]');
    this.learningStreak = page.locator('[data-testid=learning-streak]');
    this.browseCourses = page.locator('[data-testid=browse-courses]');
    this.profileLink = page.locator('[data-testid=profile-link]');
    this.notificationBell = page.locator('[data-testid=notification-bell]');
    this.searchBar = page.locator('[data-testid=search-bar]');
    this.firstCourse = page.locator('[data-testid=course-card]').first();
  }

  async goto() {
    await this.page.goto('/dashboard');
    await expect(this.welcomeMessage).toBeVisible();
  }

  async navigateToCourse(courseName: string) {
    const courseCard = this.page.locator(`[data-testid=course-card]:has-text("${courseName}")`);
    await courseCard.click();
  }

  async viewAllCourses() {
    await this.browseCourses.click();
    await expect(this.page).toHaveURL('/courses');
  }

  async openProfile() {
    await this.profileLink.click();
    await expect(this.page).toHaveURL('/profile');
  }

  async searchCourses(searchTerm: string) {
    await this.searchBar.fill(searchTerm);
    await this.searchBar.press('Enter');
  }

  async getProgressPercentage(courseId: string): Promise<number> {
    const progressBar = this.page.locator(`[data-testid=progress-${courseId}]`);
    const percentage = await progressBar.getAttribute('aria-valuenow');
    return parseInt(percentage || '0');
  }

  async getLearningStreak(): Promise<number> {
    const streakText = await this.learningStreak.textContent();
    const match = streakText?.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getUpcomingDeadlines() {
    const deadlines = [];
    const deadlineItems = this.page.locator('[data-testid=deadline-item]');
    const count = await deadlineItems.count();
    
    for (let i = 0; i < count; i++) {
      const item = deadlineItems.nth(i);
      const title = await item.locator('[data-testid=deadline-title]').textContent();
      const date = await item.locator('[data-testid=deadline-date]').textContent();
      deadlines.push({ title, date });
    }
    
    return deadlines;
  }

  async hasNotifications(): Promise<boolean> {
    const badge = this.notificationBell.locator('[data-testid=notification-badge]');
    return await badge.isVisible();
  }

  async openNotifications() {
    await this.notificationBell.click();
    await expect(this.page.locator('[data-testid=notification-dropdown]')).toBeVisible();
  }
}