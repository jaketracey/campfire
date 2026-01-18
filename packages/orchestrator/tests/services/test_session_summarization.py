"""
Session Summarization Service Tests

Tests for the automated generation of session summaries
when conversation turns exceed a threshold.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.services.session_summarization import (
    SessionSummarizationService,
    SessionSummaryResult,
    get_session_summarization_service,
    SUMMARIZATION_PROMPT,
)


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        anthropic_api_key="test-key",
        kg_extraction_model="claude-3-haiku-20240307",  # Reuse cheap model
        gateway_url="http://localhost:3000",
        internal_service_key="test-internal-key",
    )


@pytest.fixture
def http_client():
    """Create a mock HTTP client."""
    return AsyncMock()


@pytest.fixture
def service(settings, http_client):
    """Create a SessionSummarizationService instance."""
    return SessionSummarizationService(settings, http_client)


@pytest.fixture
def sample_summarization_response():
    """Sample successful LLM summarization response."""
    return json.dumps({
        "summary": "User discussed their love of hiking and mentioned they live in Colorado. They expressed interest in trying rock climbing.",
        "key_facts": [
            "User loves hiking",
            "User lives in Colorado",
            "User is interested in rock climbing",
        ],
        "emotional_tone": "positive and engaged",
    })


@pytest.fixture
def sample_turns():
    """Sample conversation turns for testing."""
    return [
        {"role": "user", "content": "I love hiking in the mountains!"},
        {"role": "assistant", "content": "That sounds wonderful! Where do you usually go hiking?"},
        {"role": "user", "content": "I live in Colorado, so I have amazing trails nearby."},
        {"role": "assistant", "content": "Colorado has some of the best hiking in the country!"},
        {"role": "user", "content": "I've been thinking about trying rock climbing too."},
        {"role": "assistant", "content": "Rock climbing is a great companion activity to hiking!"},
    ]


class TestSessionSummaryResult:
    """Tests for SessionSummaryResult."""

    def test_has_summary(self):
        """Should return True when summary present."""
        result = SessionSummaryResult(
            summary="Test summary",
            key_facts=["Fact 1"],
        )
        assert result.has_summary is True

    def test_has_summary_empty(self):
        """Should return False when summary is empty."""
        result = SessionSummaryResult(summary="", key_facts=[])
        assert result.has_summary is False

    def test_has_summary_none(self):
        """Should return False when summary is None."""
        result = SessionSummaryResult(summary=None, key_facts=[])
        assert result.has_summary is False

    def test_to_dict(self):
        """Should serialize to dictionary."""
        result = SessionSummaryResult(
            summary="Test summary",
            key_facts=["Fact 1", "Fact 2"],
            emotional_tone="positive",
            success=True,
        )
        data = result.to_dict()
        assert data["summary"] == "Test summary"
        assert data["key_facts"] == ["Fact 1", "Fact 2"]
        assert data["emotional_tone"] == "positive"
        assert data["success"] is True


class TestShouldSummarize:
    """Tests for should_summarize heuristic."""

    def test_skip_short_sessions(self, service):
        """Should skip sessions with few turns."""
        # Default threshold is 20 turns
        assert service.should_summarize(turn_count=5) is False
        assert service.should_summarize(turn_count=10) is False
        assert service.should_summarize(turn_count=19) is False

    def test_summarize_at_threshold(self, service):
        """Should summarize at threshold."""
        assert service.should_summarize(turn_count=20) is True
        assert service.should_summarize(turn_count=25) is True

    def test_custom_threshold(self, service):
        """Should respect custom threshold."""
        assert service.should_summarize(turn_count=10, threshold=10) is True
        assert service.should_summarize(turn_count=9, threshold=10) is False

    def test_skip_if_recently_summarized(self, service):
        """Should skip if already summarized recently."""
        # If we summarized at turn 20, shouldn't summarize again at 21
        assert service.should_summarize(
            turn_count=21,
            last_summary_turn=20,
            summary_interval=20,
        ) is False

        # But should summarize at turn 40
        assert service.should_summarize(
            turn_count=40,
            last_summary_turn=20,
            summary_interval=20,
        ) is True

    def test_skip_if_existing_summary(self, service):
        """Should skip if session already has a recent summary."""
        assert service.should_summarize(
            turn_count=25,
            has_existing_summary=True,
            last_summary_turn=20,
        ) is False


class TestGenerateSummary:
    """Tests for generate_summary method."""

    @pytest.mark.asyncio
    async def test_generates_summary_from_turns(
        self, service, sample_turns, sample_summarization_response
    ):
        """Should generate summary from conversation turns."""
        with patch.object(
            service, "_call_summarization_llm", return_value=sample_summarization_response
        ):
            result = await service.generate_summary(
                turns=sample_turns,
                session_id=uuid4(),
            )

        assert result.success is True
        assert result.has_summary is True
        assert "hiking" in result.summary.lower()
        assert len(result.key_facts) > 0

    @pytest.mark.asyncio
    async def test_handles_empty_turns(self, service):
        """Should handle empty turn list."""
        result = await service.generate_summary(
            turns=[],
            session_id=uuid4(),
        )

        assert result.success is True
        assert result.has_summary is False
        assert "insufficient" in result.error.lower()

    @pytest.mark.asyncio
    async def test_handles_too_few_turns(self, service):
        """Should handle too few turns."""
        result = await service.generate_summary(
            turns=[{"role": "user", "content": "Hi"}],
            session_id=uuid4(),
        )

        assert result.success is True
        assert result.has_summary is False

    @pytest.mark.asyncio
    async def test_handles_llm_error(self, service, sample_turns):
        """Should handle LLM errors gracefully."""
        with patch.object(
            service, "_call_summarization_llm",
            side_effect=Exception("LLM error"),
        ):
            result = await service.generate_summary(
                turns=sample_turns,
                session_id=uuid4(),
            )

        assert result.success is False
        assert "LLM error" in result.error

    @pytest.mark.asyncio
    async def test_handles_invalid_json_response(self, service, sample_turns):
        """Should handle invalid JSON from LLM."""
        with patch.object(
            service, "_call_summarization_llm", return_value="not valid json"
        ):
            result = await service.generate_summary(
                turns=sample_turns,
                session_id=uuid4(),
            )

        assert result.success is False
        assert "parse" in result.error.lower()

    @pytest.mark.asyncio
    async def test_includes_companion_context(
        self, service, sample_turns, sample_summarization_response
    ):
        """Should include companion info in prompt."""
        call_args = []

        async def capture_prompt(prompt):
            call_args.append(prompt)
            return sample_summarization_response

        with patch.object(service, "_call_summarization_llm", side_effect=capture_prompt):
            await service.generate_summary(
                turns=sample_turns,
                session_id=uuid4(),
                companion_name="Luna",
            )

        assert len(call_args) == 1
        assert "Luna" in call_args[0]


class TestSubmitSummary:
    """Tests for submit_summary method."""

    @pytest.mark.asyncio
    async def test_submit_to_gateway(self, service, http_client):
        """Should submit summary to gateway."""
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        session_id = uuid4()
        summary_result = SessionSummaryResult(
            summary="Test summary of the conversation",
            key_facts=["User loves hiking"],
            emotional_tone="positive",
        )

        result = await service.submit_summary(
            session_id=session_id,
            summary=summary_result,
            user_id=uuid4(),
        )

        assert result is True
        http_client.post.assert_called_once()

        # Check payload structure
        call_args = http_client.post.call_args
        payload = call_args[1]["json"]
        assert payload["summary"] == "Test summary of the conversation"
        assert payload["sessionId"] == str(session_id)

    @pytest.mark.asyncio
    async def test_skip_empty_summary(self, service, http_client):
        """Should not submit if no summary."""
        summary_result = SessionSummaryResult(summary="", key_facts=[])

        result = await service.submit_summary(
            session_id=uuid4(),
            summary=summary_result,
            user_id=uuid4(),
        )

        assert result is True
        http_client.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_gateway_error(self, service, http_client):
        """Should handle gateway errors."""
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=500, text="Server Error")
        )

        summary_result = SessionSummaryResult(
            summary="Test summary",
            key_facts=[],
        )

        result = await service.submit_summary(
            session_id=uuid4(),
            summary=summary_result,
            user_id=uuid4(),
        )

        assert result is False


class TestParseSummarizationResponse:
    """Tests for _parse_summarization_response method."""

    def test_parse_valid_json(self, service):
        """Should parse valid JSON response."""
        response = json.dumps({
            "summary": "Test summary",
            "key_facts": ["Fact 1", "Fact 2"],
            "emotional_tone": "neutral",
        })

        result = service._parse_summarization_response(response)

        assert result.success is True
        assert result.summary == "Test summary"
        assert result.key_facts == ["Fact 1", "Fact 2"]
        assert result.emotional_tone == "neutral"

    def test_parse_markdown_wrapped_json(self, service):
        """Should handle JSON wrapped in markdown code blocks."""
        response = """```json
{
    "summary": "Test summary",
    "key_facts": [],
    "emotional_tone": "positive"
}
```"""

        result = service._parse_summarization_response(response)

        assert result.success is True
        assert result.summary == "Test summary"

    def test_parse_invalid_json(self, service):
        """Should handle invalid JSON."""
        result = service._parse_summarization_response("not json")

        assert result.success is False
        assert result.error is not None

    def test_parse_plain_text_summary(self, service):
        """Should handle plain text response (fallback)."""
        # Some models might just return the summary directly
        response = "This is a plain text summary of the conversation."

        result = service._parse_summarization_response(response)

        # Should create a basic result from plain text
        assert result.success is True
        assert result.summary == response


class TestBuildConversationText:
    """Tests for _build_conversation_text method."""

    def test_formats_turns_correctly(self, service):
        """Should format turns as User/Assistant dialogue."""
        turns = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]

        text = service._build_conversation_text(turns)

        assert "User: Hello" in text
        assert "Assistant: Hi there!" in text

    def test_truncates_long_conversations(self, service):
        """Should truncate very long conversations."""
        turns = [
            {"role": "user", "content": "Message " + str(i) * 100}
            for i in range(100)
        ]

        text = service._build_conversation_text(turns, max_tokens=1000)

        # Should be truncated
        assert len(text) < 10000

    def test_handles_empty_turns(self, service):
        """Should handle empty turn list."""
        text = service._build_conversation_text([])
        assert text == ""

    def test_skips_empty_content(self, service):
        """Should skip turns with empty content."""
        turns = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": ""},
            {"role": "user", "content": "Are you there?"},
        ]

        text = service._build_conversation_text(turns)

        assert "Hello" in text
        assert "Are you there?" in text
        # Empty assistant message should be skipped
        assert text.count("Assistant:") == 0 or "Assistant: Are" not in text


class TestSummarizationPrompt:
    """Tests for prompt template."""

    def test_prompt_includes_conversation_placeholder(self):
        """Prompt should include conversation placeholder."""
        assert "{conversation}" in SUMMARIZATION_PROMPT

    def test_prompt_includes_output_format(self):
        """Prompt should specify JSON output format."""
        assert "json" in SUMMARIZATION_PROMPT.lower()
        assert "summary" in SUMMARIZATION_PROMPT.lower()


class TestSingletonInstance:
    """Tests for singleton pattern."""

    def test_get_session_summarization_service_returns_instance(self, settings):
        """Should return a service instance."""
        instance = get_session_summarization_service(settings)
        assert isinstance(instance, SessionSummarizationService)

    def test_get_session_summarization_service_returns_same_instance(self, settings):
        """Should return same instance on repeated calls."""
        # Reset singleton for test
        import orchestrator.services.session_summarization as module
        module._summarization_service = None

        instance1 = get_session_summarization_service(settings)
        instance2 = get_session_summarization_service(settings)
        assert instance1 is instance2


class TestIntegrationScenarios:
    """Integration test scenarios."""

    @pytest.mark.asyncio
    async def test_full_summarization_flow(self, service, http_client):
        """Test full flow from turns to submitted summary."""
        # Setup mock HTTP
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        # Create 25 turns (above threshold)
        turns = []
        for i in range(25):
            turns.append({"role": "user", "content": f"User message {i}"})
            turns.append({"role": "assistant", "content": f"Response {i}"})

        session_id = uuid4()
        user_id = uuid4()

        # Mock LLM response
        llm_response = json.dumps({
            "summary": "Extensive conversation covering multiple topics",
            "key_facts": ["Many messages exchanged"],
            "emotional_tone": "engaged",
        })

        with patch.object(service, "_call_summarization_llm", return_value=llm_response):
            # Check if should summarize
            should = service.should_summarize(turn_count=len(turns) // 2)
            assert should is True

            # Generate summary
            result = await service.generate_summary(
                turns=turns,
                session_id=session_id,
            )
            assert result.success is True
            assert result.has_summary is True

            # Submit summary
            submitted = await service.submit_summary(
                session_id=session_id,
                summary=result,
                user_id=user_id,
            )
            assert submitted is True

    @pytest.mark.asyncio
    async def test_handles_gateway_timeout(self, service):
        """Should handle gateway timeout gracefully."""
        import httpx

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))

        service.http_client = mock_http

        summary_result = SessionSummaryResult(
            summary="Test summary",
            key_facts=[],
        )

        result = await service.submit_summary(
            session_id=uuid4(),
            summary=summary_result,
            user_id=uuid4(),
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_summarize_and_store_convenience_method(
        self, service, http_client, sample_turns
    ):
        """Test the convenience method that combines generate and submit."""
        http_client.post = AsyncMock(
            return_value=MagicMock(status_code=200, text="OK")
        )

        llm_response = json.dumps({
            "summary": "Test summary",
            "key_facts": ["Fact 1"],
            "emotional_tone": "positive",
        })

        with patch.object(service, "_call_summarization_llm", return_value=llm_response):
            result = await service.summarize_and_store(
                turns=sample_turns,
                session_id=uuid4(),
                user_id=uuid4(),
            )

        assert result.success is True
        assert result.has_summary is True
        http_client.post.assert_called_once()
