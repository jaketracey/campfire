/**
 * Image Rendition Types
 *
 * Defines types for multi-size, multi-format image renditions.
 * Used for optimizing image delivery across different contexts.
 */

/**
 * Available rendition sizes
 * - thumb: 128x192 - Avatar lists, notifications
 * - small: 256x384 - Gift cards, participant lists
 * - medium: 512x768 - Card previews, onboarding selectors
 * - large: 832x1248 - Full display, chat view
 * - original: Source resolution (usually 832x1248)
 */
export const RENDITION_SIZES = {
  thumb: { width: 128, height: 192 },
  small: { width: 256, height: 384 },
  medium: { width: 512, height: 768 },
  large: { width: 832, height: 1248 },
} as const;

export type RenditionSize = keyof typeof RENDITION_SIZES;

/**
 * Supported image formats for renditions
 */
export const RENDITION_FORMATS = ['webp', 'avif', 'png'] as const;
export type RenditionFormat = (typeof RENDITION_FORMATS)[number];

/**
 * Quality settings for each format
 * - WebP: 82 (balanced quality/size for portraits)
 * - AVIF: 75 (higher compression, maintains detail)
 * - PNG: lossless (archive only)
 */
export const FORMAT_QUALITY: Record<RenditionFormat, number | undefined> = {
  webp: 82,
  avif: 75,
  png: undefined, // lossless
};

/**
 * Single rendition file metadata
 */
export interface RenditionFile {
  /** S3 key for this rendition */
  s3Key: string;
  /** Presigned URL (may expire) */
  url: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Image format */
  format: RenditionFormat;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
}

/**
 * Format variants for a single size
 */
export interface RenditionFormats {
  webp?: RenditionFile;
  avif?: RenditionFile;
  png?: RenditionFile;
}

/**
 * Complete renditions object with all sizes and formats
 */
export interface ImageRenditions {
  thumb?: RenditionFormats;
  small?: RenditionFormats;
  medium?: RenditionFormats;
  large?: RenditionFormats;
  original?: RenditionFormats;
}

/**
 * Job data for processing image renditions
 */
export interface ImageRenditionJobData {
  /** Original image S3 key */
  originalS3Key: string;
  /** S3 bucket name */
  bucket: string;
  /** User ID for path construction */
  userId: string;
  /** Session ID for path construction */
  sessionId: string;
  /** Cache key for unique identification */
  cacheKey: string;
  /** Image ID in database (companion_images.id) */
  imageId: string;
  /** Whether this is an anchor image */
  isAnchor?: boolean;
  /** Companion ID if this is a companion image */
  companionId?: string;
}

/**
 * Result of rendition processing
 */
export interface ImageRenditionResult {
  /** Image ID that was processed */
  imageId: string;
  /** Generated renditions */
  renditions: ImageRenditions;
  /** Total processing time in ms */
  processingTimeMs: number;
  /** Total bytes saved compared to serving original for all sizes */
  bytesSaved: number;
}

/**
 * Get the S3 key prefix for renditions
 */
export function getRenditionKeyPrefix(
  userId: string,
  sessionId: string,
  cacheKey: string
): string {
  return `companions/${userId}/${sessionId}/${cacheKey}`;
}

/**
 * Get the S3 key for a specific rendition
 */
export function getRenditionS3Key(
  prefix: string,
  size: RenditionSize | 'original',
  format: RenditionFormat
): string {
  return `${prefix}/${size}.${format}`;
}

/**
 * Content type for each format
 */
export const FORMAT_CONTENT_TYPE: Record<RenditionFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
};

/**
 * Priority order for format selection (best first)
 * Client should use the first format it supports
 */
export const FORMAT_PRIORITY: RenditionFormat[] = ['avif', 'webp', 'png'];

/**
 * Sizes to generate for different image types
 */
export const RENDITION_CONFIGS = {
  /** Standard session images - all sizes */
  session: ['thumb', 'small', 'medium', 'large'] as RenditionSize[],
  /** Anchor images - skip thumb as they're not used in lists */
  anchor: ['small', 'medium', 'large'] as RenditionSize[],
  /** Gallery thumbnails only */
  gallery: ['thumb', 'small'] as RenditionSize[],
} as const;

/**
 * Formats to generate (both for broad browser support)
 */
export const FORMATS_TO_GENERATE: RenditionFormat[] = ['webp', 'avif'];
