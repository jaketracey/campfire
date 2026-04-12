/**
 * Memory Documents Internal Routes
 * Internal service-to-service endpoint for compiling memory documents.
 * Called by the orchestrator after async memory compilation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { getMemoryDocumentsRepository } from '../repositories/memory-documents.js';

// ============================================================================
// Request Schemas
// ============================================================================

const CompileBodySchema = z.object({
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  content: z.string(),
  estimatedTokens: z.number().int().min(0),
  version: z.number().int().min(1).optional(),
  turnId: z.string().uuid().optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function memoryDocumentsInternalRoutes(app: FastifyInstance): Promise<void> {
  const repo = getMemoryDocumentsRepository();

  /**
   * PUT /memory-documents/internal/compile
   * Upsert the compiled memory document (internal, from orchestrator).
   */
  app.put(
    '/internal/compile',
    { preHandler: [requireInternalService] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CompileBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid body', details: parsed.error.flatten() });
      }

      const { userId, companionId, content, estimatedTokens, version, turnId } = parsed.data;

      try {
        if (version) {
          // Optimistic locking update
          const updated = await repo.updateContent(
            userId,
            companionId,
            content,
            estimatedTokens,
            version,
            turnId,
          );

          if (!updated) {
            // Version conflict or document doesn't exist yet — try upsert
            await repo.upsertContent(userId, companionId, content, estimatedTokens, turnId);
          }
        } else {
          // No version specified — just upsert
          await repo.upsertContent(userId, companionId, content, estimatedTokens, turnId);
        }

        logger.info(
          { userId, companionId, estimatedTokens },
          'Memory document compiled',
        );

        return reply.status(200).send({ ok: true });
      } catch (err) {
        logger.error({ err, userId, companionId }, 'Failed to compile memory document');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
