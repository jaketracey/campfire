"""Tests for Hierarchical Memory Clustering Service.

These tests verify the implementation of L1/L2 hierarchical memory clustering
following the Layla-style approach for faster retrieval and broader context.
"""

import pytest
import numpy as np
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.services.hierarchical_memory import (
    HierarchicalMemoryService,
    MemoryCluster,
    ClusterConfig,
    HierarchicalRetrievalResult,
    MemoryLevel,
)


@pytest.fixture
def cluster_config():
    """Create a test cluster configuration."""
    return ClusterConfig(
        min_cluster_size=3,
        max_clusters=10,
        similarity_threshold=0.7,
        l2_summary_max_tokens=100,
    )


@pytest.fixture
def hierarchical_memory_service(cluster_config):
    """Create a hierarchical memory service instance."""
    return HierarchicalMemoryService(config=cluster_config)


@pytest.fixture
def sample_embeddings():
    """Create sample memory embeddings for testing."""
    # Create 9 embeddings in 3 natural clusters
    np.random.seed(42)

    def make_embedding(center_idx: int) -> np.ndarray:
        """Create a 1536-dim embedding centered at a specific index."""
        base = np.zeros(1536)
        base[center_idx] = 1.0
        # Use very low noise (0.01) so embeddings in same cluster stay similar
        noise = np.random.randn(1536) * 0.01
        return base + noise

    # Cluster 1: centered around index 0 - travel related
    cluster1 = [make_embedding(0) for _ in range(3)]

    # Cluster 2: centered around index 1 - food related
    cluster2 = [make_embedding(1) for _ in range(3)]

    # Cluster 3: centered around index 2 - work related
    cluster3 = [make_embedding(2) for _ in range(3)]

    # Normalize all vectors
    all_embeddings = cluster1 + cluster2 + cluster3
    return [e / np.linalg.norm(e) for e in all_embeddings]


@pytest.fixture
def sample_memories():
    """Create sample memory objects for testing."""
    return [
        # Travel cluster
        {"id": str(uuid4()), "content": "User went to Colorado last summer", "tags": ["travel"]},
        {"id": str(uuid4()), "content": "User enjoys hiking in mountains", "tags": ["travel", "activity"]},
        {"id": str(uuid4()), "content": "User wants to visit Japan someday", "tags": ["travel"]},
        # Food cluster
        {"id": str(uuid4()), "content": "User loves Italian food", "tags": ["food"]},
        {"id": str(uuid4()), "content": "User is allergic to peanuts", "tags": ["food", "health"]},
        {"id": str(uuid4()), "content": "User prefers coffee over tea", "tags": ["food"]},
        # Work cluster
        {"id": str(uuid4()), "content": "User works as a software engineer", "tags": ["work"]},
        {"id": str(uuid4()), "content": "User has meetings on Mondays", "tags": ["work"]},
        {"id": str(uuid4()), "content": "User's boss is named Sarah", "tags": ["work"]},
    ]


class TestHierarchicalMemoryServiceBasics:
    """Tests for service initialization and configuration."""

    def test_init_with_defaults(self):
        """Should initialize with default configuration."""
        service = HierarchicalMemoryService()
        assert service.config is not None
        assert service.config.min_cluster_size > 0

    def test_init_with_custom_config(self, cluster_config):
        """Should accept custom configuration."""
        service = HierarchicalMemoryService(config=cluster_config)
        assert service.config.min_cluster_size == 3
        assert service.config.max_clusters == 10

    def test_config_defaults(self):
        """Configuration should have sensible defaults."""
        config = ClusterConfig()
        assert config.min_cluster_size == 3
        assert config.max_clusters == 20
        assert config.similarity_threshold == 0.75
        assert config.l2_summary_max_tokens == 200


