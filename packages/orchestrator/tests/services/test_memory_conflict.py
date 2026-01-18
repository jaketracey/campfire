"""Tests for Memory Conflict Resolution Service.

These tests verify the implementation of memory conflict detection,
resolution, and historical fact preservation.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.services.memory_conflict import (
    MemoryConflictService,
    ConflictConfig,
    MemoryConflict,
    ConflictType,
    ConflictResolution,
    ResolutionStrategy,
    MemoryWithValidity,
)


@pytest.fixture
def conflict_config():
    """Create a test conflict configuration."""
    return ConflictConfig(
        similarity_threshold=0.85,
        max_age_for_conflict_days=365,
        auto_invalidate_on_conflict=True,
    )


@pytest.fixture
def conflict_service(conflict_config):
    """Create a memory conflict service."""
    return MemoryConflictService(config=conflict_config)


@pytest.fixture
def sample_memory():
    """Create a sample memory."""
    return MemoryWithValidity(
        id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
        content="User lives in Denver, Colorado.",
        memory_type="fact",
        created_at=datetime.utcnow() - timedelta(days=30),
        valid_from=datetime.utcnow() - timedelta(days=30),
        valid_until=None,  # Currently valid
        importance=0.8,
    )


class TestConflictConfig:
    """Tests for ConflictConfig."""

    def test_default_config(self):
        """Should have sensible defaults."""
        config = ConflictConfig()

        assert config.similarity_threshold == 0.85
        assert config.max_age_for_conflict_days == 365
        assert config.auto_invalidate_on_conflict is True

    def test_custom_config(self):
        """Should accept custom values."""
        config = ConflictConfig(
            similarity_threshold=0.90,
            max_age_for_conflict_days=180,
            auto_invalidate_on_conflict=False,
        )

        assert config.similarity_threshold == 0.90
        assert config.max_age_for_conflict_days == 180
        assert config.auto_invalidate_on_conflict is False


class TestConflictType:
    """Tests for ConflictType enum."""

    def test_conflict_types(self):
        """Should have all expected conflict types."""
        assert ConflictType.CONTRADICTION.value == "contradiction"
        assert ConflictType.UPDATE.value == "update"
        assert ConflictType.CORRECTION.value == "correction"
        assert ConflictType.TEMPORAL.value == "temporal"


class TestResolutionStrategy:
    """Tests for ResolutionStrategy enum."""

    def test_resolution_strategies(self):
        """Should have all expected strategies."""
        assert ResolutionStrategy.KEEP_NEWEST.value == "keep_newest"
        assert ResolutionStrategy.KEEP_BOTH.value == "keep_both"
        assert ResolutionStrategy.KEEP_HIGHER_IMPORTANCE.value == "keep_higher_importance"
        assert ResolutionStrategy.MANUAL.value == "manual"


class TestMemoryWithValidity:
    """Tests for MemoryWithValidity model."""

    def test_memory_creation(self, sample_memory):
        """Should create memory with all fields."""
        assert sample_memory.content == "User lives in Denver, Colorado."
        assert sample_memory.valid_until is None
        assert sample_memory.importance == 0.8

    def test_is_currently_valid(self, sample_memory):
        """Should correctly report validity."""
        assert sample_memory.is_currently_valid is True

        # Create an invalid memory
        invalid_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="Old fact",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=60),
            valid_from=datetime.utcnow() - timedelta(days=60),
            valid_until=datetime.utcnow() - timedelta(days=30),
            importance=0.5,
        )
        assert invalid_memory.is_currently_valid is False

    def test_validity_duration(self, sample_memory):
        """Should calculate validity duration."""
        # Currently valid memory has no end date
        assert sample_memory.validity_duration is None

        # Invalid memory has duration
        invalid_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="Old fact",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=60),
            valid_from=datetime.utcnow() - timedelta(days=60),
            valid_until=datetime.utcnow() - timedelta(days=30),
            importance=0.5,
        )
        assert invalid_memory.validity_duration is not None
        assert invalid_memory.validity_duration.days == 30


class TestMemoryConflictServiceBasics:
    """Tests for service initialization."""

    def test_init_with_defaults(self):
        """Should initialize with default config."""
        service = MemoryConflictService()
        assert service.config is not None
        assert service.config.similarity_threshold == 0.85

    def test_init_with_custom_config(self, conflict_config):
        """Should accept custom config."""
        service = MemoryConflictService(config=conflict_config)
        assert service.config.similarity_threshold == 0.85


class TestConflictDetection:
    """Tests for conflict detection."""

    def test_detect_contradiction(self, conflict_service):
        """Should detect contradicting facts."""
        existing = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User lives in Denver, Colorado.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.8,
        )

        new_content = "User lives in San Francisco, California."

        conflicts = conflict_service.detect_conflicts(
            new_content=new_content,
            existing_memories=[existing],
            topic="location",
        )

        assert len(conflicts) > 0
        assert conflicts[0].conflict_type in [
            ConflictType.CONTRADICTION,
            ConflictType.UPDATE,
        ]

    def test_no_conflict_different_topics(self, conflict_service):
        """Should not detect conflict for unrelated memories."""
        existing = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User likes coffee.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.8,
        )

        new_content = "User works as an engineer."

        conflicts = conflict_service.detect_conflicts(
            new_content=new_content,
            existing_memories=[existing],
            topic="work",
        )

        # Should be no conflicts or only low-confidence ones
        high_confidence_conflicts = [c for c in conflicts if c.confidence > 0.7]
        assert len(high_confidence_conflicts) == 0

    def test_detect_temporal_update(self, conflict_service):
        """Should detect temporal updates (same topic, new info)."""
        existing = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User has 2 cats.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.8,
        )

        new_content = "User now has 3 cats."

        conflicts = conflict_service.detect_conflicts(
            new_content=new_content,
            existing_memories=[existing],
            topic="pets",
        )

        assert len(conflicts) > 0
        # Could be UPDATE or TEMPORAL
        assert conflicts[0].conflict_type in [
            ConflictType.UPDATE,
            ConflictType.TEMPORAL,
        ]


class TestConflictResolution:
    """Tests for conflict resolution."""

    def test_resolve_keep_newest(self, conflict_service):
        """Should keep newest memory and invalidate old."""
        old_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User lives in Denver.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.8,
        )

        conflict = MemoryConflict(
            existing_memory=old_memory,
            new_content="User lives in San Francisco.",
            conflict_type=ConflictType.UPDATE,
            confidence=0.9,
            explanation="Location changed",
        )

        resolution = conflict_service.resolve_conflict(
            conflict=conflict,
            strategy=ResolutionStrategy.KEEP_NEWEST,
        )

        assert resolution.invalidated_memory_id == old_memory.id
        assert resolution.action_taken == "invalidate_old"

    def test_resolve_keep_both(self, conflict_service):
        """Should keep both memories when appropriate."""
        old_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User visited Paris in 2020.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.7,
        )

        conflict = MemoryConflict(
            existing_memory=old_memory,
            new_content="User visited Tokyo in 2023.",
            conflict_type=ConflictType.UPDATE,
            confidence=0.5,  # Low confidence - might not be a conflict
            explanation="Different trips",
        )

        resolution = conflict_service.resolve_conflict(
            conflict=conflict,
            strategy=ResolutionStrategy.KEEP_BOTH,
        )

        assert resolution.invalidated_memory_id is None
        assert resolution.action_taken == "keep_both"

    def test_resolve_by_importance(self, conflict_service):
        """Should keep higher importance memory."""
        low_importance = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User mentioned liking blue.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.3,
        )

        conflict = MemoryConflict(
            existing_memory=low_importance,
            new_content="User's favorite color is green.",
            conflict_type=ConflictType.CONTRADICTION,
            confidence=0.9,
            explanation="Contradicting color preference",
            new_importance=0.9,  # Higher importance
        )

        resolution = conflict_service.resolve_conflict(
            conflict=conflict,
            strategy=ResolutionStrategy.KEEP_HIGHER_IMPORTANCE,
        )

        # Should invalidate lower importance
        assert resolution.invalidated_memory_id == low_importance.id


class TestInvalidateMemory:
    """Tests for memory invalidation."""

    def test_invalidate_sets_valid_until(self, conflict_service, sample_memory):
        """Should set valid_until when invalidating."""
        updated = conflict_service.invalidate_memory(sample_memory)

        assert updated.valid_until is not None
        assert updated.valid_until <= datetime.utcnow()
        assert updated.is_currently_valid is False

    def test_invalidate_preserves_other_fields(self, conflict_service, sample_memory):
        """Should preserve other memory fields."""
        updated = conflict_service.invalidate_memory(sample_memory)

        assert updated.id == sample_memory.id
        assert updated.content == sample_memory.content
        assert updated.valid_from == sample_memory.valid_from


class TestHistoricalAccess:
    """Tests for accessing historical/invalidated memories."""

    def test_get_memory_history(self, conflict_service):
        """Should retrieve memory history for a topic."""
        user_id = uuid4()
        companion_id = uuid4()

        # Create a history of location memories
        memories = [
            MemoryWithValidity(
                id=uuid4(),
                user_id=user_id,
                companion_id=companion_id,
                content="User lived in Denver.",
                memory_type="fact",
                created_at=datetime.utcnow() - timedelta(days=365),
                valid_from=datetime.utcnow() - timedelta(days=365),
                valid_until=datetime.utcnow() - timedelta(days=180),
                importance=0.8,
            ),
            MemoryWithValidity(
                id=uuid4(),
                user_id=user_id,
                companion_id=companion_id,
                content="User moved to San Francisco.",
                memory_type="fact",
                created_at=datetime.utcnow() - timedelta(days=180),
                valid_from=datetime.utcnow() - timedelta(days=180),
                valid_until=None,  # Currently valid
                importance=0.8,
            ),
        ]

        # Get history (sorted by valid_from)
        history = conflict_service.get_memory_timeline(memories)

        assert len(history) == 2
        # Oldest first
        assert "Denver" in history[0].content
        assert "San Francisco" in history[1].content

    def test_format_for_you_used_to(self, conflict_service):
        """Should format historical memories for 'you used to' responses."""
        old_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User lived in Denver.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=365),
            valid_from=datetime.utcnow() - timedelta(days=365),
            valid_until=datetime.utcnow() - timedelta(days=180),
            importance=0.8,
        )

        formatted = conflict_service.format_historical_context(old_memory)

        assert "previously" in formatted.lower() or "used to" in formatted.lower()
        assert "Denver" in formatted


class TestConflictExplanation:
    """Tests for conflict explanation generation."""

    def test_explain_contradiction(self, conflict_service):
        """Should explain why memories conflict."""
        old_memory = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User is allergic to cats.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.9,
        )

        conflict = MemoryConflict(
            existing_memory=old_memory,
            new_content="User just adopted a cat.",
            conflict_type=ConflictType.CONTRADICTION,
            confidence=0.8,
            explanation="",
        )

        explanation = conflict_service.generate_explanation(conflict)

        assert len(explanation) > 0
        # Should reference both memories
        assert "cat" in explanation.lower()


class TestEdgeCases:
    """Tests for edge cases."""

    def test_empty_existing_memories(self, conflict_service):
        """Should handle no existing memories."""
        conflicts = conflict_service.detect_conflicts(
            new_content="User likes pizza.",
            existing_memories=[],
            topic="food",
        )

        assert conflicts == []

    def test_very_old_memory(self, conflict_service):
        """Should handle memories outside conflict window."""
        very_old = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User lived in Boston.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=500),  # Over max age
            valid_from=datetime.utcnow() - timedelta(days=500),
            importance=0.8,
        )

        conflicts = conflict_service.detect_conflicts(
            new_content="User lives in Denver.",
            existing_memories=[very_old],
            topic="location",
        )

        # Very old memories should be excluded from conflict detection
        # or have lower confidence
        if conflicts:
            assert conflicts[0].confidence < 0.9

    def test_already_invalidated_memory(self, conflict_service):
        """Should not conflict with already invalidated memories."""
        invalidated = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User lived in Denver.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=60),
            valid_from=datetime.utcnow() - timedelta(days=60),
            valid_until=datetime.utcnow() - timedelta(days=30),  # Already invalid
            importance=0.8,
        )

        conflicts = conflict_service.detect_conflicts(
            new_content="User lives in San Francisco.",
            existing_memories=[invalidated],
            topic="location",
        )

        # Should not detect conflict with already invalidated memory
        assert len(conflicts) == 0

    def test_same_content_no_conflict(self, conflict_service):
        """Should not flag identical content as conflict."""
        existing = MemoryWithValidity(
            id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            content="User likes coffee.",
            memory_type="fact",
            created_at=datetime.utcnow() - timedelta(days=30),
            valid_from=datetime.utcnow() - timedelta(days=30),
            importance=0.8,
        )

        conflicts = conflict_service.detect_conflicts(
            new_content="User likes coffee.",  # Same content
            existing_memories=[existing],
            topic="preferences",
        )

        assert len(conflicts) == 0
