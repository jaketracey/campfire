/**
 * Outreach Routes
 * Proactive companion outreach management endpoints.
 *
 * User-facing routes for receiving and acknowledging outreach messages,
 * plus internal routes for the scheduling worker and orchestrator.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { getOutreachRepository } from '../repositories/outreach.js';

// ============================================================================
// Request Schemas
// ============================================================================

const OutreachConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  min_interval_hours: z.number().int().min(1).optional(),
  max_daily: z.number().int().min(0).optional(),
  quiet_hours_start: z.number().int().min(0).max(23).optional(),
  quiet_hours_end: z.number().int().min(0).max(23).optional(),
  triggers_enabled: z.array(
    z.enum([
      'scheduled_checkin',
      'followup',
      'time_based',
      'emotional_support',
      'milestone',
    ])
  ).optional(),
});

const CreateOutreachRecordSchema = z.object({
  user_id: z.string().uuid(),
  companion_id: z.string().uuid(),
  trigger: z.enum([
    'scheduled_checkin',
    'followup',
    'time_based',
    'emotional_support',
    'milestone',
  ]),
  message: z.string().min(1).max(5000),
  delivered_via: z.enum([
    'websocket',
    'push',
    'telegram',
    'discord',
    'stored',
  ]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register outreach routes (user-facing)
 */
export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  const outreachRepo = getOutreachRepository();

  // ---- User-facing routes ----

  /**
   * GET /outreach/pending - Get pending outreach messages for current user
   */
  app.get(
    '/pending',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;

      try {
        const records = await outreachRepo.getPending(userId);
        return reply.send({ outreach: records });
      } catch (error) {
        logger.error({ error, userId }, 'Failed to fetch pending outreach');
        return reply.status(500).send({ error: 'Failed to fetch pending outreach' });
      }
    }
  );

  /**
   * POST /outreach/:id/delivered - Mark outreach as delivered
   */
  app.post(
    '/:id/delivered',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const record = await outreachRepo.markDelivered(id, 'websocket');
        if (!record) {
          return reply.status(404).send({ error: 'Outreach record not found or already delivered' });
        }
        return reply.send({ outreach: record });
      } catch (error) {
        logger.error({ error, id }, 'Failed to mark outreach delivered');
        return reply.status(500).send({ error: 'Failed to mark outreach delivered' });
      }
    }
  );

  /**
   * POST /outreach/:id/opened - Mark outreach as opened
   */
  app.post(
    '/:id/opened',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const record = await outreachRepo.markOpened(id);
        if (!record) {
          return reply.status(404).send({ error: 'Outreach record not found' });
        }
        return reply.send({ outreach: record });
      } catch (error) {
        logger.error({ error, id }, 'Failed to mark outreach opened');
        return reply.status(500).send({ error: 'Failed to mark outreach opened' });
      }
    }
  );

  // ---- Internal routes (called by worker/orchestrator) ----

  /**
   * GET /outreach/eligibility - Check outreach eligibility (internal)
   */
  app.get(
    '/eligibility',
    { preHandler: [requireInternalService] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, companionId, minIntervalHours, maxDaily } = request.query as {
        userId: string;
        companionId: string;
        minIntervalHours?: string;
        maxDaily?: string;
      };

      try {
        const result = await outreachRepo.checkEligibility(
          userId,
          companionId,
          parseInt(minIntervalHours || '24', 10),
          parseInt(maxDaily || '1', 10)
        );
        return reply.send(result);
      } catch (error) {
        logger.error({ error, userId, companionId }, 'Failed eligibility check');
        return reply.status(500).send({ error: 'Failed to check eligibility' });
      }
    }
  );

  /**
   * GET /outreach/config/:companionId - Get outreach config (internal)
   */
  app.get(
    '/config/:companionId',
    { preHandler: [requireInternalService] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId } = request.params as { companionId: string };

      try {
        const config = await outreachRepo.getConfig(companionId);
        if (!config) {
          // Return defaults
          return reply.send({
            config: {
              enabled: true,
              min_interval_hours: 24,
              max_daily: 1,
              quiet_hours_start: 22,
              quiet_hours_end: 8,
              triggers_enabled: ['scheduled_checkin', 'followup', 'time_based'],
            },
          });
        }
        return reply.send({ config });
      } catch (error) {
        logger.error({ error, companionId }, 'Failed to fetch outreach config');
        return reply.status(500).send({ error: 'Failed to fetch outreach config' });
      }
    }
  );

  /**
   * POST /outreach/records - Create an outreach record (internal, from worker)
   */
  app.post(
    '/records',
    { preHandler: [requireInternalService] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateOutreachRecordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
      }

      try {
        const record = await outreachRepo.createRecord({
          user_id: parsed.data.user_id,
          companion_id: parsed.data.companion_id,
          trigger: parsed.data.trigger,
          message: parsed.data.message,
          delivered_via: parsed.data.delivered_via,
          metadata: parsed.data.metadata as Record<string, unknown> | undefined,
        });
        return reply.status(201).send({ outreach: record });
      } catch (error) {
        logger.error({ error }, 'Failed to create outreach record');
        return reply.status(500).send({ error: 'Failed to create outreach record' });
      }
    }
  );
}

/**
 * Register outreach config routes on companions (user-facing)
 * Mounted under /companions/:id/outreach-config
 */
export async function outreachConfigRoutes(app: FastifyInstance): Promise<void> {
  const outreachRepo = getOutreachRepository();

  /**
   * PUT /companions/:id/outreach-config - Update outreach preferences
   */
  app.put(
    '/:id/outreach-config',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: companionId } = request.params as { id: string };
      const parsed = OutreachConfigUpdateSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
      }

      try {
        const config = await outreachRepo.upsertConfig(companionId, parsed.data);
        return reply.send({ config });
      } catch (error) {
        logger.error({ error, companionId }, 'Failed to update outreach config');
        return reply.status(500).send({ error: 'Failed to update outreach config' });
      }
    }
  );
}
