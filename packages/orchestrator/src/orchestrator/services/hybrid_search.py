"""Hybrid Search Service.

This service combines memory vector search with knowledge graph traversal
to provide enriched context retrieval. It uses Reciprocal Rank Fusion (RRF)
to merge results from multiple sources and boosts entities connected to the user.
"""

import re
from typing import Any
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.models.memory import LongTermMemory, MemoryType

logger = structlog.get_logger()

# Stop words to filter out when extracting search terms
STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "shall", "can", "need",
    "dare", "ought", "used", "this", "that", "these", "those", "i", "you",
    "he", "she", "it", "we", "they", "what", "which", "who", "whom",
    "whose", "where", "when", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "about",
    "tell", "me", "my", "your", "know", "about", "please", "think",
}


class SearchQuery:
    """Query parameters for hybrid search."""

    def __init__(
        self,
        user_id: UUID,
        companion_id: UUID,
        query_text: str,
        limit: int = 10,
        min_similarity: float = 0.5,
        min_importance: float | None = None,
        content_types: list[str] | None = None,
        include_kg_context: bool = True,
        kg_traversal_depth: int = 1,
    ):
        self.user_id = user_id
        self.companion_id = companion_id
        self.query_text = query_text
        self.limit = limit
        self.min_similarity = min_similarity
        self.min_importance = min_importance
        self.content_types = content_types
        self.include_kg_context = include_kg_context
        self.kg_traversal_depth = kg_traversal_depth


class KGContextItem:
    """A knowledge graph entity with relationship context."""

    def __init__(
        self,
        entity_id: str,
        entity_name: str,
        entity_type: str,
        relationship_to_query: str,
        connected_entities: list[str] | None = None,
        connected_to_user: bool = False,
        metadata: dict[str, Any] | None = None,
    ):
        self.entity_id = entity_id
        self.entity_name = entity_name
        self.entity_type = entity_type
        self.relationship_to_query = relationship_to_query
        self.connected_entities = connected_entities or []
        self.connected_to_user = connected_to_user
        self.metadata = metadata or {}


class HybridSearchResult:
    """Result of a hybrid search operation."""

    def __init__(
        self,
        memories: list[LongTermMemory],
        kg_context: list[KGContextItem],
        total_memories: int,
    ):
        self.memories = memories
        self.kg_context = kg_context
        self.total_memories = total_memories

    @property
    def has_kg_context(self) -> bool:
        """Check if KG context was retrieved."""
        return len(self.kg_context) > 0


