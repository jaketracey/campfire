"""Ollama provider implementation (local/self-hosted LLM)."""

from __future__ import annotations

import time
from typing import Any, AsyncGenerator

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class OllamaProvider(LLMProvider):
    """Ollama LLM provider for local/self-hosted models."""

    def __init__(
        self,
        settings: Settings,
        model_override: str | None = None,
    ):
        """Initialize Ollama provider.

        Args:
            settings: Application settings.
            model_override: Optional model ID to use instead of the default.
                           This allows dynamic model selection for abliterated
                           models like dolphin-llama3:8b or qwen3-abliterated.
        """
        self.settings = settings
        self.base_url = settings.ollama_base_url.rstrip("/")
        self._default_model = settings.ollama_model
        self._model_override = model_override
        self.fallback_model = settings.ollama_fallback_model
        self.max_tokens = settings.ollama_max_tokens
        self.timeout = settings.ollama_timeout

    @property
    def current_model(self) -> str:
        """Return the active model ID (override or default)."""
        return self._model_override or self._default_model

    @property
    def default_model(self) -> str:
        """Return the active model ID for backwards compatibility."""
        return self.current_model

    def with_model(self, model_id: str) -> OllamaProvider:
        """Return a new provider instance configured for a specific model.

        This allows the model router to dynamically select which abliterated
        model to use (e.g., dolphin-llama3:8b vs qwen3-abliterated) for a
        specific request.

        Args:
            model_id: The model ID to use (e.g., "dolphin-llama3:8b").

        Returns:
            A new OllamaProvider instance configured with the specified model.
        """
        return OllamaProvider(
            settings=self.settings,
            model_override=model_id,
        )

    @property
    def name(self) -> str:
        return "ollama"

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
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        """Generate a response from Ollama."""
        start_time = time.time()

        # Convert messages to Ollama/OpenAI format
        ollama_messages = [self._convert_message(msg) for msg in messages]

        # Build request payload
        payload: dict[str, Any] = {
            "model": self.default_model,
            "messages": ollama_messages,
            "stream": False,
            "options": {
                "num_predict": max_tokens or self.max_tokens,
                "temperature": temperature,
                # Repetition penalty to prevent the model from repeating itself
                "repeat_penalty": 1.2,  # Default is 1.1, higher = less repetition
                "repeat_last_n": 128,   # Look back further for repetition (default: 64)
            },
        }

        if stop_sequences:
            payload["options"]["stop"] = stop_sequences

        # Enable JSON mode if requested
        if response_format and response_format.get("type") == "json_object":
            payload["format"] = "json"

        # Note: Ollama tool support varies by model
        if tools and self._model_supports_tools():
            payload["tools"] = self._convert_tools(tools)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()

            latency_ms = (time.time() - start_time) * 1000

            # Extract content
            content = data.get("message", {}).get("content", "")

            # Extract tool calls if present
            tool_calls = []
            message_tool_calls = data.get("message", {}).get("tool_calls", [])
            for tc in message_tool_calls:
                tool_calls.append({
                    "id": tc.get("id", f"call_{time.time()}"),
                    "name": tc.get("function", {}).get("name", ""),
                    "arguments": tc.get("function", {}).get("arguments", {}),
                })

            # Token counts (Ollama provides these)
            prompt_tokens = data.get("prompt_eval_count", 0)
            completion_tokens = data.get("eval_count", 0)

            logger.info(
                "ollama_response",
                model=data.get("model", self.default_model),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=latency_ms,
                tool_calls_count=len(tool_calls),
            )

            return LLMResponse(
                content=content,
                model=data.get("model", self.default_model),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                finish_reason=data.get("done_reason", "stop"),
                tool_calls=tool_calls,
                latency_ms=latency_ms,
                raw_response=data,
            )

        except httpx.HTTPStatusError as e:
            logger.error(
                "ollama_http_error",
                error=str(e),
                status_code=e.response.status_code,
            )
            raise
        except httpx.RequestError as e:
            logger.error(
                "ollama_request_error",
                error=str(e),
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
        """Generate a streaming response from Ollama."""
        # Convert messages to Ollama format
        ollama_messages = [self._convert_message(msg) for msg in messages]

        # Build request payload
        payload: dict[str, Any] = {
            "model": self.default_model,
            "messages": ollama_messages,
            "stream": True,
            "options": {
                "num_predict": max_tokens or self.max_tokens,
                "temperature": temperature,
                # Repetition penalty to prevent the model from repeating itself
                "repeat_penalty": 1.2,
                "repeat_last_n": 128,
            },
        }

        if stop_sequences:
            payload["options"]["stop"] = stop_sequences

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/chat",
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if line:
                            import json
                            try:
                                data = json.loads(line)
                                content = data.get("message", {}).get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue

        except httpx.HTTPStatusError as e:
            logger.error(
                "ollama_stream_error",
                error=str(e),
            )
            raise

    async def count_tokens(self, text: str) -> int:
        """Estimate token count (Ollama doesn't have a tokenizer endpoint)."""
        # Rough estimation: ~4 chars per token for English
        return len(text) // 4

    def _convert_message(self, message: dict[str, Any]) -> dict[str, Any]:
        """Convert message to Ollama format."""
        role = message.get("role", "user")
        content = message.get("content", "")

        # Handle tool results
        if role == "tool":
            return {
                "role": "tool",
                "content": content,
            }

        # Handle assistant messages with tool calls
        if role == "assistant" and message.get("tool_calls"):
            result: dict[str, Any] = {
                "role": "assistant",
                "content": content if content else "",
            }
            # Ollama tool call format
            tool_calls = []
            for tc in message["tool_calls"]:
                tool_calls.append({
                    "id": tc.get("id", ""),
                    "function": {
                        "name": tc["name"],
                        "arguments": tc.get("arguments", {}),
                    },
                })
            result["tool_calls"] = tool_calls
            return result

        # Standard message
        return {
            "role": role,
            "content": content,
        }

    def _convert_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert tools to Ollama format."""
        ollama_tools = []
        for tool in tools:
            ollama_tools.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {}),
                },
            })
        return ollama_tools

    def _model_supports_tools(self) -> bool:
        """Check if current model supports tool calling."""
        # Most abliterated models support tool calling
        tool_capable_models = [
            "llama3",
            "mistral",
            "qwen",
            "dolphin",
        ]
        model_lower = self.current_model.lower()
        return any(m in model_lower for m in tool_capable_models)

    async def health_check(self) -> bool:
        """Check if Ollama is reachable."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception:
            return False
