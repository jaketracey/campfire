"""Temporal context service for time-aware companion interactions.

Provides companions with awareness of:
- Current time of day for the user
- Time since last interaction
- Interaction patterns and streaks
- Milestones (anniversaries, session counts)
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any
from uuid import UUID

import structlog
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from orchestrator.db.pool import DatabasePool

logger = structlog.get_logger()

# Default timezone when user hasn't set one
DEFAULT_TIMEZONE = "UTC"

# Cache TTL in seconds (10 minutes)
STATS_CACHE_TTL_SECONDS = 600


class TimeOfDay(str, Enum):
    """Classification of the time of day."""

    EARLY_MORNING = "early_morning"  # 4:00 - 6:59
    MORNING = "morning"  # 7:00 - 11:59
    AFTERNOON = "afternoon"  # 12:00 - 16:59
    EVENING = "evening"  # 17:00 - 20:59
    LATE_NIGHT = "late_night"  # 21:00 - 3:59


class TemporalContext(BaseModel):
    """Full temporal context for a companion interaction."""

    # Current time info
    current_time_utc: datetime
    user_local_time: datetime
    user_timezone: str
    time_of_day: TimeOfDay
    day_of_week: str
    is_weekend: bool

    # Interaction timing
    time_since_last_interaction: timedelta | None = None
    time_since_last_interaction_human: str = "first interaction"
    last_session_ended_at: datetime | None = None
    total_sessions: int = 0
    avg_session_duration_minutes: float = 0.0

    # User patterns
    typical_active_hours: list[int] = Field(default_factory=list)
    is_unusual_time: bool = False
    streak_days: int = 0
    longest_absence_days: int = 0

    # Milestones
    days_since_first_interaction: int = 0
    is_anniversary: bool = False
    is_milestone: bool = False
    milestone_description: str | None = None

    class Config:
        frozen = True


class InteractionStats(BaseModel):
    """Cached interaction statistics for a user-companion pair."""

    total_sessions: int = 0
    first_session_at: datetime | None = None
    last_session_ended_at: datetime | None = None
    avg_session_duration_minutes: float = 0.0
    session_hours: list[int] = Field(default_factory=list)
    session_dates: list[str] = Field(default_factory=list)  # ISO date strings
    cached_at: float = 0.0  # time.time() when cached


def classify_time_of_day(hour: int) -> TimeOfDay:
    """Classify an hour (0-23) into a time-of-day category.

    Args:
        hour: Hour in 24-hour format (0-23).

    Returns:
        TimeOfDay classification.
    """
    if 4 <= hour <= 6:
        return TimeOfDay.EARLY_MORNING
    elif 7 <= hour <= 11:
        return TimeOfDay.MORNING
    elif 12 <= hour <= 16:
        return TimeOfDay.AFTERNOON
    elif 17 <= hour <= 20:
        return TimeOfDay.EVENING
    else:
        # 21-23, 0-3
        return TimeOfDay.LATE_NIGHT


def format_time_since(delta: timedelta | None) -> str:
    """Format a timedelta into a human-readable string.

    Args:
        delta: Time difference, or None if no previous interaction.

    Returns:
        Human-readable string like "3 hours ago", "2 days ago", etc.
    """
    if delta is None:
        return "first interaction"

    total_seconds = int(delta.total_seconds())
    if total_seconds < 0:
        return "just now"

    if total_seconds < 60:
        return "just now"
    elif total_seconds < 3600:
        minutes = total_seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif total_seconds < 86400:
        hours = total_seconds // 3600
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif total_seconds < 604800:
        days = total_seconds // 86400
        return f"{days} day{'s' if days != 1 else ''} ago"
    elif total_seconds < 2592000:
        weeks = total_seconds // 604800
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
    else:
        months = total_seconds // 2592000
        return f"{months} month{'s' if months != 1 else ''} ago"


def resolve_timezone(tz_name: str | None) -> ZoneInfo:
    """Resolve a timezone name to a ZoneInfo object.

    Args:
        tz_name: IANA timezone name (e.g. "America/New_York"), or None.

    Returns:
        ZoneInfo object, falling back to UTC if invalid.
    """
    if not tz_name:
        return ZoneInfo(DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError):
        logger.warning("invalid_timezone", timezone=tz_name, fallback=DEFAULT_TIMEZONE)
        return ZoneInfo(DEFAULT_TIMEZONE)


def detect_typical_hours(session_hours: list[int], threshold: int = 3) -> list[int]:
    """Detect typical active hours from session hour data.

    An hour is "typical" if the user has chatted during that hour at least
    `threshold` times.

    Args:
        session_hours: List of hours (0-23) from past sessions.
        threshold: Minimum occurrences to be considered typical.

    Returns:
        Sorted list of typical active hours.
    """
    if not session_hours:
        return []

    hour_counts: dict[int, int] = {}
    for h in session_hours:
        hour_counts[h] = hour_counts.get(h, 0) + 1

    return sorted(h for h, count in hour_counts.items() if count >= threshold)


def compute_streak_days(session_dates: list[str], reference_date: str) -> int:
    """Compute consecutive days with interactions ending on reference_date.

    Args:
        session_dates: Sorted list of unique ISO date strings with sessions.
        reference_date: The current date as ISO string.

    Returns:
        Number of consecutive days ending today (0 if no session today).
    """
    if not session_dates:
        return 0

    unique_dates = sorted(set(session_dates), reverse=True)

    if unique_dates[0] != reference_date:
        return 0

    streak = 1
    for i in range(1, len(unique_dates)):
        prev_date = datetime.fromisoformat(unique_dates[i - 1]).date()
        curr_date = datetime.fromisoformat(unique_dates[i]).date()
        if (prev_date - curr_date).days == 1:
            streak += 1
        else:
            break

    return streak


def compute_longest_absence(session_dates: list[str]) -> int:
    """Compute the longest gap between sessions in days.

    Args:
        session_dates: Sorted list of unique ISO date strings.

    Returns:
        Maximum number of days between consecutive sessions.
    """
    if len(session_dates) < 2:
        return 0

    unique_dates = sorted(set(session_dates))
    max_gap = 0
    for i in range(1, len(unique_dates)):
        d1 = datetime.fromisoformat(unique_dates[i - 1]).date()
        d2 = datetime.fromisoformat(unique_dates[i]).date()
        gap = (d2 - d1).days
        if gap > max_gap:
            max_gap = gap

    return max_gap


def check_milestones(
    total_sessions: int,
    days_since_first: int,
) -> tuple[bool, bool, str | None]:
    """Check for interaction milestones.

    Args:
        total_sessions: Total number of sessions.
        days_since_first: Days since the first interaction.

    Returns:
        Tuple of (is_anniversary, is_milestone, milestone_description).
    """
    is_anniversary = False
    is_milestone = False
    milestone_desc: str | None = None

    # Anniversary check: every 365 days (but not day 0)
    if days_since_first > 0 and days_since_first % 365 == 0:
        years = days_since_first // 365
        is_anniversary = True
        milestone_desc = f"{years}-year anniversary of your first conversation"

    # Session count milestones
    session_milestones = {1, 10, 25, 50, 100, 250, 500, 1000}
    if total_sessions in session_milestones:
        is_milestone = True
        if not milestone_desc:
            if total_sessions == 1:
                milestone_desc = "This is your very first conversation"
            else:
                milestone_desc = f"This is your {total_sessions}th conversation together"

    # Weekly milestones
    if days_since_first > 0 and days_since_first % 7 == 0 and days_since_first <= 28:
        is_milestone = True
        if not milestone_desc:
            week_num = days_since_first // 7
            milestone_desc = f"{week_num}-week mark since you started chatting"

    # Monthly milestones (approximate)
    if days_since_first > 0 and days_since_first % 30 == 0 and days_since_first <= 180:
        is_milestone = True
        if not milestone_desc:
            month_num = days_since_first // 30
            milestone_desc = f"{month_num}-month mark since you started chatting"

    return is_anniversary, is_milestone, milestone_desc


class TemporalContextService:
    """Service for building temporal context for companion interactions.

    Queries the database for interaction history and computes temporal
    features like time-of-day, streaks, patterns, and milestones.
    """

    def __init__(self) -> None:
        self._stats_cache: dict[str, InteractionStats] = {}

    def _cache_key(self, user_id: UUID, companion_id: UUID) -> str:
        return f"{user_id}:{companion_id}"

    def _get_cached_stats(
        self, user_id: UUID, companion_id: UUID
    ) -> InteractionStats | None:
        """Return cached stats if still valid."""
        key = self._cache_key(user_id, companion_id)
        stats = self._stats_cache.get(key)
        if stats is None:
            return None
        age = time.time() - stats.cached_at
        if age > STATS_CACHE_TTL_SECONDS:
            del self._stats_cache[key]
            return None
        return stats

    def _set_cached_stats(
        self, user_id: UUID, companion_id: UUID, stats: InteractionStats
    ) -> None:
        key = self._cache_key(user_id, companion_id)
        self._stats_cache[key] = stats

    def invalidate_cache(self, user_id: UUID, companion_id: UUID) -> None:
        """Invalidate cached stats for a user-companion pair."""
        key = self._cache_key(user_id, companion_id)
        self._stats_cache.pop(key, None)

    async def get_interaction_stats(
        self, user_id: UUID, companion_id: UUID
    ) -> InteractionStats:
        """Query the sessions table for interaction statistics.

        Args:
            user_id: The user's UUID.
            companion_id: The companion's UUID.

        Returns:
            InteractionStats with session history data.
        """
        cached = self._get_cached_stats(user_id, companion_id)
        if cached is not None:
            return cached

        stats = InteractionStats(cached_at=time.time())

        try:
            pool = await DatabasePool.get_pool()

            # Get aggregate session stats
            row = await pool.fetchrow(
                """
                SELECT
                    COUNT(*) AS total_sessions,
                    MIN(started_at) AS first_session_at,
                    MAX(COALESCE(ended_at, last_activity_at)) AS last_session_ended_at,
                    AVG(
                        EXTRACT(EPOCH FROM (
                            COALESCE(ended_at, last_activity_at) - started_at
                        )) / 60.0
                    ) AS avg_duration_minutes
                FROM sessions
                WHERE user_id = $1 AND companion_id = $2
                """,
                user_id,
                companion_id,
            )

            if row and row["total_sessions"]:
                stats = InteractionStats(
                    total_sessions=row["total_sessions"],
                    first_session_at=row["first_session_at"],
                    last_session_ended_at=row["last_session_ended_at"],
                    avg_session_duration_minutes=float(
                        row["avg_duration_minutes"] or 0.0
                    ),
                    cached_at=time.time(),
                )

            # Get session hours and dates for pattern detection
            rows = await pool.fetch(
                """
                SELECT
                    EXTRACT(HOUR FROM started_at AT TIME ZONE 'UTC')::int AS session_hour,
                    (started_at AT TIME ZONE 'UTC')::date::text AS session_date
                FROM sessions
                WHERE user_id = $1 AND companion_id = $2
                ORDER BY started_at DESC
                LIMIT 200
                """,
                user_id,
                companion_id,
            )

            if rows:
                stats = InteractionStats(
                    total_sessions=stats.total_sessions,
                    first_session_at=stats.first_session_at,
                    last_session_ended_at=stats.last_session_ended_at,
                    avg_session_duration_minutes=stats.avg_session_duration_minutes,
                    session_hours=[r["session_hour"] for r in rows],
                    session_dates=[r["session_date"] for r in rows],
                    cached_at=time.time(),
                )

            self._set_cached_stats(user_id, companion_id, stats)

        except Exception as e:
            logger.warning(
                "temporal_stats_query_failed",
                error=str(e),
                user_id=str(user_id),
                companion_id=str(companion_id),
            )

        return stats

    async def build_temporal_context(
        self,
        user_id: UUID,
        companion_id: UUID,
        user_timezone: str | None = None,
    ) -> TemporalContext:
        """Build the full temporal context for an interaction.

        Args:
            user_id: The user's UUID.
            companion_id: The companion's UUID.
            user_timezone: IANA timezone string, or None for UTC.

        Returns:
            TemporalContext with all temporal features computed.
        """
        now_utc = datetime.now(timezone.utc)
        tz = resolve_timezone(user_timezone)
        user_local = now_utc.astimezone(tz)

        time_of_day = classify_time_of_day(user_local.hour)
        day_of_week = user_local.strftime("%A")
        is_weekend = user_local.weekday() >= 5

        # Fetch interaction stats
        stats = await self.get_interaction_stats(user_id, companion_id)

        # Time since last interaction
        time_since: timedelta | None = None
        if stats.last_session_ended_at is not None:
            last_ended = stats.last_session_ended_at
            if last_ended.tzinfo is None:
                last_ended = last_ended.replace(tzinfo=timezone.utc)
            time_since = now_utc - last_ended

        # Detect patterns
        typical_hours = detect_typical_hours(stats.session_hours)
        is_unusual = bool(
            typical_hours and user_local.hour not in typical_hours
        )

        # Streak and absence
        today_str = user_local.date().isoformat()
        streak = compute_streak_days(stats.session_dates, today_str)
        longest_absence = compute_longest_absence(stats.session_dates)

        # Days since first interaction
        days_since_first = 0
        if stats.first_session_at is not None:
            first_at = stats.first_session_at
            if first_at.tzinfo is None:
                first_at = first_at.replace(tzinfo=timezone.utc)
            days_since_first = (now_utc - first_at).days

        # Check milestones
        is_anniversary, is_milestone, milestone_desc = check_milestones(
            total_sessions=stats.total_sessions,
            days_since_first=days_since_first,
        )

        return TemporalContext(
            current_time_utc=now_utc,
            user_local_time=user_local,
            user_timezone=user_timezone or DEFAULT_TIMEZONE,
            time_of_day=time_of_day,
            day_of_week=day_of_week,
            is_weekend=is_weekend,
            time_since_last_interaction=time_since,
            time_since_last_interaction_human=format_time_since(time_since),
            last_session_ended_at=stats.last_session_ended_at,
            total_sessions=stats.total_sessions,
            avg_session_duration_minutes=stats.avg_session_duration_minutes,
            typical_active_hours=typical_hours,
            is_unusual_time=is_unusual,
            streak_days=streak,
            longest_absence_days=longest_absence,
            days_since_first_interaction=days_since_first,
            is_anniversary=is_anniversary,
            is_milestone=is_milestone,
            milestone_description=milestone_desc,
        )


def format_temporal_prompt_section(
    ctx: TemporalContext,
    user_name: str | None = None,
) -> str:
    """Format temporal context into a prompt section for the system prompt.

    Args:
        ctx: The computed temporal context.
        user_name: Optional display name for the user.

    Returns:
        Formatted string ready for injection into the system prompt.
    """
    name = user_name or "the user"

    # Time of day description
    tod_descriptions = {
        TimeOfDay.EARLY_MORNING: "early morning",
        TimeOfDay.MORNING: "morning",
        TimeOfDay.AFTERNOON: "afternoon",
        TimeOfDay.EVENING: "evening",
        TimeOfDay.LATE_NIGHT: "late night",
    }
    tod_desc = tod_descriptions[ctx.time_of_day]

    local_time_str = ctx.user_local_time.strftime("%I:%M %p").lstrip("0")

    lines = [
        "<temporal_context>",
        "Current context:",
        f"- It is {tod_desc} for {name} ({local_time_str}, {ctx.day_of_week})",
    ]

    # Time since last interaction
    if ctx.time_since_last_interaction is not None:
        lines.append(f"- Last conversation was {ctx.time_since_last_interaction_human}")
    else:
        lines.append("- This is your first conversation with this user")

    # Pattern note
    if ctx.is_unusual_time:
        lines.append(f"- This is an unusual time for {name} to be chatting")

    # Streak
    if ctx.streak_days >= 3:
        lines.append(
            f"- {name} has chatted with you {ctx.streak_days} days in a row"
        )

    # Weekend note
    if ctx.is_weekend:
        lines.append(f"- It's the weekend for {name}")

    # Milestone
    if ctx.milestone_description:
        lines.append(f"- Milestone: {ctx.milestone_description}")

    lines.append("")
    lines.append(
        "Use this temporal awareness naturally:\n"
        "- Greet appropriately for time of day on first message of a session\n"
        "- Acknowledge time gaps naturally (\"It's been a while!\" or \"Back so soon!\")\n"
        "- Note if the user is chatting at an unusual hour (\"Burning the midnight oil?\")\n"
        "- Don't over-reference time - use it naturally, not in every message"
    )
    lines.append("</temporal_context>")

    return "\n".join(lines)
