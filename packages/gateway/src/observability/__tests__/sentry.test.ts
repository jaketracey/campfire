/**
 * Sentry Error Monitoring Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';

// Mock Sentry before importing our module
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn().mockReturnValue('event-id-123'),
  captureMessage: vi.fn().mockReturnValue('event-id-456'),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
  startSpan: vi.fn(),
  getActiveSpan: vi.fn(),
  httpIntegration: vi.fn(),
  postgresIntegration: vi.fn(),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  getRequestContext: vi.fn().mockReturnValue({
    traceId: 'trace-123',
    userId: 'user-456',
    sessionId: 'session-789',
  }),
}));

// Mock env
vi.mock('../../env.js', () => ({
  env: {
    SENTRY_DSN: undefined, // Disabled by default in tests
    NODE_ENV: 'test',
    SERVICE_VERSION: '1.0.0',
  },
}));

import {
  initSentry,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  flushSentry,
  closeSentry,
} from '../sentry.js';

describe('Sentry Error Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initSentry', () => {
    it('should not initialize when SENTRY_DSN is not set', () => {
      initSentry();

      // Sentry.init should not be called when disabled
      expect(Sentry.init).not.toHaveBeenCalled();
    });
  });

  describe('captureException', () => {
    it('should capture an exception with context', () => {
      const error = new Error('Test error');

      const eventId = captureException(error, { extra: 'context' });

      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        extra: { extra: 'context' },
        tags: {
          traceId: 'trace-123',
          userId: 'user-456',
          sessionId: 'session-789',
        },
      });
      expect(eventId).toBe('event-id-123');
    });
  });

  describe('captureMessage', () => {
    it('should capture a message with context', () => {
      const eventId = captureMessage('Test message', 'warning', { extra: 'data' });

      expect(Sentry.captureMessage).toHaveBeenCalledWith('Test message', {
        level: 'warning',
        extra: { extra: 'data' },
        tags: {
          traceId: 'trace-123',
          userId: 'user-456',
          sessionId: 'session-789',
        },
      });
      expect(eventId).toBe('event-id-456');
    });
  });

  describe('setUser', () => {
    it('should set user context', () => {
      setUser({ id: 'user-123', email: 'test@example.com' });

      expect(Sentry.setUser).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@example.com',
      });
    });
  });

  describe('clearUser', () => {
    it('should clear user context', () => {
      clearUser();

      expect(Sentry.setUser).toHaveBeenCalledWith(null);
    });
  });

  describe('addBreadcrumb', () => {
    it('should add a breadcrumb', () => {
      addBreadcrumb('User clicked button', 'ui', { button: 'submit' }, 'info');

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        message: 'User clicked button',
        category: 'ui',
        data: { button: 'submit' },
        level: 'info',
        timestamp: expect.any(Number),
      });
    });
  });

  describe('flushSentry', () => {
    it('should flush pending events', async () => {
      const result = await flushSentry(2000);

      expect(Sentry.flush).toHaveBeenCalledWith(2000);
      expect(result).toBe(true);
    });
  });

  describe('closeSentry', () => {
    it('should close Sentry SDK', async () => {
      await closeSentry();

      expect(Sentry.close).toHaveBeenCalled();
    });
  });
});
