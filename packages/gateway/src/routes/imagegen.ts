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
import type { CompanionAvatar, CompanionImage } from '../db/types.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import {
  getAppearanceFromSpec,
  getVariationUrl,
} from '../utils/companion-assets.js';
import { enqueueImageRenditionJob } from '../utils/queue.js';
import { getRenditionKeyPrefix, type ImageRenditions } from '@campfire/shared';
import { getLLMUsageService } from '../services/llm-usage.js';

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

interface GenerateAnchorsRequest {
  companionId: string;
  appearance: {
    gender?: string;  // female, male
    ethnicity: string;
    bodyType: string;
    hairColor: string;
    breastSize?: string;  // S, M, L (female)
    build?: string;  // S, M, L (male)
  };
  style: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  personality?: {
    warmth?: number;
    playfulness?: number;
    directness?: number;
    curiosity?: number;
    empathy?: number;
    assertiveness?: number;
  };
}

interface AnchorImage {
  id: string;
  url: string;
  emotionalState: string;
  isIdentityAnchor: boolean;
}

interface GenerateAnchorsResult {
  companionId: string;
  anchors: AnchorImage[];
  primaryAnchorId: string;
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
  renditions?: ImageRenditions;
}

// In-memory cache for generated images (in production, use Redis)
const imageCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Maps emotional states to anchor types for emotion-matched reference selection.
 * During onboarding, 3 anchors are generated: neutral, happy, thoughtful.
 * This map allows selecting the most appropriate anchor based on the scene's emotion.
 */
const EMOTION_TO_ANCHOR_MAP: Record<string, string> = {
  // Happy anchors
  happy: 'happy',
  excited: 'happy',
  playful: 'happy',
  joyful: 'happy',
  flirty: 'happy',
  amused: 'happy',
  delighted: 'happy',
  // Thoughtful anchors
  thoughtful: 'thoughtful',
  curious: 'thoughtful',
  contemplative: 'thoughtful',
  pensive: 'thoughtful',
  concerned: 'thoughtful',
  worried: 'thoughtful',
  introspective: 'thoughtful',
  // Neutral anchors (default)
  neutral: 'neutral',
  calm: 'neutral',
  supportive: 'neutral',
  warm: 'neutral',
  serene: 'neutral',
};

/**
 * Select the best anchor image based on the target emotional state.
 * Falls back to neutral anchor, then any available anchor.
 */
function selectBestAnchor(
  anchors: CompanionAvatar[],
  targetEmotionalState: string
): CompanionAvatar | null {
  if (anchors.length === 0) return null;

  // Map target emotion to anchor emotional state
  const targetAnchorEmotion = EMOTION_TO_ANCHOR_MAP[targetEmotionalState.toLowerCase()] || 'neutral';

  // Find matching anchor
  const matched = anchors.find(
    a => (a.metadata?.emotionalState as string)?.toLowerCase() === targetAnchorEmotion
  );
  if (matched) return matched;

  // Fallback to neutral
  const neutralAnchor = anchors.find(
    a => (a.metadata?.emotionalState as string)?.toLowerCase() === 'neutral'
  );
  if (neutralAnchor) return neutralAnchor;

  // Fallback to first available
  return anchors[0];
}

/**
 * Get the identity anchor URL for a companion.
 * Priority:
 * 1. Emotion-matched identity anchor from companion_avatars table
 * 2. Pre-generated variation image based on appearance settings (from S3)
 * 3. null (no reference, generate without IP-Adapter)
 */
