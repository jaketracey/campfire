"""Thin HTTP client wrapping the gateway's `/internal/games/*` API.

All game logic is server-authoritative on the gateway. The orchestrator and
its tool handlers are pure consumers: they never run an engine, never read or
write game state directly. This keeps state consistent across the realtime
path (user moves via WebSocket) and the LLM path (companion moves via tool
call) — both serialize through the same gateway service.
"""
from __future__ import annotations

from typing import Any

import httpx
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()


class GameClientError(Exception):
    """A gateway game API call returned a structured error."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.status_code = status_code


class GameClient:
    """Async HTTP wrapper for the gateway's `/internal/games/*` endpoints.

    Handlers and the `/internal/companion-turn` endpoint construct one per
    request (sharing the `httpx.AsyncClient` the router already owns) and call
    the narrow surface they need. Methods raise `GameClientError` on 4xx/5xx
    and return parsed dicts on success.
    """

    def __init__(self, settings: Settings, http_client: httpx.AsyncClient):
        self.settings = settings
        self.http_client = http_client

    @property
    def _base_url(self) -> str:
        # Strip trailing slash to make URL composition predictable.
        return self.settings.gateway_internal_url.rstrip("/")

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "X-Internal-Service-Key": self.settings.internal_service_key,
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}/api/v1{path}"
        try:
            response = await self.http_client.request(
                method,
                url,
                json=json,
                headers=self._headers,
            )
        except httpx.HTTPError as e:
            logger.exception("game_client_network_error", method=method, path=path)
            raise GameClientError("NETWORK_ERROR", str(e), 0) from e

        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = {"error": "UNKNOWN", "message": response.text}
            raise GameClientError(
                body.get("error", "UNKNOWN"),
                body.get("message", "Request failed"),
                response.status_code,
            )

        if not response.content:
            return {}
        return response.json().get("data", {})

    # ---------- lifecycle ----------

    async def start_game(
        self,
        *,
        chat_session_id: str,
        user_id: str,
        companion_id: str,
        game_type: str,
        companion_plays_first: bool = False,
        difficulty: str | None = None,
    ) -> dict[str, Any]:
        """Returns GameStartResult: `{ game, boardText, boardJson, message }`."""
        payload: dict[str, Any] = {
            "chatSessionId": chat_session_id,
            "userId": user_id,
            "companionId": companion_id,
            "gameType": game_type,
            "companionPlaysFirst": companion_plays_first,
        }
        if difficulty:
            payload["difficulty"] = difficulty
        return await self._request("POST", "/internal/games", json=payload)

    async def apply_move(
        self,
        *,
        game_id: str,
        player: str,
        move: str,
        client_version: int | None = None,
    ) -> dict[str, Any]:
        """Returns GameMoveResult: `{ game, boardText, boardJson, moveValid, ... }`."""
        payload: dict[str, Any] = {"player": player, "move": move}
        if client_version is not None:
            payload["clientVersion"] = client_version
        return await self._request(
            "POST", f"/internal/games/{game_id}/moves", json=payload
        )

    async def resign(
        self,
        *,
        game_id: str,
        player: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"player": player}
        if reason:
            payload["reason"] = reason
        return await self._request(
            "POST", f"/internal/games/{game_id}/resign", json=payload
        )

    async def get_game(self, game_id: str) -> dict[str, Any]:
        """Returns GameStateResult: `{ game, boardText, boardJson, isUserTurn, availableMoves }`."""
        return await self._request("GET", f"/internal/games/{game_id}")

    async def get_active_game(self, chat_session_id: str) -> dict[str, Any] | None:
        """Return the active game for a chat session, or None if no active game exists."""
        result = await self._request(
            "GET", f"/internal/chat-sessions/{chat_session_id}/active-game"
        )
        # Gateway returns `{ data: null }` when no active game — `_request`
        # unwraps `data`, so None/empty dict both mean no active game.
        if not result or not result.get("game"):
            return None
        return result
