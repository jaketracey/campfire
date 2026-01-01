"""Turn lifecycle management for conversations."""

import time
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import structlog

from orchestrator.models.conversation import (
    ConversationTurn,
    Message,
    MessageRole,
    TurnMetadata,
)
from orchestrator.models.events import (
    ConversationEvent,
    CostTrackingEvent,
    EventType,
)
from orchestrator.events.emitter import EventEmitter

logger = structlog.get_logger()


class TurnManager:
    """Manages the lifecycle of conversation turns."""

    def __init__(self, event_emitter: EventEmitter):
        self.event_emitter = event_emitter
        self._active_turns: dict[UUID, TurnMetadata] = {}

    async def start_turn(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_id: UUID,
        user_message: str,
        model: str,
        prompt_version: str = "1.0.0",
        policy_version: str = "1.0.0",
    ) -> tuple[UUID, Message]:
        """Start a new conversation turn."""
        turn_id = uuid4()
        message_id = uuid4()

        # Create user message
        user_msg = Message(
            id=message_id,
            role=MessageRole.USER,
            content=user_message,
            created_at=datetime.utcnow(),
        )

        # Create turn metadata
        metadata = TurnMetadata(
            turn_id=turn_id,
            session_id=session_id,
            user_id=user_id,
            companion_id=companion_id,
            model_used=model,
            prompt_version=prompt_version,
            policy_version=policy_version,
            created_at=datetime.utcnow(),
        )

        self._active_turns[turn_id] = metadata

        # Emit turn started event
        await self.event_emitter.emit(
            ConversationEvent(
                type=EventType.CONVERSATION_TURN_STARTED,
                session_id=session_id,
                user_id=user_id,
                companion_id=companion_id,
                turn_id=turn_id,
                message_id=message_id,
                content_preview=user_message[:100] if len(user_message) > 100 else user_message,
            )
        )

        logger.info(
            "turn_started",
            turn_id=str(turn_id),
            session_id=str(session_id),
            user_id=str(user_id),
        )

        return turn_id, user_msg

    async def complete_turn(
        self,
        turn_id: UUID,
        assistant_response: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: float,
        tools_invoked: list[str] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_results: list[dict[str, Any]] | None = None,
        safety_flags: list[str] | None = None,
    ) -> ConversationTurn:
        """Complete a conversation turn with the assistant response."""
        metadata = self._active_turns.get(turn_id)
        if not metadata:
            raise ValueError(f"Turn {turn_id} not found in active turns")

        # Update metadata
        metadata.prompt_tokens = prompt_tokens
        metadata.completion_tokens = completion_tokens
        metadata.total_tokens = prompt_tokens + completion_tokens
        metadata.latency_ms = latency_ms
        metadata.tools_invoked = tools_invoked or []
        metadata.safety_flags = safety_flags or []

        # Calculate cost
        cost_usd = self._calculate_cost(
            model=metadata.model_used,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        metadata.cost_usd = cost_usd

        # Create assistant message
        assistant_msg = Message(
            id=uuid4(),
            role=MessageRole.ASSISTANT,
            content=assistant_response,
            created_at=datetime.utcnow(),
        )

        # Create completed turn
        turn = ConversationTurn(
            id=turn_id,
            session_id=metadata.session_id,
            user_message=Message(
                id=uuid4(),
                role=MessageRole.USER,
                content="",  # We don't store the original message here
            ),
            assistant_message=assistant_msg,
            tool_calls=tool_calls or [],
            tool_results=tool_results or [],
            metadata=metadata,
            created_at=metadata.created_at,
        )

        # Emit turn completed event
        await self.event_emitter.emit(
            ConversationEvent(
                type=EventType.CONVERSATION_TURN_COMPLETED,
                session_id=metadata.session_id,
                user_id=metadata.user_id,
                companion_id=metadata.companion_id,
                turn_id=turn_id,
                message_id=assistant_msg.id,
                content_preview=(
                    assistant_response[:100]
                    if len(assistant_response) > 100
                    else assistant_response
                ),
                payload={
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "latency_ms": latency_ms,
                    "tools_invoked": tools_invoked or [],
                },
            )
        )

        # Emit cost tracking event
        await self.event_emitter.emit(
            CostTrackingEvent(
                type=EventType.COST_INCURRED,
                session_id=metadata.session_id,
                user_id=metadata.user_id,
                companion_id=metadata.companion_id,
                turn_id=turn_id,
                provider=self._get_provider_from_model(metadata.model_used),
                model=metadata.model_used,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                cost_usd=cost_usd,
            )
        )

        # Remove from active turns
        del self._active_turns[turn_id]

        logger.info(
            "turn_completed",
            turn_id=str(turn_id),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            cost_usd=cost_usd,
        )

        return turn

    async def fail_turn(
        self,
        turn_id: UUID,
        error: str,
        error_type: str = "unknown",
    ) -> None:
        """Mark a turn as failed."""
        metadata = self._active_turns.get(turn_id)
        if not metadata:
            logger.warning("turn_not_found_for_failure", turn_id=str(turn_id))
            return

        # Emit failure event
        await self.event_emitter.emit(
            ConversationEvent(
                type=EventType.CONVERSATION_TURN_COMPLETED,
                session_id=metadata.session_id,
                user_id=metadata.user_id,
                companion_id=metadata.companion_id,
                turn_id=turn_id,
                payload={
                    "success": False,
                    "error": error,
                    "error_type": error_type,
                },
            )
        )

        # Remove from active turns
        del self._active_turns[turn_id]

        logger.error(
            "turn_failed",
            turn_id=str(turn_id),
            error=error,
            error_type=error_type,
        )

    def _calculate_cost(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
    ) -> float:
        """Calculate the cost for a model call."""
        # Pricing per 1M tokens
        pricing = {
            "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
            "claude-3-opus-20240229": {"input": 15.0, "output": 75.0},
            "claude-3-sonnet-20240229": {"input": 3.0, "output": 15.0},
            "claude-3-haiku-20240307": {"input": 0.25, "output": 1.25},
            "gpt-4-turbo-preview": {"input": 10.0, "output": 30.0},
            "gpt-4o": {"input": 5.0, "output": 15.0},
            "gpt-3.5-turbo": {"input": 0.5, "output": 1.5},
        }

        model_pricing = pricing.get(model, {"input": 3.0, "output": 15.0})

        input_cost = (prompt_tokens / 1_000_000) * model_pricing["input"]
        output_cost = (completion_tokens / 1_000_000) * model_pricing["output"]

        return round(input_cost + output_cost, 6)

    def _get_provider_from_model(self, model: str) -> str:
        """Determine the provider from the model name."""
        if model.startswith("claude"):
            return "anthropic"
        elif model.startswith("gpt"):
            return "openai"
        else:
            return "unknown"

    def get_active_turn_count(self) -> int:
        """Get the number of currently active turns."""
        return len(self._active_turns)

    def get_active_turn(self, turn_id: UUID) -> TurnMetadata | None:
        """Get metadata for an active turn."""
        return self._active_turns.get(turn_id)
