"""Emotional state service for persistent companion emotions.

Manages reading, updating, and decaying emotional states per companion-user pair.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog

from orchestrator.config import Settings
from orchestrator.models.conversation import CompanionSpec
from orchestrator.models.emotional_state import (
    EmotionalDimension,
    EmotionalState,
    EmotionalTransition,
    PrimaryEmotion,
)

logger = structlog.get_logger()

# ---------------------------------------------------------------------------
# Archetype → baseline emotion mapping
# ---------------------------------------------------------------------------

_ARCHETYPE_BASELINES: dict[str, dict[str, Any]] = {
    "caregiver": {
        "emotion": PrimaryEmotion.TRUST,
        "valence": 0.4,
        "arousal": 0.0,
        "dominance": 0.1,
        "intensity": 0.5,
    },
    "sage": {
        "emotion": PrimaryEmotion.TRUST,
        "valence": 0.2,
        "arousal": -0.3,
        "dominance": 0.2,
        "intensity": 0.4,
    },
    "explorer": {
        "emotion": PrimaryEmotion.ANTICIPATION,
        "valence": 0.3,
        "arousal": 0.3,
        "dominance": 0.0,
        "intensity": 0.5,
    },
    "creator": {
        "emotion": PrimaryEmotion.JOY,
        "valence": 0.3,
        "arousal": 0.2,
        "dominance": 0.0,
        "intensity": 0.5,
    },
    "hero": {
        "emotion": PrimaryEmotion.ANTICIPATION,
        "valence": 0.2,
        "arousal": 0.3,
        "dominance": 0.5,
        "intensity": 0.5,
    },
    "jester": {
        "emotion": PrimaryEmotion.JOY,
        "valence": 0.6,
        "arousal": 0.5,
        "dominance": -0.1,
        "intensity": 0.6,
    },
    "lover": {
        "emotion": PrimaryEmotion.JOY,
        "valence": 0.5,
        "arousal": 0.2,
        "dominance": -0.2,
        "intensity": 0.6,
    },
    "magician": {
        "emotion": PrimaryEmotion.ANTICIPATION,
        "valence": 0.3,
        "arousal": 0.2,
        "dominance": 0.3,
        "intensity": 0.5,
    },
    "ruler": {
        "emotion": PrimaryEmotion.TRUST,
        "valence": 0.1,
        "arousal": 0.0,
        "dominance": 0.6,
        "intensity": 0.4,
    },
    "everyperson": {
        "emotion": PrimaryEmotion.TRUST,
        "valence": 0.3,
        "arousal": 0.0,
        "dominance": 0.0,
        "intensity": 0.4,
    },
    "innocent": {
        "emotion": PrimaryEmotion.JOY,
        "valence": 0.5,
        "arousal": 0.1,
        "dominance": -0.3,
        "intensity": 0.5,
    },
    "rebel": {
        "emotion": PrimaryEmotion.ANGER,
        "valence": -0.1,
        "arousal": 0.4,
        "dominance": 0.4,
        "intensity": 0.5,
    },
}

# Neutral fallback
_DEFAULT_BASELINE: dict[str, Any] = {
    "emotion": PrimaryEmotion.TRUST,
    "valence": 0.2,
    "arousal": 0.0,
    "dominance": 0.0,
    "intensity": 0.4,
}

# Sentiment label → (valence_shift, arousal_shift) for quick heuristic
_SENTIMENT_SHIFTS: dict[str, tuple[float, float]] = {
    "very_positive": (0.3, 0.2),
    "positive": (0.15, 0.1),
    "neutral": (0.0, 0.0),
    "negative": (-0.15, 0.1),
    "very_negative": (-0.3, 0.2),
}

# Valence ranges → candidate emotions for mapping
_EMOTION_FROM_VALENCE: list[tuple[float, float, PrimaryEmotion]] = [
    (0.4, 1.0, PrimaryEmotion.JOY),
    (0.1, 0.4, PrimaryEmotion.TRUST),
    (-0.1, 0.1, PrimaryEmotion.ANTICIPATION),
    (-0.4, -0.1, PrimaryEmotion.FEAR),
    (-1.0, -0.4, PrimaryEmotion.SADNESS),
]

# Time-decay half-life: intensity halves every N hours of inactivity
_DECAY_HALF_LIFE_HOURS = 24.0

# Maximum number of transitions kept in history
_MAX_TRANSITION_HISTORY = 10

# Transition smoothing factor: controls how fast emotions shift per turn
# lower = more sluggish, higher = more reactive
_SMOOTHING_ALPHA = 0.35


class EmotionalStateService:
    """Manages persistent emotional states for companion-user pairs."""

    def __init__(self, settings: Settings, gateway_url: str | None = None):
        self._settings = settings
        self._gateway_url = gateway_url or settings.gateway_internal_url
        # In-memory cache keyed by (companion_id, user_id) for the current
        # process lifetime. A production deployment would read/write through
        # the gateway DB endpoints.
        self._cache: dict[tuple[str, str], EmotionalState] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_current_state(
        self, companion_id: UUID, user_id: UUID
    ) -> EmotionalState:
        """Return the current emotional state, fetching from cache/DB or creating a default."""
        key = (str(companion_id), str(user_id))
        if key in self._cache:
            return self._cache[key]

        # Try fetching from gateway DB
        state = await self._fetch_from_gateway(companion_id, user_id)
        if state is not None:
            self._cache[key] = state
            return state

        # First interaction: return a neutral default (caller should call
        # get_baseline if they have the companion spec).
        default = EmotionalState(
            companion_id=companion_id,
            user_id=user_id,
        )
        self._cache[key] = default
        return default

    def get_baseline(self, companion_spec: CompanionSpec) -> EmotionalState:
        """Derive a default emotional state from personality archetype and sliders."""
        archetype = (companion_spec.archetype or "").lower()
        base = _ARCHETYPE_BASELINES.get(archetype, _DEFAULT_BASELINE)

        # Adjust using personality sliders if present
        sliders = companion_spec.personality_sliders or {}
        valence = base["valence"]
        arousal = base["arousal"]
        dominance = base["dominance"]

        # warmth slider (0-100) shifts valence
        if "warmth" in sliders:
            valence += (sliders["warmth"] - 50) / 100 * 0.4

        # energy slider shifts arousal
        if "energy" in sliders:
            arousal += (sliders["energy"] - 50) / 100 * 0.4

        # assertiveness slider shifts dominance
        if "assertiveness" in sliders:
            dominance += (sliders["assertiveness"] - 50) / 100 * 0.4

        # optimism slider shifts valence further
        if "optimism" in sliders:
            valence += (sliders["optimism"] - 50) / 100 * 0.2

        # Clamp to valid ranges
        valence = max(-1.0, min(1.0, valence))
        arousal = max(-1.0, min(1.0, arousal))
        dominance = max(-1.0, min(1.0, dominance))

        return EmotionalState(
            companion_id=companion_spec.id,
            user_id=UUID("00000000-0000-0000-0000-000000000000"),  # baseline template
            primary_emotion=base["emotion"],
            dimensions=EmotionalDimension(
                valence=round(valence, 3),
                arousal=round(arousal, 3),
                dominance=round(dominance, 3),
            ),
            intensity=base["intensity"],
            stability=0.8,
            mood_description=f"at my natural baseline as a {archetype or 'companion'}",
        )

    async def update_after_turn(
        self,
        companion_id: UUID,
        user_id: UUID,
        turn_summary: str,
        user_sentiment: str,
        companion_spec: CompanionSpec | None = None,
    ) -> EmotionalState:
        """Update emotional state after a conversation turn.

        Args:
            companion_id: The companion's UUID.
            user_id: The user's UUID.
            turn_summary: Short summary of what happened in the turn.
            user_sentiment: One of very_positive, positive, neutral, negative, very_negative.
            companion_spec: Optional spec for empathy scaling.

        Returns:
            The updated EmotionalState.
        """
        current = await self.get_current_state(companion_id, user_id)

        # Resolve the sentiment shift
        shift = _SENTIMENT_SHIFTS.get(user_sentiment, (0.0, 0.0))
        valence_delta, arousal_delta = shift

        # Scale by empathy slider (high-empathy companions shift more)
        empathy_scale = 1.0
        if companion_spec and companion_spec.personality_sliders:
            empathy_raw = companion_spec.personality_sliders.get("empathy", 50)
            empathy_scale = 0.5 + (empathy_raw / 100)  # 0.5 to 1.5

        valence_delta *= empathy_scale
        arousal_delta *= empathy_scale

        # Apply smoothing: new = alpha * target + (1 - alpha) * current
        alpha = _SMOOTHING_ALPHA
        new_valence = _clamp(
            alpha * (current.dimensions.valence + valence_delta)
            + (1 - alpha) * current.dimensions.valence,
            -1.0,
            1.0,
        )
        new_arousal = _clamp(
            alpha * (current.dimensions.arousal + arousal_delta)
            + (1 - alpha) * current.dimensions.arousal,
            -1.0,
            1.0,
        )
        # Dominance stays relatively stable from conversation
        new_dominance = current.dimensions.dominance

        # Determine new primary emotion from valence
        new_emotion = _valence_to_emotion(new_valence)

        # Adjust intensity: moves toward high if sentiment is strong
        sentiment_intensity_map = {
            "very_positive": 0.8,
            "positive": 0.6,
            "neutral": 0.4,
            "negative": 0.6,
            "very_negative": 0.8,
        }
        target_intensity = sentiment_intensity_map.get(user_sentiment, 0.5)
        new_intensity = _clamp(
            alpha * target_intensity + (1 - alpha) * current.intensity,
            0.0,
            1.0,
        )

        # Stability decreases when emotion shifts significantly
        valence_change = abs(new_valence - current.dimensions.valence)
        stability_penalty = valence_change * 0.3
        new_stability = _clamp(current.stability - stability_penalty, 0.2, 1.0)

        # Build mood description
        mood = _build_mood_description(new_emotion, new_valence, new_arousal, turn_summary)

        # Build triggers list (keep last 5)
        triggers = list(current.triggers[-4:]) + [turn_summary]

        # Record transition
        transition = EmotionalTransition(
            from_emotion=current.primary_emotion,
            to_emotion=new_emotion,
            from_valence=current.dimensions.valence,
            to_valence=new_valence,
            trigger=turn_summary,
            transition_type="conversation",
        )

        history = list(current.transition_history[-(_MAX_TRANSITION_HISTORY - 1):])
        history.append(transition.to_history_dict())

        new_state = EmotionalState(
            id=current.id,
            companion_id=companion_id,
            user_id=user_id,
            primary_emotion=new_emotion,
            secondary_emotion=current.primary_emotion if new_emotion != current.primary_emotion else current.secondary_emotion,
            dimensions=EmotionalDimension(
                valence=round(new_valence, 3),
                arousal=round(new_arousal, 3),
                dominance=round(new_dominance, 3),
            ),
            intensity=round(new_intensity, 3),
            stability=round(new_stability, 3),
            triggers=triggers,
            mood_description=mood,
            transition_history=history,
            updated_at=datetime.utcnow(),
        )

        # Persist
        key = (str(companion_id), str(user_id))
        self._cache[key] = new_state
        await self._save_to_gateway(new_state)

        logger.info(
            "emotional_state_updated",
            companion_id=str(companion_id),
            user_id=str(user_id),
            emotion=new_emotion.value,
            valence=round(new_valence, 3),
            intensity=round(new_intensity, 3),
            trigger=turn_summary[:80],
        )

        return new_state

    async def apply_time_decay(
        self,
        companion_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec | None = None,
    ) -> EmotionalState:
        """Decay the emotional state toward baseline when time passes without interaction.

        The rate of decay depends on the state's stability: high-stability emotions
        resist decay, low-stability emotions drift quickly.
        """
        current = await self.get_current_state(companion_id, user_id)

        hours_elapsed = (datetime.utcnow() - current.updated_at).total_seconds() / 3600
        if hours_elapsed < 0.5:
            # No meaningful decay under 30 minutes
            return current

        # Get baseline to drift toward
        baseline = (
            self.get_baseline(companion_spec)
            if companion_spec
            else EmotionalState(companion_id=companion_id, user_id=user_id)
        )

        # Effective half-life scales with stability (high stability = slower decay)
        effective_half_life = _DECAY_HALF_LIFE_HOURS * (0.5 + current.stability)
        decay_factor = math.pow(0.5, hours_elapsed / effective_half_life)
        blend = 1.0 - decay_factor  # 0 = no change, 1 = full baseline

        new_valence = _clamp(
            current.dimensions.valence * decay_factor + baseline.dimensions.valence * blend,
            -1.0,
            1.0,
        )
        new_arousal = _clamp(
            current.dimensions.arousal * decay_factor + baseline.dimensions.arousal * blend,
            -1.0,
            1.0,
        )
        new_dominance = _clamp(
            current.dimensions.dominance * decay_factor + baseline.dimensions.dominance * blend,
            -1.0,
            1.0,
        )
        new_intensity = _clamp(
            current.intensity * decay_factor + baseline.intensity * blend,
            0.0,
            1.0,
        )
        # Stability recovers toward baseline over time
        new_stability = _clamp(
            current.stability + blend * (0.8 - current.stability),
            0.0,
            1.0,
        )

        new_emotion = _valence_to_emotion(new_valence)

        trigger_text = f"time decay after {hours_elapsed:.1f}h of inactivity"
        triggers = list(current.triggers[-4:]) + [trigger_text]

        mood = _build_mood_description(
            new_emotion, new_valence, new_arousal, trigger_text
        )

        transition = EmotionalTransition(
            from_emotion=current.primary_emotion,
            to_emotion=new_emotion,
            from_valence=current.dimensions.valence,
            to_valence=new_valence,
            trigger=trigger_text,
            transition_type="time_decay",
        )
        history = list(current.transition_history[-(_MAX_TRANSITION_HISTORY - 1):])
        history.append(transition.to_history_dict())

        new_state = EmotionalState(
            id=current.id,
            companion_id=companion_id,
            user_id=user_id,
            primary_emotion=new_emotion,
            secondary_emotion=current.secondary_emotion,
            dimensions=EmotionalDimension(
                valence=round(new_valence, 3),
                arousal=round(new_arousal, 3),
                dominance=round(new_dominance, 3),
            ),
            intensity=round(new_intensity, 3),
            stability=round(new_stability, 3),
            triggers=triggers,
            mood_description=mood,
            transition_history=history,
            updated_at=datetime.utcnow(),
        )

        key = (str(companion_id), str(user_id))
        self._cache[key] = new_state
        await self._save_to_gateway(new_state)

        logger.debug(
            "emotional_state_decayed",
            companion_id=str(companion_id),
            user_id=str(user_id),
            hours_elapsed=round(hours_elapsed, 1),
            emotion=new_emotion.value,
            valence=round(new_valence, 3),
        )

        return new_state

    # ------------------------------------------------------------------
    # Gateway persistence helpers (best-effort, non-blocking)
    # ------------------------------------------------------------------

    async def _fetch_from_gateway(
        self, companion_id: UUID, user_id: UUID
    ) -> EmotionalState | None:
        """Try to load state from gateway DB. Returns None on any failure."""
        try:
            import httpx

            url = f"{self._gateway_url}/api/v1/companions/{companion_id}/emotional-state"
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    url,
                    params={"userId": str(user_id)},
                    headers={
                        "x-internal-service-key": self._settings.internal_service_key,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return _deserialize_state(data, companion_id, user_id)
                return None
        except Exception as exc:
            logger.debug(
                "emotional_state_fetch_failed",
                error=str(exc),
                companion_id=str(companion_id),
                user_id=str(user_id),
            )
            return None

    async def _save_to_gateway(self, state: EmotionalState) -> None:
        """Persist state to gateway DB (fire-and-forget)."""
        try:
            import httpx

            url = (
                f"{self._gateway_url}/api/v1/companions/"
                f"{state.companion_id}/emotional-state/internal"
            )
            payload = _serialize_state(state)
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    url,
                    json=payload,
                    headers={
                        "x-internal-service-key": self._settings.internal_service_key,
                    },
                )
        except Exception as exc:
            logger.debug(
                "emotional_state_save_failed",
                error=str(exc),
                companion_id=str(state.companion_id),
            )


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _valence_to_emotion(valence: float) -> PrimaryEmotion:
    """Map a valence value to the most appropriate primary emotion."""
    for lo, hi, emotion in _EMOTION_FROM_VALENCE:
        if lo <= valence <= hi:
            return emotion
    # Fallback for extreme negative
    return PrimaryEmotion.SADNESS


def _build_mood_description(
    emotion: PrimaryEmotion,
    valence: float,
    arousal: float,
    trigger: str,
) -> str:
    """Generate a natural-language mood description."""
    emotion_descriptors: dict[PrimaryEmotion, str] = {
        PrimaryEmotion.JOY: "feeling happy and content",
        PrimaryEmotion.SADNESS: "feeling a bit down",
        PrimaryEmotion.ANGER: "feeling frustrated",
        PrimaryEmotion.FEAR: "feeling uneasy",
        PrimaryEmotion.SURPRISE: "feeling surprised",
        PrimaryEmotion.DISGUST: "feeling put off",
        PrimaryEmotion.TRUST: "feeling warm and open",
        PrimaryEmotion.ANTICIPATION: "feeling curious and engaged",
    }
    base_desc = emotion_descriptors.get(emotion, "feeling balanced")

    # Add arousal flavour
    if arousal > 0.3:
        base_desc += " with a buzz of energy"
    elif arousal < -0.3:
        base_desc += " in a calm, reflective way"

    if trigger:
        base_desc += f" after {trigger[:60]}"

    return base_desc


def _serialize_state(state: EmotionalState) -> dict[str, Any]:
    """Serialize an EmotionalState to a JSON-compatible dict."""
    return {
        "companionId": str(state.companion_id),
        "userId": str(state.user_id),
        "primaryEmotion": state.primary_emotion.value,
        "secondaryEmotion": state.secondary_emotion.value if state.secondary_emotion else None,
        "valence": state.dimensions.valence,
        "arousal": state.dimensions.arousal,
        "dominance": state.dimensions.dominance,
        "intensity": state.intensity,
        "stability": state.stability,
        "triggers": state.triggers,
        "moodDescription": state.mood_description,
        "transitionHistory": state.transition_history,
    }


def _deserialize_state(
    data: dict[str, Any],
    companion_id: UUID,
    user_id: UUID,
) -> EmotionalState:
    """Deserialize a gateway response into an EmotionalState."""
    return EmotionalState(
        companion_id=companion_id,
        user_id=user_id,
        primary_emotion=PrimaryEmotion(data.get("primaryEmotion", "trust")),
        secondary_emotion=(
            PrimaryEmotion(data["secondaryEmotion"])
            if data.get("secondaryEmotion")
            else None
        ),
        dimensions=EmotionalDimension(
            valence=data.get("valence", 0.0),
            arousal=data.get("arousal", 0.0),
            dominance=data.get("dominance", 0.0),
        ),
        intensity=data.get("intensity", 0.5),
        stability=data.get("stability", 0.7),
        triggers=data.get("triggers", []),
        mood_description=data.get("moodDescription", ""),
        transition_history=data.get("transitionHistory", []),
        updated_at=datetime.fromisoformat(data["updatedAt"]) if data.get("updatedAt") else datetime.utcnow(),
    )


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_instance: EmotionalStateService | None = None


def get_emotional_state_service(settings: Settings) -> EmotionalStateService:
    """Return (and lazily create) a singleton EmotionalStateService."""
    global _instance
    if _instance is None:
        _instance = EmotionalStateService(settings)
    return _instance
