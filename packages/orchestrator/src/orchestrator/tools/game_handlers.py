"""Game tool handler implementations."""

import time
from datetime import datetime
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.games import get_game_plugin
from orchestrator.models.games import (
    ActiveGame,
    GameMove,
    GameStatus,
    GameType,
    Player,
)
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()


class GameStartHandler(ToolHandler):
    """Handler for starting a new game."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "game_start"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate game_start arguments."""
        game_type = arguments.get("game_type")
        if not game_type:
            return False, "game_type is required"

        try:
            GameType(game_type)
        except ValueError:
            return False, f"Invalid game_type: {game_type}. Valid types: {[t.value for t in GameType]}"

        plugin = get_game_plugin(GameType(game_type))
        if not plugin:
            return False, f"Game type '{game_type}' is not yet implemented"

        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Start a new game."""
        start_time = time.time()

        try:
            game_type = GameType(tool_call.arguments["game_type"])
            companion_first = tool_call.arguments.get("companion_plays_first", False)

            plugin = get_game_plugin(game_type)
            if not plugin:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=f"Game type {game_type.value} not implemented",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Create initial game state
            initial_board = plugin.create_initial_state(companion_first)
            companion_symbol, user_symbol = plugin.get_symbols(companion_first)
            current_player = Player.COMPANION if companion_first else Player.USER
            available_moves = plugin.get_available_moves(initial_board, current_player)

            active_game = ActiveGame(
                game_type=game_type,
                board=initial_board["board"] if "board" in initial_board else initial_board,
                current_player=current_player,
                status=GameStatus.IN_PROGRESS,
                move_history=[],
                available_moves=available_moves,
                companion_symbol=companion_symbol or initial_board.get("companionSymbol"),
                user_symbol=user_symbol or initial_board.get("userSymbol"),
            )

            # Store in session metadata
            await self._update_session_game(tool_call.session_id, active_game)

            # Render board
            board_text = plugin.render_board_text(initial_board)
            board_json = plugin.render_board_json(initial_board)

            duration_ms = (time.time() - start_time) * 1000

            # Build output message
            first_player = "You go" if companion_first else "User goes"
            output = (
                f"Started a game of {plugin.display_name}!\n\n"
                f"{board_text}\n\n"
                f"{first_player} first."
            )

            if companion_first:
                output += f"\n\nYour available moves: {', '.join(available_moves[:10])}"
                if len(available_moves) > 10:
                    output += f" ... ({len(available_moves)} total)"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "game_type": game_type.value,
                    "board_json": board_json,
                    "current_player": current_player.value,
                    "available_moves": available_moves,
                },
            )

        except Exception as e:
            logger.exception("game_start_failed", error=str(e))
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=(time.time() - start_time) * 1000,
            )

    async def _update_session_game(
        self,
        session_id: str,
        active_game: ActiveGame,
    ) -> None:
        """Update session metadata with game state."""
        response = await self.http_client.patch(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}/metadata",
            json={"activeGame": active_game.to_session_metadata()},
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()


class GameMoveHandler(ToolHandler):
    """Handler for making a move in a game."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "game_move"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate game_move arguments."""
        move = arguments.get("move")
        if not move:
            return False, "move is required"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Make a move in the current game."""
        start_time = time.time()

        try:
            move = tool_call.arguments["move"]
            thinking = tool_call.arguments.get("thinking")

            # Fetch current game state
            active_game = await self._get_session_game(tool_call.session_id)
            if not active_game:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game. Use game_start to start a new game.",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Check if game is already over
            if active_game.status != GameStatus.IN_PROGRESS:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=f"Game is already over (status: {active_game.status.value})",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Check if it's companion's turn
            if active_game.current_player != Player.COMPANION:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="It's not your turn. Wait for the user to make their move.",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Get game plugin
            plugin = get_game_plugin(active_game.game_type)
            if not plugin:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=f"Game plugin not found for {active_game.game_type.value}",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Build state dict for plugin
            state = {
                "board": active_game.board,
                "companionSymbol": active_game.companion_symbol,
                "userSymbol": active_game.user_symbol,
            }

            # Validate move
            is_valid, error_msg = plugin.validate_move(state, move, Player.COMPANION)
            if not is_valid:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=f"Invalid move: {error_msg}",
                    duration_ms=(time.time() - start_time) * 1000,
                    metadata={"available_moves": active_game.available_moves},
                )

            # Apply move
            state_before = state.copy()
            new_state = plugin.apply_move(state, move, Player.COMPANION)

            # Check game over
            status, winner = plugin.check_game_over(new_state)

            # Update game state
            active_game.board = new_state["board"]
            active_game.status = status
            active_game.winner = winner
            active_game.move_history.append(
                GameMove(
                    player=Player.COMPANION,
                    notation=move,
                    timestamp=datetime.utcnow(),
                )
            )

            # Switch player if game continues
            if status == GameStatus.IN_PROGRESS:
                active_game.current_player = Player.USER
                active_game.available_moves = plugin.get_available_moves(
                    new_state, Player.USER
                )
            else:
                active_game.available_moves = []

            # Save updated state
            await self._update_session_game(tool_call.session_id, active_game)

            # Render board
            board_text = plugin.render_board_text(new_state)
            board_json = plugin.render_board_json(new_state)
            move_desc = plugin.format_move_description(
                move, Player.COMPANION, state_before, new_state
            )

            duration_ms = (time.time() - start_time) * 1000

            # Build output
            output = f"{move_desc}\n\n{board_text}"
            if thinking:
                output = f"*{thinking}*\n\n{output}"

            if status == GameStatus.WON:
                output += "\n\nI win! Good game!"
            elif status == GameStatus.LOST:
                output += "\n\nYou win! Well played!"
            elif status == GameStatus.DRAW:
                output += "\n\nIt's a draw! Good game!"
            else:
                output += "\n\nYour turn!"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "move": move,
                    "board_json": board_json,
                    "status": status.value,
                    "winner": winner.value if winner else None,
                    "current_player": active_game.current_player.value,
                },
            )

        except Exception as e:
            logger.exception("game_move_failed", error=str(e))
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=(time.time() - start_time) * 1000,
            )

    async def _get_session_game(self, session_id: str) -> ActiveGame | None:
        """Get current game from session metadata."""
        response = await self.http_client.get(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}",
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
            },
        )
        response.raise_for_status()

        data = response.json()
        active_game_data = data.get("data", {}).get("metadata", {}).get("activeGame")
        if not active_game_data:
            return None

        return ActiveGame.from_session_metadata(active_game_data)

    async def _update_session_game(
        self,
        session_id: str,
        active_game: ActiveGame,
    ) -> None:
        """Update session metadata with game state."""
        response = await self.http_client.patch(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}/metadata",
            json={"activeGame": active_game.to_session_metadata()},
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()


class GameStateHandler(ToolHandler):
    """Handler for querying current game state."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "game_state"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Get current game state."""
        start_time = time.time()

        try:
            # Fetch current game state
            active_game = await self._get_session_game(tool_call.session_id)
            if not active_game:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game. Use game_start to start a new game.",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Get game plugin
            plugin = get_game_plugin(active_game.game_type)
            if not plugin:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=f"Game plugin not found for {active_game.game_type.value}",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Build state dict
            state = {
                "board": active_game.board,
                "companionSymbol": active_game.companion_symbol,
                "userSymbol": active_game.user_symbol,
            }

            # Render board
            board_text = plugin.render_board_text(state)
            board_json = plugin.render_board_json(state)
            is_user_turn = active_game.current_player == Player.USER

            duration_ms = (time.time() - start_time) * 1000

            # Build output
            output = (
                f"Current game: {plugin.display_name}\n"
                f"Status: {active_game.status.value}\n"
                f"Current turn: {'User' if is_user_turn else 'You (Companion)'}\n\n"
                f"{board_text}"
            )

            if active_game.status == GameStatus.IN_PROGRESS:
                if not is_user_turn:
                    output += f"\n\nYour available moves: {', '.join(active_game.available_moves[:10])}"
                    if len(active_game.available_moves) > 10:
                        output += f" ... ({len(active_game.available_moves)} total)"
            else:
                if active_game.winner:
                    winner_name = "You" if active_game.winner == Player.COMPANION else "User"
                    output += f"\n\nGame over - {winner_name} won!"
                else:
                    output += f"\n\nGame over - {active_game.status.value}"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "game_type": active_game.game_type.value,
                    "board_json": board_json,
                    "status": active_game.status.value,
                    "current_player": active_game.current_player.value,
                    "is_user_turn": is_user_turn,
                    "available_moves": active_game.available_moves,
                },
            )

        except Exception as e:
            logger.exception("game_state_failed", error=str(e))
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=(time.time() - start_time) * 1000,
            )

    async def _get_session_game(self, session_id: str) -> ActiveGame | None:
        """Get current game from session metadata."""
        response = await self.http_client.get(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}",
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
            },
        )
        response.raise_for_status()

        data = response.json()
        active_game_data = data.get("data", {}).get("metadata", {}).get("activeGame")
        if not active_game_data:
            return None

        return ActiveGame.from_session_metadata(active_game_data)


