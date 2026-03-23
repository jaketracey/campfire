'use client';

import { motion } from 'framer-motion';

interface TicTacToeBoardProps {
  board: string[][];
  onCellClick: (move: string) => void;
  disabled: boolean;
  userSymbol?: string;
  companionSymbol?: string;
}

const COLUMNS = ['A', 'B', 'C'];
const ROWS = ['1', '2', '3'];

export function TicTacToeBoard({
  board,
  onCellClick,
  disabled,
  userSymbol = 'X',
  companionSymbol = 'O',
}: TicTacToeBoardProps) {
  const handleCellClick = (row: number, col: number) => {
    if (disabled || board[row][col]) return;
    const move = `${COLUMNS[col]}${ROWS[row]}`;
    onCellClick(move);
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-[240px]" role="grid" aria-label="Tic-tac-toe board">
      {board.map((row, rowIdx) => (
        <div key={rowIdx} className="grid grid-cols-3 gap-2" role="row">
          {row.map((cell, colIdx) => {
            const isEmpty = !cell;
            const isX = cell === 'X';
            const isO = cell === 'O';
            const isUserCell = cell === userSymbol;

            return (
              <motion.button
                key={`${rowIdx}-${colIdx}`}
                role="gridcell"
                className={`
                  aspect-square rounded-lg text-4xl font-bold
                  flex items-center justify-center
                  transition-all duration-150
                  ${isEmpty
                    ? disabled
                      ? 'bg-muted/30 cursor-not-allowed'
                      : 'bg-muted/50 hover:bg-muted cursor-pointer'
                    : 'bg-muted'
                  }
                  ${!disabled && isEmpty ? 'hover:ring-2 hover:ring-primary/50' : ''}
                `}
                aria-label={`Row ${rowIdx + 1}, Column ${colIdx + 1}${cell ? `, ${cell}` : ', empty'}`}
                onClick={() => handleCellClick(rowIdx, colIdx)}
                disabled={disabled || !isEmpty}
                whileHover={!disabled && isEmpty ? { scale: 1.05 } : {}}
                whileTap={!disabled && isEmpty ? { scale: 0.95 } : {}}
              >
                {isX && (
                  <motion.span
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className={isUserCell ? 'text-blue-500' : 'text-red-500'}
                  >
                    X
                  </motion.span>
                )}
                {isO && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={isUserCell ? 'text-blue-500' : 'text-red-500'}
                  >
                    O
                  </motion.span>
                )}
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
