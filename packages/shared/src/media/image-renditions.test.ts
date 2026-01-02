import { describe, it, expect } from 'vitest';
import {
  RENDITION_SIZES,
  RENDITION_FORMATS,
  FORMAT_QUALITY,
  FORMAT_CONTENT_TYPE,
  FORMAT_PRIORITY,
  RENDITION_CONFIGS,
  FORMATS_TO_GENERATE,
  getRenditionKeyPrefix,
  getRenditionS3Key,
  type RenditionSize,
  type RenditionFormat,
  type ImageRenditions,
  type ImageRenditionJobData,
  type ImageRenditionResult,
} from './image-renditions.js';

describe('Image Rendition Types and Utilities', () => {
  describe('RENDITION_SIZES', () => {
    it('should define all standard sizes', () => {
      expect(RENDITION_SIZES.thumb).toEqual({ width: 128, height: 192 });
      expect(RENDITION_SIZES.small).toEqual({ width: 256, height: 384 });
      expect(RENDITION_SIZES.medium).toEqual({ width: 512, height: 768 });
      expect(RENDITION_SIZES.large).toEqual({ width: 832, height: 1248 });
    });

    it('should maintain 2:3 aspect ratio for all sizes', () => {
      for (const [_name, size] of Object.entries(RENDITION_SIZES)) {
        const ratio = size.height / size.width;
        expect(ratio).toBeCloseTo(1.5, 2);
      }
    });
  });

  describe('RENDITION_FORMATS', () => {
    it('should include all supported formats', () => {
      expect(RENDITION_FORMATS).toContain('webp');
      expect(RENDITION_FORMATS).toContain('avif');
      expect(RENDITION_FORMATS).toContain('png');
      expect(RENDITION_FORMATS).toHaveLength(3);
    });
  });

  describe('FORMAT_QUALITY', () => {
    it('should define quality for lossy formats', () => {
      expect(FORMAT_QUALITY.webp).toBe(82);
      expect(FORMAT_QUALITY.avif).toBe(75);
    });

    it('should have undefined quality for lossless PNG', () => {
      expect(FORMAT_QUALITY.png).toBeUndefined();
    });

    it('should have reasonable quality values for portraits', () => {
      // Quality should be high enough for portraits but provide good compression
      expect(FORMAT_QUALITY.webp).toBeGreaterThanOrEqual(75);
      expect(FORMAT_QUALITY.webp).toBeLessThanOrEqual(90);
      expect(FORMAT_QUALITY.avif).toBeGreaterThanOrEqual(70);
      expect(FORMAT_QUALITY.avif).toBeLessThanOrEqual(85);
    });
  });

  describe('FORMAT_CONTENT_TYPE', () => {
    it('should return correct MIME types', () => {
      expect(FORMAT_CONTENT_TYPE.webp).toBe('image/webp');
      expect(FORMAT_CONTENT_TYPE.avif).toBe('image/avif');
      expect(FORMAT_CONTENT_TYPE.png).toBe('image/png');
    });
  });

  describe('FORMAT_PRIORITY', () => {
    it('should prioritize modern formats first', () => {
      expect(FORMAT_PRIORITY[0]).toBe('avif');
      expect(FORMAT_PRIORITY[1]).toBe('webp');
      expect(FORMAT_PRIORITY[2]).toBe('png');
    });

    it('should include all formats', () => {
      expect(FORMAT_PRIORITY).toHaveLength(3);
      expect(new Set(FORMAT_PRIORITY)).toEqual(new Set(RENDITION_FORMATS));
    });
  });

  describe('FORMATS_TO_GENERATE', () => {
    it('should generate modern formats only', () => {
      expect(FORMATS_TO_GENERATE).toContain('webp');
      expect(FORMATS_TO_GENERATE).toContain('avif');
      expect(FORMATS_TO_GENERATE).not.toContain('png');
    });
  });

  describe('RENDITION_CONFIGS', () => {
    it('should define session config with all sizes', () => {
      expect(RENDITION_CONFIGS.session).toContain('thumb');
      expect(RENDITION_CONFIGS.session).toContain('small');
      expect(RENDITION_CONFIGS.session).toContain('medium');
      expect(RENDITION_CONFIGS.session).toContain('large');
      expect(RENDITION_CONFIGS.session).toHaveLength(4);
    });

    it('should define anchor config without thumb', () => {
      expect(RENDITION_CONFIGS.anchor).not.toContain('thumb');
      expect(RENDITION_CONFIGS.anchor).toContain('small');
      expect(RENDITION_CONFIGS.anchor).toContain('medium');
      expect(RENDITION_CONFIGS.anchor).toContain('large');
      expect(RENDITION_CONFIGS.anchor).toHaveLength(3);
    });

    it('should define gallery config with only thumbnails', () => {
      expect(RENDITION_CONFIGS.gallery).toContain('thumb');
      expect(RENDITION_CONFIGS.gallery).toContain('small');
      expect(RENDITION_CONFIGS.gallery).toHaveLength(2);
    });
  });

  describe('getRenditionKeyPrefix', () => {
    it('should build correct S3 key prefix', () => {
      const prefix = getRenditionKeyPrefix('user123', 'session456', 'cache789');
      expect(prefix).toBe('companions/user123/session456/cache789');
    });

    it('should handle special characters in IDs', () => {
      const prefix = getRenditionKeyPrefix(
        'user-with-dashes',
        'session_with_underscores',
        'cacheKey123'
      );
      expect(prefix).toBe(
        'companions/user-with-dashes/session_with_underscores/cacheKey123'
      );
    });

    it('should handle anchor session IDs', () => {
      const prefix = getRenditionKeyPrefix(
        'user123',
        'anchors-companion456',
        'cache789'
      );
      expect(prefix).toBe('companions/user123/anchors-companion456/cache789');
    });
  });

  describe('getRenditionS3Key', () => {
    it('should build correct S3 key for rendition', () => {
      const key = getRenditionS3Key('companions/user1/sess1/cache1', 'thumb', 'webp');
      expect(key).toBe('companions/user1/sess1/cache1/thumb.webp');
    });

    it('should handle original size', () => {
      const key = getRenditionS3Key('prefix', 'original', 'png');
      expect(key).toBe('prefix/original.png');
    });

    it('should work with all format types', () => {
      const prefix = 'companions/u/s/c';

      expect(getRenditionS3Key(prefix, 'medium', 'webp')).toBe(
        'companions/u/s/c/medium.webp'
      );
      expect(getRenditionS3Key(prefix, 'medium', 'avif')).toBe(
        'companions/u/s/c/medium.avif'
      );
      expect(getRenditionS3Key(prefix, 'medium', 'png')).toBe(
        'companions/u/s/c/medium.png'
      );
    });

    it('should work with all size types', () => {
      const prefix = 'test';
      const sizes: (RenditionSize | 'original')[] = [
        'thumb',
        'small',
        'medium',
        'large',
        'original',
      ];

      for (const size of sizes) {
        const key = getRenditionS3Key(prefix, size, 'webp');
        expect(key).toBe(`test/${size}.webp`);
      }
    });
  });

  describe('Type Definitions', () => {
    it('should allow valid ImageRenditions object', () => {
      const renditions: ImageRenditions = {
        thumb: {
          webp: {
            s3Key: 'path/thumb.webp',
            url: 'https://example.com/thumb.webp',
            sizeBytes: 5000,
            format: 'webp',
            width: 128,
            height: 192,
          },
        },
        medium: {
          avif: {
            s3Key: 'path/medium.avif',
            url: 'https://example.com/medium.avif',
            sizeBytes: 25000,
            format: 'avif',
            width: 512,
            height: 768,
          },
        },
      };

      expect(renditions.thumb?.webp?.format).toBe('webp');
      expect(renditions.medium?.avif?.width).toBe(512);
    });

    it('should allow valid ImageRenditionJobData', () => {
      const jobData: ImageRenditionJobData = {
        originalS3Key: 'companions/user1/sess1/cache1/original.png',
        bucket: 'campfire-media',
        userId: 'user1',
        sessionId: 'sess1',
        cacheKey: 'cache1',
        imageId: 'img123',
        isAnchor: false,
        companionId: 'comp1',
      };

      expect(jobData.originalS3Key).toContain('original.png');
      expect(jobData.isAnchor).toBe(false);
    });

    it('should allow ImageRenditionJobData without optional fields', () => {
      const jobData: ImageRenditionJobData = {
        originalS3Key: 'companions/user1/sess1/cache1/original.png',
        bucket: 'campfire-media',
        userId: 'user1',
        sessionId: 'sess1',
        cacheKey: 'cache1',
        imageId: 'img123',
      };

      expect(jobData.isAnchor).toBeUndefined();
      expect(jobData.companionId).toBeUndefined();
    });

    it('should allow valid ImageRenditionResult', () => {
      const result: ImageRenditionResult = {
        imageId: 'img123',
        renditions: {
          thumb: {
            webp: {
              s3Key: 'path/thumb.webp',
              url: 'https://example.com/thumb.webp',
              sizeBytes: 5000,
              format: 'webp',
              width: 128,
              height: 192,
            },
          },
        },
        processingTimeMs: 1500,
        bytesSaved: 500000,
      };

      expect(result.processingTimeMs).toBe(1500);
      expect(result.bytesSaved).toBeGreaterThan(0);
    });
  });
});
