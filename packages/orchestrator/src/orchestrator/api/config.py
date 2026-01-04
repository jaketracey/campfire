"""Configuration sync API endpoints.

Handles configuration push from the gateway to refresh routing caches.
Since the orchestrator reads from the same database as the gateway,
these endpoints just trigger cache refreshes rather than receiving data.
"""

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = structlog.get_logger()

router = APIRouter(prefix="/config", tags=["config"])


class RoutingConfigRequest(BaseModel):
    """Request model for routing configuration sync.

    The gateway sends its exported configuration, but we only use this
    to trigger a cache refresh since we read from the same database.
    """

    version: str | None = None
    exportedAt: str | None = None
    providers: list[dict[str, Any]] | None = None
    models: list[dict[str, Any]] | None = None
    routingRules: list[dict[str, Any]] | None = None
    type: str | None = None  # 'image' for image routing


class RoutingConfigResponse(BaseModel):
    """Response model for routing configuration sync."""

    success: bool
    message: str
    cache_status: dict[str, Any] | None = None


@router.put("/routing", response_model=RoutingConfigResponse)
async def sync_routing_config(request: RoutingConfigRequest) -> RoutingConfigResponse:
    """Sync routing configuration from the gateway.

    This endpoint is called by the gateway after it updates routing
    configuration in the database. It triggers a cache refresh in
    the orchestrator to pick up the new configuration.
    """
    try:
        # Import here to avoid circular imports
        from orchestrator.main import app_state

        if app_state.routing_config_service is None:
            raise HTTPException(
                status_code=503,
                detail="Routing config service not initialized",
            )

        # Force refresh the cache to pick up database changes
        await app_state.routing_config_service.force_refresh()

        cache_status = app_state.routing_config_service.get_cache_status()

        logger.info(
            "routing_config_synced",
            models_count=cache_status.get("models_count", 0),
            use_cases=cache_status.get("use_cases", []),
            version=request.version,
        )

        return RoutingConfigResponse(
            success=True,
            message="Routing configuration refreshed from database",
            cache_status=cache_status,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("routing_config_sync_failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to sync routing configuration: {str(e)}",
        )


@router.put("/image-routing", response_model=RoutingConfigResponse)
async def sync_image_routing_config(
    request: RoutingConfigRequest,
) -> RoutingConfigResponse:
    """Sync image routing configuration from the gateway.

    This endpoint is called by the gateway after it updates image routing
    configuration in the database. It triggers a cache refresh in
    the orchestrator to pick up the new configuration.
    """
    try:
        # Import here to avoid circular imports
        from orchestrator.main import app_state

        if app_state.image_routing_config_service is None:
            raise HTTPException(
                status_code=503,
                detail="Image routing config service not initialized",
            )

        # Force refresh the cache to pick up database changes
        await app_state.image_routing_config_service.force_refresh()

        cache_status = app_state.image_routing_config_service.get_cache_status()

        logger.info(
            "image_routing_config_synced",
            models_count=cache_status.get("models_count", 0),
            use_cases=cache_status.get("use_cases", []),
            version=request.version,
        )

        return RoutingConfigResponse(
            success=True,
            message="Image routing configuration refreshed from database",
            cache_status=cache_status,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("image_routing_config_sync_failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to sync image routing configuration: {str(e)}",
        )


@router.post("/refresh")
async def force_refresh_all_caches() -> dict[str, Any]:
    """Force refresh all routing caches.

    Utility endpoint to refresh both text and image routing caches
    without requiring configuration data.
    """
    results = {"text_routing": None, "image_routing": None}

    try:
        from orchestrator.main import app_state

        if app_state.routing_config_service is not None:
            await app_state.routing_config_service.force_refresh()
            results["text_routing"] = app_state.routing_config_service.get_cache_status()

        if app_state.image_routing_config_service is not None:
            await app_state.image_routing_config_service.force_refresh()
            results["image_routing"] = (
                app_state.image_routing_config_service.get_cache_status()
            )

        logger.info("all_routing_caches_refreshed")

        return {
            "success": True,
            "message": "All routing caches refreshed",
            "caches": results,
        }

    except Exception as e:
        logger.error("cache_refresh_failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to refresh caches: {str(e)}",
        )
