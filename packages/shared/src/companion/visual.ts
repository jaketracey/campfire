import { z } from 'zod';

// ============================================================================
// Companion Appearance Types (for onboarding image selection)
// ============================================================================

/**
 * Companion gender
 */
export const CompanionGenderSchema = z.enum(['female', 'male']);
export type CompanionGender = z.infer<typeof CompanionGenderSchema>;

/**
 * Ethnicity options (shared across genders)
 */
export const AppearanceEthnicitySchema = z.enum([
  'east-asian',
  'south-asian',
  'black',
  'caucasian',
  'latina',
  'middle-eastern',
  'mixed',
]);
export type AppearanceEthnicity = z.infer<typeof AppearanceEthnicitySchema>;

/**
 * Female body types
 */
export const FemaleBodyTypeSchema = z.enum(['slim', 'athletic', 'curvy', 'plus-size']);
export type FemaleBodyType = z.infer<typeof FemaleBodyTypeSchema>;

/**
 * Male body types
 */
export const MaleBodyTypeSchema = z.enum(['slim', 'athletic', 'muscular', 'dad-bod']);
export type MaleBodyType = z.infer<typeof MaleBodyTypeSchema>;

/**
 * Combined body type (for storage)
 */
export const AppearanceBodyTypeSchema = z.enum([
  'slim', 'athletic', 'curvy', 'plus-size', // Female
  'muscular', 'dad-bod', // Male-specific
]);
export type AppearanceBodyType = z.infer<typeof AppearanceBodyTypeSchema>;

/**
 * Hair color options (shared across genders)
 */
export const AppearanceHairColorSchema = z.enum(['black', 'brown', 'blonde', 'red', 'fantasy']);
export type AppearanceHairColor = z.infer<typeof AppearanceHairColorSchema>;

/**
 * Size category for body measurements (S/M/L)
 */
export const SizeCategorySchema = z.enum(['S', 'M', 'L']);
export type SizeCategory = z.infer<typeof SizeCategorySchema>;

/**
 * Female appearance schema
 */
export const FemaleAppearanceSchema = z.object({
  gender: z.literal('female'),
  ethnicity: AppearanceEthnicitySchema,
  bodyType: FemaleBodyTypeSchema,
  hairColor: AppearanceHairColorSchema,
  breastSize: SizeCategorySchema,
});
export type FemaleAppearance = z.infer<typeof FemaleAppearanceSchema>;

/**
 * Male appearance schema
 */
export const MaleAppearanceSchema = z.object({
  gender: z.literal('male'),
  ethnicity: AppearanceEthnicitySchema,
  bodyType: MaleBodyTypeSchema,
  hairColor: AppearanceHairColorSchema,
  build: SizeCategorySchema,
});
export type MaleAppearance = z.infer<typeof MaleAppearanceSchema>;

/**
 * Combined companion appearance (discriminated union)
 */
export const CompanionAppearanceSchema = z.discriminatedUnion('gender', [
  FemaleAppearanceSchema,
  MaleAppearanceSchema,
]);
export type CompanionAppearance = z.infer<typeof CompanionAppearanceSchema>;

// Type guards
export function isFemaleAppearance(appearance: CompanionAppearance): appearance is FemaleAppearance {
  return appearance.gender === 'female';
}

export function isMaleAppearance(appearance: CompanionAppearance): appearance is MaleAppearance {
  return appearance.gender === 'male';
}

// ============================================================================
// Visual Style Types
// ============================================================================

/**
 * Visual style type
 * @deprecated Style selection removed - always photorealistic
 */
export const VisualStyleTypeSchema = z.enum([
  'realistic',          // Photorealistic
  'anime',              // Anime/manga style
  'cartoon',            // Western cartoon style
  '3d_rendered',        // 3D rendered
  'painterly',          // Painted/artistic
  'pixel_art',          // Pixel art style
  'comic_book',         // Comic book style
  'watercolor',         // Watercolor style
  'minimalist',         // Simple, clean lines
  'custom',             // Custom defined style
]);

