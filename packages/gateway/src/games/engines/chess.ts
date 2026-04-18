/**
 * Chess engine. Backed by chess.js — battle-tested and handles the rules that
 * would otherwise be tedious to get right (castling rights, en passant,
 * promotion, 50-move rule, threefold repetition, stalemate, etc.).
 *
 * State shape stored as JSONB in `game_sessions.state`:
 *   - `fen` — full position, turn, castling, half/full-move clocks
 *   - `pgn` — the full move list (for UI replay + export)
 *   - `lastMove` — UCI notation of the most recently played move
 *   - `turn` — 'white' | 'black' whose turn it is
 *   - `inCheck` / `inCheckmate` / `inStalemate` — precomputed convenience flags
 *
 * Move notation: UCI (`e2e4`, `e7e8q`). The engine also accepts chess.js's
 * SAN (`Nf3`, `O-O`) in `validateMove`/`applyMove` so the LLM has a fallback,
 * but legal-moves output is always UCI for schema-friendly enums.
 */
import { Chess } from 'chess.js';
import type { Player } from '@campfire/shared';
import type {
  GameEngine,
  InitialStateOptions,
  MoveValidation,
  TerminalState,
} from '../engine.js';

export interface ChessState {
  fen: string;
  pgn: string;
  lastMove: string | null;
  turn: 'white' | 'black';
  inCheck: boolean;
  inCheckmate: boolean;
  inStalemate: boolean;
  /**
   * Who plays white vs black. Mapping is fixed at game start and lets the
   * engine figure out whose turn it is without extra per-move bookkeeping.
   */
  companionColor: 'white' | 'black';
  userColor: 'white' | 'black';
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Rebuild a chess.js Chess from our state (FEN is the source of truth). */
function chessFromState(state: ChessState): Chess {
  const c = new Chess();
  c.load(state.fen);
  return c;
}

function statePlayerTurn(state: ChessState): Player {
  return state.turn === state.companionColor ? 'companion' : 'user';
}

/** Try chess.js's move() with UCI first, then SAN as fallback. */
function tryMove(chess: Chess, move: string): ReturnType<Chess['move']> | null {
  const trimmed = move.trim();
  // UCI: e.g. "e2e4", "e7e8q"
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(trimmed)) {
    try {
      return chess.move({
        from: trimmed.slice(0, 2).toLowerCase(),
        to: trimmed.slice(2, 4).toLowerCase(),
        promotion: trimmed.length === 5 ? trimmed[4]!.toLowerCase() : undefined,
      });
    } catch {
      return null;
    }
  }
  // SAN: e.g. "Nf3", "O-O"
  try {
    return chess.move(trimmed);
  } catch {
    return null;
  }
}

/** Build our JSON state from a chess.js instance + colour mapping. */
function stateFromChess(
  chess: Chess,
  companionColor: 'white' | 'black',
  lastMove: string | null,
): ChessState {
  return {
    fen: chess.fen(),
    pgn: chess.pgn(),
    lastMove,
    turn: chess.turn() === 'w' ? 'white' : 'black',
    inCheck: chess.inCheck(),
    inCheckmate: chess.isCheckmate(),
    inStalemate: chess.isStalemate(),
    companionColor,
    userColor: companionColor === 'white' ? 'black' : 'white',
  };
}

