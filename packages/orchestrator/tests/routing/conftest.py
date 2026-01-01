"""Shared fixtures for routing integration tests."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.conversation import CompanionSpec
from orchestrator.routing import (
    ContentCapability,
    ContentIntent,
    IntentDetector,
    IntentResult,
    ModelRouter,
    ModelSpec,
    ModelTier,
    PROVIDER_HEALTH,
    ProviderHealth,
)


# -----------------------------------------------------------------------------
# Mock Intent Detector
# -----------------------------------------------------------------------------


class MockIntentDetector:
    """Configurable mock intent detector for testing routing logic."""

    def __init__(
        self,
        default_intent: ContentIntent = ContentIntent.SAFE,
        default_confidence: float = 0.95,
    ):
        self._default_intent = default_intent
        self._default_confidence = default_confidence
        self._overrides: dict[str, IntentResult] = {}
        self._initialized = True

    def set_intent_for_message(
        self,
        message: str,
        intent: ContentIntent,
        confidence: float = 0.95,
    ) -> None:
        """Configure a specific intent result for a message pattern."""
        self._overrides[message.lower()] = IntentResult(
            intent=intent,
            confidence=confidence,
            detection_method="mock",
            latency_ms=1.0,
            raw_scores={intent.value: confidence},
        )

    async def initialize(self) -> bool:
        """Mock initialization always succeeds."""
        return True

    async def detect(self, text: str) -> IntentResult:
        """Return configured intent or default."""
        text_lower = text.lower()

        # Check exact matches first
        if text_lower in self._overrides:
            return self._overrides[text_lower]

        # Check partial matches
        for pattern, result in self._overrides.items():
            if pattern in text_lower:
                return result

        # Return default
        return IntentResult(
            intent=self._default_intent,
            confidence=self._default_confidence,
            detection_method="mock",
            latency_ms=1.0,
            raw_scores={self._default_intent.value: self._default_confidence},
        )

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def has_embedding_model(self) -> bool:
        return True

    @property
    def has_classifier(self) -> bool:
        return True


@pytest.fixture
def mock_intent_detector() -> MockIntentDetector:
    """Create a mock intent detector with configurable responses."""
    detector = MockIntentDetector()

    # Pre-configure common test patterns
    detector.set_intent_for_message("hello", ContentIntent.SAFE, 0.95)
    detector.set_intent_for_message("how are you", ContentIntent.SAFE, 0.92)
    detector.set_intent_for_message("what's the weather", ContentIntent.SAFE, 0.90)

    detector.set_intent_for_message("you're cute", ContentIntent.FLIRTY, 0.85)
    detector.set_intent_for_message("i like you", ContentIntent.FLIRTY, 0.80)

    detector.set_intent_for_message("what are you wearing", ContentIntent.SUGGESTIVE, 0.88)
    detector.set_intent_for_message("i wish you were here", ContentIntent.SUGGESTIVE, 0.82)

    detector.set_intent_for_message("explicit content", ContentIntent.EXPLICIT, 0.95)
    detector.set_intent_for_message("nsfw message", ContentIntent.EXPLICIT, 0.92)

    detector.set_intent_for_message("let's pretend we're pirates", ContentIntent.ROLEPLAY_SFW, 0.90)
    detector.set_intent_for_message("roleplay adventure", ContentIntent.ROLEPLAY_SFW, 0.88)

    detector.set_intent_for_message("roleplay something naughty", ContentIntent.ROLEPLAY_NSFW, 0.93)
    detector.set_intent_for_message("be my lover", ContentIntent.ROLEPLAY_NSFW, 0.90)

    return detector


# -----------------------------------------------------------------------------
# Test Settings
# -----------------------------------------------------------------------------


@pytest.fixture
def mock_settings() -> dict[str, Any]:
    """Test settings with routing enabled."""
    return {
        "environment": "test",
        "content_routing_enabled": True,
        "semantic_routing_threshold": 0.75,
        "classifier_routing_threshold": 0.6,
        "prefer_local_models": True,
        "prefer_abliterated_for_adult": True,
        "safety_enabled": True,
        "safety_level": "adult",
        "intent_detection_enabled": True,
        "ollama_enabled": True,
        "ollama_abliterated_models": [
            "huihui_ai/qwen3-abliterated:8b",
            "dolphin-llama3:8b",
            "nous-hermes-3:8b",
        ],
    }


@pytest.fixture
def routing_settings() -> Settings:
    """Full Settings object for integration tests."""
    return Settings(
        environment="development",
        content_routing_enabled=True,
        semantic_routing_threshold=0.75,
        classifier_routing_threshold=0.6,
        prefer_local_models=True,
        prefer_abliterated_for_adult=True,
        safety_enabled=True,
        safety_level="adult",
        intent_detection_enabled=True,
        ollama_enabled=True,
        anthropic_api_key="test-key",
        openai_api_key="test-key",
    )


# -----------------------------------------------------------------------------
# Sample Companion Specs
# -----------------------------------------------------------------------------


def create_companion_spec(
    name: str,
    safety_level: str = "standard",
    allowed_tools: list[str] | None = None,
) -> CompanionSpec:
    """Create a companion spec for testing."""
    return CompanionSpec(
        id=uuid4(),
        name=name,
        description=f"Test companion: {name}",
        personality_traits=["friendly", "helpful"],
        communication_style="conversational",
        system_prompt=f"You are {name}, a helpful test companion.",
        safety_level=safety_level,
        allowed_tools=allowed_tools or [],
        max_context_turns=20,
        temperature=0.7,
    )


@pytest.fixture
def sample_companion_specs() -> dict[str, CompanionSpec]:
    """Companions with different safety levels for testing."""
    return {
        "strict": create_companion_spec("StrictBot", safety_level="strict"),
        "standard": create_companion_spec("StandardBot", safety_level="standard"),
        "permissive": create_companion_spec("PermissiveBot", safety_level="permissive"),
        "adult": create_companion_spec("AdultBot", safety_level="adult"),
        "tool_user": create_companion_spec(
            "ToolBot",
            safety_level="adult",
            allowed_tools=["search", "calculator", "image_gen"],
        ),
    }


@pytest.fixture
def standard_companion(sample_companion_specs: dict[str, CompanionSpec]) -> CompanionSpec:
    """Get the standard safety level companion."""
    return sample_companion_specs["standard"]


@pytest.fixture
def adult_companion(sample_companion_specs: dict[str, CompanionSpec]) -> CompanionSpec:
    """Get the adult safety level companion."""
    return sample_companion_specs["adult"]


@pytest.fixture
def strict_companion(sample_companion_specs: dict[str, CompanionSpec]) -> CompanionSpec:
    """Get the strict safety level companion."""
    return sample_companion_specs["strict"]


# -----------------------------------------------------------------------------
# Model Router Fixture
# -----------------------------------------------------------------------------


@pytest.fixture
def model_router(mock_intent_detector: MockIntentDetector) -> ModelRouter:
    """Create a model router with mock intent detector."""
    return ModelRouter(
        intent_detector=mock_intent_detector,
        prefer_local=True,
        prefer_fast=False,
    )


# -----------------------------------------------------------------------------
# Event Emitter Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def mock_event_emitter() -> EventEmitter:
    """Create a mock event emitter that tracks emitted events."""
    emitter = EventEmitter()
    emitter._emitted_events: list[Any] = []

    original_emit = emitter.emit

    async def tracking_emit(event):
        emitter._emitted_events.append(event)
        await original_emit(event)

    emitter.emit = tracking_emit
    return emitter


@pytest.fixture
def event_collector() -> list[Any]:
    """Simple list to collect emitted events."""
    return []


# -----------------------------------------------------------------------------
# Provider Health Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def reset_provider_health():
    """Reset provider health to default state before each test."""
    # Store original state
    original_state = {
        provider: ProviderHealth(
            provider=health.provider,
            is_available=health.is_available,
            error_count=health.error_count,
            avg_latency_ms=health.avg_latency_ms,
        )
        for provider, health in PROVIDER_HEALTH.items()
    }

    # Reset to healthy state
    for provider in PROVIDER_HEALTH:
        PROVIDER_HEALTH[provider].is_available = True
        PROVIDER_HEALTH[provider].error_count = 0
        PROVIDER_HEALTH[provider].last_error = None

    yield

    # Restore original state
    for provider, original in original_state.items():
        PROVIDER_HEALTH[provider].is_available = original.is_available
        PROVIDER_HEALTH[provider].error_count = original.error_count
        PROVIDER_HEALTH[provider].avg_latency_ms = original.avg_latency_ms


@pytest.fixture
def unhealthy_anthropic(reset_provider_health):
    """Mark Anthropic provider as unhealthy."""
    PROVIDER_HEALTH["anthropic"].is_available = False
    PROVIDER_HEALTH["anthropic"].error_count = 5
    PROVIDER_HEALTH["anthropic"].last_error = "Connection timeout"
    yield
    PROVIDER_HEALTH["anthropic"].is_available = True


@pytest.fixture
def unhealthy_openai(reset_provider_health):
    """Mark OpenAI provider as unhealthy."""
    PROVIDER_HEALTH["openai"].is_available = False
    PROVIDER_HEALTH["openai"].error_count = 3
    PROVIDER_HEALTH["openai"].last_error = "Rate limited"
    yield
    PROVIDER_HEALTH["openai"].is_available = True


@pytest.fixture
def unhealthy_ollama(reset_provider_health):
    """Mark Ollama provider as unhealthy."""
    PROVIDER_HEALTH["ollama"].is_available = False
    PROVIDER_HEALTH["ollama"].error_count = 1
    PROVIDER_HEALTH["ollama"].last_error = "Service unavailable"
    yield
    PROVIDER_HEALTH["ollama"].is_available = True


@pytest.fixture
def all_cloud_unhealthy(reset_provider_health):
    """Mark all cloud providers as unhealthy, leaving only local."""
    PROVIDER_HEALTH["anthropic"].is_available = False
    PROVIDER_HEALTH["openai"].is_available = False
    PROVIDER_HEALTH["together"].is_available = False
    PROVIDER_HEALTH["groq"].is_available = False
    yield


# -----------------------------------------------------------------------------
# Test Model Specs
# -----------------------------------------------------------------------------


@pytest.fixture
def test_model_specs() -> dict[str, ModelSpec]:
    """Sample model specs for testing."""
    return {
        "claude_sonnet": ModelSpec(
            model_id="claude-sonnet-4-20250514",
            provider="anthropic",
            display_name="Claude Sonnet 4",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
            supports_tools=True,
            supports_vision=True,
        ),
        "gpt4o": ModelSpec(
            model_id="gpt-4o",
            provider="openai",
            display_name="GPT-4o",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
            supports_tools=True,
            supports_vision=True,
        ),
        "qwen_abliterated": ModelSpec(
            model_id="huihui_ai/qwen3-abliterated:8b",
            provider="ollama",
            display_name="Qwen3 8B Abliterated",
            content_capability=ContentCapability.UNRESTRICTED,
            tier=ModelTier.LOCAL,
            supports_tools=True,
            supports_vision=False,
            is_abliterated=True,
            is_local=True,
        ),
        "dolphin": ModelSpec(
            model_id="dolphin-llama3:8b",
            provider="ollama",
            display_name="Dolphin Llama3 8B",
            content_capability=ContentCapability.UNRESTRICTED,
            tier=ModelTier.LOCAL,
            supports_tools=True,
            supports_vision=False,
            is_abliterated=True,
            is_local=True,
        ),
        "llama_sfw": ModelSpec(
            model_id="llama3.2:latest",
            provider="ollama",
            display_name="LLaMA 3.2",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.LOCAL,
            supports_tools=True,
            supports_vision=False,
            is_abliterated=False,
            is_local=True,
        ),
    }


# -----------------------------------------------------------------------------
# Session/Context Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def test_session_ids() -> dict[str, Any]:
    """Generate consistent test IDs."""
    return {
        "session_id": uuid4(),
        "user_id": uuid4(),
        "companion_id": uuid4(),
        "turn_id": uuid4(),
    }
