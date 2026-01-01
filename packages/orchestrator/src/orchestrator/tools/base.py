"""Base classes for tool handlers."""

from abc import ABC, abstractmethod
from typing import Any

from orchestrator.models.tools import ToolCall, ToolResult


class ToolHandler(ABC):
    """Abstract base class for tool handlers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The name of the tool this handler processes."""
        ...

    @abstractmethod
    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute the tool call and return a result."""
        ...

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate tool arguments. Override for custom validation."""
        return True, None
