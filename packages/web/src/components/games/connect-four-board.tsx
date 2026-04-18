'use client';

/**
 * Connect Four board placeholder. Replaced in phase 6.
 */
import type { GameBoardProps } from './registry';

export function ConnectFourBoard({ gameState }: GameBoardProps) {
  return (
    <div className="text-center py-6 space-y-2">
      <p className="text-sm text-muted-foreground">
        Connect Four board coming soon.
      </p>
      <p className="text-xs text-muted-foreground/60 font-mono">
        Status: {gameState.status} · Turn: {gameState.currentPlayer}
      </p>
    </div>
  );
}
