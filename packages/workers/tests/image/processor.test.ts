import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processImageRenditions,
  groupRenditions,
  calculateBytesSaved,
  getContentType,
  type ProcessedRendition,
} from '../../src/image/processor.js';

// Create a simple test PNG buffer (1x1 red pixel)
function createTestPngBuffer(): Buffer {
  // Minimal valid PNG: 1x1 red pixel
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, // bit depth: 8, color type: 2 (RGB)
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x90, 0x77, 0x53, 0xde, // CRC
    0x00, 0x00, 0x00, 0x0c, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
    0x01, 0x01, 0x01, 0x00, // compressed data
    0x18, 0xdd, 0x8d, 0xb4, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);
}

// Create a larger test image buffer (832x1248 - standard size)
async function createLargeTestBuffer(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: {
      width: 832,
      height: 1248,
      channels: 3,
      background: { r: 128, g: 64, b: 192 },
    },
  })
    .png()
    .toBuffer();
}

describe('Image Processor', () => {
  describe('processImageRenditions', () => {
    it('should generate renditions for all sizes by default', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer);

      // Should have: 4 sizes * 2 formats (webp, avif) + 3 original formats (webp, avif, png)
      // = 8 + 3 = 11 renditions
      expect(renditions.length).toBeGreaterThanOrEqual(11);

      // Check we have all expected sizes
      const sizes = new Set(renditions.map((r) => r.size));
      expect(sizes.has('thumb')).toBe(true);
      expect(sizes.has('small')).toBe(true);
      expect(sizes.has('medium')).toBe(true);
      expect(sizes.has('large')).toBe(true);
      expect(sizes.has('original')).toBe(true);
    });

    it('should generate both webp and avif formats', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer);

      const formats = new Set(renditions.map((r) => r.format));
      expect(formats.has('webp')).toBe(true);
      expect(formats.has('avif')).toBe(true);
    });

    it('should keep original as PNG when keepOriginal is true', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        keepOriginal: true,
      });

      const originalPng = renditions.find(
        (r) => r.size === 'original' && r.format === 'png'
      );
      expect(originalPng).toBeDefined();
    });

    it('should respect custom sizes option', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        sizes: ['thumb', 'medium'],
        keepOriginal: false,
      });

      const sizes = new Set(renditions.map((r) => r.size));
      expect(sizes.has('thumb')).toBe(true);
      expect(sizes.has('medium')).toBe(true);
      expect(sizes.has('small')).toBe(false);
      expect(sizes.has('large')).toBe(false);
    });

    it('should have correct dimensions for each size', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer);

      const thumb = renditions.find(
        (r) => r.size === 'thumb' && r.format === 'webp'
      );
      expect(thumb?.width).toBe(128);
      expect(thumb?.height).toBe(192);

      const small = renditions.find(
        (r) => r.size === 'small' && r.format === 'webp'
      );
      expect(small?.width).toBe(256);
      expect(small?.height).toBe(384);

      const medium = renditions.find(
        (r) => r.size === 'medium' && r.format === 'webp'
      );
      expect(medium?.width).toBe(512);
      expect(medium?.height).toBe(768);

      const large = renditions.find(
        (r) => r.size === 'large' && r.format === 'webp'
      );
      expect(large?.width).toBe(832);
      expect(large?.height).toBe(1248);
    });

    it('should produce smaller file sizes for smaller renditions', async () => {
      const imageBuffer = await createLargeTestBuffer();

      const renditions = await processImageRenditions(imageBuffer, {
        formats: ['webp'],
      });

      const webpRenditions = renditions.filter((r) => r.format === 'webp');
      const sizeMap = new Map(
        webpRenditions.map((r) => [r.size, r.buffer.length])
      );

      // Smaller sizes should generally produce smaller files
      expect(sizeMap.get('thumb')!).toBeLessThan(sizeMap.get('small')!);
      expect(sizeMap.get('small')!).toBeLessThan(sizeMap.get('medium')!);
      expect(sizeMap.get('medium')!).toBeLessThan(sizeMap.get('large')!);
    });

    it('should skip sizes larger than the original', async () => {
      const sharp = (await import('sharp')).default;
      // Create a small 100x150 image
      const smallBuffer = await sharp({
        create: {
          width: 100,
          height: 150,
          channels: 3,
          background: { r: 100, g: 100, b: 100 },
        },
      })
        .png()
        .toBuffer();

      const renditions = await processImageRenditions(smallBuffer, {
        keepOriginal: true,
      });

      // Should only have original, since all predefined sizes are larger
      const sizes = new Set(renditions.map((r) => r.size));
      expect(sizes.has('thumb')).toBe(false);
      expect(sizes.has('small')).toBe(false);
      expect(sizes.has('medium')).toBe(false);
      expect(sizes.has('large')).toBe(false);
      expect(sizes.has('original')).toBe(true);
    });
  });

  describe('groupRenditions', () => {
    it('should group renditions by size and format', () => {
      const renditions: ProcessedRendition[] = [
        {
          size: 'thumb',
          format: 'webp',
          buffer: Buffer.from('webp-thumb'),
          width: 128,
          height: 192,
        },
        {
          size: 'thumb',
          format: 'avif',
          buffer: Buffer.from('avif-thumb'),
          width: 128,
          height: 192,
        },
        {
          size: 'small',
          format: 'webp',
          buffer: Buffer.from('webp-small'),
          width: 256,
          height: 384,
        },
      ];

      const getS3Key = (size: string, format: string) =>
        `test/${size}.${format}`;
      const getUrl = (key: string) => `https://s3.example.com/${key}`;

      const grouped = groupRenditions(renditions, getS3Key, getUrl);

      expect(grouped.thumb?.webp).toBeDefined();
      expect(grouped.thumb?.webp?.s3Key).toBe('test/thumb.webp');
      expect(grouped.thumb?.webp?.url).toBe(
        'https://s3.example.com/test/thumb.webp'
      );
      expect(grouped.thumb?.webp?.format).toBe('webp');
      expect(grouped.thumb?.webp?.width).toBe(128);
      expect(grouped.thumb?.webp?.height).toBe(192);

      expect(grouped.thumb?.avif).toBeDefined();
      expect(grouped.small?.webp).toBeDefined();
      expect(grouped.small?.avif).toBeUndefined();
    });

    it('should include correct sizeBytes', () => {
      const renditions: ProcessedRendition[] = [
        {
          size: 'medium',
          format: 'webp',
          buffer: Buffer.alloc(12345),
          width: 512,
          height: 768,
        },
      ];

      const grouped = groupRenditions(
        renditions,
        (size, format) => `${size}.${format}`,
        (key) => `https://example.com/${key}`
      );

      expect(grouped.medium?.webp?.sizeBytes).toBe(12345);
    });
  });

  describe('calculateBytesSaved', () => {
    it('should calculate bytes saved for renditions', () => {
      const originalSize = 1000000; // 1MB
      const renditions: ProcessedRendition[] = [
        {
          size: 'thumb',
          format: 'webp',
          buffer: Buffer.alloc(5000),
          width: 128,
          height: 192,
        },
        {
          size: 'thumb',
          format: 'avif',
          buffer: Buffer.alloc(4000),
          width: 128,
          height: 192,
        },
        {
          size: 'small',
          format: 'webp',
          buffer: Buffer.alloc(20000),
          width: 256,
          height: 384,
        },
        {
          size: 'original',
          format: 'webp',
          buffer: Buffer.alloc(800000),
          width: 832,
          height: 1248,
        },
      ];

      const saved = calculateBytesSaved(originalSize, renditions);

      // For thumb: best is 4000 (avif), saved = 1000000 - 4000 = 996000
      // For small: best is 20000 (webp), saved = 1000000 - 20000 = 980000
      // Original is not counted in savings
      // Total = 996000 + 980000 = 1976000
      expect(saved).toBe(1976000);
    });

    it('should return 0 when no smaller renditions', () => {
      const renditions: ProcessedRendition[] = [
        {
          size: 'original',
          format: 'png',
          buffer: Buffer.alloc(1000000),
          width: 832,
          height: 1248,
        },
      ];

      const saved = calculateBytesSaved(1000000, renditions);
      expect(saved).toBe(0);
    });
  });

  describe('getContentType', () => {
    it('should return correct content types', () => {
      expect(getContentType('webp')).toBe('image/webp');
      expect(getContentType('avif')).toBe('image/avif');
      expect(getContentType('png')).toBe('image/png');
    });
  });
});
