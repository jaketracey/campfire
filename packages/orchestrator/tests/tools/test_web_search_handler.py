"""
WebSearchHandler Tests

Tests for the web search tool handler, covering search execution,
result formatting, validation, and error handling.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.web_search_handler import WebSearchHandler


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
    """Create a WebSearchHandler instance."""
    return WebSearchHandler(settings, event_emitter, http_client)


@pytest.fixture
def make_tool_call():
    """Factory for creating search tool calls."""
    def _make(query: str = "test query", max_results: int = 5):
        return ToolCall(
            id="test-call-id",
            name="web_search",
            arguments={"query": query, "max_results": max_results},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )
    return _make


class TestWebSearchHandlerBasics:
    """Basic tests for WebSearchHandler."""

    def test_handler_name(self, handler):
        """Handler should have correct name."""
        assert handler.name == "web_search"

    def test_validate_valid_arguments(self, handler):
        """Should accept valid arguments."""
        is_valid, error = handler.validate_arguments({"query": "test", "max_results": 5})
        assert is_valid is True
        assert error is None

    def test_validate_missing_query(self, handler):
        """Should reject missing query."""
        is_valid, error = handler.validate_arguments({"max_results": 5})
        assert is_valid is False
        assert "query" in error

    def test_validate_empty_query(self, handler):
        """Should reject empty query."""
        is_valid, error = handler.validate_arguments({"query": ""})
        assert is_valid is False

    def test_validate_blank_query(self, handler):
        """Should reject blank (whitespace-only) query."""
        is_valid, error = handler.validate_arguments({"query": "   "})
        assert is_valid is False
        assert "blank" in error

    def test_validate_invalid_max_results_zero(self, handler):
        """Should reject max_results less than 1."""
        is_valid, error = handler.validate_arguments({"query": "test", "max_results": 0})
        assert is_valid is False
        assert "max_results" in error

    def test_validate_invalid_max_results_too_high(self, handler):
        """Should reject max_results greater than 20."""
        is_valid, error = handler.validate_arguments({"query": "test", "max_results": 21})
        assert is_valid is False

    def test_validate_default_max_results(self, handler):
        """Should accept query without max_results (uses default)."""
        is_valid, error = handler.validate_arguments({"query": "test"})
        assert is_valid is True


class TestWebSearchExecution:
    """Tests for search execution and result formatting."""

    @pytest.mark.asyncio
    async def test_execute_with_results(self, handler, make_tool_call):
        """Should return formatted results when search succeeds."""
        mock_results = [
            {"title": "Result 1", "url": "https://example.com/1", "snippet": "First result"},
            {"title": "Result 2", "url": "https://example.com/2", "snippet": "Second result"},
        ]
        handler._search_duckduckgo = AsyncMock(return_value=mock_results)

        tool_call = make_tool_call(query="python programming")
        result = await handler.execute(tool_call)

        assert result.success is True
        assert "Result 1" in result.output
        assert "Result 2" in result.output
        assert "https://example.com/1" in result.output
        assert result.metadata["result_count"] == 2
        assert result.metadata["query"] == "python programming"

    @pytest.mark.asyncio
    async def test_execute_with_no_results(self, handler, make_tool_call):
        """Should return informative message when no results found."""
        handler._search_duckduckgo = AsyncMock(return_value=[])

        tool_call = make_tool_call(query="xyznonexistentquery123")
        result = await handler.execute(tool_call)

        assert result.success is True
        assert "No web results found" in result.output
        assert result.metadata["result_count"] == 0

    @pytest.mark.asyncio
    async def test_execute_passes_max_results(self, handler, make_tool_call):
        """Should pass max_results to the search function."""
        handler._search_duckduckgo = AsyncMock(return_value=[])

        tool_call = make_tool_call(query="test", max_results=3)
        await handler.execute(tool_call)

        handler._search_duckduckgo.assert_called_once_with("test", 3)

    @pytest.mark.asyncio
    async def test_execute_handles_exception(self, handler, make_tool_call):
        """Should return failure result when search raises an exception."""
        handler._search_duckduckgo = AsyncMock(side_effect=Exception("Network error"))

        tool_call = make_tool_call()
        result = await handler.execute(tool_call)

        assert result.success is False
        assert "Network error" in result.error

    @pytest.mark.asyncio
    async def test_result_formatting_numbering(self, handler, make_tool_call):
        """Results should be numbered starting from 1."""
        mock_results = [
            {"title": f"Result {i}", "url": f"https://example.com/{i}", "snippet": f"Snippet {i}"}
            for i in range(1, 4)
        ]
        handler._search_duckduckgo = AsyncMock(return_value=mock_results)

        result = await handler.execute(make_tool_call())

        assert "1. **Result 1**" in result.output
        assert "2. **Result 2**" in result.output
        assert "3. **Result 3**" in result.output


class TestDuckDuckGoSearch:
    """Tests for the DuckDuckGo search backends."""

    @pytest.mark.asyncio
    async def test_package_fallback_to_api(self, handler):
        """Should fall back to API when package is not available."""
        # Patch the package import to fail
        handler._search_via_package = AsyncMock(side_effect=ImportError("No module"))
        handler._search_via_api = AsyncMock(return_value=[
            {"title": "API Result", "url": "https://example.com", "snippet": "From API"}
        ])

        results = await handler._search_duckduckgo("test", 5)

        assert len(results) == 1
        assert results[0]["title"] == "API Result"

    @pytest.mark.asyncio
    async def test_api_fallback_returns_empty_on_failure(self, handler):
        """Should return empty list when both backends fail."""
        handler._search_via_package = AsyncMock(side_effect=ImportError("No module"))
        handler._search_via_api = AsyncMock(side_effect=Exception("API down"))

        results = await handler._search_duckduckgo("test", 5)

        assert results == []

    @pytest.mark.asyncio
    async def test_api_search_parses_response(self, handler, http_client):
        """Should correctly parse DuckDuckGo API JSON response."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "Abstract": "Python is a programming language.",
            "AbstractURL": "https://en.wikipedia.org/wiki/Python",
            "Heading": "Python",
            "RelatedTopics": [
                {"Text": "Python 3 tutorial", "FirstURL": "https://docs.python.org/3/tutorial/"},
                {"Text": "Learn Python basics", "FirstURL": "https://example.com/learn"},
            ],
        }
        mock_response.raise_for_status = MagicMock()
        http_client.get = AsyncMock(return_value=mock_response)

        results = await handler._search_via_api("python", 5)

        # Abstract should be first
        assert results[0]["title"] == "Python"
        assert results[0]["url"] == "https://en.wikipedia.org/wiki/Python"
        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_api_search_respects_max_results(self, handler, http_client):
        """Should limit results to max_results."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "Abstract": "Test",
            "AbstractURL": "https://example.com",
            "Heading": "Test",
            "RelatedTopics": [
                {"Text": f"Topic {i}", "FirstURL": f"https://example.com/{i}"}
                for i in range(10)
            ],
        }
        mock_response.raise_for_status = MagicMock()
        http_client.get = AsyncMock(return_value=mock_response)

        results = await handler._search_via_api("test", 3)

        assert len(results) == 3
