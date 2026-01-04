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

// Orchestrator configuration
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] || 'http://localhost:8000';

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
}, avatarUrl?: string | null) {
  const spec = companion.spec;
  return {
    id: companion.id,
    name: companion.name,
    description: null, // Could be stored in extended spec in the future
    personality: JSON.stringify(spec?.personality || {}),
    voiceId: spec?.voice?.voice_id || null,
    avatarUrl: avatarUrl ?? null,
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
  renditions: Record<string, unknown> | null;
}

/**
 * Get latest image for each companion from conversations
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
      imageMap.set(row.companion_id, {
        s3_url: row.s3_url,
        renditions: row.renditions as Record<string, unknown> | null,
      });
    }
  }
  return imageMap;
}

/**
 * Get active avatar URLs for multiple companions
 */
async function getAvatarUrlsForCompanions(
  companionIds: string[]
): Promise<Map<string, string>> {
  if (companionIds.length === 0) return new Map();

  const results = await db.sql`
    SELECT c.id as companion_id, a.asset_url
    FROM companions c
    JOIN companion_avatars a ON c.active_avatar_id = a.id
    WHERE c.id = ANY(${companionIds})
  `;

  const avatarMap = new Map<string, string>();
  for (const row of results) {
    if (row.companion_id && row.asset_url) {
      avatarMap.set(row.companion_id, row.asset_url);
    }
  }
  return avatarMap;
}

/**
 * Register companion routes
 */
export async function companionsRoutes(app: FastifyInstance): Promise<void> {
  const companionRepo = getCompanionsRepository();

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
    const [sessionMap, imageMap, avatarMap] = await Promise.all([
      getLatestSessionsForCompanions(request.user!.userId, companionIds),
      getLatestImagesForCompanions(request.user!.userId, companionIds),
      getAvatarUrlsForCompanions(companionIds),
    ]);

    // Map companions with session, image, and avatar data
    const companions = result.data.map((companion) => {
      const latestSession = sessionMap.get(companion.id);
      const latestImageData = imageMap.get(companion.id);
      const avatarUrl = avatarMap.get(companion.id);

      return {
        ...mapCompanionResponse(companion, avatarUrl),
        latestSessionId: latestSession?.id || null,
        latestSessionUpdatedAt: latestSession?.updatedAt || null,
        latestConversationImageUrl: latestImageData?.s3_url || null,
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

    return reply.send(mapCompanionResponse(companion, companion.activeAvatar?.asset_url));
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

    // If voice changed, update spec
    if (input.voiceId) {
      newSpec.voice = { ...newSpec.voice, voice_id: input.voiceId };
      specUpdated = true;
    }

    // If personality traits provided, update spec
    if (input.spec?.personality?.traits) {
      newSpec.personality = {
        ...newSpec.personality,
        traits: { ...newSpec.personality?.traits, ...input.spec.personality.traits },
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
   */
  app.post('/generate-identity', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    logger.info({ userId: request.user!.userId }, 'Generating random companion identity');

    try {
      const orchestratorResponse = await fetch(`${ORCHESTRATOR_URL}/identity/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
