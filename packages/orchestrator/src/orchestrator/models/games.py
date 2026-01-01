"""Game models for companion gaming features."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class GameType(str, Enum):
    """Supported game types."""

    CHESS = "chess"
    TIC_TAC_TOE = "tic_tac_toe"
    CONNECT_FOUR = "connect_four"


class GameStatus(str, Enum):
    """Current status of a game."""

    IN_PROGRESS = "in_progress"
    WON = "won"  # Companion won
    LOST = "lost"  # User won
    DRAW = "draw"
    RESIGNED = "resigned"


class Player(str, Enum):
    """Player identifier."""

    USER = "user"
    COMPANION = "companion"


class GameMove(BaseModel):
    """A single move in a game."""

    player: Player
    notation: str  # Game-specific move notation (e.g., "e2e4", "A1")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True


class ActiveGame(BaseModel):
    """State of an active game stored in session metadata."""

    game_type: GameType
    board: Any  # Game-specific board representation
    current_player: Player
    status: GameStatus = GameStatus.IN_PROGRESS
    move_history: list[GameMove] = Field(default_factory=list)
    available_moves: list[str] = Field(default_factory=list)
    winner: Player | None = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    companion_symbol: str | None = None  # e.g., "X" or "O" for tic-tac-toe
    user_symbol: str | None = None

    def to_session_metadata(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict for session metadata storage."""
        return {
            "gameType": self.game_type.value,
            "board": self.board,
            "currentPlayer": self.current_player.value,
            "status": self.status.value,
            "moveHistory": [
                {
                    "player": m.player.value,
                    "notation": m.notation,
                    "timestamp": m.timestamp.isoformat(),
                }
                for m in self.move_history
            ],
            "availableMoves": self.available_moves,
            "winner": self.winner.value if self.winner else None,
            "startedAt": self.started_at.isoformat(),
            "companionSymbol": self.companion_symbol,
            "userSymbol": self.user_symbol,
        }

    @classmethod
    def from_session_metadata(cls, data: dict[str, Any]) -> "ActiveGame":
        """Create from session metadata dict."""
        return cls(
            game_type=GameType(data["gameType"]),
            board=data["board"],
            current_player=Player(data["currentPlayer"]),
            status=GameStatus(data["status"]),
            move_history=[
                GameMove(
                    player=Player(m["player"]),
                    notation=m["notation"],
                    timestamp=datetime.fromisoformat(m["timestamp"]),
                )
                for m in data.get("moveHistory", [])
            ],
            available_moves=data.get("availableMoves", []),
            winner=Player(data["winner"]) if data.get("winner") else None,
            started_at=datetime.fromisoformat(data["startedAt"]),
            companion_symbol=data.get("companionSymbol"),
            user_symbol=data.get("userSymbol"),
        )


class GameStartResult(BaseModel):
    """Result of starting a new game."""

    game: ActiveGame
    board_text: str  # ASCII representation for LLM
    board_json: dict[str, Any]  # JSON for frontend rendering
    message: str  # Message to show user


class GameMoveResult(BaseModel):
    """Result of making a move."""

    game: ActiveGame
    board_text: str
    board_json: dict[str, Any]
    move_valid: bool
    error_message: str | None = None
    game_over: bool = False
    winner: Player | None = None
    message: str  # Message describing the move


class GameStateResult(BaseModel):
    """Result of querying game state."""

    game: ActiveGame
    board_text: str
    board_json: dict[str, Any]
    is_user_turn: bool
    available_moves: list[str]
