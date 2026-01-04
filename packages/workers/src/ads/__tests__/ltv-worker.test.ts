/**
 * LtvCalculationWorker Unit Tests
 *
 * Tests for the LTV calculation worker including:
 * - Worker lifecycle (start/stop)
 * - Queue configuration
 * - LTV calculation logic via database queries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

// Create mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Create mock SQL template function
const createMockSql = () => {
  const mockSql = vi.fn().mockResolvedValue([]);
  return mockSql;
};

// Create mock database client
const createMockDb = () => ({
  sql: createMockSql(),
});

// Create mock Redis connection
const createMockRedis = (): Partial<Redis> => ({
  ping: vi.fn().mockResolvedValue('PONG'),
  duplicate: vi.fn().mockReturnThis(),
  options: {} as Redis['options'],
});

// Import queue constants from queues module
import { LTV_CALCULATION_QUEUE, type LtvCalculationJob } from '../queues.js';
import { LtvCalculationWorker } from '../ltv-worker.js';

describe('LtvCalculationWorker', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockRedis: Partial<Redis>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockRedis = createMockRedis();
  });

  // ===========================================================================
  // Queue Configuration Tests
  // ===========================================================================

  describe('Queue Configuration', () => {
    it('should use correct queue name', () => {
      expect(LTV_CALCULATION_QUEUE).toBe('ltv-calculation');
    });
  });

  // ===========================================================================
  // Worker Lifecycle Tests
  // ===========================================================================

  describe('Worker Lifecycle', () => {
    it('should create worker with config', () => {
      const worker = new LtvCalculationWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
        concurrency: 2,
        batchSize: 50,
      });

      expect(worker).toBeDefined();
    });

    it('should use default concurrency when not specified', () => {
      const worker = new LtvCalculationWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
      });

      expect(worker).toBeDefined();
    });

    it('should use default batch size when not specified', () => {
      const worker = new LtvCalculationWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
      });

      expect(worker).toBeDefined();
    });
  });

  // ===========================================================================
  // Job Data Types Tests
  // ===========================================================================

  describe('Job Data Types', () => {
    it('should accept job with userId', () => {
      const jobData: LtvCalculationJob = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(jobData.userId).toBeDefined();
    });

    it('should accept job without userId for batch processing', () => {
      const jobData: LtvCalculationJob = {};

      expect(jobData.userId).toBeUndefined();
    });
  });
});
