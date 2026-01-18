/**
 * WebSocket Mock Helper
 * Provides infrastructure for mocking WebSocket connections in E2E tests.
 */

import { Page } from '@playwright/test';
import { mockWSEvents, createStreamingChunks } from '../fixtures/chat-mock-data';

// Define the MockWebSocket interface for type safety
interface MockWebSocket {
  sentMessages: string[];
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: Error) => void) | null;
  send: (data: string) => void;
  close: () => void;
  simulateReceive: (data: unknown) => void;
  simulateError: (error: string) => void;
  simulateClose: () => void;
}

// Extend Window to include our mock
declare global {
  interface Window {
    __mockWebSocket: MockWebSocket | null;
    __wsMessageQueue: unknown[];
    __wsSentMessages: string[];
  }
}

/**
 * Set up WebSocket mocking for a page
 * This must be called BEFORE navigating to the page
 */
export async function setupWebSocketMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Store sent messages globally for inspection
    window.__wsSentMessages = [];
    window.__wsMessageQueue = [];
    window.__mockWebSocket = null;

    // Create a mock WebSocket class
    class MockWebSocket {
      sentMessages: string[] = [];
      readyState = 1; // OPEN

      // Event handlers
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((error: Error) => void) | null = null;

      constructor(url: string) {
        console.log('[MockWebSocket] Connection created:', url);
        window.__mockWebSocket = this;

        // Simulate connection open after a short delay
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();

          // Process any queued messages
          while (window.__wsMessageQueue.length > 0) {
            const data = window.__wsMessageQueue.shift();
            this.simulateReceive(data);
          }
        }, 50);
      }

      send(data: string) {
        console.log('[MockWebSocket] Sent:', data);
        this.sentMessages.push(data);
        window.__wsSentMessages.push(data);

        // Dispatch custom event for test inspection
        window.dispatchEvent(
          new CustomEvent('ws-sent', { detail: JSON.parse(data) })
        );
      }

      close() {
        console.log('[MockWebSocket] Closed');
        this.readyState = 3; // CLOSED
        this.onclose?.();
      }

      // Helper method to simulate receiving a message
      simulateReceive(data: unknown) {
        if (this.readyState !== 1) {
          console.log('[MockWebSocket] Queuing message (not connected yet)');
          window.__wsMessageQueue.push(data);
          return;
        }

        const event = new MessageEvent('message', {
          data: JSON.stringify(data),
        });
        this.onmessage?.(event);
      }

      // Helper method to simulate an error
      simulateError(error: string) {
        this.onerror?.(new Error(error));
      }

      // Helper method to simulate server closing connection
      simulateClose() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    // Replace global WebSocket with our mock
    (window as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });
}

/**
 * Simulate receiving a WebSocket message
 */
export async function simulateWSMessage(page: Page, data: unknown): Promise<void> {
  await page.evaluate((msgData) => {
    if (window.__mockWebSocket) {
      window.__mockWebSocket.simulateReceive(msgData);
    } else {
      // Queue the message if WebSocket isn't connected yet
      window.__wsMessageQueue.push(msgData);
    }
  }, data);
}

/**
 * Simulate a streaming response with chunked content
 */
export async function simulateStreamingResponse(
  page: Page,
  content: string,
  options: {
    delayMs?: number;
    chunkSize?: number;
    messageId?: string;
  } = {}
): Promise<void> {
  const { delayMs = 50, chunkSize = 10, messageId = `msg_${Date.now()}` } = options;

  const chunks = createStreamingChunks(content, chunkSize);
  let accumulatedContent = '';

  // Send typing start
  await simulateWSMessage(page, mockWSEvents.typingStart());

  // Send each chunk
  for (const chunk of chunks) {
    accumulatedContent += chunk;
    await simulateWSMessage(
      page,
      mockWSEvents.messageChunk(accumulatedContent, messageId)
    );
    await page.waitForTimeout(delayMs);
  }

  // Send complete message
  await simulateWSMessage(
    page,
    mockWSEvents.messageComplete(content, messageId)
  );

  // Send message end
  await simulateWSMessage(page, mockWSEvents.messageEnd());
}

