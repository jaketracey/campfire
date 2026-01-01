/**
 * Companion Routes
 * AI companion management and configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { logger } from '../observability/logger.js';
import type { CompanionSpec } from '../db/types.js';

// Request schemas - simplified input for API consumers
const CreateCompanionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  personality: z.string().max(2000),
  voiceId: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().default(false),
});

const UpdateCompanionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  personality: z.string().max(2000).optional(),
  voiceId: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

/**
 * Build a CompanionSpec from simplified input
 */
function buildSpec(input: {
  name: string;
  description?: string;
  personality: string;
  voiceId?: string;
}): CompanionSpec {
  return {
    identity: {
      name: input.name,
      pronouns: 'they/them',
      address_style: 'friendly',
    },
    personality: {
      archetype: 'companion',
      traits: {
        warmth: 0.7,
        playfulness: 0.5,
        directness: 0.5,
        empathy: 0.7,
      },
    },
    voice: input.voiceId ? {
      provider: 'elevenlabs',
      voice_id: input.voiceId,
    } : {
      provider: 'elevenlabs',
      voice_id: 'default',
    },
    visual_style: {
      style_type: 'default',
    },
    boundaries: {
      relationship_pacing: 'moderate',
      content_rating: 'PG-13',
    },
    memory_consent: {
      allow_long_term: true,
      allow_kg_extraction: true,
    },
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
  };
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

    return reply.send({
      companions: result.data.map(mapCompanionResponse),
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

    // Build the spec from simplified input
    const spec = buildSpec({
      name: input.name,
      description: input.description,
      personality: input.personality,
      voiceId: input.voiceId,
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

    // If voice changed, update spec
    if (input.voiceId) {
      const newSpec = { ...existing.spec } as CompanionSpec;
      newSpec.voice = { ...newSpec.voice, voice_id: input.voiceId };
      await companionRepo.updateSpec(companionId, newSpec);
    }

    logger.info({ companionId, userId: request.user!.userId }, 'Companion updated');

    return reply.send(mapCompanionResponse(companion));
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
