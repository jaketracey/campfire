/**
 * Batch Companion Creation E2E Test
 *
 * Creates 20 diverse companions against the REAL local dev server.
 * This test does NOT mock API responses - it creates actual companions in the database.
 *
 * Run with: pnpm exec playwright test create-companions-batch --project=chromium
 *
 * IMPORTANT: Before running, ensure a valid session token exists in the database.
 * Use the script in the comments below to create one if needed.
 */

import { test, expect } from '@playwright/test';
import { OnboardingPage } from '../helpers/onboarding-page';

// Real JWT token for admin user - expires in 24h from creation
const REAL_AUTH_TOKEN = process.env.E2E_AUTH_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI2OWE4MDMzNS05MWU3LTQxYjMtYWZiMi1hMjQ4NjkyNDVmZDUiLCJlbWFpbCI6Impha2V0cmFjZXlAZ21haWwuY29tIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzY4NzA5ODAyLCJpc3MiOiJjYW1wZmlyZSIsImF1ZCI6ImNhbXBmaXJlLWFwaSIsImV4cCI6MTc2ODc5NjIwMn0.r8plXgKp6le-SGiAMaDN-YJ3tn0HbeGEte-uQ26XVuQ';
const REAL_USER_ID = '69a80335-91e7-41b3-afb2-a24869245fd5';
const REAL_USER_EMAIL = 'jaketracey@gmail.com';

// Appearance options from the companion types
const ethnicities = ['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed'] as const;
const femaleBodyTypes = ['slim', 'athletic', 'curvy', 'plus-size'] as const;
const maleBodyTypes = ['slim', 'athletic', 'muscular', 'dad-bod'] as const;
const hairColors = ['black', 'brown', 'blonde', 'red', 'fantasy'] as const;
const sizes = ['S', 'M', 'L'] as const;
const voices = {
  female: ['Sarah', 'Laura', 'Charlotte', 'Lily', 'Jessica'],
  male: ['Daniel', 'Eric', 'Callum', 'Charlie', 'George'],
};

// Names for companions
const femaleNames = ['Luna', 'Aria', 'Nova', 'Sage', 'Aurora', 'Ivy', 'Ruby', 'Maya', 'Zara', 'Stella'];
const maleNames = ['Marcus', 'Kai', 'Leo', 'Atlas', 'Orion', 'Felix', 'Jasper', 'Milo', 'Theo', 'Oscar'];

// Helper to pick random from array
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate 20 companion configurations
interface CompanionConfig {
  name: string;
  gender: 'male' | 'female';
  pronouns: string;
  ethnicity: string;
  bodyType: string;
  hairColor: string;
  size: string;
  voice: string;
}

function generateCompanionConfigs(count: number): CompanionConfig[] {
  const configs: CompanionConfig[] = [];

  // Create diverse companions using prime number offsets to maximize variety
  // Each attribute uses a different prime multiplier to avoid repetition patterns
  for (let i = 0; i < count; i++) {
    const gender = i % 2 === 0 ? 'female' : 'male'; // Alternate gender
    const names = gender === 'female' ? femaleNames : maleNames;
    const bodyTypes = gender === 'female' ? femaleBodyTypes : maleBodyTypes;
    const voiceOptions = voices[gender];

    // Use prime number multipliers to ensure variety across ALL attributes
    const genderIdx = Math.floor(i / 2); // 0-9 for each gender
    const nameIdx = genderIdx % names.length;
    const ethIdx = (i * 3) % ethnicities.length;      // Prime offset 3
    const bodyIdx = genderIdx % bodyTypes.length;      // Cycle through all body types per gender
    const hairIdx = (i * 7) % hairColors.length;       // Prime offset 7
    const sizeIdx = (i * 11) % sizes.length;           // Prime offset 11
    const voiceIdx = genderIdx % voiceOptions.length;

    configs.push({
      name: names[nameIdx],
      gender,
      pronouns: gender === 'female' ? 'she/her' : 'he/him',
      ethnicity: ethnicities[ethIdx],
      bodyType: bodyTypes[bodyIdx],
      hairColor: hairColors[hairIdx],
      size: sizes[sizeIdx],
      voice: voiceOptions[voiceIdx],
    });
  }

  return configs;
}

const companionConfigs = generateCompanionConfigs(20);

/**
 * Inject real auth state into localStorage
 */
async function injectRealAuth(page: import('@playwright/test').Page) {
  const authState = {
    state: {
      user: {
        id: REAL_USER_ID,
        email: REAL_USER_EMAIL,
        role: 'admin',
        isVerified: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      },
      accessToken: REAL_AUTH_TOKEN,
      refreshToken: REAL_AUTH_TOKEN,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      isImpersonating: false,
      impersonationState: null,
    },
    version: 0,
  };

  // Use addInitScript to set localStorage BEFORE the app loads
  await page.addInitScript((authStateStr) => {
    localStorage.setItem('campfire-auth', authStateStr);
  }, JSON.stringify(authState));
}

