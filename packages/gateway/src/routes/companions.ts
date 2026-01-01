/**
 * Companion Routes
 * AI companion management and configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { db } from '../db/index.js';
import { logger } from '../observability/logger.js';
import type { CompanionSpec } from '../db/types.js';

// Appearance schema for validation
const AppearanceSchema = z.object({
  ethnicity: z.enum(['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed']),
  bodyType: z.enum(['slim', 'athletic', 'curvy', 'plus-size']),
  hairColor: z.enum(['black', 'brown', 'blonde', 'red', 'fantasy']),
  breastSize: z.number().min(0).max(100).optional(),
});

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
    personality: z.object({
      traits: z.record(z.string(), z.number().min(0).max(100)),
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

  return {
    identity: {
      name: provided.identity?.name || input.name,
      pronouns: provided.identity?.pronouns || 'they/them',
      address_style: provided.identity?.address_style || 'friendly',
    },
    personality: {
      archetype: provided.personality?.archetype || 'companion',
      secondary_archetype: provided.personality?.secondary_archetype,
      traits: provided.personality?.traits || {
        warmth: 0.7,
        playfulness: 0.5,
        directness: 0.5,
        empathy: 0.7,
      },
    },
    voice: {
      provider: provided.voice?.provider || 'elevenlabs',
      voice_id: provided.voice?.voice_id || input.voiceId || 'default',
    },
    visual_style: {
      style_type: provided.visual_style?.style_type || 'default',
      appearance: provided.visual_style?.appearance,
      palette: provided.visual_style?.palette,
      constraints: provided.visual_style?.constraints,
    },
    boundaries: {
      relationship_pacing: provided.boundaries?.relationship_pacing || 'moderate',
      topics_avoid: provided.boundaries?.topics_avoid,
      safe_topics: provided.boundaries?.safe_topics,
      content_rating: provided.boundaries?.content_rating || 'PG-13',
      emotional_depth: provided.boundaries?.emotional_depth,
    },
    memory_consent: {
      allow_long_term: provided.memory_consent?.allow_long_term ?? true,
      allow_kg_extraction: provided.memory_consent?.allow_kg_extraction ?? true,
      retention_days: provided.memory_consent?.retention_days,
    },
    tenets: provided.tenets,
  };
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
  created_at: Date;
  updated_at: Date;
}) {
  const spec = companion.spec || {};
  return {
    id: companion.id,
    name: companion.name,
    description: null, // Could be stored in extended spec in the future
    personality: JSON.stringify(spec.personality || {}),
    voiceId: spec.voice?.voice_id || null,
    avatarUrl: null,
    isPublic: false, // Not stored in spec yet
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
 * Get latest image for each companion from conversations
 */
async function getLatestImagesForCompanions(
  userId: string,
  companionIds: string[]
): Promise<Map<string, string>> {
  if (companionIds.length === 0) return new Map();

  const results = await db.sql`
    SELECT DISTINCT ON (companion_id)
      companion_id, s3_url
    FROM companion_images
    WHERE user_id = ${userId}
      AND companion_id = ANY(${companionIds})
    ORDER BY companion_id, created_at DESC
  `;

  const imageMap = new Map<string, string>();
  for (const row of results) {
    if (row.companion_id) {
      imageMap.set(row.companion_id, row.s3_url);
    }
  }
  return imageMap;
}

/**
 * Register companion routes
 */
export async function companionsRoutes(app: FastifyInstance): Promise<void> {
  const companionRepo = getCompanionsRepository();

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

    // Fetch latest sessions and images in parallel
    const [sessionMap, imageMap] = await Promise.all([
      getLatestSessionsForCompanions(request.user!.userId, companionIds),
      getLatestImagesForCompanions(request.user!.userId, companionIds),
    ]);

    // Map companions with session and image data
    const companions = result.data.map((companion) => {
      const latestSession = sessionMap.get(companion.id);
      const latestImageUrl = imageMap.get(companion.id);

      return {
        ...mapCompanionResponse(companion),
        latestSessionId: latestSession?.id || null,
        latestSessionUpdatedAt: latestSession?.updatedAt || null,
        latestConversationImageUrl: latestImageUrl || null,
      };
    });

    return reply.send({
      companions,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
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
    const spec = buildSpec({
      name: input.name,
      description: input.description,
      personality: input.personality,
      voiceId: input.voiceId,
      providedSpec: input.spec,
    });

    const companion = await companionRepo.create({
      user_id: request.user!.userId,
      name: input.name,
      spec,
      status: 'active', // Auto-activate for now
    });

    logger.info({ companionId: companion.id, userId: request.user!.userId }, 'Companion created');

    return reply.status(201).send(mapCompanionResponse(companion));
  });

  /**
   * GET /companions/:companionId - Get companion by ID
   */
  app.get('/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { companionId } = request.params as { companionId: string };

    const companion = await companionRepo.findById(companionId);
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

    return reply.send(mapCompanionResponse(companion));
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

    // Update name and status through repository
    const companion = await companionRepo.update(companionId, {
      name: input.name,
      status: input.status as 'draft' | 'active' | 'archived' | undefined,
    });

    // Track if spec needs updating
    let specUpdated = false;
    const newSpec = { ...existing.spec } as CompanionSpec;

    // If voice changed, update spec
    if (input.voiceId) {
      newSpec.voice = { ...newSpec.voice, voice_id: input.voiceId };
      specUpdated = true;
    }

    // If personality traits provided, update spec
    if (input.spec?.personality?.traits) {
      newSpec.personality = {
        ...newSpec.personality,
        traits: { ...newSpec.personality.traits, ...input.spec.personality.traits },
      };
      specUpdated = true;
    }

    // Persist spec changes if any
    if (specUpdated) {
      await companionRepo.updateSpec(companionId, newSpec);
    }

    logger.info({ companionId, userId: request.user!.userId }, 'Companion updated');

    // Fetch updated companion with new spec
    const updated = await companionRepo.findById(companionId);
    return reply.send(mapCompanionResponse(updated!));
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
}
