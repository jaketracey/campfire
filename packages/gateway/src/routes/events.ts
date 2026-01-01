/**
 * Event Routes
 * Event stream access for debugging and audit purposes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getEventStore } from '../db/event-store.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';

/**
 * Query parameters schema
 */
const EventQuerySchema = z.object({
  sessionId: z.string().optional(),
  types: z.string().optional(), // Comma-separated event types
  afterSequence: z.string().optional(), // BigInt as string
  fromTimestamp: z.string().datetime({ offset: true }).optional(),
  toTimestamp: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

/**
 * Register event routes
 */
export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  const eventStore = getEventStore();

  /**
   * GET /events - List events for current user
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('events.list', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Parse query parameters
      const parseResult = EventQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const {
        sessionId,
        types,
        afterSequence,
        fromTimestamp,
        toTimestamp,
        limit = 100,
        order = 'desc',
      } = parseResult.data;

      // Query events for this user
      const events = await eventStore.query({
        userId: user.userId,
        sessionId,
        types: types?.split(',').map((t) => t.trim()),
        afterSequence: afterSequence ? BigInt(afterSequence) : undefined,
        fromTimestamp: fromTimestamp ? new Date(fromTimestamp) : undefined,
        toTimestamp: toTimestamp ? new Date(toTimestamp) : undefined,
        limit,
        order,
      });

      logger.debug(
        { userId: user.userId, count: events.length, sessionId, types },
        'Events queried'
      );

      return reply.send({
        success: true,
        data: {
          items: events.map((e) => ({
            eventId: e.eventId,
            timestamp: e.timestamp,
            sessionId: e.sessionId,
            turnId: e.turnId,
            type: e.type,
            payload: e.payload,
            version: e.version,
            sequenceNumber: e.sequenceNumber.toString(),
          })),
          pagination: {
            limit,
            order,
            hasMore: events.length === limit,
            lastSequence: events.length > 0 ? events[events.length - 1]!.sequenceNumber.toString() : null,
          },
        },
      });
    });
  });

  /**
   * GET /events/:eventId - Get a specific event
   */
  app.get('/:eventId', { preHandler: requireAuth }, async (request: FastifyRequest<{ Params: { eventId: string } }>, reply: FastifyReply) => {
    return withSpan('events.get', async (span) => {
      const user = request.user!;
      const { eventId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'event.id': eventId });

      const event = await eventStore.getById(eventId);

      if (!event) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Event not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify user owns this event
      if (event.userId !== user.userId) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this event',
            timestamp: new Date().toISOString(),
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          eventId: event.eventId,
          timestamp: event.timestamp,
          userId: event.userId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          traceId: event.traceId,
          type: event.type,
          payload: event.payload,
          version: event.version,
          causationId: event.causationId,
          correlationId: event.correlationId,
          cost: event.cost,
          sequenceNumber: event.sequenceNumber.toString(),
          storedAt: event.storedAt.toISOString(),
        },
      });
    });
  });

  /**
   * GET /events/session/:sessionId - Get all events for a session
   */
  app.get('/session/:sessionId', { preHandler: requireAuth }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    return withSpan('events.listBySession', async (span) => {
      const user = request.user!;
      const { sessionId } = request.params;
      span.setAttributes({ 'user.id': user.userId, 'session.id': sessionId });

      const { limit = '1000', order = 'asc' } = request.query as { limit?: string; order?: string };

      // Query events for this session
      const events = await eventStore.query({
        userId: user.userId,
        sessionId,
        limit: parseInt(limit, 10),
        order: order as 'asc' | 'desc',
      });

      return reply.send({
        success: true,
        data: {
          sessionId,
          items: events.map((e) => ({
            eventId: e.eventId,
            timestamp: e.timestamp,
            turnId: e.turnId,
            type: e.type,
            payload: e.payload,
            sequenceNumber: e.sequenceNumber.toString(),
          })),
          count: events.length,
        },
      });
    });
  });

  /**
   * GET /events/stats - Get event statistics (admin only)
   */
  app.get('/stats', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('events.stats', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Get latest sequence number
      const latestSequence = await eventStore.getLatestSequence();

      // Get count for different time windows
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [totalCount, dayCount, weekCount] = await Promise.all([
        eventStore.count(),
        eventStore.count({ fromTimestamp: oneDayAgo }),
        eventStore.count({ fromTimestamp: oneWeekAgo }),
      ]);

      logger.debug({ totalCount, dayCount, weekCount }, 'Event stats queried');

      return reply.send({
        success: true,
        data: {
          latestSequence: latestSequence.toString(),
          counts: {
            total: totalCount,
            last24h: dayCount,
            last7d: weekCount,
          },
          timestamp: now.toISOString(),
        },
      });
    });
  });

  /**
   * POST /events/replay - Replay events (admin only, for projections)
   */
  app.post('/replay', { preHandler: requireAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('events.replay', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const schema = z.object({
        fromSequence: z.string().optional(),
        toSequence: z.string().optional(),
        types: z.array(z.string()).optional(),
        targetService: z.string().min(1),
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

      const { fromSequence, toSequence, types, targetService } = parseResult.data;

      logger.warn(
        { fromSequence, toSequence, types, targetService, requestedBy: user.userId },
        'Event replay requested'
      );

      // TODO: Implement event replay mechanism
      // - Query events in range
      // - Re-publish to target service/queue

      return reply.status(202).send({
        success: true,
        data: {
          message: 'Event replay initiated',
          fromSequence,
          toSequence,
          types,
          targetService,
        },
      });
    });
  });
}
