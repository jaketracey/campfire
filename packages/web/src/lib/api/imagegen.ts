/**
 * Image Generation API Client
 * Handles companion image generation via FAL.ai
 */

import { post, get } from './client';

export interface PersonalitySliders {
  warmth?: number;
  playfulness?: number;
  directness?: number;
  curiosity?: number;
  empathy?: number;
  assertiveness?: number;
}

export interface ImageGenRequest {
  prompt: string;
  emotionalState?: string;
  personality?: PersonalitySliders;
  style?: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  width?: number;
  height?: number;
  cacheKey?: string;
  userId?: string;
  sessionId?: string;
  companionId?: string;
  saveToS3?: boolean;
  referenceImageUrl?: string;  // Identity anchor for character consistency
  referenceStrength?: number;  // How strongly to follow reference (0.0-1.0)
}

export interface ImageGenResult {
  imageUrl: string;
  cacheKey: string;
  width: number;
  height: number;
  latencyMs: number;
  cached: boolean;
  s3Key?: string;
  imageId?: string;
}

export interface GalleryImage {
  id: string;
  user_id: string;
  session_id: string;
  companion_id: string | null;
  s3_key: string;
  s3_url: string;
  width: number;
  height: number;
  format: string;
  size_bytes: number | null;
  emotional_state: EmotionalState;
  style: string;
  prompt: string | null;
  cache_key: string;
  provider: string;
  latency_ms: number | null;
  created_at: string;
}

export interface GalleryResponse {
  images: GalleryImage[];
  count: number;
  sessionId: string;
}

// Anchor image generation types
export interface GenerateAnchorsRequest {
  companionId: string;
  appearance: {
    ethnicity: string;
    bodyType: string;
    hairColor: string;
    breastSize?: number;
  };
  style: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  personality?: PersonalitySliders;
}

export interface AnchorImage {
  id: string;
  url: string;
  emotionalState: string;
  isIdentityAnchor: boolean;
}

export interface GenerateAnchorsResult {
  companionId: string;
  anchors: AnchorImage[];
  primaryAnchorId: string;
}

/**
 * Generate a companion image based on emotional state and personality
 */
export async function generateCompanionImage(
  request: ImageGenRequest
): Promise<ImageGenResult> {
  return post<ImageGenResult>('/imagegen/generate', {
    ...request,
    width: request.width || 250,
    height: request.height || 400,
  });
}

/**
 * Get a cached image by its cache key
 */
export async function getCachedImage(cacheKey: string): Promise<ImageGenResult | null> {
  try {
    return await get<ImageGenResult>(`/imagegen/cache/${cacheKey}`);
  } catch {
    return null;
  }
}

/**
 * Pre-defined emotional states for companions
 */
export const emotionalStates = [
  'happy',
  'calm',
  'curious',
  'excited',
  'thoughtful',
  'supportive',
  'playful',
  'neutral',
] as const;

export type EmotionalState = (typeof emotionalStates)[number];

// Import CompanionVisualStyle from companions (it's exported from there)
import type { CompanionVisualStyle } from './companions';

/**
 * Generate a base companion prompt based on style
 * For adult companion app - prompts are sensual/intimate by default
 */
export function getBasePrompt(style: ImageGenRequest['style']): string {
  const basePrompts: Record<string, string> = {
    realistic: 'Beautiful woman, sensual portrait, intimate boudoir photography, soft lighting, alluring gaze',
    stylized: 'Beautiful stylized woman, sensual expression, soft romantic lighting, intimate mood, alluring',
    abstract: 'Ethereal feminine form, sensual abstract art, flowing curves, romantic lighting',
    minimal: 'Elegant minimalist portrait, sensual lines, tasteful intimate aesthetic',
    anime: 'Beautiful anime woman, sensual expression, romantic illustration, alluring eyes',
  };

  return basePrompts[style || 'stylized'] || basePrompts.stylized;
}

/**
 * Build a detailed prompt from companion visual data
 * This creates a consistent character prompt based on the companion's spec
 *
 * @throws Error if visualStyle is undefined - we want to debug missing visual data
 */
