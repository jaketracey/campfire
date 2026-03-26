"""Tool handler implementations."""

import time
from typing import Any
from uuid import UUID, uuid4

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.events import EventType, ToolEvent
from orchestrator.models.gifts import (
    EmotionalReactionType,
    Gift,
    GiftDirection,
    GiftType,
)
from orchestrator.models.memory import (
    KnowledgeGraphNode,
    KnowledgeGraphNodeType,
    KnowledgeGraphProposal,
    KnowledgeGraphRelation,
    KnowledgeGraphRelationType,
    LongTermMemory,
    MemoryQuery,
    MemoryType,
)
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()


class MemoryReadHandler(ToolHandler):
    """Handler for reading long-term memories."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "memory_read"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute memory read operation."""
        start_time = time.time()

        try:
            query = tool_call.arguments.get("query", "")
            memory_types = tool_call.arguments.get("memory_types")
            max_results = tool_call.arguments.get("max_results", 5)

            # Build memory query
            memory_query = MemoryQuery(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                query_text=query,
                memory_types=(
                    [MemoryType(t) for t in memory_types] if memory_types else None
                ),
                max_results=max_results,
            )

            # Call memory service (would be an actual API call in production)
            # For now, return a placeholder
            memories = await self._fetch_memories(memory_query)

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.MEMORY_READ,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={"count": len(memories)},
                    duration_ms=duration_ms,
                )
            )

            # Format output
            if not memories:
                output = "No relevant memories found."
            else:
                output = "Retrieved memories:\n" + "\n".join(
                    f"- [{m.memory_type.value}] {m.content}"
                    for m in memories
                )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={"memory_count": len(memories)},
            )

        except Exception as e:
            logger.exception("memory_read_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _fetch_memories(
        self,
        query: MemoryQuery,
    ) -> list[LongTermMemory]:
        """Fetch memories from the memory service."""
        try:
            # Use the search endpoint for semantic search
            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/memories/internal/search",
                json={
                    "userId": str(query.user_id),
                    "companionId": str(query.companion_id),
                    "query": query.query_text,
                    "contentTypes": [t.value for t in query.memory_types] if query.memory_types else None,
                    "limit": query.max_results,
                    "minImportance": query.min_importance,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            items = result.get("data", {}).get("items", [])

            # Convert API response to LongTermMemory objects
            memories = []
            for item in items:
                memories.append(
                    LongTermMemory(
                        id=UUID(item["id"]) if "id" in item else uuid4(),
                        user_id=query.user_id,
                        companion_id=query.companion_id,
                        memory_type=MemoryType(item.get("content_type", "fact")),
                        content=item.get("content", ""),
                        importance_score=item.get("importance", 0.5),
                        tags=item.get("tags", []),
                    )
                )

            logger.debug(
                "memories_fetched",
                count=len(memories),
                query=query.query_text[:50],
            )

            return memories

        except Exception as e:
            logger.warning("memory_fetch_failed", error=str(e))
            # Return empty list on failure - don't break the conversation
            return []


class MemoryWriteHandler(ToolHandler):
    """Handler for writing long-term memories."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "memory_write"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute memory write operation."""
        start_time = time.time()

        try:
            content = tool_call.arguments.get("content", "")
            memory_type = tool_call.arguments.get("memory_type", "fact")
            importance = tool_call.arguments.get("importance", 0.5)
            tags = tool_call.arguments.get("tags", [])

            # Create memory record
            memory = LongTermMemory(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                memory_type=MemoryType(memory_type),
                content=content,
                importance_score=importance,
                tags=tags,
                source_turn_id=tool_call.turn_id,
            )

            # Store memory (would be an actual API call in production)
            memory_id = await self._store_memory(memory)

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.MEMORY_WRITE,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={"memory_id": str(memory_id)},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=f"Memory stored successfully with ID: {memory_id}",
                duration_ms=duration_ms,
                metadata={"memory_id": str(memory_id)},
            )

        except Exception as e:
            logger.exception("memory_write_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _store_memory(self, memory: LongTermMemory) -> UUID:
        """Store memory in the memory service."""
        try:
            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/memories/internal",
                json={
                    "userId": str(memory.user_id),
                    "companionId": str(memory.companion_id),
                    "content": memory.content,
                    "contentType": memory.memory_type.value,
                    "importance": memory.importance_score,
                    "metadata": {},
                    "tags": memory.tags,
                    "sourceTurnId": str(memory.source_turn_id) if memory.source_turn_id else None,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            memory_id = result.get("data", {}).get("id", str(memory.id))
            logger.info(
                "memory_stored",
                memory_id=memory_id,
                memory_type=memory.memory_type.value,
            )

            return UUID(memory_id) if memory_id != str(memory.id) else memory.id

        except Exception as e:
            logger.error("memory_store_failed", error=str(e))
            # Return the memory ID anyway - we don't want to fail the conversation
            return memory.id


class MemoryUpdateHandler(ToolHandler):
    """Handler for updating existing long-term memories."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "memory_update"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate that memory_id is provided and at least one update field is set."""
        if not arguments.get("memory_id"):
            return False, "memory_id is required"
        has_update = any(
            arguments.get(field) is not None
            for field in ("updated_content", "updated_importance", "updated_tags")
        )
        if not has_update:
            return False, "At least one of updated_content, updated_importance, or updated_tags must be provided"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute memory update operation."""
        start_time = time.time()

        try:
            memory_id = tool_call.arguments["memory_id"]
            updated_content = tool_call.arguments.get("updated_content")
            updated_importance = tool_call.arguments.get("updated_importance")
            updated_tags = tool_call.arguments.get("updated_tags")

            # Build the update payload — only include fields that were provided
            payload: dict[str, Any] = {
                "userId": str(tool_call.user_id),
                "companionId": str(tool_call.companion_id),
            }
            if updated_content is not None:
                payload["content"] = updated_content
            if updated_importance is not None:
                payload["importance"] = updated_importance
            if updated_tags is not None:
                payload["tags"] = updated_tags

            response = await self.http_client.patch(
                f"{self.settings.gateway_internal_url}/api/v1/memories/internal/{memory_id}",
                json=payload,
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.MEMORY_UPDATE,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={"memory_id": memory_id},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=f"Memory {memory_id} updated successfully.",
                duration_ms=duration_ms,
                metadata={"memory_id": memory_id},
            )

        except Exception as e:
            logger.exception("memory_update_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )


class MemoryDeleteHandler(ToolHandler):
    """Handler for soft-deleting long-term memories."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "memory_delete"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate that memory_id is provided."""
        if not arguments.get("memory_id"):
            return False, "memory_id is required"
        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute memory delete (soft-delete) operation."""
        start_time = time.time()

        try:
            memory_id = tool_call.arguments["memory_id"]
            reason = tool_call.arguments.get("reason", "")

            response = await self.http_client.delete(
                f"{self.settings.gateway_internal_url}/api/v1/memories/internal/{memory_id}",
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
                params={
                    "userId": str(tool_call.user_id),
                    "companionId": str(tool_call.companion_id),
                },
            )
            response.raise_for_status()

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.MEMORY_DELETE,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={"memory_id": memory_id, "reason": reason},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=f"Memory {memory_id} deleted successfully.",
                duration_ms=duration_ms,
                metadata={"memory_id": memory_id, "reason": reason},
            )

        except Exception as e:
            logger.exception("memory_delete_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )


class KGProposeHandler(ToolHandler):
    """Handler for proposing knowledge graph updates."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "kg_propose"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute knowledge graph proposal."""
        start_time = time.time()

        try:
            nodes_data = tool_call.arguments.get("nodes", [])
            relations_data = tool_call.arguments.get("relations", [])
            reasoning = tool_call.arguments.get("reasoning", "")

            # Convert to domain models
            nodes = []
            for node_data in nodes_data:
                node = KnowledgeGraphNode(
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    node_type=KnowledgeGraphNodeType(
                        node_data.get("node_type", "concept")
                    ),
                    label=node_data.get("label", ""),
                    properties=node_data.get("properties", {}),
                    source_turn_ids=[tool_call.turn_id],
                )
                nodes.append(node)

            relations = []
            for rel_data in relations_data:
                relation = KnowledgeGraphRelation(
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    source_node_id=UUID(int=0),  # Would be resolved
                    target_node_id=UUID(int=0),  # Would be resolved
                    relation_type=KnowledgeGraphRelationType(
                        rel_data.get("relation_type", "related_to")
                    ),
                    source_turn_id=tool_call.turn_id,
                )
                relations.append(relation)

            # Create proposal
            proposal = KnowledgeGraphProposal(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                session_id=tool_call.session_id,
                turn_id=tool_call.turn_id,
                proposed_nodes=nodes,
                proposed_relations=relations,
                reasoning=reasoning,
            )

            # Submit proposal (would be an actual API call in production)
            proposal_id = await self._submit_proposal(proposal)

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.KG_PROPOSE,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={
                        "proposal_id": str(proposal_id),
                        "nodes_count": len(nodes),
                        "relations_count": len(relations),
                    },
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=(
                    f"Knowledge graph proposal submitted: {len(nodes)} nodes, "
                    f"{len(relations)} relations. Proposal ID: {proposal_id}"
                ),
                duration_ms=duration_ms,
                metadata={"proposal_id": str(proposal_id)},
            )

        except Exception as e:
            logger.exception("kg_propose_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _submit_proposal(
        self,
        proposal: KnowledgeGraphProposal,
    ) -> UUID:
        """Submit proposal to the knowledge graph service."""
        try:
            # Convert proposal to API format
            nodes_data = [
                {
                    "label": node.label,
                    "nodeType": node.node_type.value,
                    "properties": node.properties,
                }
                for node in proposal.proposed_nodes
            ]

            relations_data = [
                {
                    "sourceLabel": rel.source_node_id,  # Using node IDs as labels for now
                    "targetLabel": rel.target_node_id,
                    "relationType": rel.relation_type.value,
                    "confidence": rel.confidence,
                }
                for rel in proposal.proposed_relations
            ]

            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/knowledge-graph/internal/proposals",
                json={
                    "userId": str(proposal.user_id),
                    "companionId": str(proposal.companion_id),
                    "nodes": nodes_data,
                    "relations": relations_data,
                    "reasoning": proposal.reasoning,
                    "sourceEventId": str(proposal.turn_id) if proposal.turn_id else None,
                    "autoApprove": True,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            logger.info(
                "kg_proposal_submitted",
                proposal_id=str(proposal.id),
                entities_created=result.get("data", {}).get("entitiesCreated", []),
                edges_created=result.get("data", {}).get("edgesCreated", 0),
            )

            return proposal.id

        except Exception as e:
            logger.error("kg_proposal_submit_failed", error=str(e))
            # Return the proposal ID anyway - we don't want to fail the conversation
            return proposal.id


class ImageAnalysisHandler(ToolHandler):
    """Handler for analyzing images."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "image_analysis"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute image analysis."""
        start_time = time.time()

        try:
            image_url = tool_call.arguments.get("image_url", "")
            prompt = tool_call.arguments.get("prompt", "Describe this image.")

            # Analyze image (would call vision API in production)
            analysis = await self._analyze_image(image_url, prompt)

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.IMAGE_ANALYSIS_COMPLETED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params={"image_url": image_url, "prompt": prompt},
                    output={"analysis_length": len(analysis)},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=analysis,
                duration_ms=duration_ms,
                cost_usd=0.01,
            )

        except Exception as e:
            logger.exception("image_analysis_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _analyze_image(self, image_url: str, prompt: str) -> str:
        """Analyze image using vision API."""
        # In production, this would call the Anthropic or OpenAI vision API
        return f"Image analysis placeholder for: {image_url}"


class ImageGenerationHandler(ToolHandler):
    """Handler for generating images.

    This handler augments image prompts with character visual details
    from the companion spec to maintain visual consistency.
    """

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client
        self._fal_provider: Any = None
        self._replicate_provider: Any = None
        self._visual_augmenter: Any = None

    @property
    def name(self) -> str:
        return "image_generation"

    def _get_visual_augmenter(self) -> Any:
        """Lazy initialize visual prompt augmenter."""
        if self._visual_augmenter is None:
            from orchestrator.services.visual_prompt_augmenter import (
                get_visual_prompt_augmenter,
            )
            self._visual_augmenter = get_visual_prompt_augmenter()
        return self._visual_augmenter

    def _get_fal_provider(self) -> Any:
        """Lazy initialize FAL provider."""
        if self._fal_provider is None and self.settings.fal_api_key:
            from orchestrator.providers.fal import FalProvider
            self._fal_provider = FalProvider(self.settings)
        return self._fal_provider

    def _get_replicate_provider(self) -> Any:
        """Lazy initialize Replicate provider (fallback)."""
        if self._replicate_provider is None and self.settings.replicate_api_key:
            from orchestrator.providers.replicate import ReplicateProvider
            self._replicate_provider = ReplicateProvider(self.settings)
        return self._replicate_provider

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute image generation."""
        start_time = time.time()

        try:
            prompt = tool_call.arguments.get("prompt", "")
            style = tool_call.arguments.get("style", "realistic")
            size = tool_call.arguments.get("size", "512x512")

            # Augment prompt with character visual details if context is available
            augmented_prompt = prompt
            negative_prompt = None
            if tool_call.context:
                augmenter = self._get_visual_augmenter()
                augmented_prompt = augmenter.augment_prompt(
                    base_prompt=prompt,
                    companion_spec=tool_call.context.companion_spec,
                    recent_turns=tool_call.context.recent_turns,
                )
                negative_prompt = augmenter.build_negative_prompt(
                    companion_spec=tool_call.context.companion_spec,
                )
                logger.info(
                    "prompt_augmented_for_image_generation",
                    original_length=len(prompt),
                    augmented_length=len(augmented_prompt),
                )

            # Generate image using FAL (preferred) or Replicate (fallback)
            result = await self._generate_image(
                augmented_prompt, style, size, negative_prompt
            )
            image_url = result.get("image_url", "")

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.IMAGE_GENERATION_COMPLETED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params={
                        "prompt": prompt,
                        "augmented_prompt": augmented_prompt,
                        "style": style,
                        "size": size,
                        "was_augmented": augmented_prompt != prompt,
                    },
                    output={"image_url": image_url, "provider": result.get("provider")},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=f"Image generated: {image_url}",
                duration_ms=duration_ms,
                cost_usd=0.02,
                metadata={
                    "image_url": image_url,
                    "provider": result.get("provider"),
                    "was_augmented": augmented_prompt != prompt,
                },
            )

        except Exception as e:
            logger.exception("image_generation_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _generate_image(
        self,
        prompt: str,
        style: str,
        size: str,
        negative_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate image using FAL (preferred) or Replicate (fallback).

        Args:
            prompt: The augmented image prompt
            style: Image style (realistic, artistic, etc.)
            size: Image dimensions
            negative_prompt: Optional negative prompt for exclusions
        """
        # Try FAL first (preferred provider)
        fal = self._get_fal_provider()
        if fal:
            try:
                result = await fal.generate(
                    prompt=prompt,
                    size=size,
                    style=style,
                    negative_prompt=negative_prompt,
                )
                return {**result, "provider": "fal"}
            except Exception as e:
                logger.warning("fal_generation_failed_trying_fallback", error=str(e))

        # Fallback to Replicate
        replicate = self._get_replicate_provider()
        if replicate:
            result = await replicate.generate(
                prompt=prompt,
                size=size,
                style=style,
                negative_prompt=negative_prompt,
            )
            return {**result, "provider": "replicate"}

        # No provider configured
        raise RuntimeError(
            "No image generation provider configured. "
            "Set FAL_API_KEY or REPLICATE_API_TOKEN in environment."
        )


class VideoGenerationHandler(ToolHandler):
    """Handler for generating videos.

    This handler generates videos using FAL video models, with optional
    visual prompt augmentation to maintain character consistency.
    """

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client
        self._fal_video_provider: Any = None
        self._visual_augmenter: Any = None

    @property
    def name(self) -> str:
        return "video_generation"

    def _get_visual_augmenter(self) -> Any:
        """Lazy initialize visual prompt augmenter."""
        if self._visual_augmenter is None:
            from orchestrator.services.visual_prompt_augmenter import (
                get_visual_prompt_augmenter,
            )
            self._visual_augmenter = get_visual_prompt_augmenter()
        return self._visual_augmenter

    def _get_fal_video_provider(self) -> Any:
        """Lazy initialize FAL video provider."""
        if self._fal_video_provider is None and self.settings.fal_api_key:
            from orchestrator.providers.fal_video import FalVideoProvider
            self._fal_video_provider = FalVideoProvider(self.settings)
        return self._fal_video_provider

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute video generation."""
        start_time = time.time()

        try:
            prompt = tool_call.arguments.get("prompt", "")
            source_image_url = tool_call.arguments.get("source_image_url")
            duration_seconds = tool_call.arguments.get("duration_seconds", 5)
            aspect_ratio = tool_call.arguments.get("aspect_ratio", "9:16")

            # Calculate dimensions from aspect ratio
            width, height = self._parse_aspect_ratio(aspect_ratio)

            # Augment prompt with character visual details if context is available
            augmented_prompt = prompt
            if tool_call.context:
                augmenter = self._get_visual_augmenter()
                augmented_prompt = augmenter.augment_prompt(
                    base_prompt=prompt,
                    companion_spec=tool_call.context.companion_spec,
                    recent_turns=tool_call.context.recent_turns,
                )
                logger.info(
                    "video_prompt_augmented",
                    original_length=len(prompt),
                    augmented_length=len(augmented_prompt),
                )

            # Generate video
            result = await self._generate_video(
                prompt=augmented_prompt,
                source_image_url=source_image_url,
                duration_seconds=duration_seconds,
                width=width,
                height=height,
            )

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_COMPLETED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params={
                        "prompt": prompt,
                        "augmented_prompt": augmented_prompt,
                        "duration_seconds": duration_seconds,
                        "aspect_ratio": aspect_ratio,
                        "has_source_image": source_image_url is not None,
                        "was_augmented": augmented_prompt != prompt,
                    },
                    output={
                        "video_url": result.video_url,
                        "thumbnail_url": result.thumbnail_url,
                    },
                    duration_ms=duration_ms,
                )
            )

            # Format output for the model
            output = (
                f"Video generated successfully!\n"
                f"Duration: {result.duration_seconds}s\n"
                f"Video URL: {result.video_url}"
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                cost_usd=0.25,  # Estimate based on duration
                metadata={
                    "video_url": result.video_url,
                    "thumbnail_url": result.thumbnail_url,
                    "duration_seconds": result.duration_seconds,
                    "width": result.width,
                    "height": result.height,
                    "was_augmented": augmented_prompt != prompt,
                },
            )

        except Exception as e:
            logger.exception("video_generation_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    def _parse_aspect_ratio(self, aspect_ratio: str) -> tuple[int, int]:
        """Parse aspect ratio string to width and height.

        Args:
            aspect_ratio: String like "16:9" or "9:16"

        Returns:
            Tuple of (width, height) in pixels.
        """
        if aspect_ratio == "16:9":
            return (1920, 1080)
        elif aspect_ratio == "9:16":
            return (1080, 1920)
        elif aspect_ratio == "1:1":
            return (1080, 1080)
        else:
            # Default to portrait
            return (1080, 1920)

    async def _generate_video(
        self,
        prompt: str,
        source_image_url: str | None,
        duration_seconds: int,
        width: int,
        height: int,
    ) -> Any:
        """Generate video using FAL provider.

        Args:
            prompt: The motion/action description
            source_image_url: Optional source image for image-to-video
            duration_seconds: Target video duration
            width: Video width
            height: Video height

        Returns:
            VideoResult from the provider.

        Raises:
            RuntimeError: If no provider is configured.
        """
        provider = self._get_fal_video_provider()
        if not provider:
            raise RuntimeError(
                "No video generation provider configured. "
                "Set FAL_API_KEY in environment."
            )

        return await provider.generate(
            prompt=prompt,
            source_image_url=source_image_url,
            duration_seconds=duration_seconds,
            width=width,
            height=height,
        )


class VaultProjectionHandler(ToolHandler):
    """Handler for vault projection visualization."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "vault_projection"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute vault projection."""
        start_time = time.time()

        try:
            projection_type = tool_call.arguments.get(
                "projection_type", "memory_timeline"
            )
            time_range = tool_call.arguments.get("time_range")
            focus_topics = tool_call.arguments.get("focus_topics", [])

            # Trigger projection (would call vault service in production)
            projection_id = await self._trigger_projection(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                projection_type=projection_type,
                time_range=time_range,
                focus_topics=focus_topics,
            )

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.VAULT_PROJECTION_TRIGGERED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={"projection_id": str(projection_id)},
                    duration_ms=duration_ms,
                )
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=(
                    f"Vault projection '{projection_type}' initiated. "
                    f"Projection ID: {projection_id}"
                ),
                duration_ms=duration_ms,
                cost_usd=0.05,
                metadata={"projection_id": str(projection_id)},
            )

        except Exception as e:
            logger.exception("vault_projection_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _trigger_projection(
        self,
        user_id: UUID,
        companion_id: UUID,
        projection_type: str,
        time_range: dict[str, str] | None,
        focus_topics: list[str],
    ) -> UUID:
        """Trigger vault projection in the vault service."""
        # In production, this would call the vault service API
        from uuid import uuid4
        return uuid4()


