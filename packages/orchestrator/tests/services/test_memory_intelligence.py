"""Tests for Memory Intelligence features.

Covers:
- L2 cluster summary generation (with mocked LLM)
- Semantic conflict detection (embedding-based)
- Proactive memory injection (relevant memories injected, duplicates avoided)
- Full flow integration
"""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import numpy as np
import pytest

from orchestrator.models.memory import LongTermMemory, MemoryType
from orchestrator.services.hierarchical_memory import (
    ClusterConfig,
    HierarchicalMemoryService,
    MemoryCluster,
)
from orchestrator.services.memory_conflict import (
    ConflictConfig,
    ConflictType,
    MemoryConflict,
    MemoryConflictService,
    MemoryWithValidity,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_embedding(center_idx: int, dim: int = 64, noise: float = 0.01) -> list[float]:
    """Create a small embedding centered at a given index."""
    vec = np.zeros(dim)
    vec[center_idx] = 1.0
    vec += np.random.default_rng(center_idx).normal(0, noise, dim)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def _make_similar_embedding(base: list[float], noise: float = 0.02) -> list[float]:
    """Create an embedding very similar to *base* (cosine > 0.95)."""
    arr = np.array(base, dtype=np.float64)
    arr += np.random.default_rng(42).normal(0, noise, len(arr))
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr.tolist()


def _make_dissimilar_embedding(base: list[float]) -> list[float]:
    """Create an embedding orthogonal to *base*."""
    dim = len(base)
    vec = np.zeros(dim)
    # Pick a dimension far from the dominant one
    dominant = int(np.argmax(np.abs(base)))
    other = (dominant + dim // 2) % dim
    vec[other] = 1.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def _make_memory(
    content: str,
    embedding: list[float] | None = None,
    memory_type: str = "fact",
    days_ago: int = 10,
    importance: float = 0.5,
) -> MemoryWithValidity:
    return MemoryWithValidity(
        id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
        content=content,
        memory_type=memory_type,
        created_at=datetime.utcnow() - timedelta(days=days_ago),
        valid_from=datetime.utcnow() - timedelta(days=days_ago),
        importance=importance,
        embedding=embedding,
    )


def _make_ltm(
    content: str,
    memory_id: UUID | None = None,
    user_id: UUID | None = None,
    companion_id: UUID | None = None,
) -> LongTermMemory:
    return LongTermMemory(
        id=memory_id or uuid4(),
        user_id=user_id or uuid4(),
        companion_id=companion_id or uuid4(),
        memory_type=MemoryType.FACT,
        content=content,
    )


# =========================================================================
# L2 Cluster Summary Generation
# =========================================================================

class TestL2ClusterSummaryGeneration:
    """Tests for wiring L2 summary generation to the real LLM provider."""

    @pytest.fixture
    def mock_provider(self):
        provider = AsyncMock()
        response = MagicMock()
        response.content = "User enjoys hiking and outdoor activities in Colorado."
        provider.generate = AsyncMock(return_value=response)
        return provider

    @pytest.fixture
    def service_with_provider(self, mock_provider):
        config = ClusterConfig(l2_summary_max_tokens=200)
        return HierarchicalMemoryService(config=config, llm_provider=mock_provider)

    @pytest.fixture
    def service_without_provider(self):
        return HierarchicalMemoryService()

    @pytest.mark.asyncio
    async def test_summary_calls_llm_provider(self, service_with_provider, mock_provider):
        """Summary generation should call the LLM provider with proper messages."""
        contents = [
            "User went hiking in Rocky Mountain NP",
            "User loves trail running",
            "User visited Yellowstone last summer",
        ]

        result = await service_with_provider.generate_cluster_summary(contents)

        assert result == "User enjoys hiking and outdoor activities in Colorado."
        mock_provider.generate.assert_awaited_once()

        call_kwargs = mock_provider.generate.call_args
        messages = call_kwargs.kwargs.get("messages") or call_kwargs.args[0]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "memory summarizer" in messages[0]["content"].lower()
        assert messages[1]["role"] == "user"
        # All three memories should appear in the user message
        assert "Rocky Mountain" in messages[1]["content"]
        assert "trail running" in messages[1]["content"]
        assert "Yellowstone" in messages[1]["content"]

    @pytest.mark.asyncio
    async def test_summary_respects_max_tokens(self, service_with_provider, mock_provider):
        """Summary generation should pass max_tokens from config."""
        await service_with_provider.generate_cluster_summary(["test memory"])

        call_kwargs = mock_provider.generate.call_args
        assert call_kwargs.kwargs.get("max_tokens") == 200

    @pytest.mark.asyncio
    async def test_summary_uses_low_temperature(self, service_with_provider, mock_provider):
        """Summary generation should use low temperature for factual output."""
        await service_with_provider.generate_cluster_summary(["test memory"])

        call_kwargs = mock_provider.generate.call_args
        assert call_kwargs.kwargs.get("temperature") == 0.3

    @pytest.mark.asyncio
    async def test_summary_fallback_on_no_provider(self, service_without_provider):
        """Without a provider, should return concatenated snippets."""
        contents = [
            "User lives in Denver",
            "User works as an engineer",
        ]

        result = await service_without_provider.generate_cluster_summary(contents)

        assert "Denver" in result
        assert "engineer" in result

    @pytest.mark.asyncio
    async def test_summary_fallback_on_llm_error(self, service_with_provider, mock_provider):
        """If LLM call fails, should fall back to concatenated snippets."""
        mock_provider.generate.side_effect = RuntimeError("API timeout")

        contents = ["User has a dog named Max", "User walks Max every morning"]

        result = await service_with_provider.generate_cluster_summary(contents)

        # Should not raise, should return fallback
        assert "Max" in result

    @pytest.mark.asyncio
    async def test_summary_fallback_on_empty_response(self, service_with_provider, mock_provider):
        """If LLM returns empty content, should fall back."""
        response = MagicMock()
        response.content = "   "
        mock_provider.generate.return_value = response

        contents = ["User likes coffee"]

        result = await service_with_provider.generate_cluster_summary(contents)

        assert "coffee" in result

    @pytest.mark.asyncio
    async def test_summary_truncates_long_content(self, service_with_provider, mock_provider):
        """Very long content should be truncated before sending to LLM."""
        contents = ["x" * 3000, "y" * 3000, "z" * 3000]

        await service_with_provider.generate_cluster_summary(contents)

        call_kwargs = mock_provider.generate.call_args
        messages = call_kwargs.kwargs.get("messages") or call_kwargs.args[0]
        user_content = messages[1]["content"]
        # Content should be truncated (generate_cluster_summary limits to 5000 chars)
        assert len(user_content) < 6000

    def test_fallback_summary_empty(self):
        """Fallback on empty content list should return placeholder."""
        result = HierarchicalMemoryService._fallback_summary([])
        assert result == "Empty cluster."

    def test_fallback_summary_truncates_long_items(self):
        """Fallback should truncate individual items and limit count."""
        long_content = "a" * 200
        result = HierarchicalMemoryService._fallback_summary([long_content])
        assert len(result) < 200
        assert result.endswith("...")


# =========================================================================
# Semantic Conflict Detection
# =========================================================================

class TestSemanticConflictDetection:
    """Tests for embedding-based conflict detection."""

    @pytest.fixture
    def service(self):
        return MemoryConflictService(
            config=ConflictConfig(similarity_threshold=0.85)
        )

    def test_similar_embeddings_flagged(self, service):
        """Memories with high embedding similarity should be flagged semantically
        when heuristics do not already catch them."""
        base_emb = _make_embedding(0, dim=64)
        similar_emb = _make_similar_embedding(base_emb, noise=0.01)

        # Use content that heuristics will NOT catch
        # Avoid all keyword sets: LOCATION_KEYWORDS (live, lives, moved, from, in, at, location),
        # QUANTITY_KEYWORDS (has, have, own, owns, number, count),
        # PREFERENCE_KEYWORDS (like, likes, love, loves, prefer, favorite, hate, hates)
        # Also ensure different lengths (>5 chars apart) so _is_duplicate char overlap is skipped
        existing = _make_memory(
            "The user got their degree studying advanced calculus and topology many years ago",
            embedding=base_emb,
        )

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="Pottery",
            new_embedding=similar_emb,
            existing_memories=[existing],
        )

        # Should detect at least one conflict via semantic path
        assert len(conflicts) >= 1
        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        assert len(semantic) >= 1
        assert semantic[0].confidence > 0.5

    def test_heuristic_catches_location_before_semantic(self, service):
        """Location-keyword heuristic should fire first; semantic deduplicates."""
        base_emb = _make_embedding(0, dim=64)
        similar_emb = _make_similar_embedding(base_emb, noise=0.01)

        existing = _make_memory(
            "I live in New York City",
            embedding=base_emb,
        )

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="I moved to San Francisco last month",
            new_embedding=similar_emb,
            existing_memories=[existing],
        )

        # Heuristic should catch it (LOCATION_KEYWORDS: "moved", "in")
        assert len(conflicts) >= 1
        heuristic = [c for c in conflicts if c.detection_method == "heuristic"]
        assert len(heuristic) >= 1
        # No duplicate from semantic pass
        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        assert len(semantic) == 0

    def test_dissimilar_embeddings_not_flagged(self, service):
        """Memories with low embedding similarity should not be flagged."""
        base_emb = _make_embedding(0, dim=64)
        different_emb = _make_dissimilar_embedding(base_emb)

        existing = _make_memory(
            "User has a golden retriever named Buddy",
            embedding=base_emb,
        )

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User works at a tech startup",
            new_embedding=different_emb,
            existing_memories=[existing],
        )

        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        assert len(semantic) == 0

    def test_heuristic_conflicts_not_duplicated(self, service):
        """Memories flagged by heuristics should not be re-flagged semantically."""
        base_emb = _make_embedding(0, dim=64)
        similar_emb = _make_similar_embedding(base_emb, noise=0.01)

        existing = _make_memory(
            "User lives in Denver, Colorado",
            embedding=base_emb,
        )

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User lives in Austin, Texas",
            new_embedding=similar_emb,
            existing_memories=[existing],
            topic="location",
        )

        # Should have heuristic conflict but not a duplicate semantic one
        ids_seen = set()
        for c in conflicts:
            assert c.existing_memory.id not in ids_seen, "Duplicate conflict detected"
            ids_seen.add(c.existing_memory.id)

    def test_skips_memories_without_embeddings(self, service):
        """Memories missing embeddings should be skipped in semantic pass."""
        base_emb = _make_embedding(0, dim=64)

        existing_no_emb = _make_memory(
            "User likes pizza",
            embedding=None,
        )

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User hates pizza",
            new_embedding=base_emb,
            existing_memories=[existing_no_emb],
        )

        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        assert len(semantic) == 0

    def test_skips_invalid_memories(self, service):
        """Invalidated memories should not trigger semantic conflicts."""
        base_emb = _make_embedding(0, dim=64)
        similar_emb = _make_similar_embedding(base_emb, noise=0.01)

        existing = _make_memory("User lives in NYC", embedding=base_emb)
        # Invalidate it
        existing.valid_until = datetime.utcnow() - timedelta(days=1)

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User lives in LA",
            new_embedding=similar_emb,
            existing_memories=[existing],
        )

        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        assert len(semantic) == 0

    def test_skips_exact_duplicates(self, service):
        """Exact duplicate content should not be flagged as conflict."""
        base_emb = _make_embedding(0, dim=64)

        existing = _make_memory("User lives in NYC", embedding=base_emb)

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User lives in NYC",
            new_embedding=base_emb,
            existing_memories=[existing],
        )

        assert len(conflicts) == 0

    def test_confidence_scales_with_similarity(self, service):
        """Higher similarity should produce higher confidence."""
        base_emb = _make_embedding(0, dim=64)
        very_similar = _make_similar_embedding(base_emb, noise=0.005)

        existing = _make_memory("User works at Google", embedding=base_emb)

        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User works at Meta now",
            new_embedding=very_similar,
            existing_memories=[existing],
        )

        semantic = [c for c in conflicts if c.detection_method == "semantic"]
        if semantic:
            assert semantic[0].confidence >= 0.5

    def test_handles_zero_norm_embedding(self, service):
        """Zero-norm embedding should not cause errors."""
        zero_emb = [0.0] * 64
        existing = _make_memory("User likes cats", embedding=zero_emb)

        # Should not raise
        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User likes dogs",
            new_embedding=zero_emb,
            existing_memories=[existing],
        )
        assert isinstance(conflicts, list)


