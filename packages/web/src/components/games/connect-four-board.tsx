'use client';

/**
 * Connect Four board UI.
 *
 * Contract:
 *   - `gameState.board` is a 6×7 number matrix: 0 = empty, 1 = user, 2 = companion.
 *   - Clicking any cell in a column drops a token into that column (just like
 *     physically poking the slot).
 *   - A column-hover indicator shows where the token will land.
 *   - Move notation is the 1-indexed column number, matching the engine.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { ActiveGame } from '@campfire/shared';
import type { GameBoardProps } from './registry';

const COLS = 7;

function readBoard(gameState: ActiveGame): number[][] {
  const raw = (gameState.board ?? {}) as { type?: string; board?: number[][] };
  if (Array.isArray(raw.board)) return raw.board;
  // Fallback: empty board.
  return Array.from({ length: 6 }, () => Array.from({ length: COLS }, () => 0));
}

export function ConnectFourBoard({ gameState, onMove, disabled }: GameBoardProps) {
  const board = readBoard(gameState);
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  function handleClick(col: number) {
    if (disabled) return;
    // Only accept the move if the column has at least one empty cell.
    if (board[0]![col] !== 0) return;
    onMove(String(col + 1));
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Connect Four board">
      <div
        className="grid gap-1 p-3 bg-blue-900/40 rounded-lg"
        style={{ gridTemplateColumns: `repeat(${COLS}, 2.5rem)` }}
      >
        {board.map((row, rowIdx) =>
          row.map((cell, colIdx) => {
            const isUser = cell === 1;
            const isCompanion = cell === 2;
            const isHoverCol = hoverCol === colIdx && !disabled && board[0]![colIdx] === 0;
            return (
              <button
                type="button"
                key={`${rowIdx}-${colIdx}`}
                className={`
                  relative size-10 rounded-full flex items-center justify-center
                  transition-colors
                  ${isHoverCol ? 'bg-blue-800/60' : 'bg-blue-950/60'}
                  ${!disabled ? 'cursor-pointer' : 'cursor-not-allowed'}
                `}
                onMouseEnter={() => setHoverCol(colIdx)}
                onMouseLeave={() => setHoverCol(null)}
                onClick={() => handleClick(colIdx)}
                disabled={disabled || board[0]![colIdx] !== 0}
                aria-label={`Row ${rowIdx + 1}, Column ${colIdx + 1}${
                  cell ? (cell === 1 ? ', your token' : ', companion token') : ', empty'
                }`}
              >
                {isUser && (
                  <motion.span
                    layout
                    initial={{ y: -40 * (rowIdx + 1), opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 240, damping: 22 }}
                    className="size-8 rounded-full bg-yellow-400 shadow-inner"
                  />
                )}
                {isCompanion && (
                  <motion.span
                    layout
                    initial={{ y: -40 * (rowIdx + 1), opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 240, damping: 22 }}
                    className="size-8 rounded-full bg-red-500 shadow-inner"
                  />
                )}
              </button>
            );
          }),
        )}
      </div>
      <p className="text-xs text-center text-muted-foreground">
        Click any square in a column to drop your token.
      </p>
    </div>
  );
}