/** UCI notation for a chess.js Move ({ from, to, promotion? }). */
function uciOf(m: { from: string; to: string; promotion?: string }): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`;
}

export class ChessEngine implements GameEngine<ChessState> {
  readonly type = 'chess' as const;
  readonly displayName = 'Chess';

  initialState(opts: InitialStateOptions): ChessState {
    // White moves first; whoever plays white opens.
    const companionColor: 'white' | 'black' = opts.companionPlaysFirst ? 'white' : 'black';
    const chess = new Chess();
    chess.load(STARTING_FEN);
    return stateFromChess(chess, companionColor, null);
  }

  getSymbols(opts: InitialStateOptions): readonly [string, string] {
    // Use "White" / "Black" as symbols for display purposes.
    return opts.companionPlaysFirst ? ['White', 'Black'] : ['Black', 'White'];
  }

  legalMoves(state: ChessState, player: Player): string[] {
    // Only produce legal moves for the side whose turn it actually is; the
    // service layer guards "turn authority" separately, but returning [] for
    // the off-turn player keeps the LLM's enum tight.
    const turn = statePlayerTurn(state);
    if (turn !== player) return [];
    const chess = chessFromState(state);
    return chess.moves({ verbose: true }).map(uciOf);
  }

  validateMove(state: ChessState, move: string): MoveValidation {
    const chess = chessFromState(state);
    const applied = tryMove(chess, move);
    if (!applied) {
      return {
        ok: false,
        reason: `Illegal move '${move}'. Use UCI notation like 'e2e4' or SAN like 'Nf3'.`,
      };
    }
    return { ok: true };
  }

  applyMove(state: ChessState, move: string): ChessState {
    const chess = chessFromState(state);
    const applied = tryMove(chess, move);
    if (!applied) {
      throw new Error(`Invalid move: ${move}`);
    }
    return stateFromChess(chess, state.companionColor, uciOf(applied));
  }

  terminalState(state: ChessState): TerminalState | null {
    const chess = chessFromState(state);
    if (chess.isCheckmate()) {
      // The side whose turn it is lost.
      const losingSide = chess.turn() === 'w' ? 'white' : 'black';
      const winnerPlayer: Player = losingSide === state.companionColor ? 'user' : 'companion';
      return {
        status: winnerPlayer === 'companion' ? 'won' : 'lost',
        winner: winnerPlayer,
      };
    }
    if (
      chess.isStalemate() ||
      chess.isInsufficientMaterial() ||
      chess.isThreefoldRepetition() ||
      chess.isDraw()
    ) {
      return { status: 'draw', winner: null };
    }
    return null;
  }

  renderForLLM(state: ChessState, perspective: Player): string {
    const chess = chessFromState(state);
    const myColor = perspective === 'companion' ? state.companionColor : state.userColor;
    const oppColor = myColor === 'white' ? 'black' : 'white';
    const lines: string[] = [];
    lines.push(chess.ascii());
    lines.push('');
    lines.push(`You play ${myColor}. Opponent plays ${oppColor}.`);
    if (chess.inCheck()) {
      lines.push('You are in check.' /* from companion's perspective when it's their turn */);
    }
    if (state.pgn) {
      lines.push('');
      lines.push(`PGN so far: ${state.pgn}`);
    }
    const legal = this.legalMoves(state, perspective);
    if (legal.length > 0) {
      const preview = legal.slice(0, 40).join(', ');
      const suffix = legal.length > 40 ? ` ... (${legal.length} total)` : '';
      lines.push('');
      lines.push(`Legal moves (UCI): ${preview}${suffix}`);
    }
    return lines.join('\n');
  }

  renderForClient(state: ChessState): unknown {
    return {
      type: 'chess',
      fen: state.fen,
      pgn: state.pgn,
      lastMove: state.lastMove,
      turn: state.turn,
      inCheck: state.inCheck,
      inCheckmate: state.inCheckmate,
      inStalemate: state.inStalemate,
      companionColor: state.companionColor,
      userColor: state.userColor,
    };
  }

  formatMove(move: string, player: Player, before: ChessState): string {
    const actor = player === 'companion' ? 'I' : 'You';
    // Convert UCI → SAN for a prettier description.
    const chess = chessFromState(before);
    const applied = tryMove(chess, move);
    const san = applied?.san ?? move;
    return `${actor} played ${san}`;
  }

  suggestMove(state: ChessState, player: Player): string | null {
    const moves = this.legalMoves(state, player);
    if (moves.length === 0) return null;
    // Without an engine bundle, pick a random legal move. Phase 6 polish
    // swaps this for a Stockfish WASM call for stronger companion play.
    return moves[Math.floor(Math.random() * moves.length)] ?? null;
  }
}

export const chessEngine = new ChessEngine();
