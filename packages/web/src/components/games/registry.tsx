'use client';

/**
 * Frontend game board registry.
 *
 * Each supported game provides a React component that renders its board and
 * accepts `(move) => void` / `disabled` props. The registry decouples
 * `GameBoardContainer` from any specific game's markup — new games slot in by
 * (a) adding an engine on the gateway, and (b) registering a component here.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { ActiveGame, GameType } from '@campfire/shared';

/**
 * Props every game board component must accept. `disabled` covers both
 * "waiting on opponent" and "game over" — the board should not receive new
 * moves while it's set.
 */
export interface GameBoardProps {
  gameState: ActiveGame;
  onMove: (move: string) => void;
  disabled: boolean;
}

import { TicTacToeBoard } from './tic-tac-toe-board';

// Chess and Connect Four lazy-load so their heavier deps (chess.js, etc.)
// don't bloat the main chat bundle for users who never open those games.
const ChessBoard = dynamic<GameBoardProps>(
  () => import('./chess-board').then((m) => m.ChessBoard),
  { ssr: false, loading: () => <div className="text-sm text-muted-foreground">Loading chess…</div> },
);

const ConnectFourBoard = dynamic<GameBoardProps>(
  () => import('./connect-four-board').then((m) => m.ConnectFourBoard),
  { ssr: false, loading: () => <div className="text-sm text-muted-foreground">Loading…</div> },
);

/**
 * Adapter: the existing `TicTacToeBoard` takes the raw string[][] + symbols;
 * the registry contract is uniform `GameBoardProps`. This shim keeps the
 * per-game components free to choose whatever signature best suits them.
 */
function TicTacToeAdapter({ gameState, onMove, disabled }: GameBoardProps) {
  return (
    <TicTacToeBoard
      board={gameState.board as string[][]}
      onCellClick={onMove}
      disabled={disabled}
      userSymbol={gameState.userSymbol || 'X'}
      companionSymbol={gameState.companionSymbol || 'O'}
    />
  );
}

const REGISTRY: Record<GameType, ComponentType<GameBoardProps>> = {
  tic_tac_toe: TicTacToeAdapter,
  chess: ChessBoard,
  connect_four: ConnectFourBoard,
};

export function getGameBoardComponent(type: GameType): ComponentType<GameBoardProps> | null {
  return REGISTRY[type] ?? null;
}

export function getGameTitle(type: GameType): string {
  switch (type) {
    case 'tic_tac_toe':
      return 'Tic-Tac-Toe';
    case 'chess':
      return 'Chess';
    case 'connect_four':
      return 'Connect Four';
    default:
      return 'Game';
  }
}
