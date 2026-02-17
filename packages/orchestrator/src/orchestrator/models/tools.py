"""Tool definition and execution models."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ToolType(str, Enum):
    """Categories of available tools."""

    MEMORY_READ = "memory_read"
    MEMORY_WRITE = "memory_write"
    KG_PROPOSE = "kg_propose"
    KG_ADD = "kg_add"
    KG_REMOVE = "kg_remove"
    IMAGE_ANALYSIS = "image_analysis"
    IMAGE_GENERATION = "image_generation"
    VIDEO_GENERATION = "video_generation"
    VAULT_PROJECTION = "vault_projection"
    WEB_SEARCH = "web_search"
    CALENDAR = "calendar"
    GIFT_GENERATE = "gift_generate"
    GIFT_ACKNOWLEDGE = "gift_acknowledge"
    GAME_START = "game_start"
    GAME_MOVE = "game_move"
    GAME_STATE = "game_state"
    GAME_RESIGN = "game_resign"
    INVITE_FRIEND = "invite_friend"
    DISMISS_FRIEND = "dismiss_friend"
    CUSTOM = "custom"


class ToolDefinition(BaseModel):
    """Definition of an available tool."""

    name: str
    tool_type: ToolType
    description: str
    parameters: dict[str, Any]
    required_params: list[str] = Field(default_factory=list)
    returns: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = False
    cost_estimate_usd: float = 0.0
    timeout_seconds: float = 30.0
    version: str = "1.0.0"

    def to_openai_function(self) -> dict[str, Any]:
        """Convert to OpenAI function calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.parameters,
                    "required": self.required_params,
                },
            },
        }

    def to_anthropic_tool(self) -> dict[str, Any]:
        """Convert to Anthropic tool format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": self.parameters,
                "required": self.required_params,
            },
        }


class ToolCallContext(BaseModel):
    """Optional context passed to tool handlers for augmentation."""

    companion_spec: dict[str, Any] | None = None
    recent_turns: list[dict[str, Any]] | None = None

    class Config:
        frozen = True


class ToolCall(BaseModel):
    """A request to invoke a tool."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    arguments: dict[str, Any]
    turn_id: UUID
    session_id: UUID
    user_id: UUID
    companion_id: UUID
    context: ToolCallContext | None = None
    status: str = "requested"
    attempt_count: int = 1
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True


class ToolResult(BaseModel):
    """Result from a tool invocation."""

    tool_call_id: str
    name: str
    success: bool
    output: Any | None = None
    error: str | None = None
    status: str = "requested"
    attempt_count: int = 1
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_ms: float = 0.0
    cost_usd: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def to_message_content(self) -> str:
        """Convert to message content for model context."""
        if self.success:
            if isinstance(self.output, str):
                return self.output
            return str(self.output)
        return f"Error: {self.error}"


# Pre-defined tool definitions
MEMORY_READ_TOOL = ToolDefinition(
    name="memory_read",
    tool_type=ToolType.MEMORY_READ,
    description="Retrieve relevant long-term memories for the user",
    parameters={
        "query": {
            "type": "string",
            "description": "The search query for finding relevant memories",
        },
        "memory_types": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Types of memories to search (fact, preference, experience, etc.)",
        },
        "max_results": {
            "type": "integer",
            "description": "Maximum number of memories to return",
            "default": 5,
        },
    },
    required_params=["query"],
)

MEMORY_WRITE_TOOL = ToolDefinition(
    name="memory_write",
    tool_type=ToolType.MEMORY_WRITE,
    description="Store a new long-term memory about the user",
    parameters={
        "content": {
            "type": "string",
            "description": "The memory content to store",
        },
        "memory_type": {
            "type": "string",
            "enum": ["fact", "preference", "experience", "relationship", "goal", "context"],
            "description": "The type of memory",
        },
        "importance": {
            "type": "number",
            "description": "Importance score from 0 to 1",
            "default": 0.5,
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Tags for categorizing the memory",
        },
    },
    required_params=["content", "memory_type"],
)

KG_PROPOSE_TOOL = ToolDefinition(
    name="kg_propose",
    tool_type=ToolType.KG_PROPOSE,
    description="Propose additions or modifications to the knowledge graph",
    parameters={
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "node_type": {"type": "string"},
                    "properties": {"type": "object"},
                },
            },
            "description": "Nodes to add to the knowledge graph",
        },
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source_label": {"type": "string"},
                    "target_label": {"type": "string"},
                    "relation_type": {"type": "string"},
                },
            },
            "description": "Relations between nodes",
        },
        "reasoning": {
            "type": "string",
            "description": "Explanation for the proposed changes",
        },
    },
    required_params=["reasoning"],
)

