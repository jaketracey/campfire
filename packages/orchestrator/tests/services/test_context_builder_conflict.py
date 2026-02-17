"""Tests for Memory Conflict Resolution Context Builder Integration.

These tests verify that historical/invalidated memories are properly
formatted and included in the system prompt.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.memory_conflict import MemoryWithValidity
from orchestrator.prompts.manager import PromptManager


@pytest.fixture
def mock_prompt_manager():
    """Create a mock prompt manager."""
    manager = MagicMock(spec=PromptManager)
    manager.get_prompt_effective.return_value = "You are a helpful AI companion."
    return manager


@pytest.fixture
def context_builder(mock_prompt_manager):
    """Create a context builder instance."""
    return ContextBuilder(prompt_manager=mock_prompt_manager)


@pytest.fixture
def sample_companion_spec():
    """Create a sample companion spec."""
    spec = MagicMock()
    spec.id = uuid4()
    spec.name = "TestCompanion"
    spec.personality_traits = ["friendly", "helpful"]
    spec.communication_style = "casual"
    spec.description = "A test companion"
    spec.system_prompt = "Be helpful"
    spec.safety_level = "safe"
    spec.allowed_tools = []
    spec.core_tenets = []
    return spec


@pytest.fixture
def historical_memories():
    """Create sample historical (invalidated) memories."""
    user_id = uuid4()
    companion_id = uuid4()

    return [
        # Memory invalidated 6 months ago
        MemoryWithValidity(
            id=uuid4(),
            user_id=user_id,
            companion_id=companion_id,
            content="User lived in Denver, Colorado.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=365),
            valid_from=datetime.utcnow() - timedelta(days=365),
            valid_until=datetime.utcnow() - timedelta(days=180),
            importance=0.8,
        ),
        # Memory invalidated recently (5 days ago)
        MemoryWithValidity(
            id=uuid4(),
            user_id=user_id,
            companion_id=companion_id,
            content="User had 2 cats.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=60),
            valid_from=datetime.utcnow() - timedelta(days=60),
            valid_until=datetime.utcnow() - timedelta(days=5),
            importance=0.7,
        ),
        # Memory invalidated over a year ago
        MemoryWithValidity(
            id=uuid4(),
            user_id=user_id,
            companion_id=companion_id,
            content="User worked at TechCorp.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=500),
            valid_from=datetime.utcnow() - timedelta(days=500),
            valid_until=datetime.utcnow() - timedelta(days=400),
            importance=0.9,
        ),
    ]


class TestContextBuilderHistoricalMemories:
    """Tests for historical memories integration."""

    def test_format_historical_memories_basic(
        self, context_builder, historical_memories
    ):
        """Should format historical memories with time phrases."""
        result = context_builder._format_historical_memories(historical_memories)

        assert "<historical_context>" in result
        assert "</historical_context>" in result
        assert "Previously known facts" in result
        assert "Denver" in result
        assert "2 cats" in result
        assert "TechCorp" in result

    def test_format_historical_memories_time_phrases(
        self, context_builder, historical_memories
    ):
        """Should include appropriate time phrases."""
        result = context_builder._format_historical_memories(historical_memories)

        # Check for various time phrases
        assert "month(s) ago" in result  # 6 months ago
        assert "day(s) ago" in result  # 5 days ago
        assert "year(s) ago" in result  # Over a year ago

    def test_format_historical_memories_empty(self, context_builder):
        """Should return empty string for no memories."""
        result = context_builder._format_historical_memories([])
        assert result == ""

    def test_format_historical_memories_only_valid(self, context_builder):
        """Should return empty if all memories are still valid."""
        valid_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User likes coffee.",
            memory_type="preference",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            valid_until=None,  # Still valid
            importance=0.6,
        )

        result = context_builder._format_historical_memories([valid_memory])
        assert result == ""

    def test_format_historical_memories_mixed(self, context_builder):
        """Should only include invalidated memories from mixed list."""
        valid_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User likes pizza.",
            memory_type="preference",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            valid_until=None,  # Still valid
            importance=0.6,
        )

        invalid_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User was vegetarian.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=100),
            valid_from=datetime.utcnow() - timedelta(days=100),
            valid_until=datetime.utcnow() - timedelta(days=50),
            importance=0.7,
        )

        result = context_builder._format_historical_memories([valid_memory, invalid_memory])

        assert "vegetarian" in result  # Invalid memory included
        assert "pizza" not in result  # Valid memory excluded

    def test_build_system_prompt_includes_historical(
        self, context_builder, sample_companion_spec, historical_memories
    ):
        """Should include historical memories in system prompt."""
        prompt = context_builder.build_system_prompt(
            companion_spec=sample_companion_spec,
            historical_memories=historical_memories,
        )

        assert "<historical_context>" in prompt
        assert "Denver" in prompt
        assert "2 cats" in prompt

    def test_build_system_prompt_without_historical(
        self, context_builder, sample_companion_spec
    ):
        """Should work without historical memories."""
        prompt = context_builder.build_system_prompt(
            companion_spec=sample_companion_spec,
            historical_memories=None,
        )

        # Should not contain historical context section
        assert "<historical_context>" not in prompt

    def test_historical_memories_formatting_structure(
        self, context_builder, historical_memories
    ):
        """Should have proper structure with instructions."""
        result = context_builder._format_historical_memories(historical_memories)

        # Check for instruction text
        assert "you used to" in result.lower()
        assert "Reference these naturally" in result

    def test_historical_memories_includes_memory_type(
        self, context_builder, historical_memories
    ):
        """Should include memory type in formatted output."""
        result = context_builder._format_historical_memories(historical_memories)

        assert "[fact]" in result

    def test_format_historical_memories_recently_invalidated(self, context_builder):
        """Should show 'recently' for very recent invalidations."""
        recent_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User was studying Python.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=10),
            valid_from=datetime.utcnow() - timedelta(days=10),
            valid_until=datetime.utcnow() - timedelta(hours=6),  # Same day
            importance=0.5,
        )

        result = context_builder._format_historical_memories([recent_memory])

        assert "recently" in result

    def test_historical_memories_ordering_preserved(
        self, context_builder, historical_memories
    ):
        """Should preserve memory order in formatted output."""
        result = context_builder._format_historical_memories(historical_memories)

        # Check that memories appear in the same order
        denver_pos = result.find("Denver")
        cats_pos = result.find("2 cats")
        techcorp_pos = result.find("TechCorp")

        assert denver_pos < cats_pos < techcorp_pos


class TestBuildMessagesWithHistoricalMemories:
    """Tests for build_messages with historical memories."""

    @pytest.fixture
    def real_companion_spec(self):
        """Create a real CompanionSpec instance."""
        from orchestrator.models.conversation import CompanionSpec

        return CompanionSpec(
            id=uuid4(),
            name="TestCompanion",
            personality_traits=["friendly", "helpful"],
            communication_style="casual",
            description="A test companion",
            system_prompt="Be helpful",
            safety_level="safe",
            allowed_tools=[],
            core_tenets=[],
            max_context_turns=20,
        )

    @pytest.fixture
    def sample_context(self, real_companion_spec):
        """Create a sample conversation context."""
        from orchestrator.models.conversation import ConversationContext

        return ConversationContext(
            session_id=uuid4(),
            user_id=uuid4(),
            companion_spec=real_companion_spec,
            recent_turns=[],
            session_summary=None,
            long_term_memories=[],
            safety_constraints=[],
            active_tools=[],
            situational_tenets=[],
            prompt_version="1.0.0",
            policy_version="1.0.0",
        )

    def test_build_messages_with_historical_memories(
        self, context_builder, sample_context, historical_memories
    ):
        """Should include historical memories in messages."""
        messages = context_builder.build_messages(
            context=sample_context,
            current_user_message="Where did I used to live?",
            historical_memories=historical_memories,
        )

        # System message should contain historical context
        system_msg = messages[0]
        assert system_msg["role"] == "system"
        assert "<historical_context>" in system_msg["content"]
        assert "Denver" in system_msg["content"]

    def test_build_messages_without_historical_memories(
        self, context_builder, sample_context
    ):
        """Should work without historical memories."""
        messages = context_builder.build_messages(
            context=sample_context,
            current_user_message="Hello!",
            historical_memories=None,
        )

        system_msg = messages[0]
        assert "<historical_context>" not in system_msg["content"]


class TestHistoricalMemoriesEdgeCases:
    """Tests for edge cases in historical memory handling."""

    def test_memory_with_no_valid_until_date(self, context_builder):
        """Should handle memory without valid_until (still valid)."""
        memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="Some fact",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            valid_until=None,
            importance=0.5,
        )

        result = context_builder._format_historical_memories([memory])

        # Should return empty - memory is still valid
        assert result == ""

    def test_memory_content_preserved_exactly(self, context_builder):
        """Should preserve memory content exactly."""
        content = "User's favorite color was blue (they mentioned it was 'ocean blue')."
        memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content=content,
            memory_type="preference",
            created_at=datetime.utcnow() - timedelta(days=60),
            valid_from=datetime.utcnow() - timedelta(days=60),
            valid_until=datetime.utcnow() - timedelta(days=30),
            importance=0.6,
        )

        result = context_builder._format_historical_memories([memory])

        assert content in result

    def test_multiple_memory_types(self, context_builder):
        """Should handle multiple memory types."""
        memories = [
            MemoryWithValidity(
                id=uuid4(),
                user_id=uuid4(),
                companion_id=uuid4(),
                content="Fact 1",
                memory_type="fact",
                created_at=datetime.utcnow() - timedelta(days=60),
                valid_from=datetime.utcnow() - timedelta(days=60),
                valid_until=datetime.utcnow() - timedelta(days=30),
                importance=0.5,
            ),
            MemoryWithValidity(
                id=uuid4(),
                user_id=uuid4(),
                companion_id=uuid4(),
                content="Preference 1",
                memory_type="preference",
                created_at=datetime.utcnow() - timedelta(days=60),
                valid_from=datetime.utcnow() - timedelta(days=60),
                valid_until=datetime.utcnow() - timedelta(days=30),
                importance=0.5,
            ),
        ]

        result = context_builder._format_historical_memories(memories)

        assert "[fact]" in result
        assert "[preference]" in result


class TestCompanionImagePromptCapability:
    """Tests for image-prompt capability checks."""

    def test_explicit_prompt_capability_flag_enables_image_instructions(
        self, context_builder, sample_companion_spec
    ):
        sample_companion_spec.can_generate_image_prompts = True
        sample_companion_spec.allowed_tools = []

        assert context_builder._companion_generates_images(sample_companion_spec) is True

    def test_legacy_tool_based_capability_still_works(
        self, context_builder, sample_companion_spec
    ):
        sample_companion_spec.can_generate_image_prompts = False
        sample_companion_spec.allowed_tools = ["image_gen"]

        assert context_builder._companion_generates_images(sample_companion_spec) is True

    def test_no_flag_and_no_image_tools_disables_image_instructions(
        self, context_builder, sample_companion_spec
    ):
        sample_companion_spec.can_generate_image_prompts = False
        sample_companion_spec.allowed_tools = []

        assert context_builder._companion_generates_images(sample_companion_spec) is False

    def test_image_tool_aliases_are_normalized(
        self, context_builder, sample_companion_spec
    ):
        sample_companion_spec.can_generate_image_prompts = False
        sample_companion_spec.allowed_tools = ["image_gen", "generate_image", "photo"]

        assert context_builder._normalize_tools(sample_companion_spec.allowed_tools) == ["image_generation"]
