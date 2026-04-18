/**
 * GameService — the orchestration layer between engines and persistence.
 *
 * Responsibilities:
 *   - Validate authority (is this the right player's turn?)
 *   - Validate the move via the engine
 *   - Persist state with optimistic locking
 *   - Detect terminal state and finalize
 *   - Emit broadcast events (injected; wired to WebSocket in Phase 2)
 *
 * Consumers are internal route handlers (called by orchestrator) and — starting
 * in Phase 2 — the WebSocket handler for user-originated moves.
 */
import type {
  ActiveGame,
  GameMoveResult,
  GameStartResult,
  GameStateResult,
  GameType,
  Player,
} from '@campfire/shared';
import type { GameEngine } from './engine.js';
import type { GameSessionRow } from './repository.js';
import { gameRepository, GameRepository } from './repository.js';
import { getEngine } from './registry.js';
import {
  GameAlreadyActiveError,
  GameEndedError,
  GameNotFoundError,
  InvalidMoveError,
  NotYourTurnError,
  VersionConflictError,
} from './errors.js';

/**
 * Emit a game:state / game:over broadcast to interested clients. Phase 2 wires
 * this to the WS handler's per-session client set; in Phase 1 the default is
 * a no-op so the engine + persistence layer is independently testable.
 */
export interface GameBroadcaster {
  emitGameState(chatSessionId: string, game: ActiveGame, lastMove?: { player: Player; notation: string } | null): void;
  emitGameOver?(chatSessionId: string, game: ActiveGame): void;
}

const NOOP_BROADCASTER: GameBroadcaster = {
  emitGameState() {},
  emitGameOver() {},
};

export interface StartGameParams {
  chatSessionId: string;
  userId: string;
  companionId: string;
  gameType: GameType;
  companionPlaysFirst?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface ApplyMoveParams {
  gameSessionId: string;
  player: Player;
  move: string;
  /** Optional optimistic-lock check; omit to apply-against-latest. */
  clientVersion?: number;
}

export interface ResignParams {
  gameSessionId: string;
  player: Player;
  reason?: string;
}

export class GameService {
  private broadcaster: GameBroadcaster;

  constructor(
    private readonly repo: GameRepository = gameRepository,
    broadcaster: GameBroadcaster = NOOP_BROADCASTER,
  ) {
    this.broadcaster = broadcaster;
  }

  /** Swap in a live broadcaster once WS wiring exists (Phase 2). */
  setBroadcaster(b: GameBroadcaster): void {
    this.broadcaster = b;
  }

  async startGame(params: StartGameParams): Promise<GameStartResult> {
    // Enforce one active game per chat session. The DB has a partial unique
    // index as a safety net; we check first to return a clean error code.
    const existing = await this.repo.findActiveByChatSession(params.chatSessionId);
    if (existing) {
      throw new GameAlreadyActiveError(params.chatSessionId);
    }

    const engine = getEngine(params.gameType);
    const initialState = engine.initialState({
      companionPlaysFirst: params.companionPlaysFirst ?? false,
      difficulty: params.difficulty,
    });
    const [companionSymbol, userSymbol] = engine.getSymbols?.({
      companionPlaysFirst: params.companionPlaysFirst ?? false,
    }) ?? [null, null];

    const row = await this.repo.create({
      chatSessionId: params.chatSessionId,
      userId: params.userId,
      companionId: params.companionId,
      gameType: params.gameType,
      state: initialState as Record<string, unknown>,
      currentPlayer: params.companionPlaysFirst ? 'companion' : 'user',
      companionSymbol,
      userSymbol,
      difficulty: params.difficulty ?? null,
    });

    const game = this.rowToActiveGame(row, engine, []);
    const boardText = engine.renderForLLM(initialState, 'companion');
    const boardJson = engine.renderForClient(initialState);
    const message = `Started a new game of ${engine.displayName}.`;

    this.broadcaster.emitGameState(row.chatSessionId, game, null);
    return { game, boardText, boardJson, message };
  }

