"""Tests for emotional state models."""

import pytest
from uuid import uuid4

from orchestrator.models.emotional_state import (
    EmotionalDimension,
    EmotionalState,
    EmotionalTransition,
    PrimaryEmotion,
)


class TestEmotionalDimension:
    def test_default_values(self):
        dim = EmotionalDimension()
        assert dim.valence == 0.0
        assert dim.arousal == 0.0
        assert dim.dominance == 0.0

    def test_valid_range(self):
        dim = EmotionalDimension(valence=-1.0, arousal=1.0, dominance=0.5)
        assert dim.valence == -1.0
        assert dim.arousal == 1.0
        assert dim.dominance == 0.5

    def test_out_of_range_rejected(self):
        with pytest.raises(Exception):
            EmotionalDimension(valence=1.5)
        with pytest.raises(Exception):
            EmotionalDimension(arousal=-1.1)

    def test_frozen(self):
        dim = EmotionalDimension(valence=0.5)
        with pytest.raises(Exception):
            dim.valence = 0.8  # type: ignore[misc]


class TestEmotionalState:
    def _make_state(self, **overrides):
        defaults = {
            "companion_id": uuid4(),
            "user_id": uuid4(),
        }
        defaults.update(overrides)
        return EmotionalState(**defaults)

    def test_defaults(self):
        state = self._make_state()
        assert state.primary_emotion == PrimaryEmotion.TRUST
        assert state.secondary_emotion is None
        assert state.intensity == 0.5
        assert state.stability == 0.7
        assert state.triggers == []
        assert state.mood_description == "feeling balanced and attentive"

    def test_intensity_description(self):
        assert self._make_state(intensity=0.1).intensity_description() == "faintly"
        assert self._make_state(intensity=0.3).intensity_description() == "mildly"
        assert self._make_state(intensity=0.5).intensity_description() == "moderately"
        assert self._make_state(intensity=0.7).intensity_description() == "strongly"
        assert self._make_state(intensity=0.9).intensity_description() == "intensely"

    def test_tone_modifier_warm_enthusiastic(self):
        state = self._make_state(
            dimensions=EmotionalDimension(valence=0.5, arousal=0.5, dominance=0.0)
        )
        assert state.tone_modifier() == "warm and enthusiastic"

    def test_tone_modifier_warm_calm(self):
        state = self._make_state(
            dimensions=EmotionalDimension(valence=0.5, arousal=-0.1, dominance=0.0)
        )
        assert state.tone_modifier() == "warm and calm"

    def test_tone_modifier_tense(self):
        state = self._make_state(
            dimensions=EmotionalDimension(valence=-0.5, arousal=0.5, dominance=0.0)
        )
        assert state.tone_modifier() == "tense and guarded"

    def test_tone_modifier_subdued(self):
        state = self._make_state(
            dimensions=EmotionalDimension(valence=-0.5, arousal=-0.5, dominance=0.0)
        )
        assert state.tone_modifier() == "subdued and reflective"

    def test_tone_modifier_balanced(self):
        state = self._make_state(
            dimensions=EmotionalDimension(valence=0.1, arousal=0.1, dominance=0.0)
        )
        assert state.tone_modifier() == "balanced and attentive"

    def test_energy_modifier(self):
        assert self._make_state(
            dimensions=EmotionalDimension(arousal=0.8)
        ).energy_modifier() == "high"
        assert self._make_state(
            dimensions=EmotionalDimension(arousal=0.2)
        ).energy_modifier() == "moderate"
        assert self._make_state(
            dimensions=EmotionalDimension(arousal=-0.2)
        ).energy_modifier() == "low"
        assert self._make_state(
            dimensions=EmotionalDimension(arousal=-0.8)
        ).energy_modifier() == "very low"

    def test_openness_modifier(self):
        assert self._make_state(
            dimensions=EmotionalDimension(valence=0.5), stability=0.8
        ).openness_modifier() == "very open"
        assert self._make_state(
            dimensions=EmotionalDimension(valence=0.1), stability=0.3
        ).openness_modifier() == "open"
        assert self._make_state(
            dimensions=EmotionalDimension(valence=-0.2), stability=0.5
        ).openness_modifier() == "somewhat guarded"
        assert self._make_state(
            dimensions=EmotionalDimension(valence=-0.5), stability=0.3
        ).openness_modifier() == "reserved"

    def test_intensity_bounds(self):
        with pytest.raises(Exception):
            self._make_state(intensity=-0.1)
        with pytest.raises(Exception):
            self._make_state(intensity=1.1)

    def test_stability_bounds(self):
        with pytest.raises(Exception):
            self._make_state(stability=-0.1)
        with pytest.raises(Exception):
            self._make_state(stability=1.1)


class TestEmotionalTransition:
    def test_to_history_dict(self):
        t = EmotionalTransition(
            from_emotion=PrimaryEmotion.TRUST,
            to_emotion=PrimaryEmotion.JOY,
            from_valence=0.2,
            to_valence=0.5,
            trigger="user shared good news",
            transition_type="conversation",
        )
        d = t.to_history_dict()
        assert d["from"] == "trust"
        assert d["to"] == "joy"
        assert d["trigger"] == "user shared good news"
        assert d["type"] == "conversation"
        assert "ts" in d

    def test_frozen(self):
        t = EmotionalTransition(
            from_emotion=PrimaryEmotion.TRUST,
            to_emotion=PrimaryEmotion.JOY,
            from_valence=0.2,
            to_valence=0.5,
            trigger="test",
            transition_type="conversation",
        )
        with pytest.raises(Exception):
            t.trigger = "modified"  # type: ignore[misc]
