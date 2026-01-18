/**
 * Login E2E Tests
 *
 * Tests the email/password login flow including:
 * - Successful login
 * - Invalid credentials
 * - Account states (suspended, locked)
 * - MFA redirect
 * - Form validation
 * - Navigation
 */

import { test, expect } from '@playwright/test';
import { createAuthPage, AuthPage } from '../../helpers/auth-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import {
  mockLoginSuccessResponse,
  mockLoginMFARequiredResponse,
  mockLoginErrorResponses,
  validLoginCredentials,
  invalidLoginCredentials,
} from '../../fixtures/mock-auth-data';

test.describe('Login Flow', () => {
  let authPage: AuthPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    authPage = createAuthPage(page);
    apiInterceptor = createApiInterceptor(page);
  });

  test.describe('Successful Login', () => {
    test('should login and redirect to dashboard', async ({ page }) => {
      // Mock successful login response
      await apiInterceptor.mockEndpoint('/auth/login', mockLoginSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoLogin();
      await authPage.login(validLoginCredentials.email, validLoginCredentials.password);

      // Wait for redirect to dashboard
      await authPage.expectRedirectTo(/\/dashboard/);

      // Verify the request was made with correct credentials
      const loginRequest = apiInterceptor.assertRequestMade('/auth/login', 'POST');
      const body = loginRequest.body as { email: string; password: string };
      expect(body.email).toBe(validLoginCredentials.email);
      expect(body.password).toBe(validLoginCredentials.password);
    });
  });

  test.describe('Invalid Credentials', () => {
    test('should show error toast on invalid credentials', async ({ page }) => {
      // Mock invalid credentials response
      await apiInterceptor.mockEndpoint('/auth/login', mockLoginErrorResponses.invalidCredentials, {
        method: 'POST',
        status: 401,
      });

      await authPage.gotoLogin();
      await authPage.login(invalidLoginCredentials.email, invalidLoginCredentials.password);

      // Should show error toast
      await authPage.waitForToast('Login failed');

      // Should stay on login page
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Account States', () => {
    test('should show suspended account error (403)', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/login', mockLoginErrorResponses.accountSuspended, {
        method: 'POST',
        status: 403,
      });

      await authPage.gotoLogin();
      await authPage.login(validLoginCredentials.email, validLoginCredentials.password);

      await authPage.waitForToast('Login failed');
      await expect(page).toHaveURL(/\/login/);
    });

    test('should show locked account error', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/login', mockLoginErrorResponses.accountLocked, {
        method: 'POST',
        status: 423,
      });

      await authPage.gotoLogin();
      await authPage.login(validLoginCredentials.email, validLoginCredentials.password);

      await authPage.waitForToast('Login failed');
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('MFA Required', () => {
    test('should redirect to two-factor page when MFA is required', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/login', mockLoginMFARequiredResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoLogin();
      await authPage.login(validLoginCredentials.email, validLoginCredentials.password);

      // Should show MFA required toast
      await authPage.waitForToast('Two-factor authentication required');

      // Should redirect to two-factor page
      await authPage.expectRedirectTo(/\/two-factor/);
    });
  });

  test.describe('Form Validation', () => {
    test('should show email validation error for invalid email', async ({ page }) => {
      await authPage.gotoLogin();

      // Enter invalid email
      await authPage.loginEmailInput.fill('not-an-email');
      await authPage.loginPasswordInput.fill('ValidPassword123');
      await authPage.loginSubmitButton.click();

      // Should show validation error
      await expect(authPage.loginEmailError).toBeVisible();
      await expect(authPage.loginEmailError).toContainText('valid email');
    });

    test('should show password validation error for short password', async ({ page }) => {
      await authPage.gotoLogin();

      // Enter short password
      await authPage.loginEmailInput.fill('test@example.com');
      await authPage.loginPasswordInput.fill('short');
      await authPage.loginSubmitButton.click();

      // Should show validation error
      await expect(authPage.loginPasswordError).toBeVisible();
      await expect(authPage.loginPasswordError).toContainText('8 characters');
    });
  });

  test.describe('Password Visibility Toggle', () => {
    test('should toggle password visibility', async ({ page }) => {
      await authPage.gotoLogin();

      // Password should be hidden by default
      expect(await authPage.isLoginPasswordVisible()).toBe(false);

      // Click toggle to show password
      await authPage.toggleLoginPasswordVisibility();
      expect(await authPage.isLoginPasswordVisible()).toBe(true);

      // Click toggle to hide password
      await authPage.toggleLoginPasswordVisibility();
      expect(await authPage.isLoginPasswordVisible()).toBe(false);
    });
  });

  test.describe('Loading State', () => {
    test('should disable submit button while loading', async ({ page }) => {
      // Setup a delayed response to simulate loading
      await page.route('**/auth/login', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockLoginSuccessResponse),
        });
      });

      await authPage.gotoLogin();

      // Fill form
      await authPage.loginEmailInput.fill(validLoginCredentials.email);
      await authPage.loginPasswordInput.fill(validLoginCredentials.password);

      // Submit and immediately check button state
      await authPage.loginSubmitButton.click();

      // Button should be disabled during loading
      await expect(authPage.loginSubmitButton).toBeDisabled();

      // Wait for request to complete
      await authPage.expectRedirectTo(/\/dashboard/);
    });
  });

  test.describe('Navigation', () => {
    test('should navigate to signup page', async ({ page }) => {
      await authPage.gotoLogin();
      await authPage.clickSignupFromLogin();

      await expect(page).toHaveURL(/\/signup/);
    });

    test('should navigate to forgot password page', async ({ page }) => {
      await authPage.gotoLogin();
      await authPage.clickForgotPassword();

      await expect(page).toHaveURL(/\/forgot-password/);
    });
  });
});