/**
 * Simulate a companion joining a group chat
 */
export async function simulateCompanionJoined(
  page: Page,
  companion: { id: string; name: string; avatarUrl?: string }
): Promise<void> {
  await simulateWSMessage(page, {
    type: 'participant_joined',
    data: {
      companionId: companion.id,
      companionName: companion.name,
      avatarUrl: companion.avatarUrl || 'https://example.com/avatar.jpg',
    },
  });
}

/**
 * Simulate a companion leaving a group chat
 */
export async function simulateCompanionLeft(
  page: Page,
  companionId: string,
  companionName: string
): Promise<void> {
  await simulateWSMessage(
    page,
    mockWSEvents.participantLeft(companionId, companionName)
  );
}

/**
 * Simulate a game update
 */
export async function simulateGameUpdate(
  page: Page,
  state: {
    board: (string | null)[];
    currentPlayer: 'X' | 'O';
    winner?: 'X' | 'O' | null;
    isDraw?: boolean;
  }
): Promise<void> {
  await simulateWSMessage(page, {
    type: 'game_update',
    data: {
      gameId: 'game_001',
      ...state,
    },
  });
}

/**
 * Simulate a WebSocket error
 */
export async function simulateWSError(page: Page, errorMessage: string): Promise<void> {
  await simulateWSMessage(page, mockWSEvents.error(errorMessage));
}

/**
 * Simulate WebSocket disconnection
 */
export async function simulateWSDisconnect(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__mockWebSocket) {
      window.__mockWebSocket.simulateClose();
    }
  });
}

/**
 * Get all messages sent through WebSocket
 */
export async function getWSSentMessages(page: Page): Promise<unknown[]> {
  return await page.evaluate(() => {
    return window.__wsSentMessages.map((msg) => JSON.parse(msg));
  });
}

/**
 * Get the last sent WebSocket message
 */
export async function getLastWSSentMessage(page: Page): Promise<unknown | null> {
  return await page.evaluate(() => {
    const messages = window.__wsSentMessages;
    if (messages.length === 0) return null;
    return JSON.parse(messages[messages.length - 1]);
  });
}

/**
 * Clear sent WebSocket messages
 */
export async function clearWSSentMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__wsSentMessages = [];
  });
}

/**
 * Wait for a WebSocket message to be sent matching a predicate
 */
export async function waitForWSSentMessage(
  page: Page,
  predicate: (msg: unknown) => boolean,
  timeout = 5000
): Promise<unknown> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await getWSSentMessages(page);
    const match = messages.find(predicate);
    if (match) return match;
    await page.waitForTimeout(100);
  }

  throw new Error('Timed out waiting for WebSocket message');
}

/**
 * Simulate TTS playback indicators
 */
export async function simulateTTSPlayback(
  page: Page,
  durationMs: number = 2000
): Promise<void> {
  await simulateWSMessage(page, mockWSEvents.ttsStart());
  await page.waitForTimeout(durationMs);
  await simulateWSMessage(page, mockWSEvents.ttsEnd());
}

/**
 * Simulate live transcription updates
 */
export async function simulateLiveTranscription(
  page: Page,
  partialText: string,
  finalText: string,
  delayMs: number = 500
): Promise<void> {
  // Send partial transcription
  await simulateWSMessage(page, mockWSEvents.transcription(partialText, false));
  await page.waitForTimeout(delayMs);

  // Send final transcription
  await simulateWSMessage(page, mockWSEvents.transcription(finalText, true));
}

/**
 * Helper to create a full chat response simulation
 */
export async function simulateChatResponse(
  page: Page,
  content: string,
  options: {
    withTTS?: boolean;
    ttsDurationMs?: number;
    streamingDelayMs?: number;
  } = {}
): Promise<void> {
  const { withTTS = false, ttsDurationMs = 2000, streamingDelayMs = 30 } = options;

  // Simulate streaming response
  await simulateStreamingResponse(page, content, {
    delayMs: streamingDelayMs,
  });

  // Optionally simulate TTS
  if (withTTS) {
    await simulateTTSPlayback(page, ttsDurationMs);
  }
}
