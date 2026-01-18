"""
Hybrid Search Enhancement Tests

Tests for the combined memory + knowledge graph search service
that uses RRF to merge results and graph traversal for context enrichment.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.services.hybrid_search import (
    HybridSearchService,
    HybridSearchResult,
    KGContextItem,
    SearchQuery,
    get_hybrid_search_service,
)


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        anthropic_api_key="test-key",
        gateway_internal_url="http://localhost:3000",
        internal_service_key="test-internal-key",
        memory_search_top_k=10,
        memory_relevance_threshold=0.5,
    )


@pytest.fixture
def http_client():
    """Create a mock HTTP client."""
    return AsyncMock()


@pytest.fixture
def service(settings, http_client):
    """Create a HybridSearchService instance."""
    return HybridSearchService(settings, http_client)


@pytest.fixture
def sample_memory_response():
    """Sample memory search API response."""
    return {
        "success": True,
        "data": {
            "items": [
                {
                    "id": str(uuid4()),
                    "content": "User loves hiking in Colorado mountains",
                    "content_type": "fact",
                    "importance": 0.8,
                    "similarity": 0.92,
                    "tags": ["outdoor", "hobby"],
                },
                {
                    "id": str(uuid4()),
                    "content": "User works as a software engineer",
                    "content_type": "fact",
                    "importance": 0.7,
                    "similarity": 0.85,
                    "tags": ["career"],
                },
            ]
        }
    }


@pytest.fixture
def sample_kg_search_response():
    """Sample KG entity search response."""
    return {
        "success": True,
        "data": {
            "items": [
                {
                    "entity": {
                        "id": str(uuid4()),
                        "name": "Colorado",
                        "canonical_name": "colorado",
                        "entity_type": "place",
                        "aliases": ["CO"],
                        "metadata": {"state": True, "country": "USA"},
                    },
                    "matchScore": 0.9,
                    "matchedField": "name",
                },
                {
                    "entity": {
                        "id": str(uuid4()),
                        "name": "Hiking",
                        "canonical_name": "hiking",
                        "entity_type": "activity",
                        "aliases": ["hike"],
                        "metadata": {},
                    },
                    "matchScore": 0.85,
                    "matchedField": "canonical_name",
                },
            ]
        }
    }


@pytest.fixture
def sample_kg_neighbors_response():
    """Sample KG neighbors response."""
    return {
        "success": True,
        "data": {
            "entities": [
                {
                    "id": str(uuid4()),
                    "name": "Rocky Mountain National Park",
                    "canonical_name": "rocky_mountain_national_park",
                    "entity_type": "place",
                    "metadata": {"description": "A beautiful national park"},
                },
                {
                    "id": str(uuid4()),
                    "name": "User",
                    "canonical_name": "user",
                    "entity_type": "person",
                    "metadata": {},
                },
            ],
            "edges": [
                {
                    "source_entity_id": "colorado-id",
                    "target_entity_id": "rocky-id",
                    "relation_type": "has",
                    "confidence": 0.9,
                },
            ],
        }
    }


class TestSearchQuery:
    """Tests for SearchQuery model."""

    def test_create_with_query_text(self):
        """Should create query with text."""
        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="What do you know about my hobbies?",
        )
        assert query.query_text == "What do you know about my hobbies?"
        assert query.limit == 10  # default
        assert query.min_similarity == 0.5  # default

    def test_create_with_custom_options(self):
        """Should accept custom options."""
        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="hiking",
            limit=20,
            min_similarity=0.7,
            include_kg_context=True,
            kg_traversal_depth=2,
        )
        assert query.limit == 20
        assert query.min_similarity == 0.7
        assert query.include_kg_context is True
        assert query.kg_traversal_depth == 2


class TestHybridSearchResult:
    """Tests for HybridSearchResult model."""

    def test_empty_result(self):
        """Should handle empty results."""
        result = HybridSearchResult(
            memories=[],
            kg_context=[],
            total_memories=0,
        )
        assert len(result.memories) == 0
        assert len(result.kg_context) == 0
        assert result.has_kg_context is False

    def test_result_with_kg_context(self):
        """Should indicate when KG context is present."""
        result = HybridSearchResult(
            memories=[],
            kg_context=[
                KGContextItem(
                    entity_id=str(uuid4()),
                    entity_name="Colorado",
                    entity_type="place",
                    relationship_to_query="mentioned in query",
                    connected_entities=["Rocky Mountain"],
                )
            ],
            total_memories=0,
        )
        assert result.has_kg_context is True


class TestMemorySearch:
    """Tests for memory search functionality."""

    @pytest.mark.asyncio
    async def test_search_memories_basic(self, service, http_client, sample_memory_response):
        """Should search memories via gateway API."""
        http_client.post = AsyncMock(
            return_value=MagicMock(
                status_code=200,
                json=lambda: sample_memory_response,
                raise_for_status=lambda: None,
            )
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="hiking mountains",
            include_kg_context=False,  # Skip KG for this test
        )

        result = await service.search(query)

        assert len(result.memories) == 2
        assert result.memories[0].content == "User loves hiking in Colorado mountains"
        http_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_memories_with_filters(self, service, http_client, sample_memory_response):
        """Should pass filters to the API."""
        http_client.post = AsyncMock(
            return_value=MagicMock(
                status_code=200,
                json=lambda: sample_memory_response,
                raise_for_status=lambda: None,
            )
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="career",
            content_types=["fact", "preference"],
            min_importance=0.6,
            include_kg_context=False,  # Disable KG to test memory filters only
        )

        await service.search(query)

        # Check the first call (memory search)
        call_args = http_client.post.call_args_list[0]
        payload = call_args[1]["json"]
        assert payload["minImportance"] == 0.6
        assert "fact" in payload["contentTypes"]

    @pytest.mark.asyncio
    async def test_search_handles_api_error(self, service, http_client):
        """Should handle API errors gracefully."""
        http_client.post = AsyncMock(
            return_value=MagicMock(
                status_code=500,
                text="Internal Server Error",
                raise_for_status=MagicMock(side_effect=Exception("API Error")),
            )
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="hiking",
            include_kg_context=False,
        )

        result = await service.search(query)

        # Should return empty results on error, not crash
        assert len(result.memories) == 0


class TestKGEntitySearch:
    """Tests for knowledge graph entity search."""

    @pytest.mark.asyncio
    async def test_search_kg_entities(
        self, service, http_client, sample_memory_response, sample_kg_search_response
    ):
        """Should search KG entities matching query terms."""
        # Setup mock responses
        http_client.post = AsyncMock(
            side_effect=[
                # First call - memory search
                MagicMock(
                    status_code=200,
                    json=lambda: sample_memory_response,
                    raise_for_status=lambda: None,
                ),
                # Second call - KG search
                MagicMock(
                    status_code=200,
                    json=lambda: sample_kg_search_response,
                    raise_for_status=lambda: None,
                ),
                # Third call - KG neighbors (for Colorado)
                MagicMock(
                    status_code=200,
                    json=lambda: {"success": True, "data": {"entities": [], "edges": []}},
                    raise_for_status=lambda: None,
                ),
                # Fourth call - KG neighbors (for Hiking)
                MagicMock(
                    status_code=200,
                    json=lambda: {"success": True, "data": {"entities": [], "edges": []}},
                    raise_for_status=lambda: None,
                ),
            ]
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="hiking in Colorado",
            include_kg_context=True,
        )

        result = await service.search(query)

        # Should have KG context items
        assert result.has_kg_context is True
        assert len(result.kg_context) >= 1

    @pytest.mark.asyncio
    async def test_kg_search_extracts_terms(self, service, http_client, sample_memory_response):
        """Should extract meaningful terms from query for KG search."""
        call_payloads = []

        def capture_calls(*args, **kwargs):
            call_payloads.append(kwargs.get("json", {}))
            return MagicMock(
                status_code=200,
                json=lambda: {"success": True, "data": {"items": []}},
                raise_for_status=lambda: None,
            )

        http_client.post = AsyncMock(side_effect=capture_calls)

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="Tell me about hiking and rock climbing",
            include_kg_context=True,
        )

        await service.search(query)

        # Should have made KG search call with extracted terms
        kg_calls = [p for p in call_payloads if "query" in p and "userId" in p]
        assert len(kg_calls) >= 1


class TestKGTraversal:
    """Tests for knowledge graph traversal."""

    @pytest.mark.asyncio
    async def test_traverses_entity_neighbors(
        self, service, http_client, sample_memory_response, sample_kg_search_response, sample_kg_neighbors_response
    ):
        """Should traverse 1-hop neighbors for matched entities."""
        # Create proper mock responses
        def make_response(data):
            mock = MagicMock()
            mock.status_code = 200
            mock.json.return_value = data
            mock.raise_for_status.return_value = None
            return mock

        # The service extracts terms ["colorado", "hiking"] and makes separate KG calls for each
        http_client.post = AsyncMock(
            side_effect=[
                # 1. Memory search
                make_response(sample_memory_response),
                # 2. KG entity search for "colorado"
                make_response(sample_kg_search_response),
                # 3. KG entity search for "hiking"
                make_response({"success": True, "data": {"items": []}}),
                # 4. KG neighbors for Colorado entity
                make_response(sample_kg_neighbors_response),
                # 5. KG neighbors for Hiking entity
                make_response({"success": True, "data": {"entities": [], "edges": []}}),
            ]
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="Colorado hiking",
            include_kg_context=True,
            kg_traversal_depth=1,
        )

        result = await service.search(query)

        # Should include connected entities in context
        assert result.has_kg_context is True
        # Should have Colorado with its neighbors
        colorado_context = next(
            (c for c in result.kg_context if "colorado" in c.entity_name.lower()),
            None
        )
        assert colorado_context is not None, f"Expected Colorado in context, got: {[c.entity_name for c in result.kg_context]}"
        assert len(colorado_context.connected_entities) > 0, "Expected connected entities"

    @pytest.mark.asyncio
    async def test_respects_traversal_depth(self, service, http_client, sample_memory_response):
        """Should respect kg_traversal_depth parameter."""
        http_client.post = AsyncMock(
            return_value=MagicMock(
                status_code=200,
                json=lambda: {"success": True, "data": {"items": []}},
                raise_for_status=lambda: None,
            )
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="test",
            include_kg_context=True,
            kg_traversal_depth=0,  # No traversal
        )

        await service.search(query)

        # With depth 0, should not call neighbors endpoint
        # Only memory search and entity search
        call_count = http_client.post.call_count
        assert call_count <= 2


class TestUserEntityBoost:
    """Tests for boosting entities connected to User."""

    @pytest.mark.asyncio
    async def test_boosts_user_connected_entities(self, service, http_client, sample_memory_response):
        """Should boost context items connected to User entity."""
        user_id = uuid4()

        kg_search_with_user = {
            "success": True,
            "data": {
                "items": [
                    {
                        "entity": {
                            "id": str(uuid4()),
                            "name": "Python",
                            "canonical_name": "python",
                            "entity_type": "thing",
                            "metadata": {},
                        },
                        "matchScore": 0.8,
                        "matchedField": "name",
                    },
                ]
            }
        }

        neighbors_with_user_connection = {
            "success": True,
            "data": {
                "entities": [
                    {
                        "id": str(uuid4()),
                        "name": f"User-{user_id}",
                        "canonical_name": f"user-{user_id}",
                        "entity_type": "person",
                        "metadata": {},
                    },
                ],
                "edges": [
                    {
                        "relation_type": "knows",
                        "confidence": 0.9,
                    },
                ],
            }
        }

        # Create proper mock responses
        def make_response(data):
            mock = MagicMock()
            mock.status_code = 200
            mock.json.return_value = data
            mock.raise_for_status.return_value = None
            return mock

        # Query "Python programming" extracts terms ["python", "programming"]
        http_client.post = AsyncMock(
            side_effect=[
                # 1. Memory search
                make_response(sample_memory_response),
                # 2. KG entity search for "python"
                make_response(kg_search_with_user),
                # 3. KG entity search for "programming"
                make_response({"success": True, "data": {"items": []}}),
                # 4. KG neighbors for Python entity
                make_response(neighbors_with_user_connection),
            ]
        )

        query = SearchQuery(
            user_id=user_id,
            companion_id=uuid4(),
            query_text="Python programming",
            include_kg_context=True,
        )

        result = await service.search(query)

        # Should have context with user connection info
        assert result.has_kg_context is True, "Expected KG context"
        python_context = next(
            (c for c in result.kg_context if "python" in c.entity_name.lower()),
            None
        )
        assert python_context is not None, f"Expected Python in context, got: {[c.entity_name for c in result.kg_context]}"
        assert python_context.connected_to_user is True, "Python should be connected to user"


class TestRRFMerging:
    """Tests for Reciprocal Rank Fusion merging."""

    def test_rrf_score_calculation(self, service):
        """Should correctly calculate RRF scores."""
        # RRF formula: score = 1 / (k + rank)
        k = 60  # Standard RRF constant

        # Rank 1 should have highest score
        score_rank_1 = service._calculate_rrf_score(0, k)
        score_rank_2 = service._calculate_rrf_score(1, k)
        score_rank_3 = service._calculate_rrf_score(2, k)

        assert score_rank_1 > score_rank_2 > score_rank_3

    def test_rrf_merge_deduplicates(self, service):
        """Should deduplicate when merging results."""
        memory_id = str(uuid4())

        # Same memory in both lists
        list1 = [{"id": memory_id, "content": "Test", "rrf_score": 0.016}]
        list2 = [{"id": memory_id, "content": "Test", "rrf_score": 0.015}]

        merged = service._merge_with_rrf(list1, list2)

        # Should have only one entry with combined score
        assert len(merged) == 1
        assert merged[0]["rrf_score"] > 0.016  # Combined score

    def test_rrf_merge_preserves_order(self, service):
        """Should preserve order by score after merge."""
        id1, id2, id3 = str(uuid4()), str(uuid4()), str(uuid4())

        list1 = [
            {"id": id1, "content": "High score", "rrf_score": 0.02},
            {"id": id2, "content": "Medium score", "rrf_score": 0.015},
        ]
        list2 = [
            {"id": id3, "content": "Low score", "rrf_score": 0.01},
        ]

        merged = service._merge_with_rrf(list1, list2)

        # Should be sorted by score descending
        scores = [m["rrf_score"] for m in merged]
        assert scores == sorted(scores, reverse=True)


class TestContextFormatting:
    """Tests for formatting context for prompt injection."""

    def test_format_kg_context_for_prompt(self, service):
        """Should format KG context for system prompt."""
        kg_context = [
            KGContextItem(
                entity_id=str(uuid4()),
                entity_name="Colorado",
                entity_type="place",
                relationship_to_query="mentioned in query",
                connected_entities=["Rocky Mountain National Park", "Denver"],
                connected_to_user=True,
            ),
        ]

        formatted = service.format_kg_context_for_prompt(kg_context)

        assert "Colorado" in formatted
        assert "place" in formatted.lower()
        assert "Rocky Mountain National Park" in formatted
        assert "connected_to_user" in formatted.lower() or "related to user" in formatted.lower()

    def test_format_empty_context(self, service):
        """Should handle empty context gracefully."""
        formatted = service.format_kg_context_for_prompt([])

        # Should return empty or minimal string
        assert formatted == "" or formatted is None


class TestServiceConfiguration:
    """Tests for service configuration options."""

    def test_uses_settings_defaults(self, settings, http_client):
        """Should use settings for default values."""
        service = HybridSearchService(settings, http_client)

        assert service.default_limit == settings.memory_search_top_k
        assert service.default_min_similarity == settings.memory_relevance_threshold

    def test_kg_context_disabled_by_default(self, service):
        """KG context should be configurable."""
        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="test",
        )
        # Default should be True for include_kg_context based on plan
        assert query.include_kg_context is True


class TestSingletonInstance:
    """Tests for singleton pattern."""

    def test_get_hybrid_search_service_returns_instance(self, settings):
        """Should return a service instance."""
        # Reset singleton for test
        import orchestrator.services.hybrid_search as module
        module._hybrid_search_service = None

        instance = get_hybrid_search_service(settings)
        assert isinstance(instance, HybridSearchService)

    def test_get_hybrid_search_service_returns_same_instance(self, settings):
        """Should return same instance on repeated calls."""
        import orchestrator.services.hybrid_search as module
        module._hybrid_search_service = None

        instance1 = get_hybrid_search_service(settings)
        instance2 = get_hybrid_search_service(settings)
        assert instance1 is instance2


class TestIntegrationScenarios:
    """Integration test scenarios."""

    @pytest.mark.asyncio
    async def test_full_hybrid_search_flow(
        self, service, http_client, sample_memory_response, sample_kg_search_response
    ):
        """Test complete flow: memory search + KG search + traversal."""
        user_id = uuid4()

        http_client.post = AsyncMock(
            side_effect=[
                # Memory search response
                MagicMock(
                    status_code=200,
                    json=lambda: sample_memory_response,
                    raise_for_status=lambda: None,
                ),
                # KG entity search
                MagicMock(
                    status_code=200,
                    json=lambda: sample_kg_search_response,
                    raise_for_status=lambda: None,
                ),
                # First entity neighbors
                MagicMock(
                    status_code=200,
                    json=lambda: {"success": True, "data": {"entities": [], "edges": []}},
                    raise_for_status=lambda: None,
                ),
                # Second entity neighbors
                MagicMock(
                    status_code=200,
                    json=lambda: {"success": True, "data": {"entities": [], "edges": []}},
                    raise_for_status=lambda: None,
                ),
            ]
        )

        query = SearchQuery(
            user_id=user_id,
            companion_id=uuid4(),
            query_text="hiking in Colorado mountains",
            include_kg_context=True,
            limit=10,
        )

        result = await service.search(query)

        # Verify complete result structure
        assert result.memories is not None
        assert result.kg_context is not None
        assert result.total_memories == len(result.memories)

    @pytest.mark.asyncio
    async def test_search_without_kg_context(self, service, http_client, sample_memory_response):
        """Test search with KG context disabled."""
        http_client.post = AsyncMock(
            return_value=MagicMock(
                status_code=200,
                json=lambda: sample_memory_response,
                raise_for_status=lambda: None,
            )
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="hiking",
            include_kg_context=False,
        )

        result = await service.search(query)

        # Should have memories but no KG context
        assert len(result.memories) > 0
        assert len(result.kg_context) == 0

        # Should only make one API call (memory search)
        assert http_client.post.call_count == 1

    @pytest.mark.asyncio
    async def test_handles_network_timeout(self, service, http_client):
        """Should handle network timeouts gracefully."""
        import httpx

        http_client.post = AsyncMock(
            side_effect=httpx.TimeoutException("Connection timeout")
        )

        query = SearchQuery(
            user_id=uuid4(),
            companion_id=uuid4(),
            query_text="test query",
        )

        result = await service.search(query)

        # Should return empty results, not crash
        assert result.memories == []
        assert result.kg_context == []


class TestTermExtraction:
    """Tests for extracting search terms from query."""

    def test_extracts_nouns_and_verbs(self, service):
        """Should extract meaningful terms from query."""
        query = "Tell me about hiking in the beautiful Colorado mountains"

        terms = service._extract_search_terms(query)

        # Should include key terms
        assert "hiking" in [t.lower() for t in terms]
        assert "colorado" in [t.lower() for t in terms]
        assert "mountains" in [t.lower() for t in terms]

        # Should exclude stop words
        assert "the" not in [t.lower() for t in terms]
        assert "in" not in [t.lower() for t in terms]

    def test_handles_short_query(self, service):
        """Should handle short queries."""
        query = "hiking"

        terms = service._extract_search_terms(query)

        assert "hiking" in [t.lower() for t in terms]

    def test_handles_empty_query(self, service):
        """Should handle empty query."""
        terms = service._extract_search_terms("")

        assert terms == []
