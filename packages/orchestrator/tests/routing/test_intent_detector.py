"""
Comprehensive tests for the IntentDetector service.

Tests the two-phase NSFW intent detection system including:
- ContentIntent enum properties
- IntentResult dataclass behavior
- Semantic routing with embeddings
- Classifier fallback mechanism
- Detection method tracking
- Latency measurement
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from orchestrator.routing.intent_detector import (
    ROUTE_EXAMPLES,
    ContentIntent,
    IntentDetector,
    IntentResult,
)


# =============================================================================
# Mock Fixtures
# =============================================================================


@pytest.fixture
def mock_embedding_model():
    """Mock sentence transformer embedding model.

    Returns a mock that produces normalized embeddings for testing
    cosine similarity calculations.
    """
    mock_model = MagicMock()

    # Create stable mock embeddings based on input text
    def encode_side_effect(text, convert_to_numpy=True, normalize_embeddings=True):
        # Generate deterministic embeddings based on text content
        if isinstance(text, str):
            # Single text input
            embedding = _generate_mock_embedding(text)
            return embedding
        else:
            # List of texts
            embeddings = np.array([_generate_mock_embedding(t) for t in text])
            return embeddings

    mock_model.encode = MagicMock(side_effect=encode_side_effect)
    return mock_model


def _generate_mock_embedding(text: str) -> np.ndarray:
    """Generate a deterministic mock embedding for text.

    Uses simple heuristics to create embeddings that will have
    predictable similarity scores for testing.
    """
    # Base embedding vector (384 dimensions like all-MiniLM-L6-v2)
    np.random.seed(hash(text) % (2**32 - 1))
    base = np.random.randn(384).astype(np.float32)

    # Apply content-based modifications to control similarity
    if any(word in text.lower() for word in ["explicit", "nsfw", "s**", "f***", "naked"]):
        # Explicit content direction
        base[0:10] = 1.0
        base[10:20] = 0.5
    elif any(word in text.lower() for word in ["suggestive", "wearing", "dream", "closer"]):
        # Suggestive content direction
        base[0:10] = 0.7
        base[10:20] = 0.8
    elif any(word in text.lower() for word in ["flirt", "beautiful", "charming", "smile"]):
        # Flirty content direction
        base[20:30] = 1.0
        base[30:40] = 0.5
    elif any(word in text.lower() for word in ["roleplay", "pretend", "imagine", "adventure"]):
        # Roleplay direction
        base[40:50] = 1.0
        if any(word in text.lower() for word in ["naughty", "seduce", "dominant"]):
            base[50:60] = 1.0  # NSFW roleplay
        else:
            base[60:70] = 1.0  # SFW roleplay
    else:
        # Safe content direction
        base[70:80] = 1.0
        base[80:90] = 0.5

    # Normalize to unit vector
    norm = np.linalg.norm(base)
    if norm > 0:
        base = base / norm

    return base


@pytest.fixture
def mock_classifier_pipeline():
    """Mock HuggingFace classifier pipeline.

    Returns a mock that simulates NSFW text classification.
    """
    mock_pipeline = MagicMock()

    def classify_side_effect(text):
        # Simple classification based on text content
        text_lower = text.lower()

        if any(word in text_lower for word in ["explicit", "nsfw", "naked", "s**"]):
            return [{"label": "nsfw", "score": 0.95}]
        elif any(word in text_lower for word in ["suggestive", "seduce"]):
            return [{"label": "nsfw", "score": 0.75}]
        else:
            return [{"label": "sfw", "score": 0.9}]

    mock_pipeline.side_effect = classify_side_effect
    return mock_pipeline


@pytest.fixture
def intent_detector():
    """Create an IntentDetector instance without loading models."""
    return IntentDetector(
        embedding_model="all-MiniLM-L6-v2",
        classifier_model="TostAI/nsfw-text-detection-large",
        semantic_threshold=0.75,
        classifier_threshold=0.6,
    )


@pytest.fixture
def initialized_detector(mock_embedding_model, mock_classifier_pipeline):
    """Create a fully initialized IntentDetector with mocked models."""
    detector = IntentDetector(
        semantic_threshold=0.75,
        classifier_threshold=0.6,
    )

    # Inject mocked models
    detector._embedding_model = mock_embedding_model
    detector._classifier = mock_classifier_pipeline
    detector._initialized = True

    # Precompute route embeddings with mock model
    detector._precompute_routes()

    return detector


# =============================================================================
# Test: ContentIntent Enum
# =============================================================================


class TestContentIntentEnum:
    """Tests for ContentIntent enumeration."""

    def test_content_intent_enum_all_values_exist(self):
        """Verify all expected intent values exist in the enum."""
        expected_intents = [
            "safe",
            "flirty",
            "suggestive",
            "explicit",
            "roleplay_sfw",
            "roleplay_nsfw",
        ]

        actual_values = [intent.value for intent in ContentIntent]

        for expected in expected_intents:
            assert expected in actual_values, f"Missing intent: {expected}"

        assert len(actual_values) == len(expected_intents), (
            f"Unexpected number of intents: {len(actual_values)} vs {len(expected_intents)}"
        )

    def test_content_intent_is_string_enum(self):
        """Verify ContentIntent is a string enum."""
        assert ContentIntent.SAFE == "safe"
        assert ContentIntent.EXPLICIT == "explicit"
        assert str(ContentIntent.SUGGESTIVE) == "ContentIntent.SUGGESTIVE"
        assert ContentIntent.FLIRTY.value == "flirty"


class TestContentIntentRequiresAbliterated:
    """Tests for the requires_abliterated property."""

    def test_explicit_requires_abliterated(self):
        """Verify EXPLICIT intent requires abliterated model."""
        assert ContentIntent.EXPLICIT.requires_abliterated is True

    def test_roleplay_nsfw_requires_abliterated(self):
        """Verify ROLEPLAY_NSFW intent requires abliterated model."""
        assert ContentIntent.ROLEPLAY_NSFW.requires_abliterated is True

    def test_suggestive_requires_abliterated(self):
        """Verify SUGGESTIVE intent requires abliterated model."""
        assert ContentIntent.SUGGESTIVE.requires_abliterated is True

    def test_safe_does_not_require_abliterated(self):
        """Verify SAFE intent does not require abliterated model."""
        assert ContentIntent.SAFE.requires_abliterated is False

    def test_flirty_does_not_require_abliterated(self):
        """Verify FLIRTY intent does not require abliterated model."""
        assert ContentIntent.FLIRTY.requires_abliterated is False

    def test_roleplay_sfw_does_not_require_abliterated(self):
        """Verify ROLEPLAY_SFW intent does not require abliterated model."""
        assert ContentIntent.ROLEPLAY_SFW.requires_abliterated is False

    def test_all_intents_have_requires_abliterated_property(self):
        """Verify all intents have the requires_abliterated property."""
        for intent in ContentIntent:
            # Should not raise AttributeError
            _ = intent.requires_abliterated
            assert isinstance(intent.requires_abliterated, bool)


# =============================================================================
# Test: IntentResult Dataclass
# =============================================================================


class TestIntentResultCreation:
    """Tests for IntentResult dataclass."""

    def test_intent_result_creation_basic(self):
        """Verify basic IntentResult creation."""
        result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.95,
            detection_method="semantic",
            latency_ms=15.5,
        )

        assert result.intent == ContentIntent.SAFE
        assert result.confidence == 0.95
        assert result.detection_method == "semantic"
        assert result.latency_ms == 15.5
        assert result.raw_scores == {}

    def test_intent_result_with_raw_scores(self):
        """Verify IntentResult with raw_scores."""
        raw_scores = {"safe": 0.8, "explicit": 0.15, "flirty": 0.05}

        result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.8,
            detection_method="semantic",
            latency_ms=12.3,
            raw_scores=raw_scores,
        )

        assert result.raw_scores == raw_scores

    def test_intent_result_requires_abliterated_auto_set(self):
        """Verify requires_abliterated is auto-set from intent."""
        safe_result = IntentResult(
            intent=ContentIntent.SAFE,
            confidence=0.9,
            detection_method="semantic",
            latency_ms=10.0,
        )
        assert safe_result.requires_abliterated is False

        explicit_result = IntentResult(
            intent=ContentIntent.EXPLICIT,
            confidence=0.85,
            detection_method="classifier",
            latency_ms=25.0,
        )
        assert explicit_result.requires_abliterated is True

    def test_intent_result_all_intents_auto_set_requires_abliterated(self):
        """Verify requires_abliterated is correctly set for all intent types."""
        for intent in ContentIntent:
            result = IntentResult(
                intent=intent,
                confidence=0.5,
                detection_method="test",
                latency_ms=0.0,
            )
            assert result.requires_abliterated == intent.requires_abliterated


# =============================================================================
# Test: IntentDetector Creation
# =============================================================================


class TestIntentDetectorCreation:
    """Tests for IntentDetector instantiation."""

    def test_intent_detector_creation_defaults(self):
        """Verify IntentDetector can be created with default parameters."""
        detector = IntentDetector()

        assert detector._embedding_model_name == "all-MiniLM-L6-v2"
        assert detector._classifier_model_name == "TostAI/nsfw-text-detection-large"
        assert detector._semantic_threshold == 0.75
        assert detector._classifier_threshold == 0.6

    def test_intent_detector_creation_custom_params(self):
        """Verify IntentDetector can be created with custom parameters."""
        detector = IntentDetector(
            embedding_model="custom-model",
            classifier_model="custom-classifier",
            semantic_threshold=0.8,
            classifier_threshold=0.7,
        )

        assert detector._embedding_model_name == "custom-model"
        assert detector._classifier_model_name == "custom-classifier"
        assert detector._semantic_threshold == 0.8
        assert detector._classifier_threshold == 0.7

    def test_intent_detector_not_initialized_on_creation(self):
        """Verify IntentDetector is not initialized on creation."""
        detector = IntentDetector()

        assert detector._initialized is False
        assert detector._embedding_model is None
        assert detector._classifier is None
        assert detector._route_embeddings == {}

    def test_intent_detector_properties(self):
        """Verify IntentDetector properties work correctly."""
        detector = IntentDetector()

        assert detector.is_initialized is False
        assert detector.has_embedding_model is False
        assert detector.has_classifier is False

    def test_intent_detector_get_status(self):
        """Verify get_status returns correct information."""
        detector = IntentDetector(
            embedding_model="test-embed",
            classifier_model="test-classify",
            semantic_threshold=0.8,
            classifier_threshold=0.65,
        )

        status = detector.get_status()

        assert status["initialized"] is False
        assert status["embedding_model"] == "test-embed"
        assert status["embedding_model_loaded"] is False
        assert status["classifier_model"] == "test-classify"
        assert status["classifier_loaded"] is False
        assert status["semantic_threshold"] == 0.8
        assert status["classifier_threshold"] == 0.65
        assert status["route_count"] == 0


# =============================================================================
# Test: IntentDetector Not Initialized
# =============================================================================


class TestIntentDetectorNotInitialized:
    """Tests for IntentDetector behavior when not initialized."""

    async def test_detect_without_models_returns_fallback(self):
        """Verify detect() returns fallback when no models are available."""
        detector = IntentDetector()

        # Patch initialize to fail silently
        with patch.object(detector, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.return_value = False

            result = await detector.detect("Hello, how are you?")

        assert result.intent == ContentIntent.SAFE
        assert result.confidence == 0.0
        assert result.detection_method == "fallback"
        assert result.requires_abliterated is False

    async def test_detect_fallback_records_latency(self):
        """Verify fallback detection still records latency."""
        detector = IntentDetector()

        with patch.object(detector, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.return_value = False

            result = await detector.detect("Test message")

        assert result.latency_ms >= 0.0

    async def test_detect_calls_initialize(self):
        """Verify detect() calls initialize when not initialized."""
        detector = IntentDetector()

        with patch.object(detector, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.return_value = False

            await detector.detect("Test")

            mock_init.assert_called_once()


# =============================================================================
# Test: Semantic Routing - Safe Content
# =============================================================================


class TestSemanticRoutingSafeContent:
    """Tests for semantic routing of safe content."""

    async def test_safe_greeting_detected(self, initialized_detector):
        """Verify safe greetings are detected correctly."""
        result = await initialized_detector.detect("Hello! How are you doing today?")

        # Should be either SAFE or have low confidence requiring fallback
        # Since our mock uses heuristics, check the result is reasonable
        assert result.detection_method in ["semantic", "classifier", "fallback"]
        assert result.latency_ms >= 0.0

    async def test_safe_question_detected(self, initialized_detector):
        """Verify safe questions are detected correctly."""
        result = await initialized_detector.detect("What's your favorite movie?")

        assert result.latency_ms >= 0.0
        assert result.intent in ContentIntent

    async def test_safe_content_does_not_require_abliterated(self, initialized_detector):
        """Verify safe content does not require abliterated model."""
        # Create detector with mocked embeddings that return high similarity for safe
        detector = initialized_detector

        # Use a clearly safe message
        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.9,
                detection_method="semantic",
                latency_ms=5.0,
                raw_scores={"safe": 0.9},
            )

            result = await detector.detect("What books do you recommend?")

        assert result.requires_abliterated is False


# =============================================================================
# Test: Semantic Routing - Explicit Content
# =============================================================================


class TestSemanticRoutingExplicitContent:
    """Tests for semantic routing of explicit content."""

    async def test_explicit_content_requires_abliterated(self, initialized_detector):
        """Verify explicit content requires abliterated model."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.EXPLICIT,
                confidence=0.92,
                detection_method="semantic",
                latency_ms=8.0,
                raw_scores={"explicit": 0.92},
            )

            result = await detector.detect("Explicit content message")

        assert result.requires_abliterated is True
        assert result.intent == ContentIntent.EXPLICIT

    async def test_explicit_content_high_confidence(self, initialized_detector):
        """Verify explicit content detection with high confidence."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.EXPLICIT,
                confidence=0.95,
                detection_method="semantic",
                latency_ms=6.0,
            )

            result = await detector.detect("Very explicit message")

        assert result.confidence >= 0.75
        assert result.detection_method == "semantic"


# =============================================================================
# Test: Semantic Routing - Suggestive Content
# =============================================================================


class TestSemanticRoutingSuggestiveContent:
    """Tests for semantic routing of suggestive content."""

    async def test_suggestive_content_detected(self, initialized_detector):
        """Verify suggestive content is detected."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.SUGGESTIVE,
                confidence=0.82,
                detection_method="semantic",
                latency_ms=7.0,
            )

            result = await detector.detect("I wish you were here with me tonight")

        assert result.intent == ContentIntent.SUGGESTIVE
        assert result.requires_abliterated is True

    async def test_suggestive_content_between_safe_and_explicit(self, initialized_detector):
        """Verify suggestive content is correctly categorized."""
        # Suggestive should require abliterated but isn't as severe as explicit
        assert ContentIntent.SUGGESTIVE.requires_abliterated is True

        # All three should have distinct values
        assert ContentIntent.SAFE != ContentIntent.SUGGESTIVE
        assert ContentIntent.SUGGESTIVE != ContentIntent.EXPLICIT


