/**
 * Service-level tests with an in-memory fake repository. Exercises the
 * orchestration path (turn validation, terminal detection, version handling)
 * without touching Postgres.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Player } from '@campfire/shared';
import { GameService } from '../../src/games/service.js';
import type {
  ApplyMoveInput,
  CreateGameSessionInput,
  GameSessionRow,
} from '../../src/games/repository.js';
import type { GameRepository } from '../../src/games/repository.js';
import {
  GameAlreadyActiveError,
  GameEndedError,
  InvalidMoveError,
  NotYourTurnError,
  VersionConflictError,
} from '../../src/games/errors.js';

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `00000000-0000-0000-0000-${String(idSeq).padStart(12, '0')}`;
}

/**
 * In-memory fake that matches the GameRepository shape the service calls.
 * Only the methods used by GameService are implemented.
 */
function makeFakeRepo() {
  const rows = new Map<string, GameSessionRow>();
  const moves = new Map<string, Array<{ seq: number; player: Player; notation: string }>>();

  const fake = {
    async create(input: CreateGameSessionInput): Promise<GameSessionRow> {
      const now = new Date();
      const row: GameSessionRow = {
        id: nextId(),
        chatSessionId: input.chatSessionId,
        userId: input.userId,
        companionId: input.companionId,
        gameType: input.gameType,
        status: 'in_progress',
        currentPlayer: input.currentPlayer,
        winner: null,
        state: input.state,
        moveCount: 0,
        version: 0,
        companionSymbol: input.companionSymbol ?? null,
        userSymbol: input.userSymbol ?? null,
        difficulty: input.difficulty ?? null,
        metadata: {},
        startedAt: now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      moves.set(row.id, []);
      return row;
    },
    async findById(id: string): Promise<GameSessionRow | null> {
      return rows.get(id) ?? null;
    },
    async findActiveByChatSession(chatSessionId: string): Promise<GameSessionRow | null> {
      for (const r of rows.values()) {
        if (r.chatSessionId === chatSessionId && r.status === 'in_progress') return r;
      }
      return null;
    },
    async listByChatSession(chatSessionId: string): Promise<GameSessionRow[]> {
      return Array.from(rows.values()).filter(r => r.chatSessionId === chatSessionId);
    },
    async applyMove(input: ApplyMoveInput): Promise<GameSessionRow | null> {
      const r = rows.get(input.gameSessionId);
      if (!r || r.version !== input.expectedVersion) return null;
      const updated: GameSessionRow = {
        ...r,
        state: input.newState,
        status: input.newStatus,
        currentPlayer: input.newCurrentPlayer,
        winner: input.winner,
        moveCount: r.moveCount + 1,
        version: r.version + 1,
        endedAt: input.endedAt,
      };
      rows.set(r.id, updated);
      const hist = moves.get(r.id) ?? [];
      hist.push({ seq: input.seq, player: input.player, notation: input.notation });
      moves.set(r.id, hist);
      return updated;
    },
    async endGame(
      id: string,
      expectedVersion: number,
      status: GameSessionRow['status'],
      winner: Player | null,
    ): Promise<GameSessionRow | null> {
      const r = rows.get(id);
      if (!r || r.version !== expectedVersion) return null;
      const updated: GameSessionRow = {
        ...r,
        status,
        winner,
        version: r.version + 1,
        endedAt: new Date(),
      };
      rows.set(r.id, updated);
      return updated;
    },
    async listMoves(id: string) {
      const list = moves.get(id) ?? [];
      return list.map(m => ({
        player: m.player,
        notation: m.notation,
        timestamp: new Date().toISOString(),
      }));
    },
  };

  return { fake: fake as unknown as GameRepository, rows, moves };
}

describe('GameService', () => {
  const CHAT = '11111111-1111-1111-1111-111111111111';
  const USER = '22222222-2222-2222-2222-222222222222';
  const COMP = '33333333-3333-3333-3333-333333333333';

  let repo: ReturnType<typeof makeFakeRepo>;
  let service: GameService;
  let broadcaster: {
    emitGameState: ReturnType<typeof vi.fn>;
    emitGameOver: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = makeFakeRepo();
    broadcaster = {
      emitGameState: vi.fn(),
      emitGameOver: vi.fn(),
    };
    service = new GameService(repo.fake, broadcaster);
  });

  describe('startGame', () => {
    it('creates a new tic-tac-toe game with user playing first by default', async () => {
      const result = await service.startGame({
        chatSessionId: CHAT,
        userId: USER,
        companionId: COMP,
        gameType: 'tic_tac_toe',
      });
      expect(result.game.gameType).toBe('tic_tac_toe');
      expect(result.game.currentPlayer).toBe('user');
      expect(result.game.status).toBe('in_progress');
      expect(result.game.version).toBe(0);
      expect(result.game.availableMoves).toHaveLength(9);
      expect(broadcaster.emitGameState).toHaveBeenCalledOnce();
    });

    it('rejects a second active game in the same chat session', async () => {
      await service.startGame({
        chatSessionId: CHAT,
        userId: USER,
        companionId: COMP,
        gameType: 'tic_tac_toe',
      });
      await expect(
        service.startGame({
          chatSessionId: CHAT,
          userId: USER,
          companionId: COMP,
          gameType: 'tic_tac_toe',
        }),
      ).rejects.toBeInstanceOf(GameAlreadyActiveError);
    });
  });

  describe('applyMove', () => {
    async function startedGame() {
      const r = await service.startGame({
        chatSessionId: CHAT,
        userId: USER,
        companionId: COMP,
        gameType: 'tic_tac_toe',
      });
      return r.game;
    }

    it('applies a valid user move and toggles the current player', async () => {
      const game = await startedGame();
      const r = await service.applyMove({
        gameSessionId: game.id!,
        player: 'user',
        move: 'B2',
        clientVersion: 0,
      });
      expect(r.moveValid).toBe(true);
      expect(r.game.currentPlayer).toBe('companion');
      expect(r.game.version).toBe(1);
      expect(r.game.moveHistory).toHaveLength(1);
      expect(r.game.moveHistory[0]!.notation).toBe('B2');
    });

    it('rejects a move from the wrong player', async () => {
      const game = await startedGame();
      await expect(
        service.applyMove({
          gameSessionId: game.id!,
          player: 'companion',
          move: 'B2',
          clientVersion: 0,
        }),
      ).rejects.toBeInstanceOf(NotYourTurnError);
    });

    it('rejects a move with a stale clientVersion', async () => {
      const game = await startedGame();
      await service.applyMove({
        gameSessionId: game.id!,
        player: 'user',
        move: 'B2',
        clientVersion: 0,
      });
      // Second move: now v=1, but client thinks v=0.
      await expect(
        service.applyMove({
          gameSessionId: game.id!,
          player: 'companion',
          move: 'A1',
          clientVersion: 0,
        }),
      ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it('rejects an invalid move format', async () => {
      const game = await startedGame();
      await expect(
        service.applyMove({
          gameSessionId: game.id!,
          player: 'user',
          move: 'ZZ',
        }),
      ).rejects.toBeInstanceOf(InvalidMoveError);
    });

    it('finalizes the game when a winning move is applied', async () => {
      // User is X, user plays first. Play A1, A2, B1, B2, C1 → user wins via B1/A1/C1? Actually a row needs three in same row. Let's use top row: A1, ..., B1, ..., C1 — no wait, "row 1" means all three cells in row 1 which are A1, B1, C1.
      const game = await startedGame();
      const id = game.id!;
      await service.applyMove({ gameSessionId: id, player: 'user', move: 'A1', clientVersion: 0 });
      await service.applyMove({ gameSessionId: id, player: 'companion', move: 'A2', clientVersion: 1 });
      await service.applyMove({ gameSessionId: id, player: 'user', move: 'B1', clientVersion: 2 });
      await service.applyMove({ gameSessionId: id, player: 'companion', move: 'A3', clientVersion: 3 });
      const final = await service.applyMove({
        gameSessionId: id,
        player: 'user',
        move: 'C1',
        clientVersion: 4,
      });
      expect(final.gameOver).toBe(true);
      expect(final.winner).toBe('user');
      expect(final.game.status).toBe('lost'); // companion-centric naming
      expect(broadcaster.emitGameOver).toHaveBeenCalledOnce();
    });

    it('rejects moves against an ended game', async () => {
      const game = await startedGame();
      const id = game.id!;
      // Simulate game end via resign.
      await service.resign({ gameSessionId: id, player: 'user' });
      await expect(
        service.applyMove({
          gameSessionId: id,
          player: 'companion',
          move: 'A1',
        }),
      ).rejects.toBeInstanceOf(GameEndedError);
    });
  });

  describe('resign', () => {
    it('marks the game resigned with the other player as winner', async () => {
      const r = await service.startGame({
        chatSessionId: CHAT,
        userId: USER,
        companionId: COMP,
        gameType: 'tic_tac_toe',
      });
      const resigned = await service.resign({
        gameSessionId: r.game.id!,
        player: 'user',
      });
      expect(resigned.game.status).toBe('resigned');
      expect(resigned.game.winner).toBe('companion');
      expect(broadcaster.emitGameOver).toHaveBeenCalledOnce();
    });
  });
});