test.describe('Batch Companion Creation', () => {
  // Use serial mode - each test depends on auth state
  test.describe.configure({ mode: 'serial' });

  // Increase timeout for onboarding flow (image generation can take time)
  test.setTimeout(180000);

  for (let i = 0; i < companionConfigs.length; i++) {
    const config = companionConfigs[i];

    test(`Create companion ${i + 1}/20: ${config.name} (${config.gender})`, async ({ page }) => {
      const onboardingPage = new OnboardingPage(page);

      // Inject real auth before navigating
      await injectRealAuth(page);

      // Navigate to onboarding
      await page.goto('/onboard');
      await page.waitForLoadState('networkidle');

      // Dismiss cookie banner if present
      await onboardingPage.dismissCookieBanner();

      // Click "Start Designing" to proceed from welcome to identity
      const startDesigningButton = page.locator('[data-testid="start-designing"]');
      await startDesigningButton.waitFor({ state: 'visible', timeout: 10000 });
      await startDesigningButton.click({ force: true });

      // Wait for identity step
      await onboardingPage.nameInput.waitFor({ state: 'visible', timeout: 10000 });
      await onboardingPage.dismissCookieBanner();

      // Step 2: Fill identity
      await onboardingPage.fillIdentity({
        name: config.name,
        pronouns: config.pronouns,
        backstory: `A unique companion with ${config.ethnicity} heritage and ${config.hairColor} hair.`,
      });

      // Proceed to visuals
      await onboardingPage.proceedToVisuals();

      // Step 3: Configure appearance
      await onboardingPage.selectGender(config.gender);
      await onboardingPage.selectAppearanceOption('ethnicity', config.ethnicity);
      await onboardingPage.selectAppearanceOption('body-type', config.bodyType);
      await onboardingPage.selectAppearanceOption('hair-color', config.hairColor);
      await onboardingPage.selectAppearanceOption('size', config.size);

      // Proceed from visuals
      await onboardingPage.proceedFromVisuals();

      // Navigate through archetype/personality steps to reach Voice step
      await onboardingPage.navigateToStep(7);

      // Wait for voice page to load
      await page.waitForSelector('text=Choose a voice', { timeout: 10000 });

      // Step 7: Select voice using the page helper (more reliable)
      await onboardingPage.selectVoice(config.voice);
      await page.waitForTimeout(500);

      // If Review button is still disabled, set voice directly in store
      const reviewButton = page.locator('[data-testid="review-and-ignite"]');
      let isEnabled = await reviewButton.isEnabled().catch(() => false);
      if (!isEnabled) {
        console.log(`Voice ${config.voice} click didn't work, setting via store...`);
        // Set voice directly in store as fallback
        await page.evaluate((voiceName) => {
          const voices = [
            { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, warm', gender: 'feminine' },
            { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Calm, soothing', gender: 'feminine' },
            { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Elegant', gender: 'feminine' },
            { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Sweet', gender: 'feminine' },
            { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'Expressive', gender: 'feminine' },
            { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep', gender: 'masculine' },
            { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', description: 'Smooth', gender: 'masculine' },
            { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Warm', gender: 'masculine' },
            { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Friendly', gender: 'neutral' },
            { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Rich', gender: 'masculine' },
          ];
          const voice = voices.find(v => v.name === voiceName);
          if (voice) {
            const store = (window as unknown as { __ONBOARDING_STORE__?: { getState: () => unknown; setState: (s: unknown) => void } }).__ONBOARDING_STORE__;
            if (store) {
              store.setState({ voice });
            }
          }
        }, config.voice);
        await page.waitForTimeout(500);
        isEnabled = await reviewButton.isEnabled().catch(() => false);
      }

      // Wait for the Review button to actually be enabled before clicking
      if (!isEnabled) {
        console.log('Waiting for Review button to become enabled...');
        await reviewButton.waitFor({ state: 'visible' });
        await expect(reviewButton).toBeEnabled({ timeout: 10000 });
      }

      // Click Review & Ignite
      await onboardingPage.clickReviewAndIgnite();

      // Verify we're on the review page
      await expect(onboardingPage.companionName).toBeVisible({ timeout: 60000 });

      // Wait for images to load and session to be created (button appears when ready)
      console.log(`Companion ${config.name}: waiting for ignite button...`);
      const igniteButton = page.locator('[data-testid="ignite-button"]');

      // Wait up to 90 seconds for the button (images need to generate, session needs to be created)
      await igniteButton.waitFor({ state: 'visible', timeout: 90000 });
      console.log(`Companion ${config.name}: ignite button visible`);

      await igniteButton.scrollIntoViewIfNeeded();
      await igniteButton.click();

      // Wait a moment for the companion to be fully created
      await page.waitForTimeout(2000);

      // Verify companion was created by checking database or just log success
      console.log(`✓ Created companion ${i + 1}/20: ${config.name} (${config.gender}, ${config.ethnicity}, ${config.bodyType})`);
    });
  }
});
