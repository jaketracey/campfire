"""Dynamic model router for intelligent request routing.

Routes requests to appropriate models based on content intent,
companion safety settings, and provider availability. Supports
database-driven routing configuration with use-case-based model selection.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional
from uuid import UUID

import structlog

from orchestrator.routing.intent_detector import ContentIntent, IntentDetector, IntentResult
from orchestrator.routing.model_registry import (
    MODEL_REGISTRY,
    PROVIDER_HEALTH,
    ContentCapability,
    ModelSpec,
    ModelTier,
)

if TYPE_CHECKING:
    from orchestrator.services.routing_config_service import RoutingConfigService

logger = structlog.get_logger()


# Safety level to content capability mapping
SAFETY_LEVEL_TO_CAPABILITY: dict[str, ContentCapability] = {
    "adult": ContentCapability.UNRESTRICTED,
    "permissive": ContentCapability.NSFW_TEXT,
    "standard": ContentCapability.SUGGESTIVE,
    "strict": ContentCapability.SFW_ONLY,
}

# Intent to minimum required capability mapping
INTENT_TO_MIN_CAPABILITY: dict[ContentIntent, ContentCapability] = {
    ContentIntent.SAFE: ContentCapability.SFW_ONLY,
    ContentIntent.FLIRTY: ContentCapability.SFW_ONLY,
    ContentIntent.ROLEPLAY_SFW: ContentCapability.SFW_ONLY,
    ContentIntent.SUGGESTIVE: ContentCapability.SUGGESTIVE,
    ContentIntent.EXPLICIT: ContentCapability.NSFW_TEXT,
    ContentIntent.ROLEPLAY_NSFW: ContentCapability.NSFW_ROLEPLAY,
}


@dataclass
class InferenceDefaults:
    """Inference parameter defaults from routing rule metadata."""

    temperature: float | None = None

    @classmethod
    def from_metadata(cls, metadata: dict) -> "InferenceDefaults":
        """Extract inference defaults from routing rule metadata.

        Reads keys like 'default_temperature' from the routing rule's
        metadata JSONB field.
        """
        temperature = metadata.get("default_temperature")
        if temperature is not None:
            try:
                temperature = float(temperature)
            except (TypeError, ValueError):
                temperature = None
        return cls(temperature=temperature)


@dataclass
class UseCaseRoutingResult:
    """Result of use-case-based model routing."""

    model_spec: ModelSpec
    inference_defaults: InferenceDefaults


@dataclass
class RoutingDecision:
    """Result of model routing decision."""

    model_spec: ModelSpec | None
    intent_result: IntentResult
    routing_reason: str
    fallback_used: bool = False
    content_blocked: bool = False
    block_reason: str | None = None

    def __str__(self) -> str:
        if self.content_blocked:
            return f"BLOCKED: {self.block_reason}"
        if self.model_spec is None:
            return "NO MODEL AVAILABLE"
        return f"{self.model_spec.display_name} - {self.routing_reason}"


class ModelRouter:
    """Routes requests to appropriate models based on content and settings.

    Supports both intent-based routing (analyzing user message content) and
    use-case-based routing (using database-configured rules).
    """

    def __init__(
        self,
        intent_detector: IntentDetector,
        prefer_local: bool = True,
        prefer_fast: bool = False,
        routing_config_service: Optional["RoutingConfigService"] = None,
    ):
        """Initialize the model router.

        Args:
            intent_detector: Intent detector instance for content analysis.
            prefer_local: Whether to prefer local models when suitable.
            prefer_fast: Whether to prefer faster models over quality.
            routing_config_service: Optional service for database-driven routing.
        """
        self._intent_detector = intent_detector
        self._prefer_local = prefer_local
        self._prefer_fast = prefer_fast
        self._routing_config_service = routing_config_service

        logger.info(
            "model_router_initialized",
            prefer_local=prefer_local,
            prefer_fast=prefer_fast,
            available_models=len(MODEL_REGISTRY),
            db_routing_enabled=routing_config_service is not None,
        )

    async def route(
        self,
        user_message: str,
        companion_safety_level: str,
        require_tools: bool = False,
        require_vision: bool = False,
        prefer_tier: ModelTier | None = None,
    ) -> RoutingDecision:
        """Route a request to the most appropriate model.

        Args:
            user_message: The user's message to analyze.
            companion_safety_level: Safety level from companion settings
                ("adult", "permissive", "standard", "strict").
            require_tools: Whether tool support is required.
            require_vision: Whether vision support is required.
            prefer_tier: Optional preferred model tier.

        Returns:
            RoutingDecision with selected model or block reason.
        """
        # Detect content intent
        intent_result = await self._intent_detector.detect(user_message)

        logger.debug(
            "routing_intent_detected",
            intent=intent_result.intent.value,
            confidence=intent_result.confidence,
            requires_abliterated=intent_result.requires_abliterated,
        )

        # Get capability limits
        max_capability = SAFETY_LEVEL_TO_CAPABILITY.get(
            companion_safety_level.lower(),
            ContentCapability.SUGGESTIVE,
        )
        min_capability = INTENT_TO_MIN_CAPABILITY.get(
            intent_result.intent,
            ContentCapability.SFW_ONLY,
        )

        # Check if content exceeds companion's safety level
        if min_capability > max_capability:
            block_reason = (
                f"Content intent '{intent_result.intent.value}' requires "
                f"capability level {min_capability.name}, but companion safety "
                f"level '{companion_safety_level}' only allows up to {max_capability.name}"
            )
            logger.warning(
                "content_blocked_safety_level",
                intent=intent_result.intent.value,
                min_capability=min_capability.name,
                max_capability=max_capability.name,
                companion_safety_level=companion_safety_level,
            )
            return RoutingDecision(
                model_spec=None,
                intent_result=intent_result,
                routing_reason="Content blocked due to safety level",
                content_blocked=True,
                block_reason=block_reason,
            )

        # Find best model matching requirements
        prefer_abliterated = intent_result.requires_abliterated
        selected_model = self._find_best_model(
            max_capability=max_capability,
            min_capability=min_capability,
            require_tools=require_tools,
            require_vision=require_vision,
            prefer_tier=prefer_tier or (ModelTier.FAST if self._prefer_fast else None),
            prefer_abliterated=prefer_abliterated,
        )

        fallback_used = False
        if selected_model is None:
            # Try fallback to any available model
            logger.warning(
                "no_ideal_model_found",
                min_capability=min_capability.name,
                max_capability=max_capability.name,
                require_tools=require_tools,
                require_vision=require_vision,
            )
            selected_model = self._find_any_available_model()
            fallback_used = selected_model is not None

        if selected_model is None:
            logger.error("no_models_available")
            return RoutingDecision(
                model_spec=None,
                intent_result=intent_result,
                routing_reason="No suitable models available",
                fallback_used=False,
                content_blocked=False,
            )

        routing_reason = self._explain_selection(selected_model, intent_result)

        logger.info(
            "model_selected",
            model_id=selected_model.model_id,
            provider=selected_model.provider,
            intent=intent_result.intent.value,
            fallback_used=fallback_used,
            routing_reason=routing_reason,
        )

        return RoutingDecision(
            model_spec=selected_model,
            intent_result=intent_result,
            routing_reason=routing_reason,
            fallback_used=fallback_used,
            content_blocked=False,
        )

    async def route_by_use_case(
        self,
        use_case: str,
        companion_id: Optional[UUID] = None,
        require_abliterated: bool = False,
        require_sfw: bool = False,
    ) -> UseCaseRoutingResult | None:
        """Route by use case using database configuration.

        Uses the routing_config_service to get database-configured routing
        rules for the specified use case. Falls back to None if no service
        is configured or no suitable model is found.

        Args:
            use_case: The use case type (e.g., 'chat_simple', 'chat_complex').
            companion_id: Optional companion ID for per-companion overrides.
            require_abliterated: If True, only return abliterated models.
            require_sfw: If True, only return SFW-capable models.

        Returns:
            UseCaseRoutingResult with the model and inference defaults,
            or None if not found.
        """
        if self._routing_config_service is None:
            logger.debug(
                "route_by_use_case_skipped",
                reason="no_routing_config_service",
                use_case=use_case,
            )
            return None

        try:
            entries = await self._routing_config_service.get_routing_for_use_case(
                use_case, companion_id
            )

            for entry in entries:
                model = MODEL_REGISTRY.get(entry.model_id)
                if model is None:
                    logger.debug(
                        "model_not_in_registry",
                        model_id=entry.model_id,
                        use_case=use_case,
                    )
                    continue

                # Check provider availability
                provider_health = PROVIDER_HEALTH.get(model.provider)
                if provider_health is None or not provider_health.is_available:
                    logger.debug(
                        "provider_unavailable",
                        provider=model.provider,
                        model_id=model.model_id,
                    )
                    continue

                # Check abliterated requirement
                if require_abliterated and not model.is_abliterated:
                    continue

                # Check SFW requirement (skip models that are NSFW-only)
                if require_sfw and model.is_abliterated:
                    continue

                inference_defaults = InferenceDefaults.from_metadata(entry.metadata)

                logger.info(
                    "model_selected_by_use_case",
                    model_id=model.model_id,
                    provider=model.provider,
                    use_case=use_case,
                    tier=entry.tier,
                    weight=entry.weight,
                    companion_id=str(companion_id) if companion_id else None,
                    inference_defaults_temperature=inference_defaults.temperature,
                )
                return UseCaseRoutingResult(
                    model_spec=model,
                    inference_defaults=inference_defaults,
                )

            logger.debug(
                "no_suitable_model_for_use_case",
                use_case=use_case,
                entries_checked=len(entries),
                require_abliterated=require_abliterated,
                require_sfw=require_sfw,
            )
            return None

        except Exception as e:
            logger.error(
                "route_by_use_case_failed",
                use_case=use_case,
                error=str(e),
            )
            return None

    def _capability_level(self, capability: ContentCapability) -> int:
        """Get numeric level for capability comparison.

        Args:
            capability: The content capability.

        Returns:
            Integer level for comparison.
        """
        return capability.value

    def _find_best_model(
        self,
        max_capability: ContentCapability,
        min_capability: ContentCapability,
        require_tools: bool,
        require_vision: bool,
        prefer_tier: ModelTier | None,
        prefer_abliterated: bool,
    ) -> ModelSpec | None:
        """Find the best model matching requirements.

        Args:
            max_capability: Maximum allowed content capability.
            min_capability: Minimum required content capability.
            require_tools: Whether tool support is required.
            require_vision: Whether vision support is required.
            prefer_tier: Preferred model tier.
            prefer_abliterated: Whether to prefer abliterated models.

        Returns:
            Best matching ModelSpec or None.
        """
        candidates: list[tuple[float, ModelSpec]] = []

        for model in MODEL_REGISTRY.values():
            # Check provider availability
            provider_health = PROVIDER_HEALTH.get(model.provider)
            if provider_health is None or not provider_health.is_available:
                continue

            # Check capability constraints
            model_cap_level = self._capability_level(model.content_capability)
            min_cap_level = self._capability_level(min_capability)
            max_cap_level = self._capability_level(max_capability)

            if model_cap_level < min_cap_level:
                # Model cannot handle required content
                continue
            if model_cap_level > max_cap_level and not model.is_abliterated:
                # Non-abliterated model exceeds safety level (shouldn't happen)
                continue

            # Check feature requirements
            if require_tools and not model.supports_tools:
                continue
            if require_vision and not model.supports_vision:
                continue

            # Calculate score
            score = 0.0

            # Prefer abliterated models when needed (+100)
            if prefer_abliterated and model.is_abliterated:
                score += 100.0

            # Prefer local models when configured (+50)
            if self._prefer_local and model.is_local:
                score += 50.0

            # Prefer matching tier (+25)
            if prefer_tier is not None and model.tier == prefer_tier:
                score += 25.0

            # Factor in latency (lower is better, normalize to ~0-20 range)
            latency_penalty = min(model.avg_latency_ms / 100.0, 20.0)
            score -= latency_penalty

            # Factor in cost (lower is better, for non-local models)
            if not model.is_local:
                cost_penalty = (model.cost_per_1m_input + model.cost_per_1m_output) / 10.0
                score -= cost_penalty

            candidates.append((score, model))

        if not candidates:
            return None

        # Sort by score (descending) and return best
        candidates.sort(key=lambda x: x[0], reverse=True)

        logger.debug(
            "model_candidates_scored",
            candidate_count=len(candidates),
            top_score=candidates[0][0] if candidates else 0,
            top_model=candidates[0][1].model_id if candidates else None,
        )

        return candidates[0][1]

    def _find_any_available_model(self) -> ModelSpec | None:
        """Find any available model as fallback.

        Returns:
            Any available ModelSpec or None.
        """
        for model in MODEL_REGISTRY.values():
            provider_health = PROVIDER_HEALTH.get(model.provider)
            if provider_health is not None and provider_health.is_available:
                logger.debug(
                    "fallback_model_selected",
                    model_id=model.model_id,
                    provider=model.provider,
                )
                return model
        return None

    def _explain_selection(
        self,
        model: ModelSpec,
        intent: IntentResult,
    ) -> str:
        """Generate human-readable explanation for model selection.

        Args:
            model: The selected model.
            intent: The detected intent.

        Returns:
            Explanation string.
        """
        reasons: list[str] = []

        # Intent-based reason
        if intent.requires_abliterated and model.is_abliterated:
            reasons.append("abliterated model for unrestricted content")
        elif intent.intent == ContentIntent.SAFE:
            reasons.append("general purpose model for safe content")
        elif intent.intent in (ContentIntent.FLIRTY, ContentIntent.SUGGESTIVE):
            reasons.append(f"suitable for {intent.intent.value} content")
        elif intent.intent in (ContentIntent.ROLEPLAY_SFW, ContentIntent.ROLEPLAY_NSFW):
            reasons.append(f"roleplay-capable model")

        # Model characteristics
        if model.is_local:
            reasons.append("local inference")
        if model.tier == ModelTier.FAST:
            reasons.append("fast response")
        elif model.tier == ModelTier.FLAGSHIP:
            reasons.append("high quality")
        elif model.tier == ModelTier.STANDARD:
            reasons.append("balanced quality")

        if model.supports_vision:
            reasons.append("vision-enabled")
        if model.supports_tools:
            reasons.append("tool-capable")

        return "; ".join(reasons) if reasons else "default selection"
