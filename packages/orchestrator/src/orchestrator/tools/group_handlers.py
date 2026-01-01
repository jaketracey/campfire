"""Tool handler implementations for group chat functionality."""

import time
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.events import EventType, ToolEvent
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()


class InviteFriendHandler(ToolHandler):
    """Handler for inviting a friend companion to join the conversation."""

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
        return "invite_friend"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate that required arguments are present."""
        if not arguments.get("friend_companion_id"):
            return False, "friend_companion_id is required"
        if not arguments.get("reason"):
            return False, "reason is required"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute the invite friend operation."""
        start_time = time.time()

        try:
            friend_companion_id = tool_call.arguments["friend_companion_id"]
            reason = tool_call.arguments["reason"]

            logger.info(
                "invite_friend_handler",
                session_id=str(tool_call.session_id),
                friend_companion_id=friend_companion_id,
                invited_by=str(tool_call.companion_id),
                reason=reason,
            )

            # Call the gateway API to invite the companion
            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/sessions/{tool_call.session_id}/participants",
                json={
                    "companionId": friend_companion_id,
                    "invitedByCompanionId": str(tool_call.companion_id),
                },
                headers={
                    "Authorization": f"Bearer {self._get_user_token(tool_call.user_id)}",
                    "Content-Type": "application/json",
                },
            )

            duration_ms = (time.time() - start_time) * 1000

            if response.status_code == 201:
                result = response.json()
                companion_name = result.get("companionName", "Friend")

                # Emit event
                await self.event_emitter.emit(
                    ToolEvent(
                        type=EventType.TOOL_COMPLETED,
                        session_id=tool_call.session_id,
                        user_id=tool_call.user_id,
                        companion_id=tool_call.companion_id,
                        tool_name=self.name,
                        tool_call_id=tool_call.id,
                        output={
                            "success": True,
                            "friend_companion_id": friend_companion_id,
                            "companion_name": companion_name,
                        },
                        duration_ms=duration_ms,
                    )
                )

                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=True,
                    output=f"Successfully invited {companion_name} to join the conversation. Reason: {reason}",
                    duration_ms=duration_ms,
                    metadata={
                        "friend_companion_id": friend_companion_id,
                        "companion_name": companion_name,
                        "reason": reason,
                    },
                )
            else:
                error_data = response.json()
                error_msg = error_data.get("message", f"Failed to invite friend: {response.status_code}")

                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=error_msg,
                    duration_ms=duration_ms,
                )

        except Exception as e:
            logger.exception("invite_friend_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    def _get_user_token(self, user_id) -> str:
        """Get an internal service token for the user.

        In a real implementation, this would use a service-to-service auth mechanism.
        For now, we use the internal service key.
        """
        return self.settings.internal_service_key


class DismissFriendHandler(ToolHandler):
    """Handler for dismissing a friend companion from the conversation."""

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
        return "dismiss_friend"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate that required arguments are present."""
        if not arguments.get("friend_companion_id"):
            return False, "friend_companion_id is required"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute the dismiss friend operation."""
        start_time = time.time()

        try:
            friend_companion_id = tool_call.arguments["friend_companion_id"]
            reason = tool_call.arguments.get("reason", "")

            logger.info(
                "dismiss_friend_handler",
                session_id=str(tool_call.session_id),
                friend_companion_id=friend_companion_id,
                dismissed_by=str(tool_call.companion_id),
                reason=reason,
            )

            # Call the gateway API to dismiss the companion
            response = await self.http_client.delete(
                f"{self.settings.gateway_internal_url}/api/v1/sessions/{tool_call.session_id}/participants/{friend_companion_id}",
                headers={
                    "Authorization": f"Bearer {self._get_user_token(tool_call.user_id)}",
                },
            )

            duration_ms = (time.time() - start_time) * 1000

            if response.status_code == 204:
                # Emit event
                await self.event_emitter.emit(
                    ToolEvent(
                        type=EventType.TOOL_COMPLETED,
                        session_id=tool_call.session_id,
                        user_id=tool_call.user_id,
                        companion_id=tool_call.companion_id,
                        tool_name=self.name,
                        tool_call_id=tool_call.id,
                        output={
                            "success": True,
                            "friend_companion_id": friend_companion_id,
                        },
                        duration_ms=duration_ms,
                    )
                )

                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=True,
                    output=f"Friend has left the conversation." + (f" Reason: {reason}" if reason else ""),
                    duration_ms=duration_ms,
                    metadata={
                        "friend_companion_id": friend_companion_id,
                        "reason": reason,
                    },
                )
            else:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get("message", f"Failed to dismiss friend: {response.status_code}")

                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=self.name,
                    success=False,
                    error=error_msg,
                    duration_ms=duration_ms,
                )

        except Exception as e:
            logger.exception("dismiss_friend_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    def _get_user_token(self, user_id) -> str:
        """Get an internal service token for the user."""
        return self.settings.internal_service_key
