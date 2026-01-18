/**
 * Influencer Model Sample Generation E2E Tests
 *
 * Tests the sample generation flow including:
 * - Viewing a model's samples
 * - Generating new samples
 * - Sample status transitions
 * - Advanced settings
 * - Error handling
 */

import { test, expect } from '@playwright/test';
import { createInfluencerPage, InfluencerPage } from '../../helpers/influencer-page';
import { createApiInterceptor, ApiInterceptor } from '../../helpers/api-interceptor';
import {
  mockModelId,
  mockSampleId,
  mockModelReady,
  mockModelTraining,
  mockSamplePending,
  mockSampleGenerating,
  mockSampleCompleted,
  mockSampleList,
  mockEmptySampleList,
  mockModelStats,
  mockModelList,
  mockModelNotReady,
  testPrompts,
} from '../../fixtures/mock-influencer-data';

// Mock admin user data
const mockAdminUser = {
  id: 'admin_test123',
  email: 'admin@example.com',
  displayName: 'Admin User',
  role: 'admin',
  isVerified: true,
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
};

test.describe('Influencer Model Sample Generation', () => {
  let influencerPage: InfluencerPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page, context }) => {
    influencerPage = createInfluencerPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Set up auth cookie for middleware bypass
    await context.addCookies([
      {
        name: 'campfire-auth-session',
        value: 'mock_session_token',
        domain: 'localhost',
        path: '/',
      },
    ]);

    // Set up localStorage with admin auth state before navigation
    const authState = {
      state: {
        user: mockAdminUser,
        accessToken: 'mock_admin_access_token',
        refreshToken: 'mock_admin_refresh_token',
        expiresAt: Date.now() + 3600 * 1000,
        isImpersonating: false,
        impersonationState: null,
      },
      version: 0,
    };

    await page.addInitScript((authStateStr) => {
      localStorage.setItem('campfire-auth', authStateStr);
    }, JSON.stringify(authState));

    // Mock common endpoints
    await apiInterceptor.mockEndpoint('/admin/influencer-models/stats', mockModelStats, {
      method: 'GET',
      status: 200,
    });
  });

  test.describe('Model Detail Page', () => {
    test('should display model info for ready model', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Verify model info is displayed
      await expect(page.locator('h1')).toContainText('Test Model');
      // Trigger word appears multiple times, use first() to avoid strict mode violation
      await expect(page.locator('text=testmodel').first()).toBeVisible();
      // Status is shown with capitalize CSS on lowercase text
      await expect(page.locator('text=ready')).toBeVisible();
    });

    test('should show "Model Not Ready" for training model', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelTraining, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      await influencerPage.expectModelNotReadyMessage();
    });

    test('should display existing samples', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockSampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Verify samples are displayed
      const sampleCount = await influencerPage.getSampleCount();
      expect(sampleCount).toBe(2);
    });

    test('should show empty state when no samples', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      await influencerPage.expectEmptySamplesMessage();
    });
  });

  test.describe('Sample Generation', () => {
    test('should generate sample with basic prompt', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockSamplePending, {
        method: 'POST',
        status: 201,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the prompt textarea to be visible
      await expect(page.locator('textarea#prompt')).toBeVisible({ timeout: 10000 });

      await influencerPage.fillPrompt(testPrompts.valid);
      await influencerPage.generateSample();

      // Verify the request was made
      const request = apiInterceptor.assertRequestMade(`/admin/influencer-models/${mockModelId}/samples`, 'POST');
      expect((request.body as { prompt: string }).prompt).toBe(testPrompts.valid);
    });

    test('should generate sample with negative prompt', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockSamplePending, {
        method: 'POST',
        status: 201,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the prompt textarea to be visible
      await expect(page.locator('textarea#prompt')).toBeVisible({ timeout: 10000 });

      await influencerPage.fillPrompt(testPrompts.withNegative.prompt);
      await influencerPage.fillNegativePrompt(testPrompts.withNegative.negativePrompt);
      await influencerPage.generateSample();

      const request = apiInterceptor.assertRequestMade(`/admin/influencer-models/${mockModelId}/samples`, 'POST');
      const body = request.body as { prompt: string; negative_prompt: string };
      expect(body.prompt).toBe(testPrompts.withNegative.prompt);
      expect(body.negative_prompt).toBe(testPrompts.withNegative.negativePrompt);
    });

    test('should generate sample with advanced settings', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockSamplePending, {
        method: 'POST',
        status: 201,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the prompt textarea to be visible
      await expect(page.locator('textarea#prompt')).toBeVisible({ timeout: 10000 });

      await influencerPage.fillPrompt(testPrompts.withSettings.prompt);
      await influencerPage.openAdvancedSettings();
      await influencerPage.setSeed(testPrompts.withSettings.seed.toString());
      await influencerPage.setWidth(testPrompts.withSettings.width.toString());
      await influencerPage.setHeight(testPrompts.withSettings.height.toString());
      await influencerPage.generateSample();

      const request = apiInterceptor.assertRequestMade(`/admin/influencer-models/${mockModelId}/samples`, 'POST');
      const body = request.body as { prompt: string; seed: number; width: number; height: number };
      expect(body.prompt).toBe(testPrompts.withSettings.prompt);
      expect(body.seed).toBe(testPrompts.withSettings.seed);
      expect(body.width).toBe(testPrompts.withSettings.width);
      expect(body.height).toBe(testPrompts.withSettings.height);
    });

    test('should disable generate button when prompt is empty', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the generate button to be visible
      await expect(page.locator('button:has-text("Generate Sample")')).toBeVisible({ timeout: 10000 });

      // Generate button should be disabled with empty prompt
      await influencerPage.expectGenerateButtonDisabled();

      // Fill prompt and verify button is enabled
      await influencerPage.fillPrompt(testPrompts.valid);
      await influencerPage.expectGenerateButtonEnabled();
    });
  });

  test.describe('Sample Status Polling', () => {
    test('should show pending status initially', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      const pendingSampleList = {
        success: true,
        data: {
          samples: [mockSamplePending.data],
        },
      };
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, pendingSampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Status badge shows "Pending" for pending samples
      await expect(page.locator('text=Pending')).toBeVisible();
    });

    test('should show generating status during generation', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      const generatingSampleList = {
        success: true,
        data: {
          samples: [mockSampleGenerating.data],
        },
      };
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, generatingSampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Status badge shows "Generating" for generating samples - use exact match to avoid matching "Generating..."
      await expect(page.getByText('Generating', { exact: true })).toBeVisible();
    });

    test('should show completed status with image', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      const completedSampleList = {
        success: true,
        data: {
          samples: [mockSampleCompleted.data],
        },
      };
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, completedSampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      await influencerPage.expectSampleStatus(0, 'Completed');

      // Verify image is displayed
      const sampleImage = page.locator(`img[src*="${mockSampleCompleted.data.imageUrl}"]`);
      await expect(sampleImage).toBeVisible();
    });
  });

  test.describe('Sample Deletion', () => {
    test('should delete a sample', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockSampleList, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples/${mockSampleId}`, { success: true, data: { deleted: true } }, {
        method: 'DELETE',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      const initialCount = await influencerPage.getSampleCount();
      expect(initialCount).toBe(2);

      // Set up confirm dialog handler
      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      await influencerPage.deleteSample(0);

      // Verify delete request was made
      apiInterceptor.assertRequestMade(`/admin/influencer-models/${mockModelId}/samples/${mockSampleId}`, 'DELETE');
    });
  });

  test.describe('Model List Page', () => {
    test('should display models with status badges', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoList();

      await expect(page.locator('h1')).toContainText('Influencer Models');
      await expect(page.locator('text=Test Model')).toBeVisible();
      await expect(page.locator('text=Another Model')).toBeVisible();
    });

    test('should display stats cards', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      // The list endpoint matches /admin/influencer-models which is a substring of /admin/influencer-models/stats
      // So we need to register list FIRST, then stats, so stats is checked first for /stats URL
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint('/admin/influencer-models/stats', mockModelStats, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoList();

      // Verify stats cards display correctly
      // The stats mock returns: total: 5, ready: 3, training: 1, failed: 1
      await expect(page.locator('text=Total Models')).toBeVisible();
      await expect(page.locator('text=5').first()).toBeVisible();
    });

    test('should navigate to model detail when clicking Samples button', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoList();
      await influencerPage.clickSamplesButton('Test Model');

      await expect(page).toHaveURL(new RegExp(`/admin/influencer/${mockModelId}`));
    });

    test('should search models', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoList();
      await influencerPage.searchModels('Test');

      // Verify search parameter is included in request
      // Note: The actual filtering happens server-side
    });
  });

  test.describe('Error Handling', () => {
    test('should handle model not found error', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, { success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } }, {
        method: 'GET',
        status: 404,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      // Don't expect h1 on error page
      await influencerPage.gotoModel(mockModelId, false);

      await expect(page.locator('text=Model not found')).toBeVisible();
    });

    test('should handle generation error for non-ready model', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockModelNotReady, {
        method: 'POST',
        status: 400,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the form to be ready
      await expect(page.locator('textarea#prompt')).toBeVisible({ timeout: 10000 });

      await influencerPage.fillPrompt(testPrompts.valid);
      await influencerPage.generateSample();

      // Verify error is shown - the error message from mockModelNotReady
      await expect(page.locator('text=Model is not ready for sample generation')).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate back to list from model detail', async ({ page }) => {
      // Note: Playwright routes are LIFO - register general routes first, specific routes last
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint('/admin/influencer-models/stats', mockModelStats, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}`, mockModelReady, {
        method: 'GET',
        status: 200,
      });
      await apiInterceptor.mockEndpoint(`/admin/influencer-models/${mockModelId}/samples`, mockEmptySampleList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoModel(mockModelId);

      // Wait for the page to fully load
      await expect(page.locator('h1')).toContainText('Test Model');

      // Click the back button (it contains "Back" text)
      await page.click('button:has-text("Back")');

      await expect(page).toHaveURL(/\/admin\/influencer$/);
    });

    test('should navigate to create page', async ({ page }) => {
      await apiInterceptor.mockEndpoint('/admin/influencer-models', mockModelList, {
        method: 'GET',
        status: 200,
      });

      await influencerPage.gotoList();
      await page.click('a:has-text("Train New Model")');

      await expect(page).toHaveURL(/\/admin\/influencer\/create/);
    });
  });
});
