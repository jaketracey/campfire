"""Routing configuration service with caching."""

import asyncio
import time
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import structlog

from orchestrator.repositories.routing_config import (
    DBModelConfig,
    DBRoutingEntry,
    RoutingConfigRepository,
)
from orchestrator.routing.model_registry import (
    MODEL_REGISTRY,
    ContentCapability,
    ModelSpec,
    ModelTier,
    register_model,
)
from orchestrator.routing.model_router import InferenceDefaults, UseCaseRoutingResult

logger = structlog.get_logger()


@dataclass
class CachedRoutingConfig:
    """Cached routing configuration from the database."""

    routing_rules: dict[str, list[DBRoutingEntry]]
    models: list[DBModelConfig]
    provider_status: dict[str, bool]
    provider_configs: list[dict]  # Full provider configs with API key presence
    loaded_at: float
    ttl_seconds: float = 60.0

    @property
    def is_expired(self) -> bool:
        """Check if the cache has expired."""
        return time.time() - self.loaded_at > self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        """Get the age of the cache in seconds."""
        return time.time() - self.loaded_at


class RoutingConfigService:
    """Service for managing routing configuration with caching.

    Loads routing configuration from the database and maintains an in-memory
    cache with TTL-based expiration. Also populates the MODEL_REGISTRY with
    database-defined models.
    """

    def __init__(self, cache_ttl_seconds: float = 60.0):
        """Initialize the routing config service.

        Args:
            cache_ttl_seconds: Time-to-live for cached configuration.
        """
        self._repository = RoutingConfigRepository()
        self._cache: Optional[CachedRoutingConfig] = None
        self._cache_ttl = cache_ttl_seconds
        self._refresh_lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        """Load routing config from database and populate MODEL_REGISTRY.

        Should be called during application startup.
        """
        logger.info("initializing_routing_config_service")
        await self._refresh_cache()
        self._initialized = True
        logger.info(
            "routing_config_service_initialized",
            models_loaded=len(self._cache.models) if self._cache else 0,
            use_cases_configured=list(self._cache.routing_rules.keys()) if self._cache else [],
        )

    async def refresh_if_needed(self) -> None:
        """Refresh cache if expired."""
        if self._cache is None or self._cache.is_expired:
            await self._refresh_cache()

    async def force_refresh(self) -> None:
        """Force a cache refresh regardless of TTL."""
        await self._refresh_cache()

    async def _refresh_cache(self) -> None:
        """Reload configuration from database."""
        async with self._refresh_lock:
            try:
                # Fetch from database
                models = await self._repository.get_all_enabled_models()
                routing_rules = await self._repository.get_all_routing_rules()
                provider_status = await self._repository.get_provider_status()
                provider_configs = await self._repository.get_provider_configs()

                # Update MODEL_REGISTRY with database models
                models_registered = 0
                for db_model in models:
                    try:
                        model_spec = self._db_model_to_spec(db_model)
                        register_model(model_spec)
                        models_registered += 1
                    except Exception as e:
                        logger.warning(
                            "failed_to_register_model",
                            model_id=db_model.model_id,
                            error=str(e),
                        )

                self._cache = CachedRoutingConfig(
                    routing_rules=routing_rules,
                    models=models,
                    provider_status=provider_status,
                    provider_configs=provider_configs,
                    loaded_at=time.time(),
                    ttl_seconds=self._cache_ttl,
                )

                logger.debug(
                    "routing_config_cache_refreshed",
                    models_fetched=len(models),
                    models_registered=models_registered,
                    use_cases=list(routing_rules.keys()),
                    provider_configs=len(provider_configs),
                )
            except Exception as e:
                logger.error("routing_config_refresh_failed", error=str(e))
                # Keep existing cache if refresh fails
                if self._cache is None:
                    raise

    def _db_model_to_spec(self, db_model: DBModelConfig) -> ModelSpec:
        """Convert database model config to ModelSpec.

        Args:
            db_model: Database model configuration.

        Returns:
            ModelSpec: Model specification for the registry.
        """
        metadata = db_model.metadata or {}

        # Extract content capability from metadata
        content_cap_str = metadata.get("content_capability", "SUGGESTIVE")
        try:
            content_capability = ContentCapability[content_cap_str.upper()]
        except KeyError:
            content_capability = ContentCapability.SUGGESTIVE

        # Extract tier from metadata or infer from provider
        tier_str = metadata.get("tier", "STANDARD")
        try:
            tier = ModelTier[tier_str.upper()]
        except KeyError:
            tier = ModelTier.STANDARD

        # Check if abliterated
        is_abliterated = metadata.get("is_abliterated", False)
        is_local = db_model.provider == "ollama"

        # Extract capabilities
        capabilities = db_model.capabilities or []
        supports_tools = "function_calling" in capabilities
        supports_vision = "vision" in capabilities
        supports_streaming = "streaming" in capabilities

        # Extract tags
        tags = metadata.get("tags", [])

        return ModelSpec(
            model_id=db_model.model_id,
            provider=db_model.provider,  # type: ignore
            display_name=db_model.display_name,
            content_capability=content_capability,
            tier=tier,
            supports_tools=supports_tools,
            supports_vision=supports_vision,
            supports_streaming=supports_streaming,
            context_window=db_model.context_window or 128000,
            max_output_tokens=db_model.max_output_tokens or 4096,
            is_abliterated=is_abliterated,
            is_local=is_local,
            cost_per_1m_input=db_model.input_cost_per_million or 0.0,
            cost_per_1m_output=db_model.output_cost_per_million or 0.0,
            tags=tags,
        )

    async def get_routing_for_use_case(
        self,
        use_case: str,
        companion_id: Optional[UUID] = None,
    ) -> list[DBRoutingEntry]:
        """Get routing entries for a use case.

        Uses companion overrides if present, otherwise platform defaults.

        Args:
            use_case: The use case type.
            companion_id: Optional companion ID for overrides.

        Returns:
            list[DBRoutingEntry]: Ordered list of routing entries.
        """
        await self.refresh_if_needed()

        if companion_id:
            # Use database function for companion-specific routing
            return await self._repository.get_effective_routing(companion_id, use_case)

        # Return cached platform defaults
        if self._cache is None:
            return []
        return self._cache.routing_rules.get(use_case, [])

    async def get_model_for_use_case(
        self,
        use_case: str,
        companion_id: Optional[UUID] = None,
        require_abliterated: bool = False,
        require_sfw: bool = False,
    ) -> Optional[UseCaseRoutingResult]:
        """Get the best model for a use case with inference defaults.

        Args:
            use_case: The use case type.
            companion_id: Optional companion ID for overrides.
            require_abliterated: If True, only return abliterated models.
            require_sfw: If True, only return SFW-capable models.

        Returns:
            Optional[UseCaseRoutingResult]: The best matching model with
            inference defaults from routing rule metadata, or None if not found.
        """
        entries = await self.get_routing_for_use_case(use_case, companion_id)

        for entry in entries:
            model = MODEL_REGISTRY.get(entry.model_id)
            if model is None:
                continue

            # Check abliterated requirement
            if require_abliterated and not model.is_abliterated:
                continue

            # Check SFW requirement
            if require_sfw and model.content_capability > ContentCapability.SUGGESTIVE:
                continue

            inference_defaults = InferenceDefaults.from_metadata(entry.metadata)
            return UseCaseRoutingResult(
                model_spec=model,
                inference_defaults=inference_defaults,
            )

        return None

    def get_cache_status(self) -> dict:
        """Get the current cache status.

        Returns:
            dict: Cache status information.
        """
        if self._cache is None:
            return {
                "initialized": self._initialized,
                "cache_loaded": False,
                "models_count": 0,
                "use_cases": [],
                "provider_configs": [],
            }

        return {
            "initialized": self._initialized,
            "cache_loaded": True,
            "cache_age_seconds": self._cache.age_seconds,
            "cache_expired": self._cache.is_expired,
            "models_count": len(self._cache.models),
            "use_cases": list(self._cache.routing_rules.keys()),
            "providers_enabled": {
                k: v for k, v in self._cache.provider_status.items() if v
            },
            "provider_configs": self._cache.provider_configs,
        }

    @property
    def is_initialized(self) -> bool:
        """Check if the service is initialized."""
        return self._initialized

    async def get_provider_api_key(
        self,
        provider_name: str,
        encryption_key: str,
    ) -> Optional[str]:
        """Get decrypted API key for a provider.

        Args:
            provider_name: The provider name (e.g., 'openai', 'anthropic').
            encryption_key: The encryption key for decrypting the API key.

        Returns:
            The decrypted API key, or None if not configured.
        """
        return await self._repository.get_provider_api_key(provider_name, encryption_key)
