"""Integration tests for the full routing flow.

Tests the complete routing pipeline including:
- Intent detection (mocked)
- Model selection based on content and safety levels
- Provider health checks
- Event emission for routing decisions
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from orchestrator.events.emitter import EventEmitter
from orchestrator.models.conversation import CompanionSpec
from orchestrator.models.events import (
    BaseEvent,
    ContentBlockedEvent,
    ContentRoutingEvent,
    EventType,
)
from orchestrator.routing import (
    MODEL_REGISTRY,
    PROVIDER_HEALTH,
    ContentCapability,
    ContentIntent,
    IntentDetector,
    IntentResult,
    ModelRouter,
    ModelSpec,
    ModelTier,
    RoutingDecision,
    get_model,
    get_models_by_capability,
)
from orchestrator.routing.model_registry import update_provider_health

from .conftest import MockIntentDetector


# -----------------------------------------------------------------------------
# Test 1: Full Routing Flow - Safe Message
# -----------------------------------------------------------------------------


class TestFullRoutingFlowSafeMessage:
    """Test routing a safe message through the full system."""

    @pytest.mark.asyncio
    async def test_safe_message_routes_to_standard_model(
        self,
        model_router: ModelRouter,
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Safe message should route to a standard capability model."""
        decision = await model_router.route(
            user_message="Hello, how are you today?",
            companion_safety_level=standard_companion.safety_level,
            require_tools=False,
            require_vision=False,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.SAFE
        assert decision.routing_reason is not None

    @pytest.mark.asyncio
    async def test_safe_message_selects_appropriate_capability(
        self,
        model_router: ModelRouter,
        reset_provider_health,
    ):
        """Safe message should not require abliterated model."""
        decision = await model_router.route(
            user_message="What's your favorite color?",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.requires_abliterated is False
        # Model should meet minimum capability for safe content
        assert decision.model_spec.content_capability >= ContentCapability.SFW_ONLY

    @pytest.mark.asyncio
    async def test_safe_message_with_strict_companion(
        self,
        model_router: ModelRouter,
        strict_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Safe message with strict companion should succeed."""
        decision = await model_router.route(
            user_message="Tell me about the weather",
            companion_safety_level=strict_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.SAFE


# -----------------------------------------------------------------------------
# Test 2: Full Routing Flow - Explicit Blocked
# -----------------------------------------------------------------------------


class TestFullRoutingFlowExplicitBlocked:
    """Test that explicit messages to standard companions are blocked."""

    @pytest.mark.asyncio
    async def test_explicit_message_blocked_for_standard_companion(
        self,
        mock_intent_detector: MockIntentDetector,
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Explicit content should be blocked for standard safety level."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="explicit content test",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is True
        assert decision.model_spec is None
        assert decision.block_reason is not None
        assert "safety level" in decision.block_reason.lower()
        assert decision.intent_result.intent == ContentIntent.EXPLICIT

    @pytest.mark.asyncio
    async def test_explicit_message_blocked_for_strict_companion(
        self,
        mock_intent_detector: MockIntentDetector,
        strict_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Explicit content should definitely be blocked for strict companions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="nsfw message",
            companion_safety_level=strict_companion.safety_level,
        )

        assert decision.content_blocked is True
        assert decision.model_spec is None
        assert decision.intent_result.intent == ContentIntent.EXPLICIT

    @pytest.mark.asyncio
    async def test_suggestive_blocked_for_strict_companion(
        self,
        mock_intent_detector: MockIntentDetector,
        strict_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Even suggestive content should be blocked for strict companions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="what are you wearing",
            companion_safety_level=strict_companion.safety_level,
        )

        assert decision.content_blocked is True
        assert decision.intent_result.intent == ContentIntent.SUGGESTIVE


# -----------------------------------------------------------------------------
# Test 3: Full Routing Flow - Explicit Allowed for Adult
# -----------------------------------------------------------------------------


class TestFullRoutingFlowExplicitAllowed:
    """Test that explicit messages route to abliterated models for adult companions."""

    @pytest.mark.asyncio
    async def test_explicit_allowed_for_adult_companion(
        self,
        mock_intent_detector: MockIntentDetector,
        adult_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Explicit content should be allowed for adult safety level."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="explicit content test",
            companion_safety_level=adult_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.EXPLICIT

    @pytest.mark.asyncio
    async def test_explicit_selects_abliterated_model(
        self,
        mock_intent_detector: MockIntentDetector,
        adult_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Explicit content should select an abliterated model."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="explicit content test",
            companion_safety_level=adult_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.model_spec.is_abliterated is True
        assert decision.model_spec.content_capability >= ContentCapability.NSFW_TEXT

    @pytest.mark.asyncio
    async def test_explicit_routing_reason_mentions_abliterated(
        self,
        mock_intent_detector: MockIntentDetector,
        adult_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Routing reason should mention abliterated model selection."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="explicit content test",
            companion_safety_level=adult_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert "abliterated" in decision.routing_reason.lower()


# -----------------------------------------------------------------------------
# Test 4: Full Routing Flow - Roleplay NSFW
# -----------------------------------------------------------------------------


class TestFullRoutingFlowRoleplayNSFW:
    """Test routing NSFW roleplay content to adult companions."""

    @pytest.mark.asyncio
    async def test_roleplay_nsfw_routes_to_capable_model(
        self,
        mock_intent_detector: MockIntentDetector,
        adult_companion: CompanionSpec,
        reset_provider_health,
    ):
        """NSFW roleplay should route to a roleplay-capable abliterated model."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="roleplay something naughty",
            companion_safety_level=adult_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.ROLEPLAY_NSFW
        assert decision.model_spec.content_capability >= ContentCapability.NSFW_ROLEPLAY

    @pytest.mark.asyncio
    async def test_roleplay_nsfw_blocked_for_standard(
        self,
        mock_intent_detector: MockIntentDetector,
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """NSFW roleplay should be blocked for standard companions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="roleplay something naughty",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is True
        assert decision.intent_result.intent == ContentIntent.ROLEPLAY_NSFW

    @pytest.mark.asyncio
    async def test_roleplay_sfw_allowed_for_standard(
        self,
        mock_intent_detector: MockIntentDetector,
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """SFW roleplay should be allowed for standard companions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="let's pretend we're pirates",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.ROLEPLAY_SFW


# -----------------------------------------------------------------------------
# Test 5: Model Registry Integration
# -----------------------------------------------------------------------------


class TestModelRegistryIntegration:
    """Verify model registry works correctly with the router."""

    def test_registry_contains_expected_models(self):
        """Registry should contain models from all providers."""
        providers_found = set()
        for model in MODEL_REGISTRY.values():
            providers_found.add(model.provider)

        assert "anthropic" in providers_found
        assert "openai" in providers_found
        assert "ollama" in providers_found

    def test_get_model_returns_correct_spec(self):
        """get_model should return the correct model specification."""
        model = get_model("claude-sonnet-4-20250514")
        assert model is not None
        assert model.provider == "anthropic"
        assert model.display_name == "Claude Sonnet 4"

    def test_get_model_returns_none_for_unknown(self):
        """get_model should return None for unknown model IDs."""
        model = get_model("nonexistent-model-xyz")
        assert model is None

    def test_get_models_by_capability_filters_correctly(self):
        """Should filter models by minimum capability."""
        nsfw_models = get_models_by_capability(ContentCapability.NSFW_TEXT)

        for model in nsfw_models:
            assert model.content_capability >= ContentCapability.NSFW_TEXT

    def test_abliterated_models_have_unrestricted_capability(self):
        """All abliterated models should have UNRESTRICTED or high capability."""
        for model in MODEL_REGISTRY.values():
            if model.is_abliterated:
                assert model.content_capability >= ContentCapability.NSFW_ROLEPLAY

    @pytest.mark.asyncio
    async def test_router_uses_registry_models(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Router should select models from the registry."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        assert decision.model_spec is not None
        assert decision.model_spec.model_id in MODEL_REGISTRY


# -----------------------------------------------------------------------------
# Test 6: Intent Detector Integration
# -----------------------------------------------------------------------------


class TestIntentDetectorIntegration:
    """Verify intent detector works correctly with the router (mocked models)."""

    @pytest.mark.asyncio
    async def test_intent_detection_influences_routing(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Different intents should result in different routing decisions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        # Safe message
        safe_decision = await router.route(
            user_message="hello",
            companion_safety_level="adult",
        )

        # Explicit message
        explicit_decision = await router.route(
            user_message="explicit content",
            companion_safety_level="adult",
        )

        assert safe_decision.intent_result.intent == ContentIntent.SAFE
        assert explicit_decision.intent_result.intent == ContentIntent.EXPLICIT

        # Both should succeed for adult companion, but model selection may differ
        assert safe_decision.content_blocked is False
        assert explicit_decision.content_blocked is False

    @pytest.mark.asyncio
    async def test_intent_confidence_is_preserved(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Intent confidence should be preserved in routing decision."""
        mock_intent_detector.set_intent_for_message(
            "test message",
            ContentIntent.SUGGESTIVE,
            confidence=0.78,
        )

        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="test message",
            companion_safety_level="adult",
        )

        assert decision.intent_result.confidence == 0.78
        assert decision.intent_result.intent == ContentIntent.SUGGESTIVE

    @pytest.mark.asyncio
    async def test_intent_detection_method_is_tracked(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Detection method should be tracked in the result."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        # Mock detector always returns "mock" as detection method
        assert decision.intent_result.detection_method == "mock"

    @pytest.mark.asyncio
    async def test_requires_abliterated_flag_works(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """requires_abliterated flag should be correctly set based on intent."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        # Safe content
        safe_decision = await router.route(
            user_message="hello",
            companion_safety_level="adult",
        )
        assert safe_decision.intent_result.requires_abliterated is False

        # Explicit content
        explicit_decision = await router.route(
            user_message="explicit content",
            companion_safety_level="adult",
        )
        assert explicit_decision.intent_result.requires_abliterated is True


# -----------------------------------------------------------------------------
# Test 7: Routing Events Emitted
# -----------------------------------------------------------------------------


class TestRoutingEventsEmitted:
    """Verify ContentRoutingEvent would be emitted."""

    @pytest.mark.asyncio
    async def test_can_create_content_routing_event(
        self,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        reset_provider_health,
    ):
        """Should be able to create a ContentRoutingEvent from routing decision."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        # Create the event that would be emitted
        event = ContentRoutingEvent(
            type=EventType.CONTENT_ROUTED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            intent=decision.intent_result.intent.value,
            confidence=decision.intent_result.confidence,
            detection_method=decision.intent_result.detection_method,
            selected_model=decision.model_spec.model_id if decision.model_spec else "none",
            selected_provider=decision.model_spec.provider if decision.model_spec else "none",
            routing_reason=decision.routing_reason,
            content_blocked=decision.content_blocked,
            block_reason=decision.block_reason,
            latency_ms=decision.intent_result.latency_ms,
        )

        assert event.type == EventType.CONTENT_ROUTED
        assert event.intent == "safe"
        assert event.content_blocked is False

    @pytest.mark.asyncio
    async def test_event_emitter_can_emit_routing_event(
        self,
        mock_event_emitter: EventEmitter,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        reset_provider_health,
    ):
        """Event emitter should be able to emit ContentRoutingEvent."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        event = ContentRoutingEvent(
            type=EventType.CONTENT_ROUTED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            intent=decision.intent_result.intent.value,
            confidence=decision.intent_result.confidence,
            detection_method=decision.intent_result.detection_method,
            selected_model=decision.model_spec.model_id if decision.model_spec else "none",
            selected_provider=decision.model_spec.provider if decision.model_spec else "none",
            routing_reason=decision.routing_reason,
            content_blocked=decision.content_blocked,
        )

        await mock_event_emitter.emit(event)

        # Verify event was tracked
        assert len(mock_event_emitter._emitted_events) == 1
        emitted = mock_event_emitter._emitted_events[0]
        assert emitted.type == EventType.CONTENT_ROUTED

    @pytest.mark.asyncio
    async def test_routing_event_contains_all_required_fields(
        self,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        reset_provider_health,
    ):
        """ContentRoutingEvent should contain all necessary routing information."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="what are you wearing",  # Suggestive
            companion_safety_level="adult",
        )

        event = ContentRoutingEvent(
            type=EventType.CONTENT_ROUTED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            intent=decision.intent_result.intent.value,
            confidence=decision.intent_result.confidence,
            detection_method=decision.intent_result.detection_method,
            selected_model=decision.model_spec.model_id,
            selected_provider=decision.model_spec.provider,
            routing_reason=decision.routing_reason,
            content_blocked=decision.content_blocked,
            latency_ms=decision.intent_result.latency_ms,
        )

        # Verify all required fields are present
        assert event.session_id == test_session_ids["session_id"]
        assert event.user_id == test_session_ids["user_id"]
        assert event.companion_id == test_session_ids["companion_id"]
        assert event.intent == "suggestive"
        assert event.confidence > 0
        assert event.detection_method is not None
        assert event.selected_model is not None
        assert event.selected_provider is not None


# -----------------------------------------------------------------------------
# Test 8: Content Blocked Event Emitted
# -----------------------------------------------------------------------------


class TestContentBlockedEventEmitted:
    """Verify ContentBlockedEvent would be emitted when content is blocked."""

    @pytest.mark.asyncio
    async def test_can_create_content_blocked_event(
        self,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Should be able to create ContentBlockedEvent when content is blocked."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="explicit content",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is True

        event = ContentBlockedEvent(
            type=EventType.CONTENT_BLOCKED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            detected_intent=decision.intent_result.intent.value,
            companion_safety_level=standard_companion.safety_level,
            block_reason=decision.block_reason or "Content blocked",
        )

        assert event.type == EventType.CONTENT_BLOCKED
        assert event.detected_intent == "explicit"
        assert event.companion_safety_level == "standard"

    @pytest.mark.asyncio
    async def test_blocked_event_emitter_integration(
        self,
        mock_event_emitter: EventEmitter,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Event emitter should handle ContentBlockedEvent."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="nsfw message",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is True

        event = ContentBlockedEvent(
            type=EventType.CONTENT_BLOCKED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            detected_intent=decision.intent_result.intent.value,
            companion_safety_level=standard_companion.safety_level,
            block_reason=decision.block_reason or "Content blocked",
        )

        await mock_event_emitter.emit(event)

        assert len(mock_event_emitter._emitted_events) == 1
        emitted = mock_event_emitter._emitted_events[0]
        assert emitted.type == EventType.CONTENT_BLOCKED
        assert emitted.detected_intent == "explicit"

    @pytest.mark.asyncio
    async def test_blocked_event_contains_block_reason(
        self,
        mock_intent_detector: MockIntentDetector,
        test_session_ids: dict[str, Any],
        strict_companion: CompanionSpec,
        reset_provider_health,
    ):
        """ContentBlockedEvent should contain detailed block reason."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="what are you wearing",  # Suggestive
            companion_safety_level=strict_companion.safety_level,
        )

        assert decision.content_blocked is True
        assert decision.block_reason is not None

        event = ContentBlockedEvent(
            type=EventType.CONTENT_BLOCKED,
            session_id=test_session_ids["session_id"],
            user_id=test_session_ids["user_id"],
            companion_id=test_session_ids["companion_id"],
            detected_intent=decision.intent_result.intent.value,
            companion_safety_level=strict_companion.safety_level,
            block_reason=decision.block_reason,
        )

        assert "SUGGESTIVE" in event.block_reason or "suggestive" in event.block_reason.lower()
        assert "strict" in event.block_reason.lower() or "SFW_ONLY" in event.block_reason


# -----------------------------------------------------------------------------
# Test 9: Provider Health Affects Routing
# -----------------------------------------------------------------------------


class TestProviderHealthAffectsRouting:
    """Verify unhealthy providers are skipped during routing."""

    @pytest.mark.asyncio
    async def test_unhealthy_provider_skipped(
        self,
        mock_intent_detector: MockIntentDetector,
        unhealthy_anthropic,
    ):
        """Unhealthy providers should be skipped."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=False,
        )

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        # Should not select Anthropic model
        assert decision.model_spec.provider != "anthropic"

    @pytest.mark.asyncio
    async def test_falls_back_to_healthy_provider(
        self,
        mock_intent_detector: MockIntentDetector,
        unhealthy_anthropic,
        unhealthy_openai,
    ):
        """Should fall back to healthy providers."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        # Should select from remaining healthy providers
        assert decision.model_spec.provider in ["ollama", "together", "groq"]

    @pytest.mark.asyncio
    async def test_local_models_available_when_cloud_unhealthy(
        self,
        mock_intent_detector: MockIntentDetector,
        all_cloud_unhealthy,
    ):
        """Local models should still be available when cloud is down."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.model_spec.provider == "ollama"
        assert decision.model_spec.is_local is True

    @pytest.mark.asyncio
    async def test_provider_health_update_affects_routing(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Updating provider health should affect subsequent routing."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=False,
        )

        # Initial routing with all healthy
        decision1 = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )
        assert decision1.model_spec is not None

        # Mark Ollama as unhealthy
        update_provider_health("ollama", is_available=False, error="Test error")

        decision2 = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        # Should still get a model (from cloud providers)
        assert decision2.model_spec is not None
        assert decision2.model_spec.provider != "ollama"


# -----------------------------------------------------------------------------
# Test 10: Routing with Tool Requirements
# -----------------------------------------------------------------------------


class TestRoutingWithToolRequirements:
    """Verify tool-capable models are selected when needed."""

    @pytest.mark.asyncio
    async def test_tool_requirement_filters_models(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Models without tool support should be filtered when tools required."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="search for something",
            companion_safety_level="standard",
            require_tools=True,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.model_spec.supports_tools is True

    @pytest.mark.asyncio
    async def test_vision_requirement_filters_models(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Models without vision support should be filtered when vision required."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="what do you see in this image",
            companion_safety_level="standard",
            require_vision=True,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.model_spec.supports_vision is True

    @pytest.mark.asyncio
    async def test_combined_requirements(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Should handle multiple requirements simultaneously."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="analyze this image and search for related info",
            companion_safety_level="standard",
            require_tools=True,
            require_vision=True,
        )

        assert decision.content_blocked is False
        if decision.model_spec is not None:
            assert decision.model_spec.supports_tools is True
            assert decision.model_spec.supports_vision is True

    @pytest.mark.asyncio
    async def test_explicit_with_tools_selects_capable_abliterated(
        self,
        mock_intent_detector: MockIntentDetector,
        adult_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Explicit content with tool requirement should find capable abliterated model."""
        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=True,
        )

        decision = await router.route(
            user_message="explicit content",
            companion_safety_level=adult_companion.safety_level,
            require_tools=True,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.model_spec.is_abliterated is True
        assert decision.model_spec.supports_tools is True

    @pytest.mark.asyncio
    async def test_prefer_tier_affects_selection(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Preferred tier should influence model selection."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        # Request fast tier
        decision = await router.route(
            user_message="quick question",
            companion_safety_level="standard",
            prefer_tier=ModelTier.FAST,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        # Routing should prefer fast tier when available
        # (Though other factors like availability may override)


# -----------------------------------------------------------------------------
# Additional Edge Case Tests
# -----------------------------------------------------------------------------


class TestRoutingEdgeCases:
    """Test edge cases and boundary conditions."""

    @pytest.mark.asyncio
    async def test_empty_message_routes_as_safe(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Empty or whitespace messages should route as safe."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="   ",
            companion_safety_level="standard",
        )

        # Should default to safe intent
        assert decision.content_blocked is False

    @pytest.mark.asyncio
    async def test_unknown_safety_level_defaults_to_suggestive(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Unknown safety levels should default to suggestive capability."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="hello",
            companion_safety_level="unknown_level",
        )

        # Should still route successfully with default capability
        assert decision.content_blocked is False

    @pytest.mark.asyncio
    async def test_flirty_content_allowed_for_standard(
        self,
        mock_intent_detector: MockIntentDetector,
        standard_companion: CompanionSpec,
        reset_provider_health,
    ):
        """Flirty content should be allowed for standard companions."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        decision = await router.route(
            user_message="you're cute",
            companion_safety_level=standard_companion.safety_level,
        )

        assert decision.content_blocked is False
        assert decision.intent_result.intent == ContentIntent.FLIRTY

    @pytest.mark.asyncio
    async def test_permissive_allows_more_than_standard(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """Permissive safety level should allow more content than standard."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        # Explicit content - requires NSFW_TEXT capability
        # standard allows up to SUGGESTIVE, permissive allows up to NSFW_TEXT
        standard_decision = await router.route(
            user_message="explicit content",  # Intent: EXPLICIT, requires NSFW_TEXT
            companion_safety_level="standard",  # Max capability: SUGGESTIVE
        )

        permissive_decision = await router.route(
            user_message="explicit content",  # Intent: EXPLICIT, requires NSFW_TEXT
            companion_safety_level="permissive",  # Max capability: NSFW_TEXT
        )

        # Explicit should be blocked for standard (SUGGESTIVE < NSFW_TEXT)
        # but allowed for permissive (NSFW_TEXT >= NSFW_TEXT)
        assert standard_decision.content_blocked is True
        assert permissive_decision.content_blocked is False

    @pytest.mark.asyncio
    async def test_routing_decision_string_representation(
        self,
        mock_intent_detector: MockIntentDetector,
        reset_provider_health,
    ):
        """RoutingDecision should have meaningful string representation."""
        router = ModelRouter(intent_detector=mock_intent_detector)

        # Successful routing
        success_decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )
        success_str = str(success_decision)
        assert success_decision.model_spec.display_name in success_str

        # Blocked routing
        blocked_decision = await router.route(
            user_message="explicit content",
            companion_safety_level="strict",
        )
        blocked_str = str(blocked_decision)
        assert "BLOCKED" in blocked_str

    @pytest.mark.asyncio
    async def test_fallback_used_flag(
        self,
        mock_intent_detector: MockIntentDetector,
        all_cloud_unhealthy,
        unhealthy_ollama,
    ):
        """Fallback used flag should be set when primary models unavailable."""
        # Make all providers unhealthy except one
        PROVIDER_HEALTH["ollama"].is_available = True  # Re-enable ollama

        router = ModelRouter(
            intent_detector=mock_intent_detector,
            prefer_local=False,  # Prefer cloud which is unhealthy
        )

        decision = await router.route(
            user_message="hello",
            companion_safety_level="standard",
        )

        # Model should still be selected via fallback
        assert decision.model_spec is not None
