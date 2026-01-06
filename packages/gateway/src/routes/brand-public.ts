/**
 * Public Branding Routes
 * Returns tenant/brand configuration based on request host.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBrandingService } from '../services/branding.js';
import { logger } from '../observability/logger.js';

export async function brandPublicRoutes(app: FastifyInstance): Promise<void> {
  const branding = getBrandingService();

  app.get('/brand', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const resolved = await branding.resolveFromHeaders(request.headers as unknown as Record<string, unknown>);
      return reply.send({ success: true, data: resolved });
    } catch (error) {
      logger.error({ error }, 'Failed to resolve brand');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve brand' },
      });
    }
  });
}

