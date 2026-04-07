"""Anthropic Claude provider implementation."""

from __future__ import annotations

import time
from typing import Any, AsyncGenerator

import anthropic
import structlog

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class AnthropicProvider(LLMProvider):
    """Anthropic Claude LLM provider."""

    def __init__(
        self,
        settings: Settings,
        model_override: str | None = None,
        api_key_override: str | None = None,
    ):
        """Initialize Anthropic provider.

        Args:
            settings: Application settings.
            model_override: Optional model ID to use instead of the default.
            api_key_override: Optional API key to use instead of settings.
        """
        self.settings = settings
        self._api_key = api_key_override or settings.anthropic_api_key
        self.client = anthropic.AsyncAnthropic(
            api_key=self._api_key,
            timeout=settings.anthropic_timeout,
        )
        self._default_model = settings.anthropic_model
        self._model_override = model_override
        self.max_tokens = settings.anthropic_max_tokens

    @property
    def current_model(self) -> str:
        """Return the active model ID (override or default)."""
        return self._model_override or self._default_model

    @property
    def default_model(self) -> str:
        """Return the active model ID for backwards compatibility."""
        return self.current_model

    def with_model(self, model_id: str) -> AnthropicProvider:
        """Return a new provider instance configured for a specific model.

        Args:
            model_id: The model ID to use (e.g., "claude-sonnet-4-20250514").

        Returns:
            A new AnthropicProvider instance configured with the specified model.
        """
        return AnthropicProvider(
            settings=self.settings,
            model_override=model_id,
            api_key_override=self._api_key,
        )

    @property
    def name(self) -> str:
        return "anthropic"

    async def generate(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        stop_sequences: list[str] | None = None,
        response_format: dict[str, str] | None = None,  # Not used by Anthropic
    ) -> LLMResponse:
        """Generate a response from Claude."""
        start_time = time.time()

        # Check if API key is configured
        if not self._api_key:
            raise ValueError("Anthropic API key not configured")

        # Extract system message
        system_content = ""
        chat_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_content = msg.get("content", "")
            else:
                chat_messages.append(self._convert_message(msg))

        # Build request parameters
        params: dict[str, Any] = {
            "model": self.default_model,
            "max_tokens": max_tokens or self.max_tokens,
            "temperature": temperature,
            "messages": chat_messages,
        }

        if system_content:
            params["system"] = system_content

        if tools:
            params["tools"] = tools

        if stop_sequences:
            params["stop_sequences"] = stop_sequences

        try:
            response = await self.client.messages.create(**params)

            latency_ms = (time.time() - start_time) * 1000

            # Extract content and tool calls
            content = ""
            tool_calls = []

            for block in response.content:
                if block.type == "text":
                    content += block.text
                elif block.type == "tool_use":
                    tool_calls.append({
                        "id": block.id,
                        "name": block.name,
                        "arguments": block.input,
                    })

            logger.info(
                "anthropic_response",
                model=response.model,
                prompt_tokens=response.usage.input_tokens,
                completion_tokens=response.usage.output_tokens,
                latency_ms=latency_ms,
                tool_calls_count=len(tool_calls),
            )

            return LLMResponse(
                content=content,
                model=response.model,
                prompt_tokens=response.usage.input_tokens,
                completion_tokens=response.usage.output_tokens,
                finish_reason=response.stop_reason or "end_turn",
                tool_calls=tool_calls,
                latency_ms=latency_ms,
                raw_response=response.model_dump(),
            )

        except anthropic.APIError as e:
            logger.error(
                "anthropic_api_error",
                error=str(e),
                status_code=getattr(e, "status_code", None),
            )
            raise

    async def generate_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        stop_sequences: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response from Claude."""
        # Extract system message
        system_content = ""
        chat_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_content = msg.get("content", "")
            else:
                chat_messages.append(self._convert_message(msg))

        # Build request parameters
        params: dict[str, Any] = {
            "model": self.default_model,
            "max_tokens": max_tokens or self.max_tokens,
            "temperature": temperature,
            "messages": chat_messages,
        }

        if system_content:
            params["system"] = system_content

        if tools:
            params["tools"] = tools

        if stop_sequences:
            params["stop_sequences"] = stop_sequences

        try:
            async with self.client.messages.stream(**params) as stream:
                async for text in stream.text_stream:
                    yield text

        except anthropic.APIError as e:
            logger.error(
                "anthropic_stream_error",
                error=str(e),
            )
            raise

    async def count_tokens(self, text: str) -> int:
        """Count tokens using Anthropic's token counting API.

        Uses the messages.count_tokens endpoint for accurate counts.
        Falls back to approximate count on error.
        """
        try:
            result = await self.client.messages.count_tokens(
                messages=[{"role": "user", "content": text}],
                model=self.current_model,
            )
            return result.input_tokens
        except Exception:
            # Fallback to approximate count
            return len(text) // 4

    def _convert_message(self, message: dict[str, Any]) -> dict[str, Any]:
        """Convert message to Anthropic format."""
        role = message.get("role", "user")
        content = message.get("content", "")

        # Handle tool messages
        if role == "tool":
            return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.get("tool_call_id"),
                        "content": content if isinstance(content, str) else "",
                    }
                ],
            }

        # Handle assistant messages with tool calls
        if role == "assistant" and message.get("tool_calls"):
            result_content = []
            if content and isinstance(content, str):
                result_content.append({"type": "text", "text": content})

            for tool_call in message["tool_calls"]:
                result_content.append({
                    "type": "tool_use",
                    "id": tool_call["id"],
                    "name": tool_call["name"],
                    "input": tool_call["arguments"],
                })

            return {"role": "assistant", "content": result_content}

        # Handle multimodal content (already in Anthropic format - list of content blocks)
        # This handles webcam images and other multimodal content
        if isinstance(content, list):
            return {"role": role, "content": content}

        # Standard text message
        return {
            "role": role,
            "content": content,
        }
