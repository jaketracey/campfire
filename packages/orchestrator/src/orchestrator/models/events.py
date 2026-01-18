"""Event models for the orchestrator service."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Types of events emitted by the orchestrator."""

    # Conversation events
    CONVERSATION_STARTED = "conversation.started"
    CONVERSATION_TURN_STARTED = "conversation.turn.started"
    CONVERSATION_TURN_COMPLETED = "conversation.turn.completed"
    CONVERSATION_ENDED = "conversation.ended"

    # Tool events
    TOOL_INVOKED = "tool.invoked"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"

    # Memory events
    MEMORY_READ = "memory.read"
    MEMORY_WRITE = "memory.write"
    KG_PROPOSE = "kg.propose"
    KG_ADD = "kg.add"
    KG_REMOVE = "kg.remove"

    # Session events
    SESSION_SUMMARIZED = "session.summarized"

    # Image events
    IMAGE_ANALYSIS_REQUESTED = "image.analysis.requested"
    IMAGE_ANALYSIS_COMPLETED = "image.analysis.completed"
    IMAGE_GENERATION_TRIGGERED = "image.generation.triggered"
    IMAGE_GENERATION_COMPLETED = "image.generation.completed"
    VIDEO_GENERATION_TRIGGERED = "video.generation.triggered"
    VIDEO_GENERATION_COMPLETED = "video.generation.completed"

    # Vault events
    VAULT_PROJECTION_TRIGGERED = "vault.projection.triggered"
    VAULT_PROJECTION_COMPLETED = "vault.projection.completed"

    # Safety events
    SAFETY_CHECK_STARTED = "safety.check.started"
    SAFETY_CHECK_PASSED = "safety.check.passed"
    SAFETY_CHECK_FAILED = "safety.check.failed"
    SAFETY_CONTENT_FLAGGED = "safety.content.flagged"
    SAFETY_POLICY_VIOLATION = "safety.policy.violation"

    # Cost events
    COST_INCURRED = "cost.incurred"

    # Provider events
    PROVIDER_REQUEST_STARTED = "provider.request.started"
    PROVIDER_REQUEST_COMPLETED = "provider.request.completed"
    PROVIDER_REQUEST_FAILED = "provider.request.failed"
    PROVIDER_FALLBACK = "provider.fallback"

    # Content routing events
    CONTENT_ROUTED = "content.routed"
    CONTENT_INTENT_DETECTED = "content.intent.detected"
    CONTENT_BLOCKED = "content.blocked"
    MODEL_SWITCHED = "model.switched"
    ABLITERATED_MODEL_USED = "model.abliterated.used"


class BaseEvent(BaseModel):
    """Base event model with common fields."""

    id: UUID = Field(default_factory=uuid4)
    type: EventType
    session_id: UUID
    user_id: UUID
    companion_id: UUID
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    correlation_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        frozen = True


class ConversationEvent(BaseEvent):
    """Event related to conversation lifecycle."""

    turn_id: UUID | None = None
    message_id: UUID | None = None
    content_preview: str | None = None


class ToolEvent(BaseEvent):
    """Event related to tool invocation."""

    tool_name: str
    tool_call_id: str
    input_params: dict[str, Any] = Field(default_factory=dict)
    output: Any | None = None
    duration_ms: float = 0.0
    success: bool = True
    error_message: str | None = None


class SafetyEvent(BaseEvent):
    """Event related to safety checks."""

    check_type: str
    content_hash: str | None = None
    classification: str | None = None
    confidence: float = 0.0
    policy_version: str = "1.0.0"
    action_taken: str | None = None
    flagged_categories: list[str] = Field(default_factory=list)


class CostTrackingEvent(BaseEvent):
    """Event for tracking costs per turn."""

    turn_id: UUID
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    pricing_version: str = "1.0.0"


class ProviderEvent(BaseEvent):
    """Event related to provider API calls."""

    provider: str
    model: str
    operation: str
    request_id: str | None = None
    latency_ms: float = 0.0
    status_code: int | None = None
    error_type: str | None = None
    retry_count: int = 0


class ContentRoutingEvent(BaseEvent):
    """Event for content routing decisions and model selection."""

    intent: str
    confidence: float
    detection_method: str
    selected_model: str
    selected_provider: str
    routing_reason: str
    content_blocked: bool = False
    block_reason: str | None = None
    latency_ms: float = 0.0


class ContentBlockedEvent(BaseEvent):
    """Event when content is blocked due to safety constraints."""

    detected_intent: str
    companion_safety_level: str
    block_reason: str
