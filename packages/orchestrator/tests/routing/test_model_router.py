"""
Comprehensive tests for the ModelRouter.

Tests routing decisions based on content intent, companion safety levels,
and model capabilities including abliterated model selection.

Test cases covered:
1.  test_safety_level_to_capability_mapping - verify all safety levels map correctly
2.  test_intent_to_min_capability_mapping - verify all intents map to correct capability
3.  test_routing_decision_creation - verify RoutingDecision dataclass
4.  test_route_safe_content_adult_companion - should select appropriate model
5.  test_route_explicit_content_adult_companion - should select abliterated model
6.  test_route_explicit_content_standard_companion - should block content
7.  test_route_explicit_content_strict_companion - should block content
8.  test_route_suggestive_content_permissive_companion - should allow
9.  test_route_suggestive_content_strict_companion - should block
10. test_capability_level_comparison - verify _capability_level returns correct ordering
11. test_find_best_model_prefers_abliterated - when requires_abliterated=True
12. test_find_best_model_prefers_local - when prefer_local=True
13. test_find_best_model_with_tool_requirement - filters by supports_tools
14. test_find_best_model_with_vision_requirement - filters by supports_vision
15. test_fallback_when_no_suitable_model - verify fallback behavior
16. test_content_blocked_routing_decision - verify content_blocked flag
17. test_explain_selection - verify human-readable explanation
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from orchestrator.routing import (
    ContentCapability,
    ContentIntent,
    IntentResult,
    ModelRouter,
    ModelSpec,
    ModelTier,
    RoutingDecision,
    INTENT_TO_MIN_CAPABILITY,
    PROVIDER_HEALTH,
    SAFETY_LEVEL_TO_CAPABILITY,
)

if TYPE_CHECKING:
    from tests.routing.conftest import MockIntentDetector


# ---------------------------------------------------------------------------
# Additional Fixtures (supplements conftest.py fixtures)
# ---------------------------------------------------------------------------


@pytest.fixture
def router(mock_intent_detector: "MockIntentDetector") -> ModelRouter:
    """Create a ModelRouter with mock intent detector."""
    return ModelRouter(
        intent_detector=mock_intent_detector,
        prefer_local=True,
        prefer_fast=False,
    )


@pytest.fixture
def router_prefer_fast(mock_intent_detector: "MockIntentDetector") -> ModelRouter:
    """Create a ModelRouter that prefers fast models."""
    return ModelRouter(
        intent_detector=mock_intent_detector,
        prefer_local=True,
        prefer_fast=True,
    )


@pytest.fixture
def all_providers_available():
    """Ensure all providers are marked as available."""
    original_health = {}
    for provider, health in PROVIDER_HEALTH.items():
        original_health[provider] = health.is_available
        health.is_available = True

    yield

    # Restore original state
    for provider, was_available in original_health.items():
        PROVIDER_HEALTH[provider].is_available = was_available


@pytest.fixture
def only_ollama_available():
    """Mark only ollama provider as available."""
    original_health = {}
    for provider, health in PROVIDER_HEALTH.items():
        original_health[provider] = health.is_available
        if provider == "ollama":
            health.is_available = True
        else:
            health.is_available = False

    yield

    # Restore original state
    for provider, was_available in original_health.items():
        PROVIDER_HEALTH[provider].is_available = was_available


@pytest.fixture
def no_providers_available():
    """Mark all providers as unavailable."""
    original_health = {}
    for provider, health in PROVIDER_HEALTH.items():
        original_health[provider] = health.is_available
        health.is_available = False

    yield

    # Restore original state
    for provider, was_available in original_health.items():
        PROVIDER_HEALTH[provider].is_available = was_available


# ---------------------------------------------------------------------------
# Test: Safety Level to Capability Mapping
# ---------------------------------------------------------------------------


class TestSafetyLevelToCapabilityMapping:
    """Test that all safety levels map correctly to content capabilities."""

    def test_adult_maps_to_unrestricted(self):
        """Adult safety level should allow unrestricted content."""
        assert SAFETY_LEVEL_TO_CAPABILITY["adult"] == ContentCapability.UNRESTRICTED

    def test_permissive_maps_to_nsfw_text(self):
        """Permissive safety level should allow NSFW text."""
        assert SAFETY_LEVEL_TO_CAPABILITY["permissive"] == ContentCapability.NSFW_TEXT

    def test_standard_maps_to_suggestive(self):
        """Standard safety level should allow suggestive content."""
        assert SAFETY_LEVEL_TO_CAPABILITY["standard"] == ContentCapability.SUGGESTIVE

    def test_strict_maps_to_sfw_only(self):
        """Strict safety level should only allow SFW content."""
        assert SAFETY_LEVEL_TO_CAPABILITY["strict"] == ContentCapability.SFW_ONLY

    def test_all_expected_levels_present(self):
        """All expected safety levels should be present in mapping."""
        expected_levels = {"adult", "permissive", "standard", "strict"}
        assert set(SAFETY_LEVEL_TO_CAPABILITY.keys()) == expected_levels

    def test_capability_ordering(self):
        """Capabilities should be ordered from most to least restrictive."""
        assert (
            SAFETY_LEVEL_TO_CAPABILITY["strict"]
            < SAFETY_LEVEL_TO_CAPABILITY["standard"]
            < SAFETY_LEVEL_TO_CAPABILITY["permissive"]
            < SAFETY_LEVEL_TO_CAPABILITY["adult"]
        )


# ---------------------------------------------------------------------------
# Test: Intent to Minimum Capability Mapping
# ---------------------------------------------------------------------------


class TestIntentToMinCapabilityMapping:
    """Test that all intents map to correct minimum capability."""

    def test_safe_intent_requires_sfw_only(self):
        """SAFE intent should require SFW_ONLY capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.SAFE] == ContentCapability.SFW_ONLY

    def test_flirty_intent_requires_sfw_only(self):
        """FLIRTY intent should require SFW_ONLY capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.FLIRTY] == ContentCapability.SFW_ONLY

    def test_roleplay_sfw_requires_sfw_only(self):
        """ROLEPLAY_SFW intent should require SFW_ONLY capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.ROLEPLAY_SFW] == ContentCapability.SFW_ONLY

    def test_suggestive_requires_suggestive(self):
        """SUGGESTIVE intent should require SUGGESTIVE capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.SUGGESTIVE] == ContentCapability.SUGGESTIVE

    def test_explicit_requires_nsfw_text(self):
        """EXPLICIT intent should require NSFW_TEXT capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.EXPLICIT] == ContentCapability.NSFW_TEXT

    def test_roleplay_nsfw_requires_nsfw_roleplay(self):
        """ROLEPLAY_NSFW intent should require NSFW_ROLEPLAY capability."""
        assert INTENT_TO_MIN_CAPABILITY[ContentIntent.ROLEPLAY_NSFW] == ContentCapability.NSFW_ROLEPLAY

    def test_all_intents_mapped(self):
        """All ContentIntent values should have a mapping."""
        for intent in ContentIntent:
            assert intent in INTENT_TO_MIN_CAPABILITY, f"Missing mapping for {intent}"


