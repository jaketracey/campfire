/**
 * Engine registry. Single source of truth for `game_type` → `GameEngine`.
 * Adding a new game is a three-line change here plus the engine module.
 */
import type { GameType } from '@campfire/shared';
import type { GameEngine } from './engine.js';
import { UnknownGameTypeError } from './errors.js';
import { ticTacToeEngine } from './engines/tic-tac-toe.js';
import { chessEngine } from './engines/chess.js';

const ENGINES: ReadonlyMap<GameType, GameEngine> = new Map<GameType, GameEngine>([
  ['tic_tac_toe', ticTacToeEngine],
  ['chess', chessEngine],
]);

/**
 * Look up an engine by game type. Throws `UnknownGameTypeError` on miss so
 * the service layer maps it cleanly to an HTTP 400.
 */
export function getEngine(gameType: GameType | string): GameEngine {
  const engine = ENGINES.get(gameType as GameType);
  if (!engine) throw new UnknownGameTypeError(gameType);
  return engine;
}

/**
 * List all registered game types. Used by UI to enumerate playable games and
 * by the orchestrator to populate the `start_game` tool's `game_type` enum.
 */
export function listGameTypes(): GameType[] {
  return Array.from(ENGINES.keys());
}

export function hasEngine(gameType: string): gameType is GameType {
  return ENGINES.has(gameType as GameType);
}
