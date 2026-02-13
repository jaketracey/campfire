/**
 * Admin Companions Routes
 * Administrative operations for companion management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getAdminCompanionsRepository } from '../repositories/admin-companions.js';

// ============================================================================
// Request Schemas
// ============================================================================

const CompanionListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  search: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  sortBy: z.enum([
    'name',
    'ownerEmail',
    'status',
    'sessionCount',
    'totalMessages',
    'totalCostUsd',
    'createdAt',
  ]).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CompanionIdParamsSchema = z.object({
  companionId: z.string().uuid(),
});

const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// ============================================================================
// Routes
// ============================================================================

export async function adminCompanionsRoutes(app: FastifyInstance): Promise<void> {
  const repo = getAdminCompanionsRepository();

  // All admin companions routes require admin role
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/companions - List all companions with stats
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CompanionListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;
    const result = await repo.listWithStats({
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      status: query.status,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return reply.send({
      success: true,
      data: {
        companions: result.data.map(companion => ({
          id: companion.id,
          name: companion.name,
          status: companion.status,
          createdAt: companion.createdAt.toISOString(),
          ownerId: companion.ownerId,
          ownerEmail: companion.ownerEmail,
          avatarUrl: companion.avatarUrl,
          sessionCount: companion.sessionCount,
          totalMessages: companion.totalMessages,
          totalTokensInput: companion.totalTokensInput,
          totalTokensOutput: companion.totalTokensOutput,
          totalCostUsd: companion.totalCostUsd,
          imageCount: companion.imageCount,
          videoCount: companion.videoCount,
          entityCount: companion.entityCount,
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /admin/companions/:companionId - Get companion detail with full stats
   */
  app.get('/:companionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const { companionId } = paramsResult.data;
    const companion = await repo.getDetailWithStats(companionId);

    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: companion.id,
        name: companion.name,
        status: companion.status,
        isPublic: companion.isPublic,
        specVersion: companion.specVersion,
        createdAt: companion.createdAt.toISOString(),
        updatedAt: companion.updatedAt.toISOString(),
        spec: companion.spec,
        backstory: companion.backstory,
        ownerId: companion.ownerId,
        ownerEmail: companion.ownerEmail,
        avatarUrl: companion.avatarUrl,
        sessionCount: companion.sessionCount,
        totalMessages: companion.totalMessages,
        totalTokensInput: companion.totalTokensInput,
        totalTokensOutput: companion.totalTokensOutput,
        totalCostUsd: companion.totalCostUsd,
        imageCount: companion.imageCount,
        videoCount: companion.videoCount,
        entityCount: companion.entityCount,
      },
    });
  });

  /**
   * GET /admin/companions/:companionId/images - Get paginated images
   */
  app.get('/:companionId/images', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const queryResult = PaginationQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { companionId } = paramsResult.data;
    const { limit, offset } = queryResult.data;

    const result = await repo.getImages(companionId, { limit, offset });

    return reply.send({
      success: true,
      data: {
        images: result.data.map(image => ({
          id: image.id,
          url: image.s3Url,
          width: image.width,
          height: image.height,
          emotionalState: image.emotionalState,
          style: image.style,
          prompt: image.prompt,
          provider: image.provider,
          createdAt: image.createdAt.toISOString(),
          renditions: image.renditions ?? null,
        })),
        hasMore: result.hasMore,
        limit,
        offset,
      },
    });
  });

  /**
   * GET /admin/companions/:companionId/knowledge-graph - Get knowledge graph data
   */
  app.get('/:companionId/knowledge-graph', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = CompanionIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid companion ID',
        details: paramsResult.error.issues,
      });
    }

    const { companionId } = paramsResult.data;
    const graph = await repo.getKnowledgeGraph(companionId);

    return reply.send({
      success: true,
      data: {
        entities: graph.entities.map(entity => ({
          id: entity.id,
          name: entity.name,
          canonicalName: entity.canonicalName,
          entityType: entity.entityType,
          aliases: entity.aliases,
          metadata: entity.metadata,
        })),
        edges: graph.edges.map(edge => ({
          id: edge.id,
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          relationType: edge.relationType,
          confidence: edge.confidence,
        })),
      },
    });
  });
}
