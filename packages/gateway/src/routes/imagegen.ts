/**
 * Image Generation Routes
 * API endpoints for generating companion images via orchestrator (ComfyUI/FAL)
 * Images are persisted to S3 and metadata stored in PostgreSQL
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { db } from '../db/index.js';

// Orchestrator configuration
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] || 'http://localhost:8000';

// S3 configuration
const S3_MEDIA_BUCKET = process.env['S3_MEDIA_BUCKET'] || 'campfire-dev-media';
const S3_REGION = process.env['AWS_REGION'] || 'us-east-1';

// Initialize S3 client
const s3Client = new S3Client({ region: S3_REGION });

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
  saveToS3?: boolean;
  cacheKey?: string;
  userId?: string;
  sessionId?: string;
  companionId?: string;
  referenceImageUrl?: string;  // Identity anchor for character consistency
  referenceStrength?: number;  // How strongly to follow reference (0.0-1.0)
}

interface ImageGenResult {
  imageUrl: string;
  cacheKey: string;
  width: number;
  height: number;
  latencyMs: number;
  cached: boolean;
  s3Key?: string;
  imageId?: string;
}

interface CompanionImage {
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
  emotional_state: string;
  style: string;
  prompt: string | null;
  cache_key: string;
  provider: string;
  latency_ms: number | null;
  created_at: Date;
}

// In-memory cache for generated images (in production, use Redis)
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Generate a cache key based on the generation parameters
 * Includes user/session/companion IDs to ensure each companion gets unique images
 */
function generateCacheKey(params: ImageGenRequest): string {
  const keyData = {
    prompt: params.prompt,
    emotionalState: params.emotionalState,
    personality: params.personality,
    style: params.style,
    width: params.width,
    height: params.height,
    // Include IDs so each companion gets unique cached images
    userId: params.userId,
    sessionId: params.sessionId,
    companionId: params.companionId,
  };
  return createHash('sha256').update(JSON.stringify(keyData)).digest('hex').slice(0, 16);
}

/**
 * Build the full prompt based on emotional state and personality
 * For adult companion app - uses sensual/intimate modifiers
 */
function buildPrompt(params: ImageGenRequest): string {
  const stylePrompts: Record<string, string> = {
    realistic: 'photorealistic, highly detailed, 8k, professional boudoir photography, intimate lighting',
    stylized: 'beautiful stylized render, soft romantic lighting, sensual artistic style',
    abstract: 'ethereal sensual art, soft flowing forms, romantic abstract lighting',
    minimal: 'elegant minimalist, tasteful intimate, soft clean aesthetic',
    anime: 'beautiful anime style, expressive sensual, romantic illustration, detailed',
  };

  const emotionalModifiers: Record<string, string> = {
    happy: 'radiant smile, sparkling eyes, joyful and flirty expression, warm glow',
    calm: 'serene sensual expression, relaxed intimate pose, soft bedroom lighting, dreamy',
    curious: 'alluring curious gaze, head tilted seductively, inviting expression',
    excited: 'energetic, flushed cheeks, excited anticipation, dynamic sensual pose',
    thoughtful: 'contemplative sultry gaze, pensive expression, soft romantic focus',
    supportive: 'warm empathetic gaze, inviting open posture, intimate comforting presence',
    playful: 'mischievous flirty smile, sparkling teasing eyes, playful seductive pose',
    neutral: 'confident sensual expression, alluring gaze, intimate presence',
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
      fullPrompt += ', warm and inviting sensual presence';
    }
    if (playfulness > 70) {
      fullPrompt += ', playfully seductive';
    }
    if (empathy > 70) {
      fullPrompt += ', intimate and understanding';
    }
  }

  // Add style modifier
  if (params.style && stylePrompts[params.style]) {
    fullPrompt += `, ${stylePrompts[params.style]}`;
  }

  // Add quality modifiers
  fullPrompt += ', high quality, detailed, beautiful lighting, alluring';

  return fullPrompt;
}

interface OrchestratorImageGenResponse {
  image_base64: string;
  format: string;
  width: number;
  height: number;
  latency_ms: number;
  provider: string;
  prompt_used: string;
}

