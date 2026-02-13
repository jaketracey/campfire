"""Image routing configuration service with caching."""

import asyncio
import time
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import structlog

from orchestrator.repositories.image_routing_config import (
    DBImageModelConfig,
    DBImageRoutingEntry,
    ImageRoutingConfigRepository,
)
from orchestrator.routing.image_model_registry import (
    IMAGE_MODEL_REGISTRY,
    ImageModelSpec,
    ImageModelTier,
    ImageProviderType,
    register_image_model,
)

logger = structlog.get_logger()


@dataclass
class CachedImageRoutingConfig:
    """Cached image routing configuration from the database."""

    routing_rules: dict[str, list[DBImageRoutingEntry]]
    models: list[DBImageModelConfig]
    provider_status: dict[str, bool]
    provider_configs: list[dict]
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


class ImageRoutingConfigService:
    """Service for managing image routing configuration with caching.

    Loads image routing configuration from the database and maintains an in-memory
    cache with TTL-based expiration. Also populates the IMAGE_MODEL_REGISTRY with
    database-defined image models.
    """

    def __init__(self, cache_ttl_seconds: float = 60.0):
        """Initialize the image routing config service.

        Args:
            cache_ttl_seconds: Time-to-live for cached configuration.
        """
        self._repository = ImageRoutingConfigRepository()
        self._cache: Optional[CachedImageRoutingConfig] = None
        self._cache_ttl = cache_ttl_seconds
        self._refresh_lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        """Load image routing config from database and populate IMAGE_MODEL_REGISTRY.

        Should be called during application startup.
        """
        logger.info("initializing_image_routing_config_service")
        await self._refresh_cache()
        self._initialized = True
        logger.info(
            "image_routing_config_service_initialized",
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
                models = await self._repository.get_all_enabled_image_models()
                routing_rules = await self._repository.get_all_image_routing_rules()
                provider_status = await self._repository.get_image_provider_status()
                provider_configs = await self._repository.get_image_provider_configs()

                # Update IMAGE_MODEL_REGISTRY with database models
                models_registered = 0
                for db_model in models:
                    try:
                        model_spec = self._db_model_to_spec(db_model)
                        register_image_model(model_spec)
                        models_registered += 1
                    except Exception as e:
                        logger.warning(
                            "failed_to_register_image_model",
                            model_id=db_model.model_id,
                            error=str(e),
                        )

                self._cache = CachedImageRoutingConfig(
                    routing_rules=routing_rules,
                    models=models,
                    provider_status=provider_status,
                    provider_configs=provider_configs,
                    loaded_at=time.time(),
                    ttl_seconds=self._cache_ttl,
                )

                logger.debug(
                    "image_routing_config_cache_refreshed",
                    models_fetched=len(models),
                    models_registered=models_registered,
                    use_cases=list(routing_rules.keys()),
                    provider_configs=len(provider_configs),
                )
            except Exception as e:
                logger.error("image_routing_config_refresh_failed", error=str(e))
                # Keep existing cache if refresh fails
                if self._cache is None:
                    raise

    def _db_model_to_spec(self, db_model: DBImageModelConfig) -> ImageModelSpec:
        """Convert database image model config to ImageModelSpec.

        Args:
            db_model: Database image model configuration.

        Returns:
            ImageModelSpec: Model specification for the registry.
        """
        metadata = db_model.metadata or {}

        # Determine tier from metadata or infer from characteristics
        tier_str = metadata.get("tier", "STANDARD")
        try:
            tier = ImageModelTier[tier_str.upper()]
        except KeyError:
            # Infer tier from generation time
            if db_model.avg_generation_time <= 4.0:
                tier = ImageModelTier.FAST
            elif db_model.avg_generation_time >= 12.0:
                tier = ImageModelTier.QUALITY
            else:
                tier = ImageModelTier.STANDARD

        # Determine if local
        is_local = db_model.provider in ("comfyui", "ollama")

        # Extract provider-specific identifiers (support snake_case + camelCase)
        checkpoint_name = metadata.get("checkpoint_name") or metadata.get("checkpointName")
        fal_endpoint = metadata.get("fal_endpoint") or metadata.get("falEndpoint")
        replicate_version = metadata.get("replicate_version") or metadata.get("replicateVersion")

        # Extract supported aspect ratios
        aspect_ratios = metadata.get("aspect_ratios") or metadata.get("aspectRatios") or [
            "1:1",
            "3:4",
            "4:3",
            "9:16",
            "16:9",
        ]

        # Extract generation settings
        default_steps = metadata.get("default_steps") or metadata.get("defaultSteps")
        default_cfg_scale = metadata.get("default_cfg_scale") or metadata.get("defaultCfgScale")
        default_sampler = metadata.get("default_sampler") or metadata.get("defaultSampler") or "euler_ancestral"

        # Infer sensible defaults for FAL flux models when metadata is missing.
        inferred_steps, inferred_cfg = self._infer_generation_defaults(
            model_id=db_model.model_id,
            provider=db_model.provider,
            fal_endpoint=fal_endpoint,
        )
        if default_steps is None:
            default_steps = inferred_steps
        if default_cfg_scale is None:
            default_cfg_scale = inferred_cfg

        # Coerce to expected numeric types (metadata might be strings)
        try:
            default_steps = int(default_steps)
        except Exception:
            default_steps = inferred_steps
        try:
            default_cfg_scale = float(default_cfg_scale)
        except Exception:
            default_cfg_scale = inferred_cfg

        # Extract tags
        tags = metadata.get("tags", [])

        supports_img2img = bool(metadata.get("supports_img2img") or metadata.get("supportsImg2img") or False)
        requires_reference_image = bool(
            metadata.get("requires_reference_image")
            or metadata.get("requiresReferenceImage")
            or (fal_endpoint and "pulid" in str(fal_endpoint))
        )

        return ImageModelSpec(
            model_id=db_model.model_id,
            provider=db_model.provider,  # type: ignore
            display_name=db_model.display_name,
            tier=tier,
            max_resolution=(db_model.max_resolution_width, db_model.max_resolution_height),
            supported_aspect_ratios=aspect_ratios,
            supports_ip_adapter=db_model.supports_ip_adapter,
            supports_inpainting=db_model.supports_inpainting,
            supports_controlnet=db_model.supports_controlnet,
            supports_img2img=supports_img2img,
            requires_reference_image=requires_reference_image,
            nsfw_capable=db_model.nsfw_capable,
            avg_generation_time=db_model.avg_generation_time,
            cost_per_image=db_model.cost_per_image,
            default_steps=default_steps,
            default_cfg_scale=default_cfg_scale,
            default_sampler=default_sampler,
            checkpoint_name=checkpoint_name,
            fal_endpoint=fal_endpoint,
            replicate_version=replicate_version,
            is_local=is_local,
            tags=tags,
        )

    def _infer_generation_defaults(
        self,
        model_id: str,
        provider: str,
        fal_endpoint: str | None,
    ) -> tuple[int, float]:
        """Infer reasonable generation defaults when metadata is missing.

        This prevents DB-seeded models (which often only include `fal_endpoint`)
        from falling back to SDXL-ish defaults (CFG~7) that degrade FLUX output.
        """
        if provider != "fal":
            return (30, 7.0)

        endpoint = (fal_endpoint or "").lower()
        if endpoint.startswith("fal-ai/flux"):
            if "pulid" in endpoint:
                return (20, 4.0)
            if "schnell" in endpoint:
                return (4, 1.0)
            if "flash" in endpoint:
                return (4, 3.5)
            if "turbo" in endpoint:
                return (8, 3.5)
            if "flex" in endpoint:
                return (20, 3.5)
            if "max" in endpoint or "pro" in endpoint:
                return (30, 3.5)
            # Flux Dev / Flux Pro defaults
            return (28, 3.5)

        # Non-FLUX FAL models (Dreamina/Seedream/etc.)
        return (30, 7.0)

    async def get_image_routing_for_use_case(
        self,
        use_case: str,
        companion_id: Optional[UUID] = None,
    ) -> list[DBImageRoutingEntry]:
        """Get image routing entries for a use case.

        Uses companion overrides if present, otherwise platform defaults.

        Args:
            use_case: The image use case type.
            companion_id: Optional companion ID for overrides.

        Returns:
            list[DBImageRoutingEntry]: Ordered list of routing entries.
        """
        await self.refresh_if_needed()

        if companion_id:
            # Use database function for companion-specific routing
            return await self._repository.get_effective_image_routing(companion_id, use_case)

        # Return cached platform defaults
        if self._cache is None:
            return []
        return self._cache.routing_rules.get(use_case, [])

    async def get_image_model_for_use_case(
        self,
        use_case: str,
        companion_id: Optional[UUID] = None,
        require_nsfw: bool = False,
        require_ip_adapter: bool = False,
    ) -> Optional[ImageModelSpec]:
        """Get the best image model for a use case.

        Args:
            use_case: The image use case type.
            companion_id: Optional companion ID for overrides.
            require_nsfw: If True, only return NSFW-capable models.
            require_ip_adapter: If True, only return IP-Adapter capable models.

        Returns:
            Optional[ImageModelSpec]: The best matching model, or None if not found.
        """
        entries = await self.get_image_routing_for_use_case(use_case, companion_id)

        for entry in entries:
            model = IMAGE_MODEL_REGISTRY.get(entry.model_id)
            if model is None:
                continue

            # Check NSFW requirement
            if require_nsfw and not model.nsfw_capable:
                continue

            # Check IP-Adapter requirement
            if require_ip_adapter and not model.supports_ip_adapter:
                continue

            return model

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

    def get_available_providers(self) -> list[ImageProviderType]:
        """Get list of currently available image providers.

        Returns:
            List of available provider names.
        """
        if self._cache is None:
            return []

        return [
            p  # type: ignore
            for p, enabled in self._cache.provider_status.items()
            if enabled
        ]

    def get_models_by_provider(self, provider: str) -> list[DBImageModelConfig]:
        """Get all cached models for a specific provider.

        Args:
            provider: The provider name.

        Returns:
            List of DBImageModelConfig for the provider.
        """
        if self._cache is None:
            return []

        return [m for m in self._cache.models if m.provider == provider]

    def get_nsfw_capable_models(self) -> list[DBImageModelConfig]:
        """Get all NSFW-capable models from cache.

        Returns:
            List of NSFW-capable DBImageModelConfig.
        """
        if self._cache is None:
            return []

        return [m for m in self._cache.models if m.nsfw_capable]

    def get_ip_adapter_capable_models(self) -> list[DBImageModelConfig]:
        """Get all IP-Adapter capable models from cache.

        Returns:
            List of IP-Adapter capable DBImageModelConfig.
        """
        if self._cache is None:
            return []

        return [m for m in self._cache.models if m.supports_ip_adapter]
