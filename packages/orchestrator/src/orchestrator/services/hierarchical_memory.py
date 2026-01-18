"""Hierarchical Memory Clustering Service.

This service implements Layla-style L1/L2 hierarchical memory clustering
for faster retrieval and broader context. L1 contains individual memory
facts while L2 contains cluster summaries for broader topical context.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

import numpy as np
import structlog

logger = structlog.get_logger()


class MemoryLevel(str, Enum):
    """Memory hierarchy levels."""

    L1 = "individual"
    """Individual memory facts (direct retrieval)."""

    L2 = "cluster"
    """Cluster summaries (broader context)."""


@dataclass
class ClusterConfig:
    """Configuration for memory clustering."""

    min_cluster_size: int = 3
    """Minimum memories required to form a cluster."""

    max_clusters: int = 20
    """Maximum number of clusters per user-companion pair."""

    similarity_threshold: float = 0.75
    """Cosine similarity threshold for cluster membership."""

    l2_summary_max_tokens: int = 200
    """Maximum tokens for L2 cluster summaries."""

    recluster_threshold: int = 20
    """Number of new memories before reclustering is triggered."""

    recluster_interval_hours: int = 24
    """Minimum hours between reclustering operations."""


@dataclass
class MemoryCluster:
    """A cluster of related memories (L2 level)."""

    id: UUID
    """Unique identifier for the cluster."""

    companion_id: UUID
    """The companion this cluster belongs to."""

    user_id: UUID
    """The user this cluster belongs to."""

    name: str
    """Human-readable name describing the cluster topic."""

    summary: str
    """LLM-generated summary of cluster contents."""

    member_memory_ids: list[str]
    """IDs of L1 memories belonging to this cluster."""

    centroid_embedding: list[float]
    """Cluster centroid for similarity matching."""

    memories_since_summary: int = 0
    """Count of memories added since last summary update."""

    last_updated: datetime | None = None
    """When the cluster was last updated."""

    created_at: datetime = field(default_factory=datetime.utcnow)
    """When the cluster was created."""

    @property
    def member_count(self) -> int:
        """Get the number of members in this cluster."""
        return len(self.member_memory_ids)


@dataclass
class HierarchicalRetrievalResult:
    """Result of hierarchical memory retrieval."""

    l1_memories: list[dict[str, Any]]
    """Individual memories directly matching the query."""

    l2_clusters: list[MemoryCluster]
    """Related clusters providing broader context."""

    total_memories: int
    """Total number of memories represented (L1 + cluster members)."""

    @property
    def has_l2_context(self) -> bool:
        """Check if L2 cluster context is available."""
        return len(self.l2_clusters) > 0


class HierarchicalMemoryService:
    """Service for hierarchical memory clustering and retrieval.

    Implements a two-level memory hierarchy:
    - L1: Individual memory facts for precise retrieval
    - L2: Cluster summaries for broader topical context

    This approach improves retrieval speed and provides contextual
    understanding without loading all individual memories.
    """

    def __init__(self, config: ClusterConfig | None = None):
        """Initialize the hierarchical memory service.

        Args:
            config: Optional clustering configuration.
        """
        self.config = config or ClusterConfig()

    def cluster_memories(
        self,
        memories: list[dict[str, Any]],
        embeddings: list[list[float] | np.ndarray],
    ) -> list[MemoryCluster]:
        """Cluster memories into topically related groups.

        Uses a simple centroid-based clustering approach optimized for
        memory retrieval rather than strict clustering accuracy.

        Args:
            memories: List of memory objects with id and content.
            embeddings: Corresponding embedding vectors.

        Returns:
            List of MemoryCluster objects.
        """
        if not memories or not embeddings:
            return []

        # Convert to numpy for efficient computation
        try:
            emb_array = np.array(embeddings, dtype=np.float64)
        except (ValueError, TypeError):
            logger.warning("invalid_embeddings", reason="Could not convert to numpy array")
            return []

        # Handle NaN values
        if np.any(np.isnan(emb_array)):
            logger.warning("nan_in_embeddings", reason="NaN values detected")
            # Replace NaN with zeros
            emb_array = np.nan_to_num(emb_array, nan=0.0)

        # Normalize embeddings
        norms = np.linalg.norm(emb_array, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)  # Avoid division by zero
        emb_array = emb_array / norms

        # If fewer memories than min cluster size, no clustering
        if len(memories) < self.config.min_cluster_size:
            logger.debug(
                "too_few_memories_for_clustering",
                count=len(memories),
                min_required=self.config.min_cluster_size,
            )
            return []

        # Simple greedy clustering algorithm
        clusters = self._greedy_cluster(memories, emb_array)

        logger.debug(
            "memories_clustered",
            total_memories=len(memories),
            cluster_count=len(clusters),
            avg_cluster_size=np.mean([c.member_count for c in clusters]) if clusters else 0,
        )

        return clusters

    def _greedy_cluster(
        self,
        memories: list[dict[str, Any]],
        embeddings: np.ndarray,
    ) -> list[MemoryCluster]:
        """Greedy clustering algorithm.

        Assigns each memory to the most similar existing cluster or
        creates a new cluster if no cluster is similar enough.

        Args:
            memories: List of memory objects.
            embeddings: Normalized embedding matrix.

        Returns:
            List of MemoryCluster objects.
        """
        clusters: list[dict[str, Any]] = []
        assigned = set()

        # Extract a default companion_id and user_id from first memory if available
        default_companion_id = uuid4()
        default_user_id = uuid4()

        for i, (memory, embedding) in enumerate(zip(memories, embeddings)):
            if i in assigned:
                continue

            # Find most similar cluster
            best_cluster_idx = -1
            best_similarity = self.config.similarity_threshold

            for c_idx, cluster in enumerate(clusters):
                centroid = np.array(cluster["centroid"])
                similarity = float(np.dot(embedding, centroid))

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_cluster_idx = c_idx

            if best_cluster_idx >= 0:
                # Add to existing cluster
                cluster = clusters[best_cluster_idx]
                cluster["members"].append(memory)
                cluster["member_embeddings"].append(embedding)
                # Update centroid
                cluster["centroid"] = np.mean(cluster["member_embeddings"], axis=0)
                cluster["centroid"] = cluster["centroid"] / np.linalg.norm(cluster["centroid"])
            else:
                # Create new cluster if under limit
                if len(clusters) < self.config.max_clusters:
                    clusters.append({
                        "members": [memory],
                        "member_embeddings": [embedding],
                        "centroid": embedding,
                    })

            assigned.add(i)

        # Filter clusters with fewer than min members and convert to MemoryCluster
        result = []
        for cluster_data in clusters:
            if len(cluster_data["members"]) >= self.config.min_cluster_size:
                # Generate cluster name from first few memory contents
                name = self._generate_cluster_name(cluster_data["members"])

                result.append(MemoryCluster(
                    id=uuid4(),
                    companion_id=default_companion_id,
                    user_id=default_user_id,
                    name=name,
                    summary="",  # Summary generated separately
                    member_memory_ids=[m.get("id", str(uuid4())) for m in cluster_data["members"]],
                    centroid_embedding=cluster_data["centroid"].tolist(),
                ))

        return result

    def _generate_cluster_name(self, members: list[dict[str, Any]]) -> str:
        """Generate a name for a cluster based on member contents.

        Args:
            members: List of member memory objects.

        Returns:
            Generated cluster name.
        """
        # Extract tags if available
        all_tags = []
        for m in members[:5]:  # Look at first 5 members
            tags = m.get("tags", [])
            all_tags.extend(tags)

        if all_tags:
            # Use most common tag
            from collections import Counter
            tag_counts = Counter(all_tags)
            most_common_tag = tag_counts.most_common(1)[0][0]
            return f"{most_common_tag.title()} Memories"

        # Fallback to generic name
        return f"Memory Cluster"

    async def generate_cluster_summary(
        self,
        member_contents: list[str],
    ) -> str:
        """Generate an L2 summary for a cluster.

        Uses an LLM to create a concise summary of the cluster's contents.

        Args:
            member_contents: List of memory content strings.

        Returns:
            Generated summary string.
        """
        # Truncate very long content
        truncated_contents = []
        total_chars = 0
        max_total_chars = 5000

        for content in member_contents:
            if total_chars + len(content) > max_total_chars:
                remaining = max_total_chars - total_chars
                if remaining > 100:
                    truncated_contents.append(content[:remaining] + "...")
                break
            truncated_contents.append(content)
            total_chars += len(content)

        summary = await self._call_llm_for_summary(truncated_contents)

        return summary

    async def _call_llm_for_summary(self, contents: list[str]) -> str:
        """Call LLM to generate cluster summary.

        This is a placeholder that should be implemented with actual LLM call.

        Args:
            contents: List of memory contents to summarize.

        Returns:
            Generated summary.
        """
        # Placeholder - in production this would call an LLM
        return f"Summary of {len(contents)} related memories."

    async def hierarchical_retrieve(
        self,
        query_embedding: list[float],
        user_id: UUID,
        companion_id: UUID,
        limit: int = 10,
    ) -> HierarchicalRetrievalResult:
        """Retrieve memories using hierarchical approach.

        First retrieves L1 individual memories, then fetches related
        L2 cluster summaries for broader context.

        Args:
            query_embedding: Query vector for similarity search.
            user_id: User to retrieve memories for.
            companion_id: Companion to retrieve memories for.
            limit: Maximum L1 memories to return.

        Returns:
            HierarchicalRetrievalResult with L1 memories and L2 clusters.
        """
        # Get L1 memories (direct matches)
        l1_memories = await self._search_l1_memories(
            query_embedding=query_embedding,
            user_id=user_id,
            companion_id=companion_id,
            limit=limit,
        )

        # Get related L2 clusters
        l2_clusters = await self._get_related_clusters(
            query_embedding=query_embedding,
            user_id=user_id,
            companion_id=companion_id,
            l1_memory_ids=[m.get("id") for m in l1_memories if m.get("id")],
        )

        # Calculate total represented memories
        total = len(l1_memories)
        for cluster in l2_clusters:
            # Add cluster members not already in L1
            unique_members = set(cluster.member_memory_ids) - {m.get("id") for m in l1_memories}
            total += len(unique_members)

        return HierarchicalRetrievalResult(
            l1_memories=l1_memories,
            l2_clusters=l2_clusters,
            total_memories=total,
        )

    async def _search_l1_memories(
        self,
        query_embedding: list[float],
        user_id: UUID,
        companion_id: UUID,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Search for L1 individual memories.

        This is a placeholder that should be implemented with actual vector search.

        Args:
            query_embedding: Query vector.
            user_id: User to search for.
            companion_id: Companion to search for.
            limit: Maximum results.

        Returns:
            List of matching memory objects.
        """
        # Placeholder - in production this would call vector DB
        return []

    async def _get_related_clusters(
        self,
        query_embedding: list[float],
        user_id: UUID,
        companion_id: UUID,
        l1_memory_ids: list[str],
    ) -> list[MemoryCluster]:
        """Get L2 clusters related to query or L1 results.

        Args:
            query_embedding: Query vector for similarity.
            user_id: User to get clusters for.
            companion_id: Companion to get clusters for.
            l1_memory_ids: IDs of retrieved L1 memories.

        Returns:
            List of related clusters.
        """
        # Placeholder - in production this would query cluster store
        return []

    def format_for_prompt(
        self,
        result: HierarchicalRetrievalResult,
    ) -> str:
        """Format hierarchical retrieval result for prompt injection.

        Args:
            result: The retrieval result to format.

        Returns:
            Formatted string for prompt injection.
        """
        if not result.l1_memories and not result.l2_clusters:
            return ""

        lines = ["<hierarchical_memories>"]

        # Add L1 memories
        if result.l1_memories:
            lines.append("Specific memories about the user:")
            for memory in result.l1_memories:
                content = memory.get("content", "")
                lines.append(f"- {content}")
            lines.append("")

        # Add L2 cluster context
        if result.l2_clusters:
            lines.append("Broader context from memory clusters:")
            for cluster in result.l2_clusters:
                lines.append(f"- **{cluster.name}**: {cluster.summary}")
            lines.append("")

        lines.append("</hierarchical_memories>")

        return "\n".join(lines)

    def should_update_cluster(self, cluster: MemoryCluster) -> bool:
        """Determine if a cluster needs its summary updated.

        Args:
            cluster: The cluster to check.

        Returns:
            True if cluster should be updated.
        """
        # Check if many new memories added
        if cluster.memories_since_summary >= self.config.recluster_threshold:
            return True

        # Check time since last update
        if cluster.last_updated:
            from datetime import timedelta
            hours_since_update = (datetime.utcnow() - cluster.last_updated).total_seconds() / 3600

            # Update if old enough AND has new memories
            if hours_since_update >= self.config.recluster_interval_hours and cluster.memories_since_summary > 0:
                return True

        return False


# Singleton instance
_hierarchical_memory_service: HierarchicalMemoryService | None = None


def get_hierarchical_memory_service(
    config: ClusterConfig | None = None,
) -> HierarchicalMemoryService:
    """Get the singleton hierarchical memory service.

    Args:
        config: Optional configuration for the service.

    Returns:
        The HierarchicalMemoryService instance.
    """
    global _hierarchical_memory_service
    if _hierarchical_memory_service is None:
        _hierarchical_memory_service = HierarchicalMemoryService(config)
    return _hierarchical_memory_service
