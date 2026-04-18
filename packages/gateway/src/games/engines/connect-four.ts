/**
 * Connect Four engine.
 *
 * Board: 6 rows (index 0 = top) × 7 columns (index 0 = leftmost).
 * Cell encoding in the JSONB state: 0 = empty, 1 = user token, 2 = companion
 * token. Tokens fall to the lowest empty cell in the chosen column.
 *
 * Move notation: column number as a 1-indexed string ('1'..'7'). Single-digit
 * notation keeps the LLM tool schema trivially constrainable.
 */
import type { Player } from '@campfire/shared';
import type {
  GameEngine,
  InitialStateOptions,
  MoveValidation,
  TerminalState,
} from '../engine.js';

export interface ConnectFourState {
  board: number[][]; // 6 rows × 7 cols; 0=empty, 1=user, 2=companion
}

const ROWS = 6;
const COLS = 7;
const WIN = 4;

function emptyBoard(): number[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0));
}

function cloneBoard(b: number[][]): number[][] {
  return b.map((r) => r.slice());
}

function parseColumn(move: string): number | null {
  const trimmed = move.trim();
  if (!/^[1-7]$/.test(trimmed)) return null;
  return parseInt(trimmed, 10) - 1;
}

function lowestEmptyRow(board: number[][], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row]![col] === 0) return row;
  }
  return -1;
}

function tokenFor(player: Player): 1 | 2 {
  return player === 'user' ? 1 : 2;
}

/** Check whether the last move at (row, col) completed a 4-in-a-row. */
function didLastMoveWin(board: number[][], row: number, col: number): boolean {
  const token = board[row]![col];
  if (!token) return false;
  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diag ↘
    [1, -1], // diag ↙
  ];
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (const sign of [-1, 1] as const) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r]![c] === token) {
        count += 1;
        r += sign * dr;
        c += sign * dc;
      }
    }
    if (count >= WIN) return true;
  }
  return false;
}

function isBoardFull(board: number[][]): boolean {
  return board[0]!.every((cell) => cell !== 0);
}

export class ConnectFourEngine implements GameEngine<ConnectFourState> {
  readonly type = 'connect_four' as const;
  readonly displayName = 'Connect Four';

  initialState(_opts: InitialStateOptions): ConnectFourState {
    return { board: emptyBoard() };
  }

  legalMoves(state: ConnectFourState): string[] {
    const moves: string[] = [];
    for (let col = 0; col < COLS; col++) {
      if (state.board[0]![col] === 0) {
        // Column has at least one empty cell.
        moves.push(String(col + 1));
      }
    }
    return moves;
  }

  validateMove(state: ConnectFourState, move: string): MoveValidation {
    const col = parseColumn(move);
    if (col === null) {
      return { ok: false, reason: `Invalid column '${move}'. Use 1–7.` };
    }
    if (state.board[0]![col] !== 0) {
      return { ok: false, reason: `Column ${move} is full.` };
    }
    return { ok: true };
  }

  applyMove(state: ConnectFourState, move: string, player: Player): ConnectFourState {
    const col = parseColumn(move);
    if (col === null) throw new Error(`Invalid move: ${move}`);
    const row = lowestEmptyRow(state.board, col);
    if (row < 0) throw new Error(`Column ${move} is full`);
    const board = cloneBoard(state.board);
    board[row]![col] = tokenFor(player);
    return { board };
  }

  terminalState(state: ConnectFourState): TerminalState | null {
    // Check for a winner by scanning every cell; cheap at 6×7.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const token = state.board[r]![c];
        if (token && didLastMoveWin(state.board, r, c)) {
          if (token === 2) return { status: 'won', winner: 'companion' };
          return { status: 'lost', winner: 'user' };
        }
      }
    }
    if (isBoardFull(state.board)) return { status: 'draw', winner: null };
    return null;
  }

  renderForLLM(state: ConnectFourState, perspective: Player): string {
    const myToken = tokenFor(perspective);
    const oppToken = myToken === 1 ? 2 : 1;
    const cell = (v: number): string => (v === myToken ? 'M' : v === oppToken ? 'O' : '.');
    const lines: string[] = [];
    lines.push(' 1 2 3 4 5 6 7');
    for (let r = 0; r < ROWS; r++) {
      lines.push(` ${state.board[r]!.map(cell).join(' ')}`);
    }
    lines.push('');
    lines.push('Legend: M = your tokens, O = opponent\'s tokens, . = empty');
    const legal = this.legalMoves(state);
    if (legal.length > 0) {
      lines.push(`Legal columns: ${legal.join(', ')}`);
    }
    return lines.join('\n');
  }

  renderForClient(state: ConnectFourState): unknown {
    return {
      type: 'connect_four',
      board: state.board,
    };
  }

  formatMove(move: string, player: Player): string {
    const actor = player === 'companion' ? 'I' : 'You';
    return `${actor} dropped a token into column ${move}`;
  }

  suggestMove(state: ConnectFourState): string | null {
    const legal = this.legalMoves(state);
    if (legal.length === 0) return null;
    // Mild preference: central columns are stronger. Walk from center out.
    const preferred = ['4', '3', '5', '2', '6', '1', '7'];
    for (const pref of preferred) {
      if (legal.includes(pref)) return pref;
    }
    return legal[0] ?? null;
  }
}

export const connectFourEngine = new ConnectFourEngine();
