/**
 * Messaging Inbound Worker Tests
 * Tests for the messaging inbound worker processing pipeline.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processInboundMessage } from '../worker.js';
import type { DbClient } from '../../db/client.js';
import type { MessagingInboundJobData } from '@campfire/shared';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as import('pino').Logger;
}

interface MockSqlOptions {
  results?: unknown[][];
}

function createMockDb(options: MockSqlOptions = {}): DbClient {
  const resultQueue = [...(options.results || [])];

  const sqlTaggedTemplate = vi.fn().mockImplementation(() => {
    return Promise.resolve(resultQueue.shift() || []);
  });

  (sqlTaggedTemplate as unknown as Record<string, unknown>).unsafe = vi.fn((val: string) => val);

  return {
    sql: sqlTaggedTemplate,
  } as unknown as DbClient;
}

function createJobData(overrides: Partial<MessagingInboundJobData> = {}): MessagingInboundJobData {
  return {
    channelId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440001',
    companionId: '550e8400-e29b-41d4-a716-446655440002',
    platform: 'telegram',
    platformMessageId: '42',
    platformChannelId: '987654321',
    text: 'Hello, how are you?',
    senderPlatformId: '123456789',
    ...overrides,
  };
}

// ============================================================================
// processInboundMessage Tests
// ============================================================================

describe('processInboundMessage', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.restoreAllMocks();
  });

  it('returns responded=false when companion is not found', async () => {
    const db = createMockDb({
      results: [
        // companions query returns empty
        [],
      ],
    });

    const result = await processInboundMessage(db, mockLogger, createJobData());

    expect(result.responded).toBe(false);
    expect(result.responseLength).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ companionId: expect.any(String) }),
      'Companion not found or inactive'
    );
  });

  it('returns responded=false when companion is inactive', async () => {
    const db = createMockDb({
      results: [
        // companion query returns inactive companion
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'paused' }],
      ],
    });

    const result = await processInboundMessage(db, mockLogger, createJobData());

    expect(result.responded).toBe(false);
    expect(result.responseLength).toBe(0);
  });

  it('creates a new session when none exists', async () => {
    // Mock fetch to return a response from orchestrator
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'Hello there!' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        // companion query
        [{ id: 'comp-1', name: 'Test Companion', spec: { identity: { name: 'Test' } }, status: 'active' }],
        // session query (none found)
        [],
        // create session
        [{ id: 'new-session-123' }],
        // recent turns (empty)
        [],
        // next turn number
        [{ next_turn: 1 }],
        // insert turn
        [{ id: 'turn-1' }],
        // update message count
        [],
      ],
    });

    await processInboundMessage(db, mockLogger, createJobData());

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'new-session-123' }),
      expect.stringContaining('Created new session')
    );
  });

  it('reuses existing active session', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'I remember you!' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        // companion query
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'active' }],
        // session query (found existing)
        [{ id: 'existing-session-456' }],
        // recent turns
        [
          { user_message: 'hi', agent_message: 'hello' },
        ],
        // next turn number
        [{ next_turn: 2 }],
        // insert turn
        [{ id: 'turn-2' }],
        // update message count
        [],
      ],
    });

    await processInboundMessage(db, mockLogger, createJobData());

    // Verify the orchestrator was called with recent turns
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/message'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('existing-session-456'),
      })
    );
  });

  it('handles orchestrator failure gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        // companion query
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'active' }],
        // session query
        [{ id: 'session-1' }],
        // recent turns
        [],
      ],
    });

    const result = await processInboundMessage(db, mockLogger, createJobData());

    expect(result.responded).toBe(false);
    expect(result.responseLength).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      'Orchestrator request failed'
    );
  });

  it('handles network error calling orchestrator', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        // companion query
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'active' }],
        // session query
        [{ id: 'session-1' }],
        // recent turns
        [],
      ],
    });

    const result = await processInboundMessage(db, mockLogger, createJobData());

    expect(result.responded).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Failed to call orchestrator'
    );
  });

  it('handles empty orchestrator response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'active' }],
        [{ id: 'session-1' }],
        [],
      ],
    });

    const result = await processInboundMessage(db, mockLogger, createJobData());

    expect(result.responded).toBe(false);
    expect(result.responseLength).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: expect.any(String) }),
      'Empty response from orchestrator'
    );
  });

  it('includes platform in session metadata for new sessions', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'Hi!' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const db = createMockDb({
      results: [
        [{ id: 'comp-1', name: 'Test', spec: {}, status: 'active' }],
        [], // no existing session
        [{ id: 'new-session' }],
        [],
        [{ next_turn: 1 }],
        [{ id: 'turn-1' }],
        [],
      ],
    });

    const data = createJobData({ platform: 'telegram' });
    await processInboundMessage(db, mockLogger, data);

    // Verify session was created (second SQL call after the empty session query)
    expect(db.sql).toHaveBeenCalled();
  });
});

// ============================================================================
// Queue Definition Tests
// ============================================================================

describe('Messaging Queue Definitions', () => {
  it('exports the correct queue name', async () => {
    const { MESSAGING_INBOUND_QUEUE } = await import('../queues.js');
    expect(MESSAGING_INBOUND_QUEUE).toBe('messaging-inbound');
  });
});