  async applyMove(params: ApplyMoveParams): Promise<GameMoveResult> {
    const current = await this.repo.findById(params.gameSessionId);
    if (!current) throw new GameNotFoundError(params.gameSessionId);
    if (current.status !== 'in_progress') throw new GameEndedError(current.status);

    if (current.currentPlayer !== params.player) {
      throw new NotYourTurnError(current.currentPlayer, params.player);
    }

    if (params.clientVersion !== undefined && params.clientVersion !== current.version) {
      throw new VersionConflictError(current.version, params.clientVersion);
    }

    const engine = getEngine(current.gameType);
    const validation = engine.validateMove(
      current.state as never,
      params.move,
      params.player,
    );
    if (!validation.ok) throw new InvalidMoveError(validation.reason);

    const nextState = engine.applyMove(
      current.state as never,
      params.move,
      params.player,
    );
    const terminal = engine.terminalState(nextState as never);
    const nextStatus = terminal?.status ?? 'in_progress';
    const nextPlayer = this.otherPlayer(params.player);
    const winner = terminal?.winner ?? null;

    const updated = await this.repo.applyMove({
      gameSessionId: current.id,
      expectedVersion: current.version,
      newState: nextState as Record<string, unknown>,
      newStatus: nextStatus,
      newCurrentPlayer: terminal ? current.currentPlayer : nextPlayer,
      winner,
      player: params.player,
      notation: params.move,
      seq: current.moveCount,
      endedAt: terminal ? new Date() : null,
    });

    if (!updated) {
      // Lost the race with a concurrent writer. Surface as conflict so caller
      // can refetch + retry.
      throw new VersionConflictError(current.version, current.version);
    }

    const moves = await this.repo.listMoves(updated.id);
    const game = this.rowToActiveGame(updated, engine, moves);
    const boardText = engine.renderForLLM(updated.state as never, 'companion');
    const boardJson = engine.renderForClient(updated.state as never);
    const message = engine.formatMove(
      params.move,
      params.player,
      current.state as never,
      updated.state as never,
    );

    this.broadcaster.emitGameState(updated.chatSessionId, game, {
      player: params.player,
      notation: params.move,
    });
    if (terminal) {
      this.broadcaster.emitGameOver?.(updated.chatSessionId, game);
    }

    return {
      game,
      boardText,
      boardJson,
      moveValid: true,
      errorMessage: null,
      gameOver: terminal !== null,
      winner,
      message,
    };
  }

  async resign(params: ResignParams): Promise<GameStateResult> {
    const current = await this.repo.findById(params.gameSessionId);
    if (!current) throw new GameNotFoundError(params.gameSessionId);
    if (current.status !== 'in_progress') throw new GameEndedError(current.status);

    const winner: Player = params.player === 'user' ? 'companion' : 'user';
    const ended = await this.repo.endGame(
      current.id,
      current.version,
      'resigned',
      winner,
    );
    if (!ended) throw new VersionConflictError(current.version, current.version);

    const engine = getEngine(ended.gameType);
    const moves = await this.repo.listMoves(ended.id);
    const game = this.rowToActiveGame(ended, engine, moves);

    this.broadcaster.emitGameOver?.(ended.chatSessionId, game);

    return {
      game,
      boardText: engine.renderForLLM(ended.state as never, 'companion'),
      boardJson: engine.renderForClient(ended.state as never),
      isUserTurn: ended.currentPlayer === 'user',
      availableMoves: [],
    };
  }

  async getGame(gameSessionId: string): Promise<GameStateResult> {
    const row = await this.repo.findById(gameSessionId);
    if (!row) throw new GameNotFoundError(gameSessionId);

    const engine = getEngine(row.gameType);
    const moves = await this.repo.listMoves(row.id);
    const game = this.rowToActiveGame(row, engine, moves);
    const boardText = engine.renderForLLM(row.state as never, 'companion');
    const boardJson = engine.renderForClient(row.state as never);
    const availableMoves =
      row.status === 'in_progress'
        ? (engine.legalMoves(row.state as never, row.currentPlayer) as string[])
        : [];

    return {
      game,
      boardText,
      boardJson,
      isUserTurn: row.currentPlayer === 'user' && row.status === 'in_progress',
      availableMoves,
    };
  }

  async getActiveGame(chatSessionId: string): Promise<GameStateResult | null> {
    const row = await this.repo.findActiveByChatSession(chatSessionId);
    if (!row) return null;
    return this.getGame(row.id);
  }

  /** Shape a DB row into the wire-format ActiveGame consumed by UI/LLM. */
  private rowToActiveGame(
    row: GameSessionRow,
    engine: GameEngine,
    moves: ReturnType<GameRepository['listMoves']> extends Promise<infer T> ? T : never,
  ): ActiveGame {
    const availableMoves =
      row.status === 'in_progress'
        ? (engine.legalMoves(row.state as never, row.currentPlayer) as string[])
        : [];
    const board = engine.renderForClient(row.state as never);
    return {
      id: row.id,
      gameType: row.gameType,
      board,
      currentPlayer: row.currentPlayer,
      status: row.status,
      moveHistory: moves,
      availableMoves,
      winner: row.winner,
      startedAt: row.startedAt.toISOString(),
      version: row.version,
      moveCount: row.moveCount,
      companionSymbol: row.companionSymbol,
      userSymbol: row.userSymbol,
      difficulty: row.difficulty,
    };
  }

  private otherPlayer(p: Player): Player {
    return p === 'user' ? 'companion' : 'user';
  }
}

export const gameService = new GameService();
