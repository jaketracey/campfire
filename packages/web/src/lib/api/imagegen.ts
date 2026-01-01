/**
 * Image Generation API Client
 * Handles companion image generation via FAL.ai
 */

import { apiClient, get, post } from './client';
import { getAccessToken } from '@/stores/auth-store';

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
 * Uses a 120 second timeout to allow for ComfyUI generation
 */
export async function generateCompanionImage(
  request: ImageGenRequest
): Promise<ImageGenResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn('[ImageGen] Request timed out after 120s');
    controller.abort();
  }, 120000); // 120s timeout to match orchestrator max_wait

  try {
    console.log('[ImageGen] Calling /imagegen/generate with:', {
      prompt: request.prompt?.slice(0, 50),
      emotionalState: request.emotionalState,
      companionId: request.companionId,
      userId: request.userId,
      sessionId: request.sessionId,
      saveToS3: !!(request.userId && request.sessionId),
    });

    const result = await apiClient<ImageGenResult>('/imagegen/generate', {
      method: 'POST',
      body: JSON.stringify({
        ...request,
        width: request.width || 832,
        height: request.height || 1248,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    console.log('[ImageGen] Generation successful:', {
      cached: result.cached,
      latencyMs: result.latencyMs,
      s3Key: result.s3Key,
      imageId: result.imageId,
      imageUrlPrefix: result.imageUrl?.slice(0, 50),
    });

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[ImageGen] Request aborted (timeout)');
      throw new Error('Image generation timed out after 120 seconds');
    }
    console.error('[ImageGen] Generation failed:', error);
    throw error;
  }
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

/**
 * SSE streaming version of anchor image generation
 * Streams each anchor image as it's generated for real-time progress updates
 */
export interface AnchorStreamCallbacks {
  onProgress?: (data: { phase: string; emotionalState?: string; index?: number; total: number; completed: number }) => void;
  onAnchor?: (anchor: AnchorImage) => void;
  onComplete?: (result: GenerateAnchorsResult) => void;
  onError?: (error: { message: string; partialAnchors?: AnchorImage[] }) => void;
}

export function streamAnchorImages(
  request: GenerateAnchorsRequest,
  callbacks: AnchorStreamCallbacks
): () => void {
  console.log('[SSE] streamAnchorImages called with:', {
    companionId: request.companionId,
    style: request.style,
    appearance: request.appearance,
  });

  // Get the access token from auth store (same as other API calls)
  const token = getAccessToken();

  console.log('[SSE] Token found:', !!token, token ? `${token.slice(0, 20)}...` : 'none');

  if (!token) {
    console.error('[SSE] No token found');
    callbacks.onError?.({ message: 'Not authenticated - no token found' });
    return () => {};
  }

  // Build SSE URL with query params
  const baseUrl = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3002'
    : '';

  const params = new URLSearchParams({
    companionId: request.companionId,
    appearance: JSON.stringify(request.appearance),
    style: request.style,
  });

  if (request.personality) {
    params.set('personality', JSON.stringify(request.personality));
  }

  const url = `${baseUrl}/api/v1/imagegen/generate-anchors-stream?${params.toString()}`;
  console.log('[SSE] URL:', url);

  // Create EventSource with auth header via fetch
  let aborted = false;

  const connectSSE = async () => {
    try {
      console.log('[SSE] Connecting to:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
      });

      console.log('[SSE] Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

      if (!response.ok) {
        let errorBody = '';
        let errorMessage = response.statusText;
        try {
          errorBody = await response.text();
          // Try to parse as JSON for better error messages
          const errorJson = JSON.parse(errorBody);
          errorMessage = errorJson.message || errorJson.error || errorBody;
        } catch {
          if (errorBody) errorMessage = errorBody;
        }
        console.error('[SSE] Connection failed:', response.status, errorMessage);
        throw new Error(errorMessage || `SSE connection failed: ${response.status}`);
      }

      // Verify we got an SSE response
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        console.warn('[SSE] Unexpected content type:', contentType);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          // Skip empty lines and comment lines (heartbeats)
          if (line === '' || line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);

            try {
              const data = JSON.parse(currentData);
              console.log(`[SSE] Event: ${currentEvent}`, data);

              switch (currentEvent) {
                case 'progress':
                  callbacks.onProgress?.(data);
                  break;
                case 'anchor':
                  console.log('[SSE] Anchor received, calling onAnchor callback');
                  callbacks.onAnchor?.(data);
                  break;
                case 'complete':
                  console.log('[SSE] Complete received');
                  callbacks.onComplete?.(data);
                  break;
                case 'error':
                  console.error('[SSE] Error event received:', data);
                  callbacks.onError?.(data);
                  break;
                default:
                  console.warn('[SSE] Unknown event type:', currentEvent);
              }
            } catch (e) {
              console.error('[SSE] Failed to parse SSE data:', currentData, e);
            }

            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (error) {
      console.error('[SSE] Error:', error);
      if (!aborted) {
        let message = 'Unknown error';
        if (error instanceof Error) {
          message = error.message;
        } else if (typeof error === 'string') {
          message = error;
        } else if (error && typeof error === 'object') {
          // Check for common error properties
          const errObj = error as Record<string, unknown>;
          if (typeof errObj.message === 'string') {
            message = errObj.message;
          } else if (typeof errObj.error === 'string') {
            message = errObj.error;
          } else {
            const json = JSON.stringify(error);
            if (json && json !== '{}') {
              message = json;
            }
          }
        }
        callbacks.onError?.({ message });
      }
    }
  };

  connectSSE();

  // Return cleanup function
  return () => {
    aborted = true;
  };
}
