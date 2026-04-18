'use client';

/**
 * Chess board UI backed by react-chessboard.
 *
 * Contract:
 *   - Rendering is driven by `gameState.board.fen` (server-authoritative state).
 *   - Drag-and-drop emits UCI notation (`e2e4`, promotion suffix `e7e8q`)
 *     via `onMove`.
 *   - Board orientation flips so the user always plays from the bottom.
 *   - Promotions auto-queen for now — we can add a promotion dialog later
 *     without changing the move-wire format.
 *
 * Move legality is checked locally via chess.js *only* to cancel obviously
 * illegal drops (it'd feel broken if a pawn jumped three squares visually).
 * The server remains authoritative: `game_move_rejected` re-syncs if the
 * client's optimistic render diverges.
 */
import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { ActiveGame } from '@campfire/shared';
import type { GameBoardProps } from './registry';

interface ChessBoardShape {
  fen: string;
  lastMove?: string | null;
  turn?: 'white' | 'black';
  userColor?: 'white' | 'black';
  companionColor?: 'white' | 'black';
  inCheck?: boolean;
  inCheckmate?: boolean;
}

function readBoard(gameState: ActiveGame): ChessBoardShape {
  const raw = (gameState.board ?? {}) as Partial<ChessBoardShape>;
  return {
    fen: typeof raw.fen === 'string' && raw.fen.length > 0
      ? raw.fen
      : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    lastMove: raw.lastMove ?? null,
    turn: raw.turn ?? 'white',
    userColor: raw.userColor ?? 'white',
    companionColor: raw.companionColor ?? 'black',
    inCheck: raw.inCheck ?? false,
    inCheckmate: raw.inCheckmate ?? false,
  };
}

export function ChessBoard({ gameState, onMove, disabled }: GameBoardProps) {
  const board = readBoard(gameState);

  // Highlight the last move on both squares.
  const customSquareStyles = useMemo(() => {
    if (!board.lastMove || board.lastMove.length < 4) return {};
    const from = board.lastMove.slice(0, 2);
    const to = board.lastMove.slice(2, 4);
    const highlight = { background: 'rgba(255, 213, 79, 0.45)' };
    return { [from]: highlight, [to]: highlight } as Record<string, Record<string, string>>;
  }, [board.lastMove]);

  function onPieceDrop(source: string, target: string, piece: string): boolean {
    if (disabled) return false;

    // Local legality check — chess.js mirrors server rules so rejected drops
    // don't visually flicker. If the user disagrees with the engine, the
    // server's authoritative state will resync the board anyway.
    const chess = new Chess();
    try {
      chess.load(board.fen);
    } catch {
      return false;
    }
    const isPromotion =
      (piece === 'wP' && target.endsWith('8')) ||
      (piece === 'bP' && target.endsWith('1'));
    let move: ReturnType<Chess['move']> | null;
    try {
      move = chess.move({
        from: source,
        to: target,
        promotion: isPromotion ? 'q' : undefined,
      });
    } catch {
      return false;
    }
    if (!move) return false;

    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    onMove(uci);
    return true;
  }

  return (
    <div className="w-full max-w-[420px]" aria-label="Chess board">
      <Chessboard
        position={board.fen}
        onPieceDrop={onPieceDrop}
        boardOrientation={board.userColor ?? 'white'}
        arePiecesDraggable={!disabled}
        autoPromoteToQueen
        customSquareStyles={customSquareStyles}
        customBoardStyle={{ borderRadius: '8px' }}
        id={`chess-${gameState.id ?? 'board'}`}
      />
      {board.inCheckmate && (
        <p className="text-center text-sm text-destructive mt-2">Checkmate</p>
      )}
      {!board.inCheckmate && board.inCheck && (
        <p className="text-center text-sm text-yellow-500 mt-2">Check</p>
      )}
    </div>
  );
}
