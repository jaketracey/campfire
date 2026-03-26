"""Tests for emotional state service."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

from orchestrator.models.conversation import CompanionSpec
from orchestrator.models.emotional_state import (
    EmotionalDimension,
    EmotionalState,
    PrimaryEmotion,
)
from orchestrator.services.emotional_state import (
    EmotionalStateService,
    _clamp,
    _valence_to_emotion,
    _build_mood_description,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def settings():
    """Minimal settings mock for the service."""
    s = MagicMock()
    s.gateway_internal_url = "http://localhost:3002"
    s.internal_service_key = "test-key"
    return s


@pytest.fixture
def service(settings):
    svc = EmotionalStateService(settings)
    # Disable gateway calls for unit tests
    svc._fetch_from_gateway = AsyncMock(return_value=None)
    svc._save_to_gateway = AsyncMock()
    return svc


@pytest.fixture
def companion_spec():
    return CompanionSpec(
        id=uuid4(),
        name="TestCompanion",
        description="A test companion",
        personality_traits=["friendly", "warm"],
        system_prompt="You are a friendly companion.",
        archetype="caregiver",
        personality_sliders={"warmth": 80, "energy": 60, "empathy": 70, "assertiveness": 50, "optimism": 70},
    )


@pytest.fixture
def jester_spec():
    return CompanionSpec(
        id=uuid4(),
        name="Jester",
        description="A playful companion",
        personality_traits=["playful", "funny"],
        system_prompt="You are a playful jester.",
        archetype="jester",
        personality_sliders={"warmth": 60, "energy": 80, "empathy": 50, "assertiveness": 40, "optimism": 80},
    )


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_clamp(self):
        assert _clamp(0.5, 0.0, 1.0) == 0.5
        assert _clamp(-0.5, 0.0, 1.0) == 0.0
        assert _clamp(1.5, 0.0, 1.0) == 1.0

    def test_valence_to_emotion(self):
        assert _valence_to_emotion(0.8) == PrimaryEmotion.JOY
        assert _valence_to_emotion(0.3) == PrimaryEmotion.TRUST
        assert _valence_to_emotion(0.0) == PrimaryEmotion.ANTICIPATION
        assert _valence_to_emotion(-0.2) == PrimaryEmotion.FEAR
        assert _valence_to_emotion(-0.6) == PrimaryEmotion.SADNESS
        # Extreme negative
        assert _valence_to_emotion(-1.0) == PrimaryEmotion.SADNESS

    def test_build_mood_description(self):
        mood = _build_mood_description(PrimaryEmotion.JOY, 0.6, 0.5, "user was kind")
        assert "happy" in mood
        assert "energy" in mood
        assert "user was kind" in mood

    def test_build_mood_description_calm(self):
        mood = _build_mood_description(PrimaryEmotion.TRUST, 0.3, -0.5, "gentle chat")
        assert "warm" in mood
        assert "calm" in mood or "reflective" in mood


# ---------------------------------------------------------------------------
# Baseline derivation tests
# ---------------------------------------------------------------------------

class TestBaseline:
    def test_caregiver_baseline(self, service, companion_spec):
        baseline = service.get_baseline(companion_spec)
        # Caregiver with high warmth should have positive valence
        assert baseline.primary_emotion == PrimaryEmotion.TRUST
        assert baseline.dimensions.valence > 0.3
        assert baseline.stability == 0.8

    def test_jester_baseline(self, service, jester_spec):
        baseline = service.get_baseline(jester_spec)
        assert baseline.primary_emotion == PrimaryEmotion.JOY
        assert baseline.dimensions.valence > 0.4
        assert baseline.dimensions.arousal > 0.3

    def test_unknown_archetype_uses_default(self, service, settings):
        spec = CompanionSpec(
            id=uuid4(),
            name="Unknown",
            description="Test",
            personality_traits=[],
            system_prompt="test",
            archetype="unknown_type",
        )
        baseline = service.get_baseline(spec)
        # Should use the default baseline
        assert baseline.primary_emotion == PrimaryEmotion.TRUST
        assert baseline.dimensions.valence == pytest.approx(0.2, abs=0.01)

    def test_slider_influence_on_valence(self, service):
        spec_low_warmth = CompanionSpec(
            id=uuid4(),
            name="Cold",
            description="Test",
            personality_traits=[],
            system_prompt="test",
            archetype="sage",
            personality_sliders={"warmth": 10},
        )
        spec_high_warmth = CompanionSpec(
            id=uuid4(),
            name="Warm",
            description="Test",
            personality_traits=[],
            system_prompt="test",
            archetype="sage",
            personality_sliders={"warmth": 90},
        )
        low = service.get_baseline(spec_low_warmth)
        high = service.get_baseline(spec_high_warmth)
        assert high.dimensions.valence > low.dimensions.valence


# ---------------------------------------------------------------------------
# State retrieval tests
# ---------------------------------------------------------------------------

class TestGetCurrentState:
    @pytest.mark.asyncio
    async def test_returns_default_on_first_access(self, service):
        cid, uid = uuid4(), uuid4()
        state = await service.get_current_state(cid, uid)
        assert state.companion_id == cid
        assert state.user_id == uid
        assert state.primary_emotion == PrimaryEmotion.TRUST

    @pytest.mark.asyncio
    async def test_caches_state(self, service):
        cid, uid = uuid4(), uuid4()
        s1 = await service.get_current_state(cid, uid)
        s2 = await service.get_current_state(cid, uid)
        assert s1.id == s2.id


# ---------------------------------------------------------------------------
# Update after turn tests
# ---------------------------------------------------------------------------

class TestUpdateAfterTurn:
    @pytest.mark.asyncio
    async def test_positive_sentiment_increases_valence(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # Seed initial state
        await service.get_current_state(cid, uid)

        updated = await service.update_after_turn(
            companion_id=cid,
            user_id=uid,
            turn_summary="user shared great news about promotion",
            user_sentiment="very_positive",
            companion_spec=companion_spec,
        )

        assert updated.dimensions.valence > 0.0
        assert updated.intensity > 0.4
        assert len(updated.triggers) > 0
        assert "promotion" in updated.triggers[-1]

    @pytest.mark.asyncio
    async def test_negative_sentiment_decreases_valence(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # Start with a positive state
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            primary_emotion=PrimaryEmotion.JOY,
            dimensions=EmotionalDimension(valence=0.5, arousal=0.3, dominance=0.0),
            intensity=0.6,
            stability=0.7,
        )

        updated = await service.update_after_turn(
            companion_id=cid,
            user_id=uid,
            turn_summary="user is upset about a fight with friend",
            user_sentiment="negative",
            companion_spec=companion_spec,
        )

        # Valence should decrease (smoothed, so won't flip instantly)
        assert updated.dimensions.valence < 0.5

    @pytest.mark.asyncio
    async def test_transition_smoothing_prevents_instant_flip(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # Start at very positive state
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            primary_emotion=PrimaryEmotion.JOY,
            dimensions=EmotionalDimension(valence=0.8, arousal=0.5, dominance=0.0),
            intensity=0.8,
            stability=0.8,
        )

        # Hit with very negative sentiment
        updated = await service.update_after_turn(
            companion_id=cid,
            user_id=uid,
            turn_summary="user is devastated",
            user_sentiment="very_negative",
            companion_spec=companion_spec,
        )

        # Should NOT flip to negative in a single turn due to smoothing
        assert updated.dimensions.valence > 0.0, (
            "Smoothing should prevent instant flip from +0.8 to negative"
        )

    @pytest.mark.asyncio
    async def test_stability_decreases_on_big_shift(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        initial_stability = 0.8
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            primary_emotion=PrimaryEmotion.JOY,
            dimensions=EmotionalDimension(valence=0.6, arousal=0.3, dominance=0.0),
            stability=initial_stability,
        )

        updated = await service.update_after_turn(
            companion_id=cid,
            user_id=uid,
            turn_summary="shocking bad news",
            user_sentiment="very_negative",
            companion_spec=companion_spec,
        )

        assert updated.stability < initial_stability

    @pytest.mark.asyncio
    async def test_high_empathy_amplifies_shift(self, service):
        cid, uid = uuid4(), uuid4()
        await service.get_current_state(cid, uid)

        high_empathy = CompanionSpec(
            id=cid,
            name="Empath",
            description="test",
            personality_traits=[],
            system_prompt="test",
            personality_sliders={"empathy": 100},
        )
        low_empathy = CompanionSpec(
            id=cid,
            name="Robot",
            description="test",
            personality_traits=[],
            system_prompt="test",
            personality_sliders={"empathy": 10},
        )

        # Reset and update with high empathy
        service._cache.clear()
        await service.get_current_state(cid, uid)
        high_update = await service.update_after_turn(
            cid, uid, "great news", "very_positive", high_empathy
        )

        # Reset and update with low empathy
        service._cache.clear()
        await service.get_current_state(cid, uid)
        low_update = await service.update_after_turn(
            cid, uid, "great news", "very_positive", low_empathy
        )

        assert high_update.dimensions.valence > low_update.dimensions.valence

    @pytest.mark.asyncio
    async def test_transition_history_appended(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        await service.get_current_state(cid, uid)

        updated = await service.update_after_turn(
            cid, uid, "first turn", "positive", companion_spec
        )
        assert len(updated.transition_history) == 1
        assert updated.transition_history[0]["type"] == "conversation"

    @pytest.mark.asyncio
    async def test_transition_history_capped(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # Seed with 10 transitions already
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            transition_history=[{"from": "trust", "to": "joy", "trigger": f"t{i}", "type": "conversation", "from_v": 0, "to_v": 0.1, "ts": ""} for i in range(10)],
        )

        updated = await service.update_after_turn(
            cid, uid, "one more turn", "neutral", companion_spec
        )
        assert len(updated.transition_history) <= 10

    @pytest.mark.asyncio
    async def test_saves_to_gateway(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        await service.get_current_state(cid, uid)
        await service.update_after_turn(cid, uid, "hello", "positive", companion_spec)
        service._save_to_gateway.assert_called()


# ---------------------------------------------------------------------------
# Time decay tests
# ---------------------------------------------------------------------------

class TestTimeDecay:
    @pytest.mark.asyncio
    async def test_no_decay_under_30_minutes(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # State updated just now
        state = EmotionalState(
            companion_id=cid,
            user_id=uid,
            primary_emotion=PrimaryEmotion.SADNESS,
            dimensions=EmotionalDimension(valence=-0.5, arousal=0.3, dominance=0.0),
            intensity=0.7,
            updated_at=datetime.utcnow(),
        )
        service._cache[(str(cid), str(uid))] = state

        decayed = await service.apply_time_decay(cid, uid, companion_spec)
        # No change
        assert decayed.dimensions.valence == state.dimensions.valence

    @pytest.mark.asyncio
    async def test_decay_after_hours(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        # State updated 12 hours ago
        state = EmotionalState(
            companion_id=cid,
            user_id=uid,
            primary_emotion=PrimaryEmotion.SADNESS,
            dimensions=EmotionalDimension(valence=-0.6, arousal=0.5, dominance=0.0),
            intensity=0.8,
            stability=0.5,
            updated_at=datetime.utcnow() - timedelta(hours=12),
        )
        service._cache[(str(cid), str(uid))] = state

        decayed = await service.apply_time_decay(cid, uid, companion_spec)

        # Valence should move toward baseline (positive for caregiver)
        assert decayed.dimensions.valence > state.dimensions.valence
        # Intensity should decrease toward baseline
        assert decayed.intensity < state.intensity
        # Stability should recover
        assert decayed.stability >= state.stability

    @pytest.mark.asyncio
    async def test_high_stability_resists_decay(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        past = datetime.utcnow() - timedelta(hours=6)

        # High stability state
        stable = EmotionalState(
            companion_id=cid,
            user_id=uid,
            dimensions=EmotionalDimension(valence=-0.4, arousal=0.3, dominance=0.0),
            stability=0.9,
            updated_at=past,
        )
        service._cache[(str(cid), str(uid))] = stable
        decayed_stable = await service.apply_time_decay(cid, uid, companion_spec)

        # Low stability state
        service._cache.clear()
        volatile = EmotionalState(
            companion_id=cid,
            user_id=uid,
            dimensions=EmotionalDimension(valence=-0.4, arousal=0.3, dominance=0.0),
            stability=0.2,
            updated_at=past,
        )
        service._cache[(str(cid), str(uid))] = volatile
        decayed_volatile = await service.apply_time_decay(cid, uid, companion_spec)

        # Volatile state should have changed more (moved more toward baseline)
        stable_change = abs(decayed_stable.dimensions.valence - (-0.4))
        volatile_change = abs(decayed_volatile.dimensions.valence - (-0.4))
        assert volatile_change > stable_change

    @pytest.mark.asyncio
    async def test_decay_appends_to_history(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        state = EmotionalState(
            companion_id=cid,
            user_id=uid,
            dimensions=EmotionalDimension(valence=-0.3),
            updated_at=datetime.utcnow() - timedelta(hours=2),
        )
        service._cache[(str(cid), str(uid))] = state

        decayed = await service.apply_time_decay(cid, uid, companion_spec)
        assert len(decayed.transition_history) == 1
        assert decayed.transition_history[0]["type"] == "time_decay"


# ---------------------------------------------------------------------------
# Intensity scaling tests
# ---------------------------------------------------------------------------

class TestIntensityScaling:
    @pytest.mark.asyncio
    async def test_neutral_sentiment_lowers_intensity(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            intensity=0.8,
        )

        updated = await service.update_after_turn(
            cid, uid, "just chatting", "neutral", companion_spec
        )
        assert updated.intensity < 0.8

    @pytest.mark.asyncio
    async def test_very_positive_raises_intensity(self, service, companion_spec):
        cid, uid = companion_spec.id, uuid4()
        service._cache[(str(cid), str(uid))] = EmotionalState(
            companion_id=cid,
            user_id=uid,
            intensity=0.3,
        )

        updated = await service.update_after_turn(
            cid, uid, "this is the best day ever!", "very_positive", companion_spec
        )
        assert updated.intensity > 0.3
