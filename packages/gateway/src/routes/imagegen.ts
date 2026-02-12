/**
 * Image Generation Routes
 * API endpoints for generating companion images via orchestrator (ComfyUI/FAL)
 * Images are persisted to S3 and metadata stored in PostgreSQL
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
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
import { renderPromptFromDb } from '../services/prompt-runtime.js';
import { env } from '../env.js';
import { getS3Client, getMediaBucket, buildMediaUrl } from '../utils/storage.js';

// Orchestrator configuration
const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

// S3 configuration - use shared client
const S3_MEDIA_BUCKET = getMediaBucket();
const S3_REGION = env.AWS_REGION;
const s3Client = getS3Client();

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
  turnId?: string;
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
        // If we have s3_key and s3_bucket, build a direct S3 URL (no expiry)
        // Requires S3 bucket to be publicly readable for companion images
        const metadata = selectedAnchor.metadata as Record<string, unknown> | null | undefined;
        const s3Key =
          selectedAnchor.s3_key ||
          (metadata?.['s3_key'] as string | undefined) ||
          (metadata?.['s3Key'] as string | undefined);
        const s3Bucket =
          selectedAnchor.s3_bucket ||
          (metadata?.['s3_bucket'] as string | undefined) ||
          (metadata?.['s3Bucket'] as string | undefined) ||
          S3_MEDIA_BUCKET;
        if (s3Key && s3Bucket) {
          // Use direct S3 URL (no expiry) - bucket must be publicly readable
          const directUrl = `https://${s3Bucket}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;
          logger.debug({
            companionId,
            anchorId: selectedAnchor.id,
            s3Key,
            requestedEmotion: emotionalState,
            selectedEmotion: selectedAnchor.metadata?.emotionalState,
            anchorCount: anchors.length,
          }, 'Using emotion-matched identity anchor');
          return directUrl;
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
    turnId: params.turnId,
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

function shouldRequireNsfwRouting(prompt: string, contentRating: string | undefined): boolean {
  const allowsAdultContent = contentRating === 'R' || contentRating === 'PG-13';
  if (!allowsAdultContent) {
    return false;
  }

  const nsfwPattern = /\b(nude|naked|explicit|nsfw|sex|sexual|lingerie|erotic|topless|bottomless)\b/i;
  return nsfwPattern.test(prompt);
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
  isAnchor?: boolean,
  companionId?: string,
  requireNsfw?: boolean,
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
      companion_id: companionId,
      require_nsfw: requireNsfw ?? false,
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

  // Build direct S3 URL (no expiry - bucket is publicly readable for companion images)
  const s3Url = buildMediaUrl(s3Key);

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
  turnId: string | undefined,
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
      user_id, session_id, turn_id, companion_id, s3_key, s3_url,
      width, height, format, size_bytes,
      emotional_state, style, prompt, cache_key,
      provider, latency_ms
    ) VALUES (
      ${userId}, ${sessionId}, ${turnId || null}, ${companionId || null}, ${s3Key}, ${s3Url},
      ${width}, ${height}, 'png', ${sizeBytes},
      ${emotionalState}, ${style}, ${prompt}, ${cacheKey},
      ${provider}, ${latencyMsInt}
    )
    ON CONFLICT (user_id, session_id, cache_key)
    DO UPDATE SET s3_url = ${s3Url}, latency_ms = ${latencyMsInt}, turn_id = COALESCE(${turnId || null}, companion_images.turn_id)
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
 * Register image generation routes
 */
