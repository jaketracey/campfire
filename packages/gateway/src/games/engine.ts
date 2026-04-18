/**
 * GameEngine interface — the contract every game (tic-tac-toe, chess, etc.)
 * implements. All engines are pure: they operate on state in, produce state out.
 * No I/O, no persistence. The `GameService` owns persistence and the registry
 * owns engine lookup.
 *
 * Why server-authoritative pure engines:
 *   - Deterministic. Same state + move always yields the same next state.
 *   - Trivially testable without a database.
 *   - Easy to diff: next_state - current_state = applied move.
 */
import type { GameType, GameStatus, Player } from '@campfire/shared';

/** Shape returned by `validateMove`. */
export type MoveValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Optional difficulty hint forwarded to engines that support it (chess). */
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface InitialStateOptions {
  /** If true, companion plays first. Default: false (user plays first). */
  companionPlaysFirst?: boolean;
  /** Optional engine-specific hint. */
  difficulty?: Difficulty;
}

/** Terminal (game-over) detection output. Null means the game is still live. */
export interface TerminalState {
  readonly status: GameStatus;
  readonly winner: Player | null;
}

/**
 * Generic game engine. `TState` is the engine's internal state shape (stored
 * as JSONB in `game_sessions.state`). `TMove` defaults to string notation.
 */
export interface GameEngine<TState = unknown, TMove extends string = string> {
  /** Stable discriminator; must match the `game_type` column. */
  readonly type: GameType;

  /** Human-readable title for UI and the LLM system prompt. */
  readonly displayName: string;

  /**
   * Build the starting state for a new game. Engines that assign symbols
   * (X/O) should return them via `getSymbols`.
   */
  initialState(opts: InitialStateOptions): TState;

  /**
   * Enumerate legal moves for `player` given `state`. Used both for move
   * validation and for constraining the LLM's tool-call schema.
   */
  legalMoves(state: TState, player: Player): TMove[];

  /**
   * Validate a proposed move without applying it. Returns a structured result
   * (not a throw) because invalid moves are expected in normal operation
   * (e.g., LLM hallucinations, stale client state).
   */
  validateMove(state: TState, move: TMove, player: Player): MoveValidation;

  /**
   * Apply a move that has already been validated. Must be pure and total:
   * given a valid move it must not throw. Engines are free to deep-clone
   * internally; the caller may not mutate the returned value.
   */
  applyMove(state: TState, move: TMove, player: Player): TState;

  /**
   * Detect game-over conditions. Returns `null` while the game is live.
   */
  terminalState(state: TState): TerminalState | null;

  /**
   * Render a board representation for the LLM's system prompt. Should include
   * a legend (coordinates), the current position, and — where useful — a list
   * of legal-move hints so the companion doesn't hallucinate notation.
   */
  renderForLLM(state: TState, perspective: Player): string;

  /**
   * Render a JSON DTO for the UI. Shape is engine-specific; the frontend
   * registry dispatches on `gameType` to pick the matching component.
   */
  renderForClient(state: TState): unknown;

  /**
   * Format a short, human-readable description of a move for chat commentary
   * or the move list ("You placed X at B2", "I played Nf3").
   */
  formatMove(move: TMove, player: Player, before: TState, after: TState): string;

  /**
   * Optional: return (companion_symbol, user_symbol) for games that assign
   * them (tic-tac-toe). Returns `[null, null]` for games that don't.
   */
  getSymbols?(opts: InitialStateOptions): readonly [string | null, string | null];

  /**
   * Optional: return a recommended move for `player`. Used (a) as a hint for
   * the LLM to shape companion play, and (b) as a "hint" button for users.
   * Strong engines (e.g. chess via Stockfish) implement this; weaker ones
   * can omit it and the service will fall back to picking a random legal move.
   */
  suggestMove?(state: TState, player: Player, level?: Difficulty): TMove | null;
}
