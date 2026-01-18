"""Tests for ContextBuilder Hierarchical Memory integration.

These tests verify the integration of hierarchical memory retrieval results
into the conversation context builder.
"""

import pytest
from uuid import uuid4

from orchestrator.models.conversation import CompanionSpec
from orchestrator.prompts.manager import PromptManager
from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.hierarchical_memory import (
    HierarchicalRetrievalResult,
    MemoryCluster,
)


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
def sample_retrieval_result():
    """Create a sample hierarchical retrieval result."""
    return HierarchicalRetrievalResult(
        l1_memories=[
            {"id": "1", "content": "User loves hiking in mountains"},
            {"id": "2", "content": "User went to Colorado last summer"},
        ],
        l2_clusters=[
            MemoryCluster(
                id=uuid4(),
                companion_id=uuid4(),
                user_id=uuid4(),
                name="Travel Memories",
                summary="User enjoys outdoor activities and travel, with particular interest in mountain destinations.",
                member_memory_ids=["1", "2", "3", "4"],
                centroid_embedding=[0.1] * 1536,
            )
        ],
        total_memories=4,
    )


class TestFormatHierarchicalMemory:
    """Tests for _format_hierarchical_memory method."""

    def test_format_empty_result(self, context_builder):
        """Empty result returns empty string."""
        result = HierarchicalRetrievalResult(
            l1_memories=[],
            l2_clusters=[],
            total_memories=0,
        )
        formatted = context_builder._format_hierarchical_memory(result)
        assert formatted == ""

    def test_format_none_result(self, context_builder):
        """None result returns empty string."""
        formatted = context_builder._format_hierarchical_memory(None)
        assert formatted == ""

    def test_format_l1_only(self, context_builder):
        """L1 memories are formatted correctly."""
        result = HierarchicalRetrievalResult(
            l1_memories=[
                {"id": "1", "content": "User has a cat named Max"},
                {"id": "2", "content": "User works as an engineer"},
            ],
            l2_clusters=[],
            total_memories=2,
        )

        formatted = context_builder._format_hierarchical_memory(result)

        assert "<hierarchical_memories>" in formatted
        assert "</hierarchical_memories>" in formatted
        assert "User has a cat named Max" in formatted
        assert "User works as an engineer" in formatted

    def test_format_l2_only(self, context_builder):
        """L2 clusters are formatted correctly."""
        result = HierarchicalRetrievalResult(
            l1_memories=[],
            l2_clusters=[
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="Work Memories",
                    summary="User is a software engineer who enjoys problem solving.",
                    member_memory_ids=["1", "2"],
                    centroid_embedding=[0.1] * 1536,
                )
            ],
            total_memories=2,
        )

        formatted = context_builder._format_hierarchical_memory(result)

        assert "Work Memories" in formatted
        assert "software engineer" in formatted

    def test_format_both_levels(self, context_builder, sample_retrieval_result):
        """Both L1 and L2 are included."""
        formatted = context_builder._format_hierarchical_memory(sample_retrieval_result)

        # L1 content
        assert "hiking in mountains" in formatted
        assert "Colorado" in formatted

        # L2 content
        assert "Travel Memories" in formatted
        assert "outdoor activities" in formatted

    def test_format_multiple_clusters(self, context_builder):
        """Multiple clusters are all included."""
        result = HierarchicalRetrievalResult(
            l1_memories=[{"id": "1", "content": "User likes coffee"}],
            l2_clusters=[
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="Food Preferences",
                    summary="User enjoys coffee and Italian cuisine.",
                    member_memory_ids=["1", "2"],
                    centroid_embedding=[0.1] * 1536,
                ),
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="Work Life",
                    summary="User works in tech and has meetings on Mondays.",
                    member_memory_ids=["3", "4"],
                    centroid_embedding=[0.2] * 1536,
                ),
            ],
            total_memories=4,
        )

        formatted = context_builder._format_hierarchical_memory(result)

        assert "Food Preferences" in formatted
        assert "Work Life" in formatted


