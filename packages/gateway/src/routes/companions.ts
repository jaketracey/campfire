/**
 * Companion Routes
 * AI companion management and configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { getKnowledgeGraphRepository } from '../repositories/knowledge-graph.js';
import { db } from '../db/index.js';
import { logger } from '../observability/logger.js';
import type { CompanionSpec } from '../db/types.js';
import { env } from '../env.js';
import { buildMediaUrl } from '../utils/storage.js';
import type { ImageRenditions, RenditionFormats } from '@campfire/shared';

// Orchestrator configuration
const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

// Appearance schema for validation (gender-aware discriminated union)
const FemaleAppearanceSchema = z.object({
  gender: z.literal('female'),
  ethnicity: z.enum(['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed']),
  bodyType: z.enum(['slim', 'athletic', 'curvy', 'plus-size']),
  hairColor: z.enum(['black', 'brown', 'blonde', 'red', 'fantasy']),
  breastSize: z.enum(['S', 'M', 'L']),
});

const MaleAppearanceSchema = z.object({
  gender: z.literal('male'),
  ethnicity: z.enum(['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed']),
  bodyType: z.enum(['slim', 'athletic', 'muscular', 'dad-bod']),
  hairColor: z.enum(['black', 'brown', 'blonde', 'red', 'fantasy']),
  build: z.enum(['S', 'M', 'L']),
});

const AppearanceSchema = z.discriminatedUnion('gender', [
  FemaleAppearanceSchema,
  MaleAppearanceSchema,
]);

// Request schemas - simplified input for API consumers
const CreateCompanionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  personality: z.string().max(2000),
  voiceId: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().default(false),
  // Full spec for detailed configuration (from onboarding)
  spec: z.object({
    identity: z.object({
      name: z.string().optional(),
      pronouns: z.string().optional(),
      address_style: z.string().optional(),
    }).optional(),
    personality: z.object({
      archetype: z.string().optional(),
      secondary_archetype: z.string().optional(),
      traits: z.record(z.string(), z.number()).optional(),
    }).optional(),
    voice: z.object({
      provider: z.string().optional(),
      voice_id: z.string().optional(),
    }).optional(),
    visual_style: z.object({
      style_type: z.string().optional(),
      appearance: AppearanceSchema.optional(),
      palette: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      lora: z.object({
        provider: z.literal('fal').optional(),
        url: z.string().url(),
        trigger_word: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/).optional(),
        scale: z.number().min(0).max(1.5).optional(),
      }).optional(),
    }).optional(),
    boundaries: z.object({
      relationship_pacing: z.string().optional(),
      topics_avoid: z.array(z.string()).optional(),
      safe_topics: z.array(z.string()).optional(),
      content_rating: z.string().optional(),
      emotional_depth: z.enum(['surface', 'moderate', 'deep']).optional(),
    }).optional(),
    memory_consent: z.object({
      allow_long_term: z.boolean().optional(),
      allow_kg_extraction: z.boolean().optional(),
      retention_days: z.number().optional(),
    }).optional(),
    tenets: z.array(z.object({
      id: z.string(),
      category: z.string(),
      priority: z.enum(['core', 'situational']),
      rule: z.string(),
      description: z.string().optional(),
      isNegation: z.boolean(),
      triggerContexts: z.array(z.string()).optional(),
    })).optional(),
  }).optional(),
});

const UpdateCompanionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  personality: z.string().max(2000).optional(),
  voiceId: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  spec: z.object({
    identity: z.object({
      name: z.string().optional(),
      pronouns: z.string().optional(),
      backstory: z.string().optional(),
      address_style: z.string().optional(),
    }).optional(),
    personality: z.object({
      archetype: z.string().optional(),
      secondary_archetype: z.string().optional(),
      traits: z.record(z.string(), z.number().min(0).max(100)).optional(),
    }).optional(),
    voice: z.object({
      provider: z.string().optional(),
      voice_id: z.string().optional(),
    }).optional(),
    visual_style: z.object({
      style_type: z.string().optional(),
      appearance: AppearanceSchema.optional(),
      palette: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      lora: z.object({
        provider: z.literal('fal').optional(),
        url: z.string().url(),
        trigger_word: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/).optional(),
        scale: z.number().min(0).max(1.5).optional(),
      }).optional(),
    }).optional(),
    boundaries: z.object({
      relationship_pacing: z.string().optional(),
      content_rating: z.string().optional(),
      emotional_depth: z.enum(['surface', 'moderate', 'deep']).optional(),
      topics_avoid: z.array(z.string()).optional(),
      safe_topics: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

/**
 * Build a CompanionSpec from simplified input, merging with provided spec
 */
