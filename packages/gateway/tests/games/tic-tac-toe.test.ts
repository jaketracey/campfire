/**
 * Engine-level tests for the tic-tac-toe implementation. Pure function tests;
 * no DB, no service, no network.
 */
import { describe, it, expect } from 'vitest';
import { TicTacToeEngine } from '../../src/games/engines/tic-tac-toe.js';

describe('TicTacToeEngine', () => {
  const engine = new TicTacToeEngine();

  describe('initialState', () => {
    it('starts with an empty 3x3 board', () => {
      const s = engine.initialState({});
      expect(s.board).toEqual([
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ]);
    });

    it('assigns X to whoever plays first', () => {
      const userFirst = engine.initialState({ companionPlaysFirst: false });
      expect(userFirst.userSymbol).toBe('X');
      expect(userFirst.companionSymbol).toBe('O');

      const companionFirst = engine.initialState({ companionPlaysFirst: true });
      expect(companionFirst.companionSymbol).toBe('X');
      expect(companionFirst.userSymbol).toBe('O');
    });
  });

  describe('legalMoves', () => {
    it('lists all 9 cells on an empty board', () => {
      const s = engine.initialState({});
      expect(engine.legalMoves(s, 'user')).toEqual(
        expect.arrayContaining(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']),
      );
      expect(engine.legalMoves(s, 'user')).toHaveLength(9);
    });

    it('excludes occupied cells', () => {
      const s = engine.initialState({});
      const s2 = engine.applyMove(s, 'B2', 'user');
      const moves = engine.legalMoves(s2, 'companion');
      expect(moves).not.toContain('B2');
      expect(moves).toHaveLength(8);
    });
  });

  describe('validateMove', () => {
    const s = engine.initialState({});

    it('rejects malformed notation', () => {
      expect(engine.validateMove(s, '', 'user')).toMatchObject({ ok: false });
      expect(engine.validateMove(s, 'D1', 'user')).toMatchObject({ ok: false });
      expect(engine.validateMove(s, 'A9', 'user')).toMatchObject({ ok: false });
      expect(engine.validateMove(s, 'AA', 'user')).toMatchObject({ ok: false });
    });

    it('accepts valid empty cells', () => {
      expect(engine.validateMove(s, 'A1', 'user')).toEqual({ ok: true });
      expect(engine.validateMove(s, 'B2', 'user')).toEqual({ ok: true });
    });

    it('rejects occupied cells', () => {
      const s2 = engine.applyMove(s, 'B2', 'user');
      expect(engine.validateMove(s2, 'B2', 'companion')).toMatchObject({ ok: false });
    });

    it('is case-insensitive for notation', () => {
      expect(engine.validateMove(s, 'a1', 'user')).toEqual({ ok: true });
    });
  });

  describe('applyMove', () => {
    it('writes the correct symbol based on player', () => {
      const s = engine.initialState({ companionPlaysFirst: false });
      const afterUser = engine.applyMove(s, 'A1', 'user');
      expect(afterUser.board[0]![0]).toBe('X');

      const afterCompanion = engine.applyMove(afterUser, 'B2', 'companion');
      expect(afterCompanion.board[1]![1]).toBe('O');
    });

    it('does not mutate the input state', () => {
      const s = engine.initialState({});
      const original = JSON.stringify(s);
      engine.applyMove(s, 'A1', 'user');
      expect(JSON.stringify(s)).toBe(original);
    });
  });

  describe('terminalState', () => {
    it('returns null on an empty board', () => {
      const s = engine.initialState({});
      expect(engine.terminalState(s)).toBeNull();
    });

    it('detects a row win for companion', () => {
      const s = engine.initialState({ companionPlaysFirst: true });
      // Companion is X; place X across top row
      let state = s;
      state = engine.applyMove(state, 'A1', 'companion');
      state = engine.applyMove(state, 'A2', 'user');
      state = engine.applyMove(state, 'B1', 'companion');
      state = engine.applyMove(state, 'B2', 'user');
      state = engine.applyMove(state, 'C1', 'companion');
      expect(engine.terminalState(state)).toEqual({ status: 'won', winner: 'companion' });
    });

    it('detects a diagonal win for user', () => {
      const s = engine.initialState({ companionPlaysFirst: false });
      // User is X; diagonal A1, B2, C3
      let state = s;
      state = engine.applyMove(state, 'A1', 'user');
      state = engine.applyMove(state, 'A2', 'companion');
      state = engine.applyMove(state, 'B2', 'user');
      state = engine.applyMove(state, 'A3', 'companion');
      state = engine.applyMove(state, 'C3', 'user');
      expect(engine.terminalState(state)).toEqual({ status: 'lost', winner: 'user' });
    });

    it('detects a draw on a full board with no winner', () => {
      // Construct a known draw:
      //  X O X
      //  X O O
      //  O X X
      const state = {
        board: [
          ['X', 'O', 'X'],
          ['X', 'O', 'O'],
          ['O', 'X', 'X'],
        ],
        companionSymbol: 'O' as const,
        userSymbol: 'X' as const,
      };
      expect(engine.terminalState(state)).toEqual({ status: 'draw', winner: null });
    });
  });

  describe('renderForLLM', () => {
    it('includes coordinate legend and legal-move hints', () => {
      const s = engine.initialState({});
      const out = engine.renderForLLM(s, 'companion');
      expect(out).toContain('A   B   C');
      expect(out).toContain('Legal moves:');
      expect(out).toMatch(/You play [XO]\./);
    });
  });

  describe('suggestMove', () => {
    it('prefers center when empty', () => {
      const s = engine.initialState({});
      expect(engine.suggestMove(s, 'companion')).toBe('B2');
    });

    it('falls back to legal moves when center taken', () => {
      const s = engine.initialState({});
      const s2 = engine.applyMove(s, 'B2', 'user');
      const suggestion = engine.suggestMove(s2, 'companion');
      expect(engine.legalMoves(s2, 'companion')).toContain(suggestion!);
      expect(suggestion).not.toBe('B2');
    });
  });
});
