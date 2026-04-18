/**
 * Game types shared across gateway, web, mobile, and orchestrator.
 *
 * The games framework is server-authoritative: the gateway owns engine logic,
 * persists state to `game_sessions` / `game_moves`, and broadcasts updates over
 * WebSocket. These types describe the wire format the frontend and orchestrator
 * see. Engine-specific board shape lives under `board` (unknown at this layer).
 */

export type GameType = 'chess' | 'tic_tac_toe' | 'connect_four';

export type GameStatus = 'in_progress' | 'won' | 'lost' | 'draw' | 'resigned';

/**
 * `won` / `lost` are companion-centric (`won` = companion won, `lost` = user won).
 * Prefer reading the `winner` field directly when you need an unambiguous answer.
 */

export type Player = 'user' | 'companion';

export interface GameMove {
  player: Player;
  notation: string;
  timestamp: string; // ISO8601
}

/**
 * A server-authoritative game session. Everything required by the UI to render
 * the board, show the move history, and decide whose turn it is.
 *
 * `version` increments on every applied move and is used for optimistic
 * concurrency control: a client-submitted move includes the version it observed
 * and the server rejects stale submissions.
 */
export interface ActiveGame {
  /** game_sessions.id — undefined on pre-persistence intermediate states */
  id?: string;
  gameType: GameType;
  /** Engine-specific board (see engine's renderForClient output) */
  board: unknown;
  currentPlayer: Player;
  status: GameStatus;
  moveHistory: GameMove[];
  availableMoves: string[];
  winner: Player | null;
  startedAt: string; // ISO8601
  /** Monotonically increments on every applied move */
  version?: number;
  /** Number of moves applied so far (may differ from moveHistory.length in legacy data) */
  moveCount?: number;
  companionSymbol?: string | null;
  userSymbol?: string | null;
  /** Optional engine-specific difficulty hint ('easy' | 'medium' | 'hard') */
  difficulty?: string | null;
}

/**
 * Tic-tac-toe specific board type.
 * 3x3 grid where each cell is 'X', 'O', or '' (empty).
 */
export type TicTacToeBoard = [
  [string, string, string],
  [string, string, string],
  [string, string, string],
];

/**
 * Chess board using FEN notation for state.
 */
export interface ChessBoard {
  fen: string;
  pgn: string;
  /** UCI notation of the last move, e.g. "e2e4" or "e7e8q" */
  lastMove?: string | null;
  /** 'white' | 'black' whose turn it is */
  turn: 'white' | 'black';
  inCheck: boolean;
  inCheckmate: boolean;
  inStalemate: boolean;
}

/**
 * Connect Four board.
 * 6 rows x 7 columns, 0 = empty, 1 = user, 2 = companion.
 */
export type ConnectFourBoard = number[][];

/**
 * Result of starting a new game (gateway internal API response).
 */
export interface GameStartResult {
  game: ActiveGame;
  boardText: string;
  boardJson: unknown;
  message: string;
}

/**
 * Result of making a move (gateway internal API response).
 */
export interface GameMoveResult {
  game: ActiveGame;
  boardText: string;
  boardJson: unknown;
  moveValid: boolean;
  errorMessage: string | null;
  gameOver: boolean;
  winner: Player | null;
  message: string;
}

/**
 * Result of querying game state.
 */
export interface GameStateResult {
  game: ActiveGame;
  boardText: string;
  boardJson: unknown;
  isUserTurn: boolean;
  availableMoves: string[];
}

/**
 * WebSocket message payloads (server → client).
 */
export interface GameUpdatePayload {
  gameState: ActiveGame;
  boardJson: unknown;
  message?: string;
}

/**
 * WebSocket message payload (client → server).
 *
 * `gameId` and `clientVersion` are required by the new realtime protocol for
 * optimistic concurrency. Legacy clients that omit them fall back to
 * "apply-against-latest", at the cost of losing rejection safety.
 */
export interface UserGameMovePayload {
  move: string;
  gameId?: string;
  clientVersion?: number;
}