export async function imagegenRoutes(app: FastifyInstance): Promise<void> {
  // Generate image endpoint
  app.post<{ Body: ImageGenRequest }>(
    '/generate',
    {
      preHandler: optionalAuth,
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
            turnId: { type: 'string' },
            companionId: { type: 'string' },
            referenceImageUrl: { type: 'string' },
            referenceStrength: { type: 'number', minimum: 0, maximum: 1, default: 0.7 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ImageGenRequest }>, reply: FastifyReply) => {
      const params = request.body;
      const authenticatedUserId = request.user?.userId;
      const width = params.width || 832;
      const height = params.height || 1248;
      const requestedSaveToS3 = params.saveToS3 !== false; // Default to true
      const emotionalState = params.emotionalState || 'neutral';
      let userIdForStorage: string | undefined;
      let sessionIdForStorage: string | undefined;

      if (requestedSaveToS3 || params.userId || params.sessionId || params.turnId) {
        if (!authenticatedUserId) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication is required for persisted image generation',
          });
        }
        if (!params.sessionId) {
          return reply.status(400).send({
            error: 'Invalid request',
            message: 'sessionId is required when saving generated images',
          });
        }

        const sessionRepo = getSessionsRepository();
        const session = await sessionRepo.findById(params.sessionId);
        if (!session) {
          return reply.status(404).send({
            error: 'Session not found',
            message: `No session found for id ${params.sessionId}`,
          });
        }
        if (session.user_id !== authenticatedUserId) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'You do not have access to this session',
          });
        }

        userIdForStorage = authenticatedUserId;
        sessionIdForStorage = params.sessionId;
      }

      const saveToS3 = Boolean(requestedSaveToS3 && userIdForStorage && sessionIdForStorage);

      // Get companion's stored style if companionId provided, otherwise use request param or default
      let style = params.style || 'stylized';
      let referenceImageUrl = params.referenceImageUrl;
      let companionContentRating: string | undefined;

      if (params.companionId) {
        const companionRepo = getCompanionsRepository();
        const companion = await companionRepo.findById(params.companionId);
        if (companion) {
          companionContentRating = companion.spec?.boundaries?.content_rating as string | undefined;
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
      const cacheKey = params.cacheKey || generateCacheKey({
        ...params,
        userId: userIdForStorage,
        sessionId: sessionIdForStorage,
      });

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
        const requireNsfw = shouldRequireNsfwRouting(fullPrompt, companionContentRating);

        logger.info({
          prompt: fullPrompt,
          width,
          height,
          style,
          saveToS3,
          hasReference: !!referenceImageUrl,
          companionId: params.companionId,
          requireNsfw,
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
          params.referenceStrength,
          false,
          params.companionId,
          requireNsfw
        );

        let finalUrl: string;
        let s3Key: string | undefined;
        let imageId: string | undefined;

        // Always save to S3 if userId and sessionId provided
        if (saveToS3 && userIdForStorage && sessionIdForStorage) {
          try {
            // Upload to S3 directly (image already in buffer)
            const s3Result = await uploadToS3(
              imageBuffer,
              userIdForStorage,
              sessionIdForStorage,
              cacheKey
            );

            s3Key = s3Result.s3Key;
            finalUrl = s3Result.s3Url;

            // Save metadata to database
            imageId = await saveImageMetadata(
              userIdForStorage,
              sessionIdForStorage,
              params.turnId,
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
                user_id: userIdForStorage,
                session_id: sessionIdForStorage ?? null,
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
                userId: userIdForStorage,
                sessionId: sessionIdForStorage,
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

        // Build direct S3 URLs (no expiry - bucket is publicly readable)
        const refreshedImages = images.map((img) => {
          if (img.s3_key) {
            return { ...img, s3_url: buildMediaUrl(img.s3_key) };
          }
          return img;
        });

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

          // Build direct S3 URL (no expiry - bucket is publicly readable)
          const s3Url = buildMediaUrl(s3Key);

          // Create avatar record with is_identity_anchor = true
          const avatar = await companionRepo.createAvatar({
            companion_id: companionId,
            asset_url: s3Url,
            asset_type: 'identity_anchor',
            s3_bucket: S3_MEDIA_BUCKET,
            s3_key: s3Key,
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
              s3_bucket: S3_MEDIA_BUCKET,
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
            undefined,
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
          // Pass explicit keyPrefix since anchor path structure differs from standard sessions
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
              keyPrefix, // Use the same prefix as the original upload
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

      // Build base prompt from appearance using Seedream 4.5 best practices
      // Subject description FIRST (most important), then photography terms
      const isMale = (appearance as { gender?: string }).gender === 'male';
      const basePromptParts: string[] = [isMale ? 'Handsome man' : 'Beautiful woman'];

      const ethnicityMap: Record<string, string> = {
        'east-asian': 'East Asian',
        'south-asian': 'South Asian',
        'black': 'Black',
        'caucasian': 'Caucasian',
        'latina': isMale ? 'Latino' : 'Latina',
        'middle-eastern': 'Middle Eastern',
        'mixed': 'mixed ethnicity',
      };
      const ethnicityDesc = appearance.ethnicity ? ethnicityMap[appearance.ethnicity] : undefined;
      if (ethnicityDesc) {
        basePromptParts.push(ethnicityDesc);
      }

      const bodyTypeMap: Record<string, string> = {
        'slim': 'with a slim build',
        'athletic': 'with an athletic build',
        'curvy': 'with a curvy figure',
        'plus-size': 'with a full figure',
        'muscular': 'with a muscular build',
        'dad-bod': 'with an average build',
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
        'fantasy': 'colorful hair',
      };
      const hairColorDesc = appearance.hairColor ? hairColorMap[appearance.hairColor] : undefined;
      if (hairColorDesc) {
        basePromptParts.push(hairColorDesc);
      }

      // Build subject description
      const subjectDesc = basePromptParts.join(', ');

      // Define diverse anchor scenes - each anchor gets a different style/scenario
      // This creates variety: portrait, lifestyle, and candid/activity shots
      // Randomly select from scene options to add more variety across different companions
      const sceneOptions = {
        neutral: [
          'Portrait photography, natural expression, soft diffused lighting, shallow depth of field, shot on 85mm lens, photorealistic, high resolution',
          'Relaxed seated pose on a comfortable couch, casual home setting, natural window light, authentic and approachable, lifestyle photography, photorealistic',
          'Standing with arms crossed and a confident smile, modern urban background, soft bokeh, environmental portrait, photorealistic',
        ],
        happy: [
          'Candid lifestyle photography, genuine laugh, relaxed pose in a cozy cafe setting, warm ambient lighting, natural and authentic moment, shot on 50mm lens, photorealistic',
          'Walking through a sunlit park, joyful expression, golden hour lighting, full body shot, lifestyle photography, natural and candid, photorealistic',
          'Cooking in a bright kitchen, playful expression, warm natural light, hands busy with food prep, lifestyle moment, photorealistic',
        ],
        thoughtful: [
          'Environmental portrait, gazing out a window, soft natural daylight, contemplative mood, three-quarter view, bokeh background, intimate and personal, photorealistic',
          'Reading a book in a cozy corner, soft lamp light, peaceful and absorbed, intimate lifestyle moment, photorealistic',
          'Sitting at a desk working on laptop, focused expression, warm office lighting, professional candid moment, photorealistic',
        ],
      };

      // Pick a random scene for each emotional state to add variety
      const pickRandomScene = (options: string[]) => options[Math.floor(Math.random() * options.length)]!;

      const anchorScenes = [
        { state: 'neutral' as const, scene: pickRandomScene(sceneOptions.neutral) },
        { state: 'happy' as const, scene: pickRandomScene(sceneOptions.happy) },
        { state: 'thoughtful' as const, scene: pickRandomScene(sceneOptions.thoughtful) },
      ];

      const anchorStates = anchorScenes.map(s => s.state);
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
            // Use scene-specific prompt for variety (portrait, lifestyle, candid)
            const sceneConfig = anchorScenes[i]!;
            const scenePrompt = `${subjectDesc}. ${sceneConfig.scene}`;

            const fullPrompt = buildPrompt({
              prompt: scenePrompt,
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
              true,  // isAnchor - use high quality anchor workflow
              companionId,
              false
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

            // Build direct S3 URL (no expiry - bucket is publicly readable)
            const s3Url = buildMediaUrl(s3Key);

            const avatar = await companionRepo.createAvatar({
              companion_id: companionId,
              asset_url: s3Url,
              asset_type: 'identity_anchor',
              s3_bucket: S3_MEDIA_BUCKET,
              s3_key: s3Key,
              is_active: isPrimary,
              is_identity_anchor: true,
              metadata: {
                emotionalState: emotionalState as string,
                style,
                appearance,
                s3Key,
                s3_key: s3Key,
                s3Bucket: S3_MEDIA_BUCKET,
                s3_bucket: S3_MEDIA_BUCKET,
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
              undefined,
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
            // Pass explicit keyPrefix since anchor path structure differs from standard sessions
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
                keyPrefix, // Use the same prefix as the original upload
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
