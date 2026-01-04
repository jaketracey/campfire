"""Provider testing API endpoints."""

import time
from typing import Literal

import httpx
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = structlog.get_logger()

router = APIRouter(prefix="/providers", tags=["providers"])

ProviderName = Literal["anthropic", "openai", "together", "groq"]


class TestProviderRequest(BaseModel):
    """Request to test a provider connection."""

    api_key: str


class TestProviderResponse(BaseModel):
    """Response from testing a provider."""

    success: bool
    latency_ms: float | None = None
    error: str | None = None
    model_tested: str | None = None


# Provider-specific test configurations
PROVIDER_CONFIGS = {
    "anthropic": {
        "base_url": "https://api.anthropic.com/v1/messages",
        "test_model": "claude-3-5-haiku-20241022",
        "auth_header": "x-api-key",
        "extra_headers": {"anthropic-version": "2023-06-01"},
    },
    "openai": {
        "base_url": "https://api.openai.com/v1/chat/completions",
        "test_model": "gpt-4o-mini",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1/chat/completions",
        "test_model": "meta-llama/Llama-3-8b-chat-hf",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1/chat/completions",
        "test_model": "llama-3.1-8b-instant",
        "auth_header": "Authorization",
        "auth_prefix": "Bearer ",
    },
}


async def _test_anthropic(api_key: str) -> TestProviderResponse:
    """Test Anthropic API connection."""
    config = PROVIDER_CONFIGS["anthropic"]
    start_time = time.time()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                config["base_url"],
                headers={
                    config["auth_header"]: api_key,
                    "Content-Type": "application/json",
                    **config.get("extra_headers", {}),
                },
                json={
                    "model": config["test_model"],
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "Say hi"}],
                },
            )

            latency_ms = (time.time() - start_time) * 1000

            if response.status_code == 200:
                return TestProviderResponse(
                    success=True,
                    latency_ms=latency_ms,
                    model_tested=config["test_model"],
                )
            elif response.status_code == 401:
                return TestProviderResponse(
                    success=False,
                    latency_ms=latency_ms,
                    error="Invalid API key",
                )
            elif response.status_code == 429:
                # Rate limited but key is valid
                return TestProviderResponse(
                    success=True,
                    latency_ms=latency_ms,
                    model_tested=config["test_model"],
                    error="Rate limited (but key is valid)",
                )
            else:
                error_text = response.text[:200]
                return TestProviderResponse(
                    success=False,
                    latency_ms=latency_ms,
                    error=f"API error {response.status_code}: {error_text}",
                )

    except httpx.TimeoutException:
        return TestProviderResponse(
            success=False,
            latency_ms=(time.time() - start_time) * 1000,
            error="Connection timeout",
        )
    except Exception as e:
        return TestProviderResponse(
            success=False,
            latency_ms=(time.time() - start_time) * 1000,
            error=str(e),
        )


async def _test_openai_compatible(
    api_key: str, provider: str
) -> TestProviderResponse:
    """Test OpenAI-compatible API connection (OpenAI, Together, Groq)."""
    config = PROVIDER_CONFIGS[provider]
    start_time = time.time()

    auth_value = f"{config.get('auth_prefix', '')}{api_key}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                config["base_url"],
                headers={
                    config["auth_header"]: auth_value,
                    "Content-Type": "application/json",
                },
                json={
                    "model": config["test_model"],
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "Say hi"}],
                },
            )

            latency_ms = (time.time() - start_time) * 1000

            if response.status_code == 200:
                return TestProviderResponse(
                    success=True,
                    latency_ms=latency_ms,
                    model_tested=config["test_model"],
                )
            elif response.status_code == 401:
                return TestProviderResponse(
                    success=False,
                    latency_ms=latency_ms,
                    error="Invalid API key",
                )
            elif response.status_code == 429:
                # Rate limited but key is valid
                return TestProviderResponse(
                    success=True,
                    latency_ms=latency_ms,
                    model_tested=config["test_model"],
                    error="Rate limited (but key is valid)",
                )
            else:
                error_text = response.text[:200]
                return TestProviderResponse(
                    success=False,
                    latency_ms=latency_ms,
                    error=f"API error {response.status_code}: {error_text}",
                )

    except httpx.TimeoutException:
        return TestProviderResponse(
            success=False,
            latency_ms=(time.time() - start_time) * 1000,
            error="Connection timeout",
        )
    except Exception as e:
        return TestProviderResponse(
            success=False,
            latency_ms=(time.time() - start_time) * 1000,
            error=str(e),
        )


@router.post("/{provider}/test", response_model=TestProviderResponse)
async def test_provider(provider: str, request: TestProviderRequest) -> TestProviderResponse:
    """Test a provider connection with an API key.

    Makes a minimal API call to verify the key is valid and the provider is reachable.
    """
    if provider not in PROVIDER_CONFIGS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {provider}. Supported: {list(PROVIDER_CONFIGS.keys())}",
        )

    logger.info("testing_provider", provider=provider)

    if provider == "anthropic":
        result = await _test_anthropic(request.api_key)
    else:
        result = await _test_openai_compatible(request.api_key, provider)

    # Update provider health based on test result
    from orchestrator.routing.model_registry import update_provider_health

    update_provider_health(
        provider=provider,  # type: ignore
        is_available=result.success,
        latency_ms=result.latency_ms,
        error=result.error if not result.success else None,
    )

    logger.info(
        "provider_test_complete",
        provider=provider,
        success=result.success,
        latency_ms=result.latency_ms,
        error=result.error,
    )

    return result


@router.get("/supported")
async def list_supported_providers() -> dict:
    """List supported providers for testing."""
    return {
        "providers": list(PROVIDER_CONFIGS.keys()),
        "note": "Bedrock and Ollama use different authentication mechanisms and are tested separately.",
    }
