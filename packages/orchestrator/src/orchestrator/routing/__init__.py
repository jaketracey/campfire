"""
Content routing package for NSFW detection and dynamic model selection.

This package provides:
- IntentDetector: Two-phase NSFW intent detection (semantic + classifier)
- ModelRouter: Dynamic model selection based on content and companion settings
- Model registry: Capability matrix for all available models/providers
"""

from orchestrator.routing.model_registry import (
    ContentCapability,
    ModelTier,
    ModelSpec,
    ProviderHealth,
    MODEL_REGISTRY,
    PROVIDER_HEALTH,
    get_model,
    get_models_by_capability,
    get_models_by_provider,
    register_model,
)

from orchestrator.routing.intent_detector import (
    ContentIntent,
    IntentResult,
    IntentDetector,
)

from orchestrator.routing.model_router import (
    InferenceDefaults,
    UseCaseRoutingResult,
    RoutingDecision,
    ModelRouter,
    SAFETY_LEVEL_TO_CAPABILITY,
    INTENT_TO_MIN_CAPABILITY,
)

__all__ = [
    # Model Registry
    "ContentCapability",
    "ModelTier",
    "ModelSpec",
    "ProviderHealth",
    "MODEL_REGISTRY",
    "PROVIDER_HEALTH",
    "get_model",
    "get_models_by_capability",
    "get_models_by_provider",
    "register_model",
    # Intent Detection
    "ContentIntent",
    "IntentResult",
    "IntentDetector",
    # Model Router
    "InferenceDefaults",
    "UseCaseRoutingResult",
    "RoutingDecision",
    "ModelRouter",
    "SAFETY_LEVEL_TO_CAPABILITY",
    "INTENT_TO_MIN_CAPABILITY",
]
