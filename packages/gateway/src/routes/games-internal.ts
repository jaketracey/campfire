/**
 * Internal games routes — called by the orchestrator (Python) to create,
 * advance, and query games on behalf of the companion. All endpoints require
 * the X-Internal-Service-Key header.
 *
 * User-originated moves arrive over WebSocket (see ws/handler.ts) and are
 * handled by the same `gameService` directly, not via HTTP.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireInternalService } from '../middleware/auth.js';
import { gameService } from '../games/service.js';
import { listGameTypes } from '../games/registry.js';
import { GameError } from '../games/errors.js';
import { logger } from '../observability/logger.js';

const GameTypeSchema = z.enum(['tic_tac_toe', 'chess', 'connect_four']);
const PlayerSchema = z.enum(['user', 'companion']);

const StartGameSchema = z.object({
  chatSessionId: z.string().uuid(),
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  gameType: GameTypeSchema,
  companionPlaysFirst: z.boolean().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

const ApplyMoveSchema = z.object({
  player: PlayerSchema,
  move: z.string().min(1).max(32),
  clientVersion: z.number().int().nonnegative().optional(),
});

const ResignSchema = z.object({
  player: PlayerSchema,
  reason: z.string().max(256).optional(),
});

function sendGameError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof GameError) {
    return reply.status(err.httpStatus).send({
      error: err.code,
      message: err.message,
    });
  }
  logger.error({ err }, 'Unexpected error in games internal route');
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
}

export async function gamesInternalRoutes(app: FastifyInstance): Promise<void> {
  /** GET /internal/games/types — list registered engines */
  app.get(
    '/internal/games/types',
    { preHandler: requireInternalService },
    async (_req, reply) => reply.send({ data: { types: listGameTypes() } }),
  );

  /** POST /internal/games — start a new game */
  app.post(
    '/internal/games',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = StartGameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        });
      }
      try {
        const result = await gameService.startGame(parsed.data);
        return reply.send({ data: result });
      } catch (e) {
        return sendGameError(reply, e);
      }
    },
  );

  /** GET /internal/games/:id — fetch a specific game */
  app.get(
    '/internal/games/:id',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await gameService.getGame(id);
        return reply.send({ data: result });
      } catch (e) {
        return sendGameError(reply, e);
      }
    },
  );

  /** GET /internal/chat-sessions/:chatSessionId/active-game — convenience */
  app.get(
    '/internal/chat-sessions/:chatSessionId/active-game',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatSessionId } = request.params as { chatSessionId: string };
      try {
        const result = await gameService.getActiveGame(chatSessionId);
        return reply.send({ data: result });
      } catch (e) {
        return sendGameError(reply, e);
      }
    },
  );

  /** POST /internal/games/:id/moves — apply a move */
  app.post(
    '/internal/games/:id/moves',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = ApplyMoveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        });
      }
      try {
        const result = await gameService.applyMove({
          gameSessionId: id,
          player: parsed.data.player,
          move: parsed.data.move,
          clientVersion: parsed.data.clientVersion,
        });
        return reply.send({ data: result });
      } catch (e) {
        return sendGameError(reply, e);
      }
    },
  );

  /** POST /internal/games/:id/resign — resign a game */
  app.post(
    '/internal/games/:id/resign',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = ResignSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        });
      }
      try {
        const result = await gameService.resign({
          gameSessionId: id,
          player: parsed.data.player,
          reason: parsed.data.reason,
        });
        return reply.send({ data: result });
      } catch (e) {
        return sendGameError(reply, e);
      }
    },
  );
}
