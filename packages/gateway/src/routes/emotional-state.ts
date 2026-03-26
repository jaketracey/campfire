/**
 * Emotional State Routes
 * Endpoints for reading and updating companion emotional state.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { getEmotionalStatesRepository } from '../repositories/emotional-states.js';

// ============================================================================
// Request / Response Schemas
// ============================================================================

const GetEmotionalStateQuerySchema = z.object({
  userId: z.string().uuid(),
});

const UpdateEmotionalStateBodySchema = z.object({
  companionId: z.string().uuid(),
  userId: z.string().uuid(),
  primaryEmotion: z.string().max(50),
  secondaryEmotion: z.string().max(50).nullable().optional(),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
  dominance: z.number().min(-1).max(1),
  intensity: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  triggers: z.array(z.string()).default([]),
  moodDescription: z.string().max(500),
  transitionHistory: z.array(z.record(z.unknown())).default([]),
});

// ============================================================================
// Routes
// ============================================================================

export async function emotionalStateRoutes(app: FastifyInstance): Promise<void> {
  const repo = getEmotionalStatesRepository();

  /**
   * GET /companions/:id/emotional-state
   * Retrieve the current emotional state for a companion-user pair.
   */
  app.get(
    '/:id/emotional-state',
    { preHandler: [requireAuth] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { userId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const companionId = request.params.id;
      const parsed = GetEmotionalStateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'userId query parameter required' });
      }
      const { userId } = parsed.data;

      try {
        const row = await repo.findByCompanionAndUser(companionId, userId);

        if (!row) {
          return reply.status(200).send(null);
        }

        return reply.status(200).send({
          companionId: row.companion_id,
          userId: row.user_id,
          primaryEmotion: row.primary_emotion,
          secondaryEmotion: row.secondary_emotion,
          valence: row.valence,
          arousal: row.arousal,
          dominance: row.dominance,
          intensity: row.intensity,
          stability: row.stability,
          triggers: row.triggers || [],
          moodDescription: row.mood_description,
          transitionHistory: row.transition_history || [],
          updatedAt: row.updated_at,
        });
      } catch (err) {
        logger.error({ err, companionId, userId }, 'Failed to fetch emotional state');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /companions/:id/emotional-state/internal
   * Upsert the emotional state (internal, from orchestrator).
   */
  app.post(
    '/:id/emotional-state/internal',
    { preHandler: [requireInternalService] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: z.infer<typeof UpdateEmotionalStateBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      const companionId = request.params.id;
      const parsed = UpdateEmotionalStateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid body', details: parsed.error.flatten() });
      }

      const body = parsed.data;

      try {
        await repo.upsert({
          companionId,
          userId: body.userId,
          primaryEmotion: body.primaryEmotion,
          secondaryEmotion: body.secondaryEmotion ?? null,
          valence: body.valence,
          arousal: body.arousal,
          dominance: body.dominance,
          intensity: body.intensity,
          stability: body.stability,
          triggers: body.triggers,
          moodDescription: body.moodDescription,
          transitionHistory: body.transitionHistory,
        });

        return reply.status(200).send({ ok: true });
      } catch (err) {
        logger.error({ err, companionId }, 'Failed to upsert emotional state');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
