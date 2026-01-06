/**
 * Companion Asset Utilities
 * Maps companion appearance settings to pre-generated variation images.
 *
 * These images serve as identity anchors for IP-Adapter based generation,
 * ensuring consistent character appearance across all generated images.
 *
 * Image structure:
 * - Female: /images/companions/female/{ethnicity}-{bodyType}-{hairColor}-b{S|M|L}.png
 * - Male: /images/companions/male/{ethnicity}-{bodyType}-{hairColor}-build{S|M|L}.png
 */

import type {
  CompanionAppearance,
  CompanionGender,
  FemaleAppearance,
  MaleAppearance,
  FemaleBodyType,
  MaleBodyType,
  AppearanceEthnicity,
  AppearanceHairColor,
  SizeCategory,
} from '../db/types.js';

import {
  isFemaleAppearance,
  isMaleAppearance,
} from '../db/types.js';
import { env } from '../env.js';

// Re-export types for convenience
export type {
  CompanionAppearance,
  CompanionGender,
  FemaleAppearance,
  MaleAppearance,
  FemaleBodyType,
  MaleBodyType,
  AppearanceEthnicity,
  AppearanceHairColor,
  SizeCategory,
};
export { isFemaleAppearance, isMaleAppearance };

// Alias for backwards compatibility
export type PhysicalAppearance = CompanionAppearance;

// S3 configuration for companion assets
const S3_REGION = env.AWS_REGION;
const S3_MEDIA_BUCKET = env.S3_MEDIA_BUCKET;
const S3_COMPANIONS_PREFIX = 'companions/variations';
const S3_ANCHORS_PREFIX = 'companions/anchors';

