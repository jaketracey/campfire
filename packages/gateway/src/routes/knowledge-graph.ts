/**
 * Knowledge Graph Routes
 * Entity and relationship management for user-companion knowledge graphs.
 * Used by the orchestrator for storing extracted entities from conversations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getKnowledgeGraphRepository } from '../repositories/knowledge-graph.js';
import { getEventStore } from '../db/event-store.js';

/**
 * Request schemas
 */
const CreateEntitySchema = z.object({
  companionId: z.string().uuid(),
  name: z.string().min(1).max(500),
  entityType: z.enum(['person', 'place', 'thing', 'event', 'concept', 'emotion', 'activity', 'time']),
  canonicalName: z.string().min(1).max(500).optional(),
  aliases: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
});

const CreateEdgeSchema = z.object({
  companionId: z.string().uuid(),
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationType: z.enum([
    'knows', 'likes', 'dislikes', 'located_at', 'works_at',
    'related_to', 'part_of', 'causes', 'experienced', 'wants', 'has', 'is_a'
  ]),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
});

const ProposalNodeSchema = z.object({
  label: z.string().min(1).max(500),
  nodeType: z.enum(['person', 'place', 'thing', 'event', 'concept', 'emotion', 'activity', 'time']),
  properties: z.record(z.unknown()).optional(),
});

const ProposalRelationSchema = z.object({
  sourceLabel: z.string().min(1),
  targetLabel: z.string().min(1),
  relationType: z.enum([
    'knows', 'likes', 'dislikes', 'located_at', 'works_at',
    'related_to', 'part_of', 'causes', 'experienced', 'wants', 'has', 'is_a'
  ]),
  confidence: z.number().min(0).max(1).optional(),
});

const KGProposalSchema = z.object({
  companionId: z.string().uuid(),
  nodes: z.array(ProposalNodeSchema).optional(),
  relations: z.array(ProposalRelationSchema).optional(),
  reasoning: z.string().max(1000).optional(),
  sourceEventId: z.string().uuid().optional(),
  autoApprove: z.boolean().optional().default(true), // Auto-approve by default for orchestrator
});

