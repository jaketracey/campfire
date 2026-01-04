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


def _get_db_provider_configs() -> list[dict] | None:
    """Try to get provider configs from the routing config service (DB-backed).

    Returns:
        list[dict] or None if service not available.
    """
    try:
        from orchestrator.main import app_state

        if (
            app_state.routing_config_service is not None
            and app_state.routing_config_service.is_initialized
        ):
            cache_status = app_state.routing_config_service.get_cache_status()
            db_configs = cache_status.get("provider_configs", [])
            if db_configs:
                return db_configs
    except Exception as e:
        logger.debug("failed_to_get_db_provider_configs", error=str(e))

    return None


def _get_provider_config() -> tuple[dict[str, dict[str, Any]], str, str]:
    """Determine provider configuration from DB and/or environment settings.

    Merges database-stored provider configs with environment variable configs.
    DB configs provide: is_enabled, has_api_key, priority
    Env vars provide: local providers (ollama, bedrock), fallback API keys

    Returns dict with provider name -> config info including:
    - is_configured: whether API key or enablement flag is set
    - role: primary, fallback, available, or not_configured
    - model: the model being used
    """
    settings = get_settings()
    db_configs = _get_db_provider_configs()

    # Build a lookup from DB configs
    db_lookup: dict[str, dict] = {}
    if db_configs:
        for cfg in db_configs:
            db_lookup[cfg["provider"]] = cfg

    # Determine primary provider
    # Priority: bedrock (env) > ollama (env) > highest priority DB provider > openai
    primary_provider = "openai"  # default

    if settings.bedrock_enabled:
        primary_provider = "bedrock"
    elif settings.ollama_enabled:
        primary_provider = "ollama"
    elif db_configs:
        # Find highest priority (lowest number) enabled DB provider with API key
        for cfg in db_configs:  # Already sorted by priority
            if cfg["is_enabled"] and cfg["has_api_key"]:
                primary_provider = cfg["provider"]
                break

    # Fallback is always anthropic
    fallback_provider = "anthropic"

    providers: dict[str, dict[str, Any]] = {}

    # Helper to check if provider is configured (DB or env)
    def is_db_configured(provider: str) -> bool:
        cfg = db_lookup.get(provider)
        return cfg is not None and cfg["is_enabled"] and cfg["has_api_key"]

    # Anthropic - fallback, configured if DB has key OR env has key
    anthropic_configured = is_db_configured("anthropic") or bool(settings.anthropic_api_key)
    providers["anthropic"] = {
        "is_configured": anthropic_configured,
        "role": "fallback" if anthropic_configured else "not_configured",
        "model": settings.anthropic_model if anthropic_configured else None,
        "source": "database" if is_db_configured("anthropic") else ("env" if settings.anthropic_api_key else None),
    }

    # OpenAI - primary if no bedrock/ollama, configured if DB or env has key
    openai_configured = is_db_configured("openai") or bool(settings.openai_api_key)
    providers["openai"] = {
        "is_configured": openai_configured,
        "role": "primary" if primary_provider == "openai" and openai_configured else (
            "available" if openai_configured else "not_configured"
        ),
        "model": settings.openai_model if openai_configured else None,
        "source": "database" if is_db_configured("openai") else ("env" if settings.openai_api_key else None),
    }

    # Ollama - local provider, always configured via env
    providers["ollama"] = {
        "is_configured": settings.ollama_enabled,
        "role": "primary" if primary_provider == "ollama" else (
            "available" if settings.ollama_enabled else "not_configured"
        ),
        "model": settings.ollama_model if settings.ollama_enabled else None,
        "source": "env" if settings.ollama_enabled else None,
    }

    # Bedrock - AWS provider, configured via env
    providers["bedrock"] = {
        "is_configured": settings.bedrock_enabled,
        "role": "primary" if primary_provider == "bedrock" else (
            "available" if settings.bedrock_enabled else "not_configured"
        ),
        "model": settings.bedrock_default_model if settings.bedrock_enabled else None,
        "source": "env" if settings.bedrock_enabled else None,
    }

    # Together - configured if DB has key OR env has key
    together_env_key = getattr(settings, "together_api_key", "")
    together_configured = is_db_configured("together") or bool(together_env_key)
    providers["together"] = {
        "is_configured": together_configured,
        "role": "available" if together_configured else "not_configured",
        "model": None,
        "source": "database" if is_db_configured("together") else ("env" if together_env_key else None),
    }

    # Groq - configured if DB has key OR env has key
    groq_env_key = getattr(settings, "groq_api_key", "")
    groq_configured = is_db_configured("groq") or bool(groq_env_key)
    providers["groq"] = {
        "is_configured": groq_configured,
        "role": "available" if groq_configured else "not_configured",
        "model": None,
        "source": "database" if is_db_configured("groq") else ("env" if groq_env_key else None),
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