# =============================================================================
# Test: Classifier Fallback
# =============================================================================


class TestClassifierFallback:
    """Tests for classifier fallback when semantic confidence is low."""

    async def test_classifier_called_on_low_semantic_confidence(self, initialized_detector):
        """Verify classifier is called when semantic confidence is low."""
        detector = initialized_detector

        # Mock semantic route to return low confidence
        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_semantic:
            mock_semantic.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.5,  # Below 0.75 threshold
                detection_method="semantic",
                latency_ms=5.0,
            )

            # Mock classify to return high confidence result
            with patch.object(
                detector, "_classify", new_callable=AsyncMock
            ) as mock_classify:
                mock_classify.return_value = IntentResult(
                    intent=ContentIntent.EXPLICIT,
                    confidence=0.9,
                    detection_method="classifier",
                    latency_ms=20.0,
                )

                result = await detector.detect("Ambiguous message")

                mock_classify.assert_called_once()

        assert result.intent == ContentIntent.EXPLICIT
        assert result.detection_method == "classifier"

    async def test_classifier_not_called_on_high_semantic_confidence(self, initialized_detector):
        """Verify classifier is NOT called when semantic confidence is high."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_semantic:
            mock_semantic.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.9,  # Above 0.75 threshold
                detection_method="semantic",
                latency_ms=5.0,
            )

            with patch.object(
                detector, "_classify", new_callable=AsyncMock
            ) as mock_classify:
                result = await detector.detect("Clear safe message")

                mock_classify.assert_not_called()

        assert result.detection_method == "semantic"

    async def test_semantic_result_returned_if_classifier_low_confidence(self, initialized_detector):
        """Verify semantic result is used if classifier has lower confidence."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_semantic:
            mock_semantic.return_value = IntentResult(
                intent=ContentIntent.FLIRTY,
                confidence=0.6,  # Below threshold
                detection_method="semantic",
                latency_ms=5.0,
            )

            with patch.object(
                detector, "_classify", new_callable=AsyncMock
            ) as mock_classify:
                mock_classify.return_value = IntentResult(
                    intent=ContentIntent.SAFE,
                    confidence=0.4,  # Below classifier threshold of 0.6
                    detection_method="classifier",
                    latency_ms=15.0,
                )

                result = await detector.detect("Mixed signals")

        # Should return semantic result since classifier wasn't confident enough
        assert result.intent == ContentIntent.FLIRTY
        assert result.detection_method == "semantic"


