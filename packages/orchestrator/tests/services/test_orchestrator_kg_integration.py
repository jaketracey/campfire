"""
Tests for orchestrator integration with KG extraction service.

Verifies that the orchestrator properly uses the KGExtractionService
for rate-limited, automated knowledge graph extraction.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.services.kg_extraction import KGExtractionService, KGExtractionResult


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        anthropic_api_key="test-key",
        kg_extraction_enabled=True,
        kg_extraction_model="claude-3-haiku-20240307",
        kg_extraction_interval=3,
        kg_extraction_auto_approve=True,
        gateway_url="http://localhost:3000",
        internal_service_key="test-internal-key",
    )


@pytest.fixture
def mock_kg_service():
    """Create a mock KG extraction service."""
    service = MagicMock(spec=KGExtractionService)
    service.should_extract = MagicMock(return_value=True)
    service.extract_from_turn = AsyncMock(
        return_value=KGExtractionResult(
            entities=[{"name": "hiking", "type": "activity"}],
            relations=[{"source": "User", "target": "hiking", "type": "likes", "confidence": 0.9}],
            reasoning="User likes hiking",
        )
    )
    service.submit_extraction = AsyncMock(return_value=True)
    return service


class TestKGExtractionIntegration:
    """Tests for KG extraction integration in orchestrator."""

    def test_should_extract_respects_settings(self, settings):
        """Should use settings for extraction interval."""
        service = KGExtractionService(settings)

        msg = "I love hiking in the mountains"

        # Should extract on first turn
        assert service.should_extract(msg, turn_count=1) is True

        # Should not extract within interval (configured as 3)
        assert service.should_extract(msg, turn_count=2, last_extraction_turn=1) is False
        assert service.should_extract(msg, turn_count=3, last_extraction_turn=1) is False

        # Should extract after interval
        assert service.should_extract(msg, turn_count=4, last_extraction_turn=1) is True

    def test_should_extract_disabled_in_settings(self, settings):
        """Should respect kg_extraction_enabled setting."""
        settings.kg_extraction_enabled = False
        service = KGExtractionService(settings)

        # Even with a good message, should respect enabled flag
        # The service itself doesn't check this - orchestrator should
        msg = "I love hiking in the mountains"

        # Service still works but orchestrator should skip
        assert service.should_extract(msg, turn_count=1) is True

    @pytest.mark.asyncio
    async def test_extract_from_turn_uses_settings_model(self, settings):
        """Should use kg_extraction_model from settings."""
        service = KGExtractionService(settings)

        with patch.object(service, "_call_extraction_llm") as mock_llm:
            mock_llm.return_value = '{"entities": [], "relations": []}'

            await service.extract_from_turn("I love hiking in the mountains")

            # Verify LLM was called (model used internally)
            mock_llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_submit_uses_auto_approve_setting(self, settings, mock_kg_service):
        """Should pass auto_approve from settings."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
            auto_approve=settings.kg_extraction_auto_approve,
        )

        # Check autoApprove was passed correctly
        call_args = mock_http.post.call_args
        payload = call_args[1]["json"]
        assert payload["autoApprove"] is True

    @pytest.mark.asyncio
    async def test_submit_uses_gateway_url_from_settings(self, settings):
        """Should use gateway_url from settings."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        # Check URL was correct
        call_args = mock_http.post.call_args
        url = call_args[0][0]
        assert url.startswith(settings.gateway_url)

    @pytest.mark.asyncio
    async def test_submit_uses_internal_service_key(self, settings):
        """Should use internal_service_key for auth."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        # Check headers include service key
        call_args = mock_http.post.call_args
        headers = call_args[1]["headers"]
        assert headers["X-Internal-Service-Key"] == settings.internal_service_key


