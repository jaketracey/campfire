/**
 * WebSocket payload schemas for the games framework.
 *
 * Events:
 *
 *   Client → Server
 *     - start_game      { gameType, companionPlaysFirst?, difficulty? }
 *     - user_game_move  { move, gameId?, clientVersion? }
 *     - resign_game     { gameId? }
 *
 *   Server → Client
 *     - game_update            { activeGame, lastMove? }           // broadcast on every change
 *     - game_move_rejected     { gameId, reason, code }
 *     - game_companion_thinking{ gameId, thinking: boolean }
 *     - game_over              { activeGame, winner, reason? }
 *
 * Keeping `game_update` stable preserves backwards compatibility with legacy
 * clients; new clients may additionally subscribe to `game_over` /
 * `game_move_rejected` / `game_companion_thinking`.
 */
import { z } from 'zod';

export const GameTypeSchema = z.enum(['tic_tac_toe', 'chess', 'connect_four']);
export const PlayerSchema = z.enum(['user', 'companion']);
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);

// ---------- Client → Server ----------

export const StartGameWSSchema = z.object({
  gameType: GameTypeSchema,
  companionPlaysFirst: z.boolean().optional(),
  difficulty: DifficultySchema.optional(),
});
export type StartGameWSPayload = z.infer<typeof StartGameWSSchema>;

export const UserGameMoveWSSchema = z.object({
  move: z.string().min(1).max(32),
  gameId: z.string().uuid().optional(),
  clientVersion: z.number().int().nonnegative().optional(),
});
export type UserGameMoveWSPayload = z.infer<typeof UserGameMoveWSSchema>;

export const ResignGameWSSchema = z.object({
  gameId: z.string().uuid().optional(),
});
export type ResignGameWSPayload = z.infer<typeof ResignGameWSSchema>;

// ---------- Server → Client ----------

/**
 * `game_update` preserves the legacy `{ activeGame }` shape. `lastMove` is a
 * new optional field; older clients ignore it.
 */
export const GameUpdateWSSchema = z.object({
  activeGame: z.record(z.unknown()).nullable(),
  lastMove: z
    .object({
      player: PlayerSchema,
      notation: z.string(),
    })
    .nullable()
    .optional(),
});
export type GameUpdateWSPayload = z.infer<typeof GameUpdateWSSchema>;

export const GameMoveRejectedWSSchema = z.object({
  gameId: z.string().uuid().nullable().optional(),
  code: z.string(),
  reason: z.string(),
});
export type GameMoveRejectedWSPayload = z.infer<typeof GameMoveRejectedWSSchema>;

export const GameCompanionThinkingWSSchema = z.object({
  gameId: z.string().uuid(),
  thinking: z.boolean(),
});
export type GameCompanionThinkingWSPayload = z.infer<typeof GameCompanionThinkingWSSchema>;

export const GameOverWSSchema = z.object({
  activeGame: z.record(z.unknown()),
  winner: PlayerSchema.nullable(),
  reason: z.string().optional(),
});
export type GameOverWSPayload = z.infer<typeof GameOverWSSchema>;

/**
 * WS event-name tokens. Keep in sync with the gateway handler's `WSMessageType`
 * union and the web client's event map.
 */
export const GAME_WS_EVENTS = {
  // Client → Server
  START_GAME: 'start_game',
  USER_GAME_MOVE: 'user_game_move',
  RESIGN_GAME: 'resign_game',
  // Server → Client
  GAME_UPDATE: 'game_update',
  GAME_MOVE_REJECTED: 'game_move_rejected',
  GAME_COMPANION_THINKING: 'game_companion_thinking',
  GAME_OVER: 'game_over',
} as const;