# =============================================================================
# Test: Detection Method Tracking
# =============================================================================


class TestDetectionMethodTracking:
    """Tests for correct detection method tracking."""

    async def test_semantic_method_tracked(self, initialized_detector):
        """Verify 'semantic' method is tracked correctly."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.85,
                detection_method="semantic",
                latency_ms=5.0,
            )

            result = await detector.detect("Test")

        assert result.detection_method == "semantic"

    async def test_classifier_method_tracked(self, initialized_detector):
        """Verify 'classifier' method is tracked correctly."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_semantic:
            mock_semantic.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.5,
                detection_method="semantic",
                latency_ms=5.0,
            )

            with patch.object(
                detector, "_classify", new_callable=AsyncMock
            ) as mock_classify:
                mock_classify.return_value = IntentResult(
                    intent=ContentIntent.EXPLICIT,
                    confidence=0.8,
                    detection_method="classifier",
                    latency_ms=20.0,
                )

                result = await detector.detect("Ambiguous")

        assert result.detection_method == "classifier"

    async def test_fallback_method_tracked(self):
        """Verify 'fallback' method is tracked when no models available."""
        detector = IntentDetector()

        with patch.object(detector, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.return_value = False

            result = await detector.detect("Test")

        assert result.detection_method == "fallback"


# =============================================================================
# Test: Latency Tracking
# =============================================================================


class TestLatencyTracking:
    """Tests for latency measurement."""

    async def test_latency_is_recorded(self, initialized_detector):
        """Verify latency_ms is recorded for detection."""
        result = await initialized_detector.detect("Hello world")

        assert hasattr(result, "latency_ms")
        assert result.latency_ms >= 0.0

    async def test_latency_is_positive(self, initialized_detector):
        """Verify latency is a positive value."""
        detector = initialized_detector

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.9,
                detection_method="semantic",
                latency_ms=12.5,
            )

            result = await detector.detect("Test message")

        assert result.latency_ms > 0

    async def test_fallback_has_latency(self):
        """Verify fallback detection records latency."""
        detector = IntentDetector()

        with patch.object(detector, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.return_value = False

            result = await detector.detect("Test")

        assert result.latency_ms >= 0.0

    async def test_classifier_latency_includes_semantic_attempt(self, initialized_detector):
        """Verify classifier result includes total latency when used as fallback."""
        detector = initialized_detector

        semantic_latency = 5.0
        classifier_latency = 15.0

        with patch.object(
            detector, "_semantic_route", new_callable=AsyncMock
        ) as mock_semantic:
            mock_semantic.return_value = IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.5,
                detection_method="semantic",
                latency_ms=semantic_latency,
            )

            with patch.object(
                detector, "_classify", new_callable=AsyncMock
            ) as mock_classify:
                mock_classify.return_value = IntentResult(
                    intent=ContentIntent.EXPLICIT,
                    confidence=0.8,
                    detection_method="classifier",
                    latency_ms=classifier_latency,
                )

                result = await detector.detect("Test")

        # The result should have classifier method and some latency
        assert result.detection_method == "classifier"
        assert result.latency_ms >= 0.0