class TestMemoryCluster:
    """Tests for MemoryCluster model."""

    def test_cluster_creation(self):
        """Should create cluster with required fields."""
        cluster = MemoryCluster(
            id=uuid4(),
            companion_id=uuid4(),
            user_id=uuid4(),
            name="Travel Memories",
            summary="Collection of travel-related memories including trips and destinations.",
            member_memory_ids=[str(uuid4()) for _ in range(3)],
            centroid_embedding=[0.1] * 1536,
        )

        assert cluster.name == "Travel Memories"
        assert len(cluster.member_memory_ids) == 3
        assert len(cluster.centroid_embedding) == 1536

    def test_cluster_member_count(self):
        """Should correctly report member count."""
        cluster = MemoryCluster(
            id=uuid4(),
            companion_id=uuid4(),
            user_id=uuid4(),
            name="Test Cluster",
            summary="Test summary",
            member_memory_ids=[str(uuid4()) for _ in range(5)],
            centroid_embedding=[0.1] * 1536,
        )

        assert cluster.member_count == 5


class TestClusteringAlgorithm:
    """Tests for the clustering algorithm."""

    def test_cluster_similar_memories(self, hierarchical_memory_service, sample_embeddings, sample_memories):
        """Should group similar memories into clusters."""
        clusters = hierarchical_memory_service.cluster_memories(
            memories=sample_memories,
            embeddings=sample_embeddings,
        )

        # Should create clusters
        assert len(clusters) > 0

        # Each cluster should have at least min_cluster_size members
        for cluster in clusters:
            assert cluster.member_count >= hierarchical_memory_service.config.min_cluster_size

    def test_respects_max_clusters(self, hierarchical_memory_service, sample_embeddings, sample_memories):
        """Should not create more than max_clusters."""
        clusters = hierarchical_memory_service.cluster_memories(
            memories=sample_memories,
            embeddings=sample_embeddings,
        )

        assert len(clusters) <= hierarchical_memory_service.config.max_clusters

    def test_computes_centroid_embedding(self, hierarchical_memory_service, sample_embeddings, sample_memories):
        """Should compute centroid for each cluster."""
        clusters = hierarchical_memory_service.cluster_memories(
            memories=sample_memories,
            embeddings=sample_embeddings,
        )

        for cluster in clusters:
            assert len(cluster.centroid_embedding) == len(sample_embeddings[0])
            # Centroid should be normalized
            norm = np.linalg.norm(cluster.centroid_embedding)
            assert abs(norm - 1.0) < 0.01

    def test_empty_memories_returns_empty_clusters(self, hierarchical_memory_service):
        """Should return empty list for no memories."""
        clusters = hierarchical_memory_service.cluster_memories(
            memories=[],
            embeddings=[],
        )
        assert clusters == []

    def test_few_memories_no_clustering(self, hierarchical_memory_service):
        """Should handle case with fewer memories than min_cluster_size."""
        memories = [{"id": str(uuid4()), "content": "Single memory"}]
        embeddings = [np.random.randn(1536).tolist()]

        clusters = hierarchical_memory_service.cluster_memories(
            memories=memories,
            embeddings=embeddings,
        )

        # Should return empty or single-item cluster depending on implementation
        assert len(clusters) <= 1


class TestClusterSummaryGeneration:
    """Tests for L2 cluster summary generation."""

    @pytest.mark.asyncio
    async def test_generate_cluster_summary(self, hierarchical_memory_service):
        """Should generate summary from member memories."""
        member_contents = [
            "User went to Colorado last summer",
            "User enjoys hiking in mountains",
            "User wants to visit Japan someday",
        ]

        with patch.object(
            hierarchical_memory_service,
            '_call_llm_for_summary',
            new_callable=AsyncMock,
            return_value="User enjoys travel and outdoor activities, with past trips to Colorado and future plans for Japan.",
        ):
            summary = await hierarchical_memory_service.generate_cluster_summary(member_contents)

            assert len(summary) > 0
            assert len(summary.split()) <= hierarchical_memory_service.config.l2_summary_max_tokens

    @pytest.mark.asyncio
    async def test_summary_truncates_long_content(self, hierarchical_memory_service):
        """Should handle very long member contents."""
        member_contents = ["Very long content " * 100 for _ in range(10)]

        with patch.object(
            hierarchical_memory_service,
            '_call_llm_for_summary',
            new_callable=AsyncMock,
            return_value="Summarized content.",
        ):
            summary = await hierarchical_memory_service.generate_cluster_summary(member_contents)

            assert summary is not None


