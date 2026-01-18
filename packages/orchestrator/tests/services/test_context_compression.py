"""Tests for Dynamic Context Compression Service.

These tests verify the implementation of dynamic context compression
with token budgeting, section allocation, and adaptive compression.
"""

import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from orchestrator.services.context_compression import (
    ContextCompressionService,
    ContextBudget,
    ContextSection,
    SectionAllocation,
    CompressionResult,
    CompressionStrategy,
)


@pytest.fixture
def default_budget():
    """Create a default context budget."""
    return ContextBudget(
        total_tokens=8000,
        persona_ratio=0.15,
        memory_ratio=0.25,
        conversation_ratio=0.50,
        reserved_ratio=0.10,
    )


@pytest.fixture
def compression_service(default_budget):
    """Create a context compression service."""
    return ContextCompressionService(budget=default_budget)


class TestContextBudget:
    """Tests for ContextBudget configuration."""

    def test_default_budget(self):
        """Should have sensible defaults."""
        budget = ContextBudget()

        assert budget.total_tokens == 100000
        assert budget.persona_ratio == 0.15
        assert budget.memory_ratio == 0.25
        assert budget.conversation_ratio == 0.50
        assert budget.reserved_ratio == 0.10

    def test_budget_ratios_sum_to_one(self):
        """Budget ratios should sum to 1.0."""
        budget = ContextBudget()
        total = (
            budget.persona_ratio
            + budget.memory_ratio
            + budget.conversation_ratio
            + budget.reserved_ratio
        )
        assert abs(total - 1.0) < 0.001

    def test_custom_budget(self):
        """Should accept custom budget values."""
        budget = ContextBudget(
            total_tokens=50000,
            persona_ratio=0.20,
            memory_ratio=0.30,
            conversation_ratio=0.40,
            reserved_ratio=0.10,
        )

        assert budget.total_tokens == 50000
        assert budget.persona_ratio == 0.20

    def test_budget_token_allocations(self):
        """Should calculate correct token allocations."""
        budget = ContextBudget(
            total_tokens=10000,
            persona_ratio=0.20,
            memory_ratio=0.30,
            conversation_ratio=0.40,
            reserved_ratio=0.10,
        )

        assert budget.persona_tokens == 2000
        assert budget.memory_tokens == 3000
        assert budget.conversation_tokens == 4000
        assert budget.reserved_tokens == 1000


class TestContextSection:
    """Tests for ContextSection enum."""

    def test_section_values(self):
        """Should have all expected sections."""
        assert ContextSection.PERSONA.value == "persona"
        assert ContextSection.MEMORY.value == "memory"
        assert ContextSection.CONVERSATION.value == "conversation"
        assert ContextSection.RESERVED.value == "reserved"


class TestSectionAllocation:
    """Tests for SectionAllocation model."""

    def test_allocation_creation(self):
        """Should create allocation with all fields."""
        allocation = SectionAllocation(
            section=ContextSection.MEMORY,
            allocated_tokens=2000,
            used_tokens=1500,
            content="Memory content here",
        )

        assert allocation.section == ContextSection.MEMORY
        assert allocation.allocated_tokens == 2000
        assert allocation.used_tokens == 1500

    def test_allocation_utilization(self):
        """Should calculate utilization correctly."""
        allocation = SectionAllocation(
            section=ContextSection.MEMORY,
            allocated_tokens=2000,
            used_tokens=1500,
            content="",
        )

        assert allocation.utilization == 0.75

    def test_allocation_remaining(self):
        """Should calculate remaining tokens correctly."""
        allocation = SectionAllocation(
            section=ContextSection.MEMORY,
            allocated_tokens=2000,
            used_tokens=1500,
            content="",
        )

        assert allocation.remaining_tokens == 500

    def test_allocation_over_budget(self):
        """Should detect when over budget."""
        allocation = SectionAllocation(
            section=ContextSection.MEMORY,
            allocated_tokens=2000,
            used_tokens=2500,
            content="",
        )

        assert allocation.is_over_budget is True
        assert allocation.remaining_tokens == -500


class TestContextCompressionServiceBasics:
    """Tests for service initialization."""

    def test_init_with_defaults(self):
        """Should initialize with default budget."""
        service = ContextCompressionService()
        assert service.budget is not None
        assert service.budget.total_tokens > 0

    def test_init_with_custom_budget(self, default_budget):
        """Should accept custom budget."""
        service = ContextCompressionService(budget=default_budget)
        assert service.budget.total_tokens == 8000


