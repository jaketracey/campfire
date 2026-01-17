/**
 * Onboarding Page Object Model
 * Encapsulates interactions with the companion onboarding flow.
 */

import { Page, Locator, expect } from '@playwright/test';

export class OnboardingPage {
  readonly page: Page;

  // Step 2: Identity
  readonly surpriseMeButton: Locator;
  readonly nameInput: Locator;
  readonly pronounsInput: Locator;
  readonly backstoryInput: Locator;
  readonly nextToVisualsButton: Locator;

  // Step 3: Visuals (Appearance)
  readonly genderMaleButton: Locator;
  readonly genderFemaleButton: Locator;
  readonly nextToArchetypeButton: Locator;

  // Step 7: Voice
  readonly reviewButton: Locator;

  // Step 9: Review
  readonly igniteButton: Locator;
  readonly companionName: Locator;

  constructor(page: Page) {
    this.page = page;

    // Step 2: Identity - using data-testid selectors
    this.surpriseMeButton = page.locator('[data-testid="surprise-me-button"]');
    this.nameInput = page.locator('[data-testid="name-input"]');
    this.pronounsInput = page.locator('[data-testid="pronouns-input"]');
    this.backstoryInput = page.locator('[data-testid="backstory-input"]');
    this.nextToVisualsButton = page.locator('[data-testid="next-to-visuals"]');

    // Step 3: Visuals - using data-testid selectors
    this.genderMaleButton = page.locator('[data-testid="gender-male"]');
    this.genderFemaleButton = page.locator('[data-testid="gender-female"]');
    this.nextToArchetypeButton = page.locator('[data-testid="next-to-archetype"]');

    // Step 7: Voice
    this.reviewButton = page.locator('[data-testid="review-and-ignite"]');

    // Step 9: Review
    this.igniteButton = page.locator('[data-testid="ignite-button"]');
    this.companionName = page.locator('[data-testid="companion-name"]');
  }

  /**
   * Dismiss any cookie consent banner that might be blocking clicks
   */
  async dismissCookieBanner() {
    // Try to hide the cookie banner via JavaScript
    await this.page.evaluate(() => {
      const cookieBanners = document.querySelectorAll('[class*="cookie"], [class*="consent"], [class*="z-\\[100\\]"]');
      cookieBanners.forEach(banner => {
        if (banner instanceof HTMLElement) {
          banner.style.display = 'none';
        }
      });
      // Also hide any fixed bottom elements that might be blocking
      const fixedBottomElements = document.querySelectorAll('.fixed.bottom-0');
      fixedBottomElements.forEach(el => {
        if (el instanceof HTMLElement) {
          el.style.display = 'none';
        }
      });
    });
  }

  /**
   * Navigate to the onboarding page and proceed to step 2 (Identity)
   */
  async goto() {
    await this.page.goto('/onboard');
    await this.page.waitForLoadState('networkidle');

    // Dismiss cookie consent banner if it exists
    await this.dismissCookieBanner();

    // Click "Start Designing" to proceed from welcome (step 1) to identity (step 2)
    const startDesigningButton = this.page.locator('[data-testid="start-designing"]');
    await startDesigningButton.waitFor({ state: 'visible', timeout: 10000 });
    await startDesigningButton.click({ force: true });

    // Wait for step 2 to be visible
    await this.nameInput.waitFor({ state: 'visible', timeout: 10000 });

    // Dismiss cookie consent banner again if it appeared
    await this.dismissCookieBanner();
  }

  /**
   * Click the Surprise Me button and wait for generation
   */
  async clickSurpriseMe() {
    await this.surpriseMeButton.click();
    // Wait for the loading state to finish (button text changes during generation)
    await expect(this.surpriseMeButton).not.toContainText('Conjuring', { timeout: 30000 });
  }

  /**
   * Fill identity fields manually
   */
  async fillIdentity(data: {
    name: string;
    pronouns: string;
    backstory?: string;
  }) {
    await this.nameInput.fill(data.name);
    await this.pronounsInput.fill(data.pronouns);
    if (data.backstory) {
      await this.backstoryInput.fill(data.backstory);
    }
  }

