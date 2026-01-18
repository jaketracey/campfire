"""Dynamic Context Compression Service.

This service manages token budgets across context sections and implements
compression strategies to fit within model context limits while preserving
the most important information.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import tiktoken
import structlog

logger = structlog.get_logger()


class ContextSection(str, Enum):
    """Sections of the context that can be allocated tokens."""

    PERSONA = "persona"
    """System prompt and persona information."""

    MEMORY = "memory"
    """Long-term and hierarchical memories."""

    CONVERSATION = "conversation"
    """Recent conversation history."""

    RESERVED = "reserved"
    """Reserved tokens for response and overhead."""


class CompressionStrategy(str, Enum):
    """Strategies for compressing context when over budget."""

    NONE = "none"
    """No compression needed."""

    TRUNCATE_OLD = "truncate_old"
    """Remove oldest messages/memories."""

    SUMMARIZE = "summarize"
    """Summarize older content."""

    DROP_LOW_IMPORTANCE = "drop_low_importance"
    """Drop low importance items first."""


@dataclass
class ContextBudget:
    """Configuration for context token budget allocation."""

    total_tokens: int = 100000
    """Total available tokens for the context."""

    persona_ratio: float = 0.15
    """Ratio of budget for persona/system prompt."""

    memory_ratio: float = 0.25
    """Ratio of budget for memories."""

    conversation_ratio: float = 0.50
    """Ratio of budget for conversation history."""

    reserved_ratio: float = 0.10
    """Ratio reserved for response and overhead."""

    @property
    def persona_tokens(self) -> int:
        """Get allocated tokens for persona section."""
        return int(self.total_tokens * self.persona_ratio)

    @property
    def memory_tokens(self) -> int:
        """Get allocated tokens for memory section."""
        return int(self.total_tokens * self.memory_ratio)

    @property
    def conversation_tokens(self) -> int:
        """Get allocated tokens for conversation section."""
        return int(self.total_tokens * self.conversation_ratio)

    @property
    def reserved_tokens(self) -> int:
        """Get reserved tokens."""
        return int(self.total_tokens * self.reserved_ratio)


@dataclass
class SectionAllocation:
    """Token allocation for a specific context section."""

    section: ContextSection
    """The context section."""

    allocated_tokens: int
    """Number of tokens allocated to this section."""

    used_tokens: int
    """Number of tokens actually used."""

    content: str
    """The actual content for this section."""

    @property
    def utilization(self) -> float:
        """Get utilization ratio (0.0 to 1.0+)."""
        if self.allocated_tokens == 0:
            return 0.0
        return self.used_tokens / self.allocated_tokens

    @property
    def remaining_tokens(self) -> int:
        """Get remaining tokens in budget."""
        return self.allocated_tokens - self.used_tokens

    @property
    def is_over_budget(self) -> bool:
        """Check if section is over budget."""
        return self.used_tokens > self.allocated_tokens


@dataclass
class CompressionResult:
    """Result of a compression operation."""

    messages: list[dict[str, Any]]
    """Compressed conversation messages."""

    memories: list[dict[str, Any]]
    """Compressed memories."""

    strategy: CompressionStrategy
    """Strategy used for compression."""

    removed_count: int
    """Number of items removed."""

    original_tokens: int
    """Original token count before compression."""

    compressed_tokens: int
    """Token count after compression."""

    @property
    def compression_ratio(self) -> float:
        """Get compression ratio (compressed/original)."""
        if self.original_tokens == 0:
            return 1.0
        return self.compressed_tokens / self.original_tokens


class ContextCompressionService:
    """Service for dynamic context compression and budget management.

    Manages token allocation across context sections and implements
    compression strategies when content exceeds available budget.
    """

    def __init__(self, budget: ContextBudget | None = None):
        """Initialize the compression service.

        Args:
            budget: Optional budget configuration.
        """
        self.budget = budget or ContextBudget()
        self._tokenizer = tiktoken.get_encoding("cl100k_base")

    def count_tokens(self, text: str) -> int:
        """Count tokens in a text string.

        Args:
            text: Text to count tokens in.

        Returns:
            Number of tokens.
        """
        if not text:
            return 0
        return len(self._tokenizer.encode(text))

    def allocate_tokens(
        self,
        persona_content: str,
        memory_content: str,
        conversation_messages: list[dict[str, Any]],
    ) -> dict[ContextSection, SectionAllocation]:
        """Allocate tokens across context sections.

        Args:
            persona_content: System prompt and persona text.
            memory_content: Memory context text.
            conversation_messages: List of conversation messages.

        Returns:
            Dictionary of section allocations.
        """
        # Count tokens for each section
        persona_tokens = self.count_tokens(persona_content)
        memory_tokens = self.count_tokens(memory_content)

        # Count conversation tokens
        conversation_tokens = 0
        for msg in conversation_messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                conversation_tokens += self.count_tokens(content)
            elif isinstance(content, list):
                # Handle multimodal messages
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        conversation_tokens += self.count_tokens(item.get("text", ""))

        allocations = {
            ContextSection.PERSONA: SectionAllocation(
                section=ContextSection.PERSONA,
                allocated_tokens=self.budget.persona_tokens,
                used_tokens=persona_tokens,
                content=persona_content,
            ),
            ContextSection.MEMORY: SectionAllocation(
                section=ContextSection.MEMORY,
                allocated_tokens=self.budget.memory_tokens,
                used_tokens=memory_tokens,
                content=memory_content,
            ),
            ContextSection.CONVERSATION: SectionAllocation(
                section=ContextSection.CONVERSATION,
                allocated_tokens=self.budget.conversation_tokens,
                used_tokens=conversation_tokens,
                content="",  # Messages stored separately
            ),
            ContextSection.RESERVED: SectionAllocation(
                section=ContextSection.RESERVED,
                allocated_tokens=self.budget.reserved_tokens,
                used_tokens=0,
                content="",
            ),
        }

        logger.debug(
            "tokens_allocated",
            persona_used=persona_tokens,
            persona_budget=self.budget.persona_tokens,
            memory_used=memory_tokens,
            memory_budget=self.budget.memory_tokens,
            conversation_used=conversation_tokens,
            conversation_budget=self.budget.conversation_tokens,
        )

        return allocations

    def compress_conversation(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int,
    ) -> CompressionResult:
        """Compress conversation messages to fit within budget.

        Args:
            messages: List of conversation messages.
            max_tokens: Maximum tokens allowed.

        Returns:
            CompressionResult with compressed messages.
        """
        if not messages:
            return CompressionResult(
                messages=[],
                memories=[],
                strategy=CompressionStrategy.NONE,
                removed_count=0,
                original_tokens=0,
                compressed_tokens=0,
            )

        # Calculate original tokens
        original_tokens = self._count_messages_tokens(messages)

        # Check if compression is needed
        if original_tokens <= max_tokens:
            return CompressionResult(
                messages=messages,
                memories=[],
                strategy=CompressionStrategy.NONE,
                removed_count=0,
                original_tokens=original_tokens,
                compressed_tokens=original_tokens,
            )

        # Truncate from the beginning (oldest messages)
        compressed_messages = []
        current_tokens = 0
        removed_count = 0

        # Process messages from newest to oldest
        for msg in reversed(messages):
            msg_tokens = self._count_message_tokens(msg)

            if current_tokens + msg_tokens <= max_tokens:
                compressed_messages.insert(0, msg)
                current_tokens += msg_tokens
            else:
                removed_count += 1

        compressed_tokens = self._count_messages_tokens(compressed_messages)

        logger.debug(
            "conversation_compressed",
            original_count=len(messages),
            compressed_count=len(compressed_messages),
            removed_count=removed_count,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
        )

        return CompressionResult(
            messages=compressed_messages,
            memories=[],
            strategy=CompressionStrategy.TRUNCATE_OLD,
            removed_count=removed_count,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
        )

    def compress_memories(
        self,
        memories: list[dict[str, Any]],
        max_tokens: int,
    ) -> CompressionResult:
        """Compress memories to fit within budget.

        Args:
            memories: List of memory objects with content and importance.
            max_tokens: Maximum tokens allowed.

        Returns:
            CompressionResult with compressed memories.
        """
        if not memories:
            return CompressionResult(
                messages=[],
                memories=[],
                strategy=CompressionStrategy.NONE,
                removed_count=0,
                original_tokens=0,
                compressed_tokens=0,
            )

        # Calculate original tokens
        original_tokens = sum(
            self.count_tokens(m.get("content", "")) for m in memories
        )

        # Check if compression is needed
        if original_tokens <= max_tokens:
            return CompressionResult(
                messages=[],
                memories=memories,
                strategy=CompressionStrategy.NONE,
                removed_count=0,
                original_tokens=original_tokens,
                compressed_tokens=original_tokens,
            )

        # Sort by importance (highest first)
        sorted_memories = sorted(
            memories,
            key=lambda m: m.get("importance", 0.5),
            reverse=True,
        )

        # Keep highest importance memories that fit
        compressed_memories = []
        current_tokens = 0
        removed_count = 0

        for memory in sorted_memories:
            mem_tokens = self.count_tokens(memory.get("content", ""))

            if current_tokens + mem_tokens <= max_tokens:
                compressed_memories.append(memory)
                current_tokens += mem_tokens
            else:
                removed_count += 1

        logger.debug(
            "memories_compressed",
            original_count=len(memories),
            compressed_count=len(compressed_memories),
            removed_count=removed_count,
            original_tokens=original_tokens,
            compressed_tokens=current_tokens,
        )

        return CompressionResult(
            messages=[],
            memories=compressed_memories,
            strategy=CompressionStrategy.DROP_LOW_IMPORTANCE,
            removed_count=removed_count,
            original_tokens=original_tokens,
            compressed_tokens=current_tokens,
        )

    def adapt_budget(
        self,
        memory_count: int,
        memory_relevance_avg: float,
    ) -> ContextBudget:
        """Adapt budget based on memory richness.

        When there are many highly relevant memories, increase memory
        allocation at the expense of conversation history.

        Args:
            memory_count: Number of retrieved memories.
            memory_relevance_avg: Average relevance score of memories.

        Returns:
            Adapted ContextBudget.
        """
        # Calculate memory richness score (0 to 1)
        # High when many relevant memories available
        count_factor = min(memory_count / 10, 1.0)  # Normalize to 10 memories
        richness = count_factor * memory_relevance_avg

        # Adjust ratios based on richness
        # Max adjustment is 10% shift between memory and conversation
        adjustment = richness * 0.10

        new_memory_ratio = min(
            self.budget.memory_ratio + adjustment,
            0.40,  # Cap at 40%
        )
        new_conversation_ratio = max(
            self.budget.conversation_ratio - adjustment,
            0.35,  # Floor at 35%
        )

        adapted = ContextBudget(
            total_tokens=self.budget.total_tokens,
            persona_ratio=self.budget.persona_ratio,
            memory_ratio=new_memory_ratio,
            conversation_ratio=new_conversation_ratio,
            reserved_ratio=self.budget.reserved_ratio,
        )

        logger.debug(
            "budget_adapted",
            memory_count=memory_count,
            memory_relevance=memory_relevance_avg,
            richness_score=richness,
            new_memory_ratio=new_memory_ratio,
            new_conversation_ratio=new_conversation_ratio,
        )

        return adapted

    def get_context_metrics(
        self,
        allocations: dict[ContextSection, SectionAllocation],
    ) -> dict[str, Any]:
        """Get metrics about context usage.

        Args:
            allocations: Current token allocations.

        Returns:
            Dictionary of context metrics.
        """
        total_used = sum(a.used_tokens for a in allocations.values())
        total_allocated = sum(a.allocated_tokens for a in allocations.values())

        utilization_by_section = {
            section.value: alloc.utilization
            for section, alloc in allocations.items()
        }

        return {
            "total_used_tokens": total_used,
            "total_allocated_tokens": total_allocated,
            "overall_utilization": total_used / total_allocated if total_allocated > 0 else 0,
            "utilization_by_section": utilization_by_section,
            "over_budget_sections": [
                section.value
                for section, alloc in allocations.items()
                if alloc.is_over_budget
            ],
        }

    def _count_message_tokens(self, message: dict[str, Any]) -> int:
        """Count tokens in a single message."""
        content = message.get("content", "")
        if isinstance(content, str):
            return self.count_tokens(content)
        elif isinstance(content, list):
            # Multimodal message
            total = 0
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    total += self.count_tokens(item.get("text", ""))
            return total
        return 0

    def _count_messages_tokens(self, messages: list[dict[str, Any]]) -> int:
        """Count total tokens in a list of messages."""
        return sum(self._count_message_tokens(m) for m in messages)


# Singleton instance
_context_compression_service: ContextCompressionService | None = None


def get_context_compression_service(
    budget: ContextBudget | None = None,
) -> ContextCompressionService:
    """Get the singleton context compression service.

    Args:
        budget: Optional budget configuration.

    Returns:
        The ContextCompressionService instance.
    """
    global _context_compression_service
    if _context_compression_service is None:
        _context_compression_service = ContextCompressionService(budget)
    return _context_compression_service