class TestHierarchicalRetrieval:
    """Tests for hierarchical retrieval (L1 + L2)."""

    @pytest.mark.asyncio
    async def test_retrieval_returns_l1_memories(self, hierarchical_memory_service):
        """Should return L1 (individual) memories when directly relevant."""
        query_embedding = [1.0] + [0.0] * 1535  # Similar to first cluster

        l1_memories = [
            {"id": "1", "content": "Direct match memory", "embedding": [1.0] + [0.0] * 1535},
        ]

        with patch.object(
            hierarchical_memory_service,
            '_search_l1_memories',
            new_callable=AsyncMock,
            return_value=l1_memories,
        ):
            result = await hierarchical_memory_service.hierarchical_retrieve(
                query_embedding=query_embedding,
                user_id=uuid4(),
                companion_id=uuid4(),
                limit=5,
            )

            assert isinstance(result, HierarchicalRetrievalResult)
            assert len(result.l1_memories) > 0

    @pytest.mark.asyncio
    async def test_retrieval_includes_l2_context(self, hierarchical_memory_service):
        """Should include L2 cluster context for broader understanding."""
        query_embedding = [1.0] + [0.0] * 1535

        l1_memories = [{"id": "1", "content": "Travel memory"}]
        l2_clusters = [
            MemoryCluster(
                id=uuid4(),
                companion_id=uuid4(),
                user_id=uuid4(),
                name="Travel Cluster",
                summary="User loves travel and outdoor activities.",
                member_memory_ids=["1", "2", "3"],
                centroid_embedding=[1.0] + [0.0] * 1535,
            )
        ]

        with patch.object(
            hierarchical_memory_service,
            '_search_l1_memories',
            new_callable=AsyncMock,
            return_value=l1_memories,
        ):
            with patch.object(
                hierarchical_memory_service,
                '_get_related_clusters',
                new_callable=AsyncMock,
                return_value=l2_clusters,
            ):
                result = await hierarchical_memory_service.hierarchical_retrieve(
                    query_embedding=query_embedding,
                    user_id=uuid4(),
                    companion_id=uuid4(),
                    limit=5,
                )

                assert len(result.l2_clusters) > 0
                assert "travel" in result.l2_clusters[0].summary.lower()

    @pytest.mark.asyncio
    async def test_retrieval_result_has_both_levels(self, hierarchical_memory_service):
        """Should return result with both L1 and L2 data."""
        query_embedding = [1.0] + [0.0] * 1535

        with patch.object(
            hierarchical_memory_service,
            '_search_l1_memories',
            new_callable=AsyncMock,
            return_value=[{"id": "1", "content": "Memory"}],
        ):
            with patch.object(
                hierarchical_memory_service,
                '_get_related_clusters',
                new_callable=AsyncMock,
                return_value=[],
            ):
                result = await hierarchical_memory_service.hierarchical_retrieve(
                    query_embedding=query_embedding,
                    user_id=uuid4(),
                    companion_id=uuid4(),
                    limit=5,
                )

                assert hasattr(result, 'l1_memories')
                assert hasattr(result, 'l2_clusters')
                assert hasattr(result, 'total_memories')


