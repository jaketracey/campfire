"""OpenAI provider implementation (fallback LLM)."""

import time
from typing import Any, AsyncGenerator

import openai
import structlog
import tiktoken
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class OpenAIProvider(LLMProvider):
    """OpenAI LLM provider (fallback)."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = openai.AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.openai_timeout,
        )
        self.default_model = settings.openai_model
        self.max_tokens = settings.openai_max_tokens
        self._tokenizer = tiktoken.get_encoding("cl100k_base")

    @property
    def name(self) -> str:
        return "openai"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def generate(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        stop_sequences: list[str] | None = None,
    ) -> LLMResponse:
        """Generate a response from OpenAI."""
        start_time = time.time()

        # Convert messages to OpenAI format
        openai_messages = [self._convert_message(msg) for msg in messages]

        # Build request parameters
        params: dict[str, Any] = {
            "model": self.default_model,
            "max_tokens": max_tokens or self.max_tokens,
            "temperature": temperature,
            "messages": openai_messages,
        }

        if tools:
            params["tools"] = self._convert_tools(tools)
            params["tool_choice"] = "auto"

        if stop_sequences:
            params["stop"] = stop_sequences

        try:
            response = await self.client.chat.completions.create(**params)

            latency_ms = (time.time() - start_time) * 1000

            # Extract content and tool calls
            message = response.choices[0].message
            content = message.content or ""
            tool_calls = []

            if message.tool_calls:
                for tc in message.tool_calls:
                    tool_calls.append({
                        "id": tc.id,
                        "name": tc.function.name,
                        "arguments": self._parse_arguments(tc.function.arguments),
                    })

            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0

            logger.info(
                "openai_response",
                model=response.model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=latency_ms,
                tool_calls_count=len(tool_calls),
            )

            return LLMResponse(
                content=content,
                model=response.model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                finish_reason=response.choices[0].finish_reason or "stop",
                tool_calls=tool_calls,
                latency_ms=latency_ms,
                raw_response=response.model_dump(),
            )

        except openai.APIError as e:
            logger.error(
                "openai_api_error",
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
        """Generate a streaming response from OpenAI."""
        # Convert messages to OpenAI format
        openai_messages = [self._convert_message(msg) for msg in messages]

        # Build request parameters
        params: dict[str, Any] = {
            "model": self.default_model,
            "max_tokens": max_tokens or self.max_tokens,
            "temperature": temperature,
            "messages": openai_messages,
            "stream": True,
        }

        if tools:
            params["tools"] = self._convert_tools(tools)
            params["tool_choice"] = "auto"

        if stop_sequences:
            params["stop"] = stop_sequences

        try:
            stream = await self.client.chat.completions.create(**params)

            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except openai.APIError as e:
            logger.error(
                "openai_stream_error",
                error=str(e),
            )
            raise

    async def count_tokens(self, text: str) -> int:
        """Count tokens using tiktoken."""
        return len(self._tokenizer.encode(text))

    def _convert_message(self, message: dict[str, Any]) -> dict[str, Any]:
        """Convert message to OpenAI format."""
        role = message.get("role", "user")
        content = message.get("content", "")

        # Handle tool results
        if role == "tool":
            return {
                "role": "tool",
                "tool_call_id": message.get("tool_call_id", ""),
                "content": content,
            }

        # Handle assistant messages with tool calls
        if role == "assistant" and message.get("tool_calls"):
            result: dict[str, Any] = {
                "role": "assistant",
                "content": content if content else None,
            }

            tool_calls = []
            for tc in message["tool_calls"]:
                tool_calls.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": (
                            tc["arguments"]
                            if isinstance(tc["arguments"], str)
                            else str(tc["arguments"])
                        ),
                    },
                })

            result["tool_calls"] = tool_calls
            return result

        # Standard message
        return {
            "role": role,
            "content": content,
        }

    def _convert_tools(
        self,
        tools: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Convert Anthropic tool format to OpenAI format."""
        openai_tools = []
        for tool in tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {}),
                },
            })
        return openai_tools

    def _parse_arguments(self, arguments: str) -> dict[str, Any]:
        """Parse tool call arguments from JSON string."""
        import json

        try:
            return json.loads(arguments)
        except json.JSONDecodeError:
            logger.warning("failed_to_parse_tool_arguments", arguments=arguments)
            return {}