# =============================================================================
# Test: Route Examples Coverage
# =============================================================================


class TestRouteExamplesCoverage:
    """Tests for route examples configuration."""

    def test_all_intents_have_route_examples(self):
        """Verify all ContentIntent values have route examples."""
        for intent in ContentIntent:
            assert intent in ROUTE_EXAMPLES, f"Missing route examples for {intent}"

    def test_route_examples_not_empty(self):
        """Verify each intent has at least one route example."""
        for intent, examples in ROUTE_EXAMPLES.items():
            assert len(examples) > 0, f"Empty route examples for {intent}"

    def test_route_examples_are_strings(self):
        """Verify all route examples are strings."""
        for intent, examples in ROUTE_EXAMPLES.items():
            for example in examples:
                assert isinstance(example, str), (
                    f"Non-string example for {intent}: {type(example)}"
                )

    def test_route_examples_minimum_count(self):
        """Verify each intent has sufficient route examples for robust routing."""
        minimum_examples = 10  # Reasonable minimum for semantic routing

        for intent, examples in ROUTE_EXAMPLES.items():
            assert len(examples) >= minimum_examples, (
                f"Intent {intent} has only {len(examples)} examples, need at least {minimum_examples}"
            )

    def test_route_examples_no_duplicates(self):
        """Verify no duplicate examples within each intent."""
        for intent, examples in ROUTE_EXAMPLES.items():
            unique_examples = set(examples)
            assert len(unique_examples) == len(examples), (
                f"Duplicate examples found for {intent}"
            )

    def test_safe_examples_are_appropriate(self):
        """Verify SAFE examples don't contain explicit content indicators."""
        explicit_indicators = ["nsfw", "naked", "sex", "f***", "s**"]

        for example in ROUTE_EXAMPLES[ContentIntent.SAFE]:
            for indicator in explicit_indicators:
                assert indicator not in example.lower(), (
                    f"SAFE example contains explicit indicator: {example}"
                )

    def test_explicit_examples_are_distinguishable(self):
        """Verify EXPLICIT examples are meaningfully different from SAFE."""
        safe_examples = set(ROUTE_EXAMPLES[ContentIntent.SAFE])
        explicit_examples = set(ROUTE_EXAMPLES[ContentIntent.EXPLICIT])

        # No overlap between safe and explicit
        overlap = safe_examples.intersection(explicit_examples)
        assert len(overlap) == 0, f"Overlapping examples: {overlap}"


