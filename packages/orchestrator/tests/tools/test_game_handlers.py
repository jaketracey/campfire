"""
Unit tests for the rewritten game tool handlers. Verifies they correctly
translate tool calls into gateway HTTP requests and surface responses (or
structured errors) back to the LLM.
"""
from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall
from orchestrator.tools.game_handlers import (
    GameMoveHandler,
    GameResignHandler,
    GameStartHandler,
    GameStateHandler,
)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        gateway_internal_url="http://gateway:3002",
        internal_service_key="test-key",
    )


@pytest.fixture
def event_emitter() -> EventEmitter:
    emitter = AsyncMock(spec=EventEmitter)
    emitter.emit = AsyncMock()
    return emitter


@pytest.fixture
def http_client() -> AsyncMock:
    return AsyncMock(spec=httpx.AsyncClient)


def _make_response(status_code: int, body: dict) -> httpx.Response:
    """Build a real `httpx.Response` so `.status_code`/`.json()` behave normally."""
    return httpx.Response(
        status_code,
        json=body,
        request=httpx.Request("GET", "http://gateway:3002/"),
    )


def _tool_call(name: str, arguments: dict) -> ToolCall:
    return ToolCall(
        id="call-1",
        name=name,
        arguments=arguments,
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
    )


class TestGameStartHandler:
    async def test_success_returns_board_text_and_metadata(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            return_value=_make_response(
                200,
                {
                    "data": {
                        "game": {
                            "id": "11111111-1111-1111-1111-111111111111",
                            "gameType": "tic_tac_toe",
                            "currentPlayer": "user",
                            "version": 0,
                            "availableMoves": ["A1", "B2"],
                        },
                        "boardText": "EMPTY BOARD",
                        "boardJson": {"type": "tic_tac_toe"},
                        "message": "Started a new game.",
                    }
                },
            )
        )
        handler = GameStartHandler(settings, event_emitter, http_client)
        result = await handler.execute(
            _tool_call("game_start", {"game_type": "tic_tac_toe"})
        )
        assert result.success is True
        assert "EMPTY BOARD" in result.output
        assert result.metadata["game_id"] == "11111111-1111-1111-1111-111111111111"
        assert result.metadata["current_player"] == "user"

    async def test_rejects_invalid_game_type(self, settings, event_emitter, http_client):
        handler = GameStartHandler(settings, event_emitter, http_client)
        ok, err = handler.validate_arguments({"game_type": "parcheesi"})
        assert ok is False
        assert "Invalid game_type" in (err or "")

    async def test_gateway_error_surfaces_as_failed_tool_result(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            return_value=_make_response(
                409,
                {"error": "GAME_ALREADY_ACTIVE", "message": "One already in progress"},
            )
        )
        handler = GameStartHandler(settings, event_emitter, http_client)
        result = await handler.execute(
            _tool_call("game_start", {"game_type": "tic_tac_toe"})
        )
        assert result.success is False
        assert "One already in progress" in (result.error or "")
        assert result.metadata["code"] == "GAME_ALREADY_ACTIVE"


class TestGameMoveHandler:
    async def test_applies_move_after_resolving_active_game(
        self, settings, event_emitter, http_client
    ):
        # First call: GET active-game. Second: POST /games/:id/moves.
        http_client.request = AsyncMock(
            side_effect=[
                _make_response(
                    200,
                    {
                        "data": {
                            "game": {"id": "abc", "currentPlayer": "companion"},
                            "boardText": "...",
                            "boardJson": {},
                            "isUserTurn": False,
                            "availableMoves": ["A1", "B2"],
                        }
                    },
                ),
                _make_response(
                    200,
                    {
                        "data": {
                            "game": {
                                "id": "abc",
                                "currentPlayer": "user",
                                "version": 1,
                                "availableMoves": ["A1"],
                            },
                            "boardText": "board after move",
                            "boardJson": {},
                            "moveValid": True,
                            "gameOver": False,
                            "winner": None,
                            "message": "companion played B2",
                        }
                    },
                ),
            ]
        )
        handler = GameMoveHandler(settings, event_emitter, http_client)
        result = await handler.execute(
            _tool_call("game_move", {"move": "B2", "thinking": "central square"})
        )
        assert result.success is True
        assert "I played B2" in result.output
        assert "board after move" in result.output
        assert result.metadata["game_over"] is False
        assert http_client.request.await_count == 2

    async def test_returns_structured_error_when_no_active_game(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            return_value=_make_response(200, {"data": None})
        )
        handler = GameMoveHandler(settings, event_emitter, http_client)
        result = await handler.execute(_tool_call("game_move", {"move": "A1"}))
        assert result.success is False
        assert "No active game" in (result.error or "")

    async def test_invalid_move_surfaces_to_llm(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            side_effect=[
                _make_response(
                    200,
                    {
                        "data": {
                            "game": {"id": "abc"},
                            "boardText": "",
                            "boardJson": {},
                            "isUserTurn": False,
                            "availableMoves": ["A1"],
                        }
                    },
                ),
                _make_response(
                    400,
                    {"error": "INVALID_MOVE", "message": "Cell is already occupied."},
                ),
            ]
        )
        handler = GameMoveHandler(settings, event_emitter, http_client)
        result = await handler.execute(_tool_call("game_move", {"move": "A1"}))
        assert result.success is False
        assert "Move rejected" in (result.error or "")
        assert result.metadata["code"] == "INVALID_MOVE"


class TestGameStateHandler:
    async def test_reports_whose_turn(self, settings, event_emitter, http_client):
        http_client.request = AsyncMock(
            return_value=_make_response(
                200,
                {
                    "data": {
                        "game": {"id": "abc", "currentPlayer": "companion", "version": 3},
                        "boardText": "  X . .\n  . O .\n  . . .",
                        "boardJson": {},
                        "isUserTurn": False,
                        "availableMoves": ["A2", "A3", "B1", "B3"],
                    }
                },
            )
        )
        handler = GameStateHandler(settings, event_emitter, http_client)
        result = await handler.execute(_tool_call("game_state", {}))
        assert result.success is True
        assert "It is your turn." in result.output
        assert "Available moves:" in result.output


class TestGameResignHandler:
    async def test_resigns_after_resolving_active_game(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            side_effect=[
                _make_response(
                    200,
                    {
                        "data": {
                            "game": {"id": "abc"},
                            "boardText": "",
                            "boardJson": {},
                            "isUserTurn": False,
                            "availableMoves": [],
                        }
                    },
                ),
                _make_response(200, {"data": {}}),
            ]
        )
        handler = GameResignHandler(settings, event_emitter, http_client)
        result = await handler.execute(
            _tool_call("game_resign", {"reason": "too tough"})
        )
        assert result.success is True
        assert "I resign" in result.output
        assert "too tough" in result.output

    async def test_no_active_game_is_a_failure(
        self, settings, event_emitter, http_client
    ):
        http_client.request = AsyncMock(
            return_value=_make_response(200, {"data": None})
        )
        handler = GameResignHandler(settings, event_emitter, http_client)
        result = await handler.execute(_tool_call("game_resign", {}))
        assert result.success is False
        assert "No active game" in (result.error or "")
