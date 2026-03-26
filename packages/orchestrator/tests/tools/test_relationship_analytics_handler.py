"""
RelationshipAnalyticsHandler Tests

Tests for the relationship analytics tool handler, covering all analysis types,
formatting, validation, and error handling.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.relationship_analytics_handler import (
    RelationshipAnalyticsHandler,
    VALID_ANALYSIS_TYPES,
)


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings()


@pytest.fixture
def event_emitter():
    """Create a mock event emitter."""
    emitter = AsyncMock(spec=EventEmitter)
    emitter.emit = AsyncMock()
    return emitter


@pytest.fixture
def http_client():
    """Create a mock HTTP client."""
    return AsyncMock(spec=httpx.AsyncClient)


@pytest.fixture
def handler(settings, event_emitter, http_client):
    """Create a RelationshipAnalyticsHandler instance."""
    return RelationshipAnalyticsHandler(settings, event_emitter, http_client)


@pytest.fixture
def make_tool_call():
    """Factory for creating analytics tool calls."""
    def _make(
        companion_id: str | None = None,
        analysis_type: str = "summary",
    ):
        return ToolCall(
            id="test-call-id",
            name="relationship_analytics",
            arguments={
                "companion_id": companion_id or str(uuid4()),
                "analysis_type": analysis_type,
            },
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )
    return _make


class TestRelationshipAnalyticsBasics:
    """Basic tests for RelationshipAnalyticsHandler."""

    def test_handler_name(self, handler):
        """Handler should have correct name."""
        assert handler.name == "relationship_analytics"

    def test_validate_valid_arguments(self, handler):
        """Should accept valid arguments."""
        is_valid, error = handler.validate_arguments({
            "companion_id": str(uuid4()),
            "analysis_type": "summary",
        })
        assert is_valid is True
        assert error is None

    def test_validate_all_analysis_types(self, handler):
        """Should accept all valid analysis types."""
        for analysis_type in VALID_ANALYSIS_TYPES:
            is_valid, _ = handler.validate_arguments({
                "companion_id": str(uuid4()),
                "analysis_type": analysis_type,
            })
            assert is_valid is True, f"Should accept analysis_type={analysis_type}"

    def test_validate_missing_companion_id(self, handler):
        """Should reject missing companion_id."""
        is_valid, error = handler.validate_arguments({"analysis_type": "summary"})
        assert is_valid is False
        assert "companion_id" in error

    def test_validate_empty_companion_id(self, handler):
        """Should reject empty companion_id."""
        is_valid, error = handler.validate_arguments({
            "companion_id": "",
            "analysis_type": "summary",
        })
        assert is_valid is False

    def test_validate_invalid_analysis_type(self, handler):
        """Should reject invalid analysis_type."""
        is_valid, error = handler.validate_arguments({
            "companion_id": str(uuid4()),
            "analysis_type": "invalid_type",
        })
        assert is_valid is False
        assert "analysis_type" in error

    def test_validate_missing_analysis_type(self, handler):
        """Should reject missing analysis_type."""
        is_valid, error = handler.validate_arguments({
            "companion_id": str(uuid4()),
        })
        assert is_valid is False


class TestSummaryAnalysis:
    """Tests for the summary analysis type."""

    @pytest.mark.asyncio
    async def test_summary_format(self, handler, make_tool_call):
        """Summary should contain key relationship metrics."""
        handler._fetch_analytics = AsyncMock(return_value={
            "totalSessions": 42,
            "totalTurns": 350,
            "firstSessionAt": "2025-01-01T00:00:00Z",
            "lastSessionAt": "2026-03-20T12:00:00Z",
            "memoryCount": 15,
            "totalDurationHours": 12.5,
        })

        result = await handler.execute(make_tool_call(analysis_type="summary"))

        assert result.success is True
        assert "42" in result.output
        assert "350" in result.output
        assert "2025-01-01" in result.output
        assert "15" in result.output
        assert "12.5" in result.output

    @pytest.mark.asyncio
    async def test_summary_with_zero_data(self, handler, make_tool_call):
        """Summary should handle zero/empty data gracefully."""
        handler._fetch_analytics = AsyncMock(return_value={
            "totalSessions": 0,
            "totalTurns": 0,
            "firstSessionAt": None,
            "lastSessionAt": None,
            "memoryCount": 0,
            "totalDurationHours": 0,
        })

        result = await handler.execute(make_tool_call(analysis_type="summary"))

        assert result.success is True
        assert "0" in result.output


class TestEmotionalTrajectoryAnalysis:
    """Tests for the emotional trajectory analysis type."""

    @pytest.mark.asyncio
    async def test_emotional_trajectory_format(self, handler, make_tool_call):
        """Emotional trajectory should list session sentiments."""
        handler._fetch_analytics = AsyncMock(return_value={
            "sessions": [
                {"date": "2026-03-20", "averageSentiment": "positive", "dominantEmotion": "joy"},
                {"date": "2026-03-18", "averageSentiment": "neutral", "dominantEmotion": "calm"},
            ],
            "overallTrend": "positive",
        })

        result = await handler.execute(make_tool_call(analysis_type="emotional_trajectory"))

        assert result.success is True
        assert "positive" in result.output
        assert "joy" in result.output
        assert "2026-03-20" in result.output
        assert "positive" in result.output  # overall trend

    @pytest.mark.asyncio
    async def test_emotional_trajectory_empty(self, handler, make_tool_call):
        """Should handle no emotional data."""
        handler._fetch_analytics = AsyncMock(return_value={
            "sessions": [],
            "overallTrend": "stable",
        })

        result = await handler.execute(make_tool_call(analysis_type="emotional_trajectory"))

        assert result.success is True
        assert "No emotional trajectory data" in result.output


class TestTopicHistoryAnalysis:
    """Tests for the topic history analysis type."""

    @pytest.mark.asyncio
    async def test_topic_history_format(self, handler, make_tool_call):
        """Topic history should list topics with counts."""
        handler._fetch_analytics = AsyncMock(return_value={
            "topics": [
                {"name": "cooking", "mentionCount": 12, "lastMentioned": "2026-03-20"},
                {"name": "travel", "mentionCount": 8, "lastMentioned": "2026-03-15"},
            ],
        })

        result = await handler.execute(make_tool_call(analysis_type="topic_history"))

        assert result.success is True
        assert "cooking" in result.output
        assert "12" in result.output
        assert "travel" in result.output

    @pytest.mark.asyncio
    async def test_topic_history_empty(self, handler, make_tool_call):
        """Should handle no topic data."""
        handler._fetch_analytics = AsyncMock(return_value={"topics": []})

        result = await handler.execute(make_tool_call(analysis_type="topic_history"))

        assert result.success is True
        assert "No topic history data" in result.output


class TestInteractionStatsAnalysis:
    """Tests for the interaction stats analysis type."""

    @pytest.mark.asyncio
    async def test_interaction_stats_format(self, handler, make_tool_call):
        """Interaction stats should include timing and frequency data."""
        handler._fetch_analytics = AsyncMock(return_value={
            "avgSessionLengthMinutes": 15.5,
            "sessionsPerWeek": 3.2,
            "avgTurnsPerSession": 25,
            "longestSessionMinutes": 45,
            "mostActiveHour": "20:00",
            "mostActiveDay": "Saturday",
        })

        result = await handler.execute(make_tool_call(analysis_type="interaction_stats"))

        assert result.success is True
        assert "15.5" in result.output
        assert "3.2" in result.output
        assert "25" in result.output
        assert "45" in result.output
        assert "20:00" in result.output
        assert "Saturday" in result.output


class TestFetchAnalytics:
    """Tests for the gateway API integration."""

    @pytest.mark.asyncio
    async def test_fetch_sends_correct_request(self, handler, http_client, settings):
        """Should send correct request to gateway."""
        companion_id = str(uuid4())
        user_id = str(uuid4())

        mock_response = MagicMock()
        mock_response.json.return_value = {"data": {"totalSessions": 5}}
        mock_response.raise_for_status = MagicMock()
        http_client.get = AsyncMock(return_value=mock_response)

        result = await handler._fetch_analytics(user_id, companion_id, "summary")

        http_client.get.assert_called_once()
        call_args = http_client.get.call_args
        assert companion_id in call_args[0][0]
        assert call_args[1]["params"]["type"] == "summary"
        assert call_args[1]["params"]["userId"] == user_id
        assert result == {"totalSessions": 5}

    @pytest.mark.asyncio
    async def test_fetch_returns_none_on_404(self, handler, http_client):
        """Should return None when gateway returns 404."""
        mock_response = MagicMock()
        mock_response.status_code = 404
        http_error = httpx.HTTPStatusError(
            "Not found", request=MagicMock(), response=mock_response
        )
        http_client.get = AsyncMock(side_effect=mock_response)
        mock_response.raise_for_status = MagicMock(side_effect=http_error)
        http_client.get = AsyncMock(return_value=mock_response)

        result = await handler._fetch_analytics("user-1", "comp-1", "summary")

        assert result is None

    @pytest.mark.asyncio
    async def test_fetch_raises_on_other_errors(self, handler, http_client):
        """Should raise on non-404 HTTP errors."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        http_error = httpx.HTTPStatusError(
            "Server error", request=MagicMock(), response=mock_response
        )
        mock_response.raise_for_status = MagicMock(side_effect=http_error)
        http_client.get = AsyncMock(return_value=mock_response)

        with pytest.raises(httpx.HTTPStatusError):
            await handler._fetch_analytics("user-1", "comp-1", "summary")


class TestErrorHandling:
    """Tests for error handling edge cases."""

    @pytest.mark.asyncio
    async def test_execute_no_data_returns_informative_message(self, handler, make_tool_call):
        """Should return informative message when no data exists."""
        handler._fetch_analytics = AsyncMock(return_value=None)

        result = await handler.execute(make_tool_call())

        assert result.success is True
        assert "No relationship data" in result.output

    @pytest.mark.asyncio
    async def test_execute_handles_gateway_failure(self, handler, make_tool_call):
        """Should return failure result when gateway call fails."""
        handler._fetch_analytics = AsyncMock(side_effect=Exception("Connection refused"))

        result = await handler.execute(make_tool_call())

        assert result.success is False
        assert "Connection refused" in result.error

    @pytest.mark.asyncio
    async def test_metadata_includes_analysis_type(self, handler, make_tool_call):
        """Result metadata should include the analysis type."""
        handler._fetch_analytics = AsyncMock(return_value={"totalSessions": 1})

        result = await handler.execute(make_tool_call(analysis_type="summary"))

        assert result.metadata["analysis_type"] == "summary"