// Build S3 URL for variation images
const getS3Url = (key: string): string => {
  return `https://${S3_MEDIA_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
};

// Valid options
const VALID_ETHNICITIES: AppearanceEthnicity[] = [
  'east-asian', 'south-asian', 'black', 'caucasian',
  'latina', 'middle-eastern', 'mixed'
];
const VALID_FEMALE_BODY_TYPES: FemaleBodyType[] = [
  'slim', 'athletic', 'curvy', 'plus-size'
];
const VALID_MALE_BODY_TYPES: MaleBodyType[] = [
  'slim', 'athletic', 'muscular', 'dad-bod'
];
const VALID_HAIR_COLORS: AppearanceHairColor[] = [
  'black', 'brown', 'blonde', 'red', 'fantasy'
];
const VALID_SIZE_CATEGORIES: SizeCategory[] = ['S', 'M', 'L'];

/**
 * Get the variation image filename for a given appearance combination.
 *
 * Female format: {ethnicity}-{bodyType}-{hairColor}-b{S|M|L}.png
 * Male format: {ethnicity}-{bodyType}-{hairColor}-build{S|M|L}.png
 *
 * Example: "female/east-asian-slim-blonde-bM.png"
 */
export function getVariationFilename(appearance: PhysicalAppearance): string {
  const { gender, ethnicity, bodyType, hairColor } = appearance;

  if (gender === 'female') {
    const femaleAppearance = appearance as FemaleAppearance;
    return `female/${ethnicity}-${bodyType}-${hairColor}-b${femaleAppearance.breastSize}.png`;
  } else {
    const maleAppearance = appearance as MaleAppearance;
    return `male/${ethnicity}-${bodyType}-${hairColor}-build${maleAppearance.build}.png`;
  }
}

/**
 * Get the anchor image filename for a given ethnicity and gender.
 * These are the base faces used to generate variations.
 * Format: {gender}/{ethnicity}.png
 *
 * Example: "female/east-asian.png"
 */
export function getAnchorFilename(
  ethnicity: AppearanceEthnicity,
  gender: CompanionGender = 'female'
): string {
  return `${gender}/${ethnicity}.png`;
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
export function getAnchorS3Key(
  ethnicity: AppearanceEthnicity,
  gender: CompanionGender = 'female'
): string {
  return `${S3_ANCHORS_PREFIX}/${getAnchorFilename(ethnicity, gender)}`;
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
export function getAnchorUrl(
  ethnicity: AppearanceEthnicity,
  gender: CompanionGender = 'female'
): string {
  return getS3Url(getAnchorS3Key(ethnicity, gender));
}

/**
 * Validate that an appearance combination is valid.
 * All valid combinations should have pre-generated images.
 */
export function isValidAppearance(appearance: CompanionAppearance): boolean {
  const { gender, ethnicity, hairColor } = appearance;

  // Check common fields
  if (!VALID_ETHNICITIES.includes(ethnicity)) return false;
  if (!VALID_HAIR_COLORS.includes(hairColor)) return false;

  // Check gender-specific fields
  if (gender === 'female') {
    const femaleAppearance = appearance as FemaleAppearance;
    if (!VALID_FEMALE_BODY_TYPES.includes(femaleAppearance.bodyType)) return false;
    if (!VALID_SIZE_CATEGORIES.includes(femaleAppearance.breastSize)) return false;
  } else if (gender === 'male') {
    const maleAppearance = appearance as MaleAppearance;
    if (!VALID_MALE_BODY_TYPES.includes(maleAppearance.bodyType)) return false;
    if (!VALID_SIZE_CATEGORIES.includes(maleAppearance.build)) return false;
  } else {
    return false; // Invalid gender
  }

  return true;
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

  // Handle legacy specs without gender (default to female)
  if (!('gender' in appearance)) {
    const legacyAppearance = appearance as unknown as {
      ethnicity: AppearanceEthnicity;
      bodyType: string;
      hairColor: AppearanceHairColor;
      breastSize?: number | SizeCategory;
    };

    // Convert legacy breastSize to SizeCategory
    let breastSize: SizeCategory = 'M';
    if (typeof legacyAppearance.breastSize === 'number') {
      if (legacyAppearance.breastSize <= 33) breastSize = 'S';
      else if (legacyAppearance.breastSize <= 66) breastSize = 'M';
      else breastSize = 'L';
    } else if (legacyAppearance.breastSize) {
      breastSize = legacyAppearance.breastSize;
    }

    return {
      gender: 'female',
      ethnicity: legacyAppearance.ethnicity,
      bodyType: legacyAppearance.bodyType as FemaleBodyType,
      hairColor: legacyAppearance.hairColor,
      breastSize,
    } as FemaleAppearance;
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
 * Get all valid appearance combinations for a given gender.
 * Useful for validation and preloading.
 */
export function getAllAppearanceCombinations(gender?: CompanionGender): CompanionAppearance[] {
  const combinations: CompanionAppearance[] = [];
  const genders: CompanionGender[] = gender ? [gender] : ['female', 'male'];

  for (const g of genders) {
    const bodyTypes = g === 'female' ? VALID_FEMALE_BODY_TYPES : VALID_MALE_BODY_TYPES;

    for (const ethnicity of VALID_ETHNICITIES) {
      for (const bodyType of bodyTypes) {
        for (const hairColor of VALID_HAIR_COLORS) {
          for (const size of VALID_SIZE_CATEGORIES) {
            if (g === 'female') {
              combinations.push({
                gender: 'female',
                ethnicity,
                bodyType: bodyType as FemaleBodyType,
                hairColor,
                breastSize: size,
              } as FemaleAppearance);
            } else {
              combinations.push({
                gender: 'male',
                ethnicity,
                bodyType: bodyType as MaleBodyType,
                hairColor,
                build: size,
              } as MaleAppearance);
            }
          }
        }
      }
    }
  }

  return combinations;
}

/**
 * Total number of pre-generated variation images per gender.
 * 7 ethnicities × 4 body types × 5 hair colors × 3 sizes = 420 per gender
 */
export const VARIATIONS_PER_GENDER = 7 * 4 * 5 * 3; // 420

/**
 * Total number of pre-generated variation images (both genders).
 * 420 female + 420 male = 840 total
 */
export const TOTAL_VARIATIONS = VARIATIONS_PER_GENDER * 2; // 840
