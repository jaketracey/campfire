"""NSFW intent detection service with two-phase detection approach.

This module implements a hybrid intent detection system that combines:
1. Fast semantic routing using sentence embeddings and cosine similarity
2. Fallback to transformer-based NSFW classification for uncertain cases

The detector routes messages to appropriate content handling paths
(safe vs abliterated models) based on detected intent.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

import numpy as np
import structlog

if TYPE_CHECKING:
    from numpy.typing import NDArray

logger = structlog.get_logger()


class ContentIntent(str, Enum):
    """Categories of content intent for routing decisions."""

    SAFE = "safe"
    FLIRTY = "flirty"
    SUGGESTIVE = "suggestive"
    EXPLICIT = "explicit"
    ROLEPLAY_SFW = "roleplay_sfw"
    ROLEPLAY_NSFW = "roleplay_nsfw"

    @property
    def requires_abliterated(self) -> bool:
        """Check if this intent requires an abliterated model."""
        return self in {
            ContentIntent.SUGGESTIVE,
            ContentIntent.EXPLICIT,
            ContentIntent.ROLEPLAY_NSFW,
        }


@dataclass
class IntentResult:
    """Result of intent detection with metadata."""

    intent: ContentIntent
    confidence: float
    detection_method: str  # "semantic" or "classifier"
    latency_ms: float
    requires_abliterated: bool = field(init=False)
    raw_scores: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Set requires_abliterated based on intent."""
        self.requires_abliterated = self.intent.requires_abliterated


# Route examples for semantic routing
# These are used to create embeddings for fast cosine similarity matching
ROUTE_EXAMPLES: dict[ContentIntent, list[str]] = {
    ContentIntent.SAFE: [
        "How was your day?",
        "What's your favorite food?",
        "Tell me about your hobbies",
        "What do you think about the weather?",
        "Can you recommend a good book?",
        "What's your favorite movie?",
        "Do you like music?",
        "Tell me a joke",
        "What's your opinion on technology?",
        "How do you spend your free time?",
        "What's your favorite color?",
        "Do you have any pets?",
        "What did you do today?",
        "Can you help me with something?",
        "What's for dinner?",
    ],
    ContentIntent.FLIRTY: [
        "You have beautiful eyes",
        "I enjoy talking to you",
        "You make me smile",
        "I've been thinking about you",
        "You're so charming",
        "I love your sense of humor",
        "You're really special to me",
        "I feel so comfortable with you",
        "You always know how to make me laugh",
        "I could talk to you all day",
        "You're so sweet",
        "I really like spending time with you",
        "You make my heart flutter",
        "I can't stop thinking about our conversations",
        "You're quite attractive",
    ],
    ContentIntent.SUGGESTIVE: [
        "I wish you were here with me",
        "What are you wearing?",
        "I had a dream about you last night",
        "I want to be closer to you",
        "Let's get more comfortable",
        "I want to feel your warmth",
        "Tell me what you want",
        "I'm feeling lonely tonight",
        "I need some company",
        "Let's turn off the lights",
        "I want to cuddle with you",
        "Describe yourself to me",
        "What would you do if I was there?",
        "I'm in bed right now",
        "I want to hear your voice",
    ],
    ContentIntent.EXPLICIT: [
        "I want to f*** you",
        "Let's have s**",
        "I want you to touch me",
        "Take off your clothes",
        "I'm so h*rny right now",
        "I want to do dirty things with you",
        "Let's get n*ked together",
        "I want you inside me",
        "Make love to me",
        "I want to taste you",
        "Let's have phone s**",
        "Describe your body",
        "I want to pleasure you",
        "Let's be naughty",
        "I need you right now",
    ],
    ContentIntent.ROLEPLAY_SFW: [
        "Let's pretend we're on an adventure",
        "Can you roleplay as a medieval knight?",
        "Imagine we're in a fantasy world",
        "Let's act out a detective story",
        "Pretend you're a wise wizard",
        "Can we do a sci-fi scenario?",
        "Let's roleplay as pirates",
        "Imagine we're exploring space",
        "Act like a superhero",
        "Let's do a mystery roleplay",
        "Pretend we're in a fairy tale",
        "Can you be my adventure companion?",
        "Let's act out a historical scene",
        "Imagine we're in an anime",
        "Let's play a D&D scenario",
    ],
    ContentIntent.ROLEPLAY_NSFW: [
        "Let's roleplay something naughty",
        "Be my dominant partner",
        "I want to be your submissive",
        "Let's do a bedroom roleplay",
        "Pretend you're seducing me",
        "Act like my secret lover",
        "Let's roleplay as strangers meeting at a bar",
        "Be my forbidden fantasy",
        "I want you to seduce me slowly",
        "Let's play a game where you're in control",
        "Act like we just met and there's chemistry",
        "Roleplay as my massage therapist",
        "Let's pretend we're having an affair",
        "Be my teacher in this scenario",
        "I want to roleplay something intimate",
    ],
}


