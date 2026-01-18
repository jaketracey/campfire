/**
 * Google OAuth E2E Tests
 *
 * Tests the Google OAuth flow including:
 * - Login with existing Google account
 * - Signup with new Google account
 * - Google auth failure handling
 * - UTM parameter passing with Google signup
 */

import { test, expect } from '@playwright/test';
import { createAuthPage, AuthPage } from '../../helpers/auth-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import {
  mockGoogleLoginSuccessResponse,
  mockGoogleSignupSuccessResponse,
  mockGoogleAuthErrorResponses,
  mockUtmParams,
} from '../../fixtures/mock-auth-data';

test.describe('Google OAuth Flow', () => {
  let authPage: AuthPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    authPage = createAuthPage(page);
    apiInterceptor = createApiInterceptor(page);
  });

  test.describe('Google Login (Existing User)', () => {
    test('should login with Google and redirect to dashboard', async ({ page }) => {
      // Setup Google mock before navigating
      await authPage.setupGoogleMock();

      // Mock Google auth endpoint
      await apiInterceptor.mockEndpoint('/auth/google', mockGoogleLoginSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoLogin();

      // Trigger Google sign-in
      await authPage.triggerGoogleSignIn();

      // Wait for redirect to dashboard
      await authPage.expectRedirectTo(/\/dashboard/);

      // Verify the request was made with Google credential
      const authRequest = apiInterceptor.assertRequestMade('/auth/google', 'POST');
      const body = authRequest.body as { idToken: string };
      expect(body.idToken).toBeDefined();
    });
  });

  test.describe('Google Signup (New User)', () => {
    test('should signup with Google and redirect to onboard', async ({ page }) => {
      // Setup Google mock before navigating
      await authPage.setupGoogleMock();

      // Mock Google auth endpoint returning new user
      await apiInterceptor.mockEndpoint('/auth/google', mockGoogleSignupSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      await authPage.gotoSignup();

      // Trigger Google sign-in
      await authPage.triggerGoogleSignIn();

      // Wait for redirect to onboard (new user)
      await authPage.expectRedirectTo(/\/onboard/);
    });
  });

  test.describe('Google Auth Failure', () => {
    test('should show error toast on Google auth failure', async ({ page }) => {
      // Setup Google mock before navigating
      await authPage.setupGoogleMock();

      // Mock Google auth endpoint with error
      await apiInterceptor.mockEndpoint('/auth/google', mockGoogleAuthErrorResponses.invalidToken, {
        method: 'POST',
        status: 401,
      });

      await authPage.gotoLogin();

      // Trigger Google sign-in
      await authPage.triggerGoogleSignIn();

      // Should show error toast
      await authPage.waitForToast('Sign-in failed');

      // Should stay on login page
      await expect(page).toHaveURL(/\/login/);
    });

    test('should show error when account exists with different method', async ({ page }) => {
      // Setup Google mock before navigating
      await authPage.setupGoogleMock();

      // Mock Google auth endpoint with account link error
      await apiInterceptor.mockEndpoint('/auth/google', mockGoogleAuthErrorResponses.accountLinkError, {
        method: 'POST',
        status: 409,
      });

      await authPage.gotoSignup();

      // Trigger Google sign-in
      await authPage.triggerGoogleSignIn();

      // Should show error toast
      await authPage.waitForToast('Sign-up failed');

      // Should stay on signup page
      await expect(page).toHaveURL(/\/signup/);
    });
  });

  test.describe('UTM Parameters with Google Signup', () => {
    test('should pass UTM params with Google signup', async ({ page }) => {
      // Setup Google mock before navigating
      await authPage.setupGoogleMock();

      // Mock Google auth endpoint
      await apiInterceptor.mockEndpoint('/auth/google', mockGoogleSignupSuccessResponse, {
        method: 'POST',
        status: 200,
      });

      // Navigate with UTM params
      await authPage.gotoSignup(mockUtmParams);

      // Trigger Google sign-in
      await authPage.triggerGoogleSignIn();

      // Wait for redirect
      await authPage.expectRedirectTo(/\/onboard/);

      // Verify UTM params were included in request
      const authRequest = apiInterceptor.assertRequestMade('/auth/google', 'POST');
      const body = authRequest.body as { utmParams: Record<string, string> };

      expect(body.utmParams).toBeDefined();
      expect(body.utmParams.utm_source).toBe(mockUtmParams.utm_source);
    });
  });

  test.describe('Google Button States', () => {
    test('should show Google button on login page', async ({ page }) => {
      await authPage.setupGoogleMock();
      await authPage.gotoLogin();

      // Google button should be visible
      const mockButton = page.locator('[data-testid="mock-google-btn"]');
      await expect(mockButton).toBeVisible();
    });

    test('should show Google button on signup page', async ({ page }) => {
      await authPage.setupGoogleMock();
      await authPage.gotoSignup();

      // Google button should be visible
      const mockButton = page.locator('[data-testid="mock-google-btn"]');
      await expect(mockButton).toBeVisible();
    });
  });
});
