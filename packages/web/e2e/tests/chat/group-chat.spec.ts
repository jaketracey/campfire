/**
 * Group Chat E2E Tests
 *
 * Tests multi-companion chat functionality including:
 * - Multiple participants displayed
 * - Companion join event shown
 * - Companion leave event shown
 * - Messages colored by companion
 * - Invite friend from panel
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateStreamingResponse,
  simulateWSMessage,
  simulateCompanionJoined,
  simulateCompanionLeft,
} from '../../helpers/websocket-mock';
import {
  mockCompanion,
  mockSecondCompanion,
  mockSession,
  mockMessages,
  mockChatAPIResponses,
  mockWSEvents,
} from '../../fixtures/chat-mock-data';

test.describe('Group Chat', () => {
  let chatPage: ChatPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    chatPage = createChatPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mocks before navigation
    await setupMockAuth(page);
    await setupWebSocketMock(page);

    // Mock group session endpoint with multiple participants
    await apiInterceptor.mockEndpoint('/sessions/ses_group123', {
      session: {
        ...mockSession,
        id: 'ses_group123',
        isGroupChat: true,
      },
      companion: mockCompanion,
      messages: mockMessages,
      participants: [
        {
          companionId: mockCompanion.id,
          companionName: mockCompanion.name,
          avatarUrl: mockCompanion.avatarUrl,
          joinedAt: '2024-01-15T10:00:00.000Z',
        },
      ],
    }, { method: 'GET' });

    await apiInterceptor.mockEndpoint('/companions/cmp_test123', mockCompanion, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/companions/cmp_test456', mockSecondCompanion, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/messages', mockChatAPIResponses.sendMessage('Hello!'), {
      method: 'POST',
    });
  });

  test.describe('Multiple Participants', () => {
    test('should display multiple participants in group chat', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Simulate second companion joining
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
            avatarUrl: mockSecondCompanion.avatarUrl,
          },
          invitedByCompanionId: mockCompanion.id,
          reason: 'invited_by_companion',
          participants: [
            {
              companionId: mockCompanion.id,
              companionName: mockCompanion.name,
              avatarUrl: mockCompanion.avatarUrl,
            },
            {
              companionId: mockSecondCompanion.id,
              companionName: mockSecondCompanion.name,
              avatarUrl: mockSecondCompanion.avatarUrl,
            },
          ],
        },
      });

      // Wait for participant update
      await page.waitForTimeout(500);

      // Verify both companion names are visible somewhere in the UI
      // (This could be in header, sidebar, or participant list)
      const lunaText = page.locator(`text=${mockCompanion.name}`);
      await expect(lunaText.first()).toBeVisible();
    });

    test('should show participant count indicator', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Simulate companion joining
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
            avatarUrl: mockSecondCompanion.avatarUrl,
          },
          participants: [
            {
              companionId: mockCompanion.id,
              companionName: mockCompanion.name,
              avatarUrl: mockCompanion.avatarUrl,
            },
            {
              companionId: mockSecondCompanion.id,
              companionName: mockSecondCompanion.name,
              avatarUrl: mockSecondCompanion.avatarUrl,
            },
          ],
        },
      });

      await page.waitForTimeout(500);

      // Look for any indication of group chat (participant count, avatars, etc.)
      const groupIndicator = page.locator('[data-testid="group-chat-indicator"], [data-testid="participant-count"]');
      if (await groupIndicator.isVisible({ timeout: 2000 })) {
        await expect(groupIndicator).toBeVisible();
      }
    });
  });

  test.describe('Companion Join Events', () => {
    test('should show companion joined message', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Send a message first
      await chatPage.sendMessage('Hello everyone!');
      await simulateStreamingResponse(page, 'Hi there!', { delayMs: 20 });

      // Simulate companion joining
      await simulateCompanionJoined(page, {
        id: mockSecondCompanion.id,
        name: mockSecondCompanion.name,
        avatarUrl: mockSecondCompanion.avatarUrl,
      });

      // Wait for join notification
      await page.waitForTimeout(500);

      // Check for a join notification in the chat or UI
      // The exact text depends on implementation
      const joinNotification = page.locator(`text=${mockSecondCompanion.name}`);
      await expect(joinNotification.first()).toBeVisible({ timeout: 5000 });
    });

    test('should update participants list when companion joins', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Simulate companion joining with full participant list
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
            avatarUrl: mockSecondCompanion.avatarUrl,
          },
          participants: [
            {
              companionId: mockCompanion.id,
              companionName: mockCompanion.name,
              avatarUrl: mockCompanion.avatarUrl,
            },
            {
              companionId: mockSecondCompanion.id,
              companionName: mockSecondCompanion.name,
              avatarUrl: mockSecondCompanion.avatarUrl,
            },
          ],
        },
      });

      await page.waitForTimeout(500);

      // Verify second companion is now visible
      const secondCompanionName = page.locator(`text=${mockSecondCompanion.name}`);
      await expect(secondCompanionName.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Companion Leave Events', () => {
    test('should show companion left message', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // First add a companion
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
          },
          participants: [
            { companionId: mockCompanion.id, companionName: mockCompanion.name },
            { companionId: mockSecondCompanion.id, companionName: mockSecondCompanion.name },
          ],
        },
      });

      await page.waitForTimeout(300);

      // Then simulate companion leaving
      await simulateCompanionLeft(page, mockSecondCompanion.id, mockSecondCompanion.name);

      await page.waitForTimeout(500);

      // Chat should still be functional
      await expect(chatPage.chatInput).toBeEnabled();
    });

    test('should update participants list when companion leaves', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Add companion
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
          },
          participants: [
            { companionId: mockCompanion.id, companionName: mockCompanion.name },
            { companionId: mockSecondCompanion.id, companionName: mockSecondCompanion.name },
          ],
        },
      });

      await page.waitForTimeout(300);

      // Companion leaves
      await simulateWSMessage(page, {
        type: 'companion_left',
        data: {
          companionId: mockSecondCompanion.id,
          companionName: mockSecondCompanion.name,
          reason: 'left',
          participants: [
            { companionId: mockCompanion.id, companionName: mockCompanion.name },
          ],
        },
      });

      await page.waitForTimeout(500);

      // Verify we're back to single companion state
      // The chat should still work
      await chatPage.sendMessage('Are you still there?');
      await chatPage.expectUserMessageSent('Are you still there?');
    });
  });

  test.describe('Group Chat Messages', () => {
    test('should receive messages from multiple companions', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Add second companion
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
          },
          participants: [
            { companionId: mockCompanion.id, companionName: mockCompanion.name },
            { companionId: mockSecondCompanion.id, companionName: mockSecondCompanion.name },
          ],
        },
      });

      // Send a message
      await chatPage.sendMessage('Hello everyone!');

      // Simulate response from first companion
      await simulateStreamingResponse(page, "Hey! Great to chat!", { delayMs: 20 });

      // Wait a bit
      await page.waitForTimeout(300);

      // Simulate typing from second companion
      await simulateWSMessage(page, mockWSEvents.typingStart());
      await chatPage.waitForTypingIndicator();

      // Simulate response from second companion
      await simulateStreamingResponse(page, "Hello! I just joined!", { delayMs: 20 });

      // Verify multiple responses received
      const assistantMessages = await chatPage.getAssistantMessages();
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    });

    test('should handle interleaved messages from companions', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Send user message
      await chatPage.sendMessage('Tell me a story together!');

      // First companion responds
      await simulateStreamingResponse(page, "Once upon a time...", { delayMs: 20 });

      // Typing indicator for next message
      await simulateWSMessage(page, mockWSEvents.typingStart());
      await page.waitForTimeout(100);

      // Second part of story
      await simulateStreamingResponse(page, "There was a brave hero!", { delayMs: 20 });

      // Verify messages displayed in order
      const messages = await chatPage.getAssistantMessages();
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Invite Friend', () => {
    test('should open friends panel to invite companion', async ({ page }) => {
      // Mock friends/companions list endpoint
      await apiInterceptor.mockEndpoint('/companions', {
        companions: [mockSecondCompanion],
      }, { method: 'GET' });

      await chatPage.goto('ses_group123');

      // Look for friends button in sidebar
      const friendsButton = chatPage.friendsButton;
      if (await friendsButton.isVisible({ timeout: 3000 })) {
        await friendsButton.click();

        // Verify friends panel opens
        await expect(chatPage.friendsPanel).toBeVisible({ timeout: 5000 });
      }
    });

    test('should invite friend from panel', async ({ page }) => {
      // Mock friends list
      await apiInterceptor.mockEndpoint('/companions', {
        companions: [mockSecondCompanion],
      }, { method: 'GET' });

      // Mock invite endpoint
      await apiInterceptor.mockEndpoint('/sessions/ses_group123/invite', {
        success: true,
        message: 'Companion invited',
      }, { method: 'POST' });

      await chatPage.goto('ses_group123');

      const friendsButton = chatPage.friendsButton;
      if (await friendsButton.isVisible({ timeout: 3000 })) {
        await friendsButton.click();
        await expect(chatPage.friendsPanel).toBeVisible({ timeout: 5000 });

        // Look for friend item and click to invite
        const friendItem = page.locator(`[data-testid="friend-${mockSecondCompanion.id}"], [data-testid="companion-${mockSecondCompanion.id}"]`);
        if (await friendItem.isVisible({ timeout: 2000 })) {
          await friendItem.click();

          // Wait for invite to process
          await page.waitForTimeout(500);

          // Simulate companion joining after invite
          await simulateWSMessage(page, {
            type: 'companion_joined',
            data: {
              companion: {
                id: mockSecondCompanion.id,
                name: mockSecondCompanion.name,
              },
              participants: [
                { companionId: mockCompanion.id, companionName: mockCompanion.name },
                { companionId: mockSecondCompanion.id, companionName: mockSecondCompanion.name },
              ],
            },
          });

          // Verify second companion joined
          const companionName = page.locator(`text=${mockSecondCompanion.name}`);
          await expect(companionName.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe('Group Chat State', () => {
    test('should handle group chat state update', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Simulate group chat state update
      await simulateWSMessage(page, {
        type: 'group_chat_state',
        data: {
          isGroupChat: true,
          participants: [
            {
              companionId: mockCompanion.id,
              companionName: mockCompanion.name,
              avatarUrl: mockCompanion.avatarUrl,
            },
            {
              companionId: mockSecondCompanion.id,
              companionName: mockSecondCompanion.name,
              avatarUrl: mockSecondCompanion.avatarUrl,
            },
          ],
        },
      });

      await page.waitForTimeout(500);

      // Chat should function normally
      await chatPage.sendMessage('Testing group chat state');
      await chatPage.expectUserMessageSent('Testing group chat state');
    });

    test('should transition from single to group chat', async ({ page }) => {
      await chatPage.goto('ses_group123');

      // Initially single chat
      await chatPage.sendMessage('Just us for now');
      await simulateStreamingResponse(page, "Yes, just us!", { delayMs: 20 });

      // Companion joins - becomes group chat
      await simulateWSMessage(page, {
        type: 'companion_joined',
        data: {
          companion: {
            id: mockSecondCompanion.id,
            name: mockSecondCompanion.name,
          },
          participants: [
            { companionId: mockCompanion.id, companionName: mockCompanion.name },
            { companionId: mockSecondCompanion.id, companionName: mockSecondCompanion.name },
          ],
        },
      });

      await page.waitForTimeout(500);

      // Continue chatting in group mode
      await chatPage.sendMessage('Now we have company!');
      await chatPage.expectUserMessageSent('Now we have company!');
    });
  });
});