# ---------------------------------------------------------------------------
# Test: RoutingDecision Dataclass
# ---------------------------------------------------------------------------


class TestRoutingDecisionCreation:
    """Test RoutingDecision dataclass creation and behavior."""

    def test_basic_creation(self, mock_intent_detector: MockIntentDetector):
        """Test basic RoutingDecision creation with model."""
        model = ModelSpec(
            model_id="test-model",
            provider="anthropic",
            display_name="Test Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        intent_result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        decision = RoutingDecision(
            model_spec=model,
            intent_result=intent_result,
            routing_reason="Test routing",
        )

        assert decision.model_spec == model
        assert decision.intent_result == intent_result
        assert decision.routing_reason == "Test routing"
        assert decision.fallback_used is False
        assert decision.content_blocked is False
        assert decision.block_reason is None

    def test_str_with_model(self):
        """Test __str__ with a model selected."""
        model = ModelSpec(
            model_id="test-model",
            provider="anthropic",
            display_name="Test Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        intent_result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        decision = RoutingDecision(
            model_spec=model,
            intent_result=intent_result,
            routing_reason="general purpose model",
        )

        result_str = str(decision)
        assert "Test Model" in result_str
        assert "general purpose model" in result_str

    def test_str_when_blocked(self):
        """Test __str__ when content is blocked."""
        intent_result = IntentResult(
            intent=ContentIntent.EXPLICIT,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        decision = RoutingDecision(
            model_spec=None,
            intent_result=intent_result,
            routing_reason="blocked",
            content_blocked=True,
            block_reason="Content exceeds safety level",
        )

        result_str = str(decision)
        assert "BLOCKED" in result_str
        assert "Content exceeds safety level" in result_str

    def test_str_when_no_model(self):
        """Test __str__ when no model is available."""
        intent_result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        decision = RoutingDecision(
            model_spec=None,
            intent_result=intent_result,
            routing_reason="no models available",
        )

        result_str = str(decision)
        assert "NO MODEL AVAILABLE" in result_str

    def test_fallback_flag(self):
        """Test fallback_used flag."""
        model = ModelSpec(
            model_id="fallback-model",
            provider="anthropic",
            display_name="Fallback Model",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.STANDARD,
        )
        intent_result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        decision = RoutingDecision(
            model_spec=model,
            intent_result=intent_result,
            routing_reason="fallback",
            fallback_used=True,
        )

        assert decision.fallback_used is True


# ---------------------------------------------------------------------------
# Test: Route Safe Content with Adult Companion
# ---------------------------------------------------------------------------


class TestRouteSafeContentAdultCompanion:
    """Test routing safe content for adult companion."""

    @pytest.mark.asyncio
    async def test_route_safe_selects_model(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Safe content with adult companion should select appropriate model."""
        # Uses pre-configured "how are you" -> SAFE pattern from conftest
        decision = await router.route(
            user_message="how are you today?",
            companion_safety_level="adult",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.intent == ContentIntent.SAFE

    @pytest.mark.asyncio
    async def test_route_safe_no_abliterated_required(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Safe content should not require abliterated model."""
        # Uses pre-configured "hello" -> SAFE pattern from conftest
        decision = await router.route(
            user_message="hello there!",
            companion_safety_level="adult",
        )

        assert decision.intent_result.requires_abliterated is False


# ---------------------------------------------------------------------------
# Test: Route Explicit Content with Adult Companion
# ---------------------------------------------------------------------------


class TestRouteExplicitContentAdultCompanion:
    """Test routing explicit content for adult companion."""

    @pytest.mark.asyncio
    async def test_route_explicit_selects_abliterated(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Explicit content with adult companion should select abliterated model."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern from conftest
        decision = await router.route(
            user_message="explicit content request",
            companion_safety_level="adult",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.requires_abliterated is True
        # Should prefer abliterated model for explicit content
        if decision.model_spec.content_capability >= ContentCapability.NSFW_TEXT:
            assert decision.model_spec.is_abliterated or decision.model_spec.content_capability >= ContentCapability.UNRESTRICTED

    @pytest.mark.asyncio
    async def test_route_explicit_adult_not_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Explicit content should not be blocked for adult companion."""
        # Uses pre-configured "nsfw message" -> EXPLICIT pattern from conftest
        decision = await router.route(
            user_message="nsfw message here",
            companion_safety_level="adult",
        )

        assert decision.content_blocked is False
        assert decision.block_reason is None


# ---------------------------------------------------------------------------
# Test: Route Explicit Content with Standard Companion - Should Block
# ---------------------------------------------------------------------------


class TestRouteExplicitContentStandardCompanion:
    """Test routing explicit content for standard companion - should block."""

    @pytest.mark.asyncio
    async def test_route_explicit_standard_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Explicit content should be blocked for standard companion."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern from conftest
        decision = await router.route(
            user_message="explicit content request",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is True
        assert decision.model_spec is None
        assert decision.block_reason is not None
        assert "NSFW_TEXT" in decision.block_reason or "explicit" in decision.block_reason.lower()

    @pytest.mark.asyncio
    async def test_route_nsfw_roleplay_standard_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """NSFW roleplay should be blocked for standard companion."""
        # Uses pre-configured "roleplay something naughty" -> ROLEPLAY_NSFW pattern
        decision = await router.route(
            user_message="roleplay something naughty",
            companion_safety_level="standard",
        )

        assert decision.content_blocked is True


# ---------------------------------------------------------------------------
# Test: Route Explicit Content with Strict Companion - Should Block
# ---------------------------------------------------------------------------


class TestRouteExplicitContentStrictCompanion:
    """Test routing explicit content for strict companion - should block."""

    @pytest.mark.asyncio
    async def test_route_explicit_strict_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Explicit content should be blocked for strict companion."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content here",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is True
        assert decision.model_spec is None

    @pytest.mark.asyncio
    async def test_route_suggestive_strict_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Suggestive content should be blocked for strict companion."""
        # Uses pre-configured "what are you wearing" -> SUGGESTIVE pattern
        decision = await router.route(
            user_message="what are you wearing tonight?",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is True

    @pytest.mark.asyncio
    async def test_route_safe_strict_allowed(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Safe content should be allowed for strict companion."""
        # Uses pre-configured "hello" -> SAFE pattern
        decision = await router.route(
            user_message="hello, nice day today",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None


# ---------------------------------------------------------------------------
# Test: Route Suggestive Content with Permissive Companion - Should Allow
# ---------------------------------------------------------------------------


class TestRouteSuggestiveContentPermissiveCompanion:
    """Test routing suggestive content for permissive companion - should allow."""

    @pytest.mark.asyncio
    async def test_route_suggestive_permissive_allowed(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Suggestive content should be allowed for permissive companion."""
        # Uses pre-configured "i wish you were here" -> SUGGESTIVE pattern
        decision = await router.route(
            user_message="i wish you were here with me tonight",
            companion_safety_level="permissive",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None

    @pytest.mark.asyncio
    async def test_route_explicit_permissive_allowed(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Explicit content should be allowed for permissive companion."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content please",
            companion_safety_level="permissive",
        )

        assert decision.content_blocked is False


# ---------------------------------------------------------------------------
# Test: Route Suggestive Content with Strict Companion - Should Block
# ---------------------------------------------------------------------------


class TestRouteSuggestiveContentStrictCompanion:
    """Test routing suggestive content for strict companion - should block."""

    @pytest.mark.asyncio
    async def test_route_suggestive_strict_blocked(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Suggestive content should be blocked for strict companion."""
        # Uses pre-configured "i wish you were here" -> SUGGESTIVE pattern
        decision = await router.route(
            user_message="i wish you were here tonight",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is True
        assert decision.model_spec is None
        assert decision.block_reason is not None


# ---------------------------------------------------------------------------
# Test: Capability Level Comparison
# ---------------------------------------------------------------------------


class TestCapabilityLevelComparison:
    """Test _capability_level returns correct ordering."""

    def test_sfw_only_lowest(self, router: ModelRouter):
        """SFW_ONLY should have lowest level."""
        assert router._capability_level(ContentCapability.SFW_ONLY) == ContentCapability.SFW_ONLY.value

    def test_unrestricted_highest(self, router: ModelRouter):
        """UNRESTRICTED should have highest level."""
        assert router._capability_level(ContentCapability.UNRESTRICTED) == ContentCapability.UNRESTRICTED.value

    def test_ordering_correct(self, router: ModelRouter):
        """Capabilities should be ordered correctly."""
        sfw = router._capability_level(ContentCapability.SFW_ONLY)
        suggestive = router._capability_level(ContentCapability.SUGGESTIVE)
        nsfw_text = router._capability_level(ContentCapability.NSFW_TEXT)
        nsfw_roleplay = router._capability_level(ContentCapability.NSFW_ROLEPLAY)
        unrestricted = router._capability_level(ContentCapability.UNRESTRICTED)

        assert sfw < suggestive < nsfw_text < nsfw_roleplay < unrestricted

    def test_capability_levels_are_distinct(self, router: ModelRouter):
        """Each capability should have a distinct level."""
        levels = [router._capability_level(cap) for cap in ContentCapability]
        assert len(levels) == len(set(levels))


# ---------------------------------------------------------------------------
# Test: Find Best Model Prefers Abliterated
# ---------------------------------------------------------------------------


class TestFindBestModelPrefersAbliterated:
    """Test that _find_best_model prefers abliterated when required."""

    def test_prefers_abliterated_when_required(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """Should prefer abliterated model when prefer_abliterated=True."""
        result = router._find_best_model(
            max_capability=ContentCapability.UNRESTRICTED,
            min_capability=ContentCapability.NSFW_TEXT,
            require_tools=False,
            require_vision=False,
            prefer_tier=None,
            prefer_abliterated=True,
        )

        assert result is not None
        assert result.is_abliterated is True

    def test_non_abliterated_when_not_required(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """Non-abliterated models can be selected when abliterated not required."""
        result = router._find_best_model(
            max_capability=ContentCapability.SUGGESTIVE,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=False,
            require_vision=False,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        assert result is not None
        # Should select a model (abliterated or not)


# ---------------------------------------------------------------------------
# Test: Find Best Model Prefers Local
# ---------------------------------------------------------------------------


class TestFindBestModelPrefersLocal:
    """Test that _find_best_model prefers local when configured."""

    def test_prefers_local_when_configured(
        self,
        router: ModelRouter,
        only_ollama_available,
    ):
        """Should prefer local model when prefer_local=True and local available."""
        result = router._find_best_model(
            max_capability=ContentCapability.UNRESTRICTED,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=False,
            require_vision=False,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        assert result is not None
        assert result.is_local is True
        assert result.provider == "ollama"


# ---------------------------------------------------------------------------
# Test: Find Best Model with Tool Requirement
# ---------------------------------------------------------------------------


class TestFindBestModelWithToolRequirement:
    """Test that _find_best_model filters by supports_tools."""

    def test_filters_by_tools_required(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """Should only return models that support tools when required."""
        result = router._find_best_model(
            max_capability=ContentCapability.UNRESTRICTED,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=True,
            require_vision=False,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        assert result is not None
        assert result.supports_tools is True

    def test_no_filter_when_tools_not_required(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """Should include all models when tools not required."""
        result = router._find_best_model(
            max_capability=ContentCapability.UNRESTRICTED,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=False,
            require_vision=False,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        assert result is not None


# ---------------------------------------------------------------------------
# Test: Find Best Model with Vision Requirement
# ---------------------------------------------------------------------------


class TestFindBestModelWithVisionRequirement:
    """Test that _find_best_model filters by supports_vision."""

    def test_filters_by_vision_required(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """Should only return models that support vision when required."""
        result = router._find_best_model(
            max_capability=ContentCapability.SUGGESTIVE,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=False,
            require_vision=True,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        assert result is not None
        assert result.supports_vision is True

    def test_returns_none_when_no_vision_models(
        self,
        router: ModelRouter,
        only_ollama_available,
    ):
        """Should return None when no vision-capable models available."""
        # Ollama models in registry don't support vision
        result = router._find_best_model(
            max_capability=ContentCapability.UNRESTRICTED,
            min_capability=ContentCapability.SFW_ONLY,
            require_tools=False,
            require_vision=True,
            prefer_tier=None,
            prefer_abliterated=False,
        )

        # Local ollama models don't have vision support
        assert result is None


# ---------------------------------------------------------------------------
# Test: Fallback When No Suitable Model
# ---------------------------------------------------------------------------


class TestFallbackWhenNoSuitableModel:
    """Test fallback behavior when no suitable model found."""

    @pytest.mark.asyncio
    async def test_fallback_used_when_primary_unavailable(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        only_ollama_available,
    ):
        """Should use fallback when ideal model criteria can't be met."""
        # Uses pre-configured "hello" -> SAFE pattern
        # Request vision which local models don't support
        decision = await router.route(
            user_message="hello, look at this image",
            companion_safety_level="standard",
            require_vision=True,
        )

        # Either no model or fallback used
        if decision.model_spec is not None:
            assert decision.fallback_used is True

    @pytest.mark.asyncio
    async def test_no_model_when_all_unavailable(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        no_providers_available,
    ):
        """Should return no model when all providers are unavailable."""
        # Uses pre-configured "hello" -> SAFE pattern
        decision = await router.route(
            user_message="hello there",
            companion_safety_level="standard",
        )

        assert decision.model_spec is None
        assert decision.content_blocked is False  # Not blocked, just unavailable

    def test_find_any_available_model(
        self,
        router: ModelRouter,
        all_providers_available,
    ):
        """_find_any_available_model should return any available model."""
        result = router._find_any_available_model()
        assert result is not None
        # Should return some model from registry

    def test_find_any_available_model_none_available(
        self,
        router: ModelRouter,
        no_providers_available,
    ):
        """_find_any_available_model should return None when none available."""
        result = router._find_any_available_model()
        assert result is None


# ---------------------------------------------------------------------------
# Test: Content Blocked Routing Decision
# ---------------------------------------------------------------------------


class TestContentBlockedRoutingDecision:
    """Test content_blocked flag in routing decisions."""

    @pytest.mark.asyncio
    async def test_content_blocked_flag_set(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """content_blocked should be True when content exceeds safety level."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content request",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is True

    @pytest.mark.asyncio
    async def test_content_blocked_has_reason(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Blocked content should have a block_reason."""
        # Uses pre-configured "nsfw message" -> EXPLICIT pattern
        decision = await router.route(
            user_message="nsfw message content",
            companion_safety_level="standard",
        )

        assert decision.block_reason is not None
        assert len(decision.block_reason) > 0

    @pytest.mark.asyncio
    async def test_block_reason_mentions_capability(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Block reason should mention capability mismatch."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content here",
            companion_safety_level="standard",
        )

        assert decision.block_reason is not None
        # Block reason should mention capability levels
        assert "capability" in decision.block_reason.lower() or "level" in decision.block_reason.lower()

    @pytest.mark.asyncio
    async def test_not_blocked_for_allowed_content(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """content_blocked should be False for allowed content."""
        # Uses pre-configured "hello" -> SAFE pattern
        decision = await router.route(
            user_message="hello, nice to meet you",
            companion_safety_level="strict",
        )

        assert decision.content_blocked is False
        assert decision.block_reason is None


# ---------------------------------------------------------------------------
# Test: Explain Selection
# ---------------------------------------------------------------------------


class TestExplainSelection:
    """Test _explain_selection produces human-readable explanations."""

    def test_explain_abliterated_model(self, router: ModelRouter):
        """Should mention abliterated for unrestricted content."""
        model = ModelSpec(
            model_id="test-abliterated",
            provider="ollama",
            display_name="Abliterated Test",
            content_capability=ContentCapability.UNRESTRICTED,
            tier=ModelTier.LOCAL,
            is_abliterated=True,
            is_local=True,
        )
        intent = IntentResult(
            intent=ContentIntent.EXPLICIT,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "abliterated" in explanation.lower()

    def test_explain_safe_content(self, router: ModelRouter):
        """Should mention general purpose for safe content."""
        model = ModelSpec(
            model_id="test-model",
            provider="anthropic",
            display_name="Test Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "general purpose" in explanation.lower() or "safe" in explanation.lower()

    def test_explain_local_inference(self, router: ModelRouter):
        """Should mention local inference for local models."""
        model = ModelSpec(
            model_id="test-local",
            provider="ollama",
            display_name="Local Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.LOCAL,
            is_local=True,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "local" in explanation.lower()

    def test_explain_fast_tier(self, router: ModelRouter):
        """Should mention fast response for FAST tier."""
        model = ModelSpec(
            model_id="test-fast",
            provider="openai",
            display_name="Fast Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.FAST,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "fast" in explanation.lower()

    def test_explain_flagship_tier(self, router: ModelRouter):
        """Should mention high quality for FLAGSHIP tier."""
        model = ModelSpec(
            model_id="test-flagship",
            provider="openai",
            display_name="Flagship Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.FLAGSHIP,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "quality" in explanation.lower()

    def test_explain_vision_model(self, router: ModelRouter):
        """Should mention vision-enabled for vision models."""
        model = ModelSpec(
            model_id="test-vision",
            provider="openai",
            display_name="Vision Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
            supports_vision=True,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "vision" in explanation.lower()

    def test_explain_tool_capable(self, router: ModelRouter):
        """Should mention tool-capable for tool-supporting models."""
        model = ModelSpec(
            model_id="test-tools",
            provider="anthropic",
            display_name="Tool Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
            supports_tools=True,
        )
        intent = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "tool" in explanation.lower()

    def test_explain_flirty_content(self, router: ModelRouter):
        """Should mention flirty for flirty content."""
        model = ModelSpec(
            model_id="test-model",
            provider="anthropic",
            display_name="Test Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        intent = IntentResult(
            intent=ContentIntent.FLIRTY,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "flirty" in explanation.lower()

    def test_explain_roleplay(self, router: ModelRouter):
        """Should mention roleplay for roleplay intents."""
        model = ModelSpec(
            model_id="test-model",
            provider="ollama",
            display_name="Roleplay Test",
            content_capability=ContentCapability.NSFW_ROLEPLAY,
            tier=ModelTier.LOCAL,
            is_abliterated=True,
        )
        intent = IntentResult(
            intent=ContentIntent.ROLEPLAY_NSFW,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=5.0,
        )

        explanation = router._explain_selection(model, intent)

        assert "roleplay" in explanation.lower() or "abliterated" in explanation.lower()


# ---------------------------------------------------------------------------
# Test: Integration Scenarios
# ---------------------------------------------------------------------------


class TestIntegrationScenarios:
    """Integration tests for complete routing scenarios."""

    @pytest.mark.asyncio
    async def test_complete_flow_safe_strict(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Test complete flow: safe content with strict companion."""
        # Uses pre-configured "hello" -> SAFE pattern (confidence 0.95)
        decision = await router.route(
            user_message="hello, tell me a story",
            companion_safety_level="strict",
            require_tools=False,
            require_vision=False,
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        # Default confidence from conftest is 0.95
        assert decision.intent_result.confidence >= 0.90

    @pytest.mark.asyncio
    async def test_complete_flow_explicit_adult(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Test complete flow: explicit content with adult companion."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content message",
            companion_safety_level="adult",
        )

        assert decision.content_blocked is False
        assert decision.model_spec is not None
        assert decision.intent_result.requires_abliterated is True

    @pytest.mark.asyncio
    async def test_case_insensitive_safety_level(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Test that safety level is case-insensitive."""
        # Uses pre-configured "hello" -> SAFE pattern
        # Test uppercase
        decision = await router.route(
            user_message="hello friend",
            companion_safety_level="STANDARD",
        )
        assert decision.content_blocked is False

        # Test mixed case
        decision = await router.route(
            user_message="hello there",
            companion_safety_level="Standard",
        )
        assert decision.content_blocked is False

    @pytest.mark.asyncio
    async def test_unknown_safety_level_defaults_to_suggestive(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Test that unknown safety level defaults to suggestive capability."""
        # Uses pre-configured "explicit content" -> EXPLICIT pattern
        decision = await router.route(
            user_message="explicit content request",
            companion_safety_level="unknown_level",
        )

        # With unknown level defaulting to SUGGESTIVE, explicit should be blocked
        assert decision.content_blocked is True

    @pytest.mark.asyncio
    async def test_prefer_tier_respected(
        self,
        router: ModelRouter,
        mock_intent_detector: MockIntentDetector,
        all_providers_available,
    ):
        """Test that prefer_tier is passed to _find_best_model."""
        # Uses pre-configured "hello" -> SAFE pattern
        decision = await router.route(
            user_message="hello, quick question",
            companion_safety_level="standard",
            prefer_tier=ModelTier.FAST,
        )

        assert decision.model_spec is not None
        # Model should be available (may or may not be FAST tier depending on availability)
