'use client';

/**
 * Chess board placeholder. Replaced in phase 5 with a full react-chessboard
 * implementation backed by chess.js. Kept here so the registry resolves and
 * the `GameBoardContainer` stays game-type-agnostic.
 */
import type { GameBoardProps } from './registry';

export function ChessBoard({ gameState }: GameBoardProps) {
  return (
    <div className="text-center py-6 space-y-2">
      <p className="text-sm text-muted-foreground">
        Chess board coming soon.
      </p>
      <p className="text-xs text-muted-foreground/60 font-mono">
        Status: {gameState.status} · Turn: {gameState.currentPlayer}
      </p>
    </div>
  );
}