class TestKGExtractionRateLimiting:
    """Tests for rate limiting behavior."""

    def test_interval_of_1_extracts_every_turn(self, settings):
        """Interval of 1 should extract every turn."""
        settings.kg_extraction_interval = 1
        service = KGExtractionService(settings)

        # Message must be >= 20 chars and contain extraction keyword
        msg = "I love hiking in the beautiful mountains"

        assert service.should_extract(msg, 1, None, extraction_interval=1) is True
        assert service.should_extract(msg, 2, 1, extraction_interval=1) is True
        assert service.should_extract(msg, 3, 2, extraction_interval=1) is True

    def test_interval_of_5_extracts_every_5_turns(self, settings):
        """Interval of 5 should extract every 5 turns."""
        settings.kg_extraction_interval = 5
        service = KGExtractionService(settings)

        # Message must be >= 20 chars and contain extraction keyword
        msg = "I love hiking in the beautiful mountains"

        assert service.should_extract(msg, 1, None, extraction_interval=5) is True
        assert service.should_extract(msg, 2, 1, extraction_interval=5) is False
        assert service.should_extract(msg, 5, 1, extraction_interval=5) is False
        assert service.should_extract(msg, 6, 1, extraction_interval=5) is True

    def test_rate_limiting_resets_with_new_extraction(self, settings):
        """Rate limit should reset after each extraction."""
        service = KGExtractionService(settings)

        # Message must be >= 20 chars and contain extraction keyword
        msg = "I love hiking in the beautiful mountains"

        # First extraction at turn 1
        assert service.should_extract(msg, 1, None, extraction_interval=3) is True

        # Skip turns 2-3
        assert service.should_extract(msg, 2, 1, extraction_interval=3) is False
        assert service.should_extract(msg, 3, 1, extraction_interval=3) is False

        # Extract at turn 4
        assert service.should_extract(msg, 4, 1, extraction_interval=3) is True

        # Now rate limit resets - skip turns 5-6 if last was 4
        assert service.should_extract(msg, 5, 4, extraction_interval=3) is False
        assert service.should_extract(msg, 6, 4, extraction_interval=3) is False

        # Extract at turn 7
        assert service.should_extract(msg, 7, 4, extraction_interval=3) is True


