"""Health and provider status API endpoints."""

import time
from typing import Any, Literal

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from orchestrator.config import get_settings
from orchestrator.routing.model_registry import PROVIDER_HEALTH

logger = structlog.get_logger()

router = APIRouter(tags=["health"])


ProviderRole = Literal["primary", "fallback", "available", "not_configured"]


class ProviderStatus(BaseModel):
    """Status of a single provider."""

    is_available: bool
    is_configured: bool = False
    role: ProviderRole = "not_configured"
    model: str | None = None
    avg_latency_ms: float | None = None
    error_count: int = 0
    success_rate: float | None = None
    last_error: str | None = None
    last_check_ms: float | None = None


class ProvidersHealthResponse(BaseModel):
    """Response containing all provider health statuses."""

    providers: dict[str, ProviderStatus]
    primary_provider: str
    fallback_provider: str
    content_routing_enabled: bool
    timestamp: float


def _get_provider_config() -> tuple[dict[str, dict[str, Any]], str, str]:
    """Determine provider configuration from settings.

    Returns dict with provider name -> config info including:
    - is_configured: whether API key or enablement flag is set
    - role: primary, fallback, available, or not_configured
    - model: the model being used
    """
    settings = get_settings()

    # Determine primary provider (same logic as orchestrator.py:84-94)
    primary_provider = "openai"  # default
    if settings.bedrock_enabled:
        primary_provider = "bedrock"
    elif settings.ollama_enabled:
        primary_provider = "ollama"

    # Fallback is always anthropic (orchestrator.py:96)
    fallback_provider = "anthropic"

    providers: dict[str, dict[str, Any]] = {}

    # Anthropic - always fallback, configured if API key present
    providers["anthropic"] = {
        "is_configured": bool(settings.anthropic_api_key),
        "role": "fallback" if settings.anthropic_api_key else "not_configured",
        "model": settings.anthropic_model if settings.anthropic_api_key else None,
    }

    # OpenAI - primary if no bedrock/ollama, configured if API key present
    providers["openai"] = {
        "is_configured": bool(settings.openai_api_key),
        "role": "primary" if primary_provider == "openai" and settings.openai_api_key else (
            "available" if settings.openai_api_key else "not_configured"
        ),
        "model": settings.openai_model if settings.openai_api_key else None,
    }

    # Ollama - primary if enabled, always "configured" since it's local
    providers["ollama"] = {
        "is_configured": settings.ollama_enabled,
        "role": "primary" if primary_provider == "ollama" else (
            "available" if settings.ollama_enabled else "not_configured"
        ),
        "model": settings.ollama_model if settings.ollama_enabled else None,
    }

    # Bedrock - primary if enabled
    providers["bedrock"] = {
        "is_configured": settings.bedrock_enabled,
        "role": "primary" if primary_provider == "bedrock" else "not_configured",
        "model": settings.bedrock_default_model if settings.bedrock_enabled else None,
    }

    # Together - available if API key present
    # Note: no explicit together_api_key in settings, check if exists
    together_key = getattr(settings, "together_api_key", "")
    providers["together"] = {
        "is_configured": bool(together_key),
        "role": "available" if together_key else "not_configured",
        "model": None,
    }

    # Groq - available if API key present
    groq_key = getattr(settings, "groq_api_key", "")
    providers["groq"] = {
        "is_configured": bool(groq_key),
        "role": "available" if groq_key else "not_configured",
        "model": None,
    }

    return providers, primary_provider, fallback_provider


