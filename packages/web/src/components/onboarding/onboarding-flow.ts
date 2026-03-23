/**
 * Shared onboarding flow configuration for both full and quick-start experiences.
 */

export const FULL_ONBOARDING_LABELS = [
  'Identity',
  'Visuals',
  'Archetype',
  'Voice',
  'Review',
] as const;

export const QUICK_ONBOARDING_LABELS = [
  'Identity',
  'Visuals',
  'Archetype',
  'Voice',
] as const;

// Next/previous UI step range for full onboarding page (`currentStep` in store).
export const FULL_STEP_MIN = 1;
export const FULL_STEP_MAX = 6;
export const FULL_STEP_LABEL_MIN = 2;
export const FULL_STEP_LABEL_MAX = FULL_STEP_MAX;

export function clampFullStep(step: number): number {
  if (Number.isNaN(step)) {
    return FULL_STEP_MIN;
  }

  if (step < FULL_STEP_MIN) return FULL_STEP_MIN;
  if (step > FULL_STEP_MAX) return FULL_STEP_MAX;
  return Math.round(step);
}

export function fullReviewStepProgress(currentStep: number): number {
  const step = clampFullStep(currentStep);
  return ((step - FULL_STEP_MIN) / (FULL_STEP_MAX - FULL_STEP_MIN)) * 100;
}

export function quickStepToIndex(quickStep?: number | null): number {
  if (quickStep === null || quickStep === undefined || Number.isNaN(quickStep)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(quickStep), 0), QUICK_ONBOARDING_LABELS.length - 1);
}

export function quickStartProgress(index: number): number {
  const safeIndex = quickStepToIndex(index);
  return ((safeIndex + 1) / QUICK_ONBOARDING_LABELS.length) * 100;
}