  /**
   * Proceed from Identity to Visuals step
   */
  async proceedToVisuals() {
    // Dismiss cookie banner if it's blocking
    await this.dismissCookieBanner();

    // Wait for the button to be enabled and ready
    await this.nextToVisualsButton.waitFor({ state: 'visible' });
    await expect(this.nextToVisualsButton).toBeEnabled({ timeout: 5000 });

    // Scroll button into view
    await this.nextToVisualsButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    // Click the button with force to bypass any remaining overlays
    await this.nextToVisualsButton.click({ force: true });

    // Wait for the gender selection to appear (Visuals step)
    await this.genderFemaleButton.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Select gender using data-testid
   */
  async selectGender(gender: 'male' | 'female') {
    if (gender === 'male') {
      await this.genderMaleButton.click({ force: true });
    } else {
      await this.genderFemaleButton.click({ force: true });
    }
    // Wait for UI to update
    await this.page.waitForTimeout(300);
  }

  /**
   * Select appearance option by data-testid
   * Categories: ethnicity, body-type, hair-color, size
   * Values: the ID of the option (e.g., 'east-asian', 'athletic', 'blonde', 'M')
   */
  async selectAppearanceOption(category: string, value: string) {
    const selector = `[data-testid="${category}-${value}"]`;
    await this.page.locator(selector).click({ force: true });
    // Wait for UI to update
    await this.page.waitForTimeout(300);
  }

  /**
   * Get current appearance values from the store (via JavaScript execution)
   */
  async getStoreAppearance(): Promise<Record<string, unknown>> {
    return await this.page.evaluate(() => {
      // Access Zustand store from window (exposed for testing)
      const store = (window as unknown as { __ONBOARDING_STORE__?: { getState: () => { visualStyle: { appearance: Record<string, unknown> } } } }).__ONBOARDING_STORE__;
      if (!store) {
        throw new Error('Store not exposed on window');
      }
      return store.getState().visualStyle.appearance;
    });
  }

  /**
   * Check if appearance changed after generation flag is set
   */
  async isAppearanceChangedAfterGeneration(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const store = (window as unknown as { __ONBOARDING_STORE__?: { getState: () => { appearanceChangedAfterGeneration: boolean } } }).__ONBOARDING_STORE__;
      if (!store) {
        throw new Error('Store not exposed on window');
      }
      return store.getState().appearanceChangedAfterGeneration;
    });
  }

  /**
   * Get the companion ID from the store
   */
  async getCompanionId(): Promise<string | null> {
    return await this.page.evaluate(() => {
      const store = (window as unknown as { __ONBOARDING_STORE__?: { getState: () => { companionId: string | null } } }).__ONBOARDING_STORE__;
      if (!store) {
        throw new Error('Store not exposed on window');
      }
      return store.getState().companionId;
    });
  }

  /**
   * Proceed from Visuals to next step
   */
  async proceedFromVisuals() {
    await this.nextToArchetypeButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await this.nextToArchetypeButton.click({ force: true });
    // Wait for navigation
    await this.page.waitForTimeout(500);
  }

  /**
   * Select a voice by name using data-testid
   */
  async selectVoice(voiceName: string) {
    const voiceCard = this.page.locator(`[data-testid="voice-option-${voiceName}"]`);
    await voiceCard.scrollIntoViewIfNeeded();
    await voiceCard.click({ force: true });
    await this.page.waitForTimeout(300);
  }

  /**
   * Click Review & Ignite button
   */
  async clickReviewAndIgnite() {
    await this.reviewButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await this.reviewButton.click({ force: true });
    // Wait for navigation to review step - wait for the companion name to appear
    await this.companionName.waitFor({ state: 'visible', timeout: 60000 });
  }

  /**
   * Get the number of visible anchor images on review page
   */
  async getAnchorImageCount(): Promise<number> {
    // Wait for at least one anchor image to appear
    await this.page.locator('[data-testid^="anchor-image-"]').first().waitFor({ timeout: 30000 }).catch(() => null);
    return await this.page.locator('[data-testid^="anchor-image-"]').count();
  }

  /**
   * Click Ignite button to complete onboarding
   */
  async clickIgnite() {
    await this.igniteButton.waitFor({ state: 'visible', timeout: 60000 });
    await this.igniteButton.click();
    // Wait for redirect to chat
    await this.page.waitForURL(/.*\/chat\/.*/, { timeout: 30000 });
  }

  /**
   * Complete the full onboarding flow with Surprise Me
   */
  async completeSurpriseMeFlow() {
    await this.goto();
    await this.clickSurpriseMe();
    await this.proceedToVisuals();
    // Skip through remaining steps...
    // This would continue through archetypes, personality, voice, etc.
  }

  /**
   * Navigate through steps by clicking next buttons
   */
  async navigateToStep(stepNumber: number) {
    while (true) {
      const currentUrl = this.page.url();
      const currentStep = parseInt(currentUrl.match(/step=(\d+)/)?.[1] || '1');
      if (currentStep >= stepNumber) break;

      // Find and click the next button
      const nextButton = this.page.getByRole('button', { name: /next|continue/i }).first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await this.page.waitForTimeout(500);
      } else {
        break;
      }
    }
  }
}