export type VisualStyleType = z.infer<typeof VisualStyleTypeSchema>;

/**
 * Color in hex format
 */
export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export type HexColor = z.infer<typeof HexColorSchema>;

/**
 * Color palette for the companion
 */
export const ColorPaletteSchema = z.object({
  /** Primary color */
  primary: HexColorSchema,
  /** Secondary color */
  secondary: HexColorSchema,
  /** Accent color */
  accent: HexColorSchema,
  /** Background color preference */
  background: HexColorSchema.optional(),
  /** Additional colors */
  additional: z.array(HexColorSchema).max(5).optional(),
});

export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

/**
 * Physical appearance attributes
 */
export const PhysicalAttributesSchema = z.object({
  /** Apparent age range */
  apparentAge: z.enum(['teen', 'young_adult', 'adult', 'middle_aged', 'elderly', 'ageless']),
  /** Hair color description */
  hairColor: z.string().max(50).optional(),
  /** Hair style description */
  hairStyle: z.string().max(100).optional(),
  /** Eye color description */
  eyeColor: z.string().max(50).optional(),
  /** Skin tone description */
  skinTone: z.string().max(50).optional(),
  /** Build/body type */
  build: z.string().max(50).optional(),
  /** Notable features (e.g., freckles, glasses, etc.) */
  notableFeatures: z.array(z.string().max(50)).max(10).optional(),
  /** Clothing style */
  clothingStyle: z.string().max(200).optional(),
  /** Accessories */
  accessories: z.array(z.string().max(50)).max(10).optional(),
});

export type PhysicalAttributes = z.infer<typeof PhysicalAttributesSchema>;

/**
 * Reference asset for visual consistency
 */
export const ReferenceAssetSchema = z.object({
  /** Asset ID */
  assetId: z.string().min(1),
  /** Asset type */
  type: z.enum(['identity_anchor', 'style_reference', 'pose_reference', 'expression_reference']),
  /** Storage key */
  storageKey: z.string().min(1),
  /** URL */
  url: z.string().url(),
  /** Weight for this reference (0-1) */
  weight: z.number().min(0).max(1).default(1),
  /** Whether this is locked (cannot be changed) */
  isLocked: z.boolean().default(false),
  /** Creation timestamp */
  createdAt: z.string().datetime({ offset: true }),
});

export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;

/**
 * Visual constraints for generation
 */
export const VisualConstraintsSchema = z.object({
  /** Content rating */
  contentRating: z.enum(['g', 'pg', 'pg13']),
  /** Allowed pose types */
  allowedPoseTypes: z.array(z.enum([
    'portrait',
    'headshot',
    'bust',
    'full_body',
    'action',
    'sitting',
    'standing',
  ])).min(1),
  /** Banned elements (for safety/consistency) */
  bannedElements: z.array(z.string()).optional(),
  /** Required elements (must appear in all generations) */
  requiredElements: z.array(z.string()).optional(),
  /** Maximum image size */
  maxImageSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
});

export type VisualConstraints = z.infer<typeof VisualConstraintsSchema>;

/**
 * Complete visual style bible
 * Section 7.1 of plan.md: visual style bible (style type, palette, constraints, reference assets)
 */
export const CompanionVisualStyleSchema = z.object({
  /** Visual style type */
  styleType: VisualStyleTypeSchema,
  /** Color palette */
  colorPalette: ColorPaletteSchema,
  /** Physical attributes */
  physicalAttributes: PhysicalAttributesSchema,
  /** Reference assets for consistency */
  referenceAssets: z.array(ReferenceAssetSchema).max(10),
  /** Visual constraints */
  constraints: VisualConstraintsSchema,
  /** Style-specific prompt modifiers */
  styleModifiers: z.array(z.string()).max(20).optional(),
  /** Negative prompt elements */
  negativePromptElements: z.array(z.string()).max(20).optional(),
  /** Custom style description */
  customStyleDescription: z.string().max(500).optional(),
});

export type CompanionVisualStyle = z.infer<typeof CompanionVisualStyleSchema>;
