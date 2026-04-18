'use client';

import { motion } from 'framer-motion';
import { Flag, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ActiveGame, GameType } from '@campfire/shared';
import { getGameBoardComponent, getGameTitle } from './registry';

interface GameBoardContainerProps {
  gameState: ActiveGame;
  onUserMove: (move: string) => void;
  onResign: () => void;
  companionName: string;
  isWaitingForCompanion?: boolean;
  onRematch?: (gameType: GameType) => void;
}

export function GameBoardContainer({
  gameState,
  onUserMove,
  onResign,
  companionName,
  isWaitingForCompanion = false,
  onRematch,
}: GameBoardContainerProps) {
  const isUserTurn = gameState.currentPlayer === 'user';
  const isGameOver = gameState.status !== 'in_progress';
  const BoardComponent = getGameBoardComponent(gameState.gameType);

  const getStatusMessage = (): string => {
    if (isGameOver) {
      if (gameState.status === 'won') return `${companionName} wins!`;
      if (gameState.status === 'lost') return 'You win!';
      if (gameState.status === 'draw') return "It's a draw!";
      if (gameState.status === 'resigned') {
        return gameState.winner === 'user' ? 'You win!' : `${companionName} wins!`;
      }
    }
    if (isWaitingForCompanion) return `${companionName} is thinking…`;
    return isUserTurn ? 'Your turn' : `${companionName}'s turn`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="p-4 bg-muted/30 border-border/50">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{getGameTitle(gameState.gameType)}</h3>
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {isWaitingForCompanion && !isGameOver && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              <span>{getStatusMessage()}</span>
            </div>
          </div>
          {!isGameOver && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResign}
              className="text-muted-foreground hover:text-destructive"
            >
              <Flag className="h-4 w-4 mr-1" />
              Resign
            </Button>
          )}
        </div>

        {/* Game Board (dispatched via registry) */}
        <div className="flex justify-center py-2">
          {BoardComponent ? (
            <BoardComponent
              gameState={gameState}
              onMove={onUserMove}
              disabled={!isUserTurn || isGameOver || isWaitingForCompanion}
            />
          ) : (
            <div className="text-muted-foreground text-center py-8">
              Game type not supported yet
            </div>
          )}
        </div>

        {/* Move History */}
        {gameState.moveHistory.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Moves: </span>
              {gameState.moveHistory.map((m, i) => (
                <span key={`${m.timestamp}-${i}`}>
                  {i > 0 && ', '}
                  <span className={m.player === 'user' ? 'text-blue-400' : 'text-red-400'}>
                    {m.notation}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Game Over Actions */}
        {isGameOver && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {onRematch ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRematch(gameState.gameType)}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Play again
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Say &quot;let&apos;s play again&quot; to start a new game!
              </p>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
