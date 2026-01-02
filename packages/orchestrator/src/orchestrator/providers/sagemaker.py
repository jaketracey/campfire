"""AWS SageMaker LLM provider implementation.

Supports custom fine-tuned models deployed on SageMaker endpoints.
Common formats supported:
- HuggingFace TGI (Text Generation Inference)
- vLLM
- Custom model formats
"""

from __future__ import annotations

import json
import time
from typing import Any, AsyncGenerator

import aioboto3
import structlog
from botocore.config import Config as BotoConfig

from orchestrator.config import Settings
from orchestrator.providers.base import LLMProvider, LLMResponse

logger = structlog.get_logger()


class SageMakerProvider(LLMProvider):
    """AWS SageMaker LLM provider for custom/fine-tuned models.

    Invokes SageMaker endpoints hosting custom models.
    Supports HuggingFace TGI and similar inference formats.
    """

    def __init__(
        self,
        settings: Settings,
        endpoint_override: str | None = None,
    ):
        """Initialize SageMaker provider.

        Args:
            settings: Application settings.
            endpoint_override: Optional endpoint name to use instead of the default.
        """
        self.settings = settings
        self._default_endpoint = settings.sagemaker_endpoint_name
        self._endpoint_override = endpoint_override
        self.max_tokens = settings.sagemaker_max_tokens
        self.timeout = settings.sagemaker_timeout
        self._content_type = settings.sagemaker_content_type
        self._accept = settings.sagemaker_accept
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
        return "sagemaker"

    @property
    def current_model(self) -> str:
        """Return the active endpoint name as model identifier."""
        return self._endpoint_override or self._default_endpoint

    def with_model(self, model_id: str) -> SageMakerProvider:
        """Return a new provider instance with specified endpoint.

        Args:
            model_id: The SageMaker endpoint name.

        Returns:
            A new SageMakerProvider instance configured with the specified endpoint.
        """
        return SageMakerProvider(
            settings=self.settings,
            endpoint_override=model_id,
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
        """Generate a response from SageMaker endpoint."""
        start_time = time.time()
        endpoint_name = self.current_model

        if not endpoint_name:
            raise ValueError("SageMaker endpoint name not configured")

        # Build request payload (HuggingFace TGI format)
        payload = self._build_request_payload(
            messages=messages,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature,
            stop_sequences=stop_sequences,
        )

        async with self._session.client(
            "sagemaker-runtime",
            region_name=self._region,
            config=self._boto_config,
        ) as client:
            try:
                response = await client.invoke_endpoint(
                    EndpointName=endpoint_name,
                    ContentType=self._content_type,
                    Accept=self._accept,
                    Body=json.dumps(payload),
                )

                # Read response body
                response_bytes = await response["Body"].read()
                response_body = json.loads(response_bytes)

                latency_ms = (time.time() - start_time) * 1000

                # Parse response based on format
                content, usage = self._parse_response(response_body)

                logger.info(
                    "sagemaker_response",
                    endpoint=endpoint_name,
                    prompt_tokens=usage.get("input_tokens", 0),
                    completion_tokens=usage.get("output_tokens", 0),
                    latency_ms=latency_ms,
                )

                return LLMResponse(
                    content=content,
                    model=endpoint_name,
                    prompt_tokens=usage.get("input_tokens", 0),
                    completion_tokens=usage.get("output_tokens", 0),
                    finish_reason=usage.get("stop_reason", "stop"),
                    tool_calls=[],  # SageMaker endpoints typically don't support tools
                    latency_ms=latency_ms,
                    raw_response=response_body,
                )

            except Exception as e:
                logger.error(
                    "sagemaker_api_error",
                    error=str(e),
                    endpoint=endpoint_name,
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
        """Generate streaming response from SageMaker endpoint.

        Uses InvokeEndpointWithResponseStream for streaming inference.
        """
        endpoint_name = self.current_model

        if not endpoint_name:
            raise ValueError("SageMaker endpoint name not configured")

        payload = self._build_request_payload(
            messages=messages,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature,
            stop_sequences=stop_sequences,
            stream=True,
        )

        async with self._session.client(
            "sagemaker-runtime",
            region_name=self._region,
            config=self._boto_config,
        ) as client:
            try:
                response = await client.invoke_endpoint_with_response_stream(
                    EndpointName=endpoint_name,
                    ContentType=self._content_type,
                    Accept=self._accept,
                    Body=json.dumps(payload),
                )

                event_stream = response.get("Body")
                if event_stream:
                    async for event in event_stream:
                        if "PayloadPart" in event:
                            payload_bytes = event["PayloadPart"].get("Bytes", b"")
                            if payload_bytes:
                                try:
                                    chunk = json.loads(payload_bytes)
                                    text = self._extract_stream_text(chunk)
                                    if text:
                                        yield text
                                except json.JSONDecodeError:
                                    # Some endpoints return raw text
                                    yield payload_bytes.decode("utf-8")

            except Exception as e:
                logger.error(
                    "sagemaker_stream_error",
                    error=str(e),
                    endpoint=endpoint_name,
                )
                raise

    async def count_tokens(self, text: str) -> int:
        """Estimate token count.

        SageMaker endpoints don't provide tokenization, so we estimate.
        """
        return len(text) // 4

    def _build_request_payload(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        stop_sequences: list[str] | None,
        stream: bool = False,
    ) -> dict[str, Any]:
        """Build request payload for SageMaker endpoint.

        Uses HuggingFace TGI format by default.
        Customize this method for other model formats.
        """
        # Convert messages to prompt format
        prompt = self._format_prompt(messages)

        payload: dict[str, Any] = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": max_tokens,
                "temperature": temperature,
                "do_sample": temperature > 0,
                "return_full_text": False,
            },
        }

        if stop_sequences:
            payload["parameters"]["stop_sequences"] = stop_sequences

        if stream:
            payload["stream"] = True

        return payload

    def _format_prompt(self, messages: list[dict[str, Any]]) -> str:
        """Format messages into a single prompt string.

        Uses a generic chat template. Customize based on your model's format.
        """
        parts = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Handle string content
            if isinstance(content, str):
                text = content
            # Handle multimodal content (extract text only)
            elif isinstance(content, list):
                text_parts = [
                    block.get("text", "")
                    for block in content
                    if block.get("type") == "text"
                ]
                text = " ".join(text_parts)
            else:
                text = str(content)

            if role == "system":
                parts.append(f"System: {text}")
            elif role == "user":
                parts.append(f"User: {text}")
            elif role == "assistant":
                parts.append(f"Assistant: {text}")

        # Add final assistant prompt
        parts.append("Assistant:")

        return "\n\n".join(parts)

    def _parse_response(
        self, response_body: dict[str, Any] | list[Any]
    ) -> tuple[str, dict[str, Any]]:
        """Parse response from SageMaker endpoint.

        Handles HuggingFace TGI format.
        """
        content = ""
        usage: dict[str, Any] = {}

        # Handle list response (TGI format)
        if isinstance(response_body, list):
            if response_body:
                first_result = response_body[0]
                content = first_result.get("generated_text", "")
                details = first_result.get("details", {})
                usage = {
                    "input_tokens": details.get("prefill", [{}])[0].get("tokens", 0) if details.get("prefill") else 0,
                    "output_tokens": details.get("generated_tokens", 0),
                    "stop_reason": details.get("finish_reason", "stop"),
                }
        # Handle dict response
        elif isinstance(response_body, dict):
            content = response_body.get("generated_text", "")
            if not content:
                content = response_body.get("outputs", "")

            details = response_body.get("details", {})
            usage = {
                "input_tokens": details.get("input_tokens", 0),
                "output_tokens": details.get("generated_tokens", 0),
                "stop_reason": details.get("finish_reason", "stop"),
            }

        return content, usage

    def _extract_stream_text(self, chunk: dict[str, Any]) -> str | None:
        """Extract text from streaming chunk.

        Handles HuggingFace TGI streaming format.
        """
        # TGI token format
        if "token" in chunk:
            token = chunk["token"]
            if isinstance(token, dict):
                return token.get("text", "")
            return str(token)

        # Alternative format
        if "generated_text" in chunk:
            return chunk["generated_text"]

        # vLLM format
        if "text" in chunk:
            return chunk["text"]

        return None

    async def health_check(self) -> bool:
        """Check if SageMaker endpoint is available."""
        endpoint_name = self.current_model

        if not endpoint_name:
            return False

        try:
            async with self._session.client(
                "sagemaker",
                region_name=self._region,
                config=self._boto_config,
            ) as client:
                response = await client.describe_endpoint(EndpointName=endpoint_name)
                return response.get("EndpointStatus") == "InService"
        except Exception as e:
            logger.warning(
                "sagemaker_health_check_failed",
                endpoint=endpoint_name,
                error=str(e),
            )
            return False
