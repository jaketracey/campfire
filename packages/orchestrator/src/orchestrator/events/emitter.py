"""Event emission system for the orchestrator."""

import asyncio
from collections.abc import Callable
from typing import Any
from uuid import UUID

import structlog

from orchestrator.models.events import BaseEvent, EventType

logger = structlog.get_logger()

# Type alias for event handlers
EventHandler = Callable[[BaseEvent], Any]


class EventEmitter:
    """Emits events to registered handlers and the event store."""

    def __init__(self, event_store: "EventStore | None" = None):
        self._handlers: dict[EventType | None, list[EventHandler]] = {}
        self._event_store = event_store
        self._buffer: list[BaseEvent] = []
        self._buffer_size = 100
        self._flush_interval = 5.0  # seconds
        self._flush_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the event emitter background tasks."""
        if self._event_store:
            self._flush_task = asyncio.create_task(self._flush_loop())
            logger.info("event_emitter_started")

    async def stop(self) -> None:
        """Stop the event emitter and flush remaining events."""
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # Final flush
        await self._flush_buffer()
        logger.info("event_emitter_stopped")

    def subscribe(
        self,
        handler: EventHandler,
        event_type: EventType | None = None,
    ) -> None:
        """Subscribe a handler to events.

        Args:
            handler: The callback function to invoke
            event_type: Specific event type to subscribe to, or None for all events
        """
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)
        logger.debug(
            "handler_subscribed",
            event_type=event_type.value if event_type else "all",
        )

    def unsubscribe(
        self,
        handler: EventHandler,
        event_type: EventType | None = None,
    ) -> None:
        """Unsubscribe a handler from events."""
        if event_type in self._handlers:
            try:
                self._handlers[event_type].remove(handler)
            except ValueError:
                pass

    async def emit(self, event: BaseEvent) -> None:
        """Emit an event to all registered handlers."""
        # Log the event
        logger.debug(
            "event_emitted",
            event_type=event.type.value,
            event_id=str(event.id),
            session_id=str(event.session_id),
        )

        # Invoke type-specific handlers
        if event.type in self._handlers:
            for handler in self._handlers[event.type]:
                try:
                    result = handler(event)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    logger.error(
                        "event_handler_error",
                        event_type=event.type.value,
                        error=str(e),
                    )

        # Invoke wildcard handlers
        if None in self._handlers:
            for handler in self._handlers[None]:
                try:
                    result = handler(event)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    logger.error(
                        "wildcard_handler_error",
                        event_type=event.type.value,
                        error=str(e),
                    )

        # Add to buffer for persistence
        if self._event_store:
            self._buffer.append(event)
            if len(self._buffer) >= self._buffer_size:
                await self._flush_buffer()

    async def emit_batch(self, events: list[BaseEvent]) -> None:
        """Emit multiple events."""
        for event in events:
            await self.emit(event)

    async def _flush_loop(self) -> None:
        """Background task to periodically flush the event buffer."""
        while True:
            await asyncio.sleep(self._flush_interval)
            await self._flush_buffer()

    async def _flush_buffer(self) -> None:
        """Flush buffered events to the event store."""
        if not self._buffer or not self._event_store:
            return

        events_to_flush = self._buffer.copy()
        self._buffer.clear()

        try:
            await self._event_store.store_batch(events_to_flush)
            logger.debug(
                "events_flushed",
                count=len(events_to_flush),
            )
        except Exception as e:
            logger.error(
                "event_flush_error",
                count=len(events_to_flush),
                error=str(e),
            )
            # Re-add events to buffer on failure
            self._buffer = events_to_flush + self._buffer


# Convenience function for creating pre-configured events
def create_event(
    event_type: EventType,
    session_id: UUID,
    user_id: UUID,
    companion_id: UUID,
    **kwargs: Any,
) -> BaseEvent:
    """Create a new event with the given parameters."""
    return BaseEvent(
        type=event_type,
        session_id=session_id,
        user_id=user_id,
        companion_id=companion_id,
        **kwargs,
    )
