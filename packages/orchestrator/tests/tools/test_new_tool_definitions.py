"""
Tests for new tool definitions and registry integration.

Verifies that web_search and relationship_analytics are correctly
defined, registered, and produce valid Anthropic/OpenAI tool schemas.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

import httpx

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import (
    TOOL_REGISTRY,
    WEB_SEARCH_TOOL,
    RELATIONSHIP_ANALYTICS_TOOL,
    ToolType,
)
from orchestrator.tools.router import ToolRouter


class TestWebSearchToolDefinition:
    """Tests for the web_search tool definition."""

    def test_registered_in_registry(self):
        """web_search should be in the TOOL_REGISTRY."""
        assert "web_search" in TOOL_REGISTRY

    def test_correct_tool_type(self):
        """web_search should have WEB_SEARCH tool type."""
        assert WEB_SEARCH_TOOL.tool_type == ToolType.WEB_SEARCH

    def test_required_params(self):
        """query should be required."""
        assert "query" in WEB_SEARCH_TOOL.required_params

    def test_parameters_schema(self):
        """Should have query and max_results parameters."""
        assert "query" in WEB_SEARCH_TOOL.parameters
        assert WEB_SEARCH_TOOL.parameters["query"]["type"] == "string"
        assert "max_results" in WEB_SEARCH_TOOL.parameters
        assert WEB_SEARCH_TOOL.parameters["max_results"]["type"] == "integer"

    def test_to_anthropic_tool_format(self):
        """Should produce valid Anthropic tool format."""
        tool = WEB_SEARCH_TOOL.to_anthropic_tool()
        assert tool["name"] == "web_search"
        assert "description" in tool
        assert tool["input_schema"]["type"] == "object"
        assert "query" in tool["input_schema"]["properties"]
        assert tool["input_schema"]["required"] == ["query"]

    def test_to_openai_function_format(self):
        """Should produce valid OpenAI function format."""
        func = WEB_SEARCH_TOOL.to_openai_function()
        assert func["type"] == "function"
        assert func["function"]["name"] == "web_search"
        assert "query" in func["function"]["parameters"]["properties"]

    def test_timeout(self):
        """web_search should have a reasonable timeout."""
        assert WEB_SEARCH_TOOL.timeout_seconds == 15.0

    def test_no_confirmation_required(self):
        """web_search should not require confirmation."""
        assert WEB_SEARCH_TOOL.requires_confirmation is False


class TestRelationshipAnalyticsToolDefinition:
    """Tests for the relationship_analytics tool definition."""

    def test_registered_in_registry(self):
        """relationship_analytics should be in the TOOL_REGISTRY."""
        assert "relationship_analytics" in TOOL_REGISTRY

    def test_correct_tool_type(self):
        """relationship_analytics should have RELATIONSHIP_ANALYTICS tool type."""
        assert RELATIONSHIP_ANALYTICS_TOOL.tool_type == ToolType.RELATIONSHIP_ANALYTICS

    def test_required_params(self):
        """companion_id and analysis_type should be required."""
        assert "companion_id" in RELATIONSHIP_ANALYTICS_TOOL.required_params
        assert "analysis_type" in RELATIONSHIP_ANALYTICS_TOOL.required_params

    def test_analysis_type_enum(self):
        """analysis_type should have correct enum values."""
        enum_values = RELATIONSHIP_ANALYTICS_TOOL.parameters["analysis_type"]["enum"]
        assert "summary" in enum_values
        assert "emotional_trajectory" in enum_values
        assert "topic_history" in enum_values
        assert "interaction_stats" in enum_values

    def test_to_anthropic_tool_format(self):
        """Should produce valid Anthropic tool format."""
        tool = RELATIONSHIP_ANALYTICS_TOOL.to_anthropic_tool()
        assert tool["name"] == "relationship_analytics"
        assert tool["input_schema"]["type"] == "object"
        assert "companion_id" in tool["input_schema"]["properties"]
        assert "analysis_type" in tool["input_schema"]["properties"]

    def test_to_openai_function_format(self):
        """Should produce valid OpenAI function format."""
        func = RELATIONSHIP_ANALYTICS_TOOL.to_openai_function()
        assert func["type"] == "function"
        assert func["function"]["name"] == "relationship_analytics"


class TestToolRouterRegistration:
    """Tests for tool registration in the ToolRouter."""

    @pytest.fixture
    def router(self):
        """Create a ToolRouter with mock dependencies."""
        settings = Settings()
        event_emitter = AsyncMock(spec=EventEmitter)
        event_emitter.emit = AsyncMock()
        http_client = AsyncMock(spec=httpx.AsyncClient)
        return ToolRouter(settings, event_emitter, http_client)

    def test_web_search_handler_registered(self, router):
        """ToolRouter should have a web_search handler."""
        handler = router.get_handler("web_search")
        assert handler is not None
        assert handler.name == "web_search"

    def test_relationship_analytics_handler_registered(self, router):
        """ToolRouter should have a relationship_analytics handler."""
        handler = router.get_handler("relationship_analytics")
        assert handler is not None
        assert handler.name == "relationship_analytics"

    def test_new_tools_in_available_list(self, router):
        """New tools should appear in available tools list."""
        available = router.list_available_tools()
        assert "web_search" in available
        assert "relationship_analytics" in available

    def test_total_tool_count(self, router):
        """Router should have 17 tools (15 original + 2 new)."""
        available = router.list_available_tools()
        assert len(available) == 17


class TestRegistryCompleteness:
    """Tests to ensure TOOL_REGISTRY and router stay in sync."""

    def test_registry_has_17_tools(self):
        """TOOL_REGISTRY should have 17 tools."""
        assert len(TOOL_REGISTRY) == 17

    def test_all_registry_tools_have_names(self):
        """All tools in registry should have matching key and name."""
        for key, tool_def in TOOL_REGISTRY.items():
            assert key == tool_def.name, f"Key {key} != tool name {tool_def.name}"

    def test_all_tools_have_descriptions(self):
        """All tools should have non-empty descriptions."""
        for key, tool_def in TOOL_REGISTRY.items():
            assert tool_def.description, f"Tool {key} has no description"

    def test_all_tools_produce_valid_anthropic_format(self):
        """All tools should produce valid Anthropic tool format."""
        for key, tool_def in TOOL_REGISTRY.items():
            tool = tool_def.to_anthropic_tool()
            assert "name" in tool, f"Tool {key} missing name in Anthropic format"
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"
