/**
 * Session Routes
 * Conversation session management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { logger } from '../observability/logger.js';

// Request schemas
const CreateSessionSchema = z.object({
  companionId: z.string().uuid(),
  title: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateSessionSchema = z.object({
  title: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const SendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Register session routes
 */
export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  const sessionRepo = getSessionsRepository();
  const companionRepo = getCompanionsRepository();

  /**
   * GET /sessions - List user's sessions
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      limit = '50',
      offset = '0',
      companionId,
      status,
    } = request.query as {
      limit?: string;
      offset?: string;
      companionId?: string;
      status?: string;
    };

    const result = await sessionRepo.list({
      userId: request.user!.userId,
      companionId,
      status: status as 'active' | 'paused' | 'ended' | undefined,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      sessions: result.data.map((s) => ({
        id: s.id,
        companionId: s.companion_id,
        status: s.status,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        turnCount: s.turn_count,
        lastActivityAt: s.last_activity_at,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  /**
   * POST /sessions - Create new session
   */
  app.post('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateSessionSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    // Verify companion exists and user has access
    const companion = await companionRepo.findById(parseResult.data.companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Check if companion belongs to user
    if (companion.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this companion',
      });
    }

    // Check if companion is active
    if (companion.status !== 'active') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Companion is not active',
      });
    }

    const session = await sessionRepo.create({
      user_id: request.user!.userId,
      companion_id: parseResult.data.companionId,
      metadata: (parseResult.data.metadata ?? {}) as Record<string, unknown>,
    });

    logger.info(
      { sessionId: session.id, companionId: parseResult.data.companionId, userId: request.user!.userId },
      'Session created'
    );

    return reply.status(201).send({
      id: session.id,
      companionId: session.companion_id,
      status: session.status,
      startedAt: session.started_at,
    });
  });

  /**
   * GET /sessions/:sessionId - Get session by ID
   */
  app.get('/:sessionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

    if (session.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    }

    return reply.send({
      id: session.id,
      companionId: session.companion_id,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      turnCount: session.turn_count,
      lastActivityAt: session.last_activity_at,
      metadata: session.metadata,
    });
  });

  /**
   * POST /sessions/:sessionId/end - End a session
   */
  app.post('/:sessionId/end', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

    if (session.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    }

    if (session.status === 'ended') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Session is already ended',
      });
    }

    const ended = await sessionRepo.end(sessionId);

    logger.info({ sessionId, userId: request.user!.userId }, 'Session ended');

    return reply.send({
      id: ended.id,
      status: ended.status,
      endedAt: ended.ended_at,
    });
  });

  /**
   * GET /sessions/:sessionId/turns - Get session turns (messages)
   */
  app.get('/:sessionId/turns', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { limit = '100', offset = '0' } = request.query as { limit?: string; offset?: string };

    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

    if (session.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    }

    const result = await sessionRepo.listTurns({
      sessionId,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      turns: result.data.map((t) => ({
        id: t.id,
        turnNumber: t.turn_number,
        userMessage: t.user_message,
        agentMessage: t.agent_message,
        createdAt: t.created_at,
        latencyMs: t.latency_ms,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  /**
   * POST /sessions/:sessionId/message - Send a message (non-streaming)
   */
  app.post('/:sessionId/message', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const parseResult = SendMessageSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

    if (session.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    }

    if (session.status === 'ended') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Cannot send messages to ended session',
      });
    }

    // Get next turn number
    const turnNumber = await sessionRepo.getNextTurnNumber(sessionId);

    // TODO: Forward to orchestrator for real response
    // For now, return a placeholder response
    const turn = await sessionRepo.createTurn({
      session_id: sessionId,
      turn_number: turnNumber,
      user_message: parseResult.data.content,
      user_message_type: 'text',
      agent_message: 'This is a placeholder response. Use WebSocket for real-time chat.',
      agent_message_type: 'text',
    });

    return reply.send({
      turnId: turn.id,
      turnNumber: turn.turn_number,
      userMessage: turn.user_message,
      agentMessage: turn.agent_message,
      createdAt: turn.created_at,
    });
  });

  /**
   * DELETE /sessions/:sessionId - Delete session
   */
  app.delete('/:sessionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionRepo.findById(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Session not found',
      });
    }

    if (session.user_id !== request.user!.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    }

    await sessionRepo.delete(sessionId);

    logger.info({ sessionId, userId: request.user!.userId }, 'Session deleted');

    return reply.status(204).send();
  });
}
