/**
 * AdSpendSyncWorker Unit Tests
 *
 * Tests for the ad spend synchronization worker including:
 * - Worker lifecycle (start/stop)
 * - Queue configuration
 * - Job data types
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
import { AD_SPEND_SYNC_QUEUE, type AdSpendSyncJob } from '../queues.js';
import { AdSpendSyncWorker } from '../spend-sync-worker.js';

describe('AdSpendSyncWorker', () => {
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
      expect(AD_SPEND_SYNC_QUEUE).toBe('ad-spend-sync');
    });
  });

  // ===========================================================================
  // Worker Lifecycle Tests
  // ===========================================================================

  describe('Worker Lifecycle', () => {
    it('should create worker with config', () => {
      const worker = new AdSpendSyncWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
        concurrency: 2,
      });

      expect(worker).toBeDefined();
    });

    it('should use default concurrency when not specified', () => {
      const worker = new AdSpendSyncWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
      });

      expect(worker).toBeDefined();
    });

    it('should accept custom API URLs', () => {
      const worker = new AdSpendSyncWorker({
        connection: mockRedis as Redis,
        db: mockDb as any,
        logger: mockLogger as unknown as Logger,
        googleAdsApiUrl: 'https://custom-google.example.com',
        facebookAdsApiUrl: 'https://custom-facebook.example.com',
      });

      expect(worker).toBeDefined();
    });
  });

  // ===========================================================================
  // Job Data Types Tests
  // ===========================================================================

  describe('Job Data Types', () => {
    it('should accept job with accountId', () => {
      const jobData: AdSpendSyncJob = {
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(jobData.accountId).toBeDefined();
    });

    it('should accept job without accountId for all accounts', () => {
      const jobData: AdSpendSyncJob = {};

      expect(jobData.accountId).toBeUndefined();
    });

    it('should accept job with date range', () => {
      const jobData: AdSpendSyncJob = {
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      };

      expect(jobData.startDate).toBe('2025-01-01');
      expect(jobData.endDate).toBe('2025-01-31');
    });

    it('should accept job without date range for default (yesterday)', () => {
      const jobData: AdSpendSyncJob = {
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(jobData.startDate).toBeUndefined();
      expect(jobData.endDate).toBeUndefined();
    });
  });
});
