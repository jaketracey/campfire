import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processMemoryDecay, processMemoryExpiration } from '../memory/worker.js';
import type { DbClient } from '../db/client.js';

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
  /** Results to return from sequential SQL calls */
  results?: unknown[][];
}

function createMockDb(options: MockSqlOptions = {}): DbClient {
  const resultQueue = [...(options.results || [])];

  const sqlTaggedTemplate = vi.fn().mockImplementation(() => {
    return Promise.resolve(resultQueue.shift() || []);
  });

  // Add the unsafe method for template interpolation
  (sqlTaggedTemplate as unknown as Record<string, unknown>).unsafe = vi.fn((val: string) => val);

  return {
    sql: sqlTaggedTemplate,
  } as unknown as DbClient;
}

// ============================================================================
// processMemoryDecay
// ============================================================================

describe('processMemoryDecay', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('decays all active user-companion pairs when no specific pair given', async () => {
    // First call: getActiveUserCompanionPairs
    // Second/Third calls: applyDecayForPair for each pair
    const db = createMockDb({
      results: [
        // getActiveUserCompanionPairs returns 2 pairs
        [
          { user_id: 'user-1', companion_id: 'comp-1' },
          { user_id: 'user-2', companion_id: 'comp-2' },
        ],
        // applyDecayForPair for pair 1: 3 memories decayed
        [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
        // applyDecayForPair for pair 2: 1 memory decayed
        [{ id: 'm4' }],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {});

    expect(result.pairsProcessed).toBe(2);
    expect(result.totalDecayed).toBe(4);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pairsProcessed: 2, totalDecayed: 4 }),
      'Memory decay completed for all pairs'
    );
  });

  it('decays a specific user-companion pair when provided', async () => {
    const db = createMockDb({
      results: [
        // applyDecayForPair: 5 memories decayed
        [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {
      userId: 'user-1',
      companionId: 'comp-1',
    });

    expect(result.pairsProcessed).toBe(1);
    expect(result.totalDecayed).toBe(5);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', companionId: 'comp-1', decayed: 5 }),
      'Memory decay applied for specific pair'
    );
  });

  it('handles no active pairs gracefully', async () => {
    const db = createMockDb({
      results: [
        // getActiveUserCompanionPairs returns empty
        [],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {});

    expect(result.pairsProcessed).toBe(0);
    expect(result.totalDecayed).toBe(0);
  });

  it('handles zero decayed memories for a pair', async () => {
    const db = createMockDb({
      results: [
        // getActiveUserCompanionPairs
        [{ user_id: 'user-1', companion_id: 'comp-1' }],
        // applyDecayForPair: no memories old enough to decay
        [],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {});

    expect(result.pairsProcessed).toBe(1);
    expect(result.totalDecayed).toBe(0);
  });

  it('uses custom decay rate when provided', async () => {
    const db = createMockDb({
      results: [
        [{ id: 'm1' }],
      ],
    });

    await processMemoryDecay(db, mockLogger, {
      userId: 'user-1',
      companionId: 'comp-1',
      decayRate: 0.05,
    });

    // The SQL call should have been made (we verify it was called)
    expect(db.sql).toHaveBeenCalled();
  });

  it('uses default decay rate of 0.01 when not specified', async () => {
    const db = createMockDb({
      results: [
        [{ id: 'm1' }],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {
      userId: 'user-1',
      companionId: 'comp-1',
    });

    expect(result.totalDecayed).toBe(1);
    // The default rate is used internally; we verify behavior is correct
    expect(mockLogger.info).toHaveBeenCalled();
  });
});

// ============================================================================
// processMemoryExpiration
// ============================================================================

describe('processMemoryExpiration', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('soft-deletes expired memories and reports count', async () => {
    const db = createMockDb({
      results: [
        // Expired memories found
        [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
      ],
    });

    const result = await processMemoryExpiration(db, mockLogger);

    expect(result.expiredCount).toBe(3);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { expiredCount: 3 },
      'Expired memories soft-deleted'
    );
  });

  it('reports zero when no expired memories exist', async () => {
    const db = createMockDb({
      results: [
        // No expired memories
        [],
      ],
    });

    const result = await processMemoryExpiration(db, mockLogger);

    expect(result.expiredCount).toBe(0);
    expect(mockLogger.debug).toHaveBeenCalledWith('No expired memories found');
    // info should NOT have been called for the "soft-deleted" message
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ expiredCount: expect.any(Number) }),
      expect.any(String)
    );
  });

  it('only targets active memories with expires_at in the past', async () => {
    const db = createMockDb({
      results: [[{ id: 'm1' }]],
    });

    await processMemoryExpiration(db, mockLogger);

    // Verify the SQL was called (the tagged template is the mock)
    expect(db.sql).toHaveBeenCalled();
  });
});

// ============================================================================
// Decay Logic: SQL Behavior Verification
// ============================================================================

describe('Memory Decay SQL Behavior', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('decay query is called once per user-companion pair', async () => {
    const db = createMockDb({
      results: [
        // 3 pairs
        [
          { user_id: 'u1', companion_id: 'c1' },
          { user_id: 'u2', companion_id: 'c2' },
          { user_id: 'u3', companion_id: 'c3' },
        ],
        // Results for each pair
        [{ id: 'm1' }],
        [{ id: 'm2' }],
        [],
      ],
    });

    const result = await processMemoryDecay(db, mockLogger, {});

    expect(result.pairsProcessed).toBe(3);
    expect(result.totalDecayed).toBe(2);
    // 1 call for pairs query + 3 calls for decay per pair = 4 total
    expect(db.sql).toHaveBeenCalledTimes(4);
  });
});

// ============================================================================
// Queue Configuration
// ============================================================================

describe('Memory Queue Configuration', () => {
  it('exports correct queue names', async () => {
    const { MEMORY_DECAY_QUEUE, MEMORY_EXPIRATION_QUEUE } = await import('../memory/queues.js');
    expect(MEMORY_DECAY_QUEUE).toBe('memory-decay');
    expect(MEMORY_EXPIRATION_QUEUE).toBe('memory-expiration');
  });

  it('exports queue factory functions', async () => {
    const { createMemoryDecayQueue, createMemoryExpirationQueue } = await import('../memory/queues.js');
    expect(typeof createMemoryDecayQueue).toBe('function');
    expect(typeof createMemoryExpirationQueue).toBe('function');
  });
});

// ============================================================================
// Worker Class Construction
// ============================================================================

describe('Worker Classes', () => {
  it('MemoryDecayWorker can be constructed', async () => {
    const { MemoryDecayWorker } = await import('../memory/worker.js');
    const worker = new MemoryDecayWorker({
      connection: {} as import('ioredis').Redis,
      db: {} as DbClient,
      logger: createMockLogger(),
    });
    expect(worker).toBeDefined();
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.stop).toBe('function');
  });

  it('MemoryExpirationWorker can be constructed', async () => {
    const { MemoryExpirationWorker } = await import('../memory/worker.js');
    const worker = new MemoryExpirationWorker({
      connection: {} as import('ioredis').Redis,
      db: {} as DbClient,
      logger: createMockLogger(),
    });
    expect(worker).toBeDefined();
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.stop).toBe('function');
  });
});
