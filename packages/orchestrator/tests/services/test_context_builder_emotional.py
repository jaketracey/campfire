"""Tests for emotional state integration in context builder."""

import pytest
from uuid import uuid4

from orchestrator.models.conversation import CompanionSpec
from orchestrator.models.emotional_state import (
    EmotionalDimension,
    EmotionalState,
    PrimaryEmotion,
)
from orchestrator.prompts.manager import PromptManager, PromptTemplate
from orchestrator.services.context_builder import ContextBuilder


class MockPromptManager:
    """Mock prompt manager that handles orchestrator-prefixed templates and
    the emotional_state_context template from the real registry."""

    current_version = "1.0.0"

    def __init__(self):
        # Use the real PromptManager to get access to emotional_state_context
        self._real = PromptManager()

    def get_prompt_effective(self, name: str, **kwargs) -> str:
        if "system_base" in name:
            return f"You are {kwargs.get('companion_name', 'a companion')}."
        elif "image_instruction" in name:
            return ""
        elif "multi_message_instruction" in name:
            return ""
        return ""

    def get_prompt(self, name: str, version: str | None = None, **kwargs) -> str:
        return self._real.get_prompt(name, version, **kwargs)


@pytest.fixture
def prompt_manager():
    return MockPromptManager()


@pytest.fixture
def context_builder(prompt_manager):
    return ContextBuilder(
        prompt_manager=prompt_manager,
        max_context_tokens=128000,
        default_turn_window=20,
    )


@pytest.fixture
def companion_spec():
    return CompanionSpec(
        id=uuid4(),
        name="Aria",
        description="A warm companion",
        personality_traits=["friendly", "warm"],
        system_prompt="You are Aria.",
        safety_level="standard",
        allowed_tools=[],
        core_tenets=[],
    )


class TestEmotionalStateInSystemPrompt:
    def test_emotional_state_included_in_prompt(self, context_builder, companion_spec):
        state = EmotionalState(
            companion_id=companion_spec.id,
            user_id=uuid4(),
            primary_emotion=PrimaryEmotion.JOY,
            dimensions=EmotionalDimension(valence=0.6, arousal=0.3, dominance=0.0),
            intensity=0.7,
            stability=0.8,
            triggers=["user shared exciting plans"],
            mood_description="feeling happy and content after user shared exciting plans",
        )

        prompt = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            emotional_state=state,
        )

        assert "Emotional State" in prompt
        assert "joy" in prompt
        assert "strongly" in prompt  # intensity 0.7
        assert "feeling happy" in prompt
        assert "user shared exciting plans" in prompt

    def test_emotional_state_absent_when_none(self, context_builder, companion_spec):
        prompt = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            emotional_state=None,
        )

        assert "Emotional State" not in prompt

    def test_emotional_state_placed_after_personality(self, context_builder, companion_spec):
        state = EmotionalState(
            companion_id=companion_spec.id,
            user_id=uuid4(),
            primary_emotion=PrimaryEmotion.TRUST,
            dimensions=EmotionalDimension(valence=0.3, arousal=0.0, dominance=0.0),
        )

        prompt = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            emotional_state=state,
        )

        # Personality (system prompt) comes before emotional state
        personality_pos = prompt.find("You are Aria")
        emotional_pos = prompt.find("Emotional State")
        assert personality_pos < emotional_pos

    def test_tone_modifier_in_prompt(self, context_builder, companion_spec):
        state = EmotionalState(
            companion_id=companion_spec.id,
            user_id=uuid4(),
            primary_emotion=PrimaryEmotion.SADNESS,
            dimensions=EmotionalDimension(valence=-0.5, arousal=-0.5, dominance=0.0),
            intensity=0.6,
            stability=0.5,
            triggers=["user expressed loneliness"],
            mood_description="feeling a bit down in a calm, reflective way",
        )

        prompt = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            emotional_state=state,
        )

        assert "subdued and reflective" in prompt
        assert "low" in prompt  # energy modifier

    def test_natural_instruction_in_prompt(self, context_builder, companion_spec):
        state = EmotionalState(
            companion_id=companion_spec.id,
            user_id=uuid4(),
            primary_emotion=PrimaryEmotion.ANTICIPATION,
        )

        prompt = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            emotional_state=state,
        )

        assert "do not explicitly state your emotions unless asked" in prompt


class TestPromptTemplateRendering:
    def test_emotional_state_template_exists(self):
        pm = PromptManager()
        template = pm.get_template("emotional_state_context")
        assert template is not None
        assert "primary_emotion" in template.variables

    def test_emotional_state_template_renders(self):
        pm = PromptManager()
        rendered = pm.get_prompt(
            "emotional_state_context",
            primary_emotion="joy",
            intensity_description="strongly",
            mood_description="feeling great",
            tone_modifier="warm and enthusiastic",
            energy_modifier="high",
            openness_modifier="very open",
            triggers="user shared good news",
        )
        assert "joy" in rendered
        assert "strongly" in rendered
        assert "warm and enthusiastic" in rendered
        assert "do not explicitly state" in rendered
