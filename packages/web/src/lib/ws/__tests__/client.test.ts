/**
 * WebSocket Client Tests
 * Focus on stability, memory leaks, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CampfireWebSocket } from '../client';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      const event = new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' });
      this.onclose?.(event);
    }, 10);
  }

  // Helper to simulate server message
  simulateMessage(data: unknown) {
    if (this.readyState !== MockWebSocket.OPEN) return;
    const event = new MessageEvent('message', {
      data: JSON.stringify(data),
    });
    this.onmessage?.(event);
  }
}

// Setup global WebSocket mock
global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

describe('CampfireWebSocket - Memory Leak Prevention', () => {
  let ws: CampfireWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    ws = new CampfireWebSocket();
  });

  afterEach(() => {
    ws.disconnect();
    vi.useRealTimers();
  });

  describe('Event Handler Cleanup', () => {
    it('should remove empty handler sets from map when all handlers unsubscribed', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Subscribe 3 handlers to the same event
      const unsub1 = ws.on('auth_success', () => {});
      const unsub2 = ws.on('auth_success', () => {});
      const unsub3 = ws.on('auth_success', () => {});

      // Verify handlers were added
      const handlersBefore = (ws as any).handlers.get('auth_success');
      expect(handlersBefore).toBeDefined();
      expect(handlersBefore.size).toBe(3);

      // Unsubscribe all
      unsub1();
      unsub2();
      unsub3();

      // Empty set should be removed from map
      const handlersAfter = (ws as any).handlers.get('auth_success');
      expect(handlersAfter).toBeUndefined();
    });

    it('should not accumulate empty sets over multiple subscribe/unsubscribe cycles', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Run 100 cycles of subscribe/unsubscribe across different event types
      const eventTypes = ['auth_success', 'session_started', 'agent_message', 'error'] as const;

      for (let i = 0; i < 100; i++) {
        const unsubs = eventTypes.map(type => ws.on(type, () => {}));
        unsubs.forEach(unsub => unsub());
      }

      // Handlers map should be empty or minimal
      const handlersMap = (ws as any).handlers;
      expect(handlersMap.size).toBeLessThan(5); // Allow for some overhead
    });

    it('should warn when handler limit exceeded', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Add 101 handlers (limit is 100)
      const unsubs = [];
      for (let i = 0; i < 101; i++) {
        unsubs.push(ws.on('auth_success', () => {}));
      }

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Too many event handlers')
      );

      unsubs.forEach(unsub => unsub());
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Reconnection Timer Cleanup', () => {
    it('should reconnect on normal close when not manually disconnected', async () => {
      const onOpenSpy = vi.fn();
      ws = new CampfireWebSocket({ onOpen: onOpenSpy });
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      expect(onOpenSpy).toHaveBeenCalledTimes(1);

      const firstWs = (ws as any).ws as MockWebSocket;
      firstWs.close(1000, 'Connection timeout');
      await vi.advanceTimersByTimeAsync(3200);

      const secondWs = (ws as any).ws as MockWebSocket;
      expect(secondWs).not.toBe(firstWs);
      expect(onOpenSpy).toHaveBeenCalledTimes(2);
    });

    it('should not create multiple reconnection timers', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Simulate connection failure 3 times rapidly
      const mockWs = (ws as any).ws as MockWebSocket;
      mockWs.close(1006, 'Connection failed');
      await vi.advanceTimersByTimeAsync(100);

      mockWs.close(1006, 'Connection failed');
      await vi.advanceTimersByTimeAsync(100);

      mockWs.close(1006, 'Connection failed');
      await vi.advanceTimersByTimeAsync(100);

      // Should only have one reconnection timer
      const reconnectTimeout = (ws as any).reconnectTimeout;
      expect(reconnectTimeout).toBeDefined();

      // Count pending timers (implementation-specific check)
      const timerCount = vi.getTimerCount();
      expect(timerCount).toBeLessThanOrEqual(1);
    });

    it('should clear reconnection timer on disconnect', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      // Trigger reconnection
      const mockWs = (ws as any).ws as MockWebSocket;
      mockWs.close(1006, 'Connection failed');
      await vi.advanceTimersByTimeAsync(100);

      // Disconnect before reconnection fires
      ws.disconnect();

      const reconnectTimeout = (ws as any).reconnectTimeout;
      expect(reconnectTimeout).toBeNull();
    });

    it('should not reconnect after explicit disconnect', async () => {
      const onOpenSpy = vi.fn();
      ws = new CampfireWebSocket({ onOpen: onOpenSpy });
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      expect(onOpenSpy).toHaveBeenCalledTimes(1);

      // Explicit disconnect
      ws.disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      // Should not have reconnected
      expect(onOpenSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebSocket Instance Lifecycle', () => {
    it('should not create multiple WebSocket instances when connect() called rapidly', async () => {
      const instances: MockWebSocket[] = [];
      const originalWS = global.WebSocket;

      global.WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          instances.push(this);
        }
      } as unknown as typeof WebSocket;

      // Call connect 5 times rapidly
      ws.connect();
      ws.connect();
      ws.connect();
      ws.connect();
      ws.connect();

      await vi.advanceTimersByTimeAsync(20);

      // Should only create 1 WebSocket instance
      expect(instances.length).toBe(1);

      global.WebSocket = originalWS;
    });

    it('should clean up old WebSocket before creating new one on reconnect', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const firstWs = (ws as any).ws as MockWebSocket;
      expect(firstWs).toBeDefined();

      // Force reconnection
      firstWs.close(1006, 'Connection lost');
      await vi.advanceTimersByTimeAsync(3100); // Wait for reconnect delay

      const secondWs = (ws as any).ws as MockWebSocket;
      expect(secondWs).toBeDefined();
      expect(secondWs).not.toBe(firstWs);
      expect(firstWs.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe('Error Handler Robustness', () => {
    it('should not crash when handler throws error', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add handler that throws
      ws.on('auth_success', () => {
        throw new Error('Handler error');
      });

      // Add another handler that should still run
      const workingHandler = vi.fn();
      ws.on('auth_success', workingHandler);

      // Simulate message
      const mockWs = (ws as any).ws as MockWebSocket;
      mockWs.simulateMessage({
        type: 'auth_success',
        id: '1',
        timestamp: new Date().toISOString(),
        payload: {},
      });

      // Working handler should still have been called
      expect(workingHandler).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Handler error'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should continue processing after wildcard handler error', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add wildcard handler that throws
      ws.on('*', () => {
        throw new Error('Wildcard error');
      });

      // Add specific handler
      const specificHandler = vi.fn();
      ws.on('auth_success', specificHandler);

      // Simulate message
      const mockWs = (ws as any).ws as MockWebSocket;
      mockWs.simulateMessage({
        type: 'auth_success',
        id: '1',
        timestamp: new Date().toISOString(),
        payload: {},
      });

      // Specific handler should still run despite wildcard error
      expect(specificHandler).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Message Handling Edge Cases', () => {
    it('should handle malformed JSON without crashing', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockWs = (ws as any).ws as MockWebSocket;

      // Send malformed JSON
      const event = new MessageEvent('message', { data: '{invalid json}' });
      mockWs.onmessage?.(event);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse message'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle ping/pong without memory leaks', async () => {
      ws.connect();
      await vi.advanceTimersByTimeAsync(20);

      const mockWs = (ws as any).ws as MockWebSocket;

      // Send 100 pings
      for (let i = 0; i < 100; i++) {
        mockWs.simulateMessage({
          type: 'ping',
          id: `ping-${i}`,
          timestamp: new Date().toISOString(),
          payload: {},
        });
      }

      // Should have sent 100 pongs
      const sentPongs = mockWs.sentMessages.filter(msg => {
        const parsed = JSON.parse(msg);
        return parsed.type === 'pong';
      });
      expect(sentPongs.length).toBe(100);

      // Handlers map should not have accumulated ping handlers
      const handlersMap = (ws as any).handlers;
      expect(handlersMap.size).toBeLessThan(5);
    });
  });
});

describe('CampfireWebSocket - State Management', () => {
  let ws: CampfireWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    ws = new CampfireWebSocket();
  });

  afterEach(() => {
    ws.disconnect();
    vi.useRealTimers();
  });

  it('should reset all state on disconnect', async () => {
    ws.connect();
    await vi.advanceTimersByTimeAsync(20);

    // Set up state
    const mockWs = (ws as any).ws as MockWebSocket;
    mockWs.simulateMessage({
      type: 'auth_success',
      id: '1',
      timestamp: new Date().toISOString(),
      payload: {},
    });

    mockWs.simulateMessage({
      type: 'session_started',
      id: '2',
      timestamp: new Date().toISOString(),
      payload: { sessionId: 'test-session', isGroupChat: true, participants: [] },
    });

    expect(ws.isAuthenticated).toBe(true);
    expect(ws.sessionId).toBe('test-session');
    expect(ws.isGroupChat).toBe(true);

    // Disconnect
    ws.disconnect();

    // All state should be reset
    expect(ws.isConnected).toBe(false);
    expect(ws.isAuthenticated).toBe(false);
    expect(ws.sessionId).toBeNull();
    expect(ws.isGroupChat).toBe(false);
    expect(ws.groupParticipants).toEqual([]);
  });

  it('should handle group chat participant updates atomically', async () => {
    ws.connect();
    await vi.advanceTimersByTimeAsync(20);

    const mockWs = (ws as any).ws as MockWebSocket;

    // Start session
    mockWs.simulateMessage({
      type: 'session_started',
      id: '1',
      timestamp: new Date().toISOString(),
      payload: {
        sessionId: 'test',
        isGroupChat: false,
        participants: [
          { companionId: 'c1', companionName: 'C1', role: 'primary', avatarUrl: null, themeColor: '#fff', joinedAt: new Date().toISOString() }
        ],
      },
    });

    expect(ws.isGroupChat).toBe(false);
    expect(ws.groupParticipants.length).toBe(1);

    // Add participant
    mockWs.simulateMessage({
      type: 'companion_joined',
      id: '2',
      timestamp: new Date().toISOString(),
      payload: {
        companion: { companionId: 'c2', companionName: 'C2', role: 'invited', avatarUrl: null, themeColor: '#fff', joinedAt: new Date().toISOString() },
        invitedByCompanionId: 'c1',
        reason: 'test',
        participants: [
          { companionId: 'c1', companionName: 'C1', role: 'primary', avatarUrl: null, themeColor: '#fff', joinedAt: new Date().toISOString() },
          { companionId: 'c2', companionName: 'C2', role: 'invited', avatarUrl: null, themeColor: '#fff', joinedAt: new Date().toISOString() },
        ],
      },
    });

    // State should be consistent
    expect(ws.isGroupChat).toBe(true);
    expect(ws.groupParticipants.length).toBe(2);
    expect(ws.getParticipant('c2')).toBeDefined();
  });
});
