/**
 * Auth Page Object Model
 * Encapsulates interactions with the authentication pages (login, signup, two-factor, forgot-password).
 */

import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;

  // ============================================================================
  // Login Page Locators
  // ============================================================================
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginPasswordToggle: Locator;
  readonly loginSubmitButton: Locator;
  readonly loginGoogleButton: Locator;
  readonly loginForgotPasswordLink: Locator;
  readonly loginSignupLink: Locator;
  readonly loginEmailError: Locator;
  readonly loginPasswordError: Locator;

  // ============================================================================
  // Signup Page Locators
  // ============================================================================
  readonly signupNameInput: Locator;
  readonly signupEmailInput: Locator;
  readonly signupPasswordInput: Locator;
  readonly signupConfirmPasswordInput: Locator;
  readonly signupPasswordToggle: Locator;
  readonly signupConfirmPasswordToggle: Locator;
  readonly signupTermsCheckbox: Locator;
  readonly signupSubmitButton: Locator;
  readonly signupGoogleButton: Locator;
  readonly signupLoginLink: Locator;
  readonly signupNameError: Locator;
  readonly signupEmailError: Locator;
  readonly signupPasswordError: Locator;
  readonly signupConfirmPasswordError: Locator;
  readonly signupTermsError: Locator;
  readonly passwordStrengthIndicators: Locator;

  // ============================================================================
  // Two-Factor Page Locators
  // ============================================================================
  readonly mfaCodeInputs: Locator;
  readonly mfaVerifyButton: Locator;
  readonly mfaAuthenticatorTab: Locator;
  readonly mfaSmsTab: Locator;
  readonly mfaResendButton: Locator;
  readonly mfaBackToLoginLink: Locator;

  // ============================================================================
  // Forgot Password Page Locators
  // ============================================================================
  readonly forgotEmailInput: Locator;
  readonly forgotSubmitButton: Locator;
  readonly forgotBackToLoginLink: Locator;
  readonly forgotEmailError: Locator;
  readonly forgotSuccessMessage: Locator;
  readonly forgotTryDifferentEmailButton: Locator;

  // ============================================================================
  // Common Locators
  // ============================================================================
  readonly toastMessage: Locator;
  readonly toastDescription: Locator;

  constructor(page: Page) {
    this.page = page;

    // Login Page
    this.loginEmailInput = page.locator('[data-testid="login-email-input"]');
    this.loginPasswordInput = page.locator('[data-testid="login-password-input"]');
    this.loginPasswordToggle = page.locator('[data-testid="login-password-toggle"]');
    this.loginSubmitButton = page.locator('[data-testid="login-submit-button"]');
    this.loginGoogleButton = page.locator('[data-testid="login-google-button"]');
    this.loginForgotPasswordLink = page.locator('[data-testid="login-forgot-password-link"]');
    this.loginSignupLink = page.locator('[data-testid="login-signup-link"]');
    this.loginEmailError = page.locator('[data-testid="login-email-error"]');
    this.loginPasswordError = page.locator('[data-testid="login-password-error"]');

    // Signup Page
    this.signupNameInput = page.locator('[data-testid="signup-name-input"]');
    this.signupEmailInput = page.locator('[data-testid="signup-email-input"]');
    this.signupPasswordInput = page.locator('[data-testid="signup-password-input"]');
    this.signupConfirmPasswordInput = page.locator('[data-testid="signup-confirm-password-input"]');
    this.signupPasswordToggle = page.locator('[data-testid="signup-password-toggle"]');
    this.signupConfirmPasswordToggle = page.locator('[data-testid="signup-confirm-password-toggle"]');
    this.signupTermsCheckbox = page.locator('[data-testid="signup-terms-checkbox"]');
    this.signupSubmitButton = page.locator('[data-testid="signup-submit-button"]');
    this.signupGoogleButton = page.locator('[data-testid="signup-google-button"]');
    this.signupLoginLink = page.locator('[data-testid="signup-login-link"]');
    this.signupNameError = page.locator('[data-testid="signup-name-error"]');
    this.signupEmailError = page.locator('[data-testid="signup-email-error"]');
    this.signupPasswordError = page.locator('[data-testid="signup-password-error"]');
    this.signupConfirmPasswordError = page.locator('[data-testid="signup-confirm-password-error"]');
    this.signupTermsError = page.locator('[data-testid="signup-terms-error"]');
    this.passwordStrengthIndicators = page.locator('[data-testid="password-strength-indicator"]');

    // Two-Factor Page
    this.mfaCodeInputs = page.locator('[data-testid="mfa-code-input"]');
    this.mfaVerifyButton = page.locator('[data-testid="mfa-verify-button"]');
    this.mfaAuthenticatorTab = page.locator('[data-testid="mfa-authenticator-tab"]');
    this.mfaSmsTab = page.locator('[data-testid="mfa-sms-tab"]');
    this.mfaResendButton = page.locator('[data-testid="mfa-resend-button"]');
    this.mfaBackToLoginLink = page.locator('[data-testid="mfa-back-to-login"]');

    // Forgot Password Page
    this.forgotEmailInput = page.locator('[data-testid="forgot-email-input"]');
    this.forgotSubmitButton = page.locator('[data-testid="forgot-submit-button"]');
    this.forgotBackToLoginLink = page.locator('[data-testid="forgot-back-to-login"]');
    this.forgotEmailError = page.locator('[data-testid="forgot-email-error"]');
    this.forgotSuccessMessage = page.locator('[data-testid="forgot-success-message"]');
    this.forgotTryDifferentEmailButton = page.locator('[data-testid="forgot-try-different-email"]');

    // Common
    this.toastMessage = page.locator('[data-testid="toast-title"]');
    this.toastDescription = page.locator('[data-testid="toast-description"]');
  }

  // ============================================================================
  // Navigation Methods
  // ============================================================================

  async gotoLogin() {
    await this.page.goto('/login');
    await this.page.waitForLoadState('networkidle');
    await this.loginEmailInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  async gotoSignup(utmParams?: Record<string, string>) {
    const url = utmParams
      ? `/signup?${new URLSearchParams(utmParams).toString()}`
      : '/signup';
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
    await this.signupNameInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  async gotoTwoFactor() {
    await this.page.goto('/two-factor');
    await this.page.waitForLoadState('networkidle');
    await this.mfaVerifyButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  async gotoForgotPassword() {
    await this.page.goto('/forgot-password');
    await this.page.waitForLoadState('networkidle');
    await this.forgotEmailInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  // ============================================================================
  // Login Methods
  // ============================================================================

  async login(email: string, password: string) {
    await this.loginEmailInput.fill(email);
    await this.loginPasswordInput.fill(password);
    await this.loginSubmitButton.click();
  }

  async toggleLoginPasswordVisibility() {
    await this.loginPasswordToggle.click();
  }

  async isLoginPasswordVisible(): Promise<boolean> {
    const type = await this.loginPasswordInput.getAttribute('type');
    return type === 'text';
  }

  async clickForgotPassword() {
    await this.loginForgotPasswordLink.click();
    await this.page.waitForURL('**/forgot-password');
  }

  async clickSignupFromLogin() {
    await this.loginSignupLink.click();
    await this.page.waitForURL('**/signup');
  }

  // ============================================================================
  // Signup Methods
  // ============================================================================

  async signup(data: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    acceptTerms?: boolean;
  }) {
    await this.signupNameInput.fill(data.name);
    await this.signupEmailInput.fill(data.email);
    await this.signupPasswordInput.fill(data.password);
    await this.signupConfirmPasswordInput.fill(data.confirmPassword);

    if (data.acceptTerms !== false) {
      await this.signupTermsCheckbox.click();
    }

    await this.signupSubmitButton.click();
  }

  async fillSignupPassword(password: string) {
    await this.signupPasswordInput.fill(password);
  }

  async getPasswordStrengthCount(): Promise<{
    passed: number;
    total: number;
  }> {
    const indicators = await this.passwordStrengthIndicators.all();
    let passed = 0;
    for (const indicator of indicators) {
      const hasGreenClass = await indicator.locator('.text-green-500').count();
      if (hasGreenClass > 0) passed++;
    }
    return { passed, total: indicators.length };
  }

  async toggleSignupPasswordVisibility() {
    await this.signupPasswordToggle.click();
  }

  async toggleSignupConfirmPasswordVisibility() {
    await this.signupConfirmPasswordToggle.click();
  }

  async clickLoginFromSignup() {
    await this.signupLoginLink.click();
    await this.page.waitForURL('**/login');
  }

  // ============================================================================
  // Two-Factor Methods
  // ============================================================================

  async enterMFACode(code: string) {
    const inputs = await this.mfaCodeInputs.all();
    for (let i = 0; i < code.length && i < inputs.length; i++) {
      await inputs[i].fill(code[i]);
    }
  }

  async pasteMFACode(code: string) {
    const firstInput = this.mfaCodeInputs.first();
    await firstInput.focus();
    await this.page.keyboard.insertText(code);
  }

  async clearMFACode() {
    const inputs = await this.mfaCodeInputs.all();
    for (const input of inputs) {
      await input.fill('');
    }
  }

  async getMFACodeValue(): Promise<string> {
    const inputs = await this.mfaCodeInputs.all();
    let code = '';
    for (const input of inputs) {
      code += await input.inputValue();
    }
    return code;
  }

  async submitMFACode() {
    await this.mfaVerifyButton.click();
  }

  async switchToAuthenticatorTab() {
    await this.mfaAuthenticatorTab.click();
  }

  async switchToSmsTab() {
    await this.mfaSmsTab.click();
  }

  async clickResendCode() {
    await this.mfaResendButton.click();
  }

  async clickBackToLoginFromMFA() {
    await this.mfaBackToLoginLink.click();
    await this.page.waitForURL('**/login');
  }

  // ============================================================================
  // Forgot Password Methods
  // ============================================================================

  async submitForgotPassword(email: string) {
    await this.forgotEmailInput.fill(email);
    await this.forgotSubmitButton.click();
  }

  async clickTryDifferentEmail() {
    await this.forgotTryDifferentEmailButton.click();
  }

  async clickBackToLoginFromForgot() {
    await this.forgotBackToLoginLink.click();
    await this.page.waitForURL('**/login');
  }

  // ============================================================================
  // Google OAuth Methods (for mocking)
  // ============================================================================

  /**
   * Setup mock Google Identity Services script
   * This must be called BEFORE navigating to the page
   */
  async setupGoogleMock() {
    await this.page.addInitScript(() => {
      // Store the callback for later use
      (window as unknown as { __googleCallback?: (response: { credential: string }) => void }).__googleCallback = undefined;

      // Mock the Google Identity Services library
      (window as unknown as { google: unknown }).google = {
        accounts: {
          id: {
            initialize: (config: { callback: (response: { credential: string }) => void }) => {
              (window as unknown as { __googleCallback?: (response: { credential: string }) => void }).__googleCallback = config.callback;
            },
            renderButton: (element: HTMLElement) => {
              // Create a mock button that triggers the callback
              element.innerHTML = '';
              const button = document.createElement('button');
              button.setAttribute('data-testid', 'mock-google-btn');
              button.textContent = 'Sign in with Google';
              button.style.cssText = 'width: 100%; padding: 10px; cursor: pointer;';
              button.onclick = () => {
                const callback = (window as unknown as { __googleCallback?: (response: { credential: string }) => void }).__googleCallback;
                if (callback) {
                  callback({ credential: 'mock_google_credential_token' });
                }
              };
              element.appendChild(button);
            },
            cancel: () => {},
          },
        },
      };
    });

    // Block actual Google scripts
    await this.page.route('**/accounts.google.com/**', (route) => route.abort());
    await this.page.route('**/apis.google.com/**', (route) => route.abort());
  }

  /**
   * Trigger Google sign-in with a mock credential
   */
  async triggerGoogleSignIn() {
    const mockButton = this.page.locator('[data-testid="mock-google-btn"]');
    await mockButton.waitFor({ state: 'visible', timeout: 5000 });
    await mockButton.click();
  }

  /**
   * Setup Google mock to trigger an error
   */
  async setupGoogleMockWithError(errorMessage: string) {
    await this.page.addInitScript((message: string) => {
      (window as unknown as { google: unknown }).google = {
        accounts: {
          id: {
            initialize: () => {},
            renderButton: (element: HTMLElement) => {
              element.innerHTML = '';
              const button = document.createElement('button');
              button.setAttribute('data-testid', 'mock-google-btn');
              button.textContent = 'Sign in with Google';
              button.style.cssText = 'width: 100%; padding: 10px; cursor: pointer;';
              button.onclick = () => {
                throw new Error(message);
              };
              element.appendChild(button);
            },
            cancel: () => {},
          },
        },
      };
    }, errorMessage);

    await this.page.route('**/accounts.google.com/**', (route) => route.abort());
    await this.page.route('**/apis.google.com/**', (route) => route.abort());
  }

  // ============================================================================
  // Toast/Notification Methods
  // ============================================================================

  async waitForToast(title?: string, timeout = 5000) {
    await this.toastMessage.waitFor({ state: 'visible', timeout });
    if (title) {
      await expect(this.toastMessage).toContainText(title, { timeout });
    }
  }

  async getToastText(): Promise<{ title: string; description: string }> {
    const title = await this.toastMessage.textContent() || '';
    const description = await this.toastDescription.textContent() || '';
    return { title, description };
  }

  // ============================================================================
  // Assertion Helpers
  // ============================================================================

  async expectRedirectTo(urlPattern: RegExp, timeout = 10000) {
    await this.page.waitForURL(urlPattern, { timeout });
  }

  async expectLoginFormValid() {
    await expect(this.loginSubmitButton).toBeEnabled();
  }

  async expectLoginFormInvalid() {
    await expect(this.loginSubmitButton).toBeDisabled();
  }

  async expectSignupFormValid() {
    await expect(this.signupSubmitButton).toBeEnabled();
  }

  async expectSignupFormInvalid() {
    await expect(this.signupSubmitButton).toBeDisabled();
  }

  async expectMFAVerifyEnabled() {
    await expect(this.mfaVerifyButton).toBeEnabled();
  }

  async expectMFAVerifyDisabled() {
    await expect(this.mfaVerifyButton).toBeDisabled();
  }
}

/**
 * Create an AuthPage instance for the given Playwright page
 */
export function createAuthPage(page: Page): AuthPage {
  return new AuthPage(page);
}