class GameResignHandler(ToolHandler):
    """Handler for resigning from a game."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "game_resign"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Resign from the current game."""
        start_time = time.time()

        try:
            reason = tool_call.arguments.get("reason")

            # Fetch current game state
            active_game = await self._get_session_game(tool_call.session_id)
            if not active_game:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="No active game to resign from.",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            if active_game.status != GameStatus.IN_PROGRESS:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error="Game is already over.",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Get game plugin for display name
            plugin = get_game_plugin(active_game.game_type)
            game_name = plugin.display_name if plugin else active_game.game_type.value

            # Update game state
            active_game.status = GameStatus.RESIGNED
            active_game.winner = Player.USER
            active_game.available_moves = []

            # Save updated state
            await self._update_session_game(tool_call.session_id, active_game)

            duration_ms = (time.time() - start_time) * 1000

            output = f"I resign from our {game_name} game. You win!"
            if reason:
                output += f" ({reason})"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "game_type": active_game.game_type.value,
                    "status": "resigned",
                    "winner": "user",
                },
            )

        except Exception as e:
            logger.exception("game_resign_failed", error=str(e))
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=(time.time() - start_time) * 1000,
            )

    async def _get_session_game(self, session_id: str) -> ActiveGame | None:
        """Get current game from session metadata."""
        response = await self.http_client.get(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}",
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
            },
        )
        response.raise_for_status()

        data = response.json()
        active_game_data = data.get("data", {}).get("metadata", {}).get("activeGame")
        if not active_game_data:
            return None

        return ActiveGame.from_session_metadata(active_game_data)

    async def _update_session_game(
        self,
        session_id: str,
        active_game: ActiveGame,
    ) -> None:
        """Update session metadata with game state."""
        response = await self.http_client.patch(
            f"{self.settings.gateway_internal_url}/api/v1/internal/sessions/{session_id}/metadata",
            json={"activeGame": active_game.to_session_metadata()},
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
