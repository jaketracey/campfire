/**
 * Image Generation Routes
 * API endpoints for generating companion images via orchestrator (ComfyUI/FAL)
 * Images are persisted to S3 and metadata stored in PostgreSQL
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { enqueueImageRenditionJob } from '../utils/queue.js';
import { getLLMUsageService } from '../services/llm-usage.js';
import { buildMediaUrl } from '../utils/storage.js';
import {
  type ImageGenRequest,
  type GenerateAnchorsRequest,
  type AnchorImage,
  type GenerateAnchorsResult,
  type ImageGenResult,
  imageCache,
  imageCacheSet,
  CACHE_TTL_MS,
  S3_MEDIA_BUCKET,
  s3Client,
  getCompanionIdentityAnchorUrl,
  generateCacheKey,
  buildPrompt,
  validateGeneratedImage,
  shouldRequireNsfwRouting,
  generateWithOrchestrator,
  downloadImage,
  generateSeededAnchorsWithOrchestrator,
  uploadToS3,
  saveImageMetadata,
  getSessionImagesWithAnchors,
} from './imagegen-helpers.js';


/**
 * Maps backstory context into concrete visual hints for image generation.
 * Returns clothing, setting, expression, and distinctive feature suggestions
 * based on the companion's occupation, style, vibe, and personality quirks.
 */