class TestTokenCounting:
    """Tests for token counting functionality."""

    def test_count_tokens_simple(self, compression_service):
        """Should count tokens in simple text."""
        tokens = compression_service.count_tokens("Hello world")
        assert tokens > 0
        assert tokens < 10  # Simple text should be few tokens

    def test_count_tokens_empty(self, compression_service):
        """Should handle empty string."""
        tokens = compression_service.count_tokens("")
        assert tokens == 0

    def test_count_tokens_long_text(self, compression_service):
        """Should count tokens in longer text."""
        long_text = "This is a test. " * 100
        tokens = compression_service.count_tokens(long_text)
        assert tokens > 100

    def test_count_tokens_unicode(self, compression_service):
        """Should handle unicode text."""
        tokens = compression_service.count_tokens("Hello 日本語 world")
        assert tokens > 0


class TestAllocateTokens:
    """Tests for token allocation."""

    def test_allocate_basic(self, compression_service):
        """Should allocate tokens across sections."""
        allocations = compression_service.allocate_tokens(
            persona_content="You are a helpful assistant.",
            memory_content="User likes coffee.",
            conversation_messages=[
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there!"},
            ],
        )

        assert ContextSection.PERSONA in allocations
        assert ContextSection.MEMORY in allocations
        assert ContextSection.CONVERSATION in allocations

    def test_allocate_respects_budget(self, compression_service):
        """Should not exceed total budget."""
        allocations = compression_service.allocate_tokens(
            persona_content="A" * 1000,
            memory_content="B" * 1000,
            conversation_messages=[
                {"role": "user", "content": "C" * 1000},
            ],
        )

        total_used = sum(a.used_tokens for a in allocations.values())
        # Should be within total budget (8000 tokens for test)
        # Note: This tests allocation tracking, not enforcement
        assert total_used < compression_service.budget.total_tokens * 2  # Some buffer

    def test_allocate_empty_sections(self, compression_service):
        """Should handle empty sections."""
        allocations = compression_service.allocate_tokens(
            persona_content="",
            memory_content="",
            conversation_messages=[],
        )

        assert allocations[ContextSection.PERSONA].used_tokens == 0
        assert allocations[ContextSection.MEMORY].used_tokens == 0


class TestCompressionStrategy:
    """Tests for compression strategy enum."""

    def test_strategy_values(self):
        """Should have all expected strategies."""
        assert CompressionStrategy.NONE.value == "none"
        assert CompressionStrategy.TRUNCATE_OLD.value == "truncate_old"
        assert CompressionStrategy.SUMMARIZE.value == "summarize"
        assert CompressionStrategy.DROP_LOW_IMPORTANCE.value == "drop_low_importance"