export function buildPromptFromCompanion(
  visualStyle: CompanionVisualStyle,
  style: ImageGenRequest['style'] = 'stylized'
): string {
  if (!visualStyle) {
    throw new Error(
      'buildPromptFromCompanion: visualStyle is required. ' +
      'Check that companion.spec.visual_style is populated.'
    );
  }

  const parts: string[] = [];

  // Base description
  if (visualStyle.custom_style_description) {
    parts.push(visualStyle.custom_style_description);
  } else {
    parts.push('Beautiful woman');
  }

  // Use appearance data (from onboarding) - this is what's actually saved
  const appearance = visualStyle.appearance;
  if (appearance) {
    // Ethnicity mapping to descriptive terms
    const ethnicityMap: Record<string, string> = {
      'east-asian': 'East Asian features',
      'south-asian': 'South Asian features',
      'black': 'Black/African features',
      'caucasian': 'Caucasian features',
      'latina': 'Latina features',
      'middle-eastern': 'Middle Eastern features',
      'mixed': 'mixed ethnicity',
    };
    if (appearance.ethnicity && ethnicityMap[appearance.ethnicity]) {
      parts.push(ethnicityMap[appearance.ethnicity]);
    }

    // Body type
    const bodyTypeMap: Record<string, string> = {
      'slim': 'slim figure',
      'athletic': 'athletic build',
      'curvy': 'curvy figure',
      'plus-size': 'plus-size figure',
    };
    if (appearance.bodyType && bodyTypeMap[appearance.bodyType]) {
      parts.push(bodyTypeMap[appearance.bodyType]);
    }

    // Hair color
    const hairColorMap: Record<string, string> = {
      'black': 'black hair',
      'brown': 'brown hair',
      'blonde': 'blonde hair',
      'red': 'red hair',
      'fantasy': 'vibrant fantasy-colored hair',
    };
    if (appearance.hairColor && hairColorMap[appearance.hairColor]) {
      parts.push(hairColorMap[appearance.hairColor]);
    }
  }

  // Fallback to physical_attributes if available (legacy/detailed specs)
  const attrs = visualStyle.physical_attributes;
  if (attrs) {
    // Age
    if (attrs.apparent_age) {
      const ageMap: Record<string, string> = {
        'young_adult': 'young adult woman in her 20s',
        'adult': 'woman in her 30s',
        'middle_aged': 'mature woman',
      };
      if (ageMap[attrs.apparent_age]) {
        parts.push(ageMap[attrs.apparent_age]);
      }
    }

    // Hair (only if not already added from appearance)
    if (!appearance?.hairColor && (attrs.hair_color || attrs.hair_style)) {
      const hairDesc = [attrs.hair_color, attrs.hair_style].filter(Boolean).join(' ');
      if (hairDesc) {
        parts.push(`${hairDesc} hair`);
      }
    }

    // Eyes
    if (attrs.eye_color) {
      parts.push(`${attrs.eye_color} eyes`);
    }

    // Skin
    if (attrs.skin_tone) {
      parts.push(`${attrs.skin_tone} skin`);
    }

    // Build/body (only if not already added from appearance)
    if (!appearance?.bodyType && attrs.build) {
      parts.push(attrs.build);
    }

    // Notable features
    if (attrs.notable_features?.length) {
      parts.push(attrs.notable_features.join(', '));
    }

    // Clothing
    if (attrs.clothing_style) {
      parts.push(attrs.clothing_style);
    }
  }

  // Style modifiers from spec
  if (visualStyle.style_modifiers?.length) {
    parts.push(visualStyle.style_modifiers.join(', '));
  }

  // Add style-specific quality terms
  const styleQuality: Record<string, string> = {
    realistic: 'photorealistic, highly detailed, 8k, professional boudoir photography, intimate lighting',
    stylized: 'beautiful stylized render, soft romantic lighting, sensual artistic style',
    abstract: 'ethereal sensual art, soft flowing forms, romantic abstract lighting',
    minimal: 'elegant minimalist, tasteful intimate, soft clean aesthetic',
    anime: 'beautiful anime style, expressive sensual, romantic illustration, detailed',
  };

  parts.push(styleQuality[style || 'stylized'] || styleQuality.stylized);
  parts.push('high quality, detailed, beautiful lighting, alluring');

  return parts.join(', ');
}

/**
 * Get all generated images for a session (gallery)
 */
export async function getSessionGallery(
  sessionId: string,
  limit = 50
): Promise<GalleryResponse> {
  return get<GalleryResponse>(`/imagegen/gallery/${sessionId}?limit=${limit}`);
}

/**
 * Generate anchor images for a new companion
 * Creates a set of reference images with different emotional states
 * that will be used for character consistency in future image generation.
 *
 * This is called after companion creation during onboarding to establish
 * the companion's visual identity.
 */
export async function generateAnchorImages(
  request: GenerateAnchorsRequest
): Promise<GenerateAnchorsResult> {
  return post<GenerateAnchorsResult>('/imagegen/generate-anchors', request);
}
