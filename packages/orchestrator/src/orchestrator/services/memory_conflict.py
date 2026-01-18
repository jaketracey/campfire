"""Memory Conflict Resolution Service.

This service handles detection and resolution of conflicts between memories,
maintaining temporal validity and preserving historical facts for context.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger()


class ConflictType(str, Enum):
    """Types of memory conflicts."""

    CONTRADICTION = "contradiction"
    """Direct contradiction (e.g., 'lives in X' vs 'lives in Y')."""

    UPDATE = "update"
    """Information update (e.g., 'has 2 cats' → 'has 3 cats')."""

    CORRECTION = "correction"
    """User explicitly corrected previous information."""

    TEMPORAL = "temporal"
    """Time-based change (e.g., 'used to work at X')."""


class ResolutionStrategy(str, Enum):
    """Strategies for resolving memory conflicts."""

    KEEP_NEWEST = "keep_newest"
    """Invalidate old memory, keep new one."""

    KEEP_BOTH = "keep_both"
    """Keep both memories (for non-conflicting updates)."""

    KEEP_HIGHER_IMPORTANCE = "keep_higher_importance"
    """Keep the memory with higher importance score."""

    MANUAL = "manual"
    """Flag for manual review."""


@dataclass
class ConflictConfig:
    """Configuration for conflict detection."""

    similarity_threshold: float = 0.85
    """Semantic similarity threshold for conflict detection."""

    max_age_for_conflict_days: int = 365
    """Maximum age of memories to consider for conflicts."""

    auto_invalidate_on_conflict: bool = True
    """Whether to automatically invalidate conflicting memories."""


@dataclass
class MemoryWithValidity:
    """A memory with temporal validity tracking."""

    id: UUID
    """Unique identifier."""

    user_id: UUID
    """User this memory belongs to."""

    companion_id: UUID
    """Companion context."""

    content: str
    """Memory content."""

    memory_type: str
    """Type of memory (fact, preference, etc.)."""

    created_at: datetime
    """When the memory was created."""

    valid_from: datetime
    """When this fact became valid."""

    valid_until: datetime | None = None
    """When this fact became invalid (None = still valid)."""

    importance: float = 0.5
    """Importance score (0-1)."""

    @property
    def is_currently_valid(self) -> bool:
        """Check if memory is currently valid."""
        if self.valid_until is None:
            return True
        return self.valid_until > datetime.utcnow()

    @property
    def validity_duration(self) -> timedelta | None:
        """Get duration memory was valid for (if invalidated)."""
        if self.valid_until is None:
            return None
        return self.valid_until - self.valid_from


@dataclass
class MemoryConflict:
    """A detected memory conflict."""

    existing_memory: MemoryWithValidity
    """The existing memory that conflicts."""

    new_content: str
    """The new content that conflicts."""

    conflict_type: ConflictType
    """Type of conflict detected."""

    confidence: float
    """Confidence in conflict detection (0-1)."""

    explanation: str
    """Human-readable explanation of the conflict."""

    new_importance: float = 0.5
    """Importance of the new memory."""


@dataclass
class ConflictResolution:
    """Result of resolving a conflict."""

    conflict: MemoryConflict
    """The conflict that was resolved."""

    strategy_used: ResolutionStrategy
    """Strategy that was used."""

    invalidated_memory_id: UUID | None
    """ID of memory that was invalidated, if any."""

    action_taken: str
    """Description of action taken."""


class MemoryConflictService:
    """Service for detecting and resolving memory conflicts.

    Handles:
    - Detection of contradictions, updates, and corrections
    - Resolution strategies (keep newest, keep both, by importance)
    - Temporal validity tracking
    - Historical context preservation
    """

    # Keywords that suggest location facts
    LOCATION_KEYWORDS = {"live", "lives", "moved", "from", "in", "at", "location"}

    # Keywords that suggest quantity facts
    QUANTITY_KEYWORDS = {"has", "have", "own", "owns", "number", "count"}

    # Keywords that suggest preference facts
    PREFERENCE_KEYWORDS = {"like", "likes", "love", "loves", "prefer", "favorite", "hate", "hates"}

    def __init__(self, config: ConflictConfig | None = None):
        """Initialize the conflict service.

        Args:
            config: Optional conflict configuration.
        """
        self.config = config or ConflictConfig()

    def detect_conflicts(
        self,
        new_content: str,
        existing_memories: list[MemoryWithValidity],
        topic: str | None = None,
    ) -> list[MemoryConflict]:
        """Detect conflicts between new content and existing memories.

        Args:
            new_content: The new memory content to check.
            existing_memories: List of existing memories.
            topic: Optional topic hint for conflict detection.

        Returns:
            List of detected conflicts.
        """
        conflicts = []

        # Filter to only currently valid memories
        valid_memories = [m for m in existing_memories if m.is_currently_valid]

        # Filter by age
        cutoff_date = datetime.utcnow() - timedelta(days=self.config.max_age_for_conflict_days)
        recent_memories = [m for m in valid_memories if m.created_at > cutoff_date]

        for memory in recent_memories:
            # Check for exact duplicate
            if self._is_duplicate(new_content, memory.content):
                continue  # Not a conflict, just duplicate

            # Check for potential conflict
            conflict = self._check_conflict(new_content, memory, topic)
            if conflict:
                conflicts.append(conflict)

        logger.debug(
            "conflicts_detected",
            new_content_preview=new_content[:50],
            existing_count=len(existing_memories),
            conflict_count=len(conflicts),
        )

        return conflicts

    def _is_duplicate(self, content1: str, content2: str) -> bool:
        """Check if two contents are essentially duplicates."""
        # Normalize and compare
        norm1 = content1.lower().strip()
        norm2 = content2.lower().strip()

        # Exact match
        if norm1 == norm2:
            return True

        # Very similar (within few chars)
        if abs(len(norm1) - len(norm2)) < 5:
            # Simple character overlap check
            overlap = sum(1 for c in norm1 if c in norm2) / max(len(norm1), 1)
            if overlap > 0.9:
                return True

        return False

    def _check_conflict(
        self,
        new_content: str,
        existing: MemoryWithValidity,
        topic: str | None,
    ) -> MemoryConflict | None:
        """Check if new content conflicts with existing memory.

        Args:
            new_content: New content to check.
            existing: Existing memory.
            topic: Optional topic hint.

        Returns:
            MemoryConflict if conflict detected, None otherwise.
        """
        new_lower = new_content.lower()
        existing_lower = existing.content.lower()

        # Check for topic-specific conflicts
        conflict_type = None
        confidence = 0.0
        explanation = ""

        # Location conflict detection
        if topic == "location" or self._has_keywords(new_lower, self.LOCATION_KEYWORDS):
            if self._has_keywords(existing_lower, self.LOCATION_KEYWORDS):
                # Both are about location - likely conflict
                conflict_type = ConflictType.UPDATE
                confidence = 0.85
                explanation = f"Both memories appear to be about location. Existing: '{existing.content}' may conflict with new: '{new_content}'"

        # Quantity conflict detection
        elif topic == "pets" or self._has_keywords(new_lower, self.QUANTITY_KEYWORDS):
            if self._has_keywords(existing_lower, self.QUANTITY_KEYWORDS):
                # Check for number changes
                existing_numbers = self._extract_numbers(existing_lower)
                new_numbers = self._extract_numbers(new_lower)

                if existing_numbers and new_numbers and existing_numbers != new_numbers:
                    conflict_type = ConflictType.UPDATE
                    confidence = 0.80
                    explanation = f"Quantity changed from {existing_numbers} to {new_numbers}"

        # Preference conflict detection
        elif topic == "preferences" or self._has_keywords(new_lower, self.PREFERENCE_KEYWORDS):
            if self._has_keywords(existing_lower, self.PREFERENCE_KEYWORDS):
                # Check for conflicting preferences
                if self._preferences_conflict(new_lower, existing_lower):
                    conflict_type = ConflictType.CONTRADICTION
                    confidence = 0.75
                    explanation = "Preference may have changed"

        # Generic semantic similarity check (simplified)
        if not conflict_type:
            # Check word overlap as a simple similarity proxy
            new_words = set(new_lower.split())
            existing_words = set(existing_lower.split())
            overlap = len(new_words & existing_words) / max(len(new_words | existing_words), 1)

            if overlap > 0.3:  # Some topic overlap
                # Check for contradicting words
                if self._has_contradiction_signals(new_lower, existing_lower):
                    conflict_type = ConflictType.CONTRADICTION
                    confidence = 0.6
                    explanation = "Content appears to address similar topic with different information"

        if conflict_type and confidence > 0.5:
            return MemoryConflict(
                existing_memory=existing,
                new_content=new_content,
                conflict_type=conflict_type,
                confidence=confidence,
                explanation=explanation,
            )

        return None

    def _has_keywords(self, text: str, keywords: set[str]) -> bool:
        """Check if text contains any of the keywords."""
        words = set(text.lower().split())
        return bool(words & keywords)

    def _extract_numbers(self, text: str) -> list[int]:
        """Extract numbers from text."""
        import re
        numbers = re.findall(r'\d+', text)
        return [int(n) for n in numbers]

    def _preferences_conflict(self, text1: str, text2: str) -> bool:
        """Check if two preference statements might conflict."""
        # Look for opposite sentiment words
        positive = {"like", "love", "enjoy", "prefer", "favorite"}
        negative = {"hate", "dislike", "avoid", "never"}

        words1 = set(text1.split())
        words2 = set(text2.split())

        # Check for opposite sentiments on similar subjects
        has_positive1 = bool(words1 & positive)
        has_negative1 = bool(words1 & negative)
        has_positive2 = bool(words2 & positive)
        has_negative2 = bool(words2 & negative)

        # Conflict if opposite sentiments
        if (has_positive1 and has_negative2) or (has_negative1 and has_positive2):
            return True

        return False

    def _has_contradiction_signals(self, text1: str, text2: str) -> bool:
        """Check for words that signal contradiction."""
        contradiction_pairs = [
            ("yes", "no"),
            ("true", "false"),
            ("always", "never"),
            ("love", "hate"),
            ("like", "dislike"),
        ]

        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())

        for word1, word2 in contradiction_pairs:
            if (word1 in words1 and word2 in words2) or (word2 in words1 and word1 in words2):
                return True

        return False

    def resolve_conflict(
        self,
        conflict: MemoryConflict,
        strategy: ResolutionStrategy,
    ) -> ConflictResolution:
        """Resolve a memory conflict using specified strategy.

        Args:
            conflict: The conflict to resolve.
            strategy: Strategy to use for resolution.

        Returns:
            ConflictResolution with action taken.
        """
        invalidated_id = None
        action = ""

        if strategy == ResolutionStrategy.KEEP_NEWEST:
            invalidated_id = conflict.existing_memory.id
            action = "invalidate_old"

        elif strategy == ResolutionStrategy.KEEP_BOTH:
            action = "keep_both"

        elif strategy == ResolutionStrategy.KEEP_HIGHER_IMPORTANCE:
            new_importance = conflict.new_importance
            old_importance = conflict.existing_memory.importance

            if new_importance > old_importance:
                invalidated_id = conflict.existing_memory.id
                action = "invalidate_old"
            else:
                action = "reject_new"

        elif strategy == ResolutionStrategy.MANUAL:
            action = "flag_for_review"

        logger.info(
            "conflict_resolved",
            conflict_type=conflict.conflict_type.value,
            strategy=strategy.value,
            action=action,
            invalidated_id=str(invalidated_id) if invalidated_id else None,
        )

        return ConflictResolution(
            conflict=conflict,
            strategy_used=strategy,
            invalidated_memory_id=invalidated_id,
            action_taken=action,
        )

    def invalidate_memory(
        self,
        memory: MemoryWithValidity,
    ) -> MemoryWithValidity:
        """Mark a memory as no longer valid.

        Args:
            memory: Memory to invalidate.

        Returns:
            Updated memory with valid_until set.
        """
        return MemoryWithValidity(
            id=memory.id,
            user_id=memory.user_id,
            companion_id=memory.companion_id,
            content=memory.content,
            memory_type=memory.memory_type,
            created_at=memory.created_at,
            valid_from=memory.valid_from,
            valid_until=datetime.utcnow(),
            importance=memory.importance,
        )

    def get_memory_timeline(
        self,
        memories: list[MemoryWithValidity],
    ) -> list[MemoryWithValidity]:
        """Get memories sorted by validity timeline.

        Args:
            memories: List of memories (valid and invalid).

        Returns:
            Memories sorted by valid_from (oldest first).
        """
        return sorted(memories, key=lambda m: m.valid_from)

    def format_historical_context(
        self,
        memory: MemoryWithValidity,
    ) -> str:
        """Format an invalidated memory for historical context.

        Creates phrasing suitable for "you used to..." type responses.

        Args:
            memory: An invalidated memory.

        Returns:
            Formatted historical context string.
        """
        if memory.is_currently_valid:
            return memory.content

        # Calculate how long ago it was valid
        if memory.valid_until:
            time_since = datetime.utcnow() - memory.valid_until

            if time_since.days > 365:
                time_phrase = f"over {time_since.days // 365} year(s) ago"
            elif time_since.days > 30:
                time_phrase = f"about {time_since.days // 30} month(s) ago"
            else:
                time_phrase = "recently"

            return f"Previously ({time_phrase}): {memory.content}"

        return f"Previously: {memory.content}"

    def generate_explanation(
        self,
        conflict: MemoryConflict,
    ) -> str:
        """Generate a human-readable explanation of a conflict.

        Args:
            conflict: The conflict to explain.

        Returns:
            Explanation string.
        """
        if conflict.explanation:
            return conflict.explanation

        # Generate default explanation
        existing_preview = conflict.existing_memory.content[:50]
        new_preview = conflict.new_content[:50]

        type_descriptions = {
            ConflictType.CONTRADICTION: "directly contradicts",
            ConflictType.UPDATE: "updates information in",
            ConflictType.CORRECTION: "corrects",
            ConflictType.TEMPORAL: "provides a temporal update to",
        }

        verb = type_descriptions.get(conflict.conflict_type, "conflicts with")

        return f"New memory '{new_preview}...' {verb} existing memory '{existing_preview}...'"


# Singleton instance
_memory_conflict_service: MemoryConflictService | None = None


def get_memory_conflict_service(
    config: ConflictConfig | None = None,
) -> MemoryConflictService:
    """Get the singleton memory conflict service.

    Args:
        config: Optional conflict configuration.

    Returns:
        The MemoryConflictService instance.
    """
    global _memory_conflict_service
    if _memory_conflict_service is None:
        _memory_conflict_service = MemoryConflictService(config)
    return _memory_conflict_service
