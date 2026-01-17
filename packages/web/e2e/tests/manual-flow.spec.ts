/**
 * Manual Onboarding Flow E2E Tests
 *
 * Tests the happy path when a user manually fills out all fields
 * without using Surprise Me. Validates that the companion is created
 * with the exact values entered.
 */

import { test, expect } from '@playwright/test';
import { OnboardingPage } from '../helpers/onboarding-page';
import { createApiInterceptor, ApiInterceptor } from '../helpers/api-interceptor';
import { validateCompanionRequest, validateAnchorRequest } from '../helpers/image-validators';
import {
  mockCompanionResponse,
  mockAnchorImages,
  mockBackstoryResponse,
  mockSessionResponse,
} from '../fixtures/mock-data';

test.describe('Manual Onboarding Flow', () => {
  let onboardingPage: OnboardingPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    onboardingPage = new OnboardingPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mock endpoints
    await apiInterceptor.mockEndpoint(
      '/companions',
      mockCompanionResponse({ name: 'Aurora' }),
      { method: 'POST' }
    );

    await apiInterceptor.mockEndpoint(
      '/companions/cmp_test123/generate-backstory',
      mockBackstoryResponse,
      { method: 'POST' }
    );

    await apiInterceptor.mockEndpoint(
      '/sessions',
      mockSessionResponse('cmp_test123'),
      { method: 'POST' }
    );

    await apiInterceptor.mockAnchorStream('cmp_test123', [
      { type: 'anchor', data: mockAnchorImages[0] },
      { type: 'anchor', data: mockAnchorImages[1] },
      { type: 'complete', data: { totalImages: 2, companionId: 'cmp_test123' } },
    ]);

    await onboardingPage.goto();
  });

  test('should create companion with manually entered values', async ({ page }) => {
    // Step 2: Fill identity manually
    await onboardingPage.fillIdentity({
      name: 'Aurora',
      pronouns: 'she/her',
      backstory: 'A celestial guardian from the northern lights',
    });

    await onboardingPage.proceedToVisuals();

    // Step 3: Configure appearance
    await onboardingPage.selectGender('female');
    await onboardingPage.selectAppearanceOption('ethnicity', 'mixed');
    await onboardingPage.selectAppearanceOption('body-type', 'curvy');
    await onboardingPage.selectAppearanceOption('hair-color', 'blonde');
    await onboardingPage.selectAppearanceOption('size', 'M');

    // Navigate through remaining steps
    await onboardingPage.proceedFromVisuals();
    await onboardingPage.navigateToStep(5); // Voice step

    // Step 7: Select voice
    await onboardingPage.selectVoice('Charlotte');
    await onboardingPage.clickReviewAndIgnite();

    // Verify companion was created with correct values
    const createRequest = apiInterceptor.assertRequestMade('/companions', 'POST');
    const body = createRequest.body as {
      name: string;
      spec: {
        identity: { name: string; pronouns: string };
        visual_style: { appearance: Record<string, unknown> };
      };
    };

    expect(body.name).toBe('Aurora');
    expect(body.spec.identity.name).toBe('Aurora');
    expect(body.spec.identity.pronouns).toBe('she/her');

    validateCompanionRequest(createRequest.body, {
      gender: 'female',
      ethnicity: 'mixed',
      bodyType: 'curvy',
      hairColor: 'blonde',
      breastSize: 'M',
    });

    // Verify anchor stream used the same appearance
    const anchorRequest = apiInterceptor.assertRequestMade('/imagegen/generate-anchors-stream', 'POST');
    validateAnchorRequest(anchorRequest.body, {
      gender: 'female',
      ethnicity: 'mixed',
      bodyType: 'curvy',
      hairColor: 'blonde',
      breastSize: 'M',
    });
  });

  test('should validate required fields before proceeding', async ({ page }) => {
    // Try to proceed without filling name
    await onboardingPage.nameInput.fill('');

    // Next button should be disabled
    await expect(onboardingPage.nextToVisualsButton).toBeDisabled();

    // Fill name
    await onboardingPage.fillIdentity({
      name: 'Test',
      pronouns: 'they/them',
    });

    // Now button should be enabled
    await expect(onboardingPage.nextToVisualsButton).toBeEnabled();
  });

  test('should handle male companion creation correctly', async ({ page }) => {
    // Fill identity
    await onboardingPage.fillIdentity({
      name: 'Marcus',
      pronouns: 'he/him',
    });

    await onboardingPage.proceedToVisuals();

    // Configure male appearance
    await onboardingPage.selectGender('male');
    await onboardingPage.selectAppearanceOption('ethnicity', 'black');
    await onboardingPage.selectAppearanceOption('body-type', 'muscular');
    await onboardingPage.selectAppearanceOption('hair-color', 'black');
    await onboardingPage.selectAppearanceOption('size', 'L');

    // Navigate through remaining steps
    await onboardingPage.proceedFromVisuals();
    await onboardingPage.navigateToStep(5);
    await onboardingPage.selectVoice('Daniel');
    await onboardingPage.clickReviewAndIgnite();

    // Verify companion was created with male-specific fields
    const createRequest = apiInterceptor.assertRequestMade('/companions', 'POST');
    validateCompanionRequest(createRequest.body, {
      gender: 'male',
      ethnicity: 'black',
      bodyType: 'muscular',
      hairColor: 'black',
      build: 'L',
    });

    // Verify NO breastSize field
    const body = createRequest.body as { spec: { visual_style: { appearance: Record<string, unknown> } } };
    expect(body.spec.visual_style.appearance).not.toHaveProperty('breastSize');
  });

  test('should allow changing values before final submission', async ({ page }) => {
    // Fill initial values
    await onboardingPage.fillIdentity({
      name: 'FirstName',
      pronouns: 'she/her',
    });

    await onboardingPage.proceedToVisuals();
    await onboardingPage.selectGender('female');
    await onboardingPage.selectAppearanceOption('ethnicity', 'caucasian');

    // Go back and change name
    await page.goBack();
    await onboardingPage.nameInput.clear();
    await onboardingPage.fillIdentity({
      name: 'UpdatedName',
      pronouns: 'she/her',
    });

    // Go forward and change appearance
    await onboardingPage.proceedToVisuals();
    await onboardingPage.selectAppearanceOption('ethnicity', 'latina');

    // Complete the flow
    await onboardingPage.proceedFromVisuals();
    await onboardingPage.navigateToStep(5);
    await onboardingPage.selectVoice('Sarah');
    await onboardingPage.clickReviewAndIgnite();

    // Verify final values were used
    const createRequest = apiInterceptor.assertRequestMade('/companions', 'POST');
    const body = createRequest.body as {
      name: string;
      spec: { visual_style: { appearance: { ethnicity: string } } };
    };

    expect(body.name).toBe('UpdatedName');
    expect(body.spec.visual_style.appearance.ethnicity).toBe('latina');
  });
});