class TestFormatForPrompt:
    """Tests for formatting hierarchical results for prompts."""

    def test_format_with_l1_only(self, hierarchical_memory_service):
        """Should format L1 memories when no clusters."""
        result = HierarchicalRetrievalResult(
            l1_memories=[
                {"id": "1", "content": "User lives in Denver"},
                {"id": "2", "content": "User has a cat named Max"},
            ],
            l2_clusters=[],
            total_memories=2,
        )

        formatted = hierarchical_memory_service.format_for_prompt(result)

        assert "User lives in Denver" in formatted
        assert "User has a cat named Max" in formatted

    def test_format_with_l2_context(self, hierarchical_memory_service):
        """Should include L2 cluster summaries in output."""
        result = HierarchicalRetrievalResult(
            l1_memories=[{"id": "1", "content": "User went to Colorado"}],
            l2_clusters=[
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="Travel Memories",
                    summary="User loves outdoor activities and travel.",
                    member_memory_ids=["1", "2", "3"],
                    centroid_embedding=[0.1] * 1536,
                )
            ],
            total_memories=3,
        )

        formatted = hierarchical_memory_service.format_for_prompt(result)

        assert "Colorado" in formatted
        assert "Travel" in formatted or "outdoor activities" in formatted

    def test_format_empty_result(self, hierarchical_memory_service):
        """Should return empty string for no memories."""
        result = HierarchicalRetrievalResult(
            l1_memories=[],
            l2_clusters=[],
            total_memories=0,
        )

        formatted = hierarchical_memory_service.format_for_prompt(result)

        assert formatted == ""


class TestMemoryLevel:
    """Tests for MemoryLevel enum."""

    def test_level_values(self):
        """Should have L1 and L2 levels."""
        assert MemoryLevel.L1.value == "individual"
        assert MemoryLevel.L2.value == "cluster"


class TestClusterMaintenance:
    """Tests for cluster maintenance operations."""

    @pytest.mark.asyncio
    async def test_should_recluster(self, hierarchical_memory_service):
        """Should indicate when reclustering is needed."""
        # Simulate cluster with many new memories
        cluster = MemoryCluster(
            id=uuid4(),
            companion_id=uuid4(),
            user_id=uuid4(),
            name="Growing Cluster",
            summary="Original summary",
            member_memory_ids=[str(uuid4()) for _ in range(10)],
            centroid_embedding=[0.1] * 1536,
            memories_since_summary=50,  # Many new memories added
        )

        should_update = hierarchical_memory_service.should_update_cluster(cluster)
        assert should_update is True

    @pytest.mark.asyncio
    async def test_no_recluster_recent_update(self, hierarchical_memory_service):
        """Should not recluster if recently updated."""
        from datetime import datetime, timedelta

        cluster = MemoryCluster(
            id=uuid4(),
            companion_id=uuid4(),
            user_id=uuid4(),
            name="Recent Cluster",
            summary="Recent summary",
            member_memory_ids=[str(uuid4()) for _ in range(5)],
            centroid_embedding=[0.1] * 1536,
            memories_since_summary=2,  # Few new memories
            last_updated=datetime.utcnow() - timedelta(hours=1),  # Recent update
        )

        should_update = hierarchical_memory_service.should_update_cluster(cluster)
        assert should_update is False


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_cluster_with_single_member(self, hierarchical_memory_service):
        """Should handle cluster formation with exactly min members."""
        memories = [{"id": str(uuid4()), "content": f"Memory {i}"} for i in range(3)]
        embeddings = [np.random.randn(1536).tolist() for _ in range(3)]

        # With high similarity threshold, might form one cluster
        clusters = hierarchical_memory_service.cluster_memories(memories, embeddings)

        # Should not crash
        assert isinstance(clusters, list)

    def test_handles_nan_embeddings(self, hierarchical_memory_service):
        """Should handle NaN values in embeddings gracefully."""
        memories = [{"id": str(uuid4()), "content": "Memory"}]
        embeddings = [[float('nan')] * 1536]

        # Should not raise but may return empty clusters
        clusters = hierarchical_memory_service.cluster_memories(memories, embeddings)
        assert isinstance(clusters, list)

    def test_handles_zero_embeddings(self, hierarchical_memory_service):
        """Should handle zero vector embeddings."""
        memories = [{"id": str(uuid4()), "content": "Memory"}]
        embeddings = [[0.0] * 1536]

        clusters = hierarchical_memory_service.cluster_memories(memories, embeddings)
        assert isinstance(clusters, list)
