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
}

export interface ImageGenResult {
  imageUrl: string;
  cacheKey: string;
  width: number;
  height: number;
  latencyMs: number;
  cached: boolean;
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
 * Generate a base companion prompt based on style
 */
export function getBasePrompt(style: ImageGenRequest['style']): string {
  const basePrompts: Record<string, string> = {
    realistic: 'Portrait of a friendly AI companion, human-like appearance, professional headshot',
    stylized: 'Friendly 3D animated character companion, expressive face, warm presence',
    abstract: 'Abstract representation of an AI companion, glowing orb with ethereal features',
    minimal: 'Minimalist avatar, simple geometric face, clean design, friendly expression',
    anime: 'Anime-style AI companion character, expressive eyes, friendly demeanor',
  };

  return basePrompts[style || 'stylized'] || basePrompts.stylized;
}
