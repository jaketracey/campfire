"""
MediaRateLimiter Tests

Tests for the media generation rate limiter, which prevents
excessive image/video generation by limiting to 1 media item
per N messages.
"""

import pytest
from uuid import uuid4
from datetime import datetime, timedelta

from orchestrator.services.media_rate_limiter import (
    MediaRateLimiter,
    MediaRateLimitExceeded,
    MediaType,
)


@pytest.fixture
def limiter():
    """Create a rate limiter with default settings (no cooldown for testing)."""
    return MediaRateLimiter(
        min_messages_between_media=3,
        max_media_per_session=10,
        cooldown_seconds=0,  # No cooldown for faster testing
    )


@pytest.fixture
def session_id():
    """Create a unique session ID."""
    return uuid4()


class TestMediaRateLimiterBasics:
    """Basic tests for MediaRateLimiter."""

    def test_init_with_defaults(self):
        """Should initialize with default values."""
        limiter = MediaRateLimiter()
        assert limiter.min_messages_between_media == 3
        assert limiter.max_media_per_session == 10
        assert limiter.cooldown_seconds == 60

    def test_init_with_custom_values(self):
        """Should accept custom configuration."""
        limiter = MediaRateLimiter(
            min_messages_between_media=5,
            max_media_per_session=20,
            cooldown_seconds=120,
        )
        assert limiter.min_messages_between_media == 5
        assert limiter.max_media_per_session == 20
        assert limiter.cooldown_seconds == 120


class TestCanGenerateMedia:
    """Tests for can_generate_media method."""

    def test_first_generation_allowed(self, limiter, session_id):
        """First media generation should always be allowed."""
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is True

    def test_second_generation_blocked_without_messages(self, limiter, session_id):
        """Second generation should be blocked if no messages between."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is False

    def test_generation_allowed_after_enough_messages(self, limiter, session_id):
        """Generation should be allowed after min_messages_between_media."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        # Record enough messages
        for _ in range(3):
            limiter.record_message(session_id)
        
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is True

    def test_generation_blocked_with_insufficient_messages(self, limiter, session_id):
        """Generation should be blocked with insufficient messages."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        # Record insufficient messages
        for _ in range(2):  # Only 2, need 3
            limiter.record_message(session_id)
        
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is False

    def test_different_media_types_share_limit(self, limiter, session_id):
        """Image and video generations should share the message limit."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        # Video should also be blocked
        assert limiter.can_generate_media(session_id, MediaType.VIDEO) is False

    def test_max_media_per_session_limit(self, limiter, session_id):
        """Should block after max_media_per_session is reached."""
        # Generate max allowed media
        for i in range(10):
            limiter.record_generation(session_id, MediaType.IMAGE)
            # Record enough messages between each
            for _ in range(3):
                limiter.record_message(session_id)
        
        # Should now be blocked
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is False

    def test_separate_sessions_have_separate_limits(self, limiter):
        """Different sessions should have independent limits."""
        session1 = uuid4()
        session2 = uuid4()
        
        limiter.record_generation(session1, MediaType.IMAGE)
        
        # Session 2 should still be allowed
        assert limiter.can_generate_media(session2, MediaType.IMAGE) is True


class TestCooldownBehavior:
    """Tests for time-based cooldown."""

    def test_generation_blocked_during_cooldown(self, session_id):
        """Generation should be blocked during cooldown period."""
        # Create limiter with a cooldown
        limiter_with_cooldown = MediaRateLimiter(
            min_messages_between_media=3,
            max_media_per_session=10,
            cooldown_seconds=60,
        )
        limiter_with_cooldown.record_generation(session_id, MediaType.IMAGE)
        
        # Even with enough messages, should still be in cooldown
        for _ in range(3):
            limiter_with_cooldown.record_message(session_id)
        
        # Should be blocked due to cooldown (60 seconds hasn't passed)
        result = limiter_with_cooldown.can_generate_media(session_id, MediaType.IMAGE)
        assert result is False

    def test_cooldown_tracking_per_session(self, limiter):
        """Cooldown should be tracked per session."""
        session1 = uuid4()
        session2 = uuid4()
        
        limiter.record_generation(session1, MediaType.IMAGE)
        
        # Session 2 should not have a cooldown
        assert limiter.can_generate_media(session2, MediaType.IMAGE) is True


class TestRecordGeneration:
    """Tests for record_generation method."""

    def test_record_generation_updates_count(self, limiter, session_id):
        """Recording generation should update the count."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        state = limiter.get_session_state(session_id)
        assert state["total_generations"] == 1

    def test_record_generation_resets_message_count(self, limiter, session_id):
        """Recording generation should reset message count since last media."""
        limiter.record_message(session_id)
        limiter.record_message(session_id)
        
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        state = limiter.get_session_state(session_id)
        assert state["messages_since_last_media"] == 0

    def test_record_generation_tracks_media_type(self, limiter, session_id):
        """Should track both image and video generations."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        limiter.record_message(session_id)
        limiter.record_message(session_id)
        limiter.record_message(session_id)
        limiter.record_generation(session_id, MediaType.VIDEO)
        
        state = limiter.get_session_state(session_id)
        assert state["total_generations"] == 2
        assert state["image_generations"] == 1
        assert state["video_generations"] == 1


