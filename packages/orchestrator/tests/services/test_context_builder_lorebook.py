"""Tests for ContextBuilder Lorebook context formatting.

These tests verify the integration of Lorebook/World Info context into the
conversation context builder, ensuring lorebook entries are properly formatted
and included in the system prompt.
"""

import pytest
from uuid import uuid4

from orchestrator.models.conversation import CompanionSpec
from orchestrator.prompts.manager import PromptManager
from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.lorebook import LorebookEntry, LorebookMatch


@pytest.fixture
def prompt_manager():
    """Create a mock prompt manager."""
    class MockPromptManager:
        current_version = "1.0.0"

        def get_prompt_effective(self, name: str, **kwargs) -> str:
            if "system_base" in name:
                return f"You are {kwargs.get('companion_name', 'a companion')}."
            elif "image_instruction" in name:
                return ""
            elif "multi_message_instruction" in name:
                return ""
            return ""

    return MockPromptManager()


@pytest.fixture
def context_builder(prompt_manager):
    """Create a context builder instance."""
    return ContextBuilder(
        prompt_manager=prompt_manager,
        max_context_tokens=128000,
        default_turn_window=20,
    )


@pytest.fixture
def companion_spec():
    """Create a sample companion spec."""
    return CompanionSpec(
        id=uuid4(),
        name="Test Companion",
        personality_traits=["friendly", "helpful"],
        communication_style="casual",
        description="A test companion",
        system_prompt="You are a helpful assistant.",
        safety_level="standard",
        allowed_tools=[],
        core_tenets=[],
        max_context_turns=20,
    )


@pytest.fixture
def sample_lorebook_entry():
    """Create a sample lorebook entry."""
    return LorebookEntry(
        id=uuid4(),
        companion_id=uuid4(),
        name="The Ancient Library",
        trigger_keywords=["library", "books", "ancient texts"],
        content="The Ancient Library of Eldoria is a vast repository of knowledge, containing texts dating back thousands of years. It is protected by magical wards.",
        priority=10,
        scan_depth=10,
        is_case_sensitive=False,
        is_enabled=True,
    )


class TestFormatLorebookContext:
    """Tests for _format_lorebook_context method."""

    def test_format_empty_lorebook_context(self, context_builder):
        """Empty lorebook matches returns empty string."""
        result = context_builder._format_lorebook_context([])
        assert result == ""

    def test_format_none_lorebook_context(self, context_builder):
        """None lorebook matches returns empty string."""
        result = context_builder._format_lorebook_context(None)
        assert result == ""

    def test_format_single_entry(self, context_builder, sample_lorebook_entry):
        """Single entry is formatted correctly."""
        match = LorebookMatch(
            entry=sample_lorebook_entry,
            matched_keyword="library",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "<lorebook_context>" in result
        assert "</lorebook_context>" in result
        assert "**The Ancient Library**" in result
        assert "Ancient Library of Eldoria" in result
        assert "magical wards" in result

    def test_format_multiple_entries(self, context_builder):
        """Multiple entries are all included."""
        entries = [
            LorebookEntry(
                id=uuid4(),
                companion_id=uuid4(),
                name="Dragon Lore",
                trigger_keywords=["dragon"],
                content="Dragons are ancient creatures of immense power.",
                priority=10,
            ),
            LorebookEntry(
                id=uuid4(),
                companion_id=uuid4(),
                name="Magic System",
                trigger_keywords=["magic"],
                content="Magic flows through ley lines beneath the earth.",
                priority=5,
            ),
        ]

        matches = [
            LorebookMatch(entry=entries[0], matched_keyword="dragon", matched_in_message_index=0),
            LorebookMatch(entry=entries[1], matched_keyword="magic", matched_in_message_index=1),
        ]

        result = context_builder._format_lorebook_context(matches)

        assert "**Dragon Lore**" in result
        assert "**Magic System**" in result
        assert "ancient creatures" in result
        assert "ley lines" in result

    def test_format_includes_guidance(self, context_builder, sample_lorebook_entry):
        """Lorebook context includes usage guidance."""
        match = LorebookMatch(
            entry=sample_lorebook_entry,
            matched_keyword="library",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "Use this world information naturally" in result
        assert "Do not explicitly reference" in result

    def test_format_preserves_entry_order(self, context_builder):
        """Entries appear in the order provided."""
        entries = [
            LorebookEntry(
                id=uuid4(),
                companion_id=uuid4(),
                name="First Entry",
                trigger_keywords=["first"],
                content="First content.",
                priority=1,
            ),
            LorebookEntry(
                id=uuid4(),
                companion_id=uuid4(),
                name="Second Entry",
                trigger_keywords=["second"],
                content="Second content.",
                priority=10,
            ),
        ]

        matches = [
            LorebookMatch(entry=entries[0], matched_keyword="first", matched_in_message_index=0),
            LorebookMatch(entry=entries[1], matched_keyword="second", matched_in_message_index=0),
        ]

        result = context_builder._format_lorebook_context(matches)

        # First entry should come before second
        first_pos = result.find("**First Entry**")
        second_pos = result.find("**Second Entry**")
        assert first_pos < second_pos


class TestBuildSystemPromptWithLorebookContext:
    """Tests for build_system_prompt with lorebook context."""

    def test_system_prompt_includes_lorebook_context(
        self, context_builder, companion_spec, sample_lorebook_entry
    ):
        """System prompt includes formatted lorebook context."""
        match = LorebookMatch(
            entry=sample_lorebook_entry,
            matched_keyword="library",
            matched_in_message_index=0,
        )

        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            lorebook_matches=[match],
        )

        assert "<lorebook_context>" in result
        assert "**The Ancient Library**" in result
        assert "Ancient Library of Eldoria" in result

    def test_system_prompt_without_lorebook_context(
        self, context_builder, companion_spec
    ):
        """System prompt without lorebook context doesn't include lorebook section."""
        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            lorebook_matches=None,
        )

        assert "<lorebook_context>" not in result

    def test_lorebook_context_after_kg_context(
        self, context_builder, companion_spec, sample_lorebook_entry
    ):
        """Lorebook context appears after KG context when both present."""
        from orchestrator.services.hybrid_search import KGContextItem

        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="TestEntity",
                entity_type="thing",
                relationship_to_query="mentioned",
            )
        ]

        lorebook_match = LorebookMatch(
            entry=sample_lorebook_entry,
            matched_keyword="library",
            matched_in_message_index=0,
        )

        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            kg_context=kg_context,
            lorebook_matches=[lorebook_match],
        )

        # KG context should appear before lorebook context
        kg_pos = result.find("</knowledge_graph_context>")
        lorebook_pos = result.find("<lorebook_context>")

        assert kg_pos < lorebook_pos


