"""Tool routing and execution system."""

import asyncio
from datetime import datetime
import time
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.events import EventType, ToolEvent
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler
from orchestrator.tools.handlers import (
    GiftAcknowledgeHandler,
    GiftGenerateHandler,
    ImageAnalysisHandler,
    ImageGenerationHandler,
    KGProposeHandler,
    MemoryDeleteHandler,
    MemoryReadHandler,
    MemoryUpdateHandler,
    MemoryWriteHandler,
    VaultProjectionHandler,
    VideoGenerationHandler,
)
from orchestrator.tools.game_handlers import (
    GameMoveHandler,
    GameResignHandler,
    GameStartHandler,
    GameStateHandler,
)
from orchestrator.tools.group_handlers import (
    DismissFriendHandler,
    InviteFriendHandler,
)
from orchestrator.tools.relationship_analytics_handler import (
    RelationshipAnalyticsHandler,
)
from orchestrator.tools.web_search_handler import WebSearchHandler

logger = structlog.get_logger()


class ToolRouter:
    """Routes tool calls to appropriate handlers and manages execution."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client or httpx.AsyncClient(timeout=30.0)
        self._handlers: dict[str, ToolHandler] = {}
        self._initialize_handlers()

    def _initialize_handlers(self) -> None:
        """Initialize all tool handlers."""
        handlers: list[ToolHandler] = [
            MemoryReadHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            MemoryWriteHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            MemoryUpdateHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            MemoryDeleteHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            KGProposeHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            ImageAnalysisHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            ImageGenerationHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            VideoGenerationHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            VaultProjectionHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            GiftGenerateHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            GiftAcknowledgeHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            # Game handlers
            GameStartHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            GameMoveHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            GameStateHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            GameResignHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            # Group chat handlers
            InviteFriendHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            DismissFriendHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            # Search handler
            WebSearchHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            # Relationship analytics handler
            RelationshipAnalyticsHandler(
                self.settings, self.event_emitter, self.http_client
            ),
        ]

        for handler in handlers:
            self.register_handler(handler)

    def register_handler(self, handler: ToolHandler) -> None:
        """Register a tool handler."""
        self._handlers[handler.name] = handler
        logger.debug("tool_handler_registered", tool_name=handler.name)

    def get_handler(self, tool_name: str) -> ToolHandler | None:
        """Get the handler for a tool."""
        return self._handlers.get(tool_name)

    async def execute_tool(self, tool_call: ToolCall) -> ToolResult:
        """Execute a single tool call."""
        start_time = time.time()
        started_at = datetime.utcnow()
        running_tool_call = tool_call.copy(update={"status": "running", "started_at": started_at})

        handler = self.get_handler(tool_call.name)
        if not handler:
            logger.warning("unknown_tool", tool_name=tool_call.name)
            error = f"Unknown tool: {tool_call.name}"
            ended_at = datetime.utcnow()
            unknown_result = ToolResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                success=False,
                error=error,
                status="failed",
                attempt_count=tool_call.attempt_count,
                started_at=started_at,
                ended_at=ended_at,
                duration_ms=(ended_at - started_at).total_seconds() * 1000,
            )

            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_FAILED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    duration_ms=unknown_result.duration_ms,
                    success=False,
                    error_message=error,
                )
            )

            return unknown_result

        # Emit tool invoked event
        await self.event_emitter.emit(
            ToolEvent(
                type=EventType.TOOL_INVOKED,
                session_id=tool_call.session_id,
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                tool_name=tool_call.name,
                tool_call_id=tool_call.id,
                input_params=tool_call.arguments,
            )
        )

        try:
            # Validate arguments
            is_valid, validation_error = handler.validate_arguments(
                tool_call.arguments
            )
            if not is_valid:
                validation_error_message = f"Invalid arguments: {validation_error}"
                ended_at = datetime.utcnow()
                validation_result = ToolResult(
                    tool_call_id=tool_call.id,
                    name=tool_call.name,
                    success=False,
                    error=validation_error_message,
                    status="failed",
                    attempt_count=tool_call.attempt_count,
                    started_at=running_tool_call.started_at,
                    ended_at=ended_at,
                    duration_ms=(ended_at - started_at).total_seconds() * 1000,
                )

                await self.event_emitter.emit(
                    ToolEvent(
                        type=EventType.TOOL_FAILED,
                        session_id=tool_call.session_id,
                        user_id=tool_call.user_id,
                        companion_id=tool_call.companion_id,
                        tool_name=tool_call.name,
                        tool_call_id=tool_call.id,
                        duration_ms=validation_result.duration_ms,
                        success=False,
                        error_message=validation_error_message,
                    )
                )
                return validation_result

            # Execute the tool
            result = await handler.execute(running_tool_call)
            ended_at = datetime.utcnow()
            result = result.copy(
                update={
                    "status": "succeeded" if result.success else "failed",
                    "attempt_count": running_tool_call.attempt_count,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "duration_ms": (ended_at - started_at).total_seconds() * 1000,
                    "name": running_tool_call.name,
                }
            )

            # Emit tool completed event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_COMPLETED
                    if result.success
                    else EventType.TOOL_FAILED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    output=result.output,
                    duration_ms=result.duration_ms,
                    success=result.success,
                )
            )

            return result

        except Exception as e:
            ended_at = datetime.utcnow()
            execution_duration_ms = (ended_at - started_at).total_seconds() * 1000
            logger.exception(
                "tool_execution_failed",
                tool_name=tool_call.name,
                error=str(e),
            )

            # Emit tool failed event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_FAILED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    duration_ms=execution_duration_ms,
                    success=False,
                    error_message=str(e),
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                success=False,
                error=str(e),
                status="failed",
                attempt_count=tool_call.attempt_count,
                started_at=started_at,
                ended_at=ended_at,
                duration_ms=execution_duration_ms,
            )

    async def execute_tools(
        self,
        tool_calls: list[ToolCall],
        parallel: bool = True,
    ) -> list[ToolResult]:
        """Execute multiple tool calls."""
        if not tool_calls:
            return []

        if parallel:
            run_started_at = datetime.utcnow()

            # Execute all tools in parallel
            tasks = [self.execute_tool(tc) for tc in tool_calls]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Convert exceptions to ToolResults
            processed_results: list[ToolResult] = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    ended_at = datetime.utcnow()
                    processed_results.append(
                        ToolResult(
                            tool_call_id=tool_calls[i].id,
                            name=tool_calls[i].name,
                            success=False,
                            error=str(result),
                            status="failed",
                            attempt_count=tool_calls[i].attempt_count,
                            started_at=run_started_at,
                            ended_at=ended_at,
                            duration_ms=(ended_at - run_started_at).total_seconds() * 1000,
                        )
                    )
                    logger.warning(
                        "tool_execution_scheduling_failed",
                        tool_name=tool_calls[i].name,
                        error=str(result),
                    )
                else:
                    processed_results.append(result)

            return processed_results
        else:
            # Execute sequentially
            return [await self.execute_tool(tc) for tc in tool_calls]

    def list_available_tools(self) -> list[str]:
        """List all available tool names."""
        return list(self._handlers.keys())

    async def close(self) -> None:
        """Clean up resources."""
        await self.http_client.aclose()
