"""Image model router for intelligent image generation request routing.

Routes image generation requests to appropriate providers and models based on
use case, capability requirements, and provider availability. Supports
database-driven routing configuration with tier-based fallback.
"""

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID

import structlog

from orchestrator.routing.image_model_registry import (
    IMAGE_MODEL_REGISTRY,
    IMAGE_PROVIDER_HEALTH,
    ImageModelSpec,
    ImageModelTier,
    ImageProviderType,
)

if TYPE_CHECKING:
    from orchestrator.services.image_routing_config_service import ImageRoutingConfigService

logger = structlog.get_logger()


class ImageUseCase(str, Enum):
    """Use cases for image generation requests."""

    IMAGE_GENERATION = "image_generation"  # Standard image generation for chat
    IMAGE_ANCHOR = "image_anchor"  # Identity anchor images (high quality)
    IMAGE_VARIATION = "image_variation"  # Variations with IP-Adapter reference
    IMAGE_EDITING = "image_editing"  # Inpainting/outpainting
    GIFT_IMAGE = "gift_image"  # Gift image generation (stylized, 512x512)


@dataclass
class ImageRoutingDecision:
    """Result of image model routing decision."""

    provider: ImageProviderType | None
    model_id: str | None
    model_spec: ImageModelSpec | None
    tier: int
    routing_reason: str
    fallback_used: bool = False
    blocked: bool = False
    block_reason: str | None = None

    def __str__(self) -> str:
        if self.blocked:
            return f"BLOCKED: {self.block_reason}"
        if self.model_spec is None:
            return "NO MODEL AVAILABLE"
        return f"{self.model_spec.display_name} ({self.provider}) - {self.routing_reason}"


