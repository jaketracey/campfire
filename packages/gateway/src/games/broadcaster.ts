/**
 * WebSocket broadcaster for the games framework. Accepts a lookup function
 * that maps a `chatSessionId` → list of WebSocket sockets, so the broadcaster
 * stays decoupled from the connected-clients registry in `ws/handler.ts`.
 *
 * Wired up once at WS registration time via `gameService.setBroadcaster(...)`.
 */
import type { WebSocket } from 'ws';
import type { ActiveGame, Player } from '@campfire/shared';
import type { GameBroadcaster } from './service.js';
import { nanoid } from 'nanoid';

type SocketLookup = (chatSessionId: string) => Iterable<WebSocket>;

function wsSend(socket: WebSocket, type: string, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  const msg = {
    type,
    id: nanoid(),
    timestamp: new Date().toISOString(),
    payload,
  };
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // swallow: a closed/dead socket is cleaned up by the heartbeat task
  }
}

export function createWSGameBroadcaster(lookup: SocketLookup): GameBroadcaster {
  return {
    emitGameState(chatSessionId, game, lastMove) {
      for (const ws of lookup(chatSessionId)) {
        wsSend(ws, 'game_update', {
          activeGame: game as unknown as Record<string, unknown>,
          lastMove: lastMove ?? null,
        });
      }
    },
    emitGameOver(chatSessionId, game) {
      for (const ws of lookup(chatSessionId)) {
        wsSend(ws, 'game_over', {
          activeGame: game as unknown as Record<string, unknown>,
          winner: game.winner,
        });
      }
    },
  };
}

/** Emit a `game_move_rejected` directly to a single socket (used by WS handler). */
export function sendMoveRejected(
  socket: WebSocket,
  payload: { gameId: string | null; code: string; reason: string },
): void {
  wsSend(socket, 'game_move_rejected', payload);
}

/** Emit a `game_companion_thinking` broadcast to all sockets on the chat session. */
export function emitCompanionThinking(
  sockets: Iterable<WebSocket>,
  gameId: string,
  thinking: boolean,
): void {
  for (const ws of sockets) {
    wsSend(ws, 'game_companion_thinking', { gameId, thinking });
  }
}

export type { ActiveGame, Player };
