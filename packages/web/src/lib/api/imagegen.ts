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

/**
 * Companion visual style for prompt building
 */
export interface CompanionVisualStyle {
  style_type?: string;
  physical_attributes?: {
    apparent_age?: string;
    hair_color?: string;
    hair_style?: string;
    eye_color?: string;
    skin_tone?: string;
    build?: string;
    notable_features?: string[];
    clothing_style?: string;
    accessories?: string[];
  };
  style_modifiers?: string[];
  custom_style_description?: string;
}

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
 */
export function buildPromptFromCompanion(
  visualStyle: CompanionVisualStyle | undefined,
  style: ImageGenRequest['style'] = 'stylized'
): string {
  if (!visualStyle) {
    return getBasePrompt(style);
  }

  const parts: string[] = [];
  const attrs = visualStyle.physical_attributes;

  // Base description
  if (visualStyle.custom_style_description) {
    parts.push(visualStyle.custom_style_description);
  } else {
    parts.push('Beautiful woman');
  }

  // Physical attributes
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

    // Hair
    if (attrs.hair_color || attrs.hair_style) {
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

    // Build/body
    if (attrs.build) {
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
