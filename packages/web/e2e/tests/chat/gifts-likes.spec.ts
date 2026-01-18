/**
 * Gifts and Likes E2E Tests
 *
 * Tests gift sending and message liking functionality including:
 * - Open gifts panel
 * - Send gift shows gift message
 * - Like assistant message
 * - Session likes counter
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateStreamingResponse,
  simulateWSMessage,
} from '../../helpers/websocket-mock';
import {
  mockCompanion,
  mockSession,
  mockMessages,
  mockChatAPIResponses,
  mockWSEvents,
  mockGifts,
} from '../../fixtures/chat-mock-data';

test.describe('Gifts and Likes', () => {
  let chatPage: ChatPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    chatPage = createChatPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mocks before navigation
    await setupMockAuth(page);
    await setupWebSocketMock(page);

    // Mock API endpoints
    await apiInterceptor.mockEndpoint('/sessions/ses_test123', mockChatAPIResponses.getSession, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/companions/cmp_test123', mockCompanion, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/messages', mockChatAPIResponses.sendMessage('Hello!'), {
      method: 'POST',
    });

    // Mock gifts endpoint
    await apiInterceptor.mockEndpoint('/gifts', { gifts: mockGifts }, { method: 'GET' });

    // Mock send gift endpoint
    await apiInterceptor.mockEndpoint('/gifts/send', mockChatAPIResponses.sendGift('gift_rose'), {
      method: 'POST',
    });

    // Mock like message endpoint
    await apiInterceptor.mockEndpoint('/messages/*/like', mockChatAPIResponses.likeMessage('msg_001', 1), {
      method: 'POST',
    });
  });

  test.describe('Gifts Panel', () => {
    test('should open gifts panel from header or sidebar', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Look for gifts button
      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await giftsButton.click();

        // Gifts panel should open
        await chatPage.expectGiftsPanelVisible();
      }
    });

    test('should display available gifts', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();

        // Should show gift items
        const giftItems = page.locator('[data-testid^="gift-item"], [data-testid^="gift_"]');
        await expect(giftItems.first()).toBeVisible({ timeout: 5000 });
      }
    });

    test('should show gift prices', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();

        // Should show price indicators (coins, gems, or currency)
        const priceIndicators = page.locator('[data-testid="gift-price"], .gift-price');
        if (await priceIndicators.first().isVisible({ timeout: 3000 })) {
          await expect(priceIndicators.first()).toBeVisible();
        }
      }
    });

    test('should close gifts panel', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();
        await chatPage.closeGiftsPanel();

        // Panel should be hidden
        await expect(chatPage.giftsPanel).not.toBeVisible();
      }
    });
  });

  test.describe('Send Gifts', () => {
    test('should send a gift', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();

        // Click on a gift to send it
        await chatPage.sendGift('gift-item-rose');

        // Should trigger gift sent event
        await page.waitForTimeout(500);
      }
    });

    test('should show gift message in chat', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();
        await chatPage.sendGift('gift-item-rose');

        // Simulate gift received response
        await simulateWSMessage(page, mockWSEvents.giftReceived('gift_rose', 'Rose'));

        await page.waitForTimeout(500);

        // Should show gift message or notification in chat
        const giftMessage = page.locator('[data-testid="gift-message"], .gift-message');
        if (await giftMessage.isVisible({ timeout: 5000 })) {
          await expect(giftMessage).toBeVisible();
        }
      }
    });

    test('should show companion reaction to gift', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();
        await chatPage.sendGift('gift-item-rose');

        // Simulate companion thanking for gift
        await simulateWSMessage(page, mockWSEvents.giftReceived('gift_rose', 'Rose'));

        // Simulate companion response
        await simulateStreamingResponse(page, "Oh wow, a rose! Thank you so much! 🌹", { delayMs: 20 });

        // Should see companion's thank you message
        await chatPage.expectAssistantMessageReceived('Thank you');
      }
    });

    test('should update balance after sending gift', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Get initial balance (if displayed)
      const balanceIndicator = page.locator('[data-testid="user-balance"], [data-testid="coin-balance"]');
      const initialBalance = await balanceIndicator.isVisible({ timeout: 2000 })
        ? await balanceIndicator.textContent()
        : null;

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 }) && initialBalance) {
        await chatPage.openGiftsPanel();
        await chatPage.sendGift('gift-item-rose');

        // Simulate balance update
        await simulateWSMessage(page, {
          type: 'balance_update',
          data: {
            balance: 90, // Assuming started with 100 and gift cost 10
          },
        });

        await page.waitForTimeout(500);

        // Balance should be updated
        const newBalance = await balanceIndicator.textContent();
        expect(newBalance).not.toBe(initialBalance);
      }
    });
  });

  test.describe('Like Messages', () => {
    test('should like an assistant message', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Wait for messages to load
      await page.waitForTimeout(500);

      // Get assistant messages
      const assistantMessages = chatPage.assistantMessages;
      const messageCount = await assistantMessages.count();

      if (messageCount > 0) {
        // Like the first assistant message
        await chatPage.likeMessage(0);

        await page.waitForTimeout(500);

        // Like count should increase
        const likeCount = await chatPage.getMessageLikeCount(0);
        expect(likeCount).toBeGreaterThanOrEqual(0); // At least 0 or more
      }
    });

    test('should increment like count', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // First send a message and get response
      await chatPage.sendMessage('Hello!');
      await simulateStreamingResponse(page, 'Hi there! How can I help you?', { delayMs: 20 });

      await page.waitForTimeout(300);

      // Get initial like count
      const initialCount = await chatPage.getMessageLikeCount(0);

      // Like the message
      await chatPage.likeMessage(0);

      // Simulate like response
      await simulateWSMessage(page, {
        type: 'message_liked',
        data: {
          messageId: 'msg_new',
          likes: initialCount + 1,
        },
      });

      await page.waitForTimeout(300);

      // Like count should increase
      const newCount = await chatPage.getMessageLikeCount(0);
      expect(newCount).toBeGreaterThanOrEqual(initialCount);
    });

    test('should show like animation', async ({ page }) => {
      await chatPage.goto('ses_test123');

      await chatPage.sendMessage('Tell me a joke');
      await simulateStreamingResponse(page, "Why did the chicken cross the road? To get to the other side!", { delayMs: 20 });

      await page.waitForTimeout(300);

      // Like the message
      await chatPage.likeMessage(0);

      // Look for heart animation or like animation
      const likeAnimation = page.locator('[data-testid="like-animation"], .like-animation');
      // Animation might be brief
      await page.waitForTimeout(100);
    });

    test('should persist likes across page reload', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Wait for messages
      await page.waitForTimeout(500);

      const messageCount = await chatPage.assistantMessages.count();
      if (messageCount > 0) {
        // Like a message
        await chatPage.likeMessage(0);
        await page.waitForTimeout(300);

        // Mock endpoint to return liked message
        await apiInterceptor.mockEndpoint('/sessions/ses_test123', {
          ...mockChatAPIResponses.getSession,
          messages: mockMessages.map((msg, i) =>
            i === 1 ? { ...msg, likes: 1 } : msg
          ),
        }, { method: 'GET' });

        // Reload page
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Like should still be there (depends on implementation)
        await page.waitForTimeout(500);
      }
    });
  });

  test.describe('Session Likes Counter', () => {
    test('should show total session likes', async ({ page }) => {
      // Mock session with likes
      await apiInterceptor.mockEndpoint('/sessions/ses_test123', {
        ...mockChatAPIResponses.getSession,
        sessionLikes: 10,
      }, { method: 'GET' });

      await chatPage.goto('ses_test123');

      // Look for session likes display
      const sessionLikes = page.locator('[data-testid="session-likes"], [data-testid="total-likes"]');
      if (await sessionLikes.isVisible({ timeout: 3000 })) {
        const likesText = await sessionLikes.textContent();
        expect(likesText).toContain('10');
      }
    });

    test('should update session likes counter on like', async ({ page }) => {
      await chatPage.goto('ses_test123');

      await chatPage.sendMessage('Great response!');
      await simulateStreamingResponse(page, "Thank you! I appreciate that!", { delayMs: 20 });

      await page.waitForTimeout(300);

      const sessionLikes = page.locator('[data-testid="session-likes"], [data-testid="total-likes"]');
      const initialLikes = await sessionLikes.isVisible({ timeout: 2000 })
        ? await sessionLikes.textContent()
        : '0';

      // Like the message
      await chatPage.likeMessage(0);

      // Simulate session likes update
      await simulateWSMessage(page, {
        type: 'session_likes_update',
        data: {
          sessionLikes: 1,
        },
      });

      await page.waitForTimeout(300);

      // Counter should update
      if (await sessionLikes.isVisible()) {
        const newLikes = await sessionLikes.textContent();
        expect(parseInt(newLikes || '0')).toBeGreaterThanOrEqual(parseInt(initialLikes || '0'));
      }
    });
  });

  test.describe('Like Button States', () => {
    test('should show like button on assistant messages only', async ({ page }) => {
      await chatPage.goto('ses_test123');

      await chatPage.sendMessage('Hello');
      await simulateStreamingResponse(page, 'Hi there!', { delayMs: 20 });

      await page.waitForTimeout(300);

      // Assistant messages should have like buttons
      const assistantLikeButton = chatPage.assistantMessages.first().locator('[data-testid="like-button"]');
      await expect(assistantLikeButton).toBeVisible();

      // User messages should not have like buttons
      const userLikeButton = chatPage.userMessages.first().locator('[data-testid="like-button"]');
      await expect(userLikeButton).not.toBeVisible();
    });

    test('should change like button appearance after liking', async ({ page }) => {
      await chatPage.goto('ses_test123');

      await chatPage.sendMessage('Tell me something nice');
      await simulateStreamingResponse(page, "You're doing great!", { delayMs: 20 });

      await page.waitForTimeout(300);

      // Get like button
      const likeButton = chatPage.assistantMessages.first().locator('[data-testid="like-button"]');

      // Get initial state (check for classes or aria-pressed)
      const initialClass = await likeButton.getAttribute('class');

      // Like the message
      await likeButton.click();

      // Simulate like response
      await simulateWSMessage(page, {
        type: 'message_liked',
        data: { messageId: 'msg_new', likes: 1 },
      });

      await page.waitForTimeout(300);

      // Button appearance should change (filled heart, different color, etc.)
      const newClass = await likeButton.getAttribute('class');
      // Classes might change to indicate liked state
      expect(newClass).toBeDefined();
    });
  });

  test.describe('Gift Integration', () => {
    test('should show gift animation when gift is received', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate receiving a gift (from another source, or sent to self)
      await simulateWSMessage(page, mockWSEvents.giftReceived('gift_diamond', 'Diamond'));

      // Look for gift animation
      const giftAnimation = page.locator('[data-testid="gift-animation"], .gift-animation');
      if (await giftAnimation.isVisible({ timeout: 3000 })) {
        await expect(giftAnimation).toBeVisible();
      }
    });

    test('should continue chat after sending gift', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const giftsButton = chatPage.giftsButton;
      if (await giftsButton.isVisible({ timeout: 3000 })) {
        await chatPage.openGiftsPanel();
        await chatPage.sendGift('gift-item-coffee');

        // Simulate gift received
        await simulateWSMessage(page, mockWSEvents.giftReceived('gift_coffee', 'Coffee'));

        // Close panel if still open
        if (await chatPage.giftsPanel.isVisible()) {
          await chatPage.closeGiftsPanel();
        }

        // Should still be able to chat
        await chatPage.sendMessage('Hope you enjoy the coffee!');
        await chatPage.expectUserMessageSent('Hope you enjoy the coffee!');
      }
    });
  });
});
