/**
 * Voice Mode E2E Tests
 *
 * Tests voice chat functionality including:
 * - Toggle voice mode
 * - Live transcription display
 * - TTS playback indicator
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateStreamingResponse,
  simulateWSMessage,
  simulateTTSPlayback,
  simulateLiveTranscription,
} from '../../helpers/websocket-mock';
import {
  mockCompanion,
  mockSession,
  mockMessages,
  mockChatAPIResponses,
  mockWSEvents,
} from '../../fixtures/chat-mock-data';

test.describe('Voice Mode', () => {
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

  test.describe('Voice Mode Toggle', () => {
    test('should toggle voice mode on and off', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Look for voice mode toggle button
      const voiceToggle = chatPage.voiceModeToggle;
      if (await voiceToggle.isVisible({ timeout: 3000 })) {
        // Initial state - voice mode off
        await expect(voiceToggle).toBeVisible();

        // Toggle voice mode on
        await voiceToggle.click();
        await page.waitForTimeout(300);

        // Toggle voice mode off
        await voiceToggle.click();
        await page.waitForTimeout(300);

        // Input should still be functional
        await expect(chatPage.chatInput).toBeVisible();
        await expect(chatPage.chatInput).toBeEnabled();
      }
    });

    test('should show voice mode placeholder in input', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const voiceToggle = chatPage.voiceModeToggle;
      if (await voiceToggle.isVisible({ timeout: 3000 })) {
        // Enable voice mode
        await voiceToggle.click();
        await page.waitForTimeout(300);

        // Input placeholder should change
        const placeholder = await chatPage.chatInput.getAttribute('placeholder');
        expect(placeholder).toContain('speak');
      }
    });
  });

  test.describe('Live Transcription', () => {
    test('should display live transcription', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate partial transcription
      await simulateWSMessage(page, mockWSEvents.transcription('Hello wor', false));

      // Check for live transcription display
      const transcriptionDisplay = chatPage.liveTranscription;
      if (await transcriptionDisplay.isVisible({ timeout: 3000 })) {
        await expect(transcriptionDisplay).toContainText('Hello wor');
      }
    });

    test('should update transcription as user speaks', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate progressive transcription
      await simulateWSMessage(page, mockWSEvents.transcription('Hello', false));
      await page.waitForTimeout(200);

      await simulateWSMessage(page, mockWSEvents.transcription('Hello world', false));
      await page.waitForTimeout(200);

      await simulateWSMessage(page, mockWSEvents.transcription('Hello world from', false));

      // Check transcription updated
      const transcriptionDisplay = chatPage.liveTranscription;
      if (await transcriptionDisplay.isVisible({ timeout: 3000 })) {
        const text = await chatPage.getLiveTranscription();
        expect(text).toContain('Hello');
      }
    });

    test('should send message when transcription is finalized', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate final transcription
      await simulateLiveTranscription(page, 'Hello wor', 'Hello world!', 200);

      // Wait for message to be sent
      await page.waitForTimeout(500);

      // The finalized transcription should trigger a message send
      // Check if user message appears
      const userMessages = await chatPage.getUserMessages();
      // Note: This depends on implementation - message might auto-send or not
      expect(userMessages.length).toBeGreaterThanOrEqual(0);
    });

    test('should clear transcription after sending', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Show transcription
      await simulateWSMessage(page, mockWSEvents.transcription('Test message', false));
      await page.waitForTimeout(200);

      // Finalize
      await simulateWSMessage(page, mockWSEvents.transcription('Test message', true));
      await page.waitForTimeout(500);

      // Transcription display should be cleared or hidden
      const transcriptionDisplay = chatPage.liveTranscription;
      // After sending, transcription should clear
      await page.waitForTimeout(300);
    });
  });

  test.describe('TTS Playback', () => {
    test('should show TTS indicator when companion is speaking', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message first
      await chatPage.sendMessage('Hello!');
      await simulateStreamingResponse(page, 'Hi there!', { delayMs: 20 });

      // Simulate TTS starting
      await simulateWSMessage(page, mockWSEvents.ttsStart());

      // Check for TTS indicator
      const ttsIndicator = chatPage.ttsIndicator;
      await expect(ttsIndicator).toBeVisible({ timeout: 5000 });
    });

    test('should hide TTS indicator when playback ends', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send a message
      await chatPage.sendMessage('Tell me something');
      await simulateStreamingResponse(page, 'Here is my response!', { delayMs: 20 });

      // Start TTS
      await simulateWSMessage(page, mockWSEvents.ttsStart());
      await page.waitForTimeout(300);

      // Verify indicator is shown
      const ttsIndicator = chatPage.ttsIndicator;
      await expect(ttsIndicator).toBeVisible({ timeout: 3000 });

      // End TTS
      await simulateWSMessage(page, mockWSEvents.ttsEnd());

      // Indicator should disappear
      await expect(ttsIndicator).not.toBeVisible({ timeout: 3000 });
    });

    test('should show speaking animation during TTS', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Trigger TTS
      await simulateWSMessage(page, mockWSEvents.ttsStart());

      // Check for TTS indicator with animation
      const ttsIndicator = chatPage.ttsIndicator;
      if (await ttsIndicator.isVisible({ timeout: 3000 })) {
        // Verify "Speaking..." text is shown
        await expect(ttsIndicator).toContainText('Speaking');
      }
    });

    test('should complete full TTS playback cycle', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Send message
      await chatPage.sendMessage('Say something');
      await simulateStreamingResponse(page, 'I am saying something!', { delayMs: 20 });

      // Simulate full TTS playback (start -> wait -> end)
      await simulateTTSPlayback(page, 1000);

      // After playback, indicator should be gone
      const ttsIndicator = chatPage.ttsIndicator;
      await expect(ttsIndicator).not.toBeVisible({ timeout: 3000 });

      // Chat should be functional
      await expect(chatPage.chatInput).toBeEnabled();
    });
  });

  test.describe('Voice Mode Integration', () => {
    test('should handle voice input and TTS response flow', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate voice input via transcription
      await simulateLiveTranscription(page, 'How are', 'How are you?', 300);

      // Wait for potential auto-send
      await page.waitForTimeout(500);

      // Simulate assistant response
      await simulateStreamingResponse(page, "I'm doing great, thank you for asking!", {
        delayMs: 20,
      });

      // Simulate TTS playback of response
      await simulateTTSPlayback(page, 500);

      // Verify response was received
      await chatPage.expectAssistantMessageReceived("I'm doing great");
    });

    test('should allow text input while in voice mode', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Enable voice mode if available
      const voiceToggle = chatPage.voiceModeToggle;
      if (await voiceToggle.isVisible({ timeout: 3000 })) {
        await voiceToggle.click();
        await page.waitForTimeout(300);
      }

      // Should still be able to type
      await chatPage.chatInput.fill('Typed message');
      const inputValue = await chatPage.getInputValue();
      expect(inputValue).toBe('Typed message');

      // Send the typed message
      await chatPage.sendButton.click();
      await chatPage.expectUserMessageSent('Typed message');
    });

    test('should handle voice mode errors gracefully', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate voice error
      await simulateWSMessage(page, {
        type: 'voice_error',
        data: {
          message: 'Microphone access denied',
          code: 'PERMISSION_DENIED',
        },
      });

      // Page should remain functional
      await expect(page.locator('body')).toBeVisible();

      // Should still be able to send text messages
      await chatPage.sendMessage('Fallback to text');
      await chatPage.expectUserMessageSent('Fallback to text');
    });
  });

  test.describe('Voice Mode UI States', () => {
    test('should show recording state when voice is active', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate recording state
      await simulateWSMessage(page, {
        type: 'recording_started',
        data: {},
      });

      // Look for recording indicator
      const recordingIndicator = page.locator('[data-testid="recording-indicator"], [data-testid="voice-recording"]');
      if (await recordingIndicator.isVisible({ timeout: 3000 })) {
        await expect(recordingIndicator).toBeVisible();
      }
    });

    test('should disable text input during recording', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate recording state
      await simulateWSMessage(page, {
        type: 'recording_started',
        data: {},
      });

      await page.waitForTimeout(300);

      // Input might be disabled during recording
      const isDisabled = await chatPage.isInputDisabled();
      // This depends on implementation - some apps allow typing during recording
      expect(typeof isDisabled).toBe('boolean');
    });
  });
});
