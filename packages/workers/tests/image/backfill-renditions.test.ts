/**
 * Tests for the backfill image renditions logic.
 *
 * Validates that the processing pipeline produces output matching
 * the expected schema for the companion_images.renditions JSONB column.
 * The actual image processing is tested in processor.test.ts.
 * This test verifies the integration flow and data structure contracts.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  processImageRenditions,
  groupRenditions,
  getContentType,
} from '../../src/image/processor.js';
import {
  getRenditionKeyPrefix,
  getRenditionS3Key,
  RENDITION_CONFIGS,
} from '@campfire/shared';

// Helper: create a test image buffer at standard companion size
async function createTestImageBuffer(
  width = 832,
  height = 1248
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 64, b: 192 },
    },
  })
    .png()
    .toBuffer();
}

describe('Backfill Image Renditions', () => {
  describe('S3 key construction', () => {
    it('should build correct rendition key prefix', () => {
      const prefix = getRenditionKeyPrefix('user-123', 'session-456', 'cache-789');
      expect(prefix).toBe('companions/user-123/session-456/cache-789');
    });

    it('should build correct rendition S3 keys', () => {
      const prefix = 'companions/user-123/session-456/cache-789';
      expect(getRenditionS3Key(prefix, 'thumb', 'webp')).toBe(
        'companions/user-123/session-456/cache-789/thumb.webp'
      );
      expect(getRenditionS3Key(prefix, 'large', 'avif')).toBe(
        'companions/user-123/session-456/cache-789/large.avif'
      );
      expect(getRenditionS3Key(prefix, 'original', 'png')).toBe(
        'companions/user-123/session-456/cache-789/original.png'
      );
    });
  });

  describe('rendition processing pipeline (backfill path)', () => {
    it('should generate all session rendition sizes', async () => {
      const imageBuffer = await createTestImageBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        sizes: [...RENDITION_CONFIGS.session],
        keepOriginal: true,
      });

      const sizes = new Set(renditions.map((r) => r.size));
      expect(sizes.has('thumb')).toBe(true);
      expect(sizes.has('small')).toBe(true);
      expect(sizes.has('medium')).toBe(true);
      expect(sizes.has('large')).toBe(true);
      expect(sizes.has('original')).toBe(true);
    });

    it('should produce webp and avif for each size', async () => {
      const imageBuffer = await createTestImageBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        sizes: [...RENDITION_CONFIGS.session],
        keepOriginal: true,
      });

      const thumbFormats = renditions
        .filter((r) => r.size === 'thumb')
        .map((r) => r.format);
      expect(thumbFormats).toContain('webp');
      expect(thumbFormats).toContain('avif');

      const originalFormats = renditions
        .filter((r) => r.size === 'original')
        .map((r) => r.format);
      expect(originalFormats).toContain('webp');
      expect(originalFormats).toContain('avif');
      expect(originalFormats).toContain('png');
    });

    it('should produce valid grouped renditions for JSONB storage', async () => {
      const imageBuffer = await createTestImageBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        sizes: [...RENDITION_CONFIGS.session],
        keepOriginal: true,
      });

      const keyPrefix = getRenditionKeyPrefix('user-1', 'sess-1', 'cache-1');
      const grouped = groupRenditions(
        renditions,
        (size, format) => getRenditionS3Key(keyPrefix, size, format),
        (s3Key) => `https://cdn.example.com/${s3Key}`
      );

      // Validate structure matches DB schema expectation
      expect(grouped.thumb?.webp).toBeDefined();
      expect(grouped.thumb?.webp?.s3Key).toMatch(/companions\/.*\/thumb\.webp$/);
      expect(grouped.thumb?.webp?.url).toMatch(/^https:\/\/cdn\.example\.com\//);
      expect(typeof grouped.thumb?.webp?.sizeBytes).toBe('number');
      expect(grouped.thumb?.webp?.width).toBe(128);
      expect(grouped.thumb?.webp?.height).toBe(192);

      expect(grouped.small?.avif).toBeDefined();
      expect(grouped.medium?.webp).toBeDefined();
      expect(grouped.large?.avif).toBeDefined();
      expect(grouped.original?.png).toBeDefined();

      // Must serialize to valid JSON for JSONB column
      const json = JSON.stringify(grouped);
      expect(json).toBeTruthy();
      const parsed = JSON.parse(json);
      expect(parsed.thumb).toBeDefined();
      expect(parsed.original).toBeDefined();
    });
  });

  describe('idempotency', () => {
    it('should produce identical rendition keys for same input', () => {
      const prefix1 = getRenditionKeyPrefix('u1', 's1', 'c1');
      const prefix2 = getRenditionKeyPrefix('u1', 's1', 'c1');
      expect(prefix1).toBe(prefix2);

      const key1 = getRenditionS3Key(prefix1, 'thumb', 'webp');
      const key2 = getRenditionS3Key(prefix2, 'thumb', 'webp');
      expect(key1).toBe(key2);
    });
  });

  describe('content types', () => {
    it('should return correct content types for upload', () => {
      expect(getContentType('webp')).toBe('image/webp');
      expect(getContentType('avif')).toBe('image/avif');
      expect(getContentType('png')).toBe('image/png');
    });
  });
});
