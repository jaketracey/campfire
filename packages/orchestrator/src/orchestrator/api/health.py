"""Health and provider status API endpoints."""

import time
from typing import Any

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from orchestrator.routing.model_registry import PROVIDER_HEALTH

logger = structlog.get_logger()

router = APIRouter(tags=["health"])


class ProviderStatus(BaseModel):
    """Status of a single provider."""

    is_available: bool
    avg_latency_ms: float | None = None
    error_count: int = 0
    success_rate: float | None = None
    last_error: str | None = None
    last_check_ms: float | None = None


class ProvidersHealthResponse(BaseModel):
    """Response containing all provider health statuses."""

    providers: dict[str, ProviderStatus]
    timestamp: float


@router.get("/health/providers", response_model=ProvidersHealthResponse)
async def get_provider_health() -> ProvidersHealthResponse:
    """Get health status for all AI providers.

    Returns availability, latency, and error statistics for each provider.
    """
    providers: dict[str, ProviderStatus] = {}

    for provider_name, health in PROVIDER_HEALTH.items():
        # Calculate success rate
        success_rate = None
        if health.get("total_requests", 0) > 0:
            success_rate = (
                health.get("successful_requests", 0) / health["total_requests"] * 100
            )

        providers[provider_name] = ProviderStatus(
            is_available=health.get("is_available", True),
            avg_latency_ms=health.get("avg_latency_ms"),
            error_count=health.get("error_count", 0),
            success_rate=success_rate,
            last_error=health.get("last_error"),
            last_check_ms=health.get("last_check_ms"),
        )

    # Add providers that might not be in PROVIDER_HEALTH yet
    known_providers = ["anthropic", "openai", "ollama", "together", "groq"]
    for p in known_providers:
        if p not in providers:
            providers[p] = ProviderStatus(is_available=True)

    return ProvidersHealthResponse(
        providers=providers,
        timestamp=time.time(),
    )


@router.get("/health/detailed")
async def get_detailed_health() -> dict[str, Any]:
    """Get detailed health information including system metrics."""
    import os
    import platform

    # Get provider health
    providers_response = await get_provider_health()

    # Count healthy providers
    healthy_count = sum(
        1 for p in providers_response.providers.values() if p.is_available
    )
    total_providers = len(providers_response.providers)

    return {
        "status": "healthy" if healthy_count > 0 else "degraded",
        "providers": {
            "healthy": healthy_count,
            "total": total_providers,
            "details": {
                name: status.model_dump()
                for name, status in providers_response.providers.items()
            },
        },
        "system": {
            "python_version": platform.python_version(),
            "platform": platform.system(),
            "pid": os.getpid(),
        },
        "timestamp": time.time(),
    }
