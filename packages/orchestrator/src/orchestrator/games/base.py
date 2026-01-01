"""Base class for game plugins."""

from abc import ABC, abstractmethod
from typing import Any

from orchestrator.models.games import GameStatus, GameType, Player


class GamePlugin(ABC):
    """Abstract base class for game implementations.

    Each game (chess, tic-tac-toe, etc.) implements this interface.
    The plugin handles game logic, move validation, and board rendering.
    """

    @property
    @abstractmethod
    def game_type(self) -> GameType:
        """Return the type of game this plugin handles."""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable name of the game."""
        ...

    @abstractmethod
    def create_initial_state(
        self,
        companion_plays_first: bool = False,
    ) -> dict[str, Any]:
        """Create the initial game board state.

        Args:
            companion_plays_first: If True, companion makes the first move.

        Returns:
            Game-specific board state dictionary.
        """
        ...

    @abstractmethod
    def validate_move(
        self,
        state: dict[str, Any],
        move: str,
        player: Player,
    ) -> tuple[bool, str | None]:
        """Validate if a move is legal.

        Args:
            state: Current game board state.
            move: Move notation (game-specific, e.g., "e2e4" or "A1").
            player: The player making the move.

        Returns:
            Tuple of (is_valid, error_message).
            If valid, error_message is None.
        """
        ...

    @abstractmethod
    def apply_move(
        self,
        state: dict[str, Any],
        move: str,
        player: Player,
    ) -> dict[str, Any]:
        """Apply a move and return the new state.

        Args:
            state: Current game board state.
            move: Move notation.
            player: The player making the move.

        Returns:
            New game board state after the move.
        """
        ...

    @abstractmethod
    def get_available_moves(
        self,
        state: dict[str, Any],
        player: Player,
    ) -> list[str]:
        """Get list of available moves for a player.

        Args:
            state: Current game board state.
            player: The player whose moves to list.

        Returns:
            List of valid move notations.
        """
        ...

    @abstractmethod
    def check_game_over(
        self,
        state: dict[str, Any],
    ) -> tuple[GameStatus, Player | None]:
        """Check if the game is over.

        Args:
            state: Current game board state.

        Returns:
            Tuple of (status, winner).
            winner is None if game is in progress or is a draw.
        """
        ...

    @abstractmethod
    def render_board_text(self, state: dict[str, Any]) -> str:
        """Render ASCII representation of the board for LLM context.

        Args:
            state: Current game board state.

        Returns:
            ASCII art string of the board.
        """
        ...

    @abstractmethod
    def render_board_json(self, state: dict[str, Any]) -> dict[str, Any]:
        """Render JSON representation for frontend rendering.

        Args:
            state: Current game board state.

        Returns:
            JSON-serializable dict for the frontend.
        """
        ...

    def get_symbols(
        self,
        companion_plays_first: bool = False,
    ) -> tuple[str, str]:
        """Get symbols for companion and user.

        Override in subclasses for games that use symbols (e.g., X/O).

        Args:
            companion_plays_first: Whether companion goes first.

        Returns:
            Tuple of (companion_symbol, user_symbol).
        """
        return ("", "")

    def format_move_description(
        self,
        move: str,
        player: Player,
        state_before: dict[str, Any],
        state_after: dict[str, Any],
    ) -> str:
        """Format a human-readable description of a move.

        Args:
            move: The move notation.
            player: Who made the move.
            state_before: Board state before the move.
            state_after: Board state after the move.

        Returns:
            Human-readable move description.
        """
        player_name = "Companion" if player == Player.COMPANION else "User"
        return f"{player_name} played {move}"
