/**
 * Creator Earnings Routes
 * Creator-facing endpoints for earnings summaries.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getCreatorEarningsService } from '../services/creator-earnings.js';

export async function creatorEarningsRoutes(app: FastifyInstance): Promise<void> {
  const earnings = getCreatorEarningsService();

  app.get('/earnings/summary', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const summary = await earnings.getSummaryForCreator(user.userId);
    return reply.send({ success: true, data: summary });
  });
}

