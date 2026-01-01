"""Anthropic Claude provider implementation."""

import time
from typing import Any, AsyncGenerator

import anthropic
import structlog
# Removed tenacity retry - was causing async issues

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class AnthropicProvider(LLMProvider):
    """Anthropic Claude LLM provider."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.anthropic_timeout,
        )
        self.default_model = settings.anthropic_model
        self.max_tokens = settings.anthropic_max_tokens

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
    ) -> LLMResponse:
        """Generate a response from Claude."""
        start_time = time.time()

        # Check if API key is configured
        if not self.settings.anthropic_api_key:
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
        """Count tokens using Anthropic's tokenizer."""
        try:
            result = await self.client.count_tokens(text)
            return result
        except Exception:
            # Fallback to approximate count
            return len(text) // 4

    def _convert_message(self, message: dict[str, Any]) -> dict[str, Any]:
        """Convert message to Anthropic format."""
        role = message.get("role", "user")

        # Handle tool messages
        if role == "tool":
            return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.get("tool_call_id"),
                        "content": message.get("content", ""),
                    }
                ],
            }

        # Handle assistant messages with tool calls
        if role == "assistant" and message.get("tool_calls"):
            content = []
            if message.get("content"):
                content.append({"type": "text", "text": message["content"]})

            for tool_call in message["tool_calls"]:
                content.append({
                    "type": "tool_use",
                    "id": tool_call["id"],
                    "name": tool_call["name"],
                    "input": tool_call["arguments"],
                })

            return {"role": "assistant", "content": content}

        # Standard message
        return {
            "role": role,
            "content": message.get("content", ""),
        }