class TestBuildSystemPromptWithHierarchicalMemory:
    """Tests for build_system_prompt with hierarchical memory."""

    def test_system_prompt_includes_hierarchical_memory(
        self, context_builder, companion_spec, sample_retrieval_result
    ):
        """System prompt includes hierarchical memory context."""
        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            hierarchical_memory=sample_retrieval_result,
        )

        assert "<hierarchical_memories>" in result
        assert "hiking in mountains" in result
        assert "Travel Memories" in result

    def test_system_prompt_without_hierarchical_memory(
        self, context_builder, companion_spec
    ):
        """System prompt without hierarchical memory doesn't include section."""
        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            hierarchical_memory=None,
        )

        assert "<hierarchical_memories>" not in result

    def test_hierarchical_memory_after_long_term_memories(
        self, context_builder, companion_spec, sample_retrieval_result
    ):
        """Hierarchical memory appears after standard long-term memories."""
        from orchestrator.models.memory import LongTermMemory, MemoryType

        long_term = [
            LongTermMemory(
                id=uuid4(),
                user_id=uuid4(),
                companion_id=companion_spec.id,
                memory_type=MemoryType.FACT,
                content="User lives in Denver",
            )
        ]

        result = context_builder.build_system_prompt(
            companion_spec=companion_spec,
            long_term_memories=long_term,
            hierarchical_memory=sample_retrieval_result,
        )

        # Long-term memories should appear before hierarchical
        ltm_pos = result.find("</long_term_memories>")
        hier_pos = result.find("<hierarchical_memories>")

        # If both are present, hierarchical should come after
        if ltm_pos >= 0 and hier_pos >= 0:
            assert ltm_pos < hier_pos


class TestBuildMessagesWithHierarchicalMemory:
    """Tests for build_messages with hierarchical memory."""

    def test_build_messages_includes_hierarchical_memory(
        self, context_builder, companion_spec, sample_retrieval_result
    ):
        """build_messages passes hierarchical_memory to system prompt."""
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
            current_user_message="Tell me about travel",
            hierarchical_memory=sample_retrieval_result,
        )

        # System message should include hierarchical memory
        system_msg = messages[0]["content"]
        assert "<hierarchical_memories>" in system_msg

    def test_build_messages_without_hierarchical_memory(
        self, context_builder, companion_spec
    ):
        """build_messages works without hierarchical_memory."""
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

        # System message should not include hierarchical memory
        system_msg = messages[0]["content"]
        assert "<hierarchical_memories>" not in system_msg


class TestHierarchicalMemoryEdgeCases:
    """Edge case tests for hierarchical memory handling."""

    def test_cluster_with_long_summary(self, context_builder):
        """Handles clusters with long summaries."""
        result = HierarchicalRetrievalResult(
            l1_memories=[],
            l2_clusters=[
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="Detailed Cluster",
                    summary="A " * 500,  # Very long summary
                    member_memory_ids=["1"],
                    centroid_embedding=[0.1] * 1536,
                )
            ],
            total_memories=1,
        )

        formatted = context_builder._format_hierarchical_memory(result)
        assert "Detailed Cluster" in formatted

    def test_memory_with_special_characters(self, context_builder):
        """Handles memories with special characters."""
        result = HierarchicalRetrievalResult(
            l1_memories=[
                {"id": "1", "content": "User said \"Hello!\" & asked <questions>"},
            ],
            l2_clusters=[],
            total_memories=1,
        )

        formatted = context_builder._format_hierarchical_memory(result)
        assert "Hello!" in formatted
        assert "<questions>" in formatted

    def test_cluster_with_unicode_name(self, context_builder):
        """Handles clusters with unicode in names."""
        result = HierarchicalRetrievalResult(
            l1_memories=[],
            l2_clusters=[
                MemoryCluster(
                    id=uuid4(),
                    companion_id=uuid4(),
                    user_id=uuid4(),
                    name="日本語 Memories",
                    summary="User is learning Japanese.",
                    member_memory_ids=["1"],
                    centroid_embedding=[0.1] * 1536,
                )
            ],
            total_memories=1,
        )

        formatted = context_builder._format_hierarchical_memory(result)
        assert "日本語" in formatted
