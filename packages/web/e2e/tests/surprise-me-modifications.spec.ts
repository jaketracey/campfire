/**
 * Surprise Me + Modifications E2E Tests
 *
 * These tests validate the fix for the critical bug where:
 * - User clicks "Surprise Me" in Step 2 (generates companion with appearance A)
 * - User modifies appearance in Step 3 to appearance B
 * - Review step should show anchors with appearance B, NOT appearance A
 *
 * The fix involves:
 * 1. Tracking when appearance changes after generation
 * 2. Regenerating anchor images with updated appearance before review
 * 3. Updating companion in DB with new appearance
 */

import { test, expect } from '@playwright/test';
import { OnboardingPage } from '../helpers/onboarding-page';
import { createApiInterceptor, ApiInterceptor } from '../helpers/api-interceptor';
import {
  validateAnchorRequest,
  validateCompanionRequest,
  validateGenderSpecificFields,
  assertAppearancesDifferent,
} from '../helpers/image-validators';
import {
  mockFemaleIdentity,
  mockMaleAppearance,
  mockFemaleAppearance,
  mockCompanionResponse,
  mockAnchorImages,
  mockBackstoryResponse,
  mockSessionResponse,
} from '../fixtures/mock-data';

test.describe('Surprise Me + Modifications Flow', () => {
  let onboardingPage: OnboardingPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    onboardingPage = new OnboardingPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mock endpoints
    await apiInterceptor.mockEndpoint(
      '/companions/generate-identity',
      mockFemaleIdentity,
      { method: 'POST' }
    );

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

    // Mock anchor stream with SSE events
    await apiInterceptor.mockAnchorStream('cmp_test123', [
      { type: 'progress', data: { progress: 0.5, message: 'Generating...' } },
      { type: 'anchor', data: mockAnchorImages[0] },
      { type: 'anchor', data: mockAnchorImages[1] },
      { type: 'anchor', data: mockAnchorImages[2] },
      { type: 'complete', data: { totalImages: 3, companionId: 'cmp_test123' } },
    ]);

    await onboardingPage.goto();
  });

  test('should regenerate anchors with modified appearance after Surprise Me', async ({ page }) => {
    // Step 1: Click Surprise Me - generates female, east-asian appearance
    await onboardingPage.clickSurpriseMe();

    // Verify initial companion was created with female appearance
    const createRequest = apiInterceptor.assertRequestMade('/companions', 'POST');
    validateCompanionRequest(createRequest.body, {
      gender: 'female',
      ethnicity: 'east-asian',
      bodyType: 'athletic',
      hairColor: 'fantasy',
      breastSize: 'M',
    });

    // Clear captured requests to track new ones
    apiInterceptor.clearCapturedRequests();

    // Step 2: Proceed to visuals and change appearance
    await onboardingPage.proceedToVisuals();

    // Change to male appearance
    await onboardingPage.selectGender('male');
    await onboardingPage.selectAppearanceOption('ethnicity', 'caucasian');
    await onboardingPage.selectAppearanceOption('body-type', 'muscular');
    await onboardingPage.selectAppearanceOption('hair-color', 'brown');
    await onboardingPage.selectAppearanceOption('size', 'L');

    // Verify the store has the flag set
    const isChanged = await onboardingPage.isAppearanceChangedAfterGeneration();
    expect(isChanged).toBe(true);

    // Step 3: Navigate through remaining steps to voice selection
    await onboardingPage.proceedFromVisuals();
    // ... navigate through archetype, personality, tenets steps
    await onboardingPage.navigateToStep(5); // Voice step

    // Select a voice and proceed to review
    await onboardingPage.selectVoice('Sarah');
    await onboardingPage.clickReviewAndIgnite();

    // CRITICAL ASSERTION: Verify companion was updated with NEW appearance
    const updateRequest = apiInterceptor.assertRequestMade('/companions/cmp_test123', 'PATCH');
    validateCompanionRequest(updateRequest.body, {
      gender: 'male',
      ethnicity: 'caucasian',
      bodyType: 'muscular',
      hairColor: 'brown',
      build: 'L',
    });

    // CRITICAL ASSERTION: Verify anchor stream was called with NEW appearance
    const anchorRequest = apiInterceptor.assertRequestMade('/imagegen/generate-anchors-stream', 'POST');
    validateAnchorRequest(anchorRequest.body, {
      gender: 'male',
      ethnicity: 'caucasian',
      bodyType: 'muscular',
      hairColor: 'brown',
      build: 'L',
    });

    // Verify the old and new appearances are different
    const originalAppearance = (createRequest.body as { spec: { visual_style: { appearance: Record<string, unknown> } } }).spec.visual_style.appearance;
    const updatedAppearance = (updateRequest.body as { spec: { visual_style: { appearance: Record<string, unknown> } } }).spec.visual_style.appearance;
    assertAppearancesDifferent(originalAppearance, updatedAppearance);
  });

  test('should NOT regenerate anchors if appearance was not changed', async ({ page }) => {
    // Click Surprise Me
    await onboardingPage.clickSurpriseMe();

    // Clear captured requests
    apiInterceptor.clearCapturedRequests();

    // Navigate through WITHOUT changing appearance
    await onboardingPage.proceedToVisuals();
    await onboardingPage.proceedFromVisuals();
    await onboardingPage.navigateToStep(5);

    await onboardingPage.selectVoice('Sarah');
    await onboardingPage.clickReviewAndIgnite();

    // Should NOT have called PATCH on companion
    const patchRequests = apiInterceptor.getRequestsForEndpoint('/companions/cmp_test123');
    const patchCalls = patchRequests.filter((r) => r.method === 'PATCH');
    expect(patchCalls.length).toBe(0);

    // Should NOT have called anchor stream again (already generated in Surprise Me)
    const anchorRequests = apiInterceptor.getRequestsForEndpoint('/imagegen/generate-anchors-stream');
    expect(anchorRequests.length).toBe(0);
  });

  test('should handle gender change by resetting gender-specific fields', async ({ page }) => {
    // Click Surprise Me (generates female)
    await onboardingPage.clickSurpriseMe();

    // Clear captured requests
    apiInterceptor.clearCapturedRequests();

    // Proceed to visuals
    await onboardingPage.proceedToVisuals();

    // Change to male
    await onboardingPage.selectGender('male');

    // Get store appearance
    const appearance = await onboardingPage.getStoreAppearance();

    // Validate gender-specific fields are correct
    const validation = validateGenderSpecificFields(appearance);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Male should have build, NOT breastSize
    expect(appearance.gender).toBe('male');
    expect(appearance.build).toBeDefined();
    expect(appearance).not.toHaveProperty('breastSize');
  });

  test('should preserve ethnicity and hair color when changing gender', async ({ page }) => {
    // Click Surprise Me (generates female with specific ethnicity/hair)
    await onboardingPage.clickSurpriseMe();

    // Proceed to visuals
    await onboardingPage.proceedToVisuals();

    // Get initial appearance
    const initialAppearance = await onboardingPage.getStoreAppearance();
    const initialEthnicity = initialAppearance.ethnicity;
    const initialHairColor = initialAppearance.hairColor;

    // Change to male
    await onboardingPage.selectGender('male');

    // Get updated appearance
    const updatedAppearance = await onboardingPage.getStoreAppearance();

    // Ethnicity and hair color should be preserved
    expect(updatedAppearance.ethnicity).toBe(initialEthnicity);
    expect(updatedAppearance.hairColor).toBe(initialHairColor);

    // Gender should have changed
    expect(updatedAppearance.gender).toBe('male');
  });

  test('should mark appearance as changed when any field is modified', async ({ page }) => {
    // Click Surprise Me
    await onboardingPage.clickSurpriseMe();

    // Proceed to visuals
    await onboardingPage.proceedToVisuals();

    // Initially, flag should be false
    let isChanged = await onboardingPage.isAppearanceChangedAfterGeneration();
    expect(isChanged).toBe(false);

    // Change just the hair color (not gender)
    await onboardingPage.selectAppearanceOption('hair-color', 'blonde');

    // Now flag should be true
    isChanged = await onboardingPage.isAppearanceChangedAfterGeneration();
    expect(isChanged).toBe(true);
  });
});
