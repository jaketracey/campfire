"""Tests for proactive outreach prompt templates."""

import pytest

from orchestrator.prompts.manager import PromptManager


@pytest.fixture
def prompt_manager():
    return PromptManager(default_version="1.0.0")


class TestProactiveOutreachTemplate:
    """Tests for the proactive_outreach prompt template."""

    def test_template_exists(self, prompt_manager):
        template = prompt_manager.get_template("proactive_outreach")
        assert template is not None
        assert template.name == "proactive_outreach"
        assert template.version == "1.0.0"

    def test_template_renders(self, prompt_manager):
        result = prompt_manager.get_prompt(
            "proactive_outreach",
            companion_name="Luna",
            user_name="Alex",
            relationship_stage="friend",
            time_since_last_chat="3 days",
            last_session_summary="Discussed hiking plans for the weekend.",
            recent_memories="- Loves hiking\n- Has a dog named Max",
            user_local_time="Monday, 3:00 PM",
        )
        assert "Luna" in result
        assert "Alex" in result
        assert "friend" in result
        assert "3 days" in result
        assert "hiking" in result
        assert "NO_OUTREACH" in result

    def test_template_variables(self, prompt_manager):
        template = prompt_manager.get_template("proactive_outreach")
        expected_vars = [
            "companion_name",
            "user_name",
            "relationship_stage",
            "time_since_last_chat",
            "last_session_summary",
            "recent_memories",
            "user_local_time",
        ]
        for var in expected_vars:
            assert var in template.variables

    def test_missing_variable_raises(self, prompt_manager):
        with pytest.raises(KeyError):
            prompt_manager.get_prompt(
                "proactive_outreach",
                companion_name="Luna",
                # Missing other required variables
            )


class TestProactiveFollowupTemplate:
    """Tests for the proactive_followup prompt template."""

    def test_template_exists(self, prompt_manager):
        template = prompt_manager.get_template("proactive_followup")
        assert template is not None
        assert template.name == "proactive_followup"

    def test_template_renders(self, prompt_manager):
        result = prompt_manager.get_prompt(
            "proactive_followup",
            companion_name="Nova",
            user_name="Jordan",
            relationship_stage="close_friend",
            time_since_last_chat="1 day",
            last_session_summary="User mentioned wanting to learn guitar. Companion promised to share resources.",
            recent_memories="- Interested in music\n- Plays piano",
            user_local_time="Tuesday, 7:00 PM",
        )
        assert "Nova" in result
        assert "Jordan" in result
        assert "unfinished topic" in result
        assert "NO_OUTREACH" in result

    def test_template_has_same_variables(self, prompt_manager):
        outreach = prompt_manager.get_template("proactive_outreach")
        followup = prompt_manager.get_template("proactive_followup")
        assert set(outreach.variables) == set(followup.variables)