function buildSpec(input: {
  name: string;
  description?: string;
  personality: string;
  voiceId?: string;
  providedSpec?: z.infer<typeof CreateCompanionSchema>['spec'];
}): CompanionSpec {
  const provided = input.providedSpec || {};

  const personality: CompanionSpec['personality'] = {
    archetype: provided.personality?.archetype || 'companion',
    traits: provided.personality?.traits || {
      warmth: 0.7,
      playfulness: 0.5,
      directness: 0.5,
      empathy: 0.7,
    },
  };
  if (provided.personality?.secondary_archetype) {
    personality.secondary_archetype = provided.personality.secondary_archetype;
  }

  const visual_style: CompanionSpec['visual_style'] = {
    style_type: provided.visual_style?.style_type || 'default',
  };
  if (provided.visual_style?.appearance) {
    // Pass through the complete appearance object (gender-aware)
    visual_style.appearance = provided.visual_style.appearance;
  }
  if (provided.visual_style?.palette) {
    visual_style.palette = provided.visual_style.palette;
  }
  if (provided.visual_style?.constraints) {
    visual_style.constraints = provided.visual_style.constraints;
  }
  if (provided.visual_style?.lora) {
    visual_style.lora = provided.visual_style.lora;
  }

  const boundaries: CompanionSpec['boundaries'] = {
    relationship_pacing: provided.boundaries?.relationship_pacing || 'moderate',
    content_rating: provided.boundaries?.content_rating || 'PG-13',
  };
  if (provided.boundaries?.topics_avoid) {
    boundaries.topics_avoid = provided.boundaries.topics_avoid;
  }
  if (provided.boundaries?.safe_topics) {
    boundaries.safe_topics = provided.boundaries.safe_topics;
  }
  if (provided.boundaries?.emotional_depth) {
    boundaries.emotional_depth = provided.boundaries.emotional_depth;
  }

  const memory_consent: CompanionSpec['memory_consent'] = {
    allow_long_term: provided.memory_consent?.allow_long_term ?? true,
    allow_kg_extraction: provided.memory_consent?.allow_kg_extraction ?? true,
  };
  if (provided.memory_consent?.retention_days !== undefined) {
    memory_consent.retention_days = provided.memory_consent.retention_days;
  }

  const result: CompanionSpec = {
    identity: {
      name: provided.identity?.name || input.name,
      pronouns: provided.identity?.pronouns || 'they/them',
      address_style: provided.identity?.address_style || 'friendly',
    },
    personality,
    voice: {
      provider: provided.voice?.provider || 'elevenlabs',
      voice_id: provided.voice?.voice_id || input.voiceId || 'default',
    },
    visual_style,
    boundaries,
    memory_consent,
  };

  if (provided.tenets) {
    result.tenets = provided.tenets.map((t) => {
      const tenet: NonNullable<CompanionSpec['tenets']>[number] = {
        id: t.id,
        category: t.category,
        priority: t.priority,
        rule: t.rule,
        isNegation: t.isNegation,
      };
      if (t.description) tenet.description = t.description;
      if (t.triggerContexts) tenet.triggerContexts = t.triggerContexts;
      return tenet;
    });
  }

  return result;
}

/**
 * Map companion DB record to API response
 */
function mapCompanionResponse(companion: {
  id: string;
  user_id: string;
  name: string;
  spec: CompanionSpec | null;
  spec_version: number;
  status: string;
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
}, avatarUrl?: string | null, avatarRenditions?: ImageRenditions | null) {
  const spec = companion.spec;
  // Prefer compressed rendition for avatarUrl to save bandwidth
  // Priority: small webp > thumb webp > original avatarUrl
  const optimizedAvatarUrl =
    avatarRenditions?.small?.webp?.url ||
    avatarRenditions?.thumb?.webp?.url ||
    avatarRenditions?.medium?.webp?.url ||
    avatarUrl ||
    null;
  return {
    id: companion.id,
    name: companion.name,
    description: null, // Could be stored in extended spec in the future
    personality: JSON.stringify(spec?.personality || {}),
    voiceId: spec?.voice?.voice_id || null,
    avatarUrl: optimizedAvatarUrl,
    avatarRenditions: avatarRenditions ?? null,
    isPublic: companion.is_public,
    isActive: companion.status === 'active',
    status: companion.status,
    createdAt: companion.created_at,
    ownerId: companion.user_id,
    // Include full spec for image generation and other features
    spec: companion.spec,
    specVersion: companion.spec_version,
  };
}

