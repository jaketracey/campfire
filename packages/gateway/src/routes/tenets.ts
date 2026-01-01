/**
 * Tenets Routes
 * Behavioral tenets management for AI companions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  getTenetsService,
  CreateTenetInputSchema,
  UpdateTenetInputSchema,
  TenetPrioritySchema,
} from '../services/tenets.js';
import { logger } from '../observability/logger.js';

// Request schemas
const CreateTenetBodySchema = CreateTenetInputSchema;

const UpdateTenetBodySchema = UpdateTenetInputSchema;

const UpdatePriorityBodySchema = z.object({
  priority: TenetPrioritySchema,
});

const SearchTenetsBodySchema = z.object({
  contexts: z.array(z.string()).optional(),
  embedding: z.array(z.number()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const BulkCreateTenetsBodySchema = z.object({
  tenets: z.array(CreateTenetInputSchema).min(1).max(20),
});

/**
 * Register tenets routes
 */
export async function tenetsRoutes(app: FastifyInstance): Promise<void> {
  const tenetsService = getTenetsService();

  // ===========================================================================
  // Companion Tenets (nested under /companions/:companionId/tenets)
  // ===========================================================================

  /**
   * GET /companions/:companionId/tenets
   * List all tenets for a companion
   */
  app.get<{
    Params: { companionId: string };
  }>(
    '/companions/:companionId/tenets',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId } = request.params;
      const userId = request.user!.userId;

      const tenets = await tenetsService.list(userId, companionId);

      return reply.send({
        tenets,
        counts: {
          core: tenets.filter((t) => t.priority === 'core').length,
          situational: tenets.filter((t) => t.priority === 'situational').length,
        },
      });
    }
  );

  /**
   * GET /companions/:companionId/tenets/core
   * Get core tenets for system prompt
   */
  app.get<{
    Params: { companionId: string };
  }>(
    '/companions/:companionId/tenets/core',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId } = request.params;

      const tenets = await tenetsService.getCoreTenets(companionId);

      return reply.send({ tenets });
    }
  );

  /**
   * POST /companions/:companionId/tenets
   * Create a new tenet
   */
  app.post<{
    Params: { companionId: string };
    Body: z.infer<typeof CreateTenetBodySchema>;
  }>(
    '/companions/:companionId/tenets',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId } = request.params;
      const userId = request.user!.userId;

      const parseResult = CreateTenetBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      try {
        const tenet = await tenetsService.create(userId, companionId, parseResult.data);
        return reply.status(201).send(tenet);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Maximum of 5 core tenets')) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  /**
   * POST /companions/:companionId/tenets/bulk
   * Bulk create tenets (for onboarding)
   */
  app.post<{
    Params: { companionId: string };
    Body: z.infer<typeof BulkCreateTenetsBodySchema>;
  }>(
    '/companions/:companionId/tenets/bulk',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId } = request.params;
      const userId = request.user!.userId;

      const parseResult = BulkCreateTenetsBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      try {
        const tenets = await tenetsService.bulkCreate(
          userId,
          companionId,
          parseResult.data.tenets
        );
        return reply.status(201).send({ tenets });
      } catch (error) {
        if (error instanceof Error && error.message.includes('Maximum of 5 core tenets')) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  /**
   * POST /companions/:companionId/tenets/search
   * Search situational tenets
   */
  app.post<{
    Params: { companionId: string };
    Body: z.infer<typeof SearchTenetsBodySchema>;
  }>(
    '/companions/:companionId/tenets/search',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId } = request.params;

      const parseResult = SearchTenetsBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      const { contexts, embedding, limit } = parseResult.data;

      const tenets = await tenetsService.searchSituational(
        companionId,
        contexts || [],
        embedding,
        limit || 5
      );

      return reply.send({ tenets });
    }
  );

  /**
   * PATCH /companions/:companionId/tenets/:tenetId
   * Update a tenet
   */
  app.patch<{
    Params: { companionId: string; tenetId: string };
    Body: z.infer<typeof UpdateTenetBodySchema>;
  }>(
    '/companions/:companionId/tenets/:tenetId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId, tenetId } = request.params;
      const userId = request.user!.userId;

      const parseResult = UpdateTenetBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      try {
        const tenet = await tenetsService.update(
          userId,
          companionId,
          tenetId,
          parseResult.data
        );
        return reply.send(tenet);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Tenet not found') {
            return reply.status(404).send({ error: error.message });
          }
          if (error.message.includes('Maximum of 5 core tenets')) {
            return reply.status(400).send({ error: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * PATCH /companions/:companionId/tenets/:tenetId/priority
   * Update tenet priority
   */
  app.patch<{
    Params: { companionId: string; tenetId: string };
    Body: z.infer<typeof UpdatePriorityBodySchema>;
  }>(
    '/companions/:companionId/tenets/:tenetId/priority',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId, tenetId } = request.params;
      const userId = request.user!.userId;

      const parseResult = UpdatePriorityBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      try {
        const tenet = await tenetsService.updatePriority(
          userId,
          companionId,
          tenetId,
          parseResult.data.priority
        );
        return reply.send(tenet);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Tenet not found') {
            return reply.status(404).send({ error: error.message });
          }
          if (error.message.includes('Maximum of 5 core tenets')) {
            return reply.status(400).send({ error: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * DELETE /companions/:companionId/tenets/:tenetId
   * Delete a tenet
   */
  app.delete<{
    Params: { companionId: string; tenetId: string };
  }>(
    '/companions/:companionId/tenets/:tenetId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { companionId, tenetId } = request.params;
      const userId = request.user!.userId;

      try {
        await tenetsService.delete(userId, companionId, tenetId);
        return reply.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === 'Tenet not found') {
          return reply.status(404).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  // ===========================================================================
  // Internal Routes (for orchestrator)
  // ===========================================================================

  /**
   * POST /internal/companions/:companionId/tenets/search
   * Search tenets (internal - no auth required, for orchestrator)
   */
  app.post<{
    Params: { companionId: string };
    Body: z.infer<typeof SearchTenetsBodySchema>;
  }>(
    '/internal/companions/:companionId/tenets/search',
    async (request, reply) => {
      const { companionId } = request.params;

      const parseResult = SearchTenetsBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          details: parseResult.error.issues,
        });
      }

      const { contexts, embedding, limit } = parseResult.data;

      const tenets = await tenetsService.searchSituational(
        companionId,
        contexts || [],
        embedding,
        limit || 5
      );

      return reply.send({ tenets });
    }
  );

  /**
   * GET /internal/companions/:companionId/tenets/core
   * Get core tenets (internal - no auth required, for orchestrator)
   */
  app.get<{
    Params: { companionId: string };
  }>(
    '/internal/companions/:companionId/tenets/core',
    async (request, reply) => {
      const { companionId } = request.params;

      const tenets = await tenetsService.getCoreTenets(companionId);

      return reply.send({ tenets });
    }
  );

  logger.debug('Tenets routes registered');
}
