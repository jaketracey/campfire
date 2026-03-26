"""Proactive outreach domain models."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class OutreachTrigger(str, Enum):
    """What triggered the outreach consideration."""

    SCHEDULED_CHECKIN = "scheduled_checkin"
    FOLLOWUP = "followup"
    TIME_BASED = "time_based"
    EMOTIONAL_SUPPORT = "emotional_support"
    MILESTONE = "milestone"


class DeliveryChannel(str, Enum):
    """How the outreach message was/will be delivered."""

    WEBSOCKET = "websocket"
    PUSH = "push"
    TELEGRAM = "telegram"
    DISCORD = "discord"
    STORED = "stored"  # Stored for next connection


class OutreachDecision(BaseModel):
    """Result of evaluating whether to reach out to a user."""

    should_reach_out: bool
    trigger: OutreachTrigger
    message: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""


class OutreachConfig(BaseModel):
    """Per-companion outreach configuration."""

    enabled: bool = True
    min_interval_hours: int = Field(default=24, ge=1)
    max_daily: int = Field(default=1, ge=0)
    quiet_hours_start: int = Field(default=22, ge=0, le=23)  # 10 PM
    quiet_hours_end: int = Field(default=8, ge=0, le=23)  # 8 AM
    triggers_enabled: list[OutreachTrigger] = Field(
        default_factory=lambda: [
            OutreachTrigger.SCHEDULED_CHECKIN,
            OutreachTrigger.FOLLOWUP,
            OutreachTrigger.TIME_BASED,
        ]
    )


class OutreachRecord(BaseModel):
    """A record of an outreach attempt."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    trigger: OutreachTrigger
    message: str
    delivered_via: DeliveryChannel
    delivered_at: datetime | None = None
    was_opened: bool = False
    led_to_conversation: bool = False
    session_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OutreachContext(BaseModel):
    """Context gathered for generating an outreach message."""

    user_id: UUID
    companion_id: UUID
    companion_name: str
    user_name: str
    relationship_stage: str = "acquaintance"
    time_since_last_chat: str = ""
    last_session_summary: str = ""
    recent_memories: str = ""
    unfinished_topics: str = ""
    user_local_time: str = ""
    user_timezone: str = "UTC"


class EvaluateOutreachRequest(BaseModel):
    """Request to evaluate whether a companion should reach out."""

    user_id: str
    companion_id: str


class EvaluateOutreachResponse(BaseModel):
    """Response from outreach evaluation."""

    decision: OutreachDecision


class GenerateOutreachRequest(BaseModel):
    """Request to generate an outreach message given context."""

    context: OutreachContext
    trigger: OutreachTrigger = OutreachTrigger.SCHEDULED_CHECKIN


class GenerateOutreachResponse(BaseModel):
    """Response from outreach message generation."""

    message: str | None = None
    trigger: OutreachTrigger
    confidence: float = 0.0


class OutreachConfigResponse(BaseModel):
    """Response for outreach configuration."""

    companion_id: str
    config: OutreachConfig
