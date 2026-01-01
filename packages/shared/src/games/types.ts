/**
 * Game types for companion gaming features.
 * Shared between gateway, web, and orchestrator.
 */

export type GameType = 'chess' | 'tic_tac_toe' | 'connect_four';

export type GameStatus = 'in_progress' | 'won' | 'lost' | 'draw' | 'resigned';

export type Player = 'user' | 'companion';

export interface GameMove {
  player: Player;
  notation: string;
  timestamp: string; // ISO8601
}

export interface ActiveGame {
  gameType: GameType;
  board: unknown; // Game-specific board representation
  currentPlayer: Player;
  status: GameStatus;
  moveHistory: GameMove[];
  availableMoves: string[];
  winner: Player | null;
  startedAt: string; // ISO8601
  companionSymbol?: string | null;
  userSymbol?: string | null;
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
}

/**
 * Connect Four board.
 * 6 rows x 7 columns, 0 = empty, 1 = user, 2 = companion.
 */
export type ConnectFourBoard = number[][];

/**
 * Result of starting a new game.
 */
export interface GameStartResult {
  game: ActiveGame;
  boardText: string;
  boardJson: unknown;
  message: string;
}

/**
 * Result of making a move.
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
 * WebSocket message payloads for games.
 */
export interface GameUpdatePayload {
  gameState: ActiveGame;
  boardJson: unknown;
  message?: string;
}

export interface UserGameMovePayload {
  move: string;
}