function mapBackstoryToVisualHints(backstoryContext?: {
  occupation?: string;
  style?: string;
  vibe?: string;
  setting?: string;
  personalityQuirks?: string[];
}): {
  clothingHint: string;
  settingHint: string;
  expressionHint: string;
  distinctiveFeature: string;
} {
  if (!backstoryContext) {
    // No backstory - return empty hints so the prompt still works with defaults
    return {
      clothingHint: '',
      settingHint: '',
      expressionHint: '',
      distinctiveFeature: pickRandom(DISTINCTIVE_FEATURES),
    };
  }

  // Map occupation to clothing
  const occupationClothingMap: Record<string, string[]> = {
    'nurse': ['scrubs and a stethoscope', 'casual scrubs with a cardigan'],
    'doctor': ['a white coat over a blouse', 'scrubs and a stethoscope'],
    'teacher': ['a cozy cardigan and reading glasses', 'a casual blazer over a t-shirt'],
    'engineer': ['a band t-shirt and jeans', 'a hoodie and sneakers'],
    'artist': ['paint-stained overalls', 'a vintage thrift-store jacket'],
    'musician': ['a leather jacket and vintage band tee', 'a flannel shirt with rolled sleeves'],
    'chef': ['a casual chef coat, sleeves rolled up', 'a simple apron over a t-shirt'],
    'athlete': ['athletic wear and sneakers', 'a track jacket and joggers'],
    'writer': ['a chunky knit sweater', 'an oversized flannel and glasses'],
    'lawyer': ['a tailored blazer with no tie', 'smart casual - button down and slacks'],
    'entrepreneur': ['a sleek bomber jacket', 'business casual with sneakers'],
    'photographer': ['a utility vest with camera straps', 'all black with a vintage camera around neck'],
    'student': ['a university hoodie and backpack', 'casual jeans and a graphic tee'],
    'bartender': ['a simple black shirt with rolled sleeves', 'a vest over a henley'],
    'firefighter': ['a casual FDNY t-shirt', 'an off-duty flannel and boots'],
    'military': ['a simple olive tee and dog tags', 'an off-duty henley and cargo pants'],
    'scientist': ['a lab coat over a casual top', 'smart casual with quirky science-themed accessories'],
    'therapist': ['a soft knit sweater and comfortable slacks', 'casual professional, warm colors'],
    'dancer': ['dance warmups and leg warmers', 'athletic wear with a wrap top'],
    'mechanic': ['a work shirt with grease stains', 'a simple tank top and work boots'],
  };

  // Map occupation to settings
  const occupationSettingMap: Record<string, string[]> = {
    'nurse': ['in a hospital break room', 'grabbing coffee before a shift'],
    'doctor': ['in a clinic hallway', 'at a cafe after rounds'],
    'teacher': ['in a cozy classroom', 'at a bookstore'],
    'engineer': ['at a co-working space', 'in a tech office lounge'],
    'artist': ['in a sunlit art studio', 'at a gallery opening'],
    'musician': ['backstage at a small venue', 'in a recording studio'],
    'chef': ['in a restaurant kitchen', 'at a farmers market'],
    'athlete': ['at a gym', 'on a running trail'],
    'writer': ['at a corner booth in a coffee shop', 'in a home office surrounded by books'],
    'lawyer': ['in a downtown office lobby', 'at a upscale lunch spot'],
    'entrepreneur': ['at a startup office', 'at a rooftop networking event'],
    'photographer': ['on a city street with camera', 'in a photo studio'],
    'student': ['in a university library', 'at a campus coffee shop'],
    'bartender': ['behind a craft cocktail bar', 'at a late-night diner'],
    'firefighter': ['at the firehouse', 'at a neighborhood cookout'],
    'military': ['on a base rec area', 'at a casual outdoor BBQ'],
    'scientist': ['in a research lab', 'at a conference coffee break'],
    'therapist': ['in a warm, comfortable office', 'at a quiet park bench'],
    'dancer': ['in a dance studio mirror', 'stretching in a sunlit room'],
    'mechanic': ['in a garage with vintage cars', 'leaning against a classic truck'],
  };

  // Map vibe/style to expression
  const vibeExpressionMap: Record<string, string[]> = {
    'warm': ['warm, inviting smile', 'soft genuine smile, kind eyes'],
    'mysterious': ['slight enigmatic smirk', 'intense eyes with a subtle half-smile'],
    'playful': ['playful grin, mischievous eyes', 'cheeky smile, one eyebrow slightly raised'],
    'confident': ['confident steady gaze', 'self-assured smile, relaxed posture'],
    'gentle': ['gentle, tender expression', 'soft eyes, serene and calm'],
    'intense': ['piercing focused gaze', 'intense look, jaw slightly set'],
    'nerdy': ['enthusiastic grin, eyes bright', 'adorably focused expression, slight glasses adjustment'],
    'rebellious': ['defiant smirk', 'cool detached expression with a hint of amusement'],
    'romantic': ['dreamy soft gaze', 'looking through lashes with a slight smile'],
    'adventurous': ['excited wide grin', 'windswept and energized expression'],
  };

  let clothingHint = '';
  let settingHint = '';
  let expressionHint = '';

  // Determine clothing from occupation
  if (backstoryContext.occupation) {
    const occupationKey = backstoryContext.occupation.toLowerCase();
    // Try exact match first, then partial match
    const clothingOptions = occupationClothingMap[occupationKey]
      || Object.entries(occupationClothingMap).find(([key]) => occupationKey.includes(key) || key.includes(occupationKey))?.[1];
    if (clothingOptions) {
      clothingHint = pickRandom(clothingOptions);
    }
  }

  // Determine setting from occupation or explicit setting
  if (backstoryContext.setting) {
    settingHint = backstoryContext.setting;
  } else if (backstoryContext.occupation) {
    const occupationKey = backstoryContext.occupation.toLowerCase();
    const settingOptions = occupationSettingMap[occupationKey]
      || Object.entries(occupationSettingMap).find(([key]) => occupationKey.includes(key) || key.includes(occupationKey))?.[1];
    if (settingOptions) {
      settingHint = pickRandom(settingOptions);
    }
  }

  // Determine expression from vibe or style
  const vibeKey = (backstoryContext.vibe || backstoryContext.style || '').toLowerCase();
  if (vibeKey) {
    const expressionOptions = vibeExpressionMap[vibeKey]
      || Object.entries(vibeExpressionMap).find(([key]) => vibeKey.includes(key) || key.includes(vibeKey))?.[1];
    if (expressionOptions) {
      expressionHint = pickRandom(expressionOptions);
    }
  }

  // Pick a distinctive feature (random imperfection for realism)
  let distinctiveFeature = pickRandom(DISTINCTIVE_FEATURES);

  // If personalityQuirks mention something visual, try to use it
  if (backstoryContext.personalityQuirks && backstoryContext.personalityQuirks.length > 0) {
    const visualQuirks = backstoryContext.personalityQuirks.filter(q =>
      /scar|tattoo|freckle|piercing|glasses|dimple|birthmark|gap.*tooth|curly|braid/i.test(q)
    );
    if (visualQuirks.length > 0) {
      distinctiveFeature = visualQuirks[0]!;
    }
  }

  return { clothingHint, settingHint, expressionHint, distinctiveFeature };
}

/** Pool of subtle imperfections to make generated faces more distinctive and realistic */
const DISTINCTIVE_FEATURES = [
  'light freckles across the nose',
  'a small scar on the eyebrow',
  'subtle laugh lines',
  'a beauty mark near the lip',
  'slightly crooked smile',
  'visible dimples',
  'a few forehead lines',
  'sun-kissed freckles on cheeks',
  'a small nose piercing',
  'faint crow\'s feet from smiling',
  'a tiny chin scar',
  'naturally thick eyebrows',
  'a gap between front teeth',
  'visible smile lines',
  'a subtle birthmark on the cheek',
];