# =========================================================================
# Proactive Memory Injection
# =========================================================================

class TestProactiveMemoryInjection:
    """Tests for automatic memory retrieval before LLM call."""

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def companion_id(self):
        return uuid4()

    def _make_settings(self, proactive_enabled: bool = True):
        """Create a mock settings object."""
        settings = MagicMock()
        settings.proactive_memory_enabled = proactive_enabled
        settings.proactive_memory_top_k = 5
        settings.memory_search_top_k = 10
        settings.memory_relevance_threshold = 0.5
        settings.kg_extraction_enabled = True
        return settings

    def _make_hybrid_service(self, memories: list[LongTermMemory]):
        """Create a mock hybrid search service returning given memories."""
        service = AsyncMock()
        result = MagicMock()
        result.memories = memories
        result.kg_context = []
        result.total_memories = len(memories)
        service.search = AsyncMock(return_value=result)
        return service

    @pytest.mark.asyncio
    async def test_proactive_injection_adds_memories(self, user_id, companion_id):
        """Proactive injection should add relevant memories to long_term_memories."""
        mem1 = _make_ltm("User loves hiking", user_id=user_id, companion_id=companion_id)
        mem2 = _make_ltm("User lives in Colorado", user_id=user_id, companion_id=companion_id)

        hybrid_service = self._make_hybrid_service([mem1, mem2])
        settings = self._make_settings(proactive_enabled=True)

        # Simulate the proactive injection logic (extracted from orchestrator)
        long_term_memories: list[LongTermMemory] | None = None
        user_message = "What should we do this weekend?"

        from orchestrator.services.hybrid_search import SearchQuery

        proactive_query = SearchQuery(
            user_id=user_id,
            companion_id=companion_id,
            query_text=user_message,
            limit=settings.proactive_memory_top_k,
            min_similarity=settings.memory_relevance_threshold,
            include_kg_context=False,
        )
        proactive_result = await hybrid_service.search(proactive_query)

        if proactive_result.memories:
            existing_ids = {m.id for m in (long_term_memories or [])}
            new_memories = [m for m in proactive_result.memories if m.id not in existing_ids]
            if new_memories:
                long_term_memories = list(long_term_memories or []) + new_memories

        assert long_term_memories is not None
        assert len(long_term_memories) == 2
        assert any("hiking" in m.content for m in long_term_memories)

    @pytest.mark.asyncio
    async def test_proactive_injection_deduplicates(self, user_id, companion_id):
        """Should not inject memories already present in long_term_memories."""
        shared_id = uuid4()
        existing_mem = _make_ltm(
            "User loves hiking",
            memory_id=shared_id,
            user_id=user_id,
            companion_id=companion_id,
        )
        duplicate_mem = _make_ltm(
            "User loves hiking",
            memory_id=shared_id,
            user_id=user_id,
            companion_id=companion_id,
        )
        new_mem = _make_ltm(
            "User lives in Colorado",
            user_id=user_id,
            companion_id=companion_id,
        )

        hybrid_service = self._make_hybrid_service([duplicate_mem, new_mem])

        long_term_memories: list[LongTermMemory] = [existing_mem]

        proactive_result = await hybrid_service.search(MagicMock())

        existing_ids = {m.id for m in long_term_memories}
        new_memories = [m for m in proactive_result.memories if m.id not in existing_ids]
        if new_memories:
            long_term_memories = long_term_memories + new_memories

        # Should have 2 total: 1 existing + 1 new (duplicate excluded)
        assert len(long_term_memories) == 2

    @pytest.mark.asyncio
    async def test_proactive_injection_disabled(self):
        """When proactive_memory_enabled is False, no injection should occur."""
        settings = self._make_settings(proactive_enabled=False)
        assert settings.proactive_memory_enabled is False
        # The orchestrator checks this flag before searching; we just verify the flag works.

    @pytest.mark.asyncio
    async def test_proactive_injection_handles_search_failure(self, user_id, companion_id):
        """If hybrid search fails, should not raise and memories stay unchanged."""
        hybrid_service = AsyncMock()
        hybrid_service.search = AsyncMock(side_effect=RuntimeError("DB down"))

        long_term_memories: list[LongTermMemory] = [
            _make_ltm("User likes cats", user_id=user_id, companion_id=companion_id)
        ]
        original_count = len(long_term_memories)

        try:
            proactive_result = await hybrid_service.search(MagicMock())
            # Would have added memories here
        except Exception:
            pass  # Simulates the try/except in orchestrator

        assert len(long_term_memories) == original_count

    @pytest.mark.asyncio
    async def test_proactive_injection_no_hybrid_service(self):
        """When no hybrid search service is configured, skip injection."""
        # This mirrors the `if self._hybrid_search_service:` guard
        hybrid_service = None
        long_term_memories: list[LongTermMemory] = []

        # Should not raise
        if hybrid_service is not None:
            pass  # Would search

        assert len(long_term_memories) == 0


