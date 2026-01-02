import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ImageRenditionWorker', () => {
  beforeEach(() => {
    vi.resetModules();
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

    it('should handle empty options object', async () => {
      const { createRenditionJobData } = await import(
        '../../src/image/worker.js'
      );

      const jobData = createRenditionJobData(
        'path/to/image.png',
        'bucket',
        'user',
        'session',
        'cache',
        'img-id',
        {}
      );

      expect(jobData.isAnchor).toBeUndefined();
      expect(jobData.companionId).toBeUndefined();
    });

    it('should only set isAnchor when provided', async () => {
      const { createRenditionJobData } = await import(
        '../../src/image/worker.js'
      );

      const jobData = createRenditionJobData(
        'path/to/image.png',
        'bucket',
        'user',
        'session',
        'cache',
        'img-id',
        { isAnchor: true }
      );

      expect(jobData.isAnchor).toBe(true);
      expect(jobData.companionId).toBeUndefined();
    });

    it('should only set companionId when provided', async () => {
      const { createRenditionJobData } = await import(
        '../../src/image/worker.js'
      );

      const jobData = createRenditionJobData(
        'path/to/image.png',
        'bucket',
        'user',
        'session',
        'cache',
        'img-id',
        { companionId: 'comp-123' }
      );

      expect(jobData.isAnchor).toBeUndefined();
      expect(jobData.companionId).toBe('comp-123');
    });
  });

  describe('IMAGE_RENDITION_QUEUE constant', () => {
    it('should export the queue name', async () => {
      const { IMAGE_RENDITION_QUEUE } = await import(
        '../../src/image/worker.js'
      );

      expect(IMAGE_RENDITION_QUEUE).toBe('image-renditions');
    });

    it('should be a non-empty string', async () => {
      const { IMAGE_RENDITION_QUEUE } = await import(
        '../../src/image/worker.js'
      );

      expect(typeof IMAGE_RENDITION_QUEUE).toBe('string');
      expect(IMAGE_RENDITION_QUEUE.length).toBeGreaterThan(0);
    });
  });

  describe('ImageRenditionWorker class', () => {
    it('should export ImageRenditionWorker class', async () => {
      const { ImageRenditionWorker } = await import(
        '../../src/image/worker.js'
      );

      expect(ImageRenditionWorker).toBeDefined();
      expect(typeof ImageRenditionWorker).toBe('function');
    });
  });
});
