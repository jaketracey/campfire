/**
 * Games framework public surface. Import from here rather than reaching into
 * submodules — the entry keeps the seam clean if internals are reshuffled.
 */
export type {
  GameEngine,
  InitialStateOptions,
  MoveValidation,
  TerminalState,
  Difficulty,
} from './engine.js';
export {
  GameAlreadyActiveError,
  GameEndedError,
  GameError,
  GameNotFoundError,
  InvalidMoveError,
  NotYourTurnError,
  UnknownGameTypeError,
  VersionConflictError,
} from './errors.js';
export { gameService, GameService } from './service.js';
export type { GameBroadcaster, StartGameParams, ApplyMoveParams, ResignParams } from './service.js';
export { gameRepository, GameRepository } from './repository.js';
export type { GameSessionRow, CreateGameSessionInput } from './repository.js';
export { getEngine, hasEngine, listGameTypes } from './registry.js';
export { ticTacToeEngine, TicTacToeEngine } from './engines/tic-tac-toe.js';
export type { TicTacToeState } from './engines/tic-tac-toe.js';
export { chessEngine, ChessEngine } from './engines/chess.js';
export type { ChessState } from './engines/chess.js';
export { connectFourEngine, ConnectFourEngine } from './engines/connect-four.js';
export type { ConnectFourState } from './engines/connect-four.js';