class TestRecordMessage:
    """Tests for record_message method."""

    def test_record_message_increments_count(self, limiter, session_id):
        """Recording a message should increment the count."""
        limiter.record_message(session_id)
        limiter.record_message(session_id)
        
        state = limiter.get_session_state(session_id)
        assert state["messages_since_last_media"] == 2

    def test_record_message_creates_session_state(self, limiter, session_id):
        """Recording a message should create session state if it doesn't exist."""
        limiter.record_message(session_id)
        
        state = limiter.get_session_state(session_id)
        assert state is not None
        assert state["messages_since_last_media"] == 1


class TestGetSessionState:
    """Tests for get_session_state method."""

    def test_returns_none_for_unknown_session(self, limiter):
        """Should return None for unknown session."""
        state = limiter.get_session_state(uuid4())
        assert state is None

    def test_returns_correct_state(self, limiter, session_id):
        """Should return correct state for known session."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        limiter.record_message(session_id)
        
        state = limiter.get_session_state(session_id)
        
        assert state["total_generations"] == 1
        assert state["messages_since_last_media"] == 1


class TestCheckAndRecord:
    """Tests for check_and_record method (combined check + record)."""

    def test_check_and_record_success(self, limiter, session_id):
        """Should return True and record on success."""
        result = limiter.check_and_record(session_id, MediaType.IMAGE)
        
        assert result is True
        state = limiter.get_session_state(session_id)
        assert state["total_generations"] == 1

    def test_check_and_record_failure_no_record(self, limiter, session_id):
        """Should return False and not record on failure."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        result = limiter.check_and_record(session_id, MediaType.VIDEO)
        
        assert result is False
        state = limiter.get_session_state(session_id)
        assert state["total_generations"] == 1  # Still 1, not incremented

    def test_check_and_record_raises_exception_option(self, limiter, session_id):
        """Should raise exception when configured to do so."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        with pytest.raises(MediaRateLimitExceeded) as exc_info:
            limiter.check_and_record(session_id, MediaType.IMAGE, raise_on_limit=True)
        
        assert exc_info.value.session_id == session_id
        assert exc_info.value.media_type == MediaType.IMAGE


class TestGetRemainingQuota:
    """Tests for get_remaining_quota method."""

    def test_full_quota_for_new_session(self, limiter, session_id):
        """New session should have full quota."""
        quota = limiter.get_remaining_quota(session_id)
        
        assert quota["can_generate_now"] is True
        assert quota["remaining_in_session"] == 10
        assert quota["messages_until_allowed"] == 0

    def test_quota_after_generation(self, limiter, session_id):
        """Quota should reflect usage after generation."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        
        quota = limiter.get_remaining_quota(session_id)
        
        assert quota["can_generate_now"] is False
        assert quota["remaining_in_session"] == 9
        assert quota["messages_until_allowed"] == 3

    def test_messages_until_allowed_decreases(self, limiter, session_id):
        """Messages until allowed should decrease with each message."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        limiter.record_message(session_id)
        
        quota = limiter.get_remaining_quota(session_id)
        
        assert quota["messages_until_allowed"] == 2


class TestClearSession:
    """Tests for clear_session method."""

    def test_clear_session_removes_state(self, limiter, session_id):
        """Clearing session should remove all state."""
        limiter.record_generation(session_id, MediaType.IMAGE)
        limiter.record_message(session_id)
        
        limiter.clear_session(session_id)
        
        state = limiter.get_session_state(session_id)
        assert state is None

    def test_clear_session_allows_fresh_start(self, limiter, session_id):
        """After clearing, session should start fresh."""
        # Use up quota
        for i in range(10):
            limiter.record_generation(session_id, MediaType.IMAGE)
            for _ in range(3):
                limiter.record_message(session_id)
        
        # Clear and verify fresh start
        limiter.clear_session(session_id)
        
        assert limiter.can_generate_media(session_id, MediaType.IMAGE) is True


class TestRateLimitExceededException:
    """Tests for MediaRateLimitExceeded exception."""

    def test_exception_contains_session_info(self, session_id):
        """Exception should contain session and media type info."""
        exc = MediaRateLimitExceeded(
            session_id=session_id,
            media_type=MediaType.IMAGE,
            messages_needed=3,
            reason="Too many requests",
        )
        
        assert exc.session_id == session_id
        assert exc.media_type == MediaType.IMAGE
        assert exc.messages_needed == 3
        assert "Too many requests" in str(exc)

    def test_exception_str_format(self, session_id):
        """Exception string should be human-readable."""
        exc = MediaRateLimitExceeded(
            session_id=session_id,
            media_type=MediaType.VIDEO,
            messages_needed=2,
            reason="Rate limit exceeded",
        )
        
        exc_str = str(exc)
        assert "video" in exc_str.lower()
        assert "2" in exc_str


class TestMediaType:
    """Tests for MediaType enum."""

    def test_image_type(self):
        """Should have IMAGE type."""
        assert MediaType.IMAGE.value == "image"

    def test_video_type(self):
        """Should have VIDEO type."""
        assert MediaType.VIDEO.value == "video"