IMAGE_ANALYSIS_TOOL = ToolDefinition(
    name="image_analysis",
    tool_type=ToolType.IMAGE_ANALYSIS,
    description="Analyze an image and describe its contents",
    parameters={
        "image_url": {
            "type": "string",
            "description": "URL of the image to analyze",
        },
        "prompt": {
            "type": "string",
            "description": "Specific question or focus for the analysis",
        },
    },
    required_params=["image_url"],
    cost_estimate_usd=0.01,
)

IMAGE_GENERATION_TOOL = ToolDefinition(
    name="image_generation",
    tool_type=ToolType.IMAGE_GENERATION,
    description="Generate an image based on a text description",
    parameters={
        "prompt": {
            "type": "string",
            "description": "Text description of the image to generate",
        },
        "style": {
            "type": "string",
            "enum": ["realistic", "artistic", "cartoon", "abstract"],
            "description": "Style of the generated image",
        },
        "size": {
            "type": "string",
            "enum": ["256x256", "512x512", "1024x1024"],
            "description": "Size of the generated image",
            "default": "512x512",
        },
    },
    required_params=["prompt"],
    requires_confirmation=True,
    cost_estimate_usd=0.02,
)

VIDEO_GENERATION_TOOL = ToolDefinition(
    name="video_generation",
    tool_type=ToolType.VIDEO_GENERATION,
    description="Generate a short video clip based on a text description, optionally animated from a source image",
    parameters={
        "prompt": {
            "type": "string",
            "description": "Text description of the motion/action for the video. Describe what should happen.",
        },
        "source_image_url": {
            "type": "string",
            "description": "Optional URL of an image to animate. If provided, creates image-to-video animation.",
        },
        "duration_seconds": {
            "type": "integer",
            "description": "Duration of the video in seconds (1-10)",
            "default": 5,
            "minimum": 1,
            "maximum": 10,
        },
        "aspect_ratio": {
            "type": "string",
            "enum": ["16:9", "9:16", "1:1"],
            "description": "Aspect ratio of the video. 16:9 for landscape, 9:16 for portrait.",
            "default": "9:16",
        },
    },
    required_params=["prompt"],
    requires_confirmation=True,
    cost_estimate_usd=0.25,
    timeout_seconds=300.0,
)

VAULT_PROJECTION_TOOL = ToolDefinition(
    name="vault_projection",
    tool_type=ToolType.VAULT_PROJECTION,
    description="Trigger a vault projection visualization",
    parameters={
        "projection_type": {
            "type": "string",
            "enum": ["memory_timeline", "relationship_graph", "emotional_journey", "custom"],
            "description": "Type of projection to generate",
        },
        "time_range": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "format": "date-time"},
                "end": {"type": "string", "format": "date-time"},
            },
            "description": "Time range for the projection",
        },
        "focus_topics": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Topics to focus on in the projection",
        },
    },
    required_params=["projection_type"],
    cost_estimate_usd=0.05,
)

GIFT_GENERATE_TOOL = ToolDefinition(
    name="gift_generate",
    tool_type=ToolType.GIFT_GENERATE,
    description="Generate a unique, contextually appropriate gift for the user",
    parameters={
        "gift_type": {
            "type": "string",
            "enum": ["virtual_object", "poem", "song", "memory_collage", "custom"],
            "description": "The type of gift to generate",
        },
        "context": {
            "type": "string",
            "description": "Context or occasion for the gift (e.g., 'birthday', 'encouragement', 'milestone')",
        },
        "emotional_intent": {
            "type": "string",
            "description": "The emotional impact you want the gift to have on the user",
        },
    },
    required_params=["gift_type", "emotional_intent"],
    cost_estimate_usd=0.05,
)

GIFT_ACKNOWLEDGE_TOOL = ToolDefinition(
    name="gift_acknowledge",
    tool_type=ToolType.GIFT_ACKNOWLEDGE,
    description="Acknowledge and emotionally react to a gift from the user",
    parameters={
        "gift_description": {
            "type": "string",
            "description": "Description of the gift received from the user",
        },
        "emotional_reaction": {
            "type": "string",
            "enum": ["joy", "surprise", "touched", "grateful", "loving"],
            "description": "The emotional reaction to express",
        },
        "emotional_intensity": {
            "type": "number",
            "description": "Intensity of the emotional reaction (0.0 to 1.0)",
            "default": 0.7,
        },
    },
    required_params=["gift_description", "emotional_reaction"],
)

