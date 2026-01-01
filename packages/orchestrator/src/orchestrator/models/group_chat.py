"""Group chat domain models."""

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from orchestrator.models.conversation import CompanionSpec, Message


class ParticipantRole(str, Enum):
    """Role of a participant in a group chat."""

    PRIMARY = "primary"  # The main companion that owns the session
    INVITED = "invited"  # A friend companion invited to join


class ParticipantStatus(str, Enum):
    """Status of a participant in a group chat."""

    ACTIVE = "active"
    LEFT = "left"


class GroupParticipant(BaseModel):
    """A participant in a group chat session."""

    companion_id: UUID
    companion_spec: CompanionSpec
    role: ParticipantRole
    status: ParticipantStatus = ParticipantStatus.ACTIVE
    relationship_to_primary: str | None = None  # e.g., "best friend", "rival"
    theme_color: str = "#8B5CF6"  # Default violet
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    message_count: int = 0

    class Config:
        frozen = True


class SpeakerType(str, Enum):
    """Type of speaker in a group message."""

    USER = "user"
    COMPANION = "companion"


class GroupMessage(BaseModel):
    """A message in a group chat."""

    id: UUID = Field(default_factory=uuid4)
    speaker_id: UUID  # companion_id or user_id
    speaker_type: SpeakerType
    speaker_name: str
    theme_color: str | None = None  # For companions
    content: str
    is_reaction: bool = False  # True if this is a reaction to another message
    reacting_to: UUID | None = None  # Message ID being reacted to
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        frozen = True


class GroupConversationTurn(BaseModel):
    """A complete turn in a group conversation.

    In group chat, a turn consists of:
    - One user message
    - One or more companion responses (primary + optional reactions)
    """

    id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    turn_number: int
    user_message: Message
    companion_messages: list[GroupMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def get_primary_response(self) -> GroupMessage | None:
        """Get the primary companion's response (non-reaction)."""
        for msg in self.companion_messages:
            if not msg.is_reaction:
                return msg
        return None

    def get_reactions(self) -> list[GroupMessage]:
        """Get all reaction messages."""
        return [msg for msg in self.companion_messages if msg.is_reaction]


class GroupChatContext(BaseModel):
    """Context for a group chat session."""

    session_id: UUID
    user_id: UUID
    host_companion: GroupParticipant  # The primary companion
    participants: list[GroupParticipant] = Field(default_factory=list)
    recent_turns: list[GroupConversationTurn] = Field(default_factory=list)
    is_group_chat: bool = False

    @property
    def all_participants(self) -> list[GroupParticipant]:
        """Get all participants including host."""
        return [self.host_companion] + self.participants

    @property
    def active_participants(self) -> list[GroupParticipant]:
        """Get all active participants."""
        return [p for p in self.all_participants if p.status == ParticipantStatus.ACTIVE]

    def get_participant(self, companion_id: UUID) -> GroupParticipant | None:
        """Get a participant by companion ID."""
        for p in self.all_participants:
            if p.companion_id == companion_id:
                return p
        return None


class SpeakerSelection(BaseModel):
    """Result of selecting which companion should speak."""

    primary_speaker: GroupParticipant
    should_react: bool = False
    reactors: list[GroupParticipant] = Field(default_factory=list)
    reasoning: str | None = None


class GroupChatRequest(BaseModel):
    """Request to process a group chat message."""

    session_id: UUID
    user_id: UUID
    user_message: str
    participants: list[GroupParticipant]
    host_companion_id: UUID


class GroupChatResponse(BaseModel):
    """Response from processing a group chat message."""

    turn_id: UUID
    primary_response: GroupMessage
    reactions: list[GroupMessage] = Field(default_factory=list)
    latency_ms: float = 0.0
    total_tokens: int = 0

    @property
    def all_messages(self) -> list[GroupMessage]:
        """Get all response messages in order."""
        return [self.primary_response] + self.reactions


# Theme colors for companions in group chat
THEME_COLORS = [
    "#8B5CF6",  # violet (primary/host)
    "#F97316",  # orange
    "#10B981",  # emerald
    "#EC4899",  # pink
    "#3B82F6",  # blue
]


def get_theme_color(index: int) -> str:
    """Get a theme color for a companion based on their position."""
    return THEME_COLORS[index % len(THEME_COLORS)]