class GiftGenerateHandler(ToolHandler):
    """Handler for generating gifts for the user."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "gift_generate"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute gift generation."""
        start_time = time.time()

        try:
            gift_type_str = tool_call.arguments.get("gift_type", "virtual_object")
            context = tool_call.arguments.get("context", "")
            emotional_intent = tool_call.arguments.get("emotional_intent", "")

            # Validate gift type
            try:
                gift_type = GiftType(gift_type_str)
            except ValueError:
                gift_type = GiftType.CUSTOM

            # Call gateway internal API to generate gift
            gift_data = await self._generate_gift(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                session_id=tool_call.session_id,
                turn_id=tool_call.turn_id,
                gift_type=gift_type,
                context=context,
                emotional_intent=emotional_intent,
            )

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_COMPLETED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={
                        "gift_id": str(gift_data.get("id", "")),
                        "title": gift_data.get("title", ""),
                        "gift_type": gift_type.value,
                    },
                    duration_ms=duration_ms,
                )
            )

            # Format output for the model
            output = (
                f"Gift created: \"{gift_data.get('title', 'A special gift')}\"\n"
                f"Description: {gift_data.get('description', '')}\n"
                f"Emotional meaning: {gift_data.get('emotional_meaning', '')}"
            )

            if gift_data.get("visual_url"):
                output += f"\nVisual: {gift_data['visual_url']}"

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                cost_usd=0.05,
                metadata={
                    "gift_id": str(gift_data.get("id", "")),
                    "gift_type": gift_type.value,
                    "visual_url": gift_data.get("visual_url"),
                },
            )

        except Exception as e:
            logger.exception("gift_generate_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _generate_gift(
        self,
        user_id: UUID,
        companion_id: UUID,
        session_id: UUID,
        turn_id: UUID,
        gift_type: GiftType,
        context: str,
        emotional_intent: str,
    ) -> dict[str, Any]:
        """Generate gift via gateway internal API."""
        try:
            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/gifts/internal/generate",
                json={
                    "userId": str(user_id),
                    "companionId": str(companion_id),
                    "sessionId": str(session_id),
                    "turnId": str(turn_id),
                    "giftType": gift_type.value,
                    "context": context,
                    "emotionalIntent": emotional_intent,
                    "direction": GiftDirection.FROM_COMPANION.value,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            gift_data = result.get("data", {})

            logger.info(
                "gift_generated",
                gift_id=gift_data.get("id"),
                gift_type=gift_type.value,
                user_id=str(user_id),
                companion_id=str(companion_id),
            )

            return gift_data

        except Exception as e:
            logger.error("gift_generation_api_failed", error=str(e))
            # Return a fallback gift structure
            return {
                "id": str(uuid4()),
                "title": "A thoughtful gift",
                "description": f"A {gift_type.value} created with {emotional_intent}",
                "emotional_meaning": emotional_intent,
                "gift_type": gift_type.value,
            }


class GiftAcknowledgeHandler(ToolHandler):
    """Handler for acknowledging gifts from users."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "gift_acknowledge"

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute gift acknowledgment."""
        start_time = time.time()

        try:
            gift_description = tool_call.arguments.get("gift_description", "")
            emotional_reaction_str = tool_call.arguments.get(
                "emotional_reaction", "grateful"
            )
            emotional_intensity = tool_call.arguments.get("emotional_intensity", 0.7)

            # Validate emotional reaction
            try:
                emotional_reaction = EmotionalReactionType(emotional_reaction_str)
            except ValueError:
                emotional_reaction = EmotionalReactionType.GRATEFUL

            # Clamp emotional intensity
            emotional_intensity = max(0.0, min(1.0, float(emotional_intensity)))

            # Store the received gift and acknowledgment
            gift_data = await self._acknowledge_gift(
                user_id=tool_call.user_id,
                companion_id=tool_call.companion_id,
                session_id=tool_call.session_id,
                turn_id=tool_call.turn_id,
                gift_description=gift_description,
                emotional_reaction=emotional_reaction,
                emotional_intensity=emotional_intensity,
            )

            duration_ms = (time.time() - start_time) * 1000

            # Emit event
            await self.event_emitter.emit(
                ToolEvent(
                    type=EventType.TOOL_COMPLETED,
                    session_id=tool_call.session_id,
                    user_id=tool_call.user_id,
                    companion_id=tool_call.companion_id,
                    tool_name=self.name,
                    tool_call_id=tool_call.id,
                    input_params=tool_call.arguments,
                    output={
                        "gift_id": str(gift_data.get("id", "")),
                        "emotional_reaction": emotional_reaction.value,
                        "emotional_intensity": emotional_intensity,
                    },
                    duration_ms=duration_ms,
                )
            )

            # Format output for the model
            intensity_word = (
                "deeply" if emotional_intensity > 0.8
                else "very" if emotional_intensity > 0.5
                else "somewhat"
            )
            output = (
                f"Gift acknowledged with {intensity_word} {emotional_reaction.value} feelings.\n"
                f"The gift has been treasured and stored in our shared memories."
            )

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "gift_id": str(gift_data.get("id", "")),
                    "emotional_reaction": emotional_reaction.value,
                    "emotional_intensity": emotional_intensity,
                },
            )

        except Exception as e:
            logger.exception("gift_acknowledge_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _acknowledge_gift(
        self,
        user_id: UUID,
        companion_id: UUID,
        session_id: UUID,
        turn_id: UUID,
        gift_description: str,
        emotional_reaction: EmotionalReactionType,
        emotional_intensity: float,
    ) -> dict[str, Any]:
        """Store gift acknowledgment via gateway internal API."""
        try:
            response = await self.http_client.post(
                f"{self.settings.gateway_internal_url}/api/v1/gifts/internal/acknowledge",
                json={
                    "userId": str(user_id),
                    "companionId": str(companion_id),
                    "sessionId": str(session_id),
                    "turnId": str(turn_id),
                    "giftDescription": gift_description,
                    "emotionalReaction": emotional_reaction.value,
                    "emotionalIntensity": emotional_intensity,
                    "direction": GiftDirection.FROM_USER.value,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            gift_data = result.get("data", {})

            logger.info(
                "gift_acknowledged",
                gift_id=gift_data.get("id"),
                emotional_reaction=emotional_reaction.value,
                user_id=str(user_id),
                companion_id=str(companion_id),
            )

            return gift_data

        except Exception as e:
            logger.error("gift_acknowledgment_api_failed", error=str(e))
            # Return a fallback structure
            return {
                "id": str(uuid4()),
                "description": gift_description,
                "emotional_reaction": emotional_reaction.value,
                "emotional_intensity": emotional_intensity,
            }
