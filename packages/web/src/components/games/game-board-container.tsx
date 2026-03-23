'use client';

import { motion } from 'framer-motion';
import { Flag, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TicTacToeBoard } from './tic-tac-toe-board';
import type { ActiveGame } from '@campfire/shared';

interface GameBoardContainerProps {
  gameState: ActiveGame;
  onUserMove: (move: string) => void;
  onResign: () => void;
  companionName: string;
  isWaitingForCompanion?: boolean;
}

export function GameBoardContainer({
  gameState,
  onUserMove,
  onResign,
  companionName,
  isWaitingForCompanion = false,
}: GameBoardContainerProps) {
  const isUserTurn = gameState.currentPlayer === 'user';
  const isGameOver = gameState.status !== 'in_progress';

  const getStatusMessage = () => {
    if (isGameOver) {
      if (gameState.status === 'won') {
        return `${companionName} wins!`;
      } else if (gameState.status === 'lost') {
        return 'You win!';
      } else if (gameState.status === 'draw') {
        return "It's a draw!";
      } else if (gameState.status === 'resigned') {
        return gameState.winner === 'user' ? 'You win!' : `${companionName} wins!`;
      }
    }

    if (isWaitingForCompanion) {
      return `${companionName} is thinking...`;
    }

    return isUserTurn ? 'Your turn' : `${companionName}'s turn`;
  };

  const getGameTitle = () => {
    switch (gameState.gameType) {
      case 'tic_tac_toe':
        return 'Tic-Tac-Toe';
      case 'chess':
        return 'Chess';
      case 'connect_four':
        return 'Connect Four';
      default:
        return 'Game';
    }
  };

  const renderBoard = () => {
    switch (gameState.gameType) {
      case 'tic_tac_toe':
        return (
          <TicTacToeBoard
            board={gameState.board as string[][]}
            onCellClick={onUserMove}
            disabled={!isUserTurn || isGameOver || isWaitingForCompanion}
            userSymbol={gameState.userSymbol || 'X'}
            companionSymbol={gameState.companionSymbol || 'O'}
          />
        );
      default:
        return (
          <div className="text-muted-foreground text-center py-8">
            Game type not supported yet
          </div>
        );
    }
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
            <h3 className="font-semibold">{getGameTitle()}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
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

        {/* Game Board */}
        <div className="flex justify-center py-2">
          {renderBoard()}
        </div>

        {/* Move History */}
        {gameState.moveHistory.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Moves: </span>
              {gameState.moveHistory.map((m, i) => (
                <span key={i}>
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
          <div className="mt-4 flex justify-center">
            <p className="text-sm text-muted-foreground">
              Say "let's play again" to start a new game!
            </p>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