class TestBuildMessagesWithLorebookContext:
    """Tests for build_messages with lorebook context."""

    def test_build_messages_includes_lorebook_context(
        self, context_builder, companion_spec, sample_lorebook_entry
    ):
        """build_messages passes lorebook_matches to system prompt."""
        from orchestrator.models.conversation import ConversationContext

        context = ConversationContext(
            session_id=uuid4(),
            user_id=uuid4(),
            companion_spec=companion_spec,
            recent_turns=[],
            long_term_memories=[],
            safety_constraints=[],
            active_tools=[],
            situational_tenets=[],
            prompt_version="1.0.0",
            policy_version="1.0.0",
        )

        lorebook_match = LorebookMatch(
            entry=sample_lorebook_entry,
            matched_keyword="library",
            matched_in_message_index=0,
        )

        messages = context_builder.build_messages(
            context=context,
            current_user_message="Tell me about the library",
            lorebook_matches=[lorebook_match],
        )

        # System message should include lorebook context
        system_msg = messages[0]["content"]
        assert "<lorebook_context>" in system_msg
        assert "**The Ancient Library**" in system_msg

    def test_build_messages_without_lorebook_context(
        self, context_builder, companion_spec
    ):
        """build_messages works without lorebook_matches."""
        from orchestrator.models.conversation import ConversationContext

        context = ConversationContext(
            session_id=uuid4(),
            user_id=uuid4(),
            companion_spec=companion_spec,
            recent_turns=[],
            long_term_memories=[],
            safety_constraints=[],
            active_tools=[],
            situational_tenets=[],
            prompt_version="1.0.0",
            policy_version="1.0.0",
        )

        messages = context_builder.build_messages(
            context=context,
            current_user_message="Hello!",
        )

        # System message should not include lorebook context
        system_msg = messages[0]["content"]
        assert "<lorebook_context>" not in system_msg


class TestLorebookEdgeCases:
    """Edge case tests for lorebook context handling."""

    def test_entry_with_special_characters_in_name(self, context_builder):
        """Entry names with special characters are handled."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="O'Brien's Tavern & Grill",
            trigger_keywords=["tavern"],
            content="A cozy tavern with great food.",
            priority=10,
        )

        match = LorebookMatch(
            entry=entry,
            matched_keyword="tavern",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "**O'Brien's Tavern & Grill**" in result

    def test_entry_with_multiline_content(self, context_builder):
        """Entries with multiline content are preserved."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Character Biography",
            trigger_keywords=["hero"],
            content="Line 1: The hero was born in a small village.\nLine 2: They trained for years.\nLine 3: Now they protect the realm.",
            priority=10,
        )

        match = LorebookMatch(
            entry=entry,
            matched_keyword="hero",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "Line 1:" in result
        assert "Line 2:" in result
        assert "Line 3:" in result

    def test_entry_with_unicode_content(self, context_builder):
        """Entries with unicode content are handled."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Japanese Temple",
            trigger_keywords=["temple"],
            content="The temple (寺院) is located on Mount Fuji (富士山).",
            priority=10,
        )

        match = LorebookMatch(
            entry=entry,
            matched_keyword="temple",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "寺院" in result
        assert "富士山" in result

    def test_entry_with_markdown_in_content(self, context_builder):
        """Entries with markdown in content are preserved."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Combat Rules",
            trigger_keywords=["combat"],
            content="Combat rules:\n- Roll d20 for initiative\n- **Critical hits** deal double damage\n- *Advantage* lets you roll twice",
            priority=10,
        )

        match = LorebookMatch(
            entry=entry,
            matched_keyword="combat",
            matched_in_message_index=0,
        )

        result = context_builder._format_lorebook_context([match])

        assert "**Critical hits**" in result
        assert "*Advantage*" in result
        assert "- Roll d20" in result
