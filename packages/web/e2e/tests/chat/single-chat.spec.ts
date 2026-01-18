/**
 * Single Companion Chat E2E Tests
 *
 * Tests basic 1:1 chat functionality including:
 * - Send message and receive streaming response
 * - Typing indicator
 * - Multi-message responses
 * - Input disabled while loading
 * - WebSocket error handling
 * - Message history display
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateStreamingResponse,
  simulateWSMessage,
  simulateWSError,
  getWSSentMessages,
} from '../../helpers/websocket-mock';
import {
  mockCompanion,
  mockSession,
  mockMessages,
  mockChatAPIResponses,
  mockWSEvents,
} from '../../fixtures/chat-mock-data';

test.describe('Single Companion Chat', () => {
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
  });

  test.describe('Send and Receive Messages', () => {
    test('should send message and receive streaming response', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Hello Luna!');

      // Verify user message was sent
      await chatPage.expectUserMessageSent('Hello Luna!');

      // Simulate streaming response from companion
      await simulateStreamingResponse(
        page,
        "Hi there! I'm so happy to chat with you today!",
        { delayMs: 20 }
      );

      // Verify assistant message was received
      await chatPage.expectAssistantMessageReceived("Hi there! I'm so happy to chat with you today!");
    });

    test('should show typing indicator during response', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Tell me about your art');

      // Simulate typing start
      await simulateWSMessage(page, mockWSEvents.typingStart());

      // Verify typing indicator appears
      await chatPage.waitForTypingIndicator();

      // Simulate response completion
      await simulateStreamingResponse(page, "I love creating digital art!", { delayMs: 20 });

      // Typing indicator should disappear
      await chatPage.waitForTypingIndicatorGone();
    });

    test('should handle multi-message responses', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Tell me a story');

      // Simulate first message
      await simulateStreamingResponse(page, "Once upon a time...", { delayMs: 20 });

      // Simulate second message (typing indicator between messages)
      await simulateWSMessage(page, mockWSEvents.typingStart());
      await chatPage.waitForTypingIndicator();

      await simulateStreamingResponse(page, "There was a brave adventurer.", { delayMs: 20 });

      // Verify both messages are displayed
      const assistantMessages = await chatPage.getAssistantMessages();
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Input State', () => {
    test('should disable input while loading', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Hello!');

      // Input should become disabled/readonly during loading
      const isDisabled = await chatPage.isInputDisabled();
      expect(isDisabled).toBe(true);

      // Complete the response
      await simulateStreamingResponse(page, "Hello!", { delayMs: 20 });

      // Input should be enabled again
      await page.waitForTimeout(100); // Wait for state update
    });
  });

  test.describe('WebSocket Error Handling', () => {
    test('should handle WebSocket errors gracefully', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Hello!');

      // Simulate WebSocket error
      await simulateWSError(page, 'Connection lost');

      // Page should remain functional (not crash)
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Message History', () => {
    test('should display existing message history', async ({ page }) => {
      // Mock session with messages
      await apiInterceptor.mockEndpoint('/sessions/ses_test123', mockChatAPIResponses.getSession, {
        method: 'GET',
      });

      await chatPage.goto('ses_test123');

      // Wait for messages to load
      await page.waitForTimeout(500);

      // Verify message count (from mock data)
      const messageCount = await chatPage.getMessageCount();
      expect(messageCount).toBeGreaterThan(0);
    });

    test('should show empty state when no messages', async ({ page }) => {
      // Mock session with no messages
      await apiInterceptor.mockEndpoint(
        '/sessions/ses_test123',
        {
          session: mockSession,
          companion: mockCompanion,
          messages: [],
        },
        { method: 'GET' }
      );

      await chatPage.goto('ses_test123');

      // Verify empty state is shown
      await chatPage.expectEmptyState();
    });
  });

  test.describe('Message Sending', () => {
    test('should send message via WebSocket', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Clear any initial messages
      await page.waitForTimeout(500);

      // Send a message
      await chatPage.sendMessage('Test message');

      // Verify message was sent via WebSocket
      const sentMessages = await getWSSentMessages(page);
      const chatMessage = sentMessages.find(
        (msg: unknown) =>
          typeof msg === 'object' &&
          msg !== null &&
          'type' in msg &&
          (msg as { type: string }).type === 'message'
      );

      expect(chatMessage).toBeDefined();
    });

    test('should not send empty messages', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Try to send empty message
      await chatPage.chatInput.fill('');

      // Send button should be disabled
      await expect(chatPage.sendButton).toBeDisabled();
    });

    test('should clear input after sending', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Hello!');

      // Input should be cleared
      const inputValue = await chatPage.getInputValue();
      expect(inputValue).toBe('');
    });
  });
});
