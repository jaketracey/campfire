"""AWS Bedrock LLM provider implementation.

Supports multiple model families available on Bedrock:
- Claude (Anthropic)
- Llama (Meta)
- Mistral
- Titan (Amazon)
"""

from __future__ import annotations

import json
import time
from enum import Enum
from typing import Any, AsyncGenerator

import aioboto3
import structlog
from botocore.config import Config as BotoConfig

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class BedrockModelFamily(str, Enum):
    """Supported model families on Bedrock."""

    CLAUDE = "claude"
    LLAMA = "llama"
    MISTRAL = "mistral"
    TITAN = "titan"

    @classmethod
    def detect(cls, model_id: str) -> BedrockModelFamily:
        """Detect model family from model ID."""
        model_lower = model_id.lower()
        if "claude" in model_lower or "anthropic" in model_lower:
            return cls.CLAUDE
        elif "llama" in model_lower or "meta" in model_lower:
            return cls.LLAMA
        elif "mistral" in model_lower:
            return cls.MISTRAL
        elif "titan" in model_lower or "amazon" in model_lower:
            return cls.TITAN
        # Default to Claude format
        return cls.CLAUDE


# Bedrock model pricing per 1M tokens (input, output)
BEDROCK_PRICING: dict[str, tuple[float, float]] = {
    # Claude models
    "anthropic.claude-3-5-sonnet": (3.0, 15.0),
    "anthropic.claude-3-5-haiku": (0.80, 4.0),
    "anthropic.claude-3-haiku": (0.25, 1.25),
    "anthropic.claude-3-opus": (15.0, 75.0),
    "anthropic.claude-3-sonnet": (3.0, 15.0),
    # Llama models
    "meta.llama3-1-405b": (5.32, 16.0),
    "meta.llama3-1-70b": (0.99, 0.99),
    "meta.llama3-1-8b": (0.22, 0.22),
    "meta.llama3-2-90b": (2.0, 2.0),
    "meta.llama3-2-11b": (0.35, 0.35),
    "meta.llama3-2-3b": (0.15, 0.15),
    "meta.llama3-2-1b": (0.10, 0.10),
    # Mistral models
    "mistral.mistral-large": (4.0, 12.0),
    "mistral.mistral-small": (1.0, 3.0),
    "mistral.mixtral-8x7b": (0.45, 0.70),
    # Amazon Titan
    "amazon.titan-text-premier": (0.50, 1.50),
    "amazon.titan-text-express": (0.20, 0.60),
    "amazon.titan-text-lite": (0.15, 0.20),
}