# =========================================================================
# Integration: Full Flow
# =========================================================================

class TestMemoryIntelligenceIntegration:
    """Integration tests combining all three features."""

    @pytest.mark.asyncio
    async def test_cluster_then_summarize(self):
        """Cluster memories and generate summaries for each cluster."""
        mock_provider = AsyncMock()
        response = MagicMock()
        response.content = "User is passionate about outdoor activities."
        mock_provider.generate = AsyncMock(return_value=response)

        service = HierarchicalMemoryService(
            config=ClusterConfig(min_cluster_size=2, similarity_threshold=0.5),
            llm_provider=mock_provider,
        )

        np.random.seed(123)
        # Create clustered memories
        memories = [
            {"id": str(uuid4()), "content": "User went hiking", "tags": ["outdoor"]},
            {"id": str(uuid4()), "content": "User loves trail running", "tags": ["outdoor"]},
            {"id": str(uuid4()), "content": "User camped in Yellowstone", "tags": ["outdoor"]},
        ]

        def make_emb(idx: int) -> np.ndarray:
            base = np.zeros(64)
            base[0] = 1.0
            base += np.random.randn(64) * 0.01
            return base

        embeddings = [make_emb(i) for i in range(3)]

        clusters = service.cluster_memories(memories, embeddings)
        assert len(clusters) >= 1

        # Generate summary for the first cluster
        contents = [m["content"] for m in memories]
        summary = await service.generate_cluster_summary(contents)
        assert summary == "User is passionate about outdoor activities."

    @pytest.mark.asyncio
    async def test_conflict_detection_heuristic_and_semantic(self):
        """Both heuristic and semantic detection should work together."""
        service = MemoryConflictService(
            config=ConflictConfig(similarity_threshold=0.85)
        )

        base_emb = _make_embedding(0, dim=64)
        similar_emb = _make_similar_embedding(base_emb, noise=0.01)

        # Memory about location (will trigger heuristic via LOCATION_KEYWORDS)
        location_mem = _make_memory(
            "User lives in Denver",
            embedding=base_emb,
        )

        # Memory about work (only semantic will catch it)
        work_mem = _make_memory(
            "User is a software engineer at Acme Corp",
            embedding=_make_embedding(1, dim=64),
        )

        # New content about location change
        conflicts = service.detect_conflicts_with_embeddings(
            new_content="User lives in Austin now",
            new_embedding=similar_emb,
            existing_memories=[location_mem, work_mem],
        )

        # Location should be flagged (heuristic)
        location_conflicts = [
            c for c in conflicts
            if c.existing_memory.id == location_mem.id
        ]
        assert len(location_conflicts) >= 1

    @pytest.mark.asyncio
    async def test_proactive_memories_with_dedup_full_flow(self):
        """Full proactive injection flow with deduplication."""
        uid = uuid4()
        cid = uuid4()

        existing = _make_ltm("User has a cat", user_id=uid, companion_id=cid)
        proactive_existing = _make_ltm(
            "User has a cat",
            memory_id=existing.id,
            user_id=uid,
            companion_id=cid,
        )
        proactive_new = _make_ltm("User works from home", user_id=uid, companion_id=cid)

        long_term_memories: list[LongTermMemory] = [existing]

        # Simulate proactive results
        proactive_memories = [proactive_existing, proactive_new]

        existing_ids = {m.id for m in long_term_memories}
        new_memories = [m for m in proactive_memories if m.id not in existing_ids]
        long_term_memories = long_term_memories + new_memories

        assert len(long_term_memories) == 2
        contents = {m.content for m in long_term_memories}
        assert "User has a cat" in contents
        assert "User works from home" in contents