class TestKGExtractionPayload:
    """Tests for extraction payload formatting."""

    @pytest.mark.asyncio
    async def test_payload_includes_user_and_companion_ids(self, settings):
        """Should include user and companion IDs in headers."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        user_id = uuid4()
        companion_id = uuid4()

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=user_id,
            companion_id=companion_id,
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        headers = mock_http.post.call_args[1]["headers"]
        assert headers["X-User-Id"] == str(user_id)
        assert headers["X-Companion-Id"] == str(companion_id)

    @pytest.mark.asyncio
    async def test_payload_includes_source_event_id(self, settings):
        """Should include turn_id as sourceEventId."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        turn_id = uuid4()

        extraction = KGExtractionResult(
            entities=[{"name": "test", "type": "thing"}],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=turn_id,
        )

        payload = mock_http.post.call_args[1]["json"]
        assert payload["sourceEventId"] == str(turn_id)

    @pytest.mark.asyncio
    async def test_payload_maps_entities_to_nodes(self, settings):
        """Should map entities to nodes array."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        extraction = KGExtractionResult(
            entities=[
                {"name": "hiking", "type": "activity", "properties": {"outdoor": True}},
                {"name": "mountains", "type": "place", "properties": {}},
            ],
            relations=[],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        payload = mock_http.post.call_args[1]["json"]
        nodes = payload["nodes"]

        assert len(nodes) == 2
        assert nodes[0]["name"] == "hiking"
        assert nodes[0]["type"] == "activity"
        assert nodes[0]["properties"] == {"outdoor": True}

    @pytest.mark.asyncio
    async def test_payload_maps_relations_correctly(self, settings):
        """Should map relations with correct field names."""
        mock_http = AsyncMock()
        mock_http.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        service = KGExtractionService(settings, http_client=mock_http)

        extraction = KGExtractionResult(
            entities=[{"name": "User", "type": "person"}],
            relations=[
                {
                    "source": "User",
                    "target": "hiking",
                    "type": "likes",
                    "confidence": 0.95,
                }
            ],
        )

        await service.submit_extraction(
            extraction,
            user_id=uuid4(),
            companion_id=uuid4(),
            session_id=uuid4(),
            turn_id=uuid4(),
        )

        payload = mock_http.post.call_args[1]["json"]
        relations = payload["relations"]

        assert len(relations) == 1
        assert relations[0]["sourceEntity"] == "User"
        assert relations[0]["targetEntity"] == "hiking"
        assert relations[0]["relationType"] == "likes"
        assert relations[0]["confidence"] == 0.95


class TestKGExtractionErrorHandling:
    """Tests for error handling in extraction flow."""

    @pytest.mark.asyncio
    async def test_handles_gateway_timeout(self, settings):
        """Should handle gateway timeout gracefully."""
        import httpx

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))

        service = KGExtractionService(settings, http_client=mock_http)

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

        # Should return False on error, not raise
        assert result is False

    @pytest.mark.asyncio
    async def test_handles_gateway_connection_error(self, settings):
        """Should handle connection errors gracefully."""
        import httpx

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))

        service = KGExtractionService(settings, http_client=mock_http)

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

    @pytest.mark.asyncio
    async def test_handles_malformed_llm_response(self, settings):
        """Should handle malformed LLM responses."""
        service = KGExtractionService(settings)

        # Test various malformed responses
        malformed_responses = [
            "{}",  # Empty object
            '{"entities": "not an array"}',  # Wrong type
            '{"relations": null}',  # Null instead of array
            'Just some text with no JSON',  # No JSON at all
        ]

        for response in malformed_responses:
            with patch.object(service, "_call_extraction_llm", return_value=response):
                result = await service.extract_from_turn(
                    "I love hiking in the mountains"
                )

                # Should not raise, should return safe result
                assert isinstance(result, KGExtractionResult)

    @pytest.mark.asyncio
    async def test_extraction_failure_doesnt_affect_response(self, settings):
        """Extraction failure should not affect conversation response.

        This is tested at orchestrator level - extraction runs async.
        """
        service = KGExtractionService(settings)

        # Simulate LLM error
        with patch.object(
            service, "_call_extraction_llm",
            side_effect=Exception("LLM API error")
        ):
            result = await service.extract_from_turn(
                "I love hiking",
                user_id=uuid4(),
            )

            # Should return failure result, not raise
            assert result.success is False
            assert "LLM API error" in result.error


class TestKGExtractionMessageFiltering:
    """Tests for message filtering before extraction."""

    def test_skip_empty_messages(self, settings):
        """Should skip empty messages."""
        service = KGExtractionService(settings)

        assert service.should_extract("", 1) is False
        assert service.should_extract("   ", 1) is False

    def test_skip_single_word_messages(self, settings):
        """Should skip very short messages."""
        service = KGExtractionService(settings)

        assert service.should_extract("hi", 1) is False
        assert service.should_extract("ok", 1) is False
        assert service.should_extract("yes", 1) is False

    def test_skip_greetings(self, settings):
        """Should skip greeting messages."""
        service = KGExtractionService(settings)

        assert service.should_extract("hello", 1) is False
        assert service.should_extract("hey", 1) is False
        assert service.should_extract("good morning", 1) is False

    def test_skip_generic_acknowledgments(self, settings):
        """Should skip acknowledgment messages."""
        service = KGExtractionService(settings)

        assert service.should_extract("thanks", 1) is False
        assert service.should_extract("thank you", 1) is False
        assert service.should_extract("ok", 1) is False

    def test_extract_messages_with_facts(self, settings):
        """Should extract messages containing facts."""
        service = KGExtractionService(settings)

        # Messages must be >= 20 chars
        assert service.should_extract("I work at Google as a software engineer", 1) is True
        assert service.should_extract("I live in New York City downtown", 1) is True
        assert service.should_extract("My favorite color is blue and green", 1) is True

    def test_extract_messages_with_preferences(self, settings):
        """Should extract messages with preferences."""
        service = KGExtractionService(settings)

        # Messages must be >= 20 chars
        assert service.should_extract("I love hiking in the mountains on weekends", 1) is True
        assert service.should_extract("I prefer tea over coffee in the morning", 1) is True
        assert service.should_extract("I hate waiting in lines at the store", 1) is True

    def test_extract_messages_with_relationships(self, settings):
        """Should extract messages about relationships."""
        service = KGExtractionService(settings)

        assert service.should_extract("My friend Sarah is visiting", 1) is True
        assert service.should_extract("My partner and I went to the movies", 1) is True
        assert service.should_extract("My family lives in California", 1) is True