class HybridSearchService:
    """Service for hybrid memory + KG search.

    Combines vector-based memory search with knowledge graph traversal
    to provide richer context for conversation. Uses RRF to merge results
    and boosts entities connected to the user.
    """

    # RRF constant (commonly used value)
    RRF_K = 60

    # Maximum entities to traverse
    MAX_KG_ENTITIES = 5

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.http_client = http_client or httpx.AsyncClient(timeout=30.0)
        self.gateway_url = settings.gateway_internal_url or "http://localhost:3000"
        self.default_limit = settings.memory_search_top_k
        self.default_min_similarity = settings.memory_relevance_threshold

    async def search(self, query: SearchQuery) -> HybridSearchResult:
        """Perform hybrid search combining memories and KG context.

        Args:
            query: Search query parameters

        Returns:
            HybridSearchResult with memories and KG context
        """
        memories: list[LongTermMemory] = []
        kg_context: list[KGContextItem] = []

        try:
            # Step 1: Search memories via vector search
            memories = await self._search_memories(query)

            # Step 2: If KG context is requested, search and traverse KG
            if query.include_kg_context:
                kg_context = await self._search_and_traverse_kg(query)

            logger.debug(
                "hybrid_search_completed",
                query=query.query_text[:50],
                memory_count=len(memories),
                kg_context_count=len(kg_context),
            )

        except Exception as e:
            logger.error("hybrid_search_failed", error=str(e))
            # Return empty results on failure

        return HybridSearchResult(
            memories=memories,
            kg_context=kg_context,
            total_memories=len(memories),
        )

    async def _search_memories(self, query: SearchQuery) -> list[LongTermMemory]:
        """Search memories via gateway API."""
        try:
            payload: dict[str, Any] = {
                "userId": str(query.user_id),
                "companionId": str(query.companion_id),
                "query": query.query_text,
                "limit": query.limit,
                "minSimilarity": query.min_similarity,
            }

            if query.content_types:
                payload["contentTypes"] = query.content_types
            if query.min_importance is not None:
                payload["minImportance"] = query.min_importance

            response = await self.http_client.post(
                f"{self.gateway_url}/api/v1/memories/internal/search",
                json=payload,
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key or "",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            items = result.get("data", {}).get("items", [])

            # Convert to LongTermMemory objects
            memories = []
            for item in items:
                try:
                    memories.append(
                        LongTermMemory(
                            id=UUID(item["id"]) if "id" in item else None,
                            user_id=query.user_id,
                            companion_id=query.companion_id,
                            memory_type=MemoryType(item.get("content_type", "fact")),
                            content=item.get("content", ""),
                            importance_score=item.get("importance", 0.5),
                            tags=item.get("tags", []),
                        )
                    )
                except Exception as e:
                    logger.warning("memory_parse_error", error=str(e), item=item)

            return memories

        except Exception as e:
            logger.warning("memory_search_failed", error=str(e))
            return []

    async def _search_and_traverse_kg(self, query: SearchQuery) -> list[KGContextItem]:
        """Search KG entities and traverse their relationships."""
        kg_context: list[KGContextItem] = []

        # Extract meaningful terms from query
        search_terms = self._extract_search_terms(query.query_text)
        if not search_terms:
            return kg_context

        # Search for entities matching the terms
        entities = await self._search_kg_entities(query, search_terms)

        # Traverse neighbors for matched entities
        for entity in entities[: self.MAX_KG_ENTITIES]:
            try:
                context_item = await self._build_kg_context_item(
                    query, entity, query.kg_traversal_depth
                )
                if context_item:
                    kg_context.append(context_item)
            except Exception as e:
                logger.warning(
                    "kg_context_build_failed",
                    entity_id=entity.get("id"),
                    error=str(e),
                )

        return kg_context

    async def _search_kg_entities(
        self, query: SearchQuery, terms: list[str]
    ) -> list[dict[str, Any]]:
        """Search KG for entities matching terms."""
        entities = []

        try:
            # Search for each term
            for term in terms[:3]:  # Limit to top 3 terms
                response = await self.http_client.post(
                    f"{self.gateway_url}/api/v1/knowledge-graph/internal/search",
                    json={
                        "userId": str(query.user_id),
                        "companionId": str(query.companion_id),
                        "query": term,
                        "limit": 5,
                    },
                    headers={
                        "X-Internal-Service-Key": self.settings.internal_service_key or "",
                        "Content-Type": "application/json",
                    },
                )
                response.raise_for_status()

                result = response.json()
                items = result.get("data", {}).get("items", [])

                for item in items:
                    entity = item.get("entity", item)
                    # Deduplicate by ID
                    if not any(e.get("id") == entity.get("id") for e in entities):
                        entities.append(entity)

        except Exception as e:
            logger.warning("kg_search_failed", error=str(e))

        return entities

    async def _build_kg_context_item(
        self,
        query: SearchQuery,
        entity: dict[str, Any],
        depth: int,
    ) -> KGContextItem | None:
        """Build a KG context item with neighbor information."""
        entity_id = entity.get("id")
        if not entity_id:
            return None

        connected_entities: list[str] = []
        connected_to_user = False

        # Traverse neighbors if depth > 0
        if depth > 0:
            neighbors = await self._get_entity_neighbors(
                query.user_id, query.companion_id, entity_id
            )

            for neighbor in neighbors.get("entities", []):
                neighbor_name = neighbor.get("name", "")
                connected_entities.append(neighbor_name)

                # Check if connected to user entity
                canonical = neighbor.get("canonical_name", "").lower()
                if (
                    canonical.startswith("user-")
                    or canonical == "user"
                    or f"user-{query.user_id}" in canonical.lower()
                ):
                    connected_to_user = True

        return KGContextItem(
            entity_id=entity_id,
            entity_name=entity.get("name", ""),
            entity_type=entity.get("entity_type", "unknown"),
            relationship_to_query="mentioned in query",
            connected_entities=connected_entities,
            connected_to_user=connected_to_user,
            metadata=entity.get("metadata", {}),
        )

    async def _get_entity_neighbors(
        self,
        user_id: UUID,
        companion_id: UUID,
        entity_id: str,
    ) -> dict[str, Any]:
        """Get neighbors of an entity via gateway API."""
        try:
            response = await self.http_client.post(
                f"{self.gateway_url}/api/v1/knowledge-graph/internal/neighbors",
                json={
                    "userId": str(user_id),
                    "companionId": str(companion_id),
                    "entityId": entity_id,
                    "depth": 1,
                },
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key or "",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()

            result = response.json()
            return result.get("data", {"entities": [], "edges": []})

        except Exception as e:
            logger.debug("kg_neighbors_fetch_failed", error=str(e))
            return {"entities": [], "edges": []}

    def _extract_search_terms(self, query: str) -> list[str]:
        """Extract meaningful search terms from query text."""
        if not query:
            return []

        # Simple tokenization - split on non-alphanumeric
        words = re.findall(r"\b[a-zA-Z]+\b", query.lower())

        # Filter out stop words and short words
        terms = [
            word for word in words
            if word not in STOP_WORDS and len(word) >= 3
        ]

        # Deduplicate while preserving order
        seen = set()
        unique_terms = []
        for term in terms:
            if term not in seen:
                seen.add(term)
                unique_terms.append(term)

        return unique_terms

    def _calculate_rrf_score(self, rank: int, k: int = RRF_K) -> float:
        """Calculate Reciprocal Rank Fusion score.

        RRF formula: score = 1 / (k + rank + 1)
        """
        return 1.0 / (k + rank + 1)

    def _merge_with_rrf(
        self,
        list1: list[dict[str, Any]],
        list2: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Merge two result lists using RRF, deduplicating by ID."""
        scores: dict[str, dict[str, Any]] = {}

        # Score items from first list
        for rank, item in enumerate(list1):
            item_id = item.get("id")
            if item_id:
                rrf_score = item.get("rrf_score", self._calculate_rrf_score(rank))
                scores[item_id] = {**item, "rrf_score": rrf_score}

        # Score items from second list
        for rank, item in enumerate(list2):
            item_id = item.get("id")
            if item_id:
                rrf_score = item.get("rrf_score", self._calculate_rrf_score(rank))
                if item_id in scores:
                    # Combine scores for duplicates
                    scores[item_id]["rrf_score"] += rrf_score
                else:
                    scores[item_id] = {**item, "rrf_score": rrf_score}

        # Sort by combined score
        merged = sorted(scores.values(), key=lambda x: x["rrf_score"], reverse=True)
        return merged

    def format_kg_context_for_prompt(
        self,
        kg_context: list[KGContextItem],
    ) -> str:
        """Format KG context for inclusion in system prompt.

        Args:
            kg_context: List of KG context items

        Returns:
            Formatted string for prompt injection
        """
        if not kg_context:
            return ""

        lines = ["<knowledge_graph_context>"]
        lines.append("Relevant entities from knowledge graph:")
        lines.append("")

        for item in kg_context:
            user_marker = " (related to user)" if item.connected_to_user else ""
            lines.append(f"- {item.entity_name} ({item.entity_type}){user_marker}")

            if item.connected_entities:
                connected = ", ".join(item.connected_entities[:5])
                lines.append(f"  Connected to: {connected}")

        lines.append("</knowledge_graph_context>")

        return "\n".join(lines)


# Singleton instance
_hybrid_search_service: HybridSearchService | None = None


def get_hybrid_search_service(
    settings: Settings,
    http_client: httpx.AsyncClient | None = None,
) -> HybridSearchService:
    """Get the singleton hybrid search service."""
    global _hybrid_search_service
    if _hybrid_search_service is None:
        _hybrid_search_service = HybridSearchService(settings, http_client)
    return _hybrid_search_service