class BedrockProvider(LLMProvider):
    """AWS Bedrock LLM provider.

    Supports all foundation models available on Bedrock through
    the unified Converse API.
    """

    def __init__(
        self,
        settings: Settings,
        model_override: str | None = None,
    ):
        """Initialize Bedrock provider.

        Args:
            settings: Application settings.
            model_override: Optional model ID to use instead of the default.
        """
        self.settings = settings
        self._default_model = settings.bedrock_default_model
        self._model_override = model_override
        self.max_tokens = settings.bedrock_max_tokens
        self.timeout = settings.bedrock_timeout
        self._region = settings.aws_region

        # Configure boto3 with retries and timeouts
        self._boto_config = BotoConfig(
            retries={"max_attempts": 3, "mode": "adaptive"},
            connect_timeout=10,
            read_timeout=int(self.timeout),
        )

        # Create aioboto3 session
        session_kwargs: dict[str, Any] = {"region_name": self._region}
        if settings.aws_access_key_id:
            session_kwargs["aws_access_key_id"] = settings.aws_access_key_id
        if settings.aws_secret_access_key:
            session_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.aws_session_token:
            session_kwargs["aws_session_token"] = settings.aws_session_token

        self._session = aioboto3.Session(**session_kwargs)

    @property
    def name(self) -> str:
        return "bedrock"

    @property
    def current_model(self) -> str:
        """Return the active model ID (override or default)."""
        return self._model_override or self._default_model

    def with_model(self, model_id: str) -> BedrockProvider:
        """Return a new provider instance configured for a specific model.

        Args:
            model_id: The Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0").

        Returns:
            A new BedrockProvider instance configured with the specified model.
        """
        return BedrockProvider(
            settings=self.settings,
            model_override=model_id,
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
        """Generate a response from Bedrock.

        Uses the Converse API for unified message format across all models.
        """
        start_time = time.time()
        model_id = self.current_model
        model_family = BedrockModelFamily.detect(model_id)

        # Convert messages to Bedrock Converse format
        system_prompt, bedrock_messages = self._convert_messages(messages)

        # Build request parameters
        params: dict[str, Any] = {
            "modelId": model_id,
            "messages": bedrock_messages,
            "inferenceConfig": {
                "maxTokens": max_tokens or self.max_tokens,
                "temperature": temperature,
            },
        }

        if system_prompt:
            params["system"] = [{"text": system_prompt}]

        if tools:
            params["toolConfig"] = {"tools": self._convert_tools(tools)}

        if stop_sequences:
            params["inferenceConfig"]["stopSequences"] = stop_sequences

        async with self._session.client(
            "bedrock-runtime",
            region_name=self._region,
            config=self._boto_config,
        ) as client:
            try:
                response = await client.converse(**params)

                latency_ms = (time.time() - start_time) * 1000

                # Extract content and tool calls
                content = ""
                tool_calls = []

                output_message = response.get("output", {}).get("message", {})
                for block in output_message.get("content", []):
                    if "text" in block:
                        content += block["text"]
                    elif "toolUse" in block:
                        tool_use = block["toolUse"]
                        tool_calls.append({
                            "id": tool_use.get("toolUseId"),
                            "name": tool_use.get("name"),
                            "arguments": tool_use.get("input", {}),
                        })

                # Extract usage
                usage = response.get("usage", {})
                input_tokens = usage.get("inputTokens", 0)
                output_tokens = usage.get("outputTokens", 0)

                # Calculate cost
                cost_usd = self._calculate_cost(model_id, input_tokens, output_tokens)

                logger.info(
                    "bedrock_response",
                    model=model_id,
                    model_family=model_family.value,
                    prompt_tokens=input_tokens,
                    completion_tokens=output_tokens,
                    latency_ms=latency_ms,
                    cost_usd=cost_usd,
                    tool_calls_count=len(tool_calls),
                )

                return LLMResponse(
                    content=content,
                    model=model_id,
                    prompt_tokens=input_tokens,
                    completion_tokens=output_tokens,
                    finish_reason=response.get("stopReason", "end_turn"),
                    tool_calls=tool_calls,
                    latency_ms=latency_ms,
                    raw_response=response,
                )

            except Exception as e:
                logger.error(
                    "bedrock_api_error",
                    error=str(e),
                    model=model_id,
                    error_type=type(e).__name__,
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
        """Generate a streaming response from Bedrock.

        Uses the ConverseStream API.
        """
        model_id = self.current_model

        # Convert messages to Bedrock format
        system_prompt, bedrock_messages = self._convert_messages(messages)

        # Build request parameters
        params: dict[str, Any] = {
            "modelId": model_id,
            "messages": bedrock_messages,
            "inferenceConfig": {
                "maxTokens": max_tokens or self.max_tokens,
                "temperature": temperature,
            },
        }

        if system_prompt:
            params["system"] = [{"text": system_prompt}]

        if tools:
            params["toolConfig"] = {"tools": self._convert_tools(tools)}

        if stop_sequences:
            params["inferenceConfig"]["stopSequences"] = stop_sequences

        async with self._session.client(
            "bedrock-runtime",
            region_name=self._region,
            config=self._boto_config,
        ) as client:
            try:
                response = await client.converse_stream(**params)

                async for event in response.get("stream", []):
                    if "contentBlockDelta" in event:
                        delta = event["contentBlockDelta"].get("delta", {})
                        if "text" in delta:
                            yield delta["text"]

            except Exception as e:
                logger.error(
                    "bedrock_stream_error",
                    error=str(e),
                    model=model_id,
                )
                raise

    async def count_tokens(self, text: str) -> int:
        """Estimate token count.

        Bedrock doesn't provide a tokenizer endpoint, so we estimate.
        Uses ~4 characters per token as a rough approximation.
        """
        return len(text) // 4

    def _convert_messages(
        self, messages: list[dict[str, Any]]
    ) -> tuple[str, list[dict[str, Any]]]:
        """Convert messages to Bedrock Converse format.

        Args:
            messages: List of messages in standard format.

        Returns:
            Tuple of (system_prompt, converted_messages).
        """
        system_prompt = ""
        bedrock_messages = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "system":
                system_prompt = content if isinstance(content, str) else ""
                continue

            converted = self._convert_single_message(msg)
            if converted:
                bedrock_messages.append(converted)

        return system_prompt, bedrock_messages

    def _convert_single_message(self, message: dict[str, Any]) -> dict[str, Any] | None:
        """Convert a single message to Bedrock format."""
        role = message.get("role", "user")
        content = message.get("content", "")

        # Skip system messages (handled separately)
        if role == "system":
            return None

        # Handle tool result messages
        if role == "tool":
            return {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": message.get("tool_call_id"),
                            "content": [{"text": content if isinstance(content, str) else ""}],
                        }
                    }
                ],
            }

        # Handle assistant messages with tool calls
        if role == "assistant" and message.get("tool_calls"):
            result_content = []
            if content and isinstance(content, str):
                result_content.append({"text": content})

            for tool_call in message["tool_calls"]:
                result_content.append({
                    "toolUse": {
                        "toolUseId": tool_call["id"],
                        "name": tool_call["name"],
                        "input": tool_call["arguments"],
                    }
                })

            return {"role": "assistant", "content": result_content}

        # Handle multimodal content (list of content blocks)
        if isinstance(content, list):
            bedrock_content = []
            for block in content:
                if block.get("type") == "text":
                    bedrock_content.append({"text": block.get("text", "")})
                elif block.get("type") == "image":
                    # Handle base64 images
                    source = block.get("source", {})
                    if source.get("type") == "base64":
                        bedrock_content.append({
                            "image": {
                                "format": source.get("media_type", "image/png").split("/")[-1],
                                "source": {"bytes": source.get("data", "")},
                            }
                        })
            return {"role": role, "content": bedrock_content}

        # Standard text message
        return {"role": role, "content": [{"text": content}]}

    def _convert_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert tools to Bedrock format."""
        bedrock_tools = []
        for tool in tools:
            bedrock_tools.append({
                "toolSpec": {
                    "name": tool.get("name"),
                    "description": tool.get("description", ""),
                    "inputSchema": {
                        "json": tool.get("input_schema", tool.get("parameters", {}))
                    },
                }
            })
        return bedrock_tools

    def _calculate_cost(
        self, model_id: str, input_tokens: int, output_tokens: int
    ) -> float:
        """Calculate cost based on Bedrock pricing.

        Args:
            model_id: The model ID used.
            input_tokens: Number of input tokens.
            output_tokens: Number of output tokens.

        Returns:
            Estimated cost in USD.
        """
        # Find matching pricing
        for prefix, (input_price, output_price) in BEDROCK_PRICING.items():
            if model_id.lower().startswith(prefix):
                input_cost = (input_tokens / 1_000_000) * input_price
                output_cost = (output_tokens / 1_000_000) * output_price
                return input_cost + output_cost

        # Default pricing if model not found
        return (input_tokens + output_tokens) / 1_000_000 * 1.0

    async def health_check(self) -> bool:
        """Check if Bedrock is reachable and configured."""
        try:
            async with self._session.client(
                "bedrock",
                region_name=self._region,
                config=self._boto_config,
            ) as client:
                # List foundation models to verify access
                await client.list_foundation_models(byOutputModality="TEXT")
                return True
        except Exception as e:
            logger.warning("bedrock_health_check_failed", error=str(e))
            return False
