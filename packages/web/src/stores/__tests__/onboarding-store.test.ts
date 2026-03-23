import { beforeEach, describe, expect, it } from 'vitest';

import { useOnboardingStore } from '../onboarding-store';

describe('Onboarding Store', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('tracks companion readiness flags', () => {
    useOnboardingStore.getState().setCompanionReady(true);
    useOnboardingStore.getState().setCompanionActive(true);
    useOnboardingStore.getState().setAnchorReady(true);
    useOnboardingStore.getState().setBackstoryReady(true);

    const state = useOnboardingStore.getState();
    expect(state.companionReady).toBe(true);
    expect(state.companionActive).toBe(true);
    expect(state.anchorReady).toBe(true);
    expect(state.backstoryReady).toBe(true);
  });

  it('clears readiness flags on reset', () => {
    useOnboardingStore.getState().setCompanionReady(true);
    useOnboardingStore.getState().setCompanionActive(true);
    useOnboardingStore.getState().setAnchorReady(true);
    useOnboardingStore.getState().setBackstoryReady(true);

    useOnboardingStore.getState().reset();

    const state = useOnboardingStore.getState();
    expect(state.companionReady).toBe(false);
    expect(state.companionActive).toBe(false);
    expect(state.anchorReady).toBe(false);
    expect(state.backstoryReady).toBe(false);
  });

  it('clears anchor-specific stream state', () => {
    useOnboardingStore.getState().setAnchorStreamStarted(true);
    useOnboardingStore.getState().setAnchorImagesComplete(true);
    useOnboardingStore.getState().setAnchorReady(true);
    useOnboardingStore.getState().addAnchorImage({
      id: 'anchor-1',
      url: 'https://example.com/anchor-1.png',
      emotionalState: 'happy',
      isIdentityAnchor: true,
    });

    useOnboardingStore.getState().clearAnchorImages();

    const state = useOnboardingStore.getState();
    expect(state.anchorImages).toHaveLength(0);
    expect(state.anchorStreamStarted).toBe(false);
    expect(state.anchorImagesComplete).toBe(false);
    expect(state.anchorReady).toBe(false);
  });
});
