/**
 * Admin Memory Maintenance Routes
 *
 * Endpoints for manually triggering memory decay and expiration jobs.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { enqueueMemoryDecayJob, enqueueMemoryExpirationJob } from '../utils/queue.js';
import { logger } from '../observability/logger.js';

const TriggerDecayBodySchema = z.object({
  userId: z.string().uuid().optional(),
  companionId: z.string().uuid().optional(),
  decayRate: z.number().min(0.001).max(0.5).optional(),
}).refine(
  (data) => {
    // If one of userId/companionId is provided, both must be
    if (data.userId && !data.companionId) return false;
    if (!data.userId && data.companionId) return false;
    return true;
  },
  { message: 'Both userId and companionId must be provided together, or neither' }
);

export async function adminMemoriesRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require admin
  fastify.addHook('onRequest', requireAdmin);

  /**
   * POST /admin/memories/decay
   * Manually trigger memory decay.
   * Optionally target a specific user-companion pair.
   */
  fastify.post('/decay', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = TriggerDecayBodySchema.parse(request.body || {});

    const enqueued = await enqueueMemoryDecayJob({
      userId: body.userId,
      companionId: body.companionId,
      decayRate: body.decayRate,
    });

    if (!enqueued) {
      return reply.status(503).send({
        error: 'Queue unavailable',
        message: 'Memory decay queue is not available. Check Redis connectivity.',
      });
    }

    logger.info(
      { userId: body.userId, companionId: body.companionId, decayRate: body.decayRate },
      'Memory decay job manually triggered'
    );

    return reply.status(202).send({
      message: 'Memory decay job enqueued',
      target: body.userId
        ? { userId: body.userId, companionId: body.companionId }
        : 'all active pairs',
    });
  });

  /**
   * POST /admin/memories/expire
   * Manually trigger expired memory cleanup.
   */
  fastify.post('/expire', async (_request: FastifyRequest, reply: FastifyReply) => {
    const enqueued = await enqueueMemoryExpirationJob();

    if (!enqueued) {
      return reply.status(503).send({
        error: 'Queue unavailable',
        message: 'Memory expiration queue is not available. Check Redis connectivity.',
      });
    }

    logger.info('Memory expiration job manually triggered');

    return reply.status(202).send({
      message: 'Memory expiration job enqueued',
    });
  });
}
