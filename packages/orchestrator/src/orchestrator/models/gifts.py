"""Gift models for the companion gifting system."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class GiftType(str, Enum):
    """Types of gifts that can be exchanged."""

    VIRTUAL_OBJECT = "virtual_object"
    POEM = "poem"
    SONG = "song"
    MEMORY_COLLAGE = "memory_collage"
    CUSTOM = "custom"


class GiftDirection(str, Enum):
    """Direction of gift exchange."""

    FROM_USER = "from_user"
    FROM_COMPANION = "from_companion"


class EmotionalReactionType(str, Enum):
    """Types of emotional reactions to gifts."""

    JOY = "joy"
    SURPRISE = "surprise"
    TOUCHED = "touched"
    GRATEFUL = "grateful"
    LOVING = "loving"


class Gift(BaseModel):
    """A gift exchanged between user and companion."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    direction: GiftDirection
    gift_type: GiftType
    title: str
    description: str
    visual_prompt: str | None = None
    visual_url: str | None = None
    emotional_meaning: str
    emotional_significance: float = Field(default=0.5, ge=0.0, le=1.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        frozen = True


class GiftRecallContext(BaseModel):
    """Context for recalling a past gift in conversation."""

    gift_id: UUID
    title: str
    description: str
    emotional_meaning: str
    date: str
    trigger: str
    suggested_mention: str | None = None

    class Config:
        frozen = True


class GiftGenerationRequest(BaseModel):
    """Request to generate a new gift."""

    user_id: UUID
    companion_id: UUID
    session_id: UUID
    turn_id: UUID
    gift_type: GiftType
    context: str = ""
    emotional_intent: str
    user_preferences: dict[str, Any] = Field(default_factory=dict)


class GiftGenerationResult(BaseModel):
    """Result of gift generation."""

    gift: Gift
    generation_prompt_used: str | None = None
    visual_generation_triggered: bool = False


class GiftAcknowledgmentRequest(BaseModel):
    """Request to acknowledge a gift from the user."""

    user_id: UUID
    companion_id: UUID
    session_id: UUID
    turn_id: UUID
    gift_description: str
    inferred_gift_type: GiftType = GiftType.CUSTOM
    emotional_reaction: EmotionalReactionType
    emotional_intensity: float = Field(default=0.7, ge=0.0, le=1.0)


class GiftAcknowledgmentResult(BaseModel):
    """Result of gift acknowledgment."""

    gift: Gift
    acknowledgment_text: str
    emotional_reaction: EmotionalReactionType
    emotional_intensity: float


class GiftMemory(BaseModel):
    """A gift stored as a memory for context building."""

    gift_id: UUID
    title: str
    description: str
    emotional_meaning: str
    direction: GiftDirection
    gift_type: GiftType
    created_at: datetime
    emotional_significance: float

    @classmethod
    def from_gift(cls, gift: Gift) -> "GiftMemory":
        """Create a GiftMemory from a Gift."""
        return cls(
            gift_id=gift.id,
            title=gift.title,
            description=gift.description,
            emotional_meaning=gift.emotional_meaning,
            direction=gift.direction,
            gift_type=gift.gift_type,
            created_at=gift.created_at,
            emotional_significance=gift.emotional_significance,
        )
