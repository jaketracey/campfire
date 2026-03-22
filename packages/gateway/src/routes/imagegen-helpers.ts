/**
 * Image Generation Helpers
 * Types, interfaces, and utility functions for image generation routes.
 */

import { createHash } from 'crypto';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../observability/logger.js';
import { db } from '../db/index.js';
import type { CompanionAvatar, CompanionImage } from '../db/types.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import {
  getAppearanceFromSpec,
  getVariationUrl,
} from '../utils/companion-assets.js';
import { getRenditionKeyPrefix } from '@campfire/shared';
import { env } from '../env.js';
import { getS3Client, getMediaBucket, buildMediaUrl } from '../utils/storage.js';

// Orchestrator configuration
export const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

/**
 * Comprehensive negative prompt for photorealistic image generation.
 * Covers AI artifacts, unrealistic skin, bad anatomy, and stylistic pitfalls.
 * Used as the default for all companion image generation endpoints.
 */
export const REALISTIC_NEGATIVE_PROMPT = [
  // Anatomical errors
  'bad anatomy', 'bad hands', 'bad fingers', 'extra fingers', 'fewer fingers',
  'extra limbs', 'missing limbs', 'floating limbs', 'disconnected limbs',
  'mutation', 'mutated', 'deformed', 'disfigured', 'malformed face',
  'cross-eyed', 'asymmetric eyes', 'wrong proportions',
  // AI skin artifacts
  'plastic skin', 'waxy skin', 'airbrushed skin', 'poreless skin',
  'uncanny valley', 'mannequin', 'wax figure', 'doll-like',
  // Over-processing & filters
  'oversaturated', 'HDR look', 'beauty filter', 'snapchat filter',
  'overprocessed', 'oversharpened', 'oversmoothed',
  // Quality issues
  'low quality', 'worst quality', 'blurry', 'pixelated', 'grainy',
  'low resolution', 'artifacts', 'noise', 'jpeg artifacts',
  'overexposed', 'underexposed', 'bad lighting',
  // Style contamination
  'cartoon', 'anime', '3d render', 'illustration', 'painting',
  'sketch', 'drawing', 'digital art', 'cgi',
  // Unwanted overlays
  'watermark', 'text', 'signature', 'logo', 'border', 'frame',
  // Studio / stock look
  'stock photo', 'glamour shot', 'fashion editorial',
  'overly posed', 'stiff pose', 'awkward pose',
].join(', ');

/**
 * Quality suffix appended to prompts for realistic-style companion images.
 * Emphasizes natural skin texture, authentic lighting, and casual photography
 * aesthetics -- the opposite of airbrushed perfection.
 */
export const REALISTIC_QUALITY_SUFFIX = [
  'natural skin texture with visible pores',
  'authentic lighting',
  'shot on smartphone',
  'candid moment',
  'no retouching',
  'natural imperfections',
  'real person',
  'casual photography',
].join(', ');

// S3 configuration - use shared client
export const S3_MEDIA_BUCKET = getMediaBucket();
export const S3_REGION = env.AWS_REGION;
export const s3Client = getS3Client();

export interface ImageGenRequest {
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
  /** Optional LoRAs for FAL flux-lora endpoints */
  loras?: Array<{ path: string; scale: number }>;
  /** Optional LoRA trigger token (appended to prompt when using LoRA) */
  loraTriggerWord?: string;
  /** Optional seed for reproducibility (provider/model dependent) */
  seed?: number;
}

export interface GenerateAnchorsRequest {
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

export interface ImageGenResult {
  imageUrl: string;
  cacheKey: string;
  width: number;
  height: number;
  latencyMs: number;
  cached: boolean;
  s3Key?: string;
  imageId?: string;
  renditions?: import('@campfire/shared').ImageRenditions;
}

// In-memory cache for generated images (in production, use Redis)
// Bounded to prevent unbounded memory growth; evicts oldest entries when full.
const IMAGE_CACHE_MAX_SIZE = 500;
export const imageCache = new Map<string, { url: string; timestamp: number }>();
export const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Set a value in the image cache with bounded size.
 * Evicts expired entries first, then oldest entries if still over capacity.
 * Refuses to cache data: URLs to avoid storing multi-MB base64 strings in memory.
 */
export function imageCacheSet(key: string, url: string): void {
  // Never cache data: URLs - they can be several MB and defeat the purpose
  if (url.startsWith('data:')) return;

  imageCache.set(key, { url, timestamp: Date.now() });

  // Evict if over capacity
  if (imageCache.size > IMAGE_CACHE_MAX_SIZE) {
    const now = Date.now();
    // First pass: remove expired entries
    for (const [k, v] of imageCache) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        imageCache.delete(k);
      }
    }
    // Second pass: if still over, remove oldest entries
    if (imageCache.size > IMAGE_CACHE_MAX_SIZE) {
      const entriesToRemove = imageCache.size - IMAGE_CACHE_MAX_SIZE;
      let removed = 0;
      for (const k of imageCache.keys()) {
        if (removed >= entriesToRemove) break;
        imageCache.delete(k);
        removed++;
      }
    }
  }
}

