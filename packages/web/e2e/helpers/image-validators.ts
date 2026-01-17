/**
 * Image and Appearance Validation Utilities
 * Since we can't visually compare AI-generated images, we validate request parameters.
 */

import { expect } from '@playwright/test';

/**
 * Appearance data structure for validation
 */
export interface AppearanceValidation {
  gender: 'female' | 'male';
  ethnicity: string;
  bodyType: string;
  hairColor: string;
  breastSize?: string; // Female only
  build?: string; // Male only
}

/**
 * Validate that an appearance object matches expected values
 */
export function validateAppearance(
  actual: Record<string, unknown>,
  expected: AppearanceValidation
): void {
  expect(actual.gender).toBe(expected.gender);
  expect(actual.ethnicity).toBe(expected.ethnicity);
  expect(actual.bodyType).toBe(expected.bodyType);
  expect(actual.hairColor).toBe(expected.hairColor);

  if (expected.gender === 'female') {
    expect(actual.breastSize).toBe(expected.breastSize);
    expect(actual).not.toHaveProperty('build');
  } else {
    expect(actual.build).toBe(expected.build);
    expect(actual).not.toHaveProperty('breastSize');
  }
}

/**
 * Validate anchor stream request contains correct appearance
 */
export function validateAnchorRequest(
  requestBody: unknown,
  expectedAppearance: AppearanceValidation
): void {
  expect(requestBody).toBeTruthy();
  const body = requestBody as { appearance?: Record<string, unknown> };

  expect(body.appearance).toBeDefined();
  validateAppearance(body.appearance!, expectedAppearance);
}

/**
 * Validate companion create/update request contains correct appearance
 */
export function validateCompanionRequest(
  requestBody: unknown,
  expectedAppearance: AppearanceValidation
): void {
  expect(requestBody).toBeTruthy();
  const body = requestBody as {
    spec?: {
      visual_style?: {
        appearance?: Record<string, unknown>;
      };
    };
  };

  expect(body.spec?.visual_style?.appearance).toBeDefined();
  validateAppearance(body.spec!.visual_style!.appearance!, expectedAppearance);
}

/**
 * Validate that gender-specific fields are correctly handled
 * Female should have breastSize but NOT build
 * Male should have build but NOT breastSize
 */
export function validateGenderSpecificFields(
  appearance: Record<string, unknown>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (appearance.gender === 'female') {
    if (!appearance.breastSize) {
      errors.push('Female appearance missing breastSize');
    }
    if ('build' in appearance) {
      errors.push('Female appearance should not have build field');
    }
  } else if (appearance.gender === 'male') {
    if (!appearance.build) {
      errors.push('Male appearance missing build');
    }
    if ('breastSize' in appearance) {
      errors.push('Male appearance should not have breastSize field');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Assert that two appearances are different (for change detection)
 */
export function assertAppearancesDifferent(
  original: Record<string, unknown>,
  modified: Record<string, unknown>
): void {
  const isDifferent =
    original.gender !== modified.gender ||
    original.ethnicity !== modified.ethnicity ||
    original.bodyType !== modified.bodyType ||
    original.hairColor !== modified.hairColor ||
    original.breastSize !== modified.breastSize ||
    original.build !== modified.build;

  expect(isDifferent).toBe(true);
}

/**
 * Assert that two appearances are the same
 */
export function assertAppearancesSame(
  first: Record<string, unknown>,
  second: Record<string, unknown>
): void {
  expect(first.gender).toBe(second.gender);
  expect(first.ethnicity).toBe(second.ethnicity);
  expect(first.bodyType).toBe(second.bodyType);
  expect(first.hairColor).toBe(second.hairColor);

  if (first.gender === 'female') {
    expect(first.breastSize).toBe(second.breastSize);
  } else {
    expect(first.build).toBe(second.build);
  }
}