@router.get("/health/providers", response_model=ProvidersHealthResponse)
async def get_provider_health() -> ProvidersHealthResponse:
    """Get health status for all AI providers.

    Returns availability, latency, and error statistics for each provider.
    Shows actual configuration state and which provider is primary/fallback.
    """
    settings = get_settings()
    provider_config, primary_provider, fallback_provider = _get_provider_config()

    providers: dict[str, ProviderStatus] = {}

    for provider_name, config in provider_config.items():
        # Get runtime health data if available
        health = PROVIDER_HEALTH.get(provider_name, {})

        # Calculate success rate from runtime stats
        success_rate = None
        total_requests = getattr(health, "total_requests", 0) if hasattr(health, "total_requests") else 0
        if total_requests > 0:
            successful = getattr(health, "successful_requests", 0) if hasattr(health, "successful_requests") else 0
            success_rate = (successful / total_requests) * 100

        # Provider is available only if configured AND runtime health is good
        is_configured = config["is_configured"]
        runtime_available = getattr(health, "is_available", True) if hasattr(health, "is_available") else True
        is_available = is_configured and runtime_available

        providers[provider_name] = ProviderStatus(
            is_available=is_available,
            is_configured=is_configured,
            role=config["role"],
            model=config["model"],
            avg_latency_ms=getattr(health, "avg_latency_ms", None) if hasattr(health, "avg_latency_ms") else None,
            error_count=getattr(health, "error_count", 0) if hasattr(health, "error_count") else 0,
            success_rate=success_rate,
            last_error=getattr(health, "last_error", None) if hasattr(health, "last_error") else None,
            last_check_ms=getattr(health, "last_check_ms", None) if hasattr(health, "last_check_ms") else None,
        )

    return ProvidersHealthResponse(
        providers=providers,
        primary_provider=primary_provider,
        fallback_provider=fallback_provider,
        content_routing_enabled=settings.content_routing_enabled,
        timestamp=time.time(),
    )


@router.get("/health/routing")
async def get_routing_health() -> dict[str, Any]:
    """Get routing configuration status.

    Returns information about database-driven routing configuration
    including cache status, loaded models, and configured use cases.
    """
    # Import here to avoid circular imports
    from orchestrator.db.pool import DatabasePool
    from orchestrator.routing.model_registry import MODEL_REGISTRY

    settings = get_settings()

    response: dict[str, Any] = {
        "content_routing_enabled": settings.content_routing_enabled,
        "database_connected": DatabasePool.is_initialized(),
        "models_in_registry": len(MODEL_REGISTRY),
        "timestamp": time.time(),
    }

    # Try to get routing config service status
    # Note: We access this via a module-level import to avoid circular deps
    try:
        # Import app_state from main
        from orchestrator.main import app_state

        if app_state.routing_config_service is not None:
            cache_status = app_state.routing_config_service.get_cache_status()
            response["routing_config_service"] = {
                "initialized": cache_status.get("initialized", False),
                "cache_loaded": cache_status.get("cache_loaded", False),
                "cache_age_seconds": cache_status.get("cache_age_seconds"),
                "cache_expired": cache_status.get("cache_expired"),
                "models_from_db": cache_status.get("models_count", 0),
                "use_cases_configured": cache_status.get("use_cases", []),
                "providers_enabled": cache_status.get("providers_enabled", {}),
            }
            response["status"] = "healthy"
        else:
            response["routing_config_service"] = None
            response["status"] = "fallback"
            response["message"] = "Using environment-based routing (DB not available)"
    except Exception as e:
        logger.warning("failed_to_get_routing_status", error=str(e))
        response["routing_config_service"] = None
        response["status"] = "unknown"
        response["error"] = str(e)

    return response


@router.get("/health/detailed")
async def get_detailed_health() -> dict[str, Any]:
    """Get detailed health information including system metrics."""
    import os
    import platform

    # Get provider health
    providers_response = await get_provider_health()

    # Get routing health
    routing_response = await get_routing_health()

    # Count healthy/configured providers
    configured_count = sum(
        1 for p in providers_response.providers.values() if p.is_configured
    )
    available_count = sum(
        1 for p in providers_response.providers.values() if p.is_available
    )
    total_providers = len(providers_response.providers)

    return {
        "status": "healthy" if available_count > 0 else "degraded",
        "providers": {
            "configured": configured_count,
            "available": available_count,
            "total": total_providers,
            "primary": providers_response.primary_provider,
            "fallback": providers_response.fallback_provider,
            "content_routing_enabled": providers_response.content_routing_enabled,
            "details": {
                name: status.model_dump()
                for name, status in providers_response.providers.items()
            },
        },
        "routing": routing_response,
        "system": {
            "python_version": platform.python_version(),
            "platform": platform.system(),
            "pid": os.getpid(),
        },
        "timestamp": time.time(),
    }