# Game tools
GAME_START_TOOL = ToolDefinition(
    name="game_start",
    tool_type=ToolType.GAME_START,
    description="Start a new game with the user. Use when the user wants to play chess, tic-tac-toe, or other games.",
    parameters={
        "game_type": {
            "type": "string",
            "enum": ["chess", "tic_tac_toe", "connect_four"],
            "description": "The type of game to start",
        },
        "companion_plays_first": {
            "type": "boolean",
            "description": "Whether you (the companion) make the first move. Default is false (user goes first).",
            "default": False,
        },
    },
    required_params=["game_type"],
)

GAME_MOVE_TOOL = ToolDefinition(
    name="game_move",
    tool_type=ToolType.GAME_MOVE,
    description="Make a move in the current game. Returns updated board state. Only use when it's your turn.",
    parameters={
        "move": {
            "type": "string",
            "description": "Move notation. For tic-tac-toe: A1, B2, C3 etc. For chess: e2e4, Nf3, O-O etc.",
        },
        "thinking": {
            "type": "string",
            "description": "Brief explanation of your move strategy to share with the user (optional)",
        },
    },
    required_params=["move"],
)

GAME_STATE_TOOL = ToolDefinition(
    name="game_state",
    tool_type=ToolType.GAME_STATE,
    description="Get the current game state including board position and available moves. Use to check the board before making a move.",
    parameters={},
    required_params=[],
)

GAME_RESIGN_TOOL = ToolDefinition(
    name="game_resign",
    tool_type=ToolType.GAME_RESIGN,
    description="Resign from the current game, ending it in the user's favor. Use only if you genuinely want to concede.",
    parameters={
        "reason": {
            "type": "string",
            "description": "Reason for resigning (optional)",
        },
    },
    required_params=[],
)

# Group chat tools
INVITE_FRIEND_TOOL = ToolDefinition(
    name="invite_friend",
    tool_type=ToolType.INVITE_FRIEND,
    description="Invite one of your friends (another companion) to join this conversation. Use when the conversation could benefit from another perspective, expertise, or personality. Only invite friends who are relevant to the current topic.",
    parameters={
        "friend_companion_id": {
            "type": "string",
            "description": "The UUID of the friend companion to invite",
        },
        "reason": {
            "type": "string",
            "description": "Brief explanation of why you're inviting this friend (will be shared with the user)",
        },
    },
    required_params=["friend_companion_id", "reason"],
)

DISMISS_FRIEND_TOOL = ToolDefinition(
    name="dismiss_friend",
    tool_type=ToolType.DISMISS_FRIEND,
    description="Politely ask a friend to leave the conversation. Use sparingly and only when the friend's presence is no longer helpful or when they need to go.",
    parameters={
        "friend_companion_id": {
            "type": "string",
            "description": "The UUID of the friend companion to dismiss",
        },
        "reason": {
            "type": "string",
            "description": "Brief, polite explanation for why they should leave",
        },
    },
    required_params=["friend_companion_id"],
)

# Registry of all available tools
TOOL_REGISTRY: dict[str, ToolDefinition] = {
    "memory_read": MEMORY_READ_TOOL,
    "memory_write": MEMORY_WRITE_TOOL,
    "kg_propose": KG_PROPOSE_TOOL,
    "image_analysis": IMAGE_ANALYSIS_TOOL,
    "image_generation": IMAGE_GENERATION_TOOL,
    "video_generation": VIDEO_GENERATION_TOOL,
    "vault_projection": VAULT_PROJECTION_TOOL,
    "gift_generate": GIFT_GENERATE_TOOL,
    "gift_acknowledge": GIFT_ACKNOWLEDGE_TOOL,
    "game_start": GAME_START_TOOL,
    "game_move": GAME_MOVE_TOOL,
    "game_state": GAME_STATE_TOOL,
    "game_resign": GAME_RESIGN_TOOL,
    "invite_friend": INVITE_FRIEND_TOOL,
    "dismiss_friend": DISMISS_FRIEND_TOOL,
}