class ImageModelRouter:
    """Routes image generation requests to appropriate models.

    Supports both capability-based routing (filtering by NSFW, IP-Adapter support)
    and database-driven routing via ImageRoutingConfigService.
    """

    def __init__(
        self,
        prefer_local: bool = True,
        routing_config_service: Optional["ImageRoutingConfigService"] = None,
    ):
        """Initialize the image model router.

        Args:
            prefer_local: Whether to prefer local models (ComfyUI) over cloud.
            routing_config_service: Optional service for database-driven routing.
        """
        self._prefer_local = prefer_local
        self._routing_config_service = routing_config_service

        logger.info(
            "image_model_router_initialized",
            prefer_local=prefer_local,
            available_models=len(IMAGE_MODEL_REGISTRY),
            db_routing_enabled=routing_config_service is not None,
        )

    async def route_image_request(
        self,
        use_case: ImageUseCase | str,
        companion_id: UUID | str | None = None,
        requires_ip_adapter: bool = False,
        requires_nsfw: bool = False,
        preferred_resolution: tuple[int, int] = (768, 1024),
        prefer_quality: bool = False,
        prefer_speed: bool = False,
    ) -> ImageRoutingDecision:
        """Route an image generation request to the best available model.

        Args:
            use_case: The image use case type.
            companion_id: Optional companion ID for per-companion overrides.
            requires_ip_adapter: Whether IP-Adapter support is required.
            requires_nsfw: Whether NSFW content generation is required.
            preferred_resolution: Preferred output resolution (width, height).
            prefer_quality: Whether to prefer quality over speed.
            prefer_speed: Whether to prefer speed over quality.

        Returns:
            ImageRoutingDecision with selected provider and model.
        """
        # Normalize use_case to enum
        if isinstance(use_case, str):
            try:
                use_case = ImageUseCase(use_case)
            except ValueError:
                use_case = ImageUseCase.IMAGE_GENERATION

        # Normalize companion_id to UUID
        companion_uuid: UUID | None = None
        if companion_id is not None:
            if isinstance(companion_id, str):
                try:
                    companion_uuid = UUID(companion_id)
                except ValueError:
                    companion_uuid = None
            else:
                companion_uuid = companion_id

        logger.debug(
            "routing_image_request",
            use_case=use_case.value,
            companion_id=str(companion_uuid) if companion_uuid else None,
            requires_ip_adapter=requires_ip_adapter,
            requires_nsfw=requires_nsfw,
            preferred_resolution=preferred_resolution,
        )

        # Try database-driven routing first
        if self._routing_config_service is not None:
            db_result = await self._route_via_database(
                use_case=use_case,
                companion_id=companion_uuid,
                requires_ip_adapter=requires_ip_adapter,
                requires_nsfw=requires_nsfw,
            )
            if db_result is not None:
                return db_result

        # Fall back to capability-based routing
        return self._route_by_capabilities(
            use_case=use_case,
            requires_ip_adapter=requires_ip_adapter,
            requires_nsfw=requires_nsfw,
            preferred_resolution=preferred_resolution,
            prefer_quality=prefer_quality,
            prefer_speed=prefer_speed,
        )

    async def _route_via_database(
        self,
        use_case: ImageUseCase,
        companion_id: UUID | None,
        requires_ip_adapter: bool,
        requires_nsfw: bool,
    ) -> ImageRoutingDecision | None:
        """Attempt to route using database configuration.

        Args:
            use_case: The image use case type.
            companion_id: Optional companion ID for overrides.
            requires_ip_adapter: Whether IP-Adapter is required.
            requires_nsfw: Whether NSFW capability is required.

        Returns:
            ImageRoutingDecision if database routing succeeds, None otherwise.
        """
        if self._routing_config_service is None:
            return None

        try:
            entries = await self._routing_config_service.get_image_routing_for_use_case(
                use_case.value, companion_id
            )

            for entry in entries:
                model = IMAGE_MODEL_REGISTRY.get(entry.model_id)
                if model is None:
                    logger.debug(
                        "image_model_not_in_registry",
                        model_id=entry.model_id,
                        use_case=use_case.value,
                    )
                    continue

                # Check provider availability
                provider_health = IMAGE_PROVIDER_HEALTH.get(model.provider)
                if provider_health is None or not provider_health.is_available:
                    logger.debug(
                        "image_provider_unavailable",
                        provider=model.provider,
                        model_id=model.model_id,
                    )
                    continue

                # Check capability requirements
                if requires_ip_adapter and not model.supports_ip_adapter:
                    logger.debug(
                        "model_lacks_ip_adapter",
                        model_id=model.model_id,
                    )
                    continue

                if requires_nsfw and not model.nsfw_capable:
                    logger.debug(
                        "model_not_nsfw_capable",
                        model_id=model.model_id,
                    )
                    continue

                # Exclude models that require reference images for text-to-image use cases
                if model.requires_reference_image and use_case != ImageUseCase.IMAGE_VARIATION:
                    logger.debug(
                        "model_requires_reference_image_skipped",
                        model_id=model.model_id,
                        use_case=use_case.value,
                    )
                    continue

                logger.info(
                    "image_model_selected_by_database",
                    model_id=model.model_id,
                    provider=model.provider,
                    use_case=use_case.value,
                    tier=entry.tier,
                    weight=entry.weight,
                )

                return ImageRoutingDecision(
                    provider=model.provider,
                    model_id=model.model_id,
                    model_spec=model,
                    tier=entry.tier,
                    routing_reason=f"Database routing: tier {entry.tier}, weight {entry.weight}",
                    fallback_used=False,
                )

            logger.debug(
                "no_suitable_image_model_from_database",
                use_case=use_case.value,
                entries_checked=len(entries),
            )
            return None

        except Exception as e:
            logger.error(
                "database_image_routing_failed",
                use_case=use_case.value,
                error=str(e),
            )
            return None

    def _route_by_capabilities(
        self,
        use_case: ImageUseCase,
        requires_ip_adapter: bool,
        requires_nsfw: bool,
        preferred_resolution: tuple[int, int],
        prefer_quality: bool,
        prefer_speed: bool,
    ) -> ImageRoutingDecision:
        """Route based on model capabilities and preferences.

        Args:
            use_case: The image use case type.
            requires_ip_adapter: Whether IP-Adapter is required.
            requires_nsfw: Whether NSFW capability is required.
            preferred_resolution: Preferred output resolution.
            prefer_quality: Whether to prefer quality.
            prefer_speed: Whether to prefer speed.

        Returns:
            ImageRoutingDecision with best matching model.
        """
        candidates: list[tuple[float, ImageModelSpec]] = []

        for model in IMAGE_MODEL_REGISTRY.values():
            # Check provider availability
            provider_health = IMAGE_PROVIDER_HEALTH.get(model.provider)
            if provider_health is None or not provider_health.is_available:
                continue

            # Check capability requirements
            if requires_ip_adapter and not model.supports_ip_adapter:
                continue

            if requires_nsfw and not model.nsfw_capable:
                continue

            # Exclude models that require reference images for text-to-image use cases
            # (e.g., PuLID requires a reference image - it cannot do pure text-to-image)
            # Only allow requires_reference_image models for IMAGE_VARIATION use case
            if model.requires_reference_image and use_case != ImageUseCase.IMAGE_VARIATION:
                logger.debug(
                    "model_requires_reference_image_skipped",
                    model_id=model.model_id,
                    use_case=use_case.value,
                )
                continue

            # Check resolution capability
            max_w, max_h = model.max_resolution
            req_w, req_h = preferred_resolution
            if max_w < req_w or max_h < req_h:
                continue

            # Calculate score
            score = self._calculate_model_score(
                model=model,
                use_case=use_case,
                prefer_quality=prefer_quality,
                prefer_speed=prefer_speed,
            )

            candidates.append((score, model))

        if not candidates:
            # No models available - check if NSFW requirement is the issue
            if requires_nsfw:
                return ImageRoutingDecision(
                    provider=None,
                    model_id=None,
                    model_spec=None,
                    tier=0,
                    routing_reason="No NSFW-capable models available",
                    blocked=True,
                    block_reason="NSFW content requires local ComfyUI models which are unavailable",
                )

            return ImageRoutingDecision(
                provider=None,
                model_id=None,
                model_spec=None,
                tier=0,
                routing_reason="No suitable image models available",
                blocked=True,
                block_reason="No image generation models are currently available",
            )

        # Sort by score (descending) and select best
        candidates.sort(key=lambda x: x[0], reverse=True)
        best_score, best_model = candidates[0]

        # Determine tier based on model tier
        tier = 1 if best_model.tier in (ImageModelTier.QUALITY, ImageModelTier.LOCAL) else 2

        routing_reason = self._explain_selection(best_model, use_case)

        logger.info(
            "image_model_selected_by_capabilities",
            model_id=best_model.model_id,
            provider=best_model.provider,
            use_case=use_case.value,
            score=best_score,
            routing_reason=routing_reason,
        )

        return ImageRoutingDecision(
            provider=best_model.provider,
            model_id=best_model.model_id,
            model_spec=best_model,
            tier=tier,
            routing_reason=routing_reason,
            fallback_used=len(candidates) == 1,
        )

    def _calculate_model_score(
        self,
        model: ImageModelSpec,
        use_case: ImageUseCase,
        prefer_quality: bool,
        prefer_speed: bool,
    ) -> float:
        """Calculate a routing score for a model.

        Args:
            model: The model to score.
            use_case: The use case type.
            prefer_quality: Whether to prefer quality.
            prefer_speed: Whether to prefer speed.

        Returns:
            Numeric score (higher is better).
        """
        score = 0.0

        # Prefer local models when configured (+50)
        if self._prefer_local and model.is_local:
            score += 50.0

        # Use case specific scoring
        if use_case == ImageUseCase.IMAGE_ANCHOR:
            # Anchors need highest quality
            if model.tier == ImageModelTier.QUALITY:
                score += 40.0
            if model.supports_ip_adapter:
                score += 20.0

        elif use_case == ImageUseCase.IMAGE_VARIATION:
            # Variations require IP-Adapter
            if model.supports_ip_adapter:
                score += 50.0
            if model.tier == ImageModelTier.QUALITY:
                score += 20.0

        elif use_case == ImageUseCase.IMAGE_EDITING:
            # Editing needs inpainting support
            if model.supports_inpainting:
                score += 50.0

        elif use_case == ImageUseCase.GIFT_IMAGE:
            # Gift images - prefer quality stylized output
            if model.tier == ImageModelTier.STANDARD:
                score += 30.0
            elif model.tier == ImageModelTier.QUALITY:
                score += 25.0

        else:  # IMAGE_GENERATION
            # Standard generation - balance quality and speed
            if model.tier == ImageModelTier.STANDARD:
                score += 30.0
            elif model.tier == ImageModelTier.QUALITY:
                score += 20.0

        # Quality preference
        if prefer_quality:
            if model.tier == ImageModelTier.QUALITY:
                score += 30.0
            elif model.tier == ImageModelTier.STANDARD:
                score += 15.0

        # Speed preference
        if prefer_speed:
            if model.tier == ImageModelTier.FAST:
                score += 30.0
            # Lower generation time is better
            score -= model.avg_generation_time

        # Cost factor (lower is better, for non-local models)
        if not model.is_local:
            score -= model.cost_per_image * 10.0

        return score

    def _explain_selection(
        self,
        model: ImageModelSpec,
        use_case: ImageUseCase,
    ) -> str:
        """Generate human-readable explanation for model selection.

        Args:
            model: The selected model.
            use_case: The use case type.

        Returns:
            Explanation string.
        """
        reasons: list[str] = []

        # Use case reason
        if use_case == ImageUseCase.IMAGE_ANCHOR:
            reasons.append("high quality anchor generation")
        elif use_case == ImageUseCase.IMAGE_VARIATION:
            reasons.append("variation with reference support")
        elif use_case == ImageUseCase.IMAGE_EDITING:
            reasons.append("image editing capability")
        elif use_case == ImageUseCase.GIFT_IMAGE:
            reasons.append("gift image generation")
        else:
            reasons.append("standard image generation")

        # Model characteristics
        if model.is_local:
            reasons.append("local inference")
        if model.nsfw_capable:
            reasons.append("NSFW-capable")
        if model.supports_ip_adapter:
            reasons.append("IP-Adapter enabled")
        if model.tier == ImageModelTier.FAST:
            reasons.append("fast generation")
        elif model.tier == ImageModelTier.QUALITY:
            reasons.append("high quality")

        return "; ".join(reasons) if reasons else "default selection"

    def get_available_models_for_use_case(
        self,
        use_case: ImageUseCase | str,
        requires_nsfw: bool = False,
        requires_ip_adapter: bool = False,
    ) -> list[ImageModelSpec]:
        """Get all available models suitable for a use case.

        Args:
            use_case: The image use case type.
            requires_nsfw: Whether NSFW capability is required.
            requires_ip_adapter: Whether IP-Adapter is required.

        Returns:
            List of suitable ImageModelSpec.
        """
        if isinstance(use_case, str):
            try:
                use_case = ImageUseCase(use_case)
            except ValueError:
                use_case = ImageUseCase.IMAGE_GENERATION

        available: list[ImageModelSpec] = []

        for model in IMAGE_MODEL_REGISTRY.values():
            # Check provider availability
            provider_health = IMAGE_PROVIDER_HEALTH.get(model.provider)
            if provider_health is None or not provider_health.is_available:
                continue

            # Check capability requirements
            # Note: IP-Adapter check removed - FAL handles reference images via its own API
            if requires_ip_adapter and not model.supports_ip_adapter:
                continue

            if requires_nsfw and not model.nsfw_capable:
                continue

            # Use case specific requirements
            # Note: IMAGE_VARIATION no longer requires IP-Adapter - FAL handles this natively
            if use_case == ImageUseCase.IMAGE_EDITING and not model.supports_inpainting:
                continue

            available.append(model)

        return available