async function getCompanionIdentityAnchorUrl(
  companionId: string,
  emotionalState?: string
): Promise<string | null> {
  const companionRepo = getCompanionsRepository();

  try {
    // Fetch all identity anchors for emotion-matched selection
    const anchors = await companionRepo.getAllIdentityAnchors(companionId);
    if (anchors.length > 0) {
      // Select best anchor based on emotional state
      const selectedAnchor = selectBestAnchor(anchors, emotionalState || 'neutral');
      if (selectedAnchor) {
        // If we have s3_key and s3_bucket in metadata, generate a fresh presigned URL
        // This avoids 403 errors from expired presigned URLs
        const s3Key = selectedAnchor.metadata?.s3_key as string | undefined;
        const s3Bucket = selectedAnchor.metadata?.s3_bucket as string | undefined;
        if (s3Key && s3Bucket) {
          const freshUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: s3Bucket,
              Key: s3Key,
            }),
            { expiresIn: 3600 } // 1 hour is enough for image generation
          );
          logger.debug({
            companionId,
            anchorId: selectedAnchor.id,
            s3Key,
            requestedEmotion: emotionalState,
            selectedEmotion: selectedAnchor.metadata?.emotionalState,
            anchorCount: anchors.length,
          }, 'Using emotion-matched identity anchor');
          return freshUrl;
        }
        // Fallback to stored URL if no s3_key
        if (selectedAnchor.asset_url) {
          logger.debug({
            companionId,
            anchorId: selectedAnchor.id,
            requestedEmotion: emotionalState,
            selectedEmotion: selectedAnchor.metadata?.emotionalState,
          }, 'Using stored identity anchor URL (no s3_key)');
          return selectedAnchor.asset_url;
        }
      }
    }

    // If no stored anchors, try to build URL from companion's appearance settings
    const companion = await companionRepo.findById(companionId);
    if (!companion?.spec) {
      logger.debug({ companionId }, 'Companion not found or has no spec');
      return null;
    }

    // Extract appearance from spec
    const appearance = getAppearanceFromSpec(companion.spec);
    if (!appearance) {
      logger.debug({ companionId }, 'Companion has no valid appearance settings');
      return null;
    }

    // Build S3 URL to pre-generated variation image
    const variationUrl = getVariationUrl(appearance);

    logger.debug(
      { companionId, appearance, variationUrl },
      'Using pre-generated variation image as anchor from S3'
    );

    return variationUrl;
  } catch (error) {
    logger.error({ companionId, error }, 'Failed to get identity anchor');
    return null;
  }
}

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
 * Build the full prompt for image generation.
 *
 * Since the companion LLM now provides full imagePrompt with scene, mood, style,
 * and expression details, we use that directly. IP-Adapter preserves identity
 * from the anchor image, so the companion has full creative control.
 *
 * Only add minimal quality suffix for best results.
 */
function buildPrompt(params: ImageGenRequest): string {
  // The prompt from companion already contains the full scene description
  // Note: "high quality, detailed" is added by the orchestrator, don't duplicate here
  return params.prompt;
}

interface OrchestratorImageGenResponse {
  image_base64: string;
  format: string;
  width: number;
  height: number;
  latency_ms: number;
  provider: string;
  model_id: string;
  prompt_used: string;
}

interface OrchestratorAnchorImageResult {
  image_url: string;
  emotional_state: string;
  scene: string | null;
  is_identity_seed: boolean;
  seed: number | null;
  width: number;
  height: number;
  latency_ms: number;
}

