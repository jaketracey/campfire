"""Tool routing and execution system."""

import asyncio
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
    ImageAnalysisHandler,
    ImageGenerationHandler,
    KGProposeHandler,
    MemoryReadHandler,
    MemoryWriteHandler,
    VaultProjectionHandler,
)

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
            KGProposeHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            ImageAnalysisHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            ImageGenerationHandler(
                self.settings, self.event_emitter, self.http_client
            ),
            VaultProjectionHandler(
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

        handler = self.get_handler(tool_call.name)
        if not handler:
            logger.warning("unknown_tool", tool_name=tool_call.name)
            return ToolResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                success=False,
                error=f"Unknown tool: {tool_call.name}",
                duration_ms=0,
            )

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
                return ToolResult(
                    tool_call_id=tool_call.id,
                    name=tool_call.name,
                    success=False,
                    error=f"Invalid arguments: {validation_error}",
                    duration_ms=(time.time() - start_time) * 1000,
                )

            # Execute the tool
            result = await handler.execute(tool_call)

            # Emit tool completed event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_COMPLETED,
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
            duration_ms = (time.time() - start_time) * 1000
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
                    duration_ms=duration_ms,
                    success=False,
                    error_message=str(e),
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
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
            # Execute all tools in parallel
            tasks = [self.execute_tool(tc) for tc in tool_calls]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Convert exceptions to ToolResults
            processed_results: list[ToolResult] = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    processed_results.append(
                        ToolResult(
                            tool_call_id=tool_calls[i].id,
                            name=tool_calls[i].name,
                            success=False,
                            error=str(result),
                            duration_ms=0,
                        )
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
