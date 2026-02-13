/**
 * Image Generation API Client
 * Handles companion image generation via FAL.ai
 */

import type { ImageRenditions } from '@campfire/shared';
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
  turnId?: string;
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
  turn_id?: string | null;
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
  renditions?: ImageRenditions | null;
}

export interface GalleryResponse {
  images: GalleryImage[];
  count: number;
  sessionId: string;
}

// Import appearance types from companions
import type { CompanionAppearance } from './companions';

export interface GenerateAnchorsRequest {
  companionId: string;
  appearance: CompanionAppearance;
  personality?: PersonalitySliders;
  style?: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
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
  request: ImageGenRequest,
  options?: { signal?: AbortSignal }
): Promise<ImageGenResult> {
  const controller = new AbortController();
  let timedOut = false;
  const handleExternalAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
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
      if (timedOut) {
        console.error('[ImageGen] Request aborted (timeout)');
        throw new Error('Image generation timed out after 120 seconds');
      }
      throw error;
    }
    console.error('[ImageGen] Generation failed:', error);
    throw error;
  } finally {
    if (options?.signal) {
      options.signal.removeEventListener('abort', handleExternalAbort);
    }
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
 * Optimized for photorealistic portrait generation with Seedream 4.5
 */
export function getBasePrompt(style: ImageGenRequest['style'], isMale = false): string {
  const subject = isMale ? 'Handsome man' : 'Beautiful woman';

  const basePrompts: Record<string, string> = {
    realistic: `Portrait photography of a ${subject.toLowerCase()}, natural expression, soft diffused lighting, shallow depth of field, shot on 85mm lens, high resolution`,
    stylized: `${subject}, portrait photography, warm natural lighting, shallow depth of field, photorealistic style`,
    abstract: `Artistic portrait of a ${subject.toLowerCase()}, creative lighting, contemporary photography style`,
    minimal: `Clean portrait of a ${subject.toLowerCase()}, minimalist composition, soft natural light, professional photography`,
    anime: `${subject}, anime art style, expressive features, detailed illustration`,
  };

  return basePrompts[style || 'realistic'] || basePrompts.realistic;
}

/**
 * Build a detailed prompt from companion visual data
 * Optimized for photorealistic portrait generation with Seedream 4.5
 *
 * Follows Seedream best practices:
 * - Subject description FIRST (most important, Seedream weights earlier terms higher)
 * - Natural language descriptions, not keyword stacking
 * - Photography terminology (lens, lighting, depth of field)
 * - 30-100 words, focused and clear
 *
 * @throws Error if visualStyle is undefined - we want to debug missing visual data
 */
export function buildPromptFromCompanion(
  visualStyle: CompanionVisualStyle,
  style: ImageGenRequest['style'] = 'realistic'
): string {
  if (!visualStyle) {
    throw new Error(
      'buildPromptFromCompanion: visualStyle is required. ' +
      'Check that companion.spec.visual_style is populated.'
    );
  }

  // Determine gender first - this affects all descriptions
  const appearance = visualStyle.appearance;
  const isMale = appearance?.gender === 'male';

  // Build subject description (FIRST and most important for Seedream)
  const subjectParts: string[] = [];

  // Gender-appropriate base term
  if (visualStyle.custom_style_description) {
    subjectParts.push(visualStyle.custom_style_description);
  } else {
    subjectParts.push(isMale ? 'Handsome man' : 'Beautiful woman');
  }

  // Physical characteristics in natural order
  if (appearance) {
    // Ethnicity
    const ethnicityMap: Record<string, string> = {
      'east-asian': 'East Asian',
      'south-asian': 'South Asian',
      'black': 'Black',
      'caucasian': 'Caucasian',
      'latina': isMale ? 'Latino' : 'Latina',
      'middle-eastern': 'Middle Eastern',
      'mixed': 'mixed ethnicity',
    };
    if (appearance.ethnicity && ethnicityMap[appearance.ethnicity]) {
      subjectParts.push(ethnicityMap[appearance.ethnicity]);
    }

    // Body type with natural phrasing
    const bodyTypeMap: Record<string, string> = {
      'slim': 'with a slim build',
      'athletic': 'with an athletic build',
      'curvy': 'with a curvy figure',
      'plus-size': 'with a full figure',
      'muscular': 'with a muscular build',
      'dad-bod': 'with an average build',
    };
    if (appearance.bodyType && bodyTypeMap[appearance.bodyType]) {
      subjectParts.push(bodyTypeMap[appearance.bodyType]);
    }

    // Hair - natural phrasing
    const hairColorMap: Record<string, string> = {
      'black': 'black hair',
      'brown': 'brown hair',
      'blonde': 'blonde hair',
      'red': 'red hair',
      'fantasy': 'colorful hair',
    };
    if (appearance.hairColor && hairColorMap[appearance.hairColor]) {
      subjectParts.push(hairColorMap[appearance.hairColor]);
    }
  }

  // Add physical attributes if available (eye color, skin tone, etc.)
  const attrs = visualStyle.physical_attributes;
  if (attrs) {
    if (attrs.eye_color) {
      subjectParts.push(`${attrs.eye_color} eyes`);
    }
    if (attrs.skin_tone) {
      subjectParts.push(`${attrs.skin_tone} skin`);
    }
    if (attrs.notable_features?.length) {
      subjectParts.push(attrs.notable_features.slice(0, 2).join(' and '));
    }
  }

  // Build the subject description as a coherent sentence
  const subjectDesc = subjectParts.join(', ');

  // Photography and technical terms based on style
  const photoTerms: Record<string, string> = {
    realistic: 'portrait photography, natural relaxed expression, soft diffused studio lighting, shallow depth of field, shot on 85mm lens, photorealistic, high resolution',
    stylized: 'portrait photography, warm natural lighting, shallow depth of field, cinematic style, photorealistic',
    abstract: 'artistic portrait, creative studio lighting, contemporary photography, high detail',
    minimal: 'clean portrait, minimalist composition, soft natural light, professional photography, high resolution',
    anime: 'anime art style, detailed illustration, expressive features, high quality artwork',
  };

  const selectedStyle = style || 'realistic';
  const photography = photoTerms[selectedStyle] || photoTerms.realistic;

  // Combine into final prompt: Subject first, then photography terms
  return `${subjectDesc}. ${photography}`;
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
    style: request.style || 'realistic',
  });

  if (request.personality) {
    params.set('personality', JSON.stringify(request.personality));
  }

  const url = `${baseUrl}/api/v1/imagegen/generate-anchors-stream?${params.toString()}`;
  console.log('[SSE] URL:', url);

  // Create SSE stream with fetch + reader so we can attach auth headers.
  let aborted = false;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const connectSSE = async () => {
    try {
      console.log('[SSE] Connecting to:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
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

      reader = response.body?.getReader() ?? null;
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
      if (aborted || controller.signal.aborted) {
        return;
      }
      console.error('[SSE] Error:', error);
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
  };

  connectSSE();

  // Return cleanup function
  return () => {
    aborted = true;
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {
        // Reader may already be closed; ignore.
      });
    }
  };
}