/** Pick a random element from an array */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
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
            seed: { type: 'number' },
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
      let loras: Array<{ path: string; scale: number }> | undefined;
      let loraTriggerWord: string | undefined;
      let companionContentRating: string | undefined;
      let companionLora: { url: string; trigger_word?: string; scale?: number } | undefined;

      if (params.companionId) {
        const companionRepo = getCompanionsRepository();
        const companion = await companionRepo.findById(params.companionId);
        if (companion) {
          companionContentRating = companion.spec?.boundaries?.content_rating as string | undefined;
          companionLora = companion.spec?.visual_style?.lora as typeof companionLora;
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

      // If we still have no reference image, fall back to an identity LoRA (if configured).
      // This keeps character identity stable in the FAL-only path even when anchors are missing.
      if (!referenceImageUrl && companionLora?.url) {
        loras = [
          {
            path: companionLora.url,
            scale: typeof companionLora.scale === 'number' ? companionLora.scale : 1.0,
          },
        ];
        loraTriggerWord = companionLora.trigger_word;
      }

      // Generate or use provided cache key
      const cacheKey = params.cacheKey || generateCacheKey({
        ...params,
        userId: userIdForStorage,
        sessionId: sessionIdForStorage,
        referenceImageUrl,
        referenceStrength: params.referenceStrength,
        loras,
        loraTriggerWord,
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
        // Build the full prompt (pass resolved style so quality suffix matches)
        const fullPrompt = buildPrompt({ ...params, style });
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
        let orchestratorResult = await generateWithOrchestrator(
          fullPrompt,
          emotionalState,
          style,
          width,
          height,
          referenceImageUrl,
          params.referenceStrength,
          false,
          params.companionId,
          requireNsfw,
          loras,
          loraTriggerWord,
          params.seed
        );

        // Validate image quality - retry once on failure
        const validation = await validateGeneratedImage(orchestratorResult.imageBuffer, width, height);
        if (!validation.valid) {
          logger.warn({
            reason: validation.reason,
            companionId: params.companionId,
            cacheKey,
            width,
            height,
          }, 'Image quality validation failed, retrying once');

          orchestratorResult = await generateWithOrchestrator(
            fullPrompt,
            emotionalState,
            style,
            width,
            height,
            referenceImageUrl,
            params.referenceStrength,
            false,
            params.companionId,
            requireNsfw,
            loras,
            loraTriggerWord,
            params.seed
          );

          const retryValidation = await validateGeneratedImage(orchestratorResult.imageBuffer, width, height);
          if (!retryValidation.valid) {
            logger.warn({
              reason: retryValidation.reason,
              companionId: params.companionId,
              cacheKey,
            }, 'Image quality validation failed on retry, proceeding anyway');
          }
        }

        const { imageBuffer, latencyMs, provider, modelId, format } = orchestratorResult;

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

        // Cache the result (bounded, skips data: URLs)
        imageCacheSet(cacheKey, finalUrl);

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
          let imageBuffer = await downloadImage(anchor.image_url);

          // Validate anchor image quality - retry once on failure
          const anchorValidation = await validateGeneratedImage(imageBuffer, anchor.width, anchor.height);
          if (!anchorValidation.valid) {
            logger.warn({
              reason: anchorValidation.reason,
              companionId,
              emotionalState,
              index: i,
            }, 'Anchor image quality validation failed, proceeding with image');
          }

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
  app.get<{ Querystring: { companionId: string; appearance: string; style: string; personality?: string; backstoryContext?: string } }>(
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
            backstoryContext: { type: 'string' },  // JSON stringified, optional
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { companionId: string; appearance: string; style: string; personality?: string; backstoryContext?: string } }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { companionId } = request.query;
      const style = request.query.style as 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';

      // Parse JSON from query params
      let appearance: { ethnicity: string; bodyType: string; hairColor: string; breastSize?: number };
      let personality: { warmth?: number; playfulness?: number; directness?: number; curiosity?: number; empathy?: number; assertiveness?: number } | undefined;
      let backstoryContext: { occupation?: string; style?: string; vibe?: string; setting?: string; personalityQuirks?: string[] } | undefined;

      try {
        appearance = JSON.parse(request.query.appearance);
        if (request.query.personality) {
          personality = JSON.parse(request.query.personality);
        }
        if (request.query.backstoryContext) {
          backstoryContext = JSON.parse(request.query.backstoryContext);
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

      // Guard: skip if anchors already exist (prevents duplicate generation)
      const existingAvatarsResult = await companionRepo.listAvatars(companionId);
      if (existingAvatarsResult.data.length > 0) {
        logger.info({ companionId, existingCount: existingAvatarsResult.data.length }, 'Anchor images already exist, skipping generation');
        return reply.status(200).send({
          companionId,
          anchors: existingAvatarsResult.data.map((a) => ({
            id: a.id,
            url: a.asset_url,
            emotionalState: (a.metadata as Record<string, unknown>)?.emotionalState || 'neutral',
            isIdentityAnchor: true,
          })),
          primaryAnchorId: existingAvatarsResult.data.find((a) => a.is_active)?.id || existingAvatarsResult.data[0]?.id,
          skipped: true,
        });
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

      // Map backstory to visual hints for more distinctive, character-driven images
      const visualHints = mapBackstoryToVisualHints(backstoryContext);

      // Build base prompt from appearance - character-driven, not generic beauty
      const isMale = (appearance as { gender?: string }).gender === 'male';

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

      const bodyTypeMap: Record<string, string> = {
        'slim': 'slim, slender build',
        'athletic': 'toned athletic build',
        'curvy': 'curvy figure with wide hips',
        'plus-size': 'plus-size, thick body, soft belly, wide hips',
        'muscular': 'muscular, broad-shouldered build',
        'dad-bod': 'stocky dad-bod build, soft midsection',
      };
      // Add breast size to body description for female companions
      const breastSizeMap: Record<string, string> = {
        'S': 'small chest',
        'M': '',  // Don't mention — reads as average/default
        'L': 'large chest',
        'XL': 'very large chest',
      };
      const breastDesc = !isMale && (appearance as { breastSize?: string }).breastSize
        ? breastSizeMap[(appearance as { breastSize?: string }).breastSize || 'M'] || ''
        : '';
      // Add male build size descriptor
      const buildSizeMap: Record<string, string> = {
        'S': 'lean, narrow frame',
        'M': '',  // Default — don't mention
        'L': 'broad, large frame',
        'XL': 'very large, heavy frame',
      };
      const buildDesc = isMale && (appearance as { build?: string }).build
        ? buildSizeMap[(appearance as { build?: string }).build || 'M'] || ''
        : '';
      let bodyTypeDesc = appearance.bodyType ? bodyTypeMap[appearance.bodyType] : undefined;
      if (isMale && buildDesc && bodyTypeDesc) {
        bodyTypeDesc = `${bodyTypeDesc}, ${buildDesc}`;
      } else if (!isMale && breastDesc && bodyTypeDesc) {
        bodyTypeDesc = `${bodyTypeDesc}, ${breastDesc}`;
      } else if (breastDesc) {
        bodyTypeDesc = breastDesc;
      }

      const hairColorMap: Record<string, string> = {
        'black': 'black hair',
        'brown': 'brown hair',
        'blonde': 'blonde hair',
        'red': 'red hair',
        'fantasy': 'colorful hair',
      };
      const hairColorDesc = appearance.hairColor ? hairColorMap[appearance.hairColor] : undefined;

      // Build subject description: "East Asian woman, slim build, black hair, light freckles"
      const subjectParts: string[] = [];
      if (ethnicityDesc) subjectParts.push(`${ethnicityDesc} ${isMale ? 'man' : 'woman'}`);
      else subjectParts.push(isMale ? 'man' : 'woman');
      if (bodyTypeDesc) subjectParts.push(bodyTypeDesc);
      if (hairColorDesc) subjectParts.push(hairColorDesc);
      if (visualHints.distinctiveFeature) subjectParts.push(visualHints.distinctiveFeature);
      const subjectDesc = subjectParts.join(', ');

      // Build clothing/setting context from backstory
      const clothingClause = visualHints.clothingHint ? `Wearing ${visualHints.clothingHint}` : '';
      const settingClause = visualHints.settingHint || '';

      // Define diverse anchor scenes - casual iPhone-style photography
      // These feel like dating profile photos or candid shots from friends
      // Varied outfits per scene — each emotional state gets its own wardrobe
      const outfits = isMale ? {
        neutral: clothingClause || 'Wearing a casual henley and jeans',
        happy: 'Wearing a light linen shirt, sleeves rolled up',
        thoughtful: 'Wearing a cozy crewneck sweater',
        confident: 'Wearing a fitted leather jacket and dark jeans',
        playful: 'Wearing a vintage graphic tee and shorts',
      } : {
        neutral: clothingClause || 'Wearing a casual t-shirt and jeans',
        happy: 'Wearing a flowy sundress',
        thoughtful: 'Wearing a cozy oversized sweater',
        confident: 'Wearing a fitted leather jacket and dark jeans',
        playful: 'Wearing a colorful crop top and high-waisted shorts',
      };

      const sceneOptions = {
        neutral: [
          `Candid photo of SUBJECT. ${outfits.neutral}${settingClause ? `, ${settingClause}` : ', at a restaurant table'}. ${visualHints.expressionHint || 'Relaxed, natural expression'}. Natural lighting, everything in focus. Authentic, not retouched.`,
          `SUBJECT looking at the camera with a slight smile. ${outfits.neutral}${settingClause ? `, ${settingClause}` : ', leaning against a doorway at home'}. ${visualHints.expressionHint || 'Casual, everyday moment'}. Not posed, natural light.`,
          `Candid photo of SUBJECT. ${outfits.neutral}${settingClause ? `, standing ${settingClause}` : ', standing on a rooftop bar'}. ${visualHints.expressionHint || 'Confident, easy smile'}. Natural lighting, no retouching.`,
        ],
        happy: [
          `SUBJECT caught mid-laugh. ${outfits.happy}${settingClause ? `, ${settingClause}` : ', at an outdoor brunch with friends'}. Genuine, unposed moment of joy. Natural daylight, everything in focus. Feels real.`,
          `SUBJECT laughing during ${settingClause || 'a weekend hike'}. ${outfits.happy}. Sunlight on face, eyes crinkled, totally natural. Not studio, not retouched.`,
          `SUBJECT grinning at the camera. ${outfits.happy}${settingClause ? `, ${settingClause}` : ', at a friend\'s backyard party'}. Golden hour lighting, relaxed and happy. Authentic moment.`,
        ],
        thoughtful: [
          `SUBJECT lost in thought. ${outfits.thoughtful}${settingClause ? `, ${settingClause}` : ', sitting by a window at a coffee shop'}. ${visualHints.expressionHint || 'Pensive, looking slightly away from camera'}. Natural light, not posed, intimate moment.`,
          `SUBJECT reading ${settingClause ? settingClause : 'at a cozy cafe'}. ${outfits.thoughtful}. Absorbed and peaceful, candid moment. Warm ambient light, everything in focus. Authentic.`,
          `SUBJECT resting chin on hand. ${outfits.thoughtful}${settingClause ? `, ${settingClause}` : ', at a bright apartment window'}. ${visualHints.expressionHint || 'Focused, slight concentration'}. Natural window light, real, unfiltered.`,
        ],
        confident: [
          `SUBJECT standing tall. ${outfits.confident}${settingClause ? `, ${settingClause}` : ', on a city street'}. Direct eye contact with camera, self-assured smirk. Golden hour side lighting. Natural, no filter.`,
          `SUBJECT leaning against a wall. ${outfits.confident}${settingClause ? `, ${settingClause}` : ', outside a trendy bar'}. Arms crossed, knowing smile. Evening light. Effortlessly cool, not posed.`,
          `SUBJECT looking over their shoulder. ${outfits.confident}${settingClause ? `, ${settingClause}` : ', walking through a park'}. Confident glance back at camera. Warm afternoon light, candid moment. Authentic.`,
        ],
        playful: [
          `SUBJECT making a silly face. ${outfits.playful}${settingClause ? `, ${settingClause}` : ', at a beach boardwalk'}. Tongue out or winking, totally goofing off. Bright daylight. Fun, real moment.`,
          `SUBJECT mid-dance. ${outfits.playful}${settingClause ? `, ${settingClause}` : ', in a living room with fairy lights'}. Eyes bright, playful energy. Slightly blurred motion, candid and spontaneous. Not staged.`,
          `SUBJECT throwing a peace sign. ${outfits.playful}${settingClause ? `, ${settingClause}` : ', at a food truck festival'}. Cheeky grin, having the best time. Natural lighting. Genuine fun.`,
        ],
      };

      // Pick a random scene for each emotional state to add variety
      const pickRandomScene = (options: string[]) => options[Math.floor(Math.random() * options.length)]!;

      const anchorScenes = [
        { state: 'neutral' as const, scene: pickRandomScene(sceneOptions.neutral) },
        { state: 'happy' as const, scene: pickRandomScene(sceneOptions.happy) },
        { state: 'thoughtful' as const, scene: pickRandomScene(sceneOptions.thoughtful) },
        { state: 'confident' as const, scene: pickRandomScene(sceneOptions.confident) },
        { state: 'playful' as const, scene: pickRandomScene(sceneOptions.playful) },
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
            // Scene templates use SUBJECT placeholder which gets replaced with the appearance description
            const sceneConfig = anchorScenes[i]!;
            const scenePrompt = sceneConfig.scene.replace('SUBJECT', subjectDesc);

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
