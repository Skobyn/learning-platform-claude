/**
 * Login Page Object Model
 * Encapsulates interactions with the login page
 */

import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly forgotPasswordLink: Locator;
  readonly registerLink: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly socialLoginButtons: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('[data-testid=email]');
    this.passwordInput = page.locator('[data-testid=password]');
    this.submitButton = page.locator('[data-testid=login-submit]');
    this.errorMessage = page.locator('[data-testid=error-message]');
    this.forgotPasswordLink = page.locator('[data-testid=forgot-password-link]');
    this.registerLink = page.locator('[data-testid=register-link]');
    this.rememberMeCheckbox = page.locator('[data-testid=remember-me]');
    this.socialLoginButtons = page.locator('[data-testid^=social-login]');
  }

  async goto() {
    await this.page.goto('/login');
    await expect(this.emailInput).toBeVisible();
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async loginWithRememberMe(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.rememberMeCheckbox.check();
    await this.submitButton.click();
  }

  async expectLoginSuccess() {
    await expect(this.page).toHaveURL('/dashboard');
  }

  async expectLoginError(errorText?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (errorText) {
      await expect(this.errorMessage).toContainText(errorText);
    }
  }

  async clickForgotPassword() {
    await this.forgotPasswordLink.click();
  }

  async clickRegisterLink() {
    await this.registerLink.click();
  }

  async loginWithGoogle() {
    const googleButton = this.page.locator('[data-testid=social-login-google]');
    await googleButton.click();
  }

  async isLoading() {
    return await this.submitButton.locator('[data-testid=loading-spinner]').isVisible();
  }
}