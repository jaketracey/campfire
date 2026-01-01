/**
 * Companion Asset Utilities
 * Maps companion appearance settings to pre-generated variation images.
 *
 * These images serve as identity anchors for IP-Adapter based generation,
 * ensuring consistent character appearance across all generated images.
 */

import type { CompanionAppearance } from '../db/types.js';

// Re-export types for convenience
export type { CompanionAppearance };

// Type aliases for component types
export type AppearanceEthnicity = CompanionAppearance['ethnicity'];
export type AppearanceBodyType = CompanionAppearance['bodyType'];
export type AppearanceHairColor = CompanionAppearance['hairColor'];

// Alias for backwards compatibility
export type PhysicalAppearance = CompanionAppearance;

// S3 configuration for companion assets
const S3_REGION = process.env['AWS_REGION'] || 'us-east-1';
const S3_MEDIA_BUCKET = process.env['S3_MEDIA_BUCKET'] || 'campfire-dev-media';
const S3_COMPANIONS_PREFIX = 'companions/variations';
const S3_ANCHORS_PREFIX = 'companions/anchors';

// Build S3 URL for variation images
const getS3Url = (key: string): string => {
  return `https://${S3_MEDIA_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
};

/**
 * Get the variation image filename for a given appearance combination.
 * Format: {ethnicity}-{bodyType}-{hairColor}.png
 *
 * Example: "east-asian-slim-blonde.png"
 */
export function getVariationFilename(appearance: PhysicalAppearance): string {
  const { ethnicity, bodyType, hairColor } = appearance;
  return `${ethnicity}-${bodyType}-${hairColor}.png`;
}

/**
 * Get the anchor image filename for a given ethnicity.
 * These are the base faces used to generate variations.
 * Format: {ethnicity}.png
 *
 * Example: "east-asian.png"
 */
export function getAnchorFilename(ethnicity: AppearanceEthnicity): string {
  return `${ethnicity}.png`;
}

/**
 * Get the S3 key for a variation image.
 * Used for direct S3 operations.
 */
export function getVariationS3Key(appearance: PhysicalAppearance): string {
  return `${S3_COMPANIONS_PREFIX}/${getVariationFilename(appearance)}`;
}

/**
 * Get the S3 key for an anchor image.
 */
export function getAnchorS3Key(ethnicity: AppearanceEthnicity): string {
  return `${S3_ANCHORS_PREFIX}/${getAnchorFilename(ethnicity)}`;
}

/**
 * Get the full S3 URL for a variation image.
 */
export function getVariationUrl(appearance: PhysicalAppearance): string {
  return getS3Url(getVariationS3Key(appearance));
}

/**
 * Get the full S3 URL for an anchor image.
 */
export function getAnchorUrl(ethnicity: AppearanceEthnicity): string {
  return getS3Url(getAnchorS3Key(ethnicity));
}

// Valid options
const VALID_ETHNICITIES: AppearanceEthnicity[] = [
  'east-asian', 'south-asian', 'black', 'caucasian',
  'latina', 'middle-eastern', 'mixed'
];
const VALID_BODY_TYPES: AppearanceBodyType[] = [
  'slim', 'athletic', 'curvy', 'plus-size'
];
const VALID_HAIR_COLORS: AppearanceHairColor[] = [
  'black', 'brown', 'blonde', 'red', 'fantasy'
];

/**
 * Validate that an appearance combination is valid.
 * All valid combinations should have pre-generated images.
 */
export function isValidAppearance(appearance: CompanionAppearance): boolean {
  return (
    VALID_ETHNICITIES.includes(appearance.ethnicity) &&
    VALID_BODY_TYPES.includes(appearance.bodyType) &&
    VALID_HAIR_COLORS.includes(appearance.hairColor)
  );
}

/**
 * Get appearance from companion spec's visual_style.
 * Handles legacy specs that may not have appearance data.
 */
export function getAppearanceFromSpec(spec: {
  visual_style?: {
    appearance?: CompanionAppearance;
  };
}): CompanionAppearance | null {
  const appearance = spec?.visual_style?.appearance;

  if (!appearance) {
    return null;
  }

  if (!isValidAppearance(appearance)) {
    return null;
  }

  return appearance;
}

/**
 * Build the identity anchor reference URL for a companion.
 * This URL is passed to the orchestrator for IP-Adapter generation.
 * Uses S3 for storage.
 *
 * @param appearance - The companion's physical appearance settings
 * @returns Absolute URL to the variation image on S3
 */
export function buildIdentityAnchorUrl(appearance: PhysicalAppearance): string {
  return getVariationUrl(appearance);
}

/**
 * Get all valid appearance combinations.
 * Useful for validation and preloading.
 */
export function getAllAppearanceCombinations(): CompanionAppearance[] {
  const combinations: CompanionAppearance[] = [];

  for (const ethnicity of VALID_ETHNICITIES) {
    for (const bodyType of VALID_BODY_TYPES) {
      for (const hairColor of VALID_HAIR_COLORS) {
        combinations.push({ ethnicity, bodyType, hairColor });
      }
    }
  }

  return combinations;
}

/**
 * Total number of pre-generated variation images.
 * 7 ethnicities × 4 body types × 5 hair colors = 140
 */
export const TOTAL_VARIATIONS = 7 * 4 * 5; // 140
