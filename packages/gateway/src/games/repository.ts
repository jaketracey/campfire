/**
 * GameRepository — raw DB access for `game_sessions` and `game_moves`.
 * No engine logic here; the service layer composes repository calls with
 * engine calls and broadcast.
 */
import type postgres from 'postgres';
import { sql } from '../db/pool.js';
import type { TransactionContext } from '../repositories/types.js';
import { wrapDatabaseError } from '../repositories/errors.js';
import type { GameType, GameStatus, Player, GameMove } from '@campfire/shared';

export interface GameSessionRow {
  id: string;
  chatSessionId: string;
  userId: string;
  companionId: string;
  gameType: GameType;
  status: GameStatus;
  currentPlayer: Player;
  winner: Player | null;
  state: Record<string, unknown>;
  moveCount: number;
  version: number;
  companionSymbol: string | null;
  userSymbol: string | null;
  difficulty: string | null;
  metadata: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGameSessionInput {
  chatSessionId: string;
  userId: string;
  companionId: string;
  gameType: GameType;
  state: Record<string, unknown>;
  currentPlayer: Player;
  companionSymbol?: string | null;
  userSymbol?: string | null;
  difficulty?: string | null;
}

export interface ApplyMoveInput {
  gameSessionId: string;
  expectedVersion: number;
  newState: Record<string, unknown>;
  newStatus: GameStatus;
  newCurrentPlayer: Player;
  winner: Player | null;
  player: Player;
  notation: string;
  seq: number;
  endedAt: Date | null;
}

export class GameRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  async create(
    input: CreateGameSessionInput,
    tx?: TransactionContext,
  ): Promise<GameSessionRow> {
    const db = this.getSql(tx);
    try {
      const rows = await db<GameSessionRow[]>`
        INSERT INTO game_sessions (
          chat_session_id, user_id, companion_id, game_type,
          state, current_player, companion_symbol, user_symbol, difficulty
        ) VALUES (
          ${input.chatSessionId}, ${input.userId}, ${input.companionId}, ${input.gameType},
          ${db.json(input.state as postgres.JSONValue)}, ${input.currentPlayer},
          ${input.companionSymbol ?? null}, ${input.userSymbol ?? null}, ${input.difficulty ?? null}
        )
        RETURNING
          id, chat_session_id AS "chatSessionId", user_id AS "userId",
          companion_id AS "companionId", game_type AS "gameType", status,
          current_player AS "currentPlayer", winner, state,
          move_count AS "moveCount", version,
          companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
          difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      return rows[0]!;
    } catch (e) {
      throw wrapDatabaseError(e, 'game_sessions.create');
    }
  }

  async findById(id: string, tx?: TransactionContext): Promise<GameSessionRow | null> {
    const db = this.getSql(tx);
    const rows = await db<GameSessionRow[]>`
      SELECT
        id, chat_session_id AS "chatSessionId", user_id AS "userId",
        companion_id AS "companionId", game_type AS "gameType", status,
        current_player AS "currentPlayer", winner, state,
        move_count AS "moveCount", version,
        companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
        difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM game_sessions
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async findActiveByChatSession(
    chatSessionId: string,
    tx?: TransactionContext,
  ): Promise<GameSessionRow | null> {
    const db = this.getSql(tx);
    const rows = await db<GameSessionRow[]>`
      SELECT
        id, chat_session_id AS "chatSessionId", user_id AS "userId",
        companion_id AS "companionId", game_type AS "gameType", status,
        current_player AS "currentPlayer", winner, state,
        move_count AS "moveCount", version,
        companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
        difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM game_sessions
      WHERE chat_session_id = ${chatSessionId} AND status = 'in_progress'
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async listByChatSession(
    chatSessionId: string,
    tx?: TransactionContext,
  ): Promise<GameSessionRow[]> {
    const db = this.getSql(tx);
    return db<GameSessionRow[]>`
      SELECT
        id, chat_session_id AS "chatSessionId", user_id AS "userId",
        companion_id AS "companionId", game_type AS "gameType", status,
        current_player AS "currentPlayer", winner, state,
        move_count AS "moveCount", version,
        companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
        difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM game_sessions
      WHERE chat_session_id = ${chatSessionId}
      ORDER BY started_at DESC
    `;
  }

  /**
   * Apply a move inside a transaction with optimistic locking. Returns the
   * updated row if the version matched, or `null` if a concurrent writer
   * already advanced the version (caller should retry or surface
   * VersionConflictError).
   */
  async applyMove(input: ApplyMoveInput): Promise<GameSessionRow | null> {
    try {
      return await sql().begin(async (tx) => {
        const updated = await tx<GameSessionRow[]>`
          UPDATE game_sessions
          SET
            state = ${tx.json(input.newState as postgres.JSONValue)},
            status = ${input.newStatus},
            current_player = ${input.newCurrentPlayer},
            winner = ${input.winner},
            move_count = move_count + 1,
            version = version + 1,
            ended_at = ${input.endedAt}
          WHERE id = ${input.gameSessionId} AND version = ${input.expectedVersion}
          RETURNING
            id, chat_session_id AS "chatSessionId", user_id AS "userId",
            companion_id AS "companionId", game_type AS "gameType", status,
            current_player AS "currentPlayer", winner, state,
            move_count AS "moveCount", version,
            companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
            difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
        `;
        if (updated.length === 0) return null;

        await tx`
          INSERT INTO game_moves (game_session_id, seq, player, notation, state_after)
          VALUES (
            ${input.gameSessionId}, ${input.seq}, ${input.player},
            ${input.notation}, ${tx.json(input.newState as postgres.JSONValue)}
          )
        `;
        return updated[0]!;
      });
    } catch (e) {
      throw wrapDatabaseError(e, 'game_sessions.applyMove');
    }
  }

  /**
   * End a game without applying a move (resignation / forfeit). Also takes the
   * optimistic lock to avoid racing against a pending move.
   */
  async endGame(
    gameSessionId: string,
    expectedVersion: number,
    status: GameStatus,
    winner: Player | null,
  ): Promise<GameSessionRow | null> {
    try {
      const rows = await sql()<GameSessionRow[]>`
        UPDATE game_sessions
        SET
          status = ${status},
          winner = ${winner},
          version = version + 1,
          ended_at = NOW()
        WHERE id = ${gameSessionId} AND version = ${expectedVersion}
        RETURNING
          id, chat_session_id AS "chatSessionId", user_id AS "userId",
          companion_id AS "companionId", game_type AS "gameType", status,
          current_player AS "currentPlayer", winner, state,
          move_count AS "moveCount", version,
          companion_symbol AS "companionSymbol", user_symbol AS "userSymbol",
          difficulty, metadata, started_at AS "startedAt", ended_at AS "endedAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      return rows[0] ?? null;
    } catch (e) {
      throw wrapDatabaseError(e, 'game_sessions.endGame');
    }
  }

  async listMoves(gameSessionId: string, tx?: TransactionContext): Promise<GameMove[]> {
    const db = this.getSql(tx);
    const rows = await db<
      Array<{ player: Player; notation: string; createdAt: Date }>
    >`
      SELECT player, notation, created_at AS "createdAt"
      FROM game_moves
      WHERE game_session_id = ${gameSessionId}
      ORDER BY seq ASC
    `;
    return rows.map((r) => ({
      player: r.player,
      notation: r.notation,
      timestamp: r.createdAt.toISOString(),
    }));
  }
}

export const gameRepository = new GameRepository();
