"""Emotional state models for persistent companion emotions."""

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class PrimaryEmotion(str, Enum):
    """Plutchik's eight primary emotions."""

    JOY = "joy"
    SADNESS = "sadness"
    ANGER = "anger"
    FEAR = "fear"
    SURPRISE = "surprise"
    DISGUST = "disgust"
    TRUST = "trust"
    ANTICIPATION = "anticipation"


class EmotionalDimension(BaseModel):
    """PAD (Pleasure-Arousal-Dominance) emotional dimensions.

    Each dimension ranges from -1.0 to 1.0.
    """

    valence: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Negative (-1) to positive (+1). Sad to happy.",
    )
    arousal: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Calm (-1) to excited (+1).",
    )
    dominance: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Submissive (-1) to dominant (+1).",
    )

    class Config:
        frozen = True


class EmotionalState(BaseModel):
    """Persistent emotional state for a companion-user pair."""

    id: UUID = Field(default_factory=uuid4)
    companion_id: UUID
    user_id: UUID

    # Core emotion
    primary_emotion: PrimaryEmotion = PrimaryEmotion.TRUST
    secondary_emotion: PrimaryEmotion | None = None

    # Dimensional model
    dimensions: EmotionalDimension = Field(default_factory=EmotionalDimension)

    # Intensity & stability
    intensity: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="How strongly the emotion is felt (0=barely, 1=overwhelmingly).",
    )
    stability: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="How stable/volatile the emotional state is (0=volatile, 1=rock-solid).",
    )

    # Context
    triggers: list[str] = Field(
        default_factory=list,
        description="What caused this state, e.g. 'user shared good news'.",
    )
    mood_description: str = Field(
        default="feeling balanced and attentive",
        description="Natural language mood summary for prompt injection.",
    )

    # History (last N transitions stored inline)
    transition_history: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Last 10 transitions as serialised dicts.",
    )

    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def intensity_description(self) -> str:
        """Return a human-readable intensity label."""
        if self.intensity < 0.2:
            return "faintly"
        if self.intensity < 0.4:
            return "mildly"
        if self.intensity < 0.6:
            return "moderately"
        if self.intensity < 0.8:
            return "strongly"
        return "intensely"

    def tone_modifier(self) -> str:
        """Derive a tone modifier from valence + arousal."""
        v, a = self.dimensions.valence, self.dimensions.arousal
        if v > 0.3 and a > 0.3:
            return "warm and enthusiastic"
        if v > 0.3 and a <= 0.3:
            return "warm and calm"
        if v < -0.3 and a > 0.3:
            return "tense and guarded"
        if v < -0.3 and a <= 0.3:
            return "subdued and reflective"
        return "balanced and attentive"

    def energy_modifier(self) -> str:
        """Derive an energy modifier from arousal."""
        a = self.dimensions.arousal
        if a > 0.5:
            return "high"
        if a > 0.0:
            return "moderate"
        if a > -0.5:
            return "low"
        return "very low"

    def openness_modifier(self) -> str:
        """Derive openness modifier from valence + stability."""
        v, s = self.dimensions.valence, self.stability
        if v > 0.2 and s > 0.5:
            return "very open"
        if v > 0.0:
            return "open"
        if v > -0.3:
            return "somewhat guarded"
        return "reserved"


TransitionType = Literal["conversation", "time_decay", "event", "reset"]


class EmotionalTransition(BaseModel):
    """Records a state transition for auditing / history."""

    from_emotion: PrimaryEmotion
    to_emotion: PrimaryEmotion
    from_valence: float
    to_valence: float
    trigger: str
    transition_type: TransitionType
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True

    def to_history_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_emotion.value,
            "to": self.to_emotion.value,
            "from_v": self.from_valence,
            "to_v": self.to_valence,
            "trigger": self.trigger,
            "type": self.transition_type,
            "ts": self.timestamp.isoformat(),
        }
