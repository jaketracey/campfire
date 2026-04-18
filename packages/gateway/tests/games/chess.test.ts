/**
 * Chess engine tests. Pure function tests against chess.js-backed engine.
 */
import { describe, it, expect } from 'vitest';
import { ChessEngine } from '../../src/games/engines/chess.js';

describe('ChessEngine', () => {
  const engine = new ChessEngine();

  describe('initialState', () => {
    it('starts in the standard position', () => {
      const s = engine.initialState({});
      expect(s.fen).toMatch(/^rnbqkbnr/);
      expect(s.turn).toBe('white');
      expect(s.companionColor).toBe('black');
      expect(s.userColor).toBe('white');
      expect(s.inCheck).toBe(false);
    });

    it('assigns white to whoever plays first', () => {
      const compFirst = engine.initialState({ companionPlaysFirst: true });
      expect(compFirst.companionColor).toBe('white');
      expect(compFirst.userColor).toBe('black');
    });
  });

  describe('legalMoves', () => {
    it('returns 20 opening moves for white in the starting position', () => {
      const s = engine.initialState({});
      // User plays white when companionPlaysFirst is false.
      const moves = engine.legalMoves(s, 'user');
      expect(moves.length).toBe(20);
      expect(moves).toContain('e2e4');
      expect(moves).toContain('g1f3');
    });

    it('returns no moves for the off-turn side', () => {
      const s = engine.initialState({});
      // Companion is black; not their turn at game start.
      expect(engine.legalMoves(s, 'companion')).toHaveLength(0);
    });
  });

  describe('validateMove', () => {
    it('accepts UCI notation', () => {
      const s = engine.initialState({});
      expect(engine.validateMove(s, 'e2e4', 'user')).toEqual({ ok: true });
    });

    it('accepts SAN notation', () => {
      const s = engine.initialState({});
      expect(engine.validateMove(s, 'Nf3', 'user')).toEqual({ ok: true });
    });

    it('rejects illegal moves with a structured reason', () => {
      const s = engine.initialState({});
      const result = engine.validateMove(s, 'e2e5', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('Illegal move');
    });

    it('rejects garbage notation', () => {
      const s = engine.initialState({});
      expect(engine.validateMove(s, 'xyz', 'user').ok).toBe(false);
      expect(engine.validateMove(s, '', 'user').ok).toBe(false);
    });
  });

  describe('applyMove', () => {
    it('advances the position and toggles the turn', () => {
      const s0 = engine.initialState({});
      const s1 = engine.applyMove(s0, 'e2e4', 'user');
      expect(s1.turn).toBe('black');
      expect(s1.lastMove).toBe('e2e4');
      expect(s1.fen).not.toBe(s0.fen);
    });

    it('does not mutate the input state', () => {
      const s0 = engine.initialState({});
      const before = JSON.stringify(s0);
      engine.applyMove(s0, 'Nf3', 'user');
      expect(JSON.stringify(s0)).toBe(before);
    });
  });

  describe('terminalState', () => {
    it('returns null from the starting position', () => {
      const s = engine.initialState({});
      expect(engine.terminalState(s)).toBeNull();
    });

    it('detects Fool\'s Mate (shortest checkmate) as a loss for white', () => {
      // User is white, companion is black. Play 1. f3 e5 2. g4 Qh4# → black wins.
      let s = engine.initialState({});
      s = engine.applyMove(s, 'f2f3', 'user');
      s = engine.applyMove(s, 'e7e5', 'companion');
      s = engine.applyMove(s, 'g2g4', 'user');
      s = engine.applyMove(s, 'd8h4', 'companion');
      const terminal = engine.terminalState(s);
      expect(terminal).toEqual({ status: 'won', winner: 'companion' });
    });

    it('detects insufficient material as a draw', () => {
      // King + bishop vs king — unwinnable.
      const state = {
        fen: '8/8/8/4k3/8/8/8/3KB3 b - - 0 50',
        pgn: '',
        lastMove: null,
        turn: 'black' as const,
        inCheck: false,
        inCheckmate: false,
        inStalemate: false,
        companionColor: 'black' as const,
        userColor: 'white' as const,
      };
      const terminal = engine.terminalState(state);
      expect(terminal?.status).toBe('draw');
    });
  });

  describe('renderForLLM', () => {
    it('includes an ASCII board and legal-move hints', () => {
      const s = engine.initialState({});
      const out = engine.renderForLLM(s, 'user');
      expect(out).toMatch(/You play white/);
      expect(out).toContain('Legal moves');
      // chess.js ascii() has "a b c d e f g h" along an edge.
      expect(out).toMatch(/a\s+b\s+c/);
    });
  });

  describe('renderForClient', () => {
    it('returns chess-shaped DTO', () => {
      const s = engine.initialState({});
      const dto = engine.renderForClient(s) as { type: string; fen: string; turn: string };
      expect(dto.type).toBe('chess');
      expect(dto.fen).toMatch(/^rnbqkbnr/);
      expect(dto.turn).toBe('white');
    });
  });

  describe('formatMove', () => {
    it('describes a move in SAN for chat-friendly output', () => {
      const s = engine.initialState({});
      const desc = engine.formatMove('g1f3', 'user', s, engine.applyMove(s, 'g1f3', 'user'));
      expect(desc).toContain('Nf3');
    });
  });
});
