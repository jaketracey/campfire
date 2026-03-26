"""
Tests for memory_update and memory_delete tool handlers.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import (
    TOOL_REGISTRY,
    ToolCall,
    ToolDefinition,
    ToolType,
)
from orchestrator.tools.handlers import MemoryDeleteHandler, MemoryUpdateHandler
from orchestrator.tools.router import ToolRouter


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        gateway_internal_url="http://gateway:3002",
        internal_service_key="test-key",
    )


@pytest.fixture
def event_emitter():
    """Create a mock event emitter."""
    emitter = AsyncMock(spec=EventEmitter)
    emitter.emit = AsyncMock()
    return emitter


@pytest.fixture
def http_client():
    """Create a mock async HTTP client."""
    client = AsyncMock(spec=httpx.AsyncClient)
    return client


@pytest.fixture
def update_handler(settings, event_emitter, http_client):
    return MemoryUpdateHandler(settings, event_emitter, http_client)


@pytest.fixture
def delete_handler(settings, event_emitter, http_client):
    return MemoryDeleteHandler(settings, event_emitter, http_client)


def _make_tool_call(name: str, arguments: dict) -> ToolCall:
    return ToolCall(
        id="test-call-id",
        name=name,
        arguments=arguments,
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
    )


# ============================================================================
# Tool Definition Tests
# ============================================================================

class TestToolDefinitions:
    """Tests for memory_update and memory_delete tool definitions in TOOL_REGISTRY."""

    def test_memory_update_in_registry(self):
        assert "memory_update" in TOOL_REGISTRY

    def test_memory_delete_in_registry(self):
        assert "memory_delete" in TOOL_REGISTRY

    def test_memory_update_tool_type(self):
        tool = TOOL_REGISTRY["memory_update"]
        assert tool.tool_type == ToolType.MEMORY_UPDATE

    def test_memory_delete_tool_type(self):
        tool = TOOL_REGISTRY["memory_delete"]
        assert tool.tool_type == ToolType.MEMORY_DELETE

    def test_memory_update_required_params(self):
        tool = TOOL_REGISTRY["memory_update"]
        assert tool.required_params == ["memory_id"]

    def test_memory_delete_required_params(self):
        tool = TOOL_REGISTRY["memory_delete"]
        assert tool.required_params == ["memory_id"]

    def test_memory_update_has_all_parameters(self):
        tool = TOOL_REGISTRY["memory_update"]
        assert "memory_id" in tool.parameters
        assert "updated_content" in tool.parameters
        assert "updated_importance" in tool.parameters
        assert "updated_tags" in tool.parameters

    def test_memory_delete_has_all_parameters(self):
        tool = TOOL_REGISTRY["memory_delete"]
        assert "memory_id" in tool.parameters
        assert "reason" in tool.parameters

    def test_memory_update_to_openai_format(self):
        tool = TOOL_REGISTRY["memory_update"]
        openai = tool.to_openai_function()
        assert openai["type"] == "function"
        assert openai["function"]["name"] == "memory_update"
        assert "memory_id" in openai["function"]["parameters"]["properties"]
        assert openai["function"]["parameters"]["required"] == ["memory_id"]

    def test_memory_delete_to_anthropic_format(self):
        tool = TOOL_REGISTRY["memory_delete"]
        anthropic = tool.to_anthropic_tool()
        assert anthropic["name"] == "memory_delete"
        assert "memory_id" in anthropic["input_schema"]["properties"]
        assert anthropic["input_schema"]["required"] == ["memory_id"]

    def test_total_registry_count(self):
        """Ensure adding two tools bumped the count from 15 to 17."""
        assert len(TOOL_REGISTRY) == 17


# ============================================================================
# MemoryUpdateHandler Tests
# ============================================================================

class TestMemoryUpdateHandler:
    def test_name(self, update_handler):
        assert update_handler.name == "memory_update"

    def test_validate_missing_memory_id(self, update_handler):
        ok, err = update_handler.validate_arguments({"updated_content": "hello"})
        assert not ok
        assert "memory_id" in err

    def test_validate_no_update_fields(self, update_handler):
        ok, err = update_handler.validate_arguments({"memory_id": "abc"})
        assert not ok
        assert "At least one" in err

    def test_validate_valid_arguments(self, update_handler):
        ok, err = update_handler.validate_arguments(
            {"memory_id": "abc", "updated_content": "new content"}
        )
        assert ok
        assert err is None

    def test_validate_importance_only(self, update_handler):
        ok, err = update_handler.validate_arguments(
            {"memory_id": "abc", "updated_importance": 0.8}
        )
        assert ok

    def test_validate_tags_only(self, update_handler):
        ok, err = update_handler.validate_arguments(
            {"memory_id": "abc", "updated_tags": ["foo"]}
        )
        assert ok

    @pytest.mark.asyncio
    async def test_execute_success(self, update_handler, http_client, event_emitter):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"success": True, "data": {"id": "mem-1"}}
        http_client.patch = AsyncMock(return_value=mock_response)

        tool_call = _make_tool_call("memory_update", {
            "memory_id": "mem-1",
            "updated_content": "User's favorite color is now green",
        })

        result = await update_handler.execute(tool_call)

        assert result.success
        assert "mem-1" in result.output
        assert result.metadata["memory_id"] == "mem-1"
        http_client.patch.assert_called_once()
        event_emitter.emit.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_sends_correct_payload(self, update_handler, http_client):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"success": True}
        http_client.patch = AsyncMock(return_value=mock_response)

        tool_call = _make_tool_call("memory_update", {
            "memory_id": "mem-1",
            "updated_content": "new content",
            "updated_importance": 0.9,
        })

        await update_handler.execute(tool_call)

        call_args = http_client.patch.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "/memories/internal/mem-1" in url
        json_body = call_args.kwargs.get("json") or call_args[1].get("json", {})
        assert json_body["content"] == "new content"
        assert json_body["importance"] == 0.9

    @pytest.mark.asyncio
    async def test_execute_http_error(self, update_handler, http_client):
        http_client.patch = AsyncMock(side_effect=httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=MagicMock(status_code=404)
        ))

        tool_call = _make_tool_call("memory_update", {
            "memory_id": "nonexistent",
            "updated_content": "test",
        })

        result = await update_handler.execute(tool_call)

        assert not result.success
        assert result.error is not None


# ============================================================================
# MemoryDeleteHandler Tests
# ============================================================================

class TestMemoryDeleteHandler:
    def test_name(self, delete_handler):
        assert delete_handler.name == "memory_delete"

    def test_validate_missing_memory_id(self, delete_handler):
        ok, err = delete_handler.validate_arguments({})
        assert not ok
        assert "memory_id" in err

    def test_validate_valid_arguments(self, delete_handler):
        ok, err = delete_handler.validate_arguments({"memory_id": "abc"})
        assert ok
        assert err is None

    def test_validate_with_reason(self, delete_handler):
        ok, err = delete_handler.validate_arguments(
            {"memory_id": "abc", "reason": "user corrected info"}
        )
        assert ok

    @pytest.mark.asyncio
    async def test_execute_success(self, delete_handler, http_client, event_emitter):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"success": True, "data": {"id": "mem-1", "deleted": True}}
        http_client.delete = AsyncMock(return_value=mock_response)

        tool_call = _make_tool_call("memory_delete", {
            "memory_id": "mem-1",
            "reason": "User said this was wrong",
        })

        result = await delete_handler.execute(tool_call)

        assert result.success
        assert "mem-1" in result.output
        assert result.metadata["memory_id"] == "mem-1"
        assert result.metadata["reason"] == "User said this was wrong"
        http_client.delete.assert_called_once()
        event_emitter.emit.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_sends_query_params(self, delete_handler, http_client):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"success": True}
        http_client.delete = AsyncMock(return_value=mock_response)

        tool_call = _make_tool_call("memory_delete", {"memory_id": "mem-1"})

        await delete_handler.execute(tool_call)

        call_args = http_client.delete.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "/memories/internal/mem-1" in url
        params = call_args.kwargs.get("params", {})
        assert params["userId"] == str(tool_call.user_id)
        assert params["companionId"] == str(tool_call.companion_id)

    @pytest.mark.asyncio
    async def test_execute_default_reason(self, delete_handler, http_client, event_emitter):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"success": True}
        http_client.delete = AsyncMock(return_value=mock_response)

        tool_call = _make_tool_call("memory_delete", {"memory_id": "mem-1"})

        result = await delete_handler.execute(tool_call)

        assert result.success
        assert result.metadata["reason"] == ""

    @pytest.mark.asyncio
    async def test_execute_http_error(self, delete_handler, http_client):
        http_client.delete = AsyncMock(side_effect=httpx.HTTPStatusError(
            "Server Error", request=MagicMock(), response=MagicMock(status_code=500)
        ))

        tool_call = _make_tool_call("memory_delete", {"memory_id": "bad-id"})

        result = await delete_handler.execute(tool_call)

        assert not result.success
        assert result.error is not None


# ============================================================================
# ToolRouter Registration Tests
# ============================================================================

class TestToolRouterRegistration:
    def test_memory_update_registered_in_router(self, settings, event_emitter):
        http_client = AsyncMock(spec=httpx.AsyncClient)
        router = ToolRouter(settings, event_emitter, http_client)
        assert router.get_handler("memory_update") is not None

    def test_memory_delete_registered_in_router(self, settings, event_emitter):
        http_client = AsyncMock(spec=httpx.AsyncClient)
        router = ToolRouter(settings, event_emitter, http_client)
        assert router.get_handler("memory_delete") is not None

    def test_memory_update_handler_type(self, settings, event_emitter):
        http_client = AsyncMock(spec=httpx.AsyncClient)
        router = ToolRouter(settings, event_emitter, http_client)
        handler = router.get_handler("memory_update")
        assert isinstance(handler, MemoryUpdateHandler)

    def test_memory_delete_handler_type(self, settings, event_emitter):
        http_client = AsyncMock(spec=httpx.AsyncClient)
        router = ToolRouter(settings, event_emitter, http_client)
        handler = router.get_handler("memory_delete")
        assert isinstance(handler, MemoryDeleteHandler)

    def test_all_tools_in_router_list(self, settings, event_emitter):
        http_client = AsyncMock(spec=httpx.AsyncClient)
        router = ToolRouter(settings, event_emitter, http_client)
        available = router.list_available_tools()
        assert "memory_update" in available
        assert "memory_delete" in available