/**
 * Call orchestrator to generate an image (uses ComfyUI or FAL)
 */
async function generateWithOrchestrator(
  prompt: string,
  emotionalState: string,
  style: string,
  width: number,
  height: number,
  referenceImageUrl?: string,
  referenceStrength?: number
): Promise<{ imageBuffer: Buffer; latencyMs: number; provider: string; format: string }> {
  const url = `${ORCHESTRATOR_URL}/imagegen/generate`;

  logger.info({ url, prompt: prompt.slice(0, 100), emotionalState, style, hasReference: !!referenceImageUrl }, 'Calling orchestrator for image generation');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      emotional_state: emotionalState,
      style,
      width,
      height,
      reference_image_url: referenceImageUrl,
      reference_strength: referenceStrength ?? 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Orchestrator image generation error');
    throw new Error(`Orchestrator error: ${response.status} - ${error}`);
  }

  const result = await response.json() as OrchestratorImageGenResponse;
  logger.info({ provider: result.provider, latency_ms: result.latency_ms }, 'Orchestrator image generation response');

  // Decode base64 image
  const imageBuffer = Buffer.from(result.image_base64, 'base64');

  return {
    imageBuffer,
    latencyMs: result.latency_ms,
    provider: result.provider,
    format: result.format,
  };
}

/**
 * Download image from URL and return as Buffer
 */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload image to S3 and return the key
 */
async function uploadToS3(
  imageBuffer: Buffer,
  userId: string,
  sessionId: string,
  cacheKey: string
): Promise<{ s3Key: string; s3Url: string; sizeBytes: number }> {
  const s3Key = `companions/${userId}/${sessionId}/${cacheKey}.png`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: 'image/png',
      CacheControl: 'max-age=31536000', // 1 year cache
    })
  );

  // Generate a presigned URL for access (valid for 7 days)
  const s3Url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
    { expiresIn: 604800 }
  );

  return {
    s3Key,
    s3Url,
    sizeBytes: imageBuffer.length,
  };
}

/**
 * Save image metadata to database
 */
async function saveImageMetadata(
  userId: string,
  sessionId: string,
  companionId: string | undefined,
  s3Key: string,
  s3Url: string,
  width: number,
  height: number,
  sizeBytes: number,
  emotionalState: string,
  style: string,
  prompt: string,
  cacheKey: string,
  latencyMs: number,
  provider = 'comfyui'
): Promise<string> {
  const latencyMsInt = Math.round(latencyMs);
  const result = await db.sql`
    INSERT INTO companion_images (
      user_id, session_id, companion_id, s3_key, s3_url,
      width, height, format, size_bytes,
      emotional_state, style, prompt, cache_key,
      provider, latency_ms
    ) VALUES (
      ${userId}, ${sessionId}, ${companionId || null}, ${s3Key}, ${s3Url},
      ${width}, ${height}, 'png', ${sizeBytes},
      ${emotionalState}, ${style}, ${prompt}, ${cacheKey},
      ${provider}, ${latencyMsInt}
    )
    ON CONFLICT (user_id, session_id, cache_key)
    DO UPDATE SET s3_url = ${s3Url}, latency_ms = ${latencyMsInt}
    RETURNING id
  `;
  if (!result[0]) {
    throw new Error('Failed to save image metadata');
  }
  return result[0].id;
}

/**
 * Get images for a session from database
 */
