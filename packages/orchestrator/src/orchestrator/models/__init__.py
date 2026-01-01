"""Domain models for the orchestrator service."""

from orchestrator.models.conversation import (
    CompanionSpec,
    ConversationContext,
    ConversationTurn,
    Message,
    MessageRole,
    SessionSummary,
    TurnMetadata,
)
from orchestrator.models.events import (
    BaseEvent,
    ContentBlockedEvent,
    ContentRoutingEvent,
    ConversationEvent,
    CostTrackingEvent,
    EventType,
    SafetyEvent,
    ToolEvent,
)
from orchestrator.models.gifts import (
    EmotionalReactionType,
    Gift,
    GiftAcknowledgmentRequest,
    GiftAcknowledgmentResult,
    GiftDirection,
    GiftGenerationRequest,
    GiftGenerationResult,
    GiftMemory,
    GiftRecallContext,
    GiftType,
)
from orchestrator.models.memory import (
    KnowledgeGraphNode,
    KnowledgeGraphRelation,
    LongTermMemory,
    MemoryQuery,
    MemoryResult,
)
from orchestrator.models.tools import (
    ToolCall,
    ToolDefinition,
    ToolResult,
    ToolType,
)
from orchestrator.models.group_chat import (
    GroupChatContext,
    GroupChatRequest,
    GroupChatResponse,
    GroupConversationTurn,
    GroupMessage,
    GroupParticipant,
    ParticipantRole,
    ParticipantStatus,
    SpeakerSelection,
    SpeakerType,
    get_theme_color,
)

__all__ = [
    # Conversation
    "CompanionSpec",
    "ConversationContext",
    "ConversationTurn",
    "Message",
    "MessageRole",
    "SessionSummary",
    "TurnMetadata",
    # Events
    "BaseEvent",
    "ContentBlockedEvent",
    "ContentRoutingEvent",
    "ConversationEvent",
    "CostTrackingEvent",
    "EventType",
    "SafetyEvent",
    "ToolEvent",
    # Gifts
    "EmotionalReactionType",
    "Gift",
    "GiftAcknowledgmentRequest",
    "GiftAcknowledgmentResult",
    "GiftDirection",
    "GiftGenerationRequest",
    "GiftGenerationResult",
    "GiftMemory",
    "GiftRecallContext",
    "GiftType",
    # Memory
    "KnowledgeGraphNode",
    "KnowledgeGraphRelation",
    "LongTermMemory",
    "MemoryQuery",
    "MemoryResult",
    # Tools
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "ToolType",
    # Group Chat
    "GroupChatContext",
    "GroupChatRequest",
    "GroupChatResponse",
    "GroupConversationTurn",
    "GroupMessage",
    "GroupParticipant",
    "ParticipantRole",
    "ParticipantStatus",
    "SpeakerSelection",
    "SpeakerType",
    "get_theme_color",
]
