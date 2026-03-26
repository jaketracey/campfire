/**
 * Memory Routes
 * Long-term memory management for user-companion relationships.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';
import { getMemoriesRepository } from '../repositories/memories.js';
import { getEmbeddingService } from '../services/embeddings.js';

/**
 * Request schemas
 */
const CreateMemorySchema = z.object({
  companionId: z.string().uuid(),
  content: z.string().min(1).max(10000),
  contentType: z.enum(['fact', 'preference', 'event', 'summary', 'reflection']).default('fact'),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

const UpdateMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  contentType: z.enum(['fact', 'preference', 'event', 'summary', 'reflection']).optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const SearchMemoriesSchema = z.object({
  query: z.string().min(1).max(1000),
  companionId: z.string().uuid().optional(),
  contentType: z.enum(['fact', 'preference', 'event', 'summary', 'reflection']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  minImportance: z.number().min(0).max(1).optional(),
});

/**
 * Register memory routes
 */
export async function memoriesRoutes(app: FastifyInstance): Promise<void> {
  // All memory routes require authentication
  app.addHook('preHandler', requireAuth);

  /**
   * GET /memories - List memories for current user
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.list', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const {
        companionId,
        contentType,
        status,
        tags,
        minImportance,
        limit = '50',
        offset = '0',
      } = request.query as {
        companionId?: string;
        contentType?: string;
        status?: string;
        tags?: string;
        minImportance?: string;
        limit?: string;
        offset?: string;
      };

      // Validate query params
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
      const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

      const validContentTypes = ['fact', 'preference', 'event', 'summary', 'reflection'];
      if (contentType && !validContentTypes.includes(contentType)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid contentType. Must be one of: ${validContentTypes.join(', ')}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const validStatuses = ['active', 'archived'];
      if (status && !validStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const parsedMinImportance = minImportance !== undefined ? parseFloat(minImportance) : undefined;
      if (parsedMinImportance !== undefined && (isNaN(parsedMinImportance) || parsedMinImportance < 0 || parsedMinImportance > 1)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'minImportance must be a number between 0 and 1',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined;

      const repo = getMemoriesRepository();

      try {
        const result = await repo.listByUser({
          userId: user.userId,
          companionId,
          contentType: contentType as 'fact' | 'preference' | 'event' | 'summary' | 'reflection' | undefined,
          status: status as 'active' | 'archived' | undefined,
          minImportance: parsedMinImportance,
          tags: parsedTags,
          limit: parsedLimit,
          offset: parsedOffset,
        });

        logger.debug(
          { userId: user.userId, companionId, contentType, count: result.data.length },
          'Listing memories'
        );

        return reply.send({
          success: true,
          data: {
            items: result.data.map(m => ({
              id: m.id,
              companionId: m.companion_id,
              content: m.content,
              contentType: m.content_type,
              importance: m.importance,
              metadata: m.metadata,
              expiresAt: m.expires_at?.toISOString() ?? null,
              createdAt: m.created_at.toISOString(),
              updatedAt: m.updated_at.toISOString(),
            })),
            pagination: {
              limit: parsedLimit,
              offset: parsedOffset,
              total: result.total ?? 0,
              hasMore: result.hasMore,
            },
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId }, 'Failed to list memories');
        throw error;
      }
    });
  });

  /**
   * POST /memories - Create a new memory
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.create', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Validate request body
      const parseResult = CreateMemorySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { companionId, content, contentType, importance, metadata, expiresAt } = parseResult.data;

      const repo = getMemoriesRepository();

      try {
        // Generate embedding for the memory content
        let embedding: number[] | undefined;
        try {
          const embeddingService = getEmbeddingService();
          embedding = await embeddingService.generateEmbedding(content);
        } catch (embError) {
          logger.warn({ error: embError }, 'Failed to generate embedding for memory');
        }

        // Create the memory
        const memory = await repo.create({
          user_id: user.userId,
          companion_id: companionId,
          content,
          content_type: contentType,
          importance: importance ?? 0.5,
          metadata: metadata as Record<string, unknown>,
          embedding,
          expires_at: expiresAt ? new Date(expiresAt) : undefined,
        });

        logger.info(
          { memoryId: memory.id, userId: user.userId, companionId, contentType },
          'Memory created'
        );

        // Emit memory.created event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId: user.userId,
          sessionId: 'memory',
          turnId: null,
          traceId: request.id,
          type: 'memory.created',
          payload: {
            memoryId: memory.id,
            companionId,
            contentType,
            contentLength: content.length,
            hasEmbedding: !!embedding,
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.status(201).send({
          success: true,
          data: {
            id: memory.id,
            userId: user.userId,
            companionId,
            content: memory.content,
            contentType: memory.content_type,
            importance: memory.importance,
            metadata: memory.metadata,
            expiresAt: memory.expires_at?.toISOString() ?? null,
            createdAt: memory.created_at.toISOString(),
            updatedAt: memory.updated_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId, companionId }, 'Failed to create memory');
        throw error;
      }
    });
  });

  /**
   * POST /memories/search - Semantic search across memories
   */
  app.post('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.search', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Validate request body
      const parseResult = SearchMemoriesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { query, companionId, contentType, limit, minImportance } = parseResult.data;

      if (!companionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'companionId is required for search',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const repo = getMemoriesRepository();

      try {
        // Try vector search first if embedding service is available
        let memories: Awaited<ReturnType<typeof repo.searchByVector>> = [];

        try {
          const embeddingService = getEmbeddingService();
          const queryEmbedding = await embeddingService.generateEmbedding(query);

          memories = await repo.searchByVector({
            userId: user.userId,
            companionId,
            embedding: queryEmbedding,
            limit: limit ?? 10,
            minSimilarity: 0.5,
            contentTypes: contentType ? [contentType] : undefined,
            minImportance,
          });
        } catch (embError) {
          logger.warn({ error: embError }, 'Vector search failed, falling back to text search');

          // Fall back to text search
          const textResults = await repo.searchByText({
            userId: user.userId,
            companionId,
            query,
            limit: limit ?? 10,
            contentTypes: contentType ? [contentType] : undefined,
          });

          memories = textResults.map(m => ({ ...m, similarity: 0.5 }));
        }

        // Record access for retrieved memories
        if (memories.length > 0) {
          await repo.recordAccessBatch(memories.map(m => m.id));
        }

        logger.debug(
          { userId: user.userId, query: query.substring(0, 50), companionId, count: memories.length },
          'Searching memories'
        );

        return reply.send({
          success: true,
          data: {
            items: memories.map(m => ({
              id: m.id,
              companionId: m.companion_id,
              content: m.content,
              contentType: m.content_type,
              importance: m.importance,
              similarity: m.similarity,
              createdAt: m.created_at.toISOString(),
            })),
            query,
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId, companionId }, 'Failed to search memories');
        throw error;
      }
    });
  });

  /**
   * GET /memories/:memoryId - Get a specific memory
   */
  app.get('/:memoryId', async (request: FastifyRequest<{ Params: { memoryId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.get', async (span) => {
      const user = request.user!;
      const { memoryId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'memory.id': memoryId });

      const repo = getMemoriesRepository();

      try {
        const memory = await repo.findById(memoryId);

        if (!memory || memory.user_id !== user.userId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
              timestamp: new Date().toISOString(),
            },
          });
        }

        logger.debug(
          { memoryId, userId: user.userId },
          'Retrieved memory'
        );

        return reply.send({
          success: true,
          data: {
            id: memory.id,
            companionId: memory.companion_id,
            content: memory.content,
            contentType: memory.content_type,
            importance: memory.importance,
            metadata: memory.metadata,
            sourceEventId: memory.source_event_id,
            sourceTurnId: memory.source_turn_id,
            expiresAt: memory.expires_at?.toISOString() ?? null,
            createdAt: memory.created_at.toISOString(),
            updatedAt: memory.updated_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId: user.userId }, 'Failed to get memory');
        throw error;
      }
    });
  });

  /**
   * PATCH /memories/:memoryId - Update a memory
   */
  app.patch('/:memoryId', async (request: FastifyRequest<{ Params: { memoryId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.update', async (span) => {
      const user = request.user!;
      const { memoryId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'memory.id': memoryId });

      // Validate request body
      const parseResult = UpdateMemorySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updates = parseResult.data;

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'At least one field must be provided for update',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const repo = getMemoriesRepository();

      try {
        // Verify ownership first
        const existing = await repo.findById(memoryId);
        if (!existing || existing.user_id !== user.userId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Build the update data
        const updateData: Partial<{
          content: string;
          content_type: 'fact' | 'preference' | 'event' | 'summary' | 'reflection';
          importance: number;
          metadata: Record<string, unknown>;
          expires_at: Date | null;
        }> = {};

        if (updates.content !== undefined) updateData.content = updates.content;
        if (updates.contentType !== undefined) updateData.content_type = updates.contentType;
        if (updates.importance !== undefined) updateData.importance = updates.importance;
        if (updates.metadata !== undefined) updateData.metadata = updates.metadata as Record<string, unknown>;
        if (updates.expiresAt !== undefined) {
          updateData.expires_at = updates.expiresAt ? new Date(updates.expiresAt) : null;
        }

        const memory = await repo.update(memoryId, updateData);

        // Re-generate embedding if content changed
        if (updates.content !== undefined) {
          try {
            const embeddingService = getEmbeddingService();
            const embedding = await embeddingService.generateEmbedding(updates.content);
            await repo.updateEmbedding(memoryId, embedding);
          } catch (embError) {
            logger.warn({ error: embError, memoryId }, 'Failed to regenerate embedding after update');
          }
        }

        logger.info(
          { memoryId, userId: user.userId, updates: Object.keys(updates) },
          'Memory updated'
        );

        // Emit memory.updated event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId: user.userId,
          sessionId: 'memory',
          turnId: null,
          traceId: request.id,
          type: 'memory.updated',
          payload: {
            memoryId,
            fields: Object.keys(updates),
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.send({
          success: true,
          data: {
            id: memory.id,
            companionId: memory.companion_id,
            content: memory.content,
            contentType: memory.content_type,
            importance: memory.importance,
            metadata: memory.metadata,
            expiresAt: memory.expires_at?.toISOString() ?? null,
            createdAt: memory.created_at.toISOString(),
            updatedAt: memory.updated_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId: user.userId }, 'Failed to update memory');
        throw error;
      }
    });
  });

  /**
   * DELETE /memories/:memoryId - Delete a memory
   */
  app.delete('/:memoryId', async (request: FastifyRequest<{ Params: { memoryId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.delete', async (span) => {
      const user = request.user!;
      const { memoryId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'memory.id': memoryId });

      const repo = getMemoriesRepository();

      try {
        const deleted = await repo.softDelete(memoryId, user.userId);

        if (!deleted) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
              timestamp: new Date().toISOString(),
            },
          });
        }

        logger.info({ memoryId, userId: user.userId }, 'Memory deleted');

        // Emit memory.deleted event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId: user.userId,
          sessionId: 'memory',
          turnId: null,
          traceId: request.id,
          type: 'memory.deleted',
          payload: {
            memoryId,
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.status(200).send({
          success: true,
          data: {
            id: deleted.id,
            status: 'deleted',
            deletedAt: deleted.updated_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId: user.userId }, 'Failed to delete memory');
        throw error;
      }
    });
  });

  /**
   * POST /memories/bulk - Bulk import memories
   */
  app.post('/bulk', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.bulkCreate', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const schema = z.object({
        companionId: z.string().uuid(),
        memories: z.array(CreateMemorySchema.omit({ companionId: true })).min(1).max(100),
      });

      const parseResult = schema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { companionId, memories } = parseResult.data;

      // TODO: Verify user has access to companion
      // TODO: Bulk create memories via repository
      // TODO: Generate embeddings in batch

      logger.info(
        { userId: user.userId, companionId, count: memories.length },
        'Bulk memory import'
      );

      return reply.status(202).send({
        success: true,
        data: {
          message: 'Bulk import accepted',
          companionId,
          count: memories.length,
        },
      });
    });
  });

  // ===========================================================================
  // Pinned Memories Routes
  // ===========================================================================

  /**
   * GET /memories/pinned/:companionId - Get pinned memories for a companion
   */
  app.get('/pinned/:companionId', async (request: FastifyRequest<{ Params: { companionId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.pinned.list', async (span) => {
      const user = request.user!;
      const { companionId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'companion.id': companionId });

      const repo = getMemoriesRepository();

      try {
        const pinnedMemories = await repo.getPinnedMemories(user.userId, companionId);

        logger.debug(
          { userId: user.userId, companionId, count: pinnedMemories.length },
          'Retrieved pinned memories'
        );

        return reply.send({
          success: true,
          data: {
            items: pinnedMemories.map(m => ({
              id: m.id,
              content: m.content,
              contentType: m.content_type,
              importance: m.importance,
              isPinned: m.is_pinned,
              pinOrder: m.pin_order,
              pinnedAt: m.pinned_at?.toISOString(),
              createdAt: m.created_at.toISOString(),
            })),
            count: pinnedMemories.length,
            maxAllowed: 10,
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId, companionId }, 'Failed to get pinned memories');
        throw error;
      }
    });
  });

  /**
   * POST /memories/:memoryId/pin - Pin a memory
   */
  app.post('/:memoryId/pin', async (request: FastifyRequest<{ Params: { memoryId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.pin', async (span) => {
      const user = request.user!;
      const { memoryId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'memory.id': memoryId });

      const repo = getMemoriesRepository();

      try {
        // First, get the memory to verify ownership and get companionId
        const memory = await repo.findById(memoryId);

        if (!memory || memory.user_id !== user.userId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Check current pinned count
        const pinnedCount = await repo.getPinnedCount(user.userId, memory.companion_id);
        if (pinnedCount >= 10) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'LIMIT_EXCEEDED',
              message: 'Maximum of 10 pinned memories allowed per companion',
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Pin the memory
        const success = await repo.pinMemory(memoryId, user.userId, memory.companion_id);

        if (success) {
          logger.info({ memoryId, userId: user.userId }, 'Memory pinned');

          // Emit event
          const eventStore = getEventStore();
          await eventStore.append({
            eventId: nanoid(),
            timestamp: new Date().toISOString(),
            userId: user.userId,
            sessionId: 'memory',
            turnId: null,
            traceId: request.id,
            type: 'memory.pinned',
            payload: {
              memoryId,
              companionId: memory.companion_id,
            },
            version: '1.0',
            causationId: null,
            correlationId: request.id,
          });

          return reply.send({
            success: true,
            data: {
              memoryId,
              isPinned: true,
              pinnedCount: pinnedCount + 1,
              maxAllowed: 10,
            },
          });
        } else {
          return reply.status(500).send({
            success: false,
            error: {
              code: 'PIN_FAILED',
              message: 'Failed to pin memory',
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (error) {
        logger.error({ error, memoryId, userId: user.userId }, 'Failed to pin memory');
        throw error;
      }
    });
  });

  /**
   * DELETE /memories/:memoryId/pin - Unpin a memory
   */
  app.delete('/:memoryId/pin', async (request: FastifyRequest<{ Params: { memoryId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.unpin', async (span) => {
      const user = request.user!;
      const { memoryId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'memory.id': memoryId });

      const repo = getMemoriesRepository();

      try {
        // First, get the memory to verify ownership
        const memory = await repo.findById(memoryId);

        if (!memory || memory.user_id !== user.userId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Unpin the memory
        await repo.unpinMemory(memoryId);

        logger.info({ memoryId, userId: user.userId }, 'Memory unpinned');

        // Emit event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId: user.userId,
          sessionId: 'memory',
          turnId: null,
          traceId: request.id,
          type: 'memory.unpinned',
          payload: {
            memoryId,
            companionId: memory.companion_id,
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        // Get updated count
        const pinnedCount = await repo.getPinnedCount(user.userId, memory.companion_id);

        return reply.send({
          success: true,
          data: {
            memoryId,
            isPinned: false,
            pinnedCount,
            maxAllowed: 10,
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId: user.userId }, 'Failed to unpin memory');
        throw error;
      }
    });
  });

  /**
   * PUT /memories/pinned/:companionId/reorder - Reorder pinned memories
   */
  app.put('/pinned/:companionId/reorder', async (request: FastifyRequest<{ Params: { companionId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.pinned.reorder', async (span) => {
      const user = request.user!;
      const { companionId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'companion.id': companionId });

      const schema = z.object({
        memoryIds: z.array(z.string().uuid()).min(1).max(10),
      });

      const parseResult = schema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { memoryIds } = parseResult.data;
      const repo = getMemoriesRepository();

      try {
        await repo.reorderPinnedMemories(user.userId, companionId, memoryIds);

        logger.info(
          { userId: user.userId, companionId, count: memoryIds.length },
          'Pinned memories reordered'
        );

        return reply.send({
          success: true,
          data: {
            companionId,
            memoryIds,
            reorderedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId, companionId }, 'Failed to reorder pinned memories');
        throw error;
      }
    });
  });

  /**
   * GET /memories/pinned/:companionId/count - Get pinned memory count
   */
  app.get('/pinned/:companionId/count', async (request: FastifyRequest<{ Params: { companionId: string } }>, reply: FastifyReply) => {
    return withSpan('memories.pinned.count', async (span) => {
      const user = request.user!;
      const { companionId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'companion.id': companionId });

      const repo = getMemoriesRepository();

      try {
        const count = await repo.getPinnedCount(user.userId, companionId);

        return reply.send({
          success: true,
          data: {
            companionId,
            count,
            maxAllowed: 10,
            remaining: Math.max(0, 10 - count),
          },
        });
      } catch (error) {
        logger.error({ error, userId: user.userId, companionId }, 'Failed to get pinned count');
        throw error;
      }
    });
  });

  // ===========================================================================
  // Internal routes (for orchestrator service)
  // ===========================================================================

  const InternalCreateMemorySchema = z.object({
    userId: z.string().uuid(),
    companionId: z.string().uuid(),
    content: z.string().min(1).max(10000),
    contentType: z.enum(['fact', 'preference', 'event', 'summary', 'reflection']).default('fact'),
    importance: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    sourceTurnId: z.string().uuid().nullable().optional(),
  });

  const InternalSearchMemoriesSchema = z.object({
    userId: z.string().uuid(),
    companionId: z.string().uuid(),
    query: z.string().min(1).max(1000),
    contentTypes: z.array(z.enum(['fact', 'preference', 'event', 'summary', 'reflection'])).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    minImportance: z.number().min(0).max(1).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
  });

  const InternalUpdateMemorySchema = z.object({
    userId: z.string().uuid(),
    companionId: z.string().uuid(),
    content: z.string().min(1).max(10000).optional(),
    importance: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(),
  });

  /**
   * POST /memories/internal - Create memory (internal use by orchestrator)
   */
  app.post('/internal', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.create.internal', async (span) => {
      const parseResult = InternalCreateMemorySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { userId, companionId, content, contentType, importance, metadata, tags, sourceTurnId } = parseResult.data;
      const repo = getMemoriesRepository();

      try {
        // Generate embedding for the memory content
        let embedding: number[] | undefined;
        try {
          const embeddingService = getEmbeddingService();
          embedding = await embeddingService.generateEmbedding(content);
        } catch (embError) {
          logger.warn({ error: embError }, 'Failed to generate embedding for memory');
        }

        // Create the memory
        const memory = await repo.create({
          user_id: userId,
          companion_id: companionId,
          content,
          content_type: contentType,
          importance: importance ?? 0.5,
          metadata: metadata as Record<string, unknown>,
          embedding,
          source_turn_id: sourceTurnId ?? undefined,
        });

        logger.info(
          { memoryId: memory.id, userId, companionId, contentType },
          'Memory created via internal API'
        );

        // Emit event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId,
          sessionId: 'system',
          turnId: sourceTurnId ?? null,
          traceId: request.id,
          type: 'memory.created',
          payload: {
            memoryId: memory.id,
            companionId,
            contentType,
            contentLength: content.length,
            hasEmbedding: !!embedding,
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.status(201).send({
          success: true,
          data: {
            id: memory.id,
            userId,
            companionId,
            content: memory.content,
            contentType: memory.content_type,
            importance: memory.importance,
            createdAt: memory.created_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, userId, companionId }, 'Failed to create memory');
        throw error;
      }
    });
  });

  /**
   * POST /memories/internal/search - Search memories (internal use by orchestrator)
   */
  app.post('/internal/search', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.search.internal', async (span) => {
      const parseResult = InternalSearchMemoriesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { userId, companionId, query, contentTypes, limit, minImportance, minSimilarity } = parseResult.data;
      const repo = getMemoriesRepository();

      try {
        // Try vector search first if embedding service is available
        let memories: Awaited<ReturnType<typeof repo.searchByVector>> = [];

        try {
          const embeddingService = getEmbeddingService();
          const queryEmbedding = await embeddingService.generateEmbedding(query);

          memories = await repo.searchByVector({
            userId,
            companionId,
            embedding: queryEmbedding,
            limit: limit ?? 10,
            minSimilarity: minSimilarity ?? 0.5,
            contentTypes: contentTypes as Array<'fact' | 'preference' | 'event' | 'summary' | 'reflection'>,
            minImportance,
          });
        } catch (embError) {
          logger.warn({ error: embError }, 'Vector search failed, falling back to text search');

          // Fall back to text search
          const textResults = await repo.searchByText({
            userId,
            companionId,
            query,
            limit: limit ?? 10,
            contentTypes: contentTypes as Array<'fact' | 'preference' | 'event' | 'summary' | 'reflection'>,
          });

          memories = textResults.map(m => ({ ...m, similarity: 0.5 }));
        }

        // Record access for retrieved memories
        if (memories.length > 0) {
          await repo.recordAccessBatch(memories.map(m => m.id));
        }

        logger.debug(
          { userId, companionId, query: query.substring(0, 50), count: memories.length },
          'Memories searched via internal API'
        );

        return reply.send({
          success: true,
          data: {
            items: memories.map(m => ({
              id: m.id,
              content: m.content,
              content_type: m.content_type,
              importance: m.importance,
              similarity: 'similarity' in m ? m.similarity : undefined,
              created_at: m.created_at.toISOString(),
            })),
            query,
          },
        });
      } catch (error) {
        logger.error({ error, userId, companionId }, 'Failed to search memories');
        throw error;
      }
    });
  });

  /**
   * PATCH /memories/internal/:memoryId - Update memory (internal use by orchestrator)
   */
  app.patch('/internal/:memoryId', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.update.internal', async (span) => {
      const { memoryId } = request.params as { memoryId: string };
      span.setAttributes({ 'memory.id': memoryId });

      const parseResult = InternalUpdateMemorySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
          },
        });
      }

      const { userId, companionId, content, importance, tags } = parseResult.data;
      const repo = getMemoriesRepository();

      try {
        // Verify the memory exists and belongs to this user/companion
        const existing = await repo.findById(memoryId);
        if (!existing || existing.user_id !== userId || existing.companion_id !== companionId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
            },
          });
        }

        // Build update payload
        const updateData: Parameters<typeof repo.update>[1] = {};
        if (content !== undefined) updateData.content = content;
        if (importance !== undefined) updateData.importance = importance;

        const memory = await repo.update(memoryId, updateData);

        // Re-generate embedding if content changed
        if (content !== undefined) {
          try {
            const embeddingService = getEmbeddingService();
            const newEmbedding = await embeddingService.generateEmbedding(content);
            await repo.updateEmbedding(memoryId, newEmbedding);
          } catch (embError) {
            logger.warn({ error: embError, memoryId }, 'Failed to regenerate embedding after memory update');
          }
        }

        logger.info(
          { memoryId, userId, companionId, updatedFields: Object.keys(updateData) },
          'Memory updated via internal API'
        );

        // Emit event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId,
          sessionId: 'system',
          turnId: null,
          traceId: request.id,
          type: 'memory.updated',
          payload: {
            memoryId,
            companionId,
            updatedFields: Object.keys(updateData),
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.send({
          success: true,
          data: {
            id: memory.id,
            userId: memory.user_id,
            companionId: memory.companion_id,
            content: memory.content,
            contentType: memory.content_type,
            importance: memory.importance,
            updatedAt: memory.updated_at.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId, companionId }, 'Failed to update memory via internal API');
        throw error;
      }
    });
  });

  /**
   * DELETE /memories/internal/:memoryId - Soft-delete memory (internal use by orchestrator)
   */
  app.delete('/internal/:memoryId', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('memories.delete.internal', async (span) => {
      const { memoryId } = request.params as { memoryId: string };
      const { userId, companionId } = request.query as { userId?: string; companionId?: string };
      span.setAttributes({ 'memory.id': memoryId });

      if (!userId || !companionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'userId and companionId query parameters are required',
          },
        });
      }

      const repo = getMemoriesRepository();

      try {
        // Verify the memory exists and belongs to this user/companion
        const existing = await repo.findById(memoryId);
        if (!existing || existing.user_id !== userId || existing.companion_id !== companionId) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Memory not found',
            },
          });
        }

        // Soft-delete (sets status='deleted')
        await repo.delete(memoryId);

        logger.info(
          { memoryId, userId, companionId },
          'Memory soft-deleted via internal API'
        );

        // Emit event
        const eventStore = getEventStore();
        await eventStore.append({
          eventId: nanoid(),
          timestamp: new Date().toISOString(),
          userId,
          sessionId: 'system',
          turnId: null,
          traceId: request.id,
          type: 'memory.deleted',
          payload: {
            memoryId,
            companionId,
          },
          version: '1.0',
          causationId: null,
          correlationId: request.id,
        });

        return reply.send({
          success: true,
          data: {
            id: memoryId,
            deleted: true,
          },
        });
      } catch (error) {
        logger.error({ error, memoryId, userId, companionId }, 'Failed to delete memory via internal API');
        throw error;
      }
    });
  });
}