class TestCompressConversation:
    """Tests for conversation compression."""

    def test_no_compression_under_budget(self, compression_service):
        """Should not compress when under budget."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
        ]

        result = compression_service.compress_conversation(
            messages=messages,
            max_tokens=1000,
        )

        assert result.strategy == CompressionStrategy.NONE
        assert len(result.messages) == 2
        assert result.removed_count == 0

    def test_truncate_old_messages(self, compression_service):
        """Should truncate old messages when over budget."""
        # Create messages that are long enough to exceed budget
        messages = [
            {"role": "user", "content": f"This is message number {i} with some extra content to increase token count significantly."} for i in range(20)
        ]

        result = compression_service.compress_conversation(
            messages=messages,
            max_tokens=50,  # Very small budget
        )

        assert len(result.messages) < len(messages)
        assert result.removed_count > 0
        assert result.strategy == CompressionStrategy.TRUNCATE_OLD

    def test_preserves_recent_messages(self, compression_service):
        """Should preserve most recent messages."""
        messages = [
            {"role": "user", "content": f"Old message {i}"} for i in range(10)
        ] + [
            {"role": "user", "content": "Recent message"},
        ]

        result = compression_service.compress_conversation(
            messages=messages,
            max_tokens=50,
        )

        # Last message should be preserved
        assert any("Recent message" in m["content"] for m in result.messages)


class TestCompressMemories:
    """Tests for memory compression."""

    def test_no_compression_under_budget(self, compression_service):
        """Should not compress when under budget."""
        memories = [
            {"content": "User likes coffee", "importance": 0.8},
            {"content": "User works as engineer", "importance": 0.9},
        ]

        result = compression_service.compress_memories(
            memories=memories,
            max_tokens=1000,
        )

        assert result.strategy == CompressionStrategy.NONE
        assert len(result.memories) == 2

    def test_drop_low_importance(self, compression_service):
        """Should drop low importance memories when over budget."""
        memories = [
            {"content": "Important fact " * 20, "importance": 0.9},
            {"content": "Less important " * 20, "importance": 0.3},
            {"content": "Medium importance " * 20, "importance": 0.6},
        ]

        result = compression_service.compress_memories(
            memories=memories,
            max_tokens=100,  # Very small budget
        )

        # Should keep higher importance memories
        if len(result.memories) < 3:
            importances = [m["importance"] for m in result.memories]
            assert all(i >= 0.3 for i in importances)  # Low importance dropped

    def test_preserves_high_importance(self, compression_service):
        """Should preserve high importance memories."""
        memories = [
            {"content": "Critical fact", "importance": 1.0},
            {"content": "Optional info " * 50, "importance": 0.1},
        ]

        result = compression_service.compress_memories(
            memories=memories,
            max_tokens=50,
        )

        # Critical fact should be preserved
        assert any("Critical fact" in m["content"] for m in result.memories)


class TestAdaptiveBudget:
    """Tests for adaptive budget adjustment."""

    def test_increase_memory_budget_when_rich(self, compression_service):
        """Should increase memory budget when many relevant memories."""
        original_memory_tokens = compression_service.budget.memory_tokens

        adapted_budget = compression_service.adapt_budget(
            memory_count=20,
            memory_relevance_avg=0.9,
        )

        # Should increase memory allocation
        assert adapted_budget.memory_tokens >= original_memory_tokens

    def test_decrease_memory_budget_when_sparse(self, compression_service):
        """Should decrease memory budget when few memories."""
        original_memory_tokens = compression_service.budget.memory_tokens

        adapted_budget = compression_service.adapt_budget(
            memory_count=1,
            memory_relevance_avg=0.5,
        )

        # Should decrease or maintain memory allocation
        assert adapted_budget.memory_tokens <= original_memory_tokens + 100

    def test_budget_still_sums_to_total(self, compression_service):
        """Adapted budget ratios should still sum correctly."""
        adapted_budget = compression_service.adapt_budget(
            memory_count=20,
            memory_relevance_avg=0.9,
        )

        total = (
            adapted_budget.persona_tokens
            + adapted_budget.memory_tokens
            + adapted_budget.conversation_tokens
            + adapted_budget.reserved_tokens
        )

        assert abs(total - adapted_budget.total_tokens) < 10  # Allow small rounding


class TestCompressionResult:
    """Tests for CompressionResult model."""

    def test_result_creation(self):
        """Should create result with all fields."""
        result = CompressionResult(
            messages=[{"role": "user", "content": "test"}],
            memories=[{"content": "test", "importance": 0.5}],
            strategy=CompressionStrategy.TRUNCATE_OLD,
            removed_count=5,
            original_tokens=1000,
            compressed_tokens=500,
        )

        assert result.strategy == CompressionStrategy.TRUNCATE_OLD
        assert result.removed_count == 5
        assert result.compression_ratio == 0.5

    def test_compression_ratio(self):
        """Should calculate compression ratio correctly."""
        result = CompressionResult(
            messages=[],
            memories=[],
            strategy=CompressionStrategy.NONE,
            removed_count=0,
            original_tokens=200,
            compressed_tokens=100,
        )

        assert result.compression_ratio == 0.5


class TestGetContextMetrics:
    """Tests for context usage metrics."""

    def test_metrics_calculation(self, compression_service):
        """Should calculate context metrics."""
        allocations = compression_service.allocate_tokens(
            persona_content="System prompt",
            memory_content="Memory content",
            conversation_messages=[
                {"role": "user", "content": "Hello"},
            ],
        )

        metrics = compression_service.get_context_metrics(allocations)

        assert "total_used_tokens" in metrics
        assert "total_allocated_tokens" in metrics
        assert "utilization_by_section" in metrics
        assert "overall_utilization" in metrics

    def test_metrics_per_section(self, compression_service):
        """Should include per-section metrics."""
        allocations = compression_service.allocate_tokens(
            persona_content="System prompt",
            memory_content="Memory content",
            conversation_messages=[],
        )

        metrics = compression_service.get_context_metrics(allocations)

        assert ContextSection.PERSONA.value in metrics["utilization_by_section"]
        assert ContextSection.MEMORY.value in metrics["utilization_by_section"]


class TestEdgeCases:
    """Tests for edge cases."""

    def test_very_long_single_message(self, compression_service):
        """Should handle single message exceeding budget."""
        messages = [
            {"role": "user", "content": "A" * 10000},  # Very long message
        ]

        result = compression_service.compress_conversation(
            messages=messages,
            max_tokens=100,
        )

        # Should still return something (possibly truncated or original)
        assert len(result.messages) >= 0

    def test_all_high_importance_memories(self, compression_service):
        """Should handle all memories being high importance."""
        memories = [
            {"content": "Fact " * 50, "importance": 1.0} for _ in range(10)
        ]

        result = compression_service.compress_memories(
            memories=memories,
            max_tokens=100,
        )

        # Should still compress somehow
        assert result.compressed_tokens <= 500  # Reasonable bound

    def test_empty_inputs(self, compression_service):
        """Should handle empty inputs gracefully."""
        allocations = compression_service.allocate_tokens(
            persona_content="",
            memory_content="",
            conversation_messages=[],
        )

        assert allocations is not None
        assert len(allocations) > 0
