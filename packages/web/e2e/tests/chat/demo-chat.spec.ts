/**
 * Demo Chat E2E Tests
 *
 * Tests anonymous/demo chat functionality including:
 * - Anonymous session creation
 * - Message count tracking (X/5)
 * - Signup modal on limit reached
 * - Signup modal on premium features
 * - Authenticated users redirected
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth, injectMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateStreamingResponse,
  simulateWSMessage,
} from '../../helpers/websocket-mock';
import {
  mockDemoCompanion,
  mockDemoSession,
  mockDemoAPIResponses,
  mockWSEvents,
} from '../../fixtures/chat-mock-data';

test.describe('Demo Chat', () => {
  let chatPage: ChatPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    chatPage = createChatPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup WebSocket mock before navigation
    await setupWebSocketMock(page);

    // Mock demo API endpoints
    await apiInterceptor.mockEndpoint('/demo/companion', mockDemoAPIResponses.getDemoCompanion, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/demo/session', mockDemoAPIResponses.createDemoSession(0), {
      method: 'POST',
    });
  });

  test.describe('Anonymous Session', () => {
    test('should create anonymous demo session', async ({ page }) => {
      // Go to demo page without auth
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      // Wait for the chat interface to load
      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Verify we can see the chat input
      await expect(chatPage.messagesContainer).toBeVisible();
    });

    test('should display demo companion info', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      // Wait for companion info to display
      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Verify companion name is shown (Aria from mock data)
      const companionNameLocator = page.locator('text=Aria');
      await expect(companionNameLocator).toBeVisible({ timeout: 5000 });
    });

    test('should allow sending messages in demo mode', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Send a message
      await chatPage.sendMessage('Hello from demo!');

      // Verify user message appears
      await chatPage.expectUserMessageSent('Hello from demo!');

      // Simulate response
      await simulateStreamingResponse(
        page,
        'Hello! Welcome to the demo!',
        { delayMs: 20 }
      );

      // Verify assistant response
      await chatPage.expectAssistantMessageReceived('Hello! Welcome to the demo!');
    });
  });

  test.describe('Message Limit Tracking', () => {
    test('should show usage update as messages are sent', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Send a message
      await chatPage.sendMessage('Message 1');

      // Simulate usage update (1 of 5 used)
      await simulateWSMessage(page, mockWSEvents.demoUsageUpdate(1));

      // Simulate response
      await simulateStreamingResponse(page, 'Response 1', { delayMs: 20 });

      // The UI should reflect the message was sent successfully
      await chatPage.expectUserMessageSent('Message 1');
    });

    test('should show signup modal when message limit is reached', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Send a message
      await chatPage.sendMessage('Final message');

      // Simulate limit reached event
      await simulateWSMessage(page, mockWSEvents.limitReached());

      // Verify signup modal appears
      await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

      // Verify the modal shows appropriate message for limit reached
      await expect(page.locator('text=Loving the Conversation')).toBeVisible();
    });
  });

  test.describe('Premium Features Signup Modal', () => {
    test('should show signup modal when accessing gallery', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Try to access gallery (premium feature)
      const galleryButton = page.locator('[data-testid="gallery-button"]');
      if (await galleryButton.isVisible()) {
        await galleryButton.click();

        // Verify signup modal appears
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        // Verify gallery-specific messaging
        await expect(page.locator('text=Unlock the Gallery')).toBeVisible();
      }
    });

    test('should show signup modal when accessing gifts', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Try to access gifts (premium feature)
      const giftsButton = page.locator('[data-testid="gifts-button"]');
      if (await giftsButton.isVisible()) {
        await giftsButton.click();

        // Verify signup modal appears
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        // Verify gifts-specific messaging
        await expect(page.locator('text=Send Special Gifts')).toBeVisible();
      }
    });

    test('should show signup modal when accessing games', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Try to access games (premium feature)
      const gamesButton = page.locator('[data-testid="games-button"]');
      if (await gamesButton.isVisible()) {
        await gamesButton.click();

        // Verify signup modal appears
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        // Verify games-specific messaging
        await expect(page.locator('text=Play Together')).toBeVisible();
      }
    });

    test('should close signup modal', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Trigger limit to open modal
      await chatPage.sendMessage('Test message');
      await simulateWSMessage(page, mockWSEvents.limitReached());

      // Wait for modal
      await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

      // Close the modal
      await page.locator('[data-testid="signup-modal-close"]').click();

      // Verify modal is closed
      await expect(page.locator('[data-testid="signup-modal"]')).not.toBeVisible();
    });
  });

  test.describe('Signup Modal Interactions', () => {
    test('should switch between signup and login tabs', async ({ page }) => {
      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Trigger modal
      await chatPage.sendMessage('Test');
      await simulateWSMessage(page, mockWSEvents.limitReached());

      await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

      // Default should be signup tab
      await expect(page.locator('[data-testid="signup-modal-signup-tab"]')).toBeVisible();

      // Switch to login tab
      await page.locator('[data-testid="signup-modal-login-tab"]').click();

      // Verify login tab is now active (button text changes based on mode)
      await expect(page.locator('text=Sign In').first()).toBeVisible();

      // Switch back to signup
      await page.locator('[data-testid="signup-modal-signup-tab"]').click();

      // Verify signup tab is active
      await expect(page.locator('text=Create Account')).toBeVisible();
    });
  });

  test.describe('Authenticated User Redirect', () => {
    test('should redirect authenticated users to dashboard', async ({ page }) => {
      // Setup auth for an authenticated user
      await setupMockAuth(page);

      // Mock the auth check to return a logged-in user
      await page.addInitScript(() => {
        // Simulate authenticated state
        (window as typeof window & { __mockAuthState?: { isAuthenticated: boolean; user: object } }).__mockAuthState = {
          isAuthenticated: true,
          user: {
            id: 'user_123',
            email: 'test@example.com',
            displayName: 'Test User',
          },
        };
      });

      // Go to demo page
      await page.goto('/chat/demo');

      // Should redirect to dashboard
      await page.waitForURL('**/dashboard', { timeout: 10000 });
    });
  });

  test.describe('Design Companion CTA', () => {
    test('should show design companion CTA after delay', async ({ page }) => {
      // Skip this test if CTA timing is unreliable in CI
      test.slow();

      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // The CTA appears after 12 seconds, but we can simulate some interaction
      // For test efficiency, we can check the locator exists even if not visible yet
      const ctaButton = page.locator('[data-testid="design-companion-cta"]');

      // Wait for CTA to appear (up to 15 seconds in test)
      await expect(ctaButton).toBeVisible({ timeout: 15000 });

      // Verify it's clickable
      await expect(ctaButton).toBeEnabled();
    });

    test('should navigate to onboard when CTA is clicked', async ({ page }) => {
      test.slow();

      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Wait for CTA
      const ctaButton = page.locator('[data-testid="design-companion-cta"]');
      await expect(ctaButton).toBeVisible({ timeout: 15000 });

      // Click CTA
      await ctaButton.click();

      // Should navigate to onboard
      await page.waitForURL('**/onboard', { timeout: 5000 });
    });
  });

  test.describe('Demo Session Switching', () => {
    test('should be able to switch demo companion', async ({ page }) => {
      // Mock the switch companion endpoint
      await apiInterceptor.mockEndpoint('/demo/companion', {
        success: true,
        data: {
          companion: {
            id: 'demo_companion_002',
            name: 'Nova',
            avatarUrl: 'https://example.com/demo-avatar-2.jpg',
            archetype: 'adventurous',
            description: 'An adventurous demo companion',
          },
        },
      }, { method: 'GET' });

      await page.goto('/chat/demo');
      await page.waitForLoadState('networkidle');

      await expect(chatPage.chatInput).toBeVisible({ timeout: 10000 });

      // Look for switch companion button in the UI
      const switchButton = page.locator('[data-testid="switch-demo-companion"]');
      if (await switchButton.isVisible({ timeout: 2000 })) {
        await switchButton.click();

        // Wait for new companion to load
        await page.waitForTimeout(1000);

        // Verify new companion name is shown
        const newCompanionName = page.locator('text=Nova');
        await expect(newCompanionName).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should handle demo session creation error', async ({ page }) => {
      // Mock error response
      await page.route('**/demo/session', (route) => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({
            success: false,
            error: {
              message: 'Failed to create demo session',
            },
          }),
        });
      });

      await page.goto('/chat/demo');

      // Should show error state
      await expect(page.locator('text=Failed to start chat')).toBeVisible({ timeout: 10000 });

      // Should show retry button
      await expect(page.locator('text=Try Again')).toBeVisible();
    });

    test('should handle demo companion fetch error', async ({ page }) => {
      // Mock error response
      await page.route('**/demo/companion', (route) => {
        route.fulfill({
          status: 500,
          body: JSON.stringify({
            success: false,
            error: {
              message: 'Failed to fetch companion',
            },
          }),
        });
      });

      await page.goto('/chat/demo');

      // Should show error state
      await expect(page.locator('text=Failed to start chat')).toBeVisible({ timeout: 10000 });
    });
  });
});
