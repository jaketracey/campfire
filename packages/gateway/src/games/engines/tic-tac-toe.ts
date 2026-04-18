/**
 * Tic-tac-toe engine.
 *
 * Board shape: 3x3 array of 'X' | 'O' | '' (empty).
 * Move notation: <column letter><row number>, e.g. 'A1', 'B2', 'C3'.
 *   - Columns A/B/C map to index 0/1/2
 *   - Rows 1/2/3 map to index 0/1/2
 *
 * The rendered JSON DTO matches what the existing frontend board expects, so
 * porting from the Python plugin is drop-in for the UI layer.
 */
import type { Player } from '@campfire/shared';
import type {
  GameEngine,
  InitialStateOptions,
  MoveValidation,
  TerminalState,
} from '../engine.js';

export interface TicTacToeState {
  board: string[][]; // 3x3
  companionSymbol: 'X' | 'O';
  userSymbol: 'X' | 'O';
}

const COLUMNS = ['A', 'B', 'C'] as const;
const ROWS = ['1', '2', '3'] as const;

const LINES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // Rows
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  // Columns
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  // Diagonals
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];

function parseMove(move: string): readonly [number, number] | null {
  const m = move.toUpperCase().trim();
  if (m.length !== 2) return null;
  const col = COLUMNS.indexOf(m[0] as (typeof COLUMNS)[number]);
  const row = ROWS.indexOf(m[1] as (typeof ROWS)[number]);
  if (col < 0 || row < 0) return null;
  return [row, col];
}

function formatCell(row: number, col: number): string {
  return `${COLUMNS[col]}${ROWS[row]}`;
}

function cloneBoard(board: string[][]): string[][] {
  return board.map(row => row.slice());
}

function findWinningSymbol(board: string[][]): 'X' | 'O' | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const sa = board[a![0]]![a![1]]!;
    const sb = board[b![0]]![b![1]]!;
    const sc = board[c![0]]![c![1]]!;
    if (sa && sa === sb && sb === sc) return sa as 'X' | 'O';
  }
  return null;
}

export class TicTacToeEngine implements GameEngine<TicTacToeState> {
  readonly type = 'tic_tac_toe' as const;
  readonly displayName = 'Tic-Tac-Toe';

  initialState(opts: InitialStateOptions): TicTacToeState {
    // 'X' always moves first; assign it to whoever plays first.
    const companionPlaysFirst = opts.companionPlaysFirst ?? false;
    return {
      board: [
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ],
      companionSymbol: companionPlaysFirst ? 'X' : 'O',
      userSymbol: companionPlaysFirst ? 'O' : 'X',
    };
  }

  getSymbols(opts: InitialStateOptions): readonly [string, string] {
    return opts.companionPlaysFirst ? ['X', 'O'] : ['O', 'X'];
  }

  legalMoves(state: TicTacToeState): string[] {
    const moves: string[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (state.board[row]![col] === '') moves.push(formatCell(row, col));
      }
    }
    return moves;
  }

  validateMove(state: TicTacToeState, move: string): MoveValidation {
    const parsed = parseMove(move);
    if (!parsed) {
      return {
        ok: false,
        reason: `Invalid move format '${move}'. Use notation like A1, B2, C3.`,
      };
    }
    const [row, col] = parsed;
    if (state.board[row]![col] !== '') {
      return { ok: false, reason: `Cell ${move.toUpperCase()} is already occupied.` };
    }
    return { ok: true };
  }

  applyMove(state: TicTacToeState, move: string, player: Player): TicTacToeState {
    const parsed = parseMove(move);
    if (!parsed) throw new Error(`Invalid move: ${move}`);
    const [row, col] = parsed;
    const symbol = player === 'companion' ? state.companionSymbol : state.userSymbol;
    const board = cloneBoard(state.board);
    board[row]![col] = symbol;
    return { ...state, board };
  }

  terminalState(state: TicTacToeState): TerminalState | null {
    const winnerSymbol = findWinningSymbol(state.board);
    if (winnerSymbol) {
      if (winnerSymbol === state.companionSymbol) {
        return { status: 'won', winner: 'companion' };
      }
      return { status: 'lost', winner: 'user' };
    }
    const hasEmpty = state.board.some(row => row.some(cell => cell === ''));
    if (!hasEmpty) return { status: 'draw', winner: null };
    return null;
  }

  renderForLLM(state: TicTacToeState, perspective: Player): string {
    const lines: string[] = [];
    lines.push('    A   B   C');
    lines.push('  +---+---+---+');
    for (let row = 0; row < 3; row++) {
      const rowNum = ROWS[row];
      const r = state.board[row]!;
      lines.push(
        `${rowNum} | ${r[0] || ' '} | ${r[1] || ' '} | ${r[2] || ' '} |`,
      );
      lines.push('  +---+---+---+');
    }
    const mySymbol = perspective === 'companion' ? state.companionSymbol : state.userSymbol;
    const theirSymbol = perspective === 'companion' ? state.userSymbol : state.companionSymbol;
    lines.push('');
    lines.push(`You play ${mySymbol}. Opponent plays ${theirSymbol}.`);
    const legal = this.legalMoves(state);
    if (legal.length > 0) {
      lines.push(`Legal moves: ${legal.join(', ')}`);
    }
    return lines.join('\n');
  }

  renderForClient(state: TicTacToeState): unknown {
    return {
      type: 'tic_tac_toe',
      board: state.board,
      companionSymbol: state.companionSymbol,
      userSymbol: state.userSymbol,
    };
  }

  formatMove(move: string, player: Player, before: TicTacToeState): string {
    const symbol = player === 'companion' ? before.companionSymbol : before.userSymbol;
    const actor = player === 'companion' ? 'I' : 'You';
    return `${actor} placed ${symbol} at ${move.toUpperCase()}`;
  }

  suggestMove(state: TicTacToeState, player: Player): string | null {
    // Minimal strategy: pick center, then corners, then edges among legal cells.
    const legal = this.legalMoves(state);
    if (legal.length === 0) return null;
    const preferred = ['B2', 'A1', 'A3', 'C1', 'C3', 'B1', 'B3', 'A2', 'C2'];
    for (const pref of preferred) {
      if (legal.includes(pref)) return pref;
    }
    return legal[0] ?? null;
  }
}

export const ticTacToeEngine = new TicTacToeEngine();