/**
 * Maps emotional states to anchor types for emotion-matched reference selection.
 * During onboarding, 3 anchors are generated: neutral, happy, thoughtful.
 * This map allows selecting the most appropriate anchor based on the scene's emotion.
 */
export const EMOTION_TO_ANCHOR_MAP: Record<string, string> = {
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
export function selectBestAnchor(
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
export async function getCompanionIdentityAnchorUrl(
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
export function generateCacheKey(params: ImageGenRequest): string {
  const keyData = {
    prompt: params.prompt,
    emotionalState: params.emotionalState,
    personality: params.personality,
    style: params.style,
    width: params.width,
    height: params.height,
    referenceImageUrl: params.referenceImageUrl,
    referenceStrength: params.referenceStrength,
    loras: params.loras,
    loraTriggerWord: params.loraTriggerWord,
    seed: params.seed,
    // Include IDs so each companion gets unique cached images
    userId: params.userId,
    sessionId: params.sessionId,
    turnId: params.turnId,
    companionId: params.companionId,
  };
  return createHash('sha256').update(JSON.stringify(keyData)).digest('hex').slice(0, 16);
}

/**
 * Phrases that signal overly polished / studio-style imagery.
 * We strip these from the LLM-generated prompt so the downstream
 * quality suffix can steer toward a phone-camera aesthetic instead.
 */
const STUDIO_PHRASES_RE = new RegExp(
  [
    '8[kK]\\s*resolution',
    'photorealistic',
    'photo[- ]?realistic',
    'flawless skin',
    'perfect skin',
    'studio lighting',
    'studio portrait',
    'professional photography',
    'professional portrait',
    'shallow depth of field',
    'bokeh',
    'shot on 85mm lens',
    '85mm lens',
    'DSLR',
    'high resolution',
    'hyper[- ]?realistic',
    'ultra[- ]?realistic',
    'magazine quality',
    'fashion photography',
    'beauty shot',
  ].join('|'),
  'gi',
);

/**
 * Build the full prompt for image generation.
 *
 * The companion LLM provides the creative scene description via imagePrompt.
 * This function:
 *  1. Strips studio/glamour photography language the LLM may inject
 *  2. Appends a phone-camera quality suffix so the final image looks like
 *     a candid smartphone photo rather than a studio portrait
 *
 * For realistic-style images, the shared REALISTIC_QUALITY_SUFFIX is appended.
 * Identity is preserved by IP-Adapter from the anchor image, so we only
 * need to control the *aesthetic* here.
 */
export function buildPrompt(params: ImageGenRequest): string {
  // Strip studio-photography language the LLM may have included
  let prompt = params.prompt
    .replace(STUDIO_PHRASES_RE, '')
    // Collapse any leftover double-commas / extra whitespace from removals
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Remove trailing comma left after stripping
  if (prompt.endsWith(',')) {
    prompt = prompt.slice(0, -1).trim();
  }

  // For realistic / stylized styles, append the shared quality suffix.
  // Other styles (anime, abstract, minimal) skip the realism treatment.
  const style = params.style || 'realistic';
  if (style === 'realistic' || style === 'stylized') {
    return `${prompt}. ${REALISTIC_QUALITY_SUFFIX}`;
  }

  return prompt;
}

/**
 * Lightweight validation for generated images.
 * Checks dimensions, brightness, and file size to catch obviously bad generations.
 * Designed to run in < 50ms using sharp's stats() which operates on raw pixel data.
 */
export async function validateGeneratedImage(
  imageBuffer: Buffer,
  expectedWidth: number,
  expectedHeight: number
): Promise<{ valid: boolean; reason?: string }> {
  const MIN_FILE_SIZE_BYTES = 5 * 1024; // 5KB - smaller likely means an error placeholder
  const MIN_BRIGHTNESS = 5;   // < 5% average brightness = mostly black
  const MAX_BRIGHTNESS = 95;  // > 95% average brightness = mostly white/blown out

  // Check file size first (cheapest check)
  if (imageBuffer.length < MIN_FILE_SIZE_BYTES) {
    return {
      valid: false,
      reason: `File size too small: ${imageBuffer.length} bytes (min ${MIN_FILE_SIZE_BYTES})`,
    };
  }

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // Check dimensions match expected (allow some tolerance for rounding)
    const actualWidth = metadata.width || 0;
    const actualHeight = metadata.height || 0;
    const widthDiff = Math.abs(actualWidth - expectedWidth);
    const heightDiff = Math.abs(actualHeight - expectedHeight);

    if (widthDiff > 2 || heightDiff > 2) {
      return {
        valid: false,
        reason: `Dimension mismatch: got ${actualWidth}x${actualHeight}, expected ${expectedWidth}x${expectedHeight}`,
      };
    }

    // Check brightness using sharp stats (mean of all channels)
    const stats = await image.stats();
    // Average the mean brightness across all channels, normalize to 0-100
    const channelMeans = stats.channels.map(c => c.mean);
    const avgBrightness = (channelMeans.reduce((sum, m) => sum + m, 0) / channelMeans.length) / 2.55;

    if (avgBrightness < MIN_BRIGHTNESS) {
      return {
        valid: false,
        reason: `Image too dark: average brightness ${avgBrightness.toFixed(1)}% (min ${MIN_BRIGHTNESS}%)`,
      };
    }

    if (avgBrightness > MAX_BRIGHTNESS) {
      return {
        valid: false,
        reason: `Image too bright: average brightness ${avgBrightness.toFixed(1)}% (max ${MAX_BRIGHTNESS}%)`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Failed to analyze image: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

export function shouldRequireNsfwRouting(prompt: string, contentRating: string | undefined): boolean {
  const allowsAdultContent = contentRating === 'R' || contentRating === 'PG-13';
  if (!allowsAdultContent) {
    return false;
  }

  const nsfwPattern = /\b(nude|naked|explicit|nsfw|sex|sexual|lingerie|erotic|topless|bottomless)\b/i;
  return nsfwPattern.test(prompt);
}

export interface OrchestratorImageGenResponse {
  image_base64: string;
  format: string;
  width: number;
  height: number;
  latency_ms: number;
  provider: string;
  model_id: string;
  prompt_used: string;
}

export interface OrchestratorAnchorImageResult {
  image_url: string;
  emotional_state: string;
  scene: string | null;
  is_identity_seed: boolean;
  seed: number | null;
  width: number;
  height: number;
  latency_ms: number;
}

export interface OrchestratorSeededAnchorResponse {
  seed_anchor: OrchestratorAnchorImageResult;
  variation_anchors: OrchestratorAnchorImageResult[];
  random_seed: number;
  total_latency_ms: number;
}

/**
 * Call orchestrator to generate an image (uses ComfyUI or FAL)
 */
export async function generateWithOrchestrator(
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
  loras?: Array<{ path: string; scale: number }>,
  loraTriggerWord?: string,
  seed?: number,
  negativePrompt?: string,
): Promise<{ imageBuffer: Buffer; latencyMs: number; provider: string; modelId: string; format: string }> {
  const url = `${ORCHESTRATOR_URL}/imagegen/generate`;

  // Default to REALISTIC_NEGATIVE_PROMPT for realistic/stylized styles
  const effectiveNegative = negativePrompt ??
    ((style === 'realistic' || style === 'stylized') ? REALISTIC_NEGATIVE_PROMPT : undefined);

  logger.info({ url, prompt: prompt.slice(0, 100), emotionalState, style, hasReference: !!referenceImageUrl, isAnchor, hasNegativePrompt: !!effectiveNegative }, 'Calling orchestrator for image generation');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      emotional_state: emotionalState,
      style,
      negative_prompt: effectiveNegative,
      width,
      height,
      reference_image_url: referenceImageUrl,
      reference_strength: referenceStrength ?? 0.7,
      is_anchor: isAnchor ?? false,
      companion_id: companionId,
      require_nsfw: requireNsfw ?? false,
      loras: loras && loras.length > 0 ? loras : undefined,
      lora_trigger_word: loraTriggerWord,
      seed,
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
export async function downloadImage(url: string): Promise<Buffer> {
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
export async function generateSeededAnchorsWithOrchestrator(
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
export async function uploadToS3(
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
export async function saveImageMetadata(
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
export async function getSessionImages(
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
export async function getSessionImagesWithAnchors(
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
