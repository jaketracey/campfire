"""Memory and knowledge graph domain models."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class MemoryType(str, Enum):
    """Types of long-term memory."""

    FACT = "fact"
    PREFERENCE = "preference"
    EXPERIENCE = "experience"
    RELATIONSHIP = "relationship"
    GOAL = "goal"
    CONTEXT = "context"


class LongTermMemory(BaseModel):
    """A long-term memory record."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    memory_type: MemoryType
    content: str
    embedding: list[float] | None = None
    importance_score: float = 0.5
    access_count: int = 0
    last_accessed: datetime | None = None
    source_turn_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    is_pinned: bool = False
    pin_order: int | None = None

    class Config:
        frozen = True


class MemoryQuery(BaseModel):
    """Query for retrieving memories."""

    user_id: UUID
    companion_id: UUID
    query_text: str
    query_embedding: list[float] | None = None
    memory_types: list[MemoryType] | None = None
    min_importance: float = 0.0
    max_results: int = 10
    include_expired: bool = False
    tags: list[str] | None = None
    time_range_start: datetime | None = None
    time_range_end: datetime | None = None


class MemoryResult(BaseModel):
    """Result from a memory query."""

    memories: list[LongTermMemory]
    total_count: int
    query_latency_ms: float = 0.0
    relevance_scores: list[float] = Field(default_factory=list)


class KnowledgeGraphNodeType(str, Enum):
    """Types of knowledge graph nodes."""

    PERSON = "person"
    PLACE = "place"
    THING = "thing"
    EVENT = "event"
    CONCEPT = "concept"
    EMOTION = "emotion"
    ACTIVITY = "activity"
    TIME = "time"


class KnowledgeGraphRelationType(str, Enum):
    """Types of relationships in the knowledge graph."""

    KNOWS = "knows"
    LIKES = "likes"
    DISLIKES = "dislikes"
    LOCATED_AT = "located_at"
    WORKS_AT = "works_at"
    RELATED_TO = "related_to"
    PART_OF = "part_of"
    CAUSES = "causes"
    EXPERIENCED = "experienced"
    WANTS = "wants"
    HAS = "has"
    IS_A = "is_a"


class KnowledgeGraphNode(BaseModel):
    """A node in the knowledge graph."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    node_type: KnowledgeGraphNodeType
    label: str
    properties: dict[str, Any] = Field(default_factory=dict)
    embedding: list[float] | None = None
    confidence: float = 1.0
    source_turn_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True


class KnowledgeGraphRelation(BaseModel):
    """A relation between nodes in the knowledge graph."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    relation_type: KnowledgeGraphRelationType
    properties: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    source_turn_id: UUID | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True


class KnowledgeGraphProposal(BaseModel):
    """A proposed addition or modification to the knowledge graph."""

    id: UUID = Field(default_factory=uuid4)
    user_id: UUID
    companion_id: UUID
    session_id: UUID
    turn_id: UUID
    proposed_nodes: list[KnowledgeGraphNode] = Field(default_factory=list)
    proposed_relations: list[KnowledgeGraphRelation] = Field(default_factory=list)
    nodes_to_remove: list[UUID] = Field(default_factory=list)
    relations_to_remove: list[UUID] = Field(default_factory=list)
    reasoning: str | None = None
    confidence: float = 0.8
    status: str = "pending"
    reviewed_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CompanionSelfKnowledge(BaseModel):
    """A piece of self-knowledge from the companion's Knowledge Graph.

    This represents facts, experiences, traits, and other information
    that the companion knows about itself. These are retrieved from
    the KG where the companion is the source entity.
    """

    category: str  # backstory, trait, quirk, experience, motivation, relationship
    content: str
    confidence: float = 1.0

    class Config:
        frozen = True
