"""
Knowledge Graph Extraction Service Tests

Tests for the automated extraction of entities and relationships
from conversation turns.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.services.kg_extraction import (
    KGExtractionService,
    KGExtractionResult,
    get_kg_extraction_service,
    KG_EXTRACTION_PROMPT,
    KG_QUICK_EXTRACTION_PROMPT,
)


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        anthropic_api_key="test-key",
        kg_extraction_enabled=True,
        kg_extraction_model="claude-3-haiku-20240307",
        gateway_url="http://localhost:3000",
        internal_service_key="test-internal-key",
    )


@pytest.fixture
def http_client():
    """Create a mock HTTP client."""
    return AsyncMock()


@pytest.fixture
def service(settings, http_client):
    """Create a KGExtractionService instance."""
    return KGExtractionService(settings, http_client)


@pytest.fixture
def sample_extraction_response():
    """Sample successful LLM extraction response."""
    return json.dumps({
        "entities": [
            {"name": "hiking", "type": "activity", "properties": {}},
            {"name": "mountains", "type": "place", "properties": {}},
        ],
        "relations": [
            {
                "source": "User",
                "target": "hiking",
                "type": "likes",
                "confidence": 0.9,
            },
            {
                "source": "hiking",
                "target": "mountains",
                "type": "located_at",
                "confidence": 0.8,
            },
        ],
        "reasoning": "User expressed preference for hiking in mountains",
    })


class TestKGExtractionResult:
    """Tests for KGExtractionResult."""

    def test_has_extractions_with_entities(self):
        """Should return True when entities present."""
        result = KGExtractionResult(
            entities=[{"name": "test"}],
            relations=[],
        )
        assert result.has_extractions is True

    def test_has_extractions_with_relations(self):
        """Should return True when relations present."""
        result = KGExtractionResult(
            entities=[],
            relations=[{"source": "a", "target": "b", "type": "knows"}],
        )
        assert result.has_extractions is True

    def test_has_extractions_empty(self):
        """Should return False when no extractions."""
        result = KGExtractionResult(entities=[], relations=[])
        assert result.has_extractions is False

    def test_to_dict(self):
        """Should serialize to dictionary."""
        result = KGExtractionResult(
            entities=[{"name": "test"}],
            relations=[],
            reasoning="test reasoning",
            success=True,
        )
        data = result.to_dict()
        assert data["entities"] == [{"name": "test"}]
        assert data["relations"] == []
        assert data["reasoning"] == "test reasoning"
        assert data["success"] is True


class TestShouldExtract:
    """Tests for should_extract heuristic."""

    def test_skip_short_messages(self, service):
        """Should skip messages shorter than 20 chars."""
        assert service.should_extract("hi", 1) is False
        assert service.should_extract("hello", 1) is False

    def test_skip_conversational_messages(self, service):
        """Should skip purely conversational messages."""
        assert service.should_extract("thanks", 1) is False
        assert service.should_extract("thank you", 1) is False
        assert service.should_extract("ok", 1) is False
        assert service.should_extract("yes", 1) is False
        assert service.should_extract("haha", 1) is False

    def test_extract_preference_messages(self, service):
        """Should extract messages with preference keywords."""
        assert service.should_extract("I love hiking in the mountains", 1) is True
        assert service.should_extract("My favorite food is sushi", 1) is True
        assert service.should_extract("I prefer coffee over tea", 1) is True

    def test_extract_fact_messages(self, service):
        """Should extract messages with factual keywords."""
        assert service.should_extract("I work as a software engineer", 1) is True
        assert service.should_extract("I live in San Francisco", 1) is True
        assert service.should_extract("My name is John and I am a teacher", 1) is True

    def test_extract_relationship_messages(self, service):
        """Should extract messages about relationships."""
        assert service.should_extract("My friend Sarah loves cooking", 1) is True
        assert service.should_extract("My partner and I went to Paris", 1) is True

    def test_rate_limiting(self, service):
        """Should respect extraction interval."""
        # Message with a keyword that triggers extraction ("i love")
        msg = "I love hiking in the beautiful mountains"

        # First extraction at turn 1
        assert service.should_extract(msg, 1, last_extraction_turn=None) is True

        # Should skip if within interval
        assert service.should_extract(msg, 2, last_extraction_turn=1, extraction_interval=3) is False
        assert service.should_extract(msg, 3, last_extraction_turn=1, extraction_interval=3) is False

        # Should allow after interval
        assert service.should_extract(msg, 4, last_extraction_turn=1, extraction_interval=3) is True


class TestExtractFromTurn:
    """Tests for extract_from_turn method."""

    @pytest.mark.asyncio
    async def test_skip_short_messages(self, service):
        """Should skip messages that are too short."""
        result = await service.extract_from_turn("hi")
        assert result.success is True
        assert result.has_extractions is False
        assert "too short" in result.reasoning

    @pytest.mark.asyncio
    async def test_successful_extraction(self, service, sample_extraction_response):
        """Should extract entities and relations from message."""
        with patch.object(service, "_call_extraction_llm", return_value=sample_extraction_response):
            result = await service.extract_from_turn(
                "I love hiking in the mountains on weekends",
                user_id=uuid4(),
            )

        assert result.success is True
        assert len(result.entities) == 2
        assert len(result.relations) == 2
        assert any(e["name"] == "hiking" for e in result.entities)
        assert any(r["type"] == "likes" for r in result.relations)

    @pytest.mark.asyncio
    async def test_normalizes_user_references(self, service):
        """Should normalize 'I' and 'me' to 'User-{id}'."""
        response = json.dumps({
            "entities": [
                {"name": "I", "type": "person"},
                {"name": "cooking", "type": "activity"},
            ],
            "relations": [
                {"source": "me", "target": "cooking", "type": "likes", "confidence": 0.9}
            ],
        })

        user_id = uuid4()
        with patch.object(service, "_call_extraction_llm", return_value=response):
            result = await service.extract_from_turn(
                "I really enjoy cooking at home",
                user_id=user_id,
            )

        # Check entity normalization
        user_entity = next(e for e in result.entities if e["type"] == "person")
        assert user_entity["name"] == f"User-{str(user_id)[:8]}"

        # Check relation normalization
        relation = result.relations[0]
        assert relation["source"] == f"User-{str(user_id)[:8]}"

    @pytest.mark.asyncio
    async def test_handles_llm_error(self, service):
        """Should handle LLM errors gracefully."""
        with patch.object(
            service, "_call_extraction_llm", side_effect=Exception("LLM error")
        ):
            result = await service.extract_from_turn(
                "I love hiking in the mountains",
                user_id=uuid4(),
            )

        assert result.success is False
        assert "LLM error" in result.error

    @pytest.mark.asyncio
    async def test_handles_invalid_json_response(self, service):
        """Should handle invalid JSON from LLM."""
        with patch.object(service, "_call_extraction_llm", return_value="not valid json"):
            result = await service.extract_from_turn(
                "I love hiking in the mountains",
                user_id=uuid4(),
            )

        assert result.success is False
        assert "parse" in result.error.lower()

    @pytest.mark.asyncio
    async def test_quick_mode_uses_simplified_prompt(self, service, sample_extraction_response):
        """Quick mode should use simpler prompt."""
        call_args = []

        async def capture_prompt(prompt):
            call_args.append(prompt)
            return sample_extraction_response

        with patch.object(service, "_call_extraction_llm", side_effect=capture_prompt):
            await service.extract_from_turn(
                "I love hiking in the mountains",
                quick_mode=True,
            )

        # Quick mode prompt should be shorter
        assert len(call_args[0]) < 500  # Quick prompt is short


class TestExtractFromConversation:
    """Tests for extract_from_conversation method."""

    @pytest.mark.asyncio
    async def test_batch_extraction(self, service, sample_extraction_response):
        """Should extract from multiple turns."""
        turns = [
            {"user_message": "I love hiking in the mountains"},
            {"user_message": "My favorite food is sushi"},
            {"user_message": "I work as a software engineer"},
        ]

        with patch.object(service, "_call_extraction_llm", return_value=sample_extraction_response):
            result = await service.extract_from_conversation(
                turns,
                user_id=uuid4(),
                companion_id=uuid4(),
            )

        assert result.success is True
        # Each turn returns 2 entities, so we should have deduped results
        assert len(result.entities) > 0

    @pytest.mark.asyncio
    async def test_deduplicates_entities(self, service):
        """Should deduplicate entities across turns."""
        response = json.dumps({
            "entities": [{"name": "hiking", "type": "activity"}],
            "relations": [],
        })

        turns = [
            {"user_message": "I love hiking"},
            {"user_message": "Hiking is great"},
        ]

        with patch.object(service, "_call_extraction_llm", return_value=response):
            result = await service.extract_from_conversation(turns)

        # Should only have one hiking entity (deduped)
        hiking_entities = [e for e in result.entities if e["name"].lower() == "hiking"]
        assert len(hiking_entities) == 1

    @pytest.mark.asyncio
    async def test_respects_max_turns(self, service, sample_extraction_response):
        """Should respect max_turns limit."""
        # Create turns with messages long enough to not be skipped (>= 10 chars)
        turns = [{"user_message": f"I love hiking on turn number {i}"} for i in range(10)]
        call_count = 0

        async def count_calls(prompt):
            nonlocal call_count
            call_count += 1
            return sample_extraction_response

        with patch.object(service, "_call_extraction_llm", side_effect=count_calls):
            await service.extract_from_conversation(turns, max_turns=3)

        assert call_count == 3


class TestSubmitExtraction:
    """Tests for submit_extraction method."""

    @pytest.mark.asyncio
    async def test_submit_to_gateway(self, service, http_client):
        """Should submit extraction to gateway."""
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        extraction = KGExtractionResult(
            entities=[{"name": "hiking", "type": "activity"}],
            relations=[
                {"source": "User", "target": "hiking", "type": "likes", "confidence": 0.9}
            ],
            reasoning="User likes hiking",
        )

        result = await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        assert result is True
        http_client.post.assert_called_once()

        # Check payload structure
        call_args = http_client.post.call_args
        payload = call_args[1]["json"]
        assert "nodes" in payload
        assert "relations" in payload
        assert payload["autoApprove"] is True

    @pytest.mark.asyncio
    async def test_skip_empty_extraction(self, service, http_client):
        """Should not submit if no extractions."""
        extraction = KGExtractionResult(entities=[], relations=[])

        result = await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        assert result is True
        http_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_gateway_error(self, service, http_client):
        """Should handle gateway errors."""
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=500, text="Server Error")
        )

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        result = await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        assert result is False


class TestParseExtractionResponse:
    """Tests for _parse_extraction_response method."""

    def test_parse_valid_json(self, service):
        """Should parse valid JSON response."""
        response = json.dumps({
            "entities": [{"name": "test", "type": "thing"}],
            "relations": [],
            "reasoning": "Test extraction",
        })

        result = service._parse_extraction_response(response)

        assert result.success is True
        assert len(result.entities) == 1
        assert result.reasoning == "Test extraction"

    def test_parse_markdown_wrapped_json(self, service):
        """Should handle JSON wrapped in markdown code blocks."""
        response = """```json
{
    "entities": [{"name": "test", "type": "thing"}],
    "relations": [],
    "reasoning": "Test"
}
```"""

        result = service._parse_extraction_response(response)

        assert result.success is True
        assert len(result.entities) == 1

    def test_parse_invalid_json(self, service):
        """Should handle invalid JSON."""
        result = service._parse_extraction_response("not json")

        assert result.success is False
        assert result.error is not None

    def test_parse_empty_response(self, service):
        """Should handle empty arrays in response."""
        response = json.dumps({
            "entities": [],
            "relations": [],
        })

        result = service._parse_extraction_response(response)

        assert result.success is True
        assert len(result.entities) == 0
        assert len(result.relations) == 0


class TestNormalizeUserReferences:
    """Tests for _normalize_user_references method."""

    def test_normalize_entity_names(self, service):
        """Should normalize user entity names."""
        result = KGExtractionResult(
            entities=[
                {"name": "I", "type": "person"},
                {"name": "hiking", "type": "activity"},
            ],
            relations=[],
        )

        normalized = service._normalize_user_references(result, "user-123")

        user_entity = next(e for e in normalized.entities if e["type"] == "person")
        assert user_entity["name"] == "User-user-123"

    def test_normalize_relation_source(self, service):
        """Should normalize relation source."""
        result = KGExtractionResult(
            entities=[],
            relations=[{"source": "me", "target": "hiking", "type": "likes"}],
        )

        normalized = service._normalize_user_references(result, "abc12345")

        assert normalized.relations[0]["source"] == "User-abc12345"

    def test_normalize_relation_target(self, service):
        """Should normalize relation target."""
        result = KGExtractionResult(
            entities=[],
            relations=[{"source": "pizza", "target": "myself", "type": "related_to"}],
        )

        normalized = service._normalize_user_references(result, "xyz98765")

        assert normalized.relations[0]["target"] == "User-xyz98765"


class TestDeduplicateEntities:
    """Tests for _deduplicate_entities method."""

    def test_deduplicate_by_name(self, service):
        """Should deduplicate entities by normalized name."""
        entities = [
            {"name": "Hiking", "type": "activity"},
            {"name": "hiking", "type": "activity"},  # Duplicate (case insensitive)
            {"name": "Running", "type": "activity"},
        ]

        result = service._deduplicate_entities(entities)

        assert len(result) == 2
        names = [e["name"].lower() for e in result]
        assert "hiking" in names
        assert "running" in names

    def test_keep_first_occurrence(self, service):
        """Should keep first occurrence when deduplicating."""
        entities = [
            {"name": "Test", "type": "thing", "extra": "first"},
            {"name": "test", "type": "thing", "extra": "second"},
        ]

        result = service._deduplicate_entities(entities)

        assert len(result) == 1
        assert result[0]["extra"] == "first"


class TestPromptTemplates:
    """Tests for prompt template formatting."""

    def test_full_extraction_prompt_format(self):
        """Should format full extraction prompt correctly."""
        prompt = KG_EXTRACTION_PROMPT.format(
            user_message="I love hiking",
            assistant_message_section="Assistant: That's great!",
        )

        assert "I love hiking" in prompt
        assert "That's great!" in prompt
        assert "entities" in prompt
        assert "relations" in prompt

    def test_quick_extraction_prompt_format(self):
        """Should format quick extraction prompt correctly."""
        prompt = KG_QUICK_EXTRACTION_PROMPT.format(user_message="I love hiking")

        assert "I love hiking" in prompt
        assert len(prompt) < 500  # Quick prompt should be short


class TestSingletonInstance:
    """Tests for singleton pattern."""

    def test_get_kg_extraction_service_returns_instance(self, settings):
        """Should return a service instance."""
        instance = get_kg_extraction_service(settings)
        assert isinstance(instance, KGExtractionService)

    def test_get_kg_extraction_service_returns_same_instance(self, settings):
        """Should return same instance on repeated calls."""
        # Reset singleton for test
        import orchestrator.services.kg_extraction as module
        module._extraction_service = None

        instance1 = get_kg_extraction_service(settings)
        instance2 = get_kg_extraction_service(settings)
        assert instance1 is instance2