/**
 * Get latest session for each companion
 */
async function getLatestSessionsForCompanions(
  userId: string,
  companionIds: string[]
): Promise<Map<string, { id: string; updatedAt: Date }>> {
  if (companionIds.length === 0) return new Map();

  const results = await db.sql`
    SELECT DISTINCT ON (companion_id)
      id, companion_id, last_activity_at
    FROM sessions
    WHERE user_id = ${userId}
      AND companion_id = ANY(${companionIds})
      AND status IN ('active', 'paused')
    ORDER BY companion_id, last_activity_at DESC NULLS LAST
  `;

  const sessionMap = new Map<string, { id: string; updatedAt: Date }>();
  for (const row of results) {
    sessionMap.set(row.companion_id, {
      id: row.id,
      updatedAt: row.last_activity_at || new Date(),
    });
  }
  return sessionMap;
}

/**
 * Latest image data for a companion
 */
interface LatestImageData {
  s3_url: string;
  renditions: ImageRenditions | null;
}

/**
 * Get latest image for each companion from conversations
 * Builds direct S3 URLs for all renditions (bucket is publicly readable)
 */
async function getLatestImagesForCompanions(
  userId: string,
  companionIds: string[]
): Promise<Map<string, LatestImageData>> {
  if (companionIds.length === 0) return new Map();

  const results = await db.sql`
    SELECT DISTINCT ON (companion_id)
      companion_id, s3_url, renditions
    FROM companion_images
    WHERE user_id = ${userId}
      AND companion_id = ANY(${companionIds})
    ORDER BY companion_id, created_at DESC
  `;

  const imageMap = new Map<string, LatestImageData>();

  for (const row of results) {
    if (row.companion_id) {
      const renditions = row.renditions as ImageRenditions | null;
      imageMap.set(row.companion_id, {
        s3_url: row.s3_url,
        renditions: renditions ? buildRenditionUrls(renditions) : null,
      });
    }
  }

  return imageMap;
}

/**
 * Avatar data with URL and optional s3_key for rendition lookup
 */
interface AvatarData {
  assetUrl: string;
  s3Key: string | null;
}

/**
 * Get active avatar URLs and s3_keys for multiple companions
 */
async function getAvatarDataForCompanions(
  companionIds: string[]
): Promise<Map<string, AvatarData>> {
  if (companionIds.length === 0) return new Map();

  const results = await db.sql`
    SELECT c.id as companion_id, a.asset_url, a.s3_key
    FROM companions c
    JOIN companion_avatars a ON c.active_avatar_id = a.id
    WHERE c.id = ANY(${companionIds})
  `;

  const avatarMap = new Map<string, AvatarData>();
  for (const row of results) {
    if (row.companion_id && row.asset_url) {
      avatarMap.set(row.companion_id, {
        assetUrl: row.asset_url,
        s3Key: row.s3_key || null,
      });
    }
  }
  return avatarMap;
}

/**
 * Build a direct S3 URL for a rendition file (no expiry - bucket is publicly readable)
 */
function buildRenditionUrl(s3Key: string): string {
  return buildMediaUrl(s3Key);
}

/**
 * Build direct URLs for all renditions in a RenditionFormats object
 */
function buildRenditionFormats(formats: RenditionFormats): RenditionFormats {
  const result: RenditionFormats = {};

  for (const [format, file] of Object.entries(formats)) {
    if (file && file.s3Key) {
      result[format as keyof RenditionFormats] = {
        ...file,
        url: buildRenditionUrl(file.s3Key),
      };
    }
  }

  return result;
}

/**
 * Build direct URLs for all renditions in an ImageRenditions object
 * The bucket is publicly readable for companion images, so no signing needed
 */
