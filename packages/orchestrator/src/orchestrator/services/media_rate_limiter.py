"""Media Generation Rate Limiter.

This service limits the rate of media (image/video) generation to prevent
abuse and ensure fair usage. It enforces:
- Minimum messages between media generations
- Maximum media per session
- Cooldown periods between generations
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger()


class MediaType(str, Enum):
    """Types of media that can be generated."""

    IMAGE = "image"
    VIDEO = "video"


@dataclass
class MediaRateLimitExceeded(Exception):
    """Exception raised when media rate limit is exceeded."""

    session_id: UUID
    media_type: MediaType
    messages_needed: int
    reason: str

    def __str__(self) -> str:
        return (
            f"Media rate limit exceeded for {self.media_type.value}: "
            f"{self.reason}. Need {self.messages_needed} more messages."
        )


@dataclass
class SessionMediaState:
    """Tracks media generation state for a session."""

    total_generations: int = 0
    image_generations: int = 0
    video_generations: int = 0
    messages_since_last_media: int = 0
    last_generation_time: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)


class MediaRateLimiter:
    """Rate limiter for media generation.

    Enforces limits on how frequently media can be generated within a session
    to prevent abuse and manage costs.

    Attributes:
        min_messages_between_media: Minimum user messages required between
            media generations.
        max_media_per_session: Maximum total media items per session.
        cooldown_seconds: Minimum seconds between media generations.
    """

    def __init__(
        self,
        min_messages_between_media: int = 3,
        max_media_per_session: int = 10,
        cooldown_seconds: int = 60,
    ):
        """Initialize the rate limiter.

        Args:
            min_messages_between_media: Minimum messages required between
                media generations. Default 3.
            max_media_per_session: Maximum media per session. Default 10.
            cooldown_seconds: Cooldown between generations. Default 60.
        """
        self.min_messages_between_media = min_messages_between_media
        self.max_media_per_session = max_media_per_session
        self.cooldown_seconds = cooldown_seconds

        # In-memory session state (could be Redis in production)
        self._sessions: dict[UUID, SessionMediaState] = {}

    def can_generate_media(
        self,
        session_id: UUID,
        media_type: MediaType,
    ) -> bool:
        """Check if media generation is allowed for the session.

        Args:
            session_id: The session to check.
            media_type: Type of media to generate.

        Returns:
            True if generation is allowed, False otherwise.
        """
        state = self._sessions.get(session_id)

        # New session - always allowed
        if state is None:
            return True

        # Check session limit
        if state.total_generations >= self.max_media_per_session:
            logger.debug(
                "media_rate_limit_session_max",
                session_id=str(session_id),
                total=state.total_generations,
                max=self.max_media_per_session,
            )
            return False

        # Check message count
        if state.messages_since_last_media < self.min_messages_between_media:
            logger.debug(
                "media_rate_limit_messages",
                session_id=str(session_id),
                messages=state.messages_since_last_media,
                required=self.min_messages_between_media,
            )
            return False

        # Check cooldown
        if state.last_generation_time:
            elapsed = (datetime.utcnow() - state.last_generation_time).total_seconds()
            if elapsed < self.cooldown_seconds:
                logger.debug(
                    "media_rate_limit_cooldown",
                    session_id=str(session_id),
                    elapsed_seconds=elapsed,
                    cooldown_seconds=self.cooldown_seconds,
                )
                return False

        return True

    def record_generation(
        self,
        session_id: UUID,
        media_type: MediaType,
    ) -> None:
        """Record a media generation event.

        Args:
            session_id: The session that generated media.
            media_type: Type of media generated.
        """
        state = self._sessions.get(session_id)
        if state is None:
            state = SessionMediaState()
            self._sessions[session_id] = state

        state.total_generations += 1
        state.messages_since_last_media = 0
        state.last_generation_time = datetime.utcnow()

        if media_type == MediaType.IMAGE:
            state.image_generations += 1
        elif media_type == MediaType.VIDEO:
            state.video_generations += 1

        logger.info(
            "media_generation_recorded",
            session_id=str(session_id),
            media_type=media_type.value,
            total_generations=state.total_generations,
        )

    def record_message(self, session_id: UUID) -> None:
        """Record a user message, incrementing the message count.

        Args:
            session_id: The session that received a message.
        """
        state = self._sessions.get(session_id)
        if state is None:
            state = SessionMediaState()
            self._sessions[session_id] = state

        state.messages_since_last_media += 1

    def get_session_state(self, session_id: UUID) -> dict[str, Any] | None:
        """Get the current rate limit state for a session.

        Args:
            session_id: The session to get state for.

        Returns:
            Dictionary with state information, or None if session not found.
        """
        state = self._sessions.get(session_id)
        if state is None:
            return None

        return {
            "total_generations": state.total_generations,
            "image_generations": state.image_generations,
            "video_generations": state.video_generations,
            "messages_since_last_media": state.messages_since_last_media,
            "last_generation_time": state.last_generation_time,
        }

    def check_and_record(
        self,
        session_id: UUID,
        media_type: MediaType,
        raise_on_limit: bool = False,
    ) -> bool:
        """Check if generation is allowed and record if so.

        Combines check and record into an atomic operation.

        Args:
            session_id: The session to check.
            media_type: Type of media to generate.
            raise_on_limit: If True, raise exception instead of returning False.

        Returns:
            True if allowed and recorded, False if rate limited.

        Raises:
            MediaRateLimitExceeded: If rate limited and raise_on_limit is True.
        """
        if not self.can_generate_media(session_id, media_type):
            state = self._sessions.get(session_id)
            messages_needed = 0
            reason = "Rate limit exceeded"

            if state:
                if state.total_generations >= self.max_media_per_session:
                    reason = "Session limit reached"
                    messages_needed = 0
                else:
                    messages_needed = max(
                        0,
                        self.min_messages_between_media - state.messages_since_last_media,
                    )
                    reason = f"Need {messages_needed} more messages"

            if raise_on_limit:
                raise MediaRateLimitExceeded(
                    session_id=session_id,
                    media_type=media_type,
                    messages_needed=messages_needed,
                    reason=reason,
                )

            return False

        self.record_generation(session_id, media_type)
        return True

    def get_remaining_quota(self, session_id: UUID) -> dict[str, Any]:
        """Get the remaining media quota for a session.

        Args:
            session_id: The session to check.

        Returns:
            Dictionary with quota information.
        """
        state = self._sessions.get(session_id)

        if state is None:
            return {
                "can_generate_now": True,
                "remaining_in_session": self.max_media_per_session,
                "messages_until_allowed": 0,
            }

        remaining = max(0, self.max_media_per_session - state.total_generations)
        messages_needed = max(
            0,
            self.min_messages_between_media - state.messages_since_last_media,
        )

        return {
            "can_generate_now": self.can_generate_media(session_id, MediaType.IMAGE),
            "remaining_in_session": remaining,
            "messages_until_allowed": messages_needed,
        }

    def clear_session(self, session_id: UUID) -> None:
        """Clear rate limit state for a session.

        Args:
            session_id: The session to clear.
        """
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.debug(
                "media_rate_limit_session_cleared",
                session_id=str(session_id),
            )


# Singleton instance
_media_rate_limiter: MediaRateLimiter | None = None


def get_media_rate_limiter(
    min_messages_between_media: int = 3,
    max_media_per_session: int = 10,
    cooldown_seconds: int = 60,
) -> MediaRateLimiter:
    """Get the singleton media rate limiter.

    Args:
        min_messages_between_media: Minimum messages between generations.
        max_media_per_session: Maximum media per session.
        cooldown_seconds: Cooldown between generations.

    Returns:
        The MediaRateLimiter instance.
    """
    global _media_rate_limiter
    if _media_rate_limiter is None:
        _media_rate_limiter = MediaRateLimiter(
            min_messages_between_media=min_messages_between_media,
            max_media_per_session=max_media_per_session,
            cooldown_seconds=cooldown_seconds,
        )
    return _media_rate_limiter
