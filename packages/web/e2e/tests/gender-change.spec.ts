/**
 * Gender Change Field Validation E2E Tests
 *
 * These tests validate that gender-specific fields are correctly managed:
 * - Female: has breastSize, does NOT have build
 * - Male: has build, does NOT have breastSize
 *
 * The fix prevents stale fields from persisting when switching genders.
 */

import { test, expect } from '@playwright/test';
import { OnboardingPage } from '../helpers/onboarding-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../helpers/api-interceptor';
import { validateGenderSpecificFields, validateAnchorRequest } from '../helpers/image-validators';
import {
  mockFemaleIdentity,
  mockMaleIdentity,
  mockCompanionResponse,
  mockAnchorImages,
  mockBackstoryResponse,
  mockSessionResponse,
} from '../fixtures/mock-data';

test.describe('Gender Change Field Validation', () => {
  let onboardingPage: OnboardingPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    onboardingPage = new OnboardingPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mock authentication BEFORE setting up routes
    await setupMockAuth(page);

    // Setup basic mock endpoints
    await apiInterceptor.mockEndpoint(
      '/companions',
      mockCompanionResponse(),
      { method: 'POST' }
    );

    await apiInterceptor.mockEndpoint(
      '/companions/cmp_test123',
      mockCompanionResponse(),
      { method: 'PATCH' }
    );

    await apiInterceptor.mockAnchorStream('cmp_test123', [
      { type: 'anchor', data: mockAnchorImages[0] },
      { type: 'complete', data: { totalImages: 1, companionId: 'cmp_test123' } },
    ]);

    await onboardingPage.goto();
  });

  test.describe('Switching from Female to Male', () => {
    test.beforeEach(async ({ page }) => {
      // Mock generate-identity to return female
      await apiInterceptor.mockEndpoint(
        '/companions/generate-identity',
        mockFemaleIdentity,
        { method: 'POST' }
      );
    });

    test('should remove breastSize and add build when switching to male', async ({ page }) => {
      // Start with Surprise Me (female)
      await onboardingPage.clickSurpriseMe();

      // Verify initial female appearance has breastSize
      await onboardingPage.proceedToVisuals();
      let appearance = await onboardingPage.getStoreAppearance();

      expect(appearance.gender).toBe('female');
      expect(appearance.breastSize).toBeDefined();
      expect(appearance).not.toHaveProperty('build');

      // Change to male
      await onboardingPage.selectGender('male');

      // Verify male appearance has build, not breastSize
      appearance = await onboardingPage.getStoreAppearance();

      expect(appearance.gender).toBe('male');
      expect(appearance.build).toBeDefined();
      expect(appearance).not.toHaveProperty('breastSize');

      const validation = validateGenderSpecificFields(appearance);
      expect(validation.isValid).toBe(true);
    });

    test('should default build to M when switching to male', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      await onboardingPage.proceedToVisuals();

      // Change to male
      await onboardingPage.selectGender('male');

      const appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.build).toBe('M');
    });

    test('should use correct male body types after gender change', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      await onboardingPage.proceedToVisuals();

      // Change to male
      await onboardingPage.selectGender('male');

      // Select muscular body type (male-only option)
      await onboardingPage.selectAppearanceOption('body-type', 'muscular');

      const appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.bodyType).toBe('muscular');
    });

    test('should send correct fields in anchor request after gender change', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      apiInterceptor.clearCapturedRequests();

      await onboardingPage.proceedToVisuals();

      // Change to male
      await onboardingPage.selectGender('male');
      await onboardingPage.selectAppearanceOption('size', 'L');

      // Navigate to voice and proceed
      await onboardingPage.proceedFromVisuals();
      await onboardingPage.navigateToStep(5);
      await onboardingPage.selectVoice('Daniel');
      await onboardingPage.clickReviewAndIgnite();

      // Verify anchor request has male fields
      const anchorRequest = apiInterceptor.assertRequestMade('/imagegen/generate-anchors-stream', 'GET');

      validateAnchorRequest(anchorRequest.body, {
        gender: 'male',
        ethnicity: 'east-asian', // Preserved from original
        bodyType: 'athletic', // Reset to default
        hairColor: 'fantasy', // Preserved from original
        build: 'L',
      });

      // Verify breastSize is NOT in the request
      const body = anchorRequest.body as { appearance: Record<string, unknown> };
      expect(body.appearance).not.toHaveProperty('breastSize');
    });
  });

  test.describe('Switching from Male to Female', () => {
    test.beforeEach(async ({ page }) => {
      // Mock generate-identity to return male
      await apiInterceptor.mockEndpoint(
        '/companions/generate-identity',
        mockMaleIdentity,
        { method: 'POST' }
      );
    });

    test('should remove build and add breastSize when switching to female', async ({ page }) => {
      // Start with Surprise Me (male)
      await onboardingPage.clickSurpriseMe();

      // Verify initial male appearance has build
      await onboardingPage.proceedToVisuals();
      let appearance = await onboardingPage.getStoreAppearance();

      expect(appearance.gender).toBe('male');
      expect(appearance.build).toBeDefined();
      expect(appearance).not.toHaveProperty('breastSize');

      // Change to female
      await onboardingPage.selectGender('female');

      // Verify female appearance has breastSize, not build
      appearance = await onboardingPage.getStoreAppearance();

      expect(appearance.gender).toBe('female');
      expect(appearance.breastSize).toBeDefined();
      expect(appearance).not.toHaveProperty('build');

      const validation = validateGenderSpecificFields(appearance);
      expect(validation.isValid).toBe(true);
    });

    test('should default breastSize to M when switching to female', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      await onboardingPage.proceedToVisuals();

      // Change to female
      await onboardingPage.selectGender('female');

      const appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.breastSize).toBe('M');
    });

    test('should use correct female body types after gender change', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      await onboardingPage.proceedToVisuals();

      // Change to female
      await onboardingPage.selectGender('female');

      // Select curvy body type (female-only option)
      await onboardingPage.selectAppearanceOption('body-type', 'curvy');

      const appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.bodyType).toBe('curvy');
    });

    test('should send correct fields in anchor request after gender change', async ({ page }) => {
      await onboardingPage.clickSurpriseMe();
      apiInterceptor.clearCapturedRequests();

      await onboardingPage.proceedToVisuals();

      // Change to female
      await onboardingPage.selectGender('female');
      await onboardingPage.selectAppearanceOption('size', 'L');

      // Navigate to voice and proceed
      await onboardingPage.proceedFromVisuals();
      await onboardingPage.navigateToStep(5);
      await onboardingPage.selectVoice('Sarah');
      await onboardingPage.clickReviewAndIgnite();

      // Verify anchor request has female fields
      const anchorRequest = apiInterceptor.assertRequestMade('/imagegen/generate-anchors-stream', 'GET');

      validateAnchorRequest(anchorRequest.body, {
        gender: 'female',
        ethnicity: 'caucasian', // Preserved from original
        bodyType: 'athletic', // Reset to default
        hairColor: 'brown', // Preserved from original
        breastSize: 'L',
      });

      // Verify build is NOT in the request
      const body = anchorRequest.body as { appearance: Record<string, unknown> };
      expect(body.appearance).not.toHaveProperty('build');
    });
  });

  test.describe('Multiple Gender Switches', () => {
    test('should correctly handle multiple gender switches', async ({ page }) => {
      await apiInterceptor.mockEndpoint(
        '/companions/generate-identity',
        mockFemaleIdentity,
        { method: 'POST' }
      );

      await onboardingPage.clickSurpriseMe();
      await onboardingPage.proceedToVisuals();

      // Start female, switch to male
      await onboardingPage.selectGender('male');
      let appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.build).toBeDefined();
      expect(appearance).not.toHaveProperty('breastSize');

      // Switch back to female
      await onboardingPage.selectGender('female');
      appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.breastSize).toBeDefined();
      expect(appearance).not.toHaveProperty('build');

      // Switch to male again
      await onboardingPage.selectGender('male');
      appearance = await onboardingPage.getStoreAppearance();
      expect(appearance.build).toBeDefined();
      expect(appearance).not.toHaveProperty('breastSize');

      // All switches should result in valid appearance
      const validation = validateGenderSpecificFields(appearance);
      expect(validation.isValid).toBe(true);
    });
  });
});