function buildRenditionUrls(renditions: ImageRenditions): ImageRenditions {
  const result: ImageRenditions = {};
  const sizes = ['thumb', 'small', 'medium', 'large', 'original'] as const;

  for (const size of sizes) {
    const formats = renditions[size];
    if (formats) {
      result[size] = buildRenditionFormats(formats);
    }
  }

  return result;
}

/**
 * Get renditions for avatars by their s3_keys
 * Looks up companion_images table which stores renditions
 * Builds direct S3 URLs (bucket is publicly readable)
 */
async function getAvatarRenditionsForS3Keys(
  s3Keys: string[]
): Promise<Map<string, ImageRenditions>> {
  if (s3Keys.length === 0) return new Map();

  const results = await db.sql`
    SELECT s3_key, renditions
    FROM companion_images
    WHERE s3_key = ANY(${s3Keys})
      AND renditions IS NOT NULL
  `;

  const renditionsMap = new Map<string, ImageRenditions>();

  for (const row of results) {
    if (row.s3_key && row.renditions) {
      renditionsMap.set(row.s3_key, buildRenditionUrls(row.renditions as ImageRenditions));
    }
  }

  return renditionsMap;
}

/**
 * Register companion routes
 */
export async function companionsRoutes(app: FastifyInstance): Promise<void> {
  const companionRepo = getCompanionsRepository();

  /**
   * GET /companions/browse - List all companions (no auth required)
   * Used for the public dashboard/landing page
   */
  app.get('/browse', async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = '50', offset = '0' } = request.query as {
      limit?: string;
      offset?: string;
    };

    const result = await companionRepo.listAll({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    const companionIds = result.data.map((c) => c.id);

    // Fetch avatar data for all companions
    const avatarDataMap = await getAvatarDataForCompanions(companionIds);

    // Collect s3_keys from avatars to fetch renditions
    const avatarS3Keys = Array.from(avatarDataMap.values())
      .map((data) => data.s3Key)
      .filter((key): key is string => key !== null);

    const avatarRenditionsMap = await getAvatarRenditionsForS3Keys(avatarS3Keys);

    const companions = result.data.map((companion) => {
      const avatarData = avatarDataMap.get(companion.id);
      const avatarRenditions = avatarData?.s3Key
        ? avatarRenditionsMap.get(avatarData.s3Key) || null
        : null;

      return mapCompanionResponse(companion, avatarData?.assetUrl, avatarRenditions);
    });

    return reply.send({
      companions,
      total: companions.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  });

  /**
   * GET /companions/public/:companionId - Get public companion (no auth required)
   * Returns sanitized companion data for the share page
   */
  app.get('/public/:companionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    const companion = await companionRepo.findPublicById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found or not public',
      });
    }

    // Return sanitized public data (exclude user_id, private settings)
    const spec = companion.spec || {};
    return reply.send({
      id: companion.id,
      name: companion.name,
      spec: {
        identity: {
          name: spec.identity?.name || companion.name,
          pronouns: spec.identity?.pronouns || 'they/them',
        },
        personality: {
          archetype: spec.personality?.archetype || 'companion',
          secondary_archetype: spec.personality?.secondary_archetype,
          traits: spec.personality?.traits || {},
        },
        visual_style: spec.visual_style ? {
          style_type: spec.visual_style.style_type,
          appearance: spec.visual_style.appearance,
        } : undefined,
      },
      avatarUrl: companion.activeAvatar?.asset_url || null,
      createdAt: companion.created_at,
    });
  });

  /**
   * GET /companions - List companions
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit = '50', offset = '0' } = request.query as {
      limit?: string;
      offset?: string;
    };

    const result = await companionRepo.list({
      userId: request.user!.userId,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    // Get companion IDs for batch queries
    const companionIds = result.data.map((c) => c.id);

    // Fetch latest sessions, images, and avatars in parallel
    const [sessionMap, imageMap, avatarDataMap] = await Promise.all([
      getLatestSessionsForCompanions(request.user!.userId, companionIds),
      getLatestImagesForCompanions(request.user!.userId, companionIds),
      getAvatarDataForCompanions(companionIds),
    ]);

    // Collect s3_keys from avatars to fetch renditions
    const avatarS3Keys = Array.from(avatarDataMap.values())
      .map((data) => data.s3Key)
      .filter((key): key is string => key !== null);

    // Fetch avatar renditions
    const avatarRenditionsMap = await getAvatarRenditionsForS3Keys(avatarS3Keys);

    // Map companions with session, image, and avatar data
    const companions = result.data.map((companion) => {
      const latestSession = sessionMap.get(companion.id);
      const latestImageData = imageMap.get(companion.id);
      const avatarData = avatarDataMap.get(companion.id);
      const avatarRenditions = avatarData?.s3Key
        ? avatarRenditionsMap.get(avatarData.s3Key) || null
        : null;

      return {
        ...mapCompanionResponse(companion, avatarData?.assetUrl, avatarRenditions),
        latestSessionId: latestSession?.id || null,
        latestSessionUpdatedAt: latestSession?.updatedAt || null,
        latestConversationImageUrl:
          latestImageData?.renditions?.small?.webp?.url ||
          latestImageData?.renditions?.thumb?.webp?.url ||
          latestImageData?.s3_url || null,
        latestConversationImageRenditions: latestImageData?.renditions || null,
      };
    });

    return reply.send({
      companions,
      total: result.total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  });

  /**
   * POST /companions - Create new companion
   */
  app.post('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateCompanionSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const input = parseResult.data;

    // Build the spec from simplified input, merging with provided spec
    const buildSpecInput: Parameters<typeof buildSpec>[0] = {
      name: input.name,
      personality: input.personality,
    };
    if (input.description) buildSpecInput.description = input.description;
    if (input.voiceId) buildSpecInput.voiceId = input.voiceId;
    if (input.spec) buildSpecInput.providedSpec = input.spec;
    const spec = buildSpec(buildSpecInput);

    const companion = await companionRepo.create({
      user_id: request.user!.userId,
      name: input.name,
      spec,
      status: 'active', // Auto-activate for now
      is_public: input.isPublic,
    });

    logger.info({ companionId: companion.id, userId: request.user!.userId }, 'Companion created');

    return reply.status(201).send(mapCompanionResponse(companion));
  });

  /**
   * GET /companions/:companionId - Get companion by ID
   */
  app.get('/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    // Use findByIdWithAvatar to get the active avatar URL
    const companion = await companionRepo.findByIdWithAvatar(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Check access
    if (companion.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this companion',
      });
    }

    // Fetch avatar renditions if s3_key is available
    let avatarRenditions: ImageRenditions | null = null;
    const avatarS3Key = companion.activeAvatar?.s3_key;
    if (avatarS3Key) {
      const renditionsMap = await getAvatarRenditionsForS3Keys([avatarS3Key]);
      avatarRenditions = renditionsMap.get(avatarS3Key) || null;
    }

    return reply.send(mapCompanionResponse(companion, companion.activeAvatar?.asset_url, avatarRenditions));
  });

  /**
   * PATCH /companions/:companionId - Update companion
   */
  app.patch('/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    const parseResult = UpdateCompanionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    // Check ownership
    const existing = await companionRepo.findById(companionId);
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    if (existing.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only update your own companions',
      });
    }

    const input = parseResult.data;

    // Update name, status, and isPublic through repository
    const updateData: Partial<{ name: string; status: 'draft' | 'active' | 'archived'; is_public: boolean }> = {};
    if (input.name) updateData.name = input.name;
    if (input.status) updateData.status = input.status;
    if (input.isPublic !== undefined) updateData.is_public = input.isPublic;
    const companion = await companionRepo.update(companionId, updateData);

    // Track if spec needs updating
    let specUpdated = false;
    const newSpec = { ...existing.spec } as CompanionSpec;

    // If voice changed via top-level voiceId, update spec
    if (input.voiceId) {
      newSpec.voice = { ...newSpec.voice, voice_id: input.voiceId };
      specUpdated = true;
    }

    // Handle spec updates
    if (input.spec) {
      // Identity updates
      if (input.spec.identity) {
        newSpec.identity = {
          ...newSpec.identity,
          ...input.spec.identity,
        };
        specUpdated = true;
      }

      // Personality updates (including archetype and traits)
      if (input.spec.personality) {
        newSpec.personality = {
          ...newSpec.personality,
          ...input.spec.personality,
          traits: input.spec.personality.traits
            ? { ...newSpec.personality?.traits, ...input.spec.personality.traits }
            : newSpec.personality?.traits,
        };
        specUpdated = true;
      }

      // Voice updates
      if (input.spec.voice) {
        newSpec.voice = {
          ...newSpec.voice,
          ...input.spec.voice,
        };
        specUpdated = true;
      }

      // Visual style updates (including appearance)
      if (input.spec.visual_style) {
        newSpec.visual_style = {
          ...newSpec.visual_style,
          ...input.spec.visual_style,
        };
        specUpdated = true;
      }

      // Boundaries updates
      if (input.spec.boundaries) {
        newSpec.boundaries = {
          ...newSpec.boundaries,
          ...input.spec.boundaries,
        };
        specUpdated = true;
      }
    }

    // Persist spec changes if any
    if (specUpdated) {
      await companionRepo.updateSpec(companionId, newSpec);
    }

    logger.info({ companionId, userId: request.user!.userId }, 'Companion updated');

    // Fetch updated companion with avatar data
    const updated = await companionRepo.findByIdWithAvatar(companionId);
    let avatarRenditions: ImageRenditions | null = null;
    const avatarS3Key = updated?.activeAvatar?.s3_key;
    if (avatarS3Key) {
      const renditionsMap = await getAvatarRenditionsForS3Keys([avatarS3Key]);
      avatarRenditions = renditionsMap.get(avatarS3Key) || null;
    }
    return reply.send(mapCompanionResponse(updated!, updated?.activeAvatar?.asset_url, avatarRenditions));
  });

  /**
   * DELETE /companions/:companionId - Delete companion
   */
  app.delete('/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    // Check ownership
    const existing = await companionRepo.findById(companionId);
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    if (existing.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only delete your own companions',
      });
    }

    await companionRepo.delete(companionId);

    logger.info({ companionId, userId: request.user!.userId }, 'Companion deleted');

    return reply.status(204).send();
  });

  /**
   * POST /companions/:companionId/clone - Clone a companion
   */
  app.post('/:companionId/clone', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    const source = await companionRepo.findById(companionId);
    if (!source) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Can only clone your own companions for now
    if (source.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only clone your own companions',
      });
    }

    const cloned = await companionRepo.create({
      user_id: request.user!.userId,
      name: `${source.name} (Copy)`,
      spec: source.spec,
      status: 'draft',
    });

    logger.info(
      { sourceCompanionId: companionId, clonedCompanionId: cloned.id, userId: request.user!.userId },
      'Companion cloned'
    );

    return reply.status(201).send(mapCompanionResponse(cloned));
  });

  /**
   * POST /companions/:companionId/generate-backstory - Generate backstory for companion
   * Generates a rich backstory using LLM and saves it to the knowledge graph
   */
  app.post('/:companionId/generate-backstory', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };
    const userId = request.user!.userId;

    // Parse request body for onboarding data
    const bodySchema = z.object({
      archetype: z.string(),
      secondaryArchetype: z.string().optional(),
      archetypeDescription: z.string().optional(),
      personality: z.object({
        warmth: z.number(),
        energy: z.number(),
        playfulness: z.number(),
        formality: z.number(),
        assertiveness: z.number(),
        curiosity: z.number(),
        empathy: z.number(),
        spontaneity: z.number(),
        optimism: z.number(),
        directness: z.number(),
      }),
      tenets: z.array(z.object({
        category: z.string(),
        priority: z.string(),
        rule: z.string(),
        isNegation: z.boolean(),
      })).optional(),
      userBackstoryHint: z.string().optional(),
    });

    const parseResult = bodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const input = parseResult.data;

    // Verify companion exists and belongs to user
    const companion = await companionRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    if (companion.user_id !== userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You can only generate backstory for your own companions',
      });
    }

    logger.info({ companionId, userId, archetype: input.archetype }, 'Generating backstory for companion');

    try {
      // Call orchestrator to generate backstory
      const orchestratorResponse = await fetch(`${ORCHESTRATOR_URL}/backstory/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companion_name: companion.name,
          pronouns: companion.spec?.identity?.pronouns || 'they/them',
          archetype: input.archetype,
          secondary_archetype: input.secondaryArchetype,
          archetype_description: input.archetypeDescription,
          personality: input.personality,
          tenets: input.tenets?.map(t => ({
            category: t.category,
            priority: t.priority,
            rule: t.rule,
            is_negation: t.isNegation,
          })) || [],
          user_backstory_hint: input.userBackstoryHint,
        }),
      });

      if (!orchestratorResponse.ok) {
        const errorText = await orchestratorResponse.text();
        logger.error({ status: orchestratorResponse.status, error: errorText }, 'Orchestrator backstory generation failed');
        throw new Error(`Orchestrator error: ${orchestratorResponse.status}`);
      }

      const backstoryResult = await orchestratorResponse.json() as {
        backstory: string;
        motivations: string[];
        key_memories: string[];
        personality_quirks: string[];
        latency_ms: number;
      };

      logger.info({ companionId, latencyMs: backstoryResult.latency_ms }, 'Backstory generated successfully');

      // Save to knowledge graph
      const kgRepo = getKnowledgeGraphRepository();

      // Create the main companion self-entity if it doesn't exist
      let selfEntity = await kgRepo.findEntityByCanonicalName(userId, companionId, companion.name.toLowerCase());
      if (!selfEntity) {
        selfEntity = await kgRepo.createEntity({
          user_id: userId,
          companion_id: companionId,
          name: companion.name,
          entity_type: 'person',
          canonical_name: companion.name.toLowerCase(),
          metadata: {
            is_self: true,
            pronouns: companion.spec?.identity?.pronouns,
          },
        });
      }

      // Upsert backstory entity (may already exist if regenerating)
      const backstoryEntity = await kgRepo.upsertEntity({
        user_id: userId,
        companion_id: companionId,
        name: 'My Backstory',
        entity_type: 'concept',
        metadata: {
          backstory: backstoryResult.backstory,
          generated_at: new Date().toISOString(),
        },
      });

      // Create motivation entities and relationships
      for (const motivation of backstoryResult.motivations) {
        const motivationEntity = await kgRepo.upsertEntity({
          user_id: userId,
          companion_id: companionId,
          name: motivation,
          entity_type: 'concept',
          metadata: { type: 'motivation' },
        });

        await kgRepo.upsertEdge({
          user_id: userId,
          companion_id: companionId,
          source_entity_id: selfEntity.id,
          target_entity_id: motivationEntity.id,
          relation_type: 'wants',
          confidence: 0.95,
        });
      }

      // Create key memory entities and relationships
      for (const memory of backstoryResult.key_memories) {
        const memoryEntity = await kgRepo.upsertEntity({
          user_id: userId,
          companion_id: companionId,
          name: memory,
          entity_type: 'event',
          metadata: { type: 'formative_memory' },
        });

        await kgRepo.upsertEdge({
          user_id: userId,
          companion_id: companionId,
          source_entity_id: selfEntity.id,
          target_entity_id: memoryEntity.id,
          relation_type: 'experienced',
          confidence: 0.95,
        });
      }

      // Create personality quirk entities and relationships
      for (const quirk of backstoryResult.personality_quirks) {
        const quirkEntity = await kgRepo.upsertEntity({
          user_id: userId,
          companion_id: companionId,
          name: quirk,
          entity_type: 'concept',
          metadata: { type: 'personality_quirk' },
        });

        await kgRepo.upsertEdge({
          user_id: userId,
          companion_id: companionId,
          source_entity_id: selfEntity.id,
          target_entity_id: quirkEntity.id,
          relation_type: 'has',
          confidence: 0.95,
        });
      }

      // Link self to backstory
      await kgRepo.upsertEdge({
        user_id: userId,
        companion_id: companionId,
        source_entity_id: selfEntity.id,
        target_entity_id: backstoryEntity.id,
        relation_type: 'has',
        confidence: 1.0,
      });

      logger.info(
        {
          companionId,
          userId,
          motivationsCount: backstoryResult.motivations.length,
          memoriesCount: backstoryResult.key_memories.length,
          quirksCount: backstoryResult.personality_quirks.length,
        },
        'Backstory saved to knowledge graph'
      );

      return reply.send({
        success: true,
        data: {
          backstory: backstoryResult.backstory,
          motivations: backstoryResult.motivations,
          keyMemories: backstoryResult.key_memories,
          personalityQuirks: backstoryResult.personality_quirks,
          latencyMs: backstoryResult.latency_ms,
        },
      });
    } catch (error) {
      logger.error({ error, companionId }, 'Failed to generate backstory');
      return reply.status(500).send({
        error: 'Backstory generation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /companions/:companionId/backstory - Get backstory for companion
   * Fetches the generated backstory from the knowledge graph
   */
  app.get('/:companionId/backstory', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };
    const userId = request.user!.userId;

    try {
      // Verify companion exists and belongs to user
      const companion = await companionRepo.findById(companionId);
      if (!companion) {
        return reply.status(404).send({ error: 'Companion not found' });
      }
      if (companion.user_id !== userId && !companion.is_public) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const _kgRepo = getKnowledgeGraphRepository();

      // Find the backstory entity - it has name 'My Backstory' and metadata.backstory
      const entities = await db.sql`
        SELECT * FROM kg_entities
        WHERE companion_id = ${companionId}
          AND name = 'My Backstory'
          AND entity_type = 'concept'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (entities.length === 0) {
        return reply.send({
          success: true,
          data: {
            hasBackstory: false,
            backstory: null,
            motivations: [],
            keyMemories: [],
            personalityQuirks: [],
          },
        });
      }

      const backstoryEntity = entities[0];
      const metadata = backstoryEntity.metadata as {
        backstory?: string;
        motivations?: string[];
        key_memories?: string[];
        personality_quirks?: string[];
      } | null;

      // Also fetch related entities (motivations, memories, quirks)
      const relatedEdges = await db.sql`
        SELECT * FROM kg_edges
        WHERE source_entity_id = ${backstoryEntity.id}
      `;

      const relatedEntityIds = relatedEdges.map((e: Record<string, unknown>) => e['target_entity_id'] as string);

      let motivations: string[] = [];
      let keyMemories: string[] = [];
      let personalityQuirks: string[] = [];

      if (relatedEntityIds.length > 0) {
        const relatedEntities = await db.sql`
          SELECT * FROM kg_entities
          WHERE id = ANY(${relatedEntityIds})
        `;

        for (const entity of relatedEntities) {
          const entityMeta = entity.metadata as { description?: string } | null;
          const description = entityMeta?.description || entity.name;

          if (entity.entity_type === 'motivation') {
            motivations.push(description);
          } else if (entity.entity_type === 'memory') {
            keyMemories.push(description);
          } else if (entity.entity_type === 'trait') {
            personalityQuirks.push(description);
          }
        }
      }

      return reply.send({
        success: true,
        data: {
          hasBackstory: true,
          backstory: metadata?.backstory || null,
          motivations,
          keyMemories,
          personalityQuirks,
        },
      });
    } catch (error) {
      logger.error({ error, companionId }, 'Failed to fetch backstory');
      return reply.status(500).send({
        error: 'Failed to fetch backstory',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /companions/generate-identity - Generate random companion identity
   * Uses LLM to generate a creative name, pronouns, and backstory
   * Note: This endpoint is public to support onboarding for unauthenticated users
   * If a name is provided, the LLM will infer gender/pronouns from it
   */
  app.post<{
    Body: { name?: string };
  }>('/generate-identity', async (request, reply) => {
    const { name } = (request.body || {}) as { name?: string };
    logger.info({ userId: request.user?.userId || 'anonymous', providedName: name }, 'Generating random companion identity');

    try {
      const orchestratorResponse = await fetch(`${ORCHESTRATOR_URL}/identity/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || null }),
      });

      if (!orchestratorResponse.ok) {
        const errorText = await orchestratorResponse.text();
        logger.error({ status: orchestratorResponse.status, error: errorText }, 'Orchestrator identity generation failed');
        throw new Error(`Orchestrator error: ${orchestratorResponse.status}`);
      }

      const result = await orchestratorResponse.json() as {
        name: string;
        pronouns: string;
        backstory: string;
        archetype: string;
        secondary_archetype: string | null;
        personality: {
          warmth: number;
          energy: number;
          playfulness: number;
          formality: number;
          assertiveness: number;
          curiosity: number;
          empathy: number;
          spontaneity: number;
          optimism: number;
          directness: number;
        };
        appearance: {
          ethnicity: string;
          body_type: string;
          hair_color: string;
          breast_size: number;
        };
        visual_style: string;
        voice_gender: string;
        latency_ms: number;
      };

      logger.info({ name: result.name, latencyMs: result.latency_ms }, 'Random identity generated');

      return reply.send(result);
    } catch (error) {
      logger.error({ error }, 'Failed to generate random identity');
      return reply.status(500).send({
        error: 'Failed to generate identity',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