class IntentDetector:
    """Two-phase NSFW intent detection service.

    Phase 1 (Semantic Routing): Fast path using sentence embeddings
    and cosine similarity against precomputed route embeddings.

    Phase 2 (Classification): Transformer-based classifier for
    uncertain cases that fall below the semantic threshold.
    """

    def __init__(
        self,
        embedding_model: str = "all-MiniLM-L6-v2",
        classifier_model: str = "TostAI/nsfw-text-detection-large",
        semantic_threshold: float = 0.75,
        classifier_threshold: float = 0.6,
    ) -> None:
        """Initialize the intent detector.

        Args:
            embedding_model: Sentence transformer model for embeddings.
            classifier_model: HuggingFace model for NSFW classification.
            semantic_threshold: Confidence threshold for semantic routing.
            classifier_threshold: Confidence threshold for classifier.
        """
        self._embedding_model_name = embedding_model
        self._classifier_model_name = classifier_model
        self._semantic_threshold = semantic_threshold
        self._classifier_threshold = classifier_threshold

        # Lazy-loaded models
        self._embedding_model: Any | None = None
        self._classifier: Any | None = None

        # Precomputed route embeddings
        self._route_embeddings: dict[ContentIntent, NDArray[np.float32]] = {}

        # Initialization state
        self._initialized = False
        self._initialization_lock = asyncio.Lock()

        logger.info(
            "intent_detector_created",
            embedding_model=embedding_model,
            classifier_model=classifier_model,
            semantic_threshold=semantic_threshold,
            classifier_threshold=classifier_threshold,
        )

    async def initialize(self) -> bool:
        """Initialize models lazily.

        Returns:
            True if initialization succeeded, False otherwise.
        """
        async with self._initialization_lock:
            if self._initialized:
                return True

            try:
                # Run model loading in thread pool to avoid blocking
                loop = asyncio.get_event_loop()
                success = await loop.run_in_executor(None, self._load_models)

                if success:
                    self._precompute_routes()
                    self._initialized = True
                    logger.info("intent_detector_initialized")
                    return True
                else:
                    logger.warning("intent_detector_initialization_partial")
                    return False

            except Exception as e:
                logger.error(
                    "intent_detector_initialization_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                )
                return False

    def _load_models(self) -> bool:
        """Load embedding and classifier models synchronously.

        Returns:
            True if at least embedding model loaded successfully.
        """
        embedding_loaded = False
        classifier_loaded = False

        # Load sentence transformer for embeddings
        try:
            from sentence_transformers import SentenceTransformer

            self._embedding_model = SentenceTransformer(self._embedding_model_name)
            embedding_loaded = True
            logger.info(
                "embedding_model_loaded",
                model=self._embedding_model_name,
            )
        except ImportError:
            logger.warning(
                "sentence_transformers_not_installed",
                hint="pip install sentence-transformers",
            )
        except Exception as e:
            logger.warning(
                "embedding_model_load_failed",
                model=self._embedding_model_name,
                error=str(e),
            )

        # Load NSFW classifier
        try:
            from transformers import pipeline

            self._classifier = pipeline(
                "text-classification",
                model=self._classifier_model_name,
                truncation=True,
                max_length=512,
            )
            classifier_loaded = True
            logger.info(
                "classifier_model_loaded",
                model=self._classifier_model_name,
            )
        except ImportError:
            logger.warning(
                "transformers_not_installed",
                hint="pip install transformers",
            )
        except Exception as e:
            logger.warning(
                "classifier_model_load_failed",
                model=self._classifier_model_name,
                error=str(e),
            )

        return embedding_loaded

    def _precompute_routes(self) -> None:
        """Precompute embeddings for all route examples."""
        if self._embedding_model is None:
            logger.warning("cannot_precompute_routes_no_embedding_model")
            return

        start_time = time.perf_counter()

        for intent, examples in ROUTE_EXAMPLES.items():
            # Encode all examples for this intent
            embeddings = self._embedding_model.encode(
                examples,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )
            # Average the embeddings to get a centroid
            centroid = np.mean(embeddings, axis=0).astype(np.float32)
            # Normalize the centroid
            centroid = centroid / np.linalg.norm(centroid)
            self._route_embeddings[intent] = centroid

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "route_embeddings_precomputed",
            intent_count=len(self._route_embeddings),
            elapsed_ms=round(elapsed_ms, 2),
        )

    async def detect(self, text: str) -> IntentResult:
        """Detect content intent from text.

        This is the main entry point that implements the two-phase
        detection approach:
        1. Try fast semantic routing first
        2. Fall back to classifier if confidence is below threshold

        Args:
            text: Input text to classify.

        Returns:
            IntentResult with detected intent and metadata.
        """
        start_time = time.perf_counter()

        # Ensure models are initialized
        if not self._initialized:
            await self.initialize()

        # If no embedding model available, try classifier or return safe default
        if self._embedding_model is None:
            if self._classifier is not None:
                return await self._classify(text)
            else:
                # No models available - return safe default
                return IntentResult(
                    intent=ContentIntent.SAFE,
                    confidence=0.0,
                    detection_method="fallback",
                    latency_ms=(time.perf_counter() - start_time) * 1000,
                    raw_scores={},
                )

        # Phase 1: Try semantic routing
        semantic_result = await self._semantic_route(text)

        # If confidence is high enough, use semantic result
        if semantic_result.confidence >= self._semantic_threshold:
            return semantic_result

        # Phase 2: Fall back to classifier if available
        if self._classifier is not None:
            classifier_result = await self._classify(text)

            # Decision logic:
            # 1. If semantic detected NSFW content, trust it (classifiers often miss context)
            # 2. If semantic detected SAFE but classifier detected NSFW, trust classifier
            # 3. Otherwise, use the more confident result

            semantic_is_nsfw = semantic_result.intent in (
                ContentIntent.EXPLICIT,
                ContentIntent.ROLEPLAY_NSFW,
                ContentIntent.SUGGESTIVE,
            )
            classifier_is_nsfw = classifier_result.intent in (
                ContentIntent.EXPLICIT,
                ContentIntent.ROLEPLAY_NSFW,
                ContentIntent.SUGGESTIVE,
            )

            total_latency = (time.perf_counter() - start_time) * 1000

            # If semantic found NSFW content, prefer semantic result
            # (semantic router is trained on our specific intent examples)
            if semantic_is_nsfw and not classifier_is_nsfw:
                logger.debug(
                    "preferring_semantic_nsfw_detection",
                    semantic_intent=semantic_result.intent.value,
                    semantic_confidence=round(semantic_result.confidence, 4),
                    classifier_intent=classifier_result.intent.value,
                    classifier_confidence=round(classifier_result.confidence, 4),
                )
                return IntentResult(
                    intent=semantic_result.intent,
                    confidence=semantic_result.confidence,
                    detection_method="semantic",
                    latency_ms=total_latency,
                    raw_scores=semantic_result.raw_scores,
                )

            # If classifier found NSFW but semantic didn't, trust classifier
            if classifier_is_nsfw and classifier_result.confidence >= self._classifier_threshold:
                return IntentResult(
                    intent=classifier_result.intent,
                    confidence=classifier_result.confidence,
                    detection_method="classifier",
                    latency_ms=total_latency,
                    raw_scores=classifier_result.raw_scores,
                )

            # Both agree on safe/non-nsfw - use higher confidence
            if classifier_result.confidence >= self._classifier_threshold:
                if classifier_result.confidence > semantic_result.confidence:
                    return IntentResult(
                        intent=classifier_result.intent,
                        confidence=classifier_result.confidence,
                        detection_method="classifier",
                        latency_ms=total_latency,
                        raw_scores=classifier_result.raw_scores,
                    )

        # Return semantic result if classifier wasn't more confident
        # or wasn't available
        return semantic_result

    async def _semantic_route(self, text: str) -> IntentResult:
        """Phase 1: Fast semantic routing using cosine similarity.

        Args:
            text: Input text to route.

        Returns:
            IntentResult from semantic matching.
        """
        start_time = time.perf_counter()

        if self._embedding_model is None or not self._route_embeddings:
            return IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.0,
                detection_method="semantic",
                latency_ms=(time.perf_counter() - start_time) * 1000,
                raw_scores={},
            )

        # Run embedding in thread pool
        loop = asyncio.get_event_loop()
        text_embedding = await loop.run_in_executor(
            None,
            lambda: self._embedding_model.encode(
                text,
                convert_to_numpy=True,
                normalize_embeddings=True,
            ),
        )

        # Calculate cosine similarity with each route centroid
        scores: dict[str, float] = {}
        for intent, centroid in self._route_embeddings.items():
            # Cosine similarity (embeddings are normalized)
            similarity = float(np.dot(text_embedding, centroid))
            scores[intent.value] = similarity

        # Find best matching intent
        best_intent = ContentIntent.SAFE
        best_score = 0.0

        for intent_value, score in scores.items():
            if score > best_score:
                best_score = score
                best_intent = ContentIntent(intent_value)

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        logger.debug(
            "semantic_route_completed",
            intent=best_intent.value,
            confidence=round(best_score, 4),
            latency_ms=round(elapsed_ms, 2),
        )

        return IntentResult(
            intent=best_intent,
            confidence=best_score,
            detection_method="semantic",
            latency_ms=elapsed_ms,
            raw_scores=scores,
        )

    async def _classify(self, text: str) -> IntentResult:
        """Phase 2: Transformer-based NSFW classification.

        Args:
            text: Input text to classify.

        Returns:
            IntentResult from classifier.
        """
        start_time = time.perf_counter()

        if self._classifier is None:
            return IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.0,
                detection_method="classifier",
                latency_ms=(time.perf_counter() - start_time) * 1000,
                raw_scores={},
            )

        # Run classifier in thread pool
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None,
                lambda: self._classifier(text),
            )
        except Exception as e:
            logger.warning(
                "classifier_inference_failed",
                error=str(e),
            )
            return IntentResult(
                intent=ContentIntent.SAFE,
                confidence=0.0,
                detection_method="classifier",
                latency_ms=(time.perf_counter() - start_time) * 1000,
                raw_scores={"error": 0.0},
            )

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Parse classifier output
        # The TostAI model outputs labels like "nsfw" and "sfw"
        if result and len(result) > 0:
            label = result[0].get("label", "").lower()
            score = result[0].get("score", 0.0)

            # Map classifier labels to our intents
            if label in ("nsfw", "not_safe", "unsafe"):
                # NSFW detected - map to explicit (most restrictive)
                intent = ContentIntent.EXPLICIT
                confidence = score
            else:
                # SFW detected
                intent = ContentIntent.SAFE
                confidence = score

            raw_scores = {label: score}
        else:
            intent = ContentIntent.SAFE
            confidence = 0.0
            raw_scores = {}

        logger.debug(
            "classifier_completed",
            intent=intent.value,
            confidence=round(confidence, 4),
            latency_ms=round(elapsed_ms, 2),
        )

        return IntentResult(
            intent=intent,
            confidence=confidence,
            detection_method="classifier",
            latency_ms=elapsed_ms,
            raw_scores=raw_scores,
        )

    @property
    def is_initialized(self) -> bool:
        """Check if the detector has been initialized."""
        return self._initialized

    @property
    def has_embedding_model(self) -> bool:
        """Check if embedding model is available."""
        return self._embedding_model is not None

    @property
    def has_classifier(self) -> bool:
        """Check if classifier model is available."""
        return self._classifier is not None

    def get_status(self) -> dict[str, Any]:
        """Get detector status information.

        Returns:
            Dictionary with status information.
        """
        return {
            "initialized": self._initialized,
            "embedding_model": self._embedding_model_name,
            "embedding_model_loaded": self._embedding_model is not None,
            "classifier_model": self._classifier_model_name,
            "classifier_loaded": self._classifier is not None,
            "semantic_threshold": self._semantic_threshold,
            "classifier_threshold": self._classifier_threshold,
            "route_count": len(self._route_embeddings),
        }
