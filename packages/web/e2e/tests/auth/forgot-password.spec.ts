/**
 * Forgot Password E2E Tests
 *
 * Tests the password reset flow including:
 * - Email submission and confirmation
 * - Try different email functionality
 * - Email validation
 * - Navigation back to login
 */

import { test, expect } from '@playwright/test';
import { createAuthPage, AuthPage } from '../../helpers/auth-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import { mockForgotPasswordSuccessResponse } from '../../fixtures/mock-auth-data';

test.describe('Forgot Password Flow', () => {
  let authPage: AuthPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    authPage = createAuthPage(page);
    apiInterceptor = createApiInterceptor(page);
  });

  test.describe('Email Submission', () => {
    test('should show confirmation after email submission', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/forgot-password', mockForgotPasswordSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoForgotPassword();

      // Submit email
      await authPage.submitForgotPassword('test@example.com');

      // Should show success message
      await expect(authPage.forgotSuccessMessage).toBeVisible();
      await expect(authPage.forgotSuccessMessage).toContainText('test@example.com');
    });

    test('should show success toast after submission', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/forgot-password', mockForgotPasswordSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoForgotPassword();
      await authPage.submitForgotPassword('test@example.com');

      // Should show success toast
      await authPage.waitForToast('Email sent');
    });
  });

  test.describe('Try Different Email', () => {
    test('should reset form when clicking try different email', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/forgot-password', mockForgotPasswordSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoForgotPassword();

      // Submit first email
      await authPage.submitForgotPassword('first@example.com');

      // Verify confirmation is shown
      await expect(authPage.forgotSuccessMessage).toBeVisible();

      // Click try different email
      await authPage.clickTryDifferentEmail();

      // Should return to form view
      await expect(authPage.forgotEmailInput).toBeVisible();
      await expect(authPage.forgotSuccessMessage).not.toBeVisible();

      // Form should be empty
      const emailValue = await authPage.forgotEmailInput.inputValue();
      expect(emailValue).toBe('');
    });
  });

  test.describe('Email Validation', () => {
    test('should show error for invalid email', async ({ page }) => {
      await authPage.gotoForgotPassword();

      // Submit invalid email
      await authPage.submitForgotPassword('not-an-email');

      // Should show validation error
      await expect(authPage.forgotEmailError).toBeVisible();
      await expect(authPage.forgotEmailError).toContainText('valid email');

      // Should stay on forgot password page (no confirmation shown)
      await expect(authPage.forgotSuccessMessage).not.toBeVisible();
    });

    test('should show error for empty email', async ({ page }) => {
      await authPage.gotoForgotPassword();

      // Try to submit without entering email
      await authPage.forgotSubmitButton.click();

      // Should show validation error
      await expect(authPage.forgotEmailError).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate back to login from form view', async ({ page }) => {
      await authPage.gotoForgotPassword();
      await authPage.clickBackToLoginFromForgot();

      await expect(page).toHaveURL(/\/login/);
    });

    test('should navigate back to login from confirmation view', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/forgot-password', mockForgotPasswordSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoForgotPassword();
      await authPage.submitForgotPassword('test@example.com');

      // Verify confirmation is shown
      await expect(authPage.forgotSuccessMessage).toBeVisible();

      // Navigate back to login
      await authPage.clickBackToLoginFromForgot();

      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Loading State', () => {
    test('should disable submit button while loading', async ({ page }) => {
      // Setup a delayed response to simulate loading
      await page.route('**/auth/forgot-password', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockForgotPasswordSuccessResponse),
        });
      });

      await authPage.gotoForgotPassword();

      // Enter email
      await authPage.forgotEmailInput.fill('test@example.com');

      // Submit and immediately check button state
      await authPage.forgotSubmitButton.click();

      // Button should be disabled during loading
      await expect(authPage.forgotSubmitButton).toBeDisabled();

      // Wait for request to complete
      await expect(authPage.forgotSuccessMessage).toBeVisible();
    });
  });
});