interface OrchestratorSeededAnchorResponse {
  seed_anchor: OrchestratorAnchorImageResult;
  variation_anchors: OrchestratorAnchorImageResult[];
  random_seed: number;
  total_latency_ms: number;
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
  referenceStrength?: number,
  isAnchor?: boolean
): Promise<{ imageBuffer: Buffer; latencyMs: number; provider: string; modelId: string; format: string }> {
  const url = `${ORCHESTRATOR_URL}/imagegen/generate`;

  logger.info({ url, prompt: prompt.slice(0, 100), emotionalState, style, hasReference: !!referenceImageUrl, isAnchor }, 'Calling orchestrator for image generation');

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
      is_anchor: isAnchor ?? false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Orchestrator image generation error');
    throw new Error(`Orchestrator error: ${response.status} - ${error}`);
  }

  const result = await response.json() as OrchestratorImageGenResponse;
  logger.info({ provider: result.provider, modelId: result.model_id, latency_ms: result.latency_ms }, 'Orchestrator image generation response');

  // Decode base64 image
  const imageBuffer = Buffer.from(result.image_base64, 'base64');

  return {
    imageBuffer,
    latencyMs: result.latency_ms,
    provider: result.provider,
    modelId: result.model_id,
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
 * Call orchestrator to generate seeded anchor images using Dreamina + PuLID
 * Returns seed anchor + variation anchors with consistent identity
 */
async function generateSeededAnchorsWithOrchestrator(
  companionId: string,
  appearance: {
    gender?: string;
    ethnicity: string;
    bodyType: string;
    hairColor: string;
    breastSize?: string;
    build?: string;
  },
  personality?: Record<string, unknown>
): Promise<OrchestratorSeededAnchorResponse> {
  const url = `${ORCHESTRATOR_URL}/imagegen/generate-seeded-anchors`;

  logger.info({ url, companionId, appearance }, 'Calling orchestrator for seeded anchor generation');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      companion_id: companionId,
      appearance: {
        gender: appearance.gender || 'female',
        ethnicity: appearance.ethnicity,
        bodyType: appearance.bodyType,
        hairColor: appearance.hairColor,
        breastSize: appearance.breastSize,
        build: appearance.build,
      },
      personality: personality || null,
      variation_count: 3,
      width: 768,
      height: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Orchestrator seeded anchor generation error');
    throw new Error(`Orchestrator error: ${response.status} - ${error}`);
  }

  const result = await response.json() as OrchestratorSeededAnchorResponse;
  logger.info({
    companionId,
    randomSeed: result.random_seed,
    variationCount: result.variation_anchors.length,
    totalLatencyMs: result.total_latency_ms,
  }, 'Orchestrator seeded anchor generation response');

  return result;
}

/**
 * Upload image to S3 and return the key
 * Uses directory structure: companions/{userId}/{sessionId}/{cacheKey}/original.png
 * This allows renditions to be stored alongside: thumb.webp, small.webp, etc.
 */
