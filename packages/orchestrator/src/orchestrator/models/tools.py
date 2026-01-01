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
    VAULT_PROJECTION = "vault_projection"
    WEB_SEARCH = "web_search"
    CALENDAR = "calendar"
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


class ToolCall(BaseModel):
    """A request to invoke a tool."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    arguments: dict[str, Any]
    turn_id: UUID
    session_id: UUID
    user_id: UUID
    companion_id: UUID
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

# Registry of all available tools
TOOL_REGISTRY: dict[str, ToolDefinition] = {
    "memory_read": MEMORY_READ_TOOL,
    "memory_write": MEMORY_WRITE_TOOL,
    "kg_propose": KG_PROPOSE_TOOL,
    "image_analysis": IMAGE_ANALYSIS_TOOL,
    "image_generation": IMAGE_GENERATION_TOOL,
    "vault_projection": VAULT_PROJECTION_TOOL,
}
