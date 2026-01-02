import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { DbClient } from '../../src/db/client.js';

// Mock sharp before importing worker
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 832, height: 1248 }),
    resize: vi.fn().mockReturnThis(),
    clone: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    avif: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(10000)),
  }));
  return { default: mockSharp };
});

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.alloc(100000);
        },
      },
    }),
  })),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

// Mock BullMQ
const mockWorkerInstance = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => mockWorkerInstance),
  Job: vi.fn(),
}));

describe('ImageRenditionWorker', () => {
  let mockConnection: Redis;
  let mockDb: DbClient;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock worker instance
    mockWorkerInstance.on.mockClear().mockReturnThis();
    mockWorkerInstance.close.mockClear().mockResolvedValue(undefined);

    mockConnection = {
      duplicate: vi.fn().mockReturnThis(),
      quit: vi.fn().mockResolvedValue('OK'),
    } as unknown as Redis;

    mockDb = {
      sql: vi.fn().mockResolvedValue([]),
    } as unknown as DbClient;

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create worker with default region', async () => {
      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      const worker = new ImageRenditionWorker({
        connection: mockConnection,
        db: mockDb,
        logger: mockLogger,
      });

      expect(worker).toBeDefined();
    });

    it('should use AWS_REGION from environment', async () => {
      process.env['AWS_REGION'] = 'eu-west-1';

      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      const worker = new ImageRenditionWorker({
        connection: mockConnection,
        db: mockDb,
        logger: mockLogger,
      });

      expect(worker).toBeDefined();

      // Reset
      process.env['AWS_REGION'] = 'us-east-1';
    });
  });

  describe('start', () => {
    it('should start the worker and log', async () => {
      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      const worker = new ImageRenditionWorker({
        connection: mockConnection,
        db: mockDb,
        logger: mockLogger,
        concurrency: 3,
      });

      await worker.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ concurrency: 3 }),
        'Image rendition worker started'
      );
    });
  });

  describe('stop', () => {
    it('should stop the worker gracefully', async () => {
      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      const worker = new ImageRenditionWorker({
        connection: mockConnection,
        db: mockDb,
        logger: mockLogger,
      });

      await worker.start();
      await worker.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Image rendition worker stopped'
      );
    });

    it('should handle stop when not started', async () => {
      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      const worker = new ImageRenditionWorker({
        connection: mockConnection,
        db: mockDb,
        logger: mockLogger,
      });

      // Should not throw
      await expect(worker.stop()).resolves.toBeUndefined();
    });
  });

  describe('createRenditionJobData', () => {
    it('should create job data with required fields', async () => {
      const { createRenditionJobData } = await import(
        '../../src/image/worker.js'
      );

      const jobData = createRenditionJobData(
        'companions/user1/session1/abc123/original.png',
        'test-bucket',
        'user1',
        'session1',
        'abc123',
        'image-id-1'
      );

      expect(jobData).toEqual({
        originalS3Key: 'companions/user1/session1/abc123/original.png',
        bucket: 'test-bucket',
        userId: 'user1',
        sessionId: 'session1',
        cacheKey: 'abc123',
        imageId: 'image-id-1',
        isAnchor: undefined,
        companionId: undefined,
      });
    });

    it('should include optional fields when provided', async () => {
      const { createRenditionJobData } = await import(
        '../../src/image/worker.js'
      );

      const jobData = createRenditionJobData(
        'companions/user1/anchors-comp1/xyz789/original.png',
        'test-bucket',
        'user1',
        'anchors-comp1',
        'xyz789',
        'image-id-2',
        { isAnchor: true, companionId: 'comp1' }
      );

      expect(jobData.isAnchor).toBe(true);
      expect(jobData.companionId).toBe('comp1');
    });
  });

  describe('IMAGE_RENDITION_QUEUE constant', () => {
    it('should export the queue name', async () => {
      const { IMAGE_RENDITION_QUEUE } = await import(
        '../../src/image/worker.js'
      );

      expect(IMAGE_RENDITION_QUEUE).toBe('image-renditions');
    });
  });
});
