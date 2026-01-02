/**
 * Image Processor Service
 *
 * Uses sharp to generate optimized image renditions in multiple sizes and formats.
 * Supports WebP and AVIF for modern browsers with PNG as fallback.
 */

import sharp from 'sharp';
import {
  RENDITION_SIZES,
  FORMAT_QUALITY,
  FORMAT_CONTENT_TYPE,
  FORMATS_TO_GENERATE,
  type RenditionSize,
  type RenditionFormat,
  type RenditionFile,
  type RenditionFormats,
  type ImageRenditions,
} from '@campfire/shared';

export interface ProcessedRendition {
  size: RenditionSize | 'original';
  format: RenditionFormat;
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ImageProcessorOptions {
  /** Sizes to generate (defaults to all) */
  sizes?: RenditionSize[];
  /** Formats to generate (defaults to webp and avif) */
  formats?: RenditionFormat[];
  /** Whether to keep original as PNG */
  keepOriginal?: boolean;
}

const DEFAULT_OPTIONS: Required<ImageProcessorOptions> = {
  sizes: ['thumb', 'small', 'medium', 'large'],
  formats: [...FORMATS_TO_GENERATE],
  keepOriginal: true,
};

/**
 * Process an image buffer into multiple renditions
 */
export async function processImageRenditions(
  imageBuffer: Buffer,
  options: ImageProcessorOptions = {}
): Promise<ProcessedRendition[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: ProcessedRendition[] = [];

  // Get original image metadata
  const metadata = await sharp(imageBuffer).metadata();
  const originalWidth = metadata.width || 832;
  const originalHeight = metadata.height || 1248;

  // Process each size
  for (const size of opts.sizes) {
    const { width, height } = RENDITION_SIZES[size];

    // Skip if target is larger than original
    if (width > originalWidth || height > originalHeight) {
      continue;
    }

    // Create resized base image
    const resized = sharp(imageBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
      });

    // Generate each format
    for (const format of opts.formats) {
      const processed = await convertToFormat(resized.clone(), format);
      results.push({
        size,
        format,
        buffer: processed,
        width,
        height,
      });
    }
  }

  // Add original in requested formats
  if (opts.keepOriginal) {
    for (const format of opts.formats) {
      const processed = await convertToFormat(sharp(imageBuffer), format);
      results.push({
        size: 'original',
        format,
        buffer: processed,
        width: originalWidth,
        height: originalHeight,
      });
    }

    // Also keep original PNG for archive
    results.push({
      size: 'original',
      format: 'png',
      buffer: imageBuffer,
      width: originalWidth,
      height: originalHeight,
    });
  }

  return results;
}

/**
 * Convert sharp instance to specified format
 */
async function convertToFormat(
  image: sharp.Sharp,
  format: RenditionFormat
): Promise<Buffer> {
  switch (format) {
    case 'webp':
      return image
        .webp({
          quality: FORMAT_QUALITY.webp,
          effort: 6, // Higher effort = better compression
        })
        .toBuffer();

    case 'avif':
      return image
        .avif({
          quality: FORMAT_QUALITY.avif,
          effort: 6,
        })
        .toBuffer();

    case 'png':
      return image
        .png({
          compressionLevel: 9,
          palette: false, // Keep full color
        })
        .toBuffer();

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Group processed renditions by size and format
 */
export function groupRenditions(
  renditions: ProcessedRendition[],
  getS3Key: (size: RenditionSize | 'original', format: RenditionFormat) => string,
  getUrl: (s3Key: string) => string
): ImageRenditions {
  const grouped: ImageRenditions = {};

  for (const r of renditions) {
    const s3Key = getS3Key(r.size, r.format);
    const file: RenditionFile = {
      s3Key,
      url: getUrl(s3Key),
      sizeBytes: r.buffer.length,
      format: r.format,
      width: r.width,
      height: r.height,
    };

    // Initialize size group if needed
    if (!grouped[r.size as keyof ImageRenditions]) {
      grouped[r.size as keyof ImageRenditions] = {};
    }

    // Add format to size group
    const sizeGroup = grouped[r.size as keyof ImageRenditions] as RenditionFormats;
    sizeGroup[r.format] = file;
  }

  return grouped;
}

/**
 * Calculate bytes saved by using renditions vs original
 */
export function calculateBytesSaved(
  originalSize: number,
  renditions: ProcessedRendition[]
): number {
  // For each size context, compare best format to original
  const sizeGroups = new Map<string, number>();

  for (const r of renditions) {
    const current = sizeGroups.get(r.size) ?? Infinity;
    sizeGroups.set(r.size, Math.min(current, r.buffer.length));
  }

  // Sum up savings (original - best rendition) for each size
  // This represents what would be saved if each context used its optimal rendition
  let totalSaved = 0;
  for (const [size, bestSize] of sizeGroups) {
    if (size !== 'original') {
      totalSaved += originalSize - bestSize;
    }
  }

  return totalSaved;
}

/**
 * Get content type for a format
 */
export function getContentType(format: RenditionFormat): string {
  return FORMAT_CONTENT_TYPE[format];
}