async function uploadToS3(
  imageBuffer: Buffer,
  userId: string,
  sessionId: string,
  cacheKey: string
): Promise<{ s3Key: string; s3Url: string; sizeBytes: number; keyPrefix: string }> {
  // Use directory structure for renditions
  const keyPrefix = getRenditionKeyPrefix(userId, sessionId, cacheKey);
  const s3Key = `${keyPrefix}/original.png`;

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
    keyPrefix,
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
 * Get images for a session including anchor images for the companion
 */
async function getSessionImagesWithAnchors(
  userId: string,
  sessionId: string,
  companionId: string | null,
  limit = 50
): Promise<CompanionImage[]> {
  // If we have a companion_id, also include anchor images
  if (companionId) {
    const anchorSessionId = `anchors-${companionId}`;
    const results = await db.sql<CompanionImage[]>`
      SELECT * FROM companion_images
      WHERE user_id = ${userId}
        AND (session_id = ${sessionId} OR session_id = ${anchorSessionId})
      ORDER BY
        CASE WHEN session_id = ${anchorSessionId} THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT ${limit}
    `;
    return results;
  }

  // Fallback to just session images
  return getSessionImages(userId, sessionId, limit);
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
            width: { type: 'number', default: 832 },
            height: { type: 'number', default: 1248 },
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
      const width = params.width || 832;
      const height = params.height || 1248;
      const saveToS3 = params.saveToS3 !== false; // Default to true
      const emotionalState = params.emotionalState || 'neutral';

      // Get companion's stored style if companionId provided, otherwise use request param or default
      let style = params.style || 'stylized';
      let referenceImageUrl = params.referenceImageUrl;

      if (params.companionId) {
        const companionRepo = getCompanionsRepository();
        const companion = await companionRepo.findById(params.companionId);
        if (companion) {
          // Use companion's stored style from spec if not explicitly overridden in request
          if (!params.style && companion.spec?.visual_style?.style_type) {
            const storedStyle = companion.spec.visual_style.style_type;
            // Validate stored style is one of the allowed values
            if (['realistic', 'stylized', 'abstract', 'minimal', 'anime'].includes(storedStyle)) {
              style = storedStyle as 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
            }
          }
          // Get emotion-matched identity anchor for character consistency
          if (!referenceImageUrl) {
            referenceImageUrl = await getCompanionIdentityAnchorUrl(
              params.companionId,
              params.emotionalState
            ) || undefined;
          }
        }
      }

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

        logger.info({
          prompt: fullPrompt,
          width,
          height,
          style,
          saveToS3,
          hasReference: !!referenceImageUrl,
          companionId: params.companionId,
        }, 'Generating image via orchestrator');

        // Capture request start time for cost tracking
        const requestStartTime = new Date();

        // Generate with orchestrator (uses ComfyUI or FAL)
        // If referenceImageUrl is provided, ComfyUI will use IP-Adapter for consistency
        const { imageBuffer, latencyMs, provider, modelId, format } = await generateWithOrchestrator(
          fullPrompt,
          emotionalState,
          style,
          width,
          height,
          referenceImageUrl,
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

            logger.info({ imageId, s3Key, latencyMs, provider, modelId }, 'Image saved to S3 and database');

            // Record image usage for cost tracking
            try {
              const llmUsage = getLLMUsageService();
              await llmUsage.recordImageUsage({
                user_id: params.userId,
                session_id: params.sessionId ?? null,
                companion_id: params.companionId ?? null,
                provider,
                model: modelId,
                latency_ms: Math.round(latencyMs),
                request_started_at: requestStartTime,
                request_completed_at: new Date(),
              });
            } catch (usageErr) {
              logger.warn({ error: usageErr, imageId }, 'Failed to record image usage');
            }

            // Queue rendition processing job (async, non-blocking)
            if (imageId) {
              enqueueImageRenditionJob({
                originalS3Key: s3Key,
                bucket: S3_MEDIA_BUCKET,
                userId: params.userId,
                sessionId: params.sessionId,
                cacheKey,
                imageId,
                companionId: params.companionId,
              }).catch((err) => {
                logger.warn({ error: err, imageId }, 'Failed to queue rendition job');
              });
            }
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
  // Includes anchor images for the companion so they appear in the gallery
  app.get<{ Params: { sessionId: string }; Querystring: { limit?: string } }>(
    '/gallery/:sessionId',
    { preHandler: requireAuth },
    async (request: FastifyRequest<{ Params: { sessionId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const limit = parseInt(request.query.limit || '50', 10);

      // Get userId from auth context (set by requireAuth middleware)
      const userId = request.user!.userId;

      try {
        // Get the session to find the companion_id (for including anchor images)
        const sessionRepo = getSessionsRepository();
        const session = await sessionRepo.findById(sessionId);
        const companionId = session?.companion_id || null;

        // Get session images including anchor images for the companion
        const images = await getSessionImagesWithAnchors(userId, sessionId, companionId, limit);

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

  // Generate anchor images for a new companion using Dreamina + PuLID
  // Uses two-phase approach: Dreamina v3.1 for seed, PuLID Flux for variations
  // This creates a set of reference images with 88-93% facial identity preservation
  app.post<{ Body: GenerateAnchorsRequest }>(
    '/generate-anchors',
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: 'object',
          required: ['companionId', 'appearance', 'style'],
          properties: {
            companionId: { type: 'string' },
            appearance: {
              type: 'object',
              required: ['ethnicity', 'bodyType', 'hairColor'],
              properties: {
                gender: { type: 'string' },
                ethnicity: { type: 'string' },
                bodyType: { type: 'string' },
                hairColor: { type: 'string' },
                breastSize: { type: 'string' },
                build: { type: 'string' },
              },
            },
            style: { type: 'string', enum: ['realistic', 'stylized', 'abstract', 'minimal', 'anime'] },
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
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: GenerateAnchorsRequest }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { companionId, appearance, style, personality } = request.body;

      logger.info({ userId, companionId, appearance, style }, 'Starting seeded anchor image generation');

      const companionRepo = getCompanionsRepository();

      // Verify companion exists and belongs to user
      const companion = await companionRepo.findById(companionId);
      if (!companion) {
        return reply.status(404).send({ error: 'Companion not found' });
      }
      if (companion.user_id !== userId) {
        return reply.status(403).send({ error: 'Not authorized to modify this companion' });
      }

      const generatedAnchors: AnchorImage[] = [];
      let primaryAnchorId: string | null = null;

      try {
        // Capture request start time for cost tracking
        const anchorStartTime = new Date();

        // Call orchestrator to generate seeded anchors (Dreamina + PuLID)
        const orchestratorResult = await generateSeededAnchorsWithOrchestrator(
          companionId,
          appearance,
          personality
        );

        // Process all anchors (seed + variations)
        const allAnchors = [orchestratorResult.seed_anchor, ...orchestratorResult.variation_anchors];

        for (let i = 0; i < allAnchors.length; i++) {
          const anchor = allAnchors[i]!;
          const isPrimary = anchor.is_identity_seed;
          const emotionalState = anchor.emotional_state;

          logger.info({
            companionId,
            emotionalState,
            scene: anchor.scene,
            isPrimary,
            index: i,
          }, 'Processing generated anchor');

          // Download image from FAL URL
          const imageBuffer = await downloadImage(anchor.image_url);

          // Upload to S3 under anchors path
          const cacheKey = `anchor-${emotionalState}-${Date.now()}`;
          const keyPrefix = `companions/${userId}/anchors/${companionId}/${cacheKey}`;
          const s3Key = `${keyPrefix}/original.png`;

          await s3Client.send(
            new PutObjectCommand({
              Bucket: S3_MEDIA_BUCKET,
              Key: s3Key,
              Body: imageBuffer,
              ContentType: 'image/png',
              CacheControl: 'max-age=31536000',
            })
          );

          // Generate presigned URL
          const s3Url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
            { expiresIn: 604800 }
          );

          // Create avatar record with is_identity_anchor = true
          const avatar = await companionRepo.createAvatar({
            companion_id: companionId,
            asset_url: s3Url,
            asset_type: 'identity_anchor',
            is_active: isPrimary,  // Seed (neutral) anchor is the active avatar
            is_identity_anchor: true,
            metadata: {
              emotionalState,
              scene: anchor.scene,
              style,
              appearance,
              s3Key,
              s3_key: s3Key,
              s3Bucket: S3_MEDIA_BUCKET,
              isIdentitySeed: isPrimary,
              randomSeed: orchestratorResult.random_seed,
            },
            generation_params: {
              width: anchor.width,
              height: anchor.height,
              provider: 'fal',
              latencyMs: anchor.latency_ms,
              seed: anchor.seed,
            },
          });

          if (isPrimary) {
            primaryAnchorId = avatar.id;
            // Set as active avatar
            await companionRepo.setActiveAvatar(companionId, avatar.id);
          }

          // Also save to companion_images table for gallery display
          const anchorSessionId = `anchors-${companionId}`;
          const imageId = await saveImageMetadata(
            userId,
            anchorSessionId,
            companionId,
            s3Key,
            s3Url,
            anchor.width,
            anchor.height,
            imageBuffer.length,
            emotionalState,
            style,
            `Seeded anchor: ${emotionalState}`, // Prompt is handled by orchestrator
            cacheKey,
            anchor.latency_ms,
            'fal'
          );

          // Record image usage for cost tracking
          try {
            const llmUsage = getLLMUsageService();
            await llmUsage.recordImageUsage({
              user_id: userId,
              session_id: null,
              companion_id: companionId,
              provider: 'fal',
              model: isPrimary ? 'fal/dreamina-v3.1' : 'fal/flux-pulid',
              latency_ms: Math.round(anchor.latency_ms),
              request_started_at: anchorStartTime,
              request_completed_at: new Date(),
            });
          } catch (usageErr) {
            logger.warn({ error: usageErr, imageId }, 'Failed to record anchor image usage');
          }

          // Queue rendition processing for anchor images
          if (imageId) {
            enqueueImageRenditionJob({
              originalS3Key: s3Key,
              bucket: S3_MEDIA_BUCKET,
              userId,
              sessionId: anchorSessionId,
              cacheKey,
              imageId,
              isAnchor: true,
              companionId,
            }).catch((err) => {
              logger.warn({ error: err, imageId }, 'Failed to queue anchor rendition job');
            });
          }

          generatedAnchors.push({
            id: avatar.id,
            url: s3Url,
            emotionalState,
            isIdentityAnchor: true,
          });

          logger.info({
            companionId,
            avatarId: avatar.id,
            emotionalState,
            scene: anchor.scene,
            latencyMs: anchor.latency_ms,
          }, 'Anchor image saved');
        }

        const result: GenerateAnchorsResult = {
          companionId,
          anchors: generatedAnchors,
          primaryAnchorId: primaryAnchorId!,
        };

        logger.info({
          companionId,
          anchorCount: generatedAnchors.length,
          primaryAnchorId,
          randomSeed: orchestratorResult.random_seed,
          totalLatencyMs: orchestratorResult.total_latency_ms,
        }, 'Seeded anchor generation complete');

        return reply.send(result);
      } catch (error) {
        logger.error({ error, companionId }, 'Seeded anchor image generation failed');
        return reply.status(500).send({
          error: 'Anchor generation failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          partialAnchors: generatedAnchors,
        });
      }
    }
  );

  // Generate anchor images with SSE streaming (for real-time progress)
  // This is the preferred endpoint for onboarding as it streams each image as it's generated
  app.get<{ Querystring: { companionId: string; appearance: string; style: string; personality?: string } }>(
    '/generate-anchors-stream',
    {
      preHandler: requireAuth,
      schema: {
        querystring: {
          type: 'object',
          required: ['companionId', 'appearance', 'style'],
          properties: {
            companionId: { type: 'string' },
            appearance: { type: 'string' },  // JSON stringified
            style: { type: 'string' },
            personality: { type: 'string' },  // JSON stringified, optional
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { companionId: string; appearance: string; style: string; personality?: string } }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { companionId } = request.query;
      const style = request.query.style as 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';

      // Parse JSON from query params
      let appearance: { ethnicity: string; bodyType: string; hairColor: string; breastSize?: number };
      let personality: { warmth?: number; playfulness?: number; directness?: number; curiosity?: number; empathy?: number; assertiveness?: number } | undefined;

      try {
        appearance = JSON.parse(request.query.appearance);
        if (request.query.personality) {
          personality = JSON.parse(request.query.personality);
        }
      } catch (e) {
        return reply.status(400).send({ error: 'Invalid JSON in query params' });
      }

      logger.info({ userId, companionId, appearance, style }, 'Starting SSE anchor image generation');

      const companionRepo = getCompanionsRepository();

      // Verify companion exists and belongs to user
      const companion = await companionRepo.findById(companionId);
      if (!companion) {
        return reply.status(404).send({ error: 'Companion not found' });
      }
      if (companion.user_id !== userId) {
        return reply.status(403).send({ error: 'Not authorized to modify this companion' });
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const sendSSE = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        // Force flush to prevent buffering
        if (typeof (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush === 'function') {
          (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush!();
        }
      };

      // Build base prompt from appearance
      const basePromptParts: string[] = ['Beautiful woman'];

      const ethnicityMap: Record<string, string> = {
        'east-asian': 'East Asian features',
        'south-asian': 'South Asian features',
        'black': 'Black/African features',
        'caucasian': 'Caucasian features',
        'latina': 'Latina features',
        'middle-eastern': 'Middle Eastern features',
        'mixed': 'mixed ethnicity',
      };
      const ethnicityDesc = appearance.ethnicity ? ethnicityMap[appearance.ethnicity] : undefined;
      if (ethnicityDesc) {
        basePromptParts.push(ethnicityDesc);
      }

      const bodyTypeMap: Record<string, string> = {
        'slim': 'slim figure',
        'athletic': 'athletic build',
        'curvy': 'curvy figure',
        'plus-size': 'plus-size figure',
      };
      const bodyTypeDesc = appearance.bodyType ? bodyTypeMap[appearance.bodyType] : undefined;
      if (bodyTypeDesc) {
        basePromptParts.push(bodyTypeDesc);
      }

      const hairColorMap: Record<string, string> = {
        'black': 'black hair',
        'brown': 'brown hair',
        'blonde': 'blonde hair',
        'red': 'red hair',
        'fantasy': 'vibrant fantasy-colored hair',
      };
      const hairColorDesc = appearance.hairColor ? hairColorMap[appearance.hairColor] : undefined;
      if (hairColorDesc) {
        basePromptParts.push(hairColorDesc);
      }

      const basePrompt = basePromptParts.join(', ');
      const anchorStates = ['neutral', 'happy', 'thoughtful'] as const;
      const generatedAnchors: AnchorImage[] = [];
      let primaryAnchorId: string | null = null;
      let primaryAnchorUrl: string | null = null;

      // Send initial progress
      sendSSE('progress', { phase: 'starting', total: anchorStates.length, completed: 0 });

      // Start keepalive heartbeat to prevent connection timeout during long image generation
      const heartbeatInterval = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          // Connection might be closed
          clearInterval(heartbeatInterval);
        }
      }, 15000); // Every 15 seconds

      try {
        for (let i = 0; i < anchorStates.length; i++) {
          const emotionalState: string = anchorStates[i]!;  // We know it exists because we check length
          const isPrimary = i === 0;

          sendSSE('progress', {
            phase: 'generating',
            emotionalState,
            index: i,
            total: anchorStates.length,
            completed: i,
          });

          logger.info({ companionId, emotionalState, isPrimary, index: i }, 'Generating anchor image (SSE)');

          try {
            const fullPrompt = buildPrompt({
              prompt: basePrompt,
              emotionalState,
              personality,
              style,
            });

            // Capture request start time for cost tracking
            const anchorStartTime = new Date();

            const { imageBuffer, latencyMs, provider, modelId } = await generateWithOrchestrator(
              fullPrompt,
              emotionalState,
              style,
              832,  // Optimal SDXL portrait resolution
              1248,
              isPrimary ? undefined : primaryAnchorUrl || undefined,
              isPrimary ? undefined : 0.85,
              true  // isAnchor - use high quality anchor workflow
            );

            const cacheKey = `anchor-${emotionalState}-${Date.now()}`;
            const keyPrefix = `companions/${userId}/anchors/${companionId}/${cacheKey}`;
            const s3Key = `${keyPrefix}/original.png`;

            await s3Client.send(
              new PutObjectCommand({
                Bucket: S3_MEDIA_BUCKET,
                Key: s3Key,
                Body: imageBuffer,
                ContentType: 'image/png',
                CacheControl: 'max-age=31536000',
              })
            );

            const s3Url = await getSignedUrl(
              s3Client,
              new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
              { expiresIn: 604800 }
            );

            const avatar = await companionRepo.createAvatar({
              companion_id: companionId,
              asset_url: s3Url,
              asset_type: 'identity_anchor',
              is_active: isPrimary,
              is_identity_anchor: true,
              metadata: {
                emotionalState: emotionalState as string,
                style,
                appearance,
                s3Key,
                s3_key: s3Key,
                s3Bucket: S3_MEDIA_BUCKET,
              },
              generation_params: {
                prompt: fullPrompt,
                width: 832,
                height: 1248,
                provider,
                latencyMs,
                referenceStrength: isPrimary ? null : 0.85,
              },
            });

            if (isPrimary) {
              primaryAnchorId = avatar.id;
              primaryAnchorUrl = s3Url;
              await companionRepo.setActiveAvatar(companionId, avatar.id);
            }

            // Also save to companion_images table for gallery display
            // Use a special session_id format for anchor images
            const anchorSessionId = `anchors-${companionId}`;
            const imageId = await saveImageMetadata(
              userId,
              anchorSessionId,
              companionId,
              s3Key,
              s3Url,
              832, // width
              1248, // height
              imageBuffer.length,
              emotionalState,
              style,
              fullPrompt,
              cacheKey,
              latencyMs,
              provider
            );

            // Record image usage for cost tracking
            try {
              const llmUsage = getLLMUsageService();
              await llmUsage.recordImageUsage({
                user_id: userId,
                session_id: null, // anchorSessionId is not a valid UUID
                companion_id: companionId,
                provider,
                model: modelId,
                latency_ms: Math.round(latencyMs),
                request_started_at: anchorStartTime,
                request_completed_at: new Date(),
              });
            } catch (usageErr) {
              logger.warn({ error: usageErr, imageId }, 'Failed to record anchor image usage (SSE)');
            }

            // Queue rendition processing for anchor images
            if (imageId) {
              enqueueImageRenditionJob({
                originalS3Key: s3Key,
                bucket: S3_MEDIA_BUCKET,
                userId,
                sessionId: anchorSessionId,
                cacheKey,
                imageId,
                isAnchor: true,
                companionId,
              }).catch((err) => {
                logger.warn({ error: err, imageId }, 'Failed to queue anchor rendition job (SSE)');
              });
            }

            const anchor: AnchorImage = {
              id: avatar.id,
              url: s3Url,
              emotionalState: emotionalState as string,
              isIdentityAnchor: true,
            };
            generatedAnchors.push(anchor);

            // Send the generated anchor immediately
            sendSSE('anchor', anchor);

            logger.info({
              companionId,
              avatarId: avatar.id,
              emotionalState,
              latencyMs,
              provider,
            }, 'Anchor image generated and streamed');
          } catch (imageError) {
            // Log and report individual image failure but continue with others
            const errorMessage = imageError instanceof Error ? imageError.message : String(imageError);
            logger.error({ companionId, emotionalState, error: errorMessage }, 'Failed to generate individual anchor image');
            sendSSE('progress', {
              phase: 'image_failed',
              emotionalState,
              index: i,
              total: anchorStates.length,
              completed: generatedAnchors.length,
              error: errorMessage,
            });
            // For primary image failure, we need to stop as we need it for reference
            if (isPrimary) {
              throw imageError;
            }
            // For non-primary, continue to next image
          }
        }

        // Send completion (even if some images failed)
        sendSSE('complete', {
          companionId,
          anchors: generatedAnchors,
          primaryAnchorId: primaryAnchorId!,
        });

        logger.info({ companionId, anchorCount: generatedAnchors.length, primaryAnchorId }, 'SSE anchor generation complete');

      } catch (error) {
        logger.error({ error, companionId }, 'SSE anchor image generation failed');
        sendSSE('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
          partialAnchors: generatedAnchors,
        });
      } finally {
        // Clean up heartbeat
        clearInterval(heartbeatInterval);
      }

      reply.raw.end();
    }
  );

  // Clear cache (admin only in production)
  app.delete('/cache', async (_request, reply) => {
    imageCache.clear();
    return reply.send({ message: 'Cache cleared' });
  });

  logger.info('Image generation routes registered');
}
