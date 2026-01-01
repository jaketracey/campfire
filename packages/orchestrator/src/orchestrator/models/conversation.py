"""Conversation domain models."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class MessageRole(str, Enum):
    """Role of the message sender."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class TenetCategory(str, Enum):
    """Category of behavioral tenet."""

    COMMUNICATION = "communication"
    BOUNDARIES = "boundaries"
    ENGAGEMENT = "engagement"
    EMOTIONAL = "emotional"
    KNOWLEDGE = "knowledge"
    AUTONOMY = "autonomy"


class TenetPriority(str, Enum):
    """Priority level for tenets."""

    CORE = "core"
    SITUATIONAL = "situational"


class BehavioralTenet(BaseModel):
    """A behavioral rule governing companion behavior."""

    id: str
    category: TenetCategory
    priority: TenetPriority
    rule: str
    description: str | None = None
    is_negation: bool = False
    trigger_contexts: list[str] = Field(default_factory=list)

    class Config:
        frozen = True


class SituationalTenetMatch(BaseModel):
    """A situational tenet matched via semantic search."""

    id: str
    category: TenetCategory
    rule: str
    is_negation: bool = False
    match_type: str = "context"  # "context" or "semantic"
    similarity: float = 1.0

    class Config:
        frozen = True


class Message(BaseModel):
    """A single message in a conversation."""

    id: UUID = Field(default_factory=uuid4)
    role: MessageRole
    content: str
    name: str | None = None
    tool_call_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Image generation prompt from companion - describes the visual scene to present
    image_prompt: str | None = None

    class Config:
        frozen = True


class SessionSummary(BaseModel):
    """Summary of a conversation session for context continuity."""

    session_id: UUID
    user_id: UUID
    companion_id: UUID
    summary_text: str
    key_topics: list[str] = Field(default_factory=list)
    emotional_state: str | None = None
    last_interaction: datetime
    turn_count: int
    version: int = 1

    class Config:
        frozen = True


class CompanionSpec(BaseModel):
    """Specification defining a companion's personality and behavior."""

    id: UUID
    name: str
    description: str
    personality_traits: list[str] = Field(default_factory=list)
    communication_style: str = "flirtatious and intimate"
    voice_id: str | None = None
    avatar_url: str | None = None
    system_prompt: str
    safety_level: str = "adult"  # adult, permissive, standard, strict
    allowed_tools: list[str] = Field(default_factory=list)
    max_context_turns: int = 20
    temperature: float = 0.8  # Slightly higher for more creative responses
    version: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Enhanced personality fields
    archetype: str | None = None
    secondary_archetype: str | None = None
    personality_sliders: dict[str, float] = Field(default_factory=dict)
    core_tenets: list[BehavioralTenet] = Field(default_factory=list)

    class Config:
        frozen = True


class TurnMetadata(BaseModel):
    """Metadata for a conversation turn."""

    turn_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    user_id: UUID
    companion_id: UUID
    model_used: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: float = 0.0
    cost_usd: float = 0.0
    tools_invoked: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    prompt_version: str = "1.0.0"
    policy_version: str = "1.0.0"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationTurn(BaseModel):
    """A complete turn in a conversation (user input -> assistant response)."""

    id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    user_message: Message
    assistant_message: Message | None = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    metadata: TurnMetadata
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationContext(BaseModel):
    """Full context for building model input."""

    session_id: UUID
    user_id: UUID
    companion_spec: CompanionSpec
    recent_turns: list[ConversationTurn] = Field(default_factory=list)
    session_summary: SessionSummary | None = None
    long_term_memories: list[Any] = Field(default_factory=list)
    safety_constraints: list[str] = Field(default_factory=list)
    active_tools: list[str] = Field(default_factory=list)
    prompt_version: str = "1.0.0"
    policy_version: str = "1.0.0"
    situational_tenets: list[SituationalTenetMatch] = Field(default_factory=list)

    def get_message_history(self) -> list[Message]:
        """Extract message history from recent turns."""
        messages: list[Message] = []
        for turn in self.recent_turns:
            messages.append(turn.user_message)
            if turn.assistant_message:
                messages.append(turn.assistant_message)
        return messages

    def get_context_window_messages(self, max_turns: int | None = None) -> list[Message]:
        """Get messages within the context window limit."""
        limit = max_turns or self.companion_spec.max_context_turns
        relevant_turns = self.recent_turns[-limit:]
        messages: list[Message] = []
        for turn in relevant_turns:
            messages.append(turn.user_message)
            if turn.assistant_message:
                messages.append(turn.assistant_message)
        return messages