async function getSessionImages(
  userId: string,
  sessionId: string,
  limit = 50
): Promise<CompanionImage[]> {
  const results = await db.sql<CompanionImage[]>`
    SELECT * FROM companion_images
    WHERE user_id = ${userId} AND session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return results;
}

/**
 * Refresh presigned URL for an image
 */
async function refreshPresignedUrl(s3Key: string): Promise<string> {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
    { expiresIn: 604800 }
  );
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
            saveToS3: { type: 'boolean', default: true },
            cacheKey: { type: 'string' },
            userId: { type: 'string' },
            sessionId: { type: 'string' },
            companionId: { type: 'string' },
            referenceImageUrl: { type: 'string' },
            referenceStrength: { type: 'number', minimum: 0, maximum: 1, default: 0.7 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ImageGenRequest }>, reply: FastifyReply) => {
      const params = request.body;
      const width = params.width || 250;
      const height = params.height || 400;
      const saveToS3 = params.saveToS3 !== false; // Default to true
      const emotionalState = params.emotionalState || 'neutral';
      const style = params.style || 'stylized';

      // Generate or use provided cache key
      const cacheKey = params.cacheKey || generateCacheKey(params);

      // Check in-memory cache first
      const cached = imageCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        logger.info({ cacheKey }, 'Image served from memory cache');
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

        logger.info({ prompt: fullPrompt, width, height, saveToS3 }, 'Generating image via orchestrator');

        // Generate with orchestrator (uses ComfyUI or FAL)
        const { imageBuffer, latencyMs, provider, format } = await generateWithOrchestrator(
          fullPrompt,
          emotionalState,
          style,
          width,
          height,
          params.referenceImageUrl,
          params.referenceStrength
        );

        let finalUrl: string;
        let s3Key: string | undefined;
        let imageId: string | undefined;

        // Always save to S3 if userId and sessionId provided
        if (saveToS3 && params.userId && params.sessionId) {
          try {
            // Upload to S3 directly (image already in buffer)
            const s3Result = await uploadToS3(
              imageBuffer,
              params.userId,
              params.sessionId,
              cacheKey
            );

            s3Key = s3Result.s3Key;
            finalUrl = s3Result.s3Url;

            // Save metadata to database
            imageId = await saveImageMetadata(
              params.userId,
              params.sessionId,
              params.companionId,
              s3Key,
              finalUrl,
              width,
              height,
              s3Result.sizeBytes,
              emotionalState,
              style,
              fullPrompt,
              cacheKey,
              latencyMs,
              provider
            );

            logger.info({ imageId, s3Key, latencyMs, provider }, 'Image saved to S3 and database');
          } catch (s3Error) {
            // Log S3 error but don't fail - create data URL as fallback
            logger.error({ error: s3Error }, 'Failed to save image to S3, using data URL');
            finalUrl = `data:image/${format};base64,${imageBuffer.toString('base64')}`;
          }
        } else {
          // No S3, return as data URL
          finalUrl = `data:image/${format};base64,${imageBuffer.toString('base64')}`;
        }

        // Cache the result
        imageCache.set(cacheKey, { url: finalUrl, timestamp: Date.now() });

        logger.info({ cacheKey, latencyMs, s3Key, provider }, 'Image generated successfully');

        return reply.send({
          imageUrl: finalUrl,
          cacheKey,
          width,
          height,
          latencyMs,
          cached: false,
          s3Key,
          imageId,
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

  // List images for a session (gallery endpoint)
  app.get<{ Params: { sessionId: string }; Querystring: { limit?: string } }>(
    '/gallery/:sessionId',
    { preHandler: requireAuth },
    async (request: FastifyRequest<{ Params: { sessionId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const limit = parseInt(request.query.limit || '50', 10);

      // Get userId from auth context (set by requireAuth middleware)
      const userId = request.user!.userId;

      try {
        const images = await getSessionImages(userId, sessionId, limit);

        // Refresh presigned URLs for images (they may have expired)
        const refreshedImages = await Promise.all(
          images.map(async (img) => {
            try {
              const freshUrl = await refreshPresignedUrl(img.s3_key);
              return { ...img, s3_url: freshUrl };
            } catch {
              return img;
            }
          })
        );

        return reply.send({
          images: refreshedImages,
          count: refreshedImages.length,
          sessionId,
        });
      } catch (error) {
        logger.error({ error, sessionId }, 'Failed to fetch gallery images');
        return reply.status(500).send({
          error: 'Failed to fetch gallery',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Clear cache (admin only in production)
  app.delete('/cache', async (_request, reply) => {
    imageCache.clear();
    return reply.send({ message: 'Cache cleared' });
  });

  logger.info('Image generation routes registered');
}
