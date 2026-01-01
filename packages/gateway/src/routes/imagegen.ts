/**
 * Image Generation Routes
 * API endpoints for generating companion images via FAL.ai
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { logger } from '../observability/logger.js';

// FAL.ai configuration - loaded at module init
const FAL_BASE_URL = 'https://queue.fal.run';
const FAL_MODEL = process.env['FAL_MODEL'] || 'fal-ai/flux/schnell';

// Get FAL API key - log if missing
function getFalApiKey(): string {
  const key = process.env['FAL_API_KEY'] || '';
  if (!key) {
    logger.warn('FAL_API_KEY not set in environment');
  }
  return key;
}

interface ImageGenRequest {
  prompt: string;
  emotionalState?: string;
  personality?: {
    warmth?: number;
    playfulness?: number;
    directness?: number;
    curiosity?: number;
    empathy?: number;
    assertiveness?: number;
  };
  style?: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  width?: number;
  height?: number;
  saveToPublic?: boolean;
  cacheKey?: string;
}

interface ImageGenResult {
  imageUrl: string;
  cacheKey: string;
  width: number;
  height: number;
  latencyMs: number;
  cached: boolean;
}

// In-memory cache for generated images (in production, use Redis)
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Generate a cache key based on the generation parameters
 */
function generateCacheKey(params: ImageGenRequest): string {
  const keyData = {
    prompt: params.prompt,
    emotionalState: params.emotionalState,
    personality: params.personality,
    style: params.style,
    width: params.width,
    height: params.height,
  };
  return createHash('sha256').update(JSON.stringify(keyData)).digest('hex').slice(0, 16);
}

/**
 * Build the full prompt based on emotional state and personality
 */
function buildPrompt(params: ImageGenRequest): string {
  const stylePrompts: Record<string, string> = {
    realistic: 'photorealistic, highly detailed, 8k, professional photography',
    stylized: 'stylized 3D render, Pixar style, vibrant colors, soft lighting',
    abstract: 'abstract art, geometric shapes, ethereal lighting, modern',
    minimal: 'minimalist design, clean lines, flat colors, simple',
    anime: 'anime style, expressive, vibrant colors, detailed illustration',
  };

  const emotionalModifiers: Record<string, string> = {
    happy: 'warm smile, bright eyes, joyful expression, uplifting mood',
    calm: 'serene expression, peaceful, relaxed posture, gentle lighting',
    curious: 'inquisitive look, tilted head, engaged expression, alert',
    excited: 'energetic, bright expression, dynamic pose, enthusiastic',
    thoughtful: 'contemplative gaze, pensive expression, soft focus',
    supportive: 'empathetic expression, warm gaze, open posture, comforting',
    playful: 'mischievous smile, sparkling eyes, dynamic, fun',
    neutral: 'calm neutral expression, attentive, present',
  };

  let fullPrompt = params.prompt;

  // Add emotional modifier
  if (params.emotionalState && emotionalModifiers[params.emotionalState]) {
    fullPrompt += `, ${emotionalModifiers[params.emotionalState]}`;
  }

  // Add personality-based modifiers
  if (params.personality) {
    const { warmth = 50, playfulness = 50, empathy = 50 } = params.personality;

    if (warmth > 70) {
      fullPrompt += ', warm and inviting presence';
    }
    if (playfulness > 70) {
      fullPrompt += ', playful and lighthearted';
    }
    if (empathy > 70) {
      fullPrompt += ', compassionate and understanding';
    }
  }

  // Add style modifier
  if (params.style && stylePrompts[params.style]) {
    fullPrompt += `, ${stylePrompts[params.style]}`;
  }

  // Add quality modifiers
  fullPrompt += ', high quality, detailed, beautiful lighting';

  return fullPrompt;
}

/**
 * Call FAL.ai to generate an image using the subscribe endpoint (blocking)
 */
async function generateWithFal(
  prompt: string,
  width: number,
  height: number
): Promise<{ imageUrl: string; latencyMs: number }> {
  const startTime = Date.now();
  const apiKey = getFalApiKey();

  if (!apiKey) {
    throw new Error('FAL_API_KEY is not configured');
  }

  const inputParams = {
    prompt,
    image_size: { width, height },
    num_images: 1,
    enable_safety_checker: true,
  };

  // Use the fal.ai subscribe endpoint which blocks until completion
  const url = `https://fal.run/${FAL_MODEL}`;
  logger.info({ url, model: FAL_MODEL, prompt }, 'Calling FAL API');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(inputParams),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'FAL API error');
    throw new Error(`FAL API error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  logger.info({ result }, 'FAL API response');

  // Extract image URL from result
  const images = result.images || [];
  const imageUrl = images[0]?.url;

  if (!imageUrl) {
    throw new Error('No image URL in FAL response');
  }

  return {
    imageUrl,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Register image generation routes
 */
export async function imagegenRoutes(app: FastifyInstance): Promise<void> {
  // Generate image endpoint
  app.post<{ Body: ImageGenRequest }>(
    '/generate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            emotionalState: { type: 'string' },
            personality: {
              type: 'object',
              properties: {
                warmth: { type: 'number' },
                playfulness: { type: 'number' },
                directness: { type: 'number' },
                curiosity: { type: 'number' },
                empathy: { type: 'number' },
                assertiveness: { type: 'number' },
              },
            },
            style: { type: 'string', enum: ['realistic', 'stylized', 'abstract', 'minimal', 'anime'] },
            width: { type: 'number', default: 250 },
            height: { type: 'number', default: 400 },
            saveToPublic: { type: 'boolean', default: false },
            cacheKey: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ImageGenRequest }>, reply: FastifyReply) => {
      const params = request.body;
      const width = params.width || 250;
      const height = params.height || 400;

      // Generate or use provided cache key
      const cacheKey = params.cacheKey || generateCacheKey(params);

      // Check cache
      const cached = imageCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        logger.info({ cacheKey }, 'Image served from cache');
        return reply.send({
          imageUrl: cached.url,
          cacheKey,
          width,
          height,
          latencyMs: 0,
          cached: true,
        } as ImageGenResult);
      }

      try {
        // Build the full prompt
        const fullPrompt = buildPrompt(params);

        logger.info({ prompt: fullPrompt, width, height }, 'Generating image with FAL');

        // Generate with FAL
        const { imageUrl, latencyMs } = await generateWithFal(fullPrompt, width, height);

        // Cache the result
        imageCache.set(cacheKey, { url: imageUrl, timestamp: Date.now() });

        logger.info({ cacheKey, latencyMs }, 'Image generated successfully');

        return reply.send({
          imageUrl,
          cacheKey,
          width,
          height,
          latencyMs,
          cached: false,
        } as ImageGenResult);
      } catch (error) {
        logger.error({ error, params }, 'Image generation failed');
        return reply.status(500).send({
          error: 'Image generation failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get cached image by key
  app.get<{ Params: { cacheKey: string } }>(
    '/cache/:cacheKey',
    async (request: FastifyRequest<{ Params: { cacheKey: string } }>, reply: FastifyReply) => {
      const { cacheKey } = request.params;
      const cached = imageCache.get(cacheKey);

      if (!cached || Date.now() - cached.timestamp > CACHE_TTL_MS) {
        return reply.status(404).send({ error: 'Image not found or expired' });
      }

      return reply.send({
        imageUrl: cached.url,
        cacheKey,
        cached: true,
      });
    }
  );

  // Clear cache (admin only in production)
  app.delete('/cache', async (_request, reply) => {
    imageCache.clear();
    return reply.send({ message: 'Cache cleared' });
  });

  logger.info('Image generation routes registered');
}