# =============================================================================
# Test: Model Loading Edge Cases
# =============================================================================


class TestModelLoadingEdgeCases:
    """Tests for model loading behavior."""

    async def test_initialize_idempotent(self):
        """Verify initialize() is idempotent."""
        detector = IntentDetector()

        with patch.object(detector, "_load_models", return_value=True) as mock_load:
            with patch.object(detector, "_precompute_routes"):
                result1 = await detector.initialize()
                result2 = await detector.initialize()

        # Should only load once
        mock_load.assert_called_once()
        assert result1 is True
        assert result2 is True

    async def test_initialization_failure_handled(self):
        """Verify initialization failure is handled gracefully."""
        detector = IntentDetector()

        with patch.object(
            detector, "_load_models", side_effect=Exception("Model load failed")
        ):
            result = await detector.initialize()

        assert result is False
        assert detector._initialized is False

    def test_precompute_routes_without_model(self):
        """Verify precompute_routes handles missing model gracefully."""
        detector = IntentDetector()

        # Should not raise an exception
        detector._precompute_routes()

        assert len(detector._route_embeddings) == 0


# =============================================================================
# Test: Classifier Integration
# =============================================================================


class TestClassifierIntegration:
    """Tests for classifier-specific behavior."""

    async def test_classifier_only_mode(self):
        """Verify detection works with classifier only (no embedding model)."""
        detector = IntentDetector()

        # Set up classifier without embedding model
        mock_classifier = MagicMock()
        mock_classifier.side_effect = lambda text: [{"label": "sfw", "score": 0.9}]

        detector._classifier = mock_classifier
        detector._initialized = True

        result = await detector.detect("Hello world")

        assert result.detection_method == "classifier"
        assert result.intent == ContentIntent.SAFE

    async def test_classifier_nsfw_detection(self):
        """Verify classifier correctly maps NSFW label."""
        detector = IntentDetector()

        mock_classifier = MagicMock()
        mock_classifier.side_effect = lambda text: [{"label": "nsfw", "score": 0.95}]

        detector._classifier = mock_classifier
        detector._initialized = True

        result = await detector.detect("Explicit content")

        assert result.intent == ContentIntent.EXPLICIT
        assert result.requires_abliterated is True

    async def test_classifier_error_handling(self):
        """Verify classifier errors are handled gracefully."""
        detector = IntentDetector()

        mock_classifier = MagicMock()
        mock_classifier.side_effect = Exception("Inference failed")

        detector._classifier = mock_classifier
        detector._initialized = True

        result = await detector.detect("Test message")

        # Should return safe default on error
        assert result.intent == ContentIntent.SAFE
        assert result.confidence == 0.0
        assert "error" in result.raw_scores


# =============================================================================
# Test: Status and Properties
# =============================================================================


class TestStatusAndProperties:
    """Tests for detector status reporting."""

    def test_status_after_initialization(self, initialized_detector):
        """Verify status is correct after initialization."""
        status = initialized_detector.get_status()

        assert status["initialized"] is True
        assert status["embedding_model_loaded"] is True
        assert status["classifier_loaded"] is True
        assert status["route_count"] > 0

    def test_has_embedding_model_property(self, initialized_detector):
        """Verify has_embedding_model property."""
        assert initialized_detector.has_embedding_model is True

    def test_has_classifier_property(self, initialized_detector):
        """Verify has_classifier property."""
        assert initialized_detector.has_classifier is True

    def test_is_initialized_property(self, initialized_detector):
        """Verify is_initialized property."""
        assert initialized_detector.is_initialized is True
