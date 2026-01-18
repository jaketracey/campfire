"""Tests for ContextBuilder KG context formatting.

These tests verify the integration of Knowledge Graph context into the
conversation context builder, ensuring KG entities and relationships are
properly formatted and included in the system prompt.
"""

import pytest
from uuid import uuid4

from orchestrator.models.conversation import CompanionSpec
from orchestrator.prompts.manager import PromptManager
from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.hybrid_search import KGContextItem


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


class TestFormatKGContext:
    """Tests for _format_kg_context method."""

    def test_format_empty_kg_context(self, context_builder):
        """Empty KG context returns empty string."""
        result = context_builder._format_kg_context([])
        assert result == ""

    def test_format_none_kg_context(self, context_builder):
        """None KG context returns empty string."""
        result = context_builder._format_kg_context(None)
        assert result == ""

    def test_format_single_entity(self, context_builder):
        """Single entity is formatted correctly."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="John",
                entity_type="person",
                relationship_to_query="mentioned",
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "<knowledge_graph_context>" in result
        assert "</knowledge_graph_context>" in result
        assert "**John** (person)" in result
        # Entity line should not have the star marker (only in guidance text)
        assert "**John** (person) ⭐" not in result

    def test_format_entity_connected_to_user(self, context_builder):
        """Entity connected to user shows star marker."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Sarah",
                entity_type="person",
                relationship_to_query="mentioned",
                connected_to_user=True,
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "⭐ (related to user)" in result
        assert "**Sarah** (person)" in result

    def test_format_entity_with_connections(self, context_builder):
        """Entity with connections shows connected entities."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Colorado",
                entity_type="location",
                relationship_to_query="mentioned",
                connected_entities=["Rocky Mountains", "Denver", "Hiking"],
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "Connected to:" in result
        assert "Rocky Mountains" in result
        assert "Denver" in result
        assert "Hiking" in result

    def test_format_limits_connected_entities(self, context_builder):
        """Connected entities are limited to 5."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="User",
                entity_type="person",
                relationship_to_query="central",
                connected_entities=["A", "B", "C", "D", "E", "F", "G"],
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "A, B, C, D, E" in result
        assert "(+2 more)" in result
        assert "F" not in result
        assert "G" not in result

    def test_format_multiple_entities(self, context_builder):
        """Multiple entities are all included."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Colorado",
                entity_type="location",
                relationship_to_query="mentioned",
            ),
            KGContextItem(
                entity_id="entity-2",
                entity_name="Hiking",
                entity_type="activity",
                relationship_to_query="mentioned",
            ),
            KGContextItem(
                entity_id="entity-3",
                entity_name="John",
                entity_type="person",
                relationship_to_query="mentioned",
                connected_to_user=True,
            ),
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "**Colorado** (location)" in result
        assert "**Hiking** (activity)" in result
        assert "**John** (person)" in result
        # Only John should have the star on the entity line
        assert "**John** (person) ⭐" in result
        assert "**Colorado** (location) ⭐" not in result
        assert "**Hiking** (activity) ⭐" not in result

    def test_format_includes_guidance(self, context_builder):
        """KG context includes usage guidance."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Test",
                entity_type="thing",
                relationship_to_query="mentioned",
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "richer, more informed responses" in result
        assert "especially relevant to the user" in result


class TestBuildSystemPromptWithKGContext:
    """Tests for build_system_prompt with KG context."""

    def test_system_prompt_includes_kg_context(self, context_builder, companion_spec):
        """System prompt includes formatted KG context."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Sarah",
                entity_type="person",
                relationship_to_query="mentioned",
                connected_to_user=True,
            )
        ]

        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            kg_context=kg_context,
        )

        assert "<knowledge_graph_context>" in result
        assert "**Sarah** (person)" in result
        assert "⭐ (related to user)" in result

    def test_system_prompt_without_kg_context(self, context_builder, companion_spec):
        """System prompt without KG context doesn't include KG section."""
        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            kg_context=None,
        )

        assert "<knowledge_graph_context>" not in result

    def test_kg_context_after_memories(self, context_builder, companion_spec):
        """KG context appears after memories section."""
        from orchestrator.models.memory import LongTermMemory, MemoryType

        memories = [
            LongTermMemory(
                id=uuid4(),
                user_id=uuid4(),
                companion_id=companion_spec.id,
                memory_type=MemoryType.FACT,
                content="User lives in Colorado",
            )
        ]

        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Colorado",
                entity_type="location",
                relationship_to_query="mentioned",
            )
        ]

        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            long_term_memories=memories,
            kg_context=kg_context,
        )

        # KG context should appear after memories
        memory_pos = result.find("</long_term_memories>")
        kg_pos = result.find("<knowledge_graph_context>")

        assert memory_pos < kg_pos


class TestBuildMessagesWithKGContext:
    """Tests for build_messages with KG context."""

    def test_build_messages_includes_kg_context(self, context_builder, companion_spec):
        """build_messages passes kg_context to system prompt."""
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

        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="TestEntity",
                entity_type="thing",
                relationship_to_query="mentioned",
            )
        ]

        messages = context_builder.build_messages(
            context=context,
            current_user_message="Hello!",
            kg_context=kg_context,
        )

        # System message should include KG context
        system_msg = messages[0]["content"]
        assert "<knowledge_graph_context>" in system_msg
        assert "**TestEntity** (thing)" in system_msg

    def test_build_messages_without_kg_context(self, context_builder, companion_spec):
        """build_messages works without kg_context."""
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

        # System message should not include KG context
        system_msg = messages[0]["content"]
        assert "<knowledge_graph_context>" not in system_msg


class TestKGContextEdgeCases:
    """Edge case tests for KG context handling."""

    def test_entity_with_empty_connected_entities(self, context_builder):
        """Entity with empty connections list doesn't show Connected to."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="Isolated",
                entity_type="thing",
                relationship_to_query="mentioned",
                connected_entities=[],
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "Connected to:" not in result

    def test_entity_with_special_characters(self, context_builder):
        """Entities with special characters are handled."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="O'Brien's Pub",
                entity_type="location",
                relationship_to_query="mentioned",
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "O'Brien's Pub" in result

    def test_entity_with_long_name(self, context_builder):
        """Entities with long names are included."""
        kg_context = [
            KGContextItem(
                entity_id="entity-1",
                entity_name="The Very Long Name Of An Entity That Goes On And On",
                entity_type="thing",
                relationship_to_query="mentioned",
            )
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "The Very Long Name Of An Entity That Goes On And On" in result

    def test_entity_types_are_preserved(self, context_builder):
        """Various entity types are preserved in output."""
        kg_context = [
            KGContextItem(entity_id="1", entity_name="A", entity_type="person", relationship_to_query="m"),
            KGContextItem(entity_id="2", entity_name="B", entity_type="location", relationship_to_query="m"),
            KGContextItem(entity_id="3", entity_name="C", entity_type="organization", relationship_to_query="m"),
            KGContextItem(entity_id="4", entity_name="D", entity_type="activity", relationship_to_query="m"),
            KGContextItem(entity_id="5", entity_name="E", entity_type="preference", relationship_to_query="m"),
        ]

        result = context_builder._format_kg_context(kg_context)

        assert "(person)" in result
        assert "(location)" in result
        assert "(organization)" in result
        assert "(activity)" in result
        assert "(preference)" in result
