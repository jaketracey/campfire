"""Game tool handlers.

These are thin shims over the gateway's `/internal/games/*` API. The gateway
owns all game engine logic, state persistence, and WebSocket broadcasting;
these handlers simply translate LLM tool calls into gateway HTTP requests
and surface the results back to the LLM as `ToolResult`s.

Design notes
------------
* The "player" for every tool call here is always `companion`. User moves
  enter the system via the gateway's WS handler, not via tool calls.
* Tool handlers used to hold authoritative game state. That's gone now —
  a `game_move` call that the gateway rejects (invalid notation, not our
  turn, game already ended) comes back as a structured error which we
  surface in `ToolResult.error` so the LLM sees the failure reason and can
  retry with a legal move.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.services.game_client import GameClient, GameClientError
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()

_VALID_GAME_TYPES = {"tic_tac_toe", "chess", "connect_four"}


def _duration_ms(start: float) -> float:
    return (time.time() - start) * 1000


class _GameHandlerBase(ToolHandler):
    """Shared boilerplate (http client, logging, GameClient construction)."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ) -> None:
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client
        self.game_client = GameClient(settings, http_client)

    async def _resolve_game_id(self, session_id: str) -> str | None:
        """Return the gateway game id for the active game on `session_id`."""
        active = await self.game_client.get_active_game(session_id)
        if not active:
            return None
        game = active.get("game") or {}
        return game.get("id")


class GameStartHandler(_GameHandlerBase):
    """Start a new game via the gateway."""

    @property
    def name(self) -> str:
        return "game_start"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        game_type = arguments.get("game_type")
        if not game_type:
            return False, "game_type is required"
        if game_type not in _VALID_GAME_TYPES:
            return False, f"Invalid game_type '{game_type}'. Expected one of {sorted(_VALID_GAME_TYPES)}."
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        start = time.time()
        game_type = tool_call.arguments["game_type"]
        companion_first = bool(tool_call.arguments.get("companion_plays_first", False))
        try:
            result = await self.game_client.start_game(
                chat_session_id=str(tool_call.session_id),
                user_id=str(tool_call.user_id),
                companion_id=str(tool_call.companion_id),
                game_type=game_type,
                companion_plays_first=companion_first,
            )
            game = result.get("game", {})
            board_text = result.get("boardText", "")
            board_json = result.get("boardJson", {})
            available = game.get("availableMoves", [])
            first_player = "You go" if companion_first else "User goes"
            output = (
                f"Started a game of {game_type.replace('_', ' ')}!\n\n"
                f"{board_text}\n\n"
                f"{first_player} first."
            )
            if companion_first and available:
                preview = ", ".join(available[:10])
                suffix = f" ... ({len(available)} total)" if len(available) > 10 else ""
                output += f"\n\nYour available moves: {preview}{suffix}"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=_duration_ms(start),
                metadata={
                    "game_id": game.get("id"),
                    "game_type": game_type,
                    "board_json": board_json,
                    "current_player": game.get("currentPlayer"),
                    "available_moves": available,
                    "version": game.get("version", 0),
                },
            )
        except GameClientError as e:
            logger.warning("game_start_failed", code=e.code, message=e.message)
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=e.message,
                duration_ms=_duration_ms(start),
                metadata={"code": e.code},
            )


class GameMoveHandler(_GameHandlerBase):
    """Apply the companion's move via the gateway."""

    @property
    def name(self) -> str:
        return "game_move"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        move = arguments.get("move")
        if not move or not isinstance(move, str):
            return False, "move is required and must be a string"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        start = time.time()
        move = tool_call.arguments["move"]
        thinking = tool_call.arguments.get("thinking")

        try:
            game_id = await self._resolve_game_id(str(tool_call.session_id))
            if not game_id:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game. Use game_start to start a new game.",
                    duration_ms=_duration_ms(start),
                )
            result = await self.game_client.apply_move(
                game_id=game_id,
                player="companion",
                move=move,
            )
            game = result.get("game", {})
            board_text = result.get("boardText", "")
            game_over = bool(result.get("gameOver"))
            winner = result.get("winner")

            parts = []
            if thinking:
                parts.append(f"Thinking: {thinking}")
            parts.append(f"I played {move}.")
            parts.append("")
            parts.append(board_text)
            if game_over:
                parts.append("")
                if winner == "companion":
                    parts.append("I won!")
                elif winner == "user":
                    parts.append("You won!")
                else:
                    parts.append("It's a draw!")
            else:
                available = game.get("availableMoves", [])
                if available:
                    parts.append("")
                    parts.append(
                        f"User's available moves: {', '.join(available[:10])}"
                        + (" ..." if len(available) > 10 else "")
                    )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output="\n".join(parts),
                duration_ms=_duration_ms(start),
                metadata={
                    "game_id": game_id,
                    "move": move,
                    "game_over": game_over,
                    "winner": winner,
                    "current_player": game.get("currentPlayer"),
                    "version": game.get("version"),
                },
            )
        except GameClientError as e:
            # Invalid moves reach the LLM so it can retry with a legal one.
            logger.info("game_move_rejected", code=e.code, move=move)
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=f"Move rejected: {e.message}",
                duration_ms=_duration_ms(start),
                metadata={"code": e.code, "move": move},
            )


class GameStateHandler(_GameHandlerBase):
    """Return the current game state."""

    @property
    def name(self) -> str:
        return "game_state"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        start = time.time()
        try:
            active = await self.game_client.get_active_game(str(tool_call.session_id))
            if not active:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game.",
                    duration_ms=_duration_ms(start),
                )
            game = active.get("game", {})
            board_text = active.get("boardText", "")
            available = active.get("availableMoves", [])
            is_user_turn = bool(active.get("isUserTurn"))

            lines = [board_text, ""]
            if is_user_turn:
                lines.append("It is the user's turn.")
            else:
                lines.append("It is your turn.")
                if available:
                    lines.append(
                        f"Available moves: {', '.join(available[:10])}"
                        + (f" ... ({len(available)} total)" if len(available) > 10 else "")
                    )
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output="\n".join(lines),
                duration_ms=_duration_ms(start),
                metadata={
                    "game_id": game.get("id"),
                    "current_player": game.get("currentPlayer"),
                    "is_user_turn": is_user_turn,
                    "available_moves": available,
                    "version": game.get("version"),
                },
            )
        except GameClientError as e:
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=e.message,
                duration_ms=_duration_ms(start),
                metadata={"code": e.code},
            )


class GameResignHandler(_GameHandlerBase):
    """Companion resigns the active game."""

    @property
    def name(self) -> str:
        return "game_resign"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        start = time.time()
        reason = tool_call.arguments.get("reason")
        try:
            game_id = await self._resolve_game_id(str(tool_call.session_id))
            if not game_id:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game to resign.",
                    duration_ms=_duration_ms(start),
                )
            await self.game_client.resign(
                game_id=game_id, player="companion", reason=reason
            )
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=f"I resign. You win!{f' ({reason})' if reason else ''}",
                duration_ms=_duration_ms(start),
                metadata={"game_id": game_id, "reason": reason},
            )
        except GameClientError as e:
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=e.message,
                duration_ms=_duration_ms(start),
                metadata={"code": e.code},
            )