const SearchEntitiesSchema = z.object({
  companionId: z.string().uuid(),
  query: z.string().min(1).max(500),
  entityType: z.enum(['person', 'place', 'thing', 'event', 'concept', 'emotion', 'activity', 'time']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * Register knowledge graph routes
 */
export async function knowledgeGraphRoutes(app: FastifyInstance): Promise<void> {
  const repo = getKnowledgeGraphRepository();

  // ===========================================================================
  // Public routes (require user auth)
  // ===========================================================================

  /**
   * GET /knowledge-graph/entities - List entities for a companion
   */
  app.get('/entities', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.listEntities', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { companionId, entityType, search, limit = '50', offset = '0' } = request.query as {
        companionId?: string;
        entityType?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      if (!companionId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_COMPANION_ID', message: 'companionId query parameter is required' },
        });
      }

      const result = await repo.listEntities(user.userId, {
        companionId,
        entityType,
        search,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data,
          hasMore: result.hasMore,
        },
      });
    });
  });

  /**
   * GET /knowledge-graph/entities/:entityId - Get a specific entity
   */
  app.get('/entities/:entityId', { preHandler: requireAuth }, async (
    request: FastifyRequest<{ Params: { entityId: string } }>,
    reply: FastifyReply
  ) => {
    return withSpan('kg.getEntity', async (span) => {
      const user = request.user!;
      const { entityId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'entity.id': entityId });

      const entity = await repo.findEntityByIdWithStats(entityId);

      if (!entity || entity.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Entity not found' },
        });
      }

      return reply.send({ success: true, data: entity });
    });
  });

  /**
   * POST /knowledge-graph/entities/search - Search entities
   */
  app.post('/entities/search', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.searchEntities', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = SearchEntitiesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parseResult.error.flatten() },
        });
      }

      const { companionId, query, entityType, limit } = parseResult.data;

      const results = await repo.searchEntities(user.userId, companionId, query, { limit, entityType });

      return reply.send({
        success: true,
        data: { items: results, query },
      });
    });
  });

  /**
   * GET /knowledge-graph/edges - List edges for a companion
   */
  app.get('/edges', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.listEdges', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { companionId, relationType, status, limit = '50', offset = '0' } = request.query as {
        companionId?: string;
        relationType?: string;
        status?: string;
        limit?: string;
        offset?: string;
      };

      if (!companionId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_COMPANION_ID', message: 'companionId query parameter is required' },
        });
      }

      const result = await repo.listEdges(user.userId, {
        companionId,
        relationType,
        status: status as 'active' | 'proposed' | 'deprecated' | undefined,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data,
          hasMore: result.hasMore,
        },
      });
    });
  });

  /**
   * GET /knowledge-graph/stats - Get KG statistics for a companion
   */
  app.get('/stats', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.getStats', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { companionId } = request.query as { companionId?: string };

      if (!companionId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_COMPANION_ID', message: 'companionId query parameter is required' },
        });
      }

      const [entityCount, edgeCount, entityTypes, relationTypes] = await Promise.all([
        repo.countEntities(user.userId, companionId),
        repo.countEdges(user.userId, companionId),
        repo.getEntityTypes(user.userId, companionId),
        repo.getRelationTypes(user.userId, companionId),
      ]);

      return reply.send({
        success: true,
        data: {
          entityCount,
          edgeCount,
          entityTypes,
          relationTypes,
        },
      });
    });
  });

  /**
   * GET /knowledge-graph/subgraph/:entityId - Get subgraph around an entity
   */
  app.get('/subgraph/:entityId', { preHandler: requireAuth }, async (
    request: FastifyRequest<{ Params: { entityId: string } }>,
    reply: FastifyReply
  ) => {
    return withSpan('kg.getSubgraph', async (span) => {
      const user = request.user!;
      const { entityId } = request.params;
      const { depth = '2' } = request.query as { depth?: string };
      span.setAttributes({ 'user.id': user.userId, 'entity.id': entityId });

      const entity = await repo.findEntityById(entityId);
      if (!entity || entity.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Entity not found' },
        });
      }

      const subgraph = await repo.getSubgraph(entityId, parseInt(depth, 10));

      return reply.send({
        success: true,
        data: subgraph,
      });
    });
  });

  // ===========================================================================
  // Internal routes (for orchestrator service)
  // ===========================================================================

  /**
   * POST /knowledge-graph/internal/entities - Create entity (internal use)
   */
  app.post('/internal/entities', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.createEntity.internal', async (span) => {
      const parseResult = CreateEntitySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parseResult.error.flatten() },
        });
      }

      const { companionId, name, entityType, canonicalName, aliases, metadata, sourceEventId } = parseResult.data;
      const userId = (request.body as { userId?: string }).userId;

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId is required' },
        });
      }

      const entity = await repo.createEntity({
        user_id: userId,
        companion_id: companionId,
        name,
        entity_type: entityType,
        canonical_name: canonicalName,
        aliases,
        metadata: metadata as Record<string, unknown>,
        source_event_id: sourceEventId,
      });

      logger.info({ entityId: entity.id, name, userId }, 'Entity created via internal API');

      return reply.status(201).send({ success: true, data: entity });
    });
  });

  /**
   * POST /knowledge-graph/internal/edges - Create edge (internal use)
   */
  app.post('/internal/edges', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.createEdge.internal', async (span) => {
      const parseResult = CreateEdgeSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parseResult.error.flatten() },
        });
      }

      const { companionId, sourceEntityId, targetEntityId, relationType, confidence, metadata, sourceEventId } = parseResult.data;
      const userId = (request.body as { userId?: string }).userId;

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId is required' },
        });
      }

      // Use upsert to handle duplicate edges gracefully
      const edge = await repo.upsertEdge({
        user_id: userId,
        companion_id: companionId,
        source_entity_id: sourceEntityId,
        target_entity_id: targetEntityId,
        relation_type: relationType,
        confidence,
        metadata: metadata as Record<string, unknown>,
        source_event_id: sourceEventId,
      });

      logger.info({ edgeId: edge.id, relationType, userId }, 'Edge created via internal API');

      return reply.status(201).send({ success: true, data: edge });
    });
  });

  /**
   * POST /knowledge-graph/internal/proposals - Submit KG proposal (orchestrator endpoint)
   * This is the main endpoint used by the orchestrator's kg_propose tool
   */
  app.post('/internal/proposals', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.submitProposal.internal', async (span) => {
      const parseResult = KGProposalSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parseResult.error.flatten() },
        });
      }

      const { companionId, nodes = [], relations = [], reasoning, sourceEventId, autoApprove } = parseResult.data;
      const userId = (request.body as { userId?: string }).userId;

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId is required' },
        });
      }

      const proposalId = nanoid();
      const createdEntities: Array<{ label: string; id: string }> = [];
      const createdEdges: string[] = [];

      try {
        // Process nodes - create or find existing entities
        const labelToEntityId = new Map<string, string>();

        for (const node of nodes) {
          // Check if entity already exists by canonical name
          const existing = await repo.findEntityByCanonicalName(
            userId,
            companionId,
            node.label.toLowerCase().trim()
          );

          if (existing) {
            labelToEntityId.set(node.label, existing.id);
            logger.debug({ label: node.label, existingId: existing.id }, 'Found existing entity');
          } else {
            // Create new entity
            const entity = await repo.createEntity({
              user_id: userId,
              companion_id: companionId,
              name: node.label,
              entity_type: node.nodeType,
              metadata: node.properties as Record<string, unknown>,
              source_event_id: sourceEventId,
            });

            labelToEntityId.set(node.label, entity.id);
            createdEntities.push({ label: node.label, id: entity.id });
            logger.debug({ label: node.label, entityId: entity.id }, 'Created new entity');
          }
        }

        // Process relations - create edges between entities
        for (const relation of relations) {
          const sourceId = labelToEntityId.get(relation.sourceLabel);
          const targetId = labelToEntityId.get(relation.targetLabel);

          if (!sourceId || !targetId) {
            logger.warn(
              { sourceLabel: relation.sourceLabel, targetLabel: relation.targetLabel },
              'Skipping relation - entity not found'
            );
            continue;
          }

          const edge = await repo.upsertEdge({
            user_id: userId,
            companion_id: companionId,
            source_entity_id: sourceId,
            target_entity_id: targetId,
            relation_type: relation.relationType,
            confidence: relation.confidence ?? 0.8,
            status: autoApprove ? 'active' : 'proposed',
            source_event_id: sourceEventId,
          });

          createdEdges.push(edge.id);
        }

        // Emit event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId,
          sessionId: null,
          turnId: null,
          traceId: request.id,
          type: 'kg.proposal.processed',
          payload: {
            proposalId,
            companionId,
            entitiesCreated: createdEntities.length,
            edgesCreated: createdEdges.length,
            reasoning,
            autoApproved: autoApprove,
          },
          version: '1.0',
          causationId: sourceEventId ?? null,
          correlationId: request.id,
        });

        logger.info(
          {
            proposalId,
            userId,
            companionId,
            entitiesCreated: createdEntities.length,
            edgesCreated: createdEdges.length,
          },
          'KG proposal processed'
        );

        return reply.status(201).send({
          success: true,
          data: {
            proposalId,
            entitiesCreated: createdEntities,
            edgesCreated: createdEdges.length,
            autoApproved: autoApprove,
          },
        });
      } catch (error) {
        logger.error({ error, proposalId }, 'Failed to process KG proposal');
        throw error;
      }
    });
  });

  /**
   * POST /knowledge-graph/internal/search - Search entities (internal use)
   */
  app.post('/internal/search', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('kg.search.internal', async (span) => {
      const { userId, companionId, query, entityType, limit } = request.body as {
        userId: string;
        companionId: string;
        query: string;
        entityType?: string;
        limit?: number;
      };

      if (!userId || !companionId || !query) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'userId, companionId, and query are required' },
        });
      }

      const results = await repo.searchEntities(userId, companionId, query, { limit, entityType });

      return reply.send({
        success: true,
        data: { items: results },
      });
    });
  });
}
