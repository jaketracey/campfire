/**
 * Connect Four engine tests.
 */
import { describe, it, expect } from 'vitest';
import { ConnectFourEngine } from '../../src/games/engines/connect-four.js';

describe('ConnectFourEngine', () => {
  const engine = new ConnectFourEngine();

  describe('initialState', () => {
    it('is a 6x7 grid of zeros', () => {
      const s = engine.initialState({});
      expect(s.board).toHaveLength(6);
      expect(s.board.every((row) => row.length === 7 && row.every((c) => c === 0))).toBe(true);
    });
  });

  describe('legalMoves', () => {
    it('lists columns 1-7 on an empty board', () => {
      const s = engine.initialState({});
      expect(engine.legalMoves(s, 'user')).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('omits a full column', () => {
      let s = engine.initialState({});
      for (let i = 0; i < 6; i++) {
        s = engine.applyMove(s, '4', i % 2 === 0 ? 'user' : 'companion');
      }
      expect(engine.legalMoves(s, 'user')).not.toContain('4');
    });
  });

  describe('validateMove', () => {
    it('rejects out-of-range columns', () => {
      const s = engine.initialState({});
      expect(engine.validateMove(s, '0', 'user').ok).toBe(false);
      expect(engine.validateMove(s, '8', 'user').ok).toBe(false);
      expect(engine.validateMove(s, 'a', 'user').ok).toBe(false);
    });

    it('rejects a full column', () => {
      let s = engine.initialState({});
      for (let i = 0; i < 6; i++) {
        s = engine.applyMove(s, '1', i % 2 === 0 ? 'user' : 'companion');
      }
      const result = engine.validateMove(s, '1', 'user');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/full/i);
    });
  });

  describe('applyMove', () => {
    it('stacks tokens from the bottom up', () => {
      const s0 = engine.initialState({});
      const s1 = engine.applyMove(s0, '4', 'user');
      expect(s1.board[5]![3]).toBe(1); // bottom row, col index 3 (0-indexed for col '4')
      const s2 = engine.applyMove(s1, '4', 'companion');
      expect(s2.board[4]![3]).toBe(2);
    });

    it('does not mutate the input state', () => {
      const s = engine.initialState({});
      const before = JSON.stringify(s);
      engine.applyMove(s, '1', 'user');
      expect(JSON.stringify(s)).toBe(before);
    });
  });

  describe('terminalState', () => {
    it('returns null on an empty board', () => {
      expect(engine.terminalState(engine.initialState({}))).toBeNull();
    });

    it('detects a horizontal win for companion', () => {
      let s = engine.initialState({});
      // Companion wins with 4-in-a-row in bottom row, cols 1-4.
      s = engine.applyMove(s, '1', 'companion');
      s = engine.applyMove(s, '1', 'user');
      s = engine.applyMove(s, '2', 'companion');
      s = engine.applyMove(s, '2', 'user');
      s = engine.applyMove(s, '3', 'companion');
      s = engine.applyMove(s, '3', 'user');
      s = engine.applyMove(s, '4', 'companion');
      expect(engine.terminalState(s)).toEqual({ status: 'won', winner: 'companion' });
    });

    it('detects a vertical win for user', () => {
      let s = engine.initialState({});
      // User stacks four in column 2.
      s = engine.applyMove(s, '2', 'user');
      s = engine.applyMove(s, '3', 'companion');
      s = engine.applyMove(s, '2', 'user');
      s = engine.applyMove(s, '3', 'companion');
      s = engine.applyMove(s, '2', 'user');
      s = engine.applyMove(s, '3', 'companion');
      s = engine.applyMove(s, '2', 'user');
      expect(engine.terminalState(s)).toEqual({ status: 'lost', winner: 'user' });
    });

    it('detects a diagonal win', () => {
      let s = engine.initialState({});
      // Build a ↘ diagonal for companion at cols 1-4, rows 5..2.
      // Column plays:
      //   1 (companion row 5)
      //   2 (user row 5), 2 (companion row 4)
      //   3 (user row 5), 3 (user row 4), 3 (companion row 3)
      //   4 (user row 5), 4 (user row 4), 4 (user row 3), 4 (companion row 2)
      s = engine.applyMove(s, '1', 'companion');
      s = engine.applyMove(s, '2', 'user');
      s = engine.applyMove(s, '2', 'companion');
      s = engine.applyMove(s, '3', 'user');
      s = engine.applyMove(s, '3', 'user');
      s = engine.applyMove(s, '3', 'companion');
      s = engine.applyMove(s, '4', 'user');
      s = engine.applyMove(s, '4', 'user');
      s = engine.applyMove(s, '4', 'user');
      s = engine.applyMove(s, '4', 'companion');
      expect(engine.terminalState(s)).toEqual({ status: 'won', winner: 'companion' });
    });

    it('detects a full-board draw', () => {
      // A verified draw position: staircase pattern that avoids any 4-in-a-row.
      // (True draws are rare in 6x7 Connect Four — this one is constructed by
      // computer, double-checked to contain no horizontal / vertical / diagonal
      // four-runs for either token.)
      const board = [
        [1, 2, 2, 1, 1, 2, 2],
        [2, 1, 1, 2, 2, 1, 1],
        [1, 2, 2, 1, 1, 2, 2],
        [2, 1, 1, 2, 2, 1, 1],
        [1, 2, 2, 1, 1, 2, 2],
        [2, 1, 1, 2, 2, 1, 1],
      ];
      expect(engine.terminalState({ board })).toEqual({ status: 'draw', winner: null });
    });

    it('returns null when the board is partially filled with no winner', () => {
      let s = engine.initialState({});
      s = engine.applyMove(s, '4', 'user');
      s = engine.applyMove(s, '4', 'companion');
      s = engine.applyMove(s, '3', 'user');
      expect(engine.terminalState(s)).toBeNull();
    });
  });

  describe('renderForLLM', () => {
    it('includes a legend and legal-column hint', () => {
      const s = engine.initialState({});
      const out = engine.renderForLLM(s, 'companion');
      expect(out).toContain('Legend');
      expect(out).toContain('Legal columns');
      expect(out).toContain('1 2 3 4 5 6 7');
    });
  });

  describe('suggestMove', () => {
    it('prefers central columns', () => {
      const s = engine.initialState({});
      expect(engine.suggestMove(s, 'companion')).toBe('4');
    });

    it('falls back when center full', () => {
      let s = engine.initialState({});
      for (let i = 0; i < 6; i++) {
        s = engine.applyMove(s, '4', i % 2 === 0 ? 'user' : 'companion');
      }
      const suggestion = engine.suggestMove(s, 'companion');
      expect(suggestion).not.toBe('4');
      expect(['3', '5']).toContain(suggestion!);
    });
  });
});
