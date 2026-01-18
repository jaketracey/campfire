/**
 * MFA (Two-Factor Authentication) E2E Tests
 *
 * Tests the two-factor authentication flow including:
 * - Code input behavior (auto-advance, paste, backspace)
 * - Valid code verification
 * - Invalid code handling
 * - Tab switching (authenticator/SMS)
 * - Navigation
 */

import { test, expect } from '@playwright/test';
import { createAuthPage, AuthPage } from '../../helpers/auth-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import {
  mockMFAVerifySuccessResponse,
  mockMFAErrorResponses,
  validMFACodes,
  invalidMFACode,
} from '../../fixtures/mock-auth-data';

test.describe('Two-Factor Authentication', () => {
  let authPage: AuthPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    authPage = createAuthPage(page);
    apiInterceptor = createApiInterceptor(page);
  });

  test.describe('Code Input Behavior', () => {
    test('should auto-advance to next input on digit entry', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Enter each digit one by one
      const inputs = await authPage.mfaCodeInputs.all();
      await inputs[0].fill('1');

      // Second input should be focused
      await expect(inputs[1]).toBeFocused();

      await inputs[1].fill('2');
      await expect(inputs[2]).toBeFocused();
    });

    test('should populate all inputs on paste', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Paste full code
      await authPage.pasteMFACode('123456');

      // Verify all inputs are filled
      const codeValue = await authPage.getMFACodeValue();
      expect(codeValue).toBe('123456');
    });

    test('should move to previous input on backspace', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Enter first two digits
      await authPage.enterMFACode('12');

      const inputs = await authPage.mfaCodeInputs.all();

      // Clear second input and press backspace
      await inputs[1].clear();
      await page.keyboard.press('Backspace');

      // First input should now be focused
      await expect(inputs[0]).toBeFocused();
    });
  });

  test.describe('Valid Code Verification', () => {
    test('should redirect to dashboard on valid code', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/verify-mfa', mockMFAVerifySuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoTwoFactor();

      // Enter valid code
      await authPage.pasteMFACode(validMFACodes.authenticator);
      await authPage.submitMFACode();

      // Wait for redirect to dashboard
      await authPage.expectRedirectTo(/\/dashboard/);
    });
  });

  test.describe('Invalid Code Handling', () => {
    test('should show error and clear inputs on invalid code', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/verify-mfa', mockMFAErrorResponses.invalidCode, {
        method: 'POST',
        status: 401,
      });

      await authPage.gotoTwoFactor();

      // Enter invalid code
      await authPage.pasteMFACode(invalidMFACode);
      await authPage.submitMFACode();

      // Should show error toast
      await authPage.waitForToast('Verification failed');

      // Should stay on two-factor page
      await expect(page).toHaveURL(/\/two-factor/);
    });
  });

  test.describe('Tab Switching', () => {
    test('should switch between authenticator and SMS tabs', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Authenticator tab should be active by default
      await expect(authPage.mfaAuthenticatorTab).toHaveAttribute('data-state', 'active');

      // Switch to SMS tab
      await authPage.switchToSmsTab();
      await expect(authPage.mfaSmsTab).toHaveAttribute('data-state', 'active');
      await expect(authPage.mfaAuthenticatorTab).toHaveAttribute('data-state', 'inactive');

      // Switch back to authenticator tab
      await authPage.switchToAuthenticatorTab();
      await expect(authPage.mfaAuthenticatorTab).toHaveAttribute('data-state', 'active');
    });

    test('should show resend button only on SMS tab', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Resend button should not be visible on authenticator tab
      await expect(authPage.mfaResendButton).not.toBeVisible();

      // Switch to SMS tab
      await authPage.switchToSmsTab();

      // Resend button should be visible
      await expect(authPage.mfaResendButton).toBeVisible();
    });
  });

  test.describe('Verify Button State', () => {
    test('should disable verify button when code is incomplete', async ({ page }) => {
      await authPage.gotoTwoFactor();

      // Button should be disabled initially (no code entered)
      await authPage.expectMFAVerifyDisabled();

      // Enter partial code
      await authPage.enterMFACode('123');
      await authPage.expectMFAVerifyDisabled();

      // Enter full code
      await authPage.pasteMFACode('123456');
      await authPage.expectMFAVerifyEnabled();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate back to login', async ({ page }) => {
      await authPage.gotoTwoFactor();
      await authPage.clickBackToLoginFromMFA();

      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Resend Code', () => {
    test('should show success toast on resend', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/resend-mfa', { success: true }, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoTwoFactor();

      // Switch to SMS tab where resend button is visible
      await authPage.switchToSmsTab();

      // Click resend
      await authPage.clickResendCode();

      // Should show success toast
      await authPage.waitForToast('Code sent');
    });
  });
});
