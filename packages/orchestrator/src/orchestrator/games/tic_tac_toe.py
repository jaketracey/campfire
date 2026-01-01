"""Tic-tac-toe game plugin."""

import copy
from typing import Any

from orchestrator.games.base import GamePlugin
from orchestrator.models.games import GameStatus, GameType, Player


class TicTacToePlugin(GamePlugin):
    """Tic-tac-toe game implementation.

    Board is a 3x3 grid represented as a list of lists.
    Each cell is "", "X", or "O".
    Move notation is "A1", "B2", etc. (column letter + row number).
    """

    # Cell labels for move notation
    COLUMNS = ["A", "B", "C"]
    ROWS = ["1", "2", "3"]

    # Winning combinations (as (row, col) tuples)
    WINNING_LINES = [
        # Rows
        [(0, 0), (0, 1), (0, 2)],
        [(1, 0), (1, 1), (1, 2)],
        [(2, 0), (2, 1), (2, 2)],
        # Columns
        [(0, 0), (1, 0), (2, 0)],
        [(0, 1), (1, 1), (2, 1)],
        [(0, 2), (1, 2), (2, 2)],
        # Diagonals
        [(0, 0), (1, 1), (2, 2)],
        [(0, 2), (1, 1), (2, 0)],
    ]

    @property
    def game_type(self) -> GameType:
        return GameType.TIC_TAC_TOE

    @property
    def display_name(self) -> str:
        return "Tic-Tac-Toe"

    def create_initial_state(
        self,
        companion_plays_first: bool = False,
    ) -> dict[str, Any]:
        """Create empty 3x3 board."""
        return {
            "board": [["", "", ""], ["", "", ""], ["", "", ""]],
            "companionSymbol": "X" if companion_plays_first else "O",
            "userSymbol": "O" if companion_plays_first else "X",
        }

    def get_symbols(
        self,
        companion_plays_first: bool = False,
    ) -> tuple[str, str]:
        """X goes first, so assign based on who plays first."""
        if companion_plays_first:
            return ("X", "O")
        return ("O", "X")

    def _parse_move(self, move: str) -> tuple[int, int] | None:
        """Parse move notation to (row, col) tuple."""
        move = move.upper().strip()
        if len(move) != 2:
            return None

        col_str, row_str = move[0], move[1]

        if col_str not in self.COLUMNS or row_str not in self.ROWS:
            return None

        col = self.COLUMNS.index(col_str)
        row = self.ROWS.index(row_str)

        return (row, col)

    def _format_move(self, row: int, col: int) -> str:
        """Format (row, col) to move notation."""
        return f"{self.COLUMNS[col]}{self.ROWS[row]}"

    def validate_move(
        self,
        state: dict[str, Any],
        move: str,
        player: Player,
    ) -> tuple[bool, str | None]:
        """Check if the move is valid."""
        coords = self._parse_move(move)
        if coords is None:
            return (
                False,
                f"Invalid move format '{move}'. Use notation like A1, B2, C3.",
            )

        row, col = coords
        board = state["board"]

        if board[row][col] != "":
            return (False, f"Cell {move} is already occupied.")

        return (True, None)

    def apply_move(
        self,
        state: dict[str, Any],
        move: str,
        player: Player,
    ) -> dict[str, Any]:
        """Apply move to board."""
        coords = self._parse_move(move)
        if coords is None:
            raise ValueError(f"Invalid move: {move}")

        row, col = coords
        new_state = copy.deepcopy(state)

        # Determine symbol based on player
        if player == Player.COMPANION:
            symbol = state["companionSymbol"]
        else:
            symbol = state["userSymbol"]

        new_state["board"][row][col] = symbol

        return new_state

    def get_available_moves(
        self,
        state: dict[str, Any],
        player: Player,
    ) -> list[str]:
        """Get all empty cells as available moves."""
        board = state["board"]
        moves = []

        for row in range(3):
            for col in range(3):
                if board[row][col] == "":
                    moves.append(self._format_move(row, col))

        return moves

    def _check_winner(self, board: list[list[str]]) -> str | None:
        """Check if there's a winner. Returns winning symbol or None."""
        for line in self.WINNING_LINES:
            cells = [board[r][c] for r, c in line]
            if cells[0] != "" and cells[0] == cells[1] == cells[2]:
                return cells[0]
        return None

    def check_game_over(
        self,
        state: dict[str, Any],
    ) -> tuple[GameStatus, Player | None]:
        """Check if game is over."""
        board = state["board"]
        winner_symbol = self._check_winner(board)

        if winner_symbol:
            # Determine who won based on symbol
            if winner_symbol == state["companionSymbol"]:
                return (GameStatus.WON, Player.COMPANION)
            else:
                return (GameStatus.LOST, Player.USER)

        # Check for draw (all cells filled)
        empty_cells = sum(1 for row in board for cell in row if cell == "")
        if empty_cells == 0:
            return (GameStatus.DRAW, None)

        return (GameStatus.IN_PROGRESS, None)

    def render_board_text(self, state: dict[str, Any]) -> str:
        """Render ASCII board for LLM context."""
        board = state["board"]

        lines = []
        lines.append("    A   B   C")
        lines.append("  +---+---+---+")

        for row_idx, row in enumerate(board):
            row_num = self.ROWS[row_idx]
            cells = [cell if cell else " " for cell in row]
            lines.append(f"{row_num} | {cells[0]} | {cells[1]} | {cells[2]} |")
            lines.append("  +---+---+---+")

        return "\n".join(lines)

    def render_board_json(self, state: dict[str, Any]) -> dict[str, Any]:
        """Render JSON for frontend."""
        return {
            "type": "tic_tac_toe",
            "board": state["board"],
            "companionSymbol": state["companionSymbol"],
            "userSymbol": state["userSymbol"],
        }

    def format_move_description(
        self,
        move: str,
        player: Player,
        state_before: dict[str, Any],
        state_after: dict[str, Any],
    ) -> str:
        """Format a human-readable move description."""
        coords = self._parse_move(move)
        if not coords:
            return f"Invalid move: {move}"

        row, col = coords
        symbol = (
            state_before["companionSymbol"]
            if player == Player.COMPANION
            else state_before["userSymbol"]
        )
        player_name = "I" if player == Player.COMPANION else "You"

        return f"{player_name} placed {symbol} at {move.upper()}"
