/**
 * Signup E2E Tests
 *
 * Tests the email/password signup flow including:
 * - Successful signup
 * - Password strength indicators
 * - Password matching validation
 * - Terms checkbox requirement
 * - Duplicate email handling
 * - UTM parameter capture
 * - Navigation
 */

import { test, expect } from '@playwright/test';
import { createAuthPage, AuthPage } from '../../helpers/auth-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import {
  mockSignupSuccessResponse,
  mockSignupErrorResponses,
  validSignupData,
  existingUserEmail,
  mockUtmParams,
} from '../../fixtures/mock-auth-data';

test.describe('Signup Flow', () => {
  let authPage: AuthPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    authPage = createAuthPage(page);
    apiInterceptor = createApiInterceptor(page);
  });

  test.describe('Successful Signup', () => {
    test('should signup and redirect to onboard', async ({ page }) => {
      // Mock successful signup response
      await apiInterceptor.mockEndpoint('/auth/signup', mockSignupSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoSignup();
      await authPage.signup(validSignupData);

      // Wait for redirect to onboard
      await authPage.expectRedirectTo(/\/onboard/);

      // Verify the request was made with correct data
      const signupRequest = apiInterceptor.assertRequestMade('/auth/signup', 'POST');
      const body = signupRequest.body as { email: string; password: string; displayName: string };
      expect(body.email).toBe(validSignupData.email);
      expect(body.password).toBe(validSignupData.password);
      expect(body.displayName).toBe(validSignupData.name);
    });
  });

  test.describe('Password Strength Indicators', () => {
    test('should update password strength indicators in real-time', async ({ page }) => {
      await authPage.gotoSignup();

      // Initially no indicators shown (password empty)
      await expect(authPage.passwordStrengthIndicators.first()).not.toBeVisible();

      // Type a short password - only some requirements met
      await authPage.fillSignupPassword('abc');
      await expect(authPage.passwordStrengthIndicators.first()).toBeVisible();

      // Count passed requirements
      let strength = await authPage.getPasswordStrengthCount();
      expect(strength.passed).toBeLessThan(strength.total);

      // Type a valid password - all requirements met
      await authPage.fillSignupPassword('ValidPassword123');
      strength = await authPage.getPasswordStrengthCount();
      expect(strength.passed).toBe(strength.total);
    });

    test('should show 8+ characters indicator', async ({ page }) => {
      await authPage.gotoSignup();

      // Short password
      await authPage.fillSignupPassword('Short1A');
      const indicators = await authPage.page.locator('[data-testid="password-strength-indicator"]').all();

      // Find the "8 characters" indicator
      let foundLengthIndicator = false;
      for (const indicator of indicators) {
        const text = await indicator.textContent();
        if (text?.includes('8 character')) {
          // Should not be green (not met)
          const hasGreen = await indicator.locator('.text-green-500').count();
          expect(hasGreen).toBe(0);
          foundLengthIndicator = true;
        }
      }
      expect(foundLengthIndicator).toBe(true);

      // Valid length password
      await authPage.fillSignupPassword('ValidPassword123');
      for (const indicator of indicators) {
        const text = await indicator.textContent();
        if (text?.includes('8 character')) {
          // Should be green (met)
          const hasGreen = await indicator.locator('.text-green-500').count();
          expect(hasGreen).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Password Matching', () => {
    test('should show error when passwords do not match', async ({ page }) => {
      await authPage.gotoSignup();

      // Fill form with mismatched passwords
      await authPage.signupNameInput.fill(validSignupData.name);
      await authPage.signupEmailInput.fill(validSignupData.email);
      await authPage.signupPasswordInput.fill('Password123!');
      await authPage.signupConfirmPasswordInput.fill('DifferentPassword123!');
      await authPage.signupTermsCheckbox.click();
      await authPage.signupSubmitButton.click();

      // Should show password mismatch error
      await expect(authPage.signupConfirmPasswordError).toBeVisible();
      await expect(authPage.signupConfirmPasswordError).toContainText("don't match");
    });
  });

  test.describe('Terms Checkbox', () => {
    test('should require terms checkbox to be checked', async ({ page }) => {
      await authPage.gotoSignup();

      // Fill form without checking terms
      await authPage.signup({
        ...validSignupData,
        acceptTerms: false,
      });

      // Should show terms error
      await expect(authPage.signupTermsError).toBeVisible();
      await expect(authPage.signupTermsError).toContainText('accept');
    });
  });

  test.describe('Name Validation', () => {
    test('should validate minimum name length', async ({ page }) => {
      await authPage.gotoSignup();

      // Enter single character name
      await authPage.signupNameInput.fill('A');
      await authPage.signupEmailInput.fill(validSignupData.email);
      await authPage.signupPasswordInput.fill(validSignupData.password);
      await authPage.signupConfirmPasswordInput.fill(validSignupData.confirmPassword);
      await authPage.signupTermsCheckbox.click();
      await authPage.signupSubmitButton.click();

      // Should show name validation error
      await expect(authPage.signupNameError).toBeVisible();
      await expect(authPage.signupNameError).toContainText('2 character');
    });
  });

  test.describe('Duplicate Email', () => {
    test('should show error for existing email (409)', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/signup', mockSignupErrorResponses.emailExists, {
        method: 'POST',
        status: 409,
      });

      await authPage.gotoSignup();
      await authPage.signup({
        ...validSignupData,
        email: existingUserEmail,
      });

      // Should show error toast
      await authPage.waitForToast('Signup failed');

      // Should stay on signup page
      await expect(page).toHaveURL(/\/signup/);
    });
  });

  test.describe('UTM Parameter Capture', () => {
    test('should capture UTM parameters in signup request', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/auth/signup', mockSignupSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      // Navigate with UTM params
      await authPage.gotoSignup(mockUtmParams);
      await authPage.signup(validSignupData);

      // Verify UTM params were included in request
      const signupRequest = apiInterceptor.assertRequestMade('/auth/signup', 'POST');
      const body = signupRequest.body as { utmParams: Record<string, string> };

      expect(body.utmParams).toBeDefined();
      expect(body.utmParams.utm_source).toBe(mockUtmParams.utm_source);
      expect(body.utmParams.utm_medium).toBe(mockUtmParams.utm_medium);
      expect(body.utmParams.utm_campaign).toBe(mockUtmParams.utm_campaign);
    });
  });

  test.describe('Navigation', () => {
    test('should navigate to login page', async ({ page }) => {
      await authPage.gotoSignup();
      await authPage.clickLoginFromSignup();

      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Password Visibility', () => {
    test('should toggle password visibility', async ({ page }) => {
      await authPage.gotoSignup();

      // Fill password
      await authPage.signupPasswordInput.fill('TestPassword123');

      // Password should be hidden by default
      const passwordType = await authPage.signupPasswordInput.getAttribute('type');
      expect(passwordType).toBe('password');

      // Toggle to show password
      await authPage.toggleSignupPasswordVisibility();
      const visibleType = await authPage.signupPasswordInput.getAttribute('type');
      expect(visibleType).toBe('text');
    });

    test('should toggle confirm password visibility', async ({ page }) => {
      await authPage.gotoSignup();

      // Fill confirm password
      await authPage.signupConfirmPasswordInput.fill('TestPassword123');

      // Confirm password should be hidden by default
      const passwordType = await authPage.signupConfirmPasswordInput.getAttribute('type');
      expect(passwordType).toBe('password');

      // Toggle to show password
      await authPage.toggleSignupConfirmPasswordVisibility();
      const visibleType = await authPage.signupConfirmPasswordInput.getAttribute('type');
      expect(visibleType).toBe('text');
    });
  });
});
