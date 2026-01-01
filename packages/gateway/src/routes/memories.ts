/**
 * Memory Routes
 * Long-term memory management for user-companion relationships.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';

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
        limit = '50',
        offset = '0',
      } = request.query as {
        companionId?: string;
        contentType?: string;
        limit?: string;
        offset?: string;
      };

      // TODO: Implement via memory repository
      // - Query memories table
      // - Filter by companionId, contentType
      // - Paginate results

      logger.debug(
        { userId: user.userId, companionId, contentType, limit, offset },
        'Listing memories'
      );

      // Stub response
      return reply.send({
        success: true,
        data: {
          items: [],
          pagination: {
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10),
            total: 0,
            hasMore: false,
          },
        },
      });
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

      // TODO: Verify user has access to companion
      // TODO: Generate embedding for semantic search
      // TODO: Create memory via repository

      const memoryId = nanoid();
      logger.info(
        { memoryId, userId: user.userId, companionId, contentType },
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
          memoryId,
          companionId,
          contentType,
          contentLength: content.length,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      return reply.status(201).send({
        success: true,
        data: {
          id: memoryId,
          userId: user.userId,
          companionId,
          content,
          contentType,
          importance: importance ?? 0.5,
          metadata: metadata ?? {},
          expiresAt: expiresAt ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
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

      // TODO: Implement semantic search via memory repository
      // - Generate embedding for query
      // - Perform vector similarity search
      // - Apply filters and ranking

      logger.debug(
        { userId: user.userId, query: query.substring(0, 50), companionId },
        'Searching memories'
      );

      // Stub response
      return reply.send({
        success: true,
        data: {
          items: [],
          query,
        },
      });
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

      // TODO: Fetch memory from repository
      // TODO: Verify user ownership

      // Stub: Return not found for now
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Memory not found',
          timestamp: new Date().toISOString(),
        },
      });
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

      // TODO: Fetch memory from repository
      // TODO: Verify user ownership
      // TODO: Update memory
      // TODO: Re-generate embedding if content changed

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

      // Stub: Return not found for now
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Memory not found',
          timestamp: new Date().toISOString(),
        },
      });
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

      // TODO: Fetch memory from repository
      // TODO: Verify user ownership
      // TODO: Delete memory

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

      // Stub: Return not found for now
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Memory not found',
          timestamp: new Date().toISOString(),
        },
      });
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
}
