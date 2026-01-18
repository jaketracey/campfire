/**
 * Image Rendition Selection Utilities
 *
 * Helps select the optimal image rendition based on display size and browser support.
 */

import type {
  ImageRenditions,
  RenditionSize,
  RenditionFormat,
  RenditionFormats,
} from '@campfire/shared';

// Re-export types for convenience
export type { ImageRenditions, RenditionSize, RenditionFormat };

/**
 * Size thresholds for selecting appropriate rendition
 * Maps display width to the recommended rendition size
 */
const SIZE_THRESHOLDS: Array<{ maxWidth: number; size: RenditionSize }> = [
  { maxWidth: 150, size: 'thumb' },    // 128x192
  { maxWidth: 300, size: 'small' },    // 256x384
  { maxWidth: 600, size: 'medium' },   // 512x768
  { maxWidth: Infinity, size: 'large' }, // 832x1248
];

/**
 * Check if the browser supports a specific image format
 */
function checkFormatSupport(format: RenditionFormat): boolean {
  if (typeof document === 'undefined') {
    // SSR: assume WebP support, not AVIF
    return format !== 'avif';
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  switch (format) {
    case 'avif':
      return canvas.toDataURL('image/avif').startsWith('data:image/avif');
    case 'webp':
      return canvas.toDataURL('image/webp').startsWith('data:image/webp');
    case 'png':
      return true; // PNG is always supported
    default:
      return false;
  }
}

// Cache format support results
let formatSupportCache: Record<RenditionFormat, boolean> | null = null;

function getFormatSupport(): Record<RenditionFormat, boolean> {
  if (formatSupportCache) return formatSupportCache;

  formatSupportCache = {
    avif: checkFormatSupport('avif'),
    webp: checkFormatSupport('webp'),
    png: checkFormatSupport('png'),
  };

  return formatSupportCache;
}

/**
 * Format priority order (best first)
 */
const FORMAT_PRIORITY: RenditionFormat[] = ['avif', 'webp', 'png'];

/**
 * Select the best format from available formats based on browser support
 */
function selectBestFormat(formats: RenditionFormats): string | null {
  const support = getFormatSupport();

  for (const format of FORMAT_PRIORITY) {
    if (support[format] && formats[format]?.url) {
      return formats[format]!.url;
    }
  }

  return null;
}

/**
 * Select the appropriate rendition size based on display dimensions
 */
function selectSize(displayWidth: number): RenditionSize {
  // Account for device pixel ratio for crisp images on high-DPI displays
  const effectiveWidth =
    displayWidth * (typeof window !== 'undefined' ? window.devicePixelRatio : 1);

  for (const { maxWidth, size } of SIZE_THRESHOLDS) {
    if (effectiveWidth <= maxWidth) {
      return size;
    }
  }

  return 'large';
}

/**
 * Options for selecting a rendition
 */
export interface SelectRenditionOptions {
  /** Display width in CSS pixels */
  displayWidth: number;
  /** Preferred size override (skip auto-detection) */
  preferredSize?: RenditionSize;
  /** Whether to fall back to original if no renditions available */
  fallbackToOriginal?: boolean;
}

/**
 * Select the best rendition URL based on display size and browser support
 *
 * @param renditions - The renditions object from the API
 * @param options - Selection options
 * @returns The URL of the best rendition, or null if none available
 */
export function selectRenditionUrl(
  renditions: ImageRenditions | null | undefined,
  options: SelectRenditionOptions
): string | null {
  if (!renditions) return null;

  const { displayWidth, preferredSize, fallbackToOriginal = true } = options;

  // Determine target size
  const targetSize = preferredSize || selectSize(displayWidth);

  // Try the target size first
  const sizeFormats = renditions[targetSize];
  if (sizeFormats) {
    const url = selectBestFormat(sizeFormats);
    if (url) return url;
  }

  // If target size not available, try larger sizes
  const sizePriority: RenditionSize[] = ['thumb', 'small', 'medium', 'large'];
  const startIndex = sizePriority.indexOf(targetSize);

  for (let i = startIndex + 1; i < sizePriority.length; i++) {
    const formats = renditions[sizePriority[i]];
    if (formats) {
      const url = selectBestFormat(formats);
      if (url) return url;
    }
  }

  // Fall back to original if allowed
  if (fallbackToOriginal && renditions.original) {
    const url = selectBestFormat(renditions.original);
    if (url) return url;
  }

  return null;
}

/**
 * Get the optimal avatar URL, preferring renditions over original
 *
 * @param avatarUrl - The original avatar URL
 * @param renditions - The renditions object
 * @param displayWidth - The display width in CSS pixels
 * @returns The best URL to use for the avatar
 */
export function getOptimalAvatarUrl(
  avatarUrl: string | null | undefined,
  renditions: ImageRenditions | null | undefined,
  displayWidth: number
): string | null {
  // Try to get a rendition first
  const renditionUrl = selectRenditionUrl(renditions, { displayWidth });
  if (renditionUrl) return renditionUrl;

  // Fall back to original URL
  return avatarUrl || null;
}
