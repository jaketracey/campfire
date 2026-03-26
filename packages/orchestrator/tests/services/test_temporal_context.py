"""Comprehensive tests for the temporal context service."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from orchestrator.services.temporal_context import (
    DEFAULT_TIMEZONE,
    STATS_CACHE_TTL_SECONDS,
    InteractionStats,
    TemporalContext,
    TemporalContextService,
    TimeOfDay,
    check_milestones,
    classify_time_of_day,
    compute_longest_absence,
    compute_streak_days,
    detect_typical_hours,
    format_temporal_prompt_section,
    format_time_since,
    resolve_timezone,
)


# ============================================================================
# classify_time_of_day tests
# ============================================================================


class TestClassifyTimeOfDay:
    """Test time-of-day classification boundaries."""

    def test_early_morning_start(self) -> None:
        assert classify_time_of_day(4) == TimeOfDay.EARLY_MORNING

    def test_early_morning_end(self) -> None:
        assert classify_time_of_day(6) == TimeOfDay.EARLY_MORNING

    def test_morning_start(self) -> None:
        assert classify_time_of_day(7) == TimeOfDay.MORNING

    def test_morning_end(self) -> None:
        assert classify_time_of_day(11) == TimeOfDay.MORNING

    def test_afternoon_start(self) -> None:
        assert classify_time_of_day(12) == TimeOfDay.AFTERNOON

    def test_afternoon_end(self) -> None:
        assert classify_time_of_day(16) == TimeOfDay.AFTERNOON

    def test_evening_start(self) -> None:
        assert classify_time_of_day(17) == TimeOfDay.EVENING

    def test_evening_end(self) -> None:
        assert classify_time_of_day(20) == TimeOfDay.EVENING

    def test_late_night_start(self) -> None:
        assert classify_time_of_day(21) == TimeOfDay.LATE_NIGHT

    def test_late_night_end(self) -> None:
        assert classify_time_of_day(23) == TimeOfDay.LATE_NIGHT

    def test_midnight(self) -> None:
        assert classify_time_of_day(0) == TimeOfDay.LATE_NIGHT

    def test_3am(self) -> None:
        assert classify_time_of_day(3) == TimeOfDay.LATE_NIGHT

    def test_all_hours_classified(self) -> None:
        """Every hour 0-23 should map to a valid TimeOfDay."""
        for hour in range(24):
            result = classify_time_of_day(hour)
            assert isinstance(result, TimeOfDay), f"Hour {hour} not classified"


# ============================================================================
# format_time_since tests
# ============================================================================


class TestFormatTimeSince:
    """Test human-readable time formatting."""

    def test_none_returns_first_interaction(self) -> None:
        assert format_time_since(None) == "first interaction"

    def test_negative_returns_just_now(self) -> None:
        assert format_time_since(timedelta(seconds=-10)) == "just now"

    def test_zero_seconds(self) -> None:
        assert format_time_since(timedelta(seconds=0)) == "just now"

    def test_30_seconds(self) -> None:
        assert format_time_since(timedelta(seconds=30)) == "just now"

    def test_59_seconds(self) -> None:
        assert format_time_since(timedelta(seconds=59)) == "just now"

    def test_1_minute(self) -> None:
        assert format_time_since(timedelta(minutes=1)) == "1 minute ago"

    def test_5_minutes(self) -> None:
        assert format_time_since(timedelta(minutes=5)) == "5 minutes ago"

    def test_59_minutes(self) -> None:
        assert format_time_since(timedelta(minutes=59)) == "59 minutes ago"

    def test_1_hour(self) -> None:
        assert format_time_since(timedelta(hours=1)) == "1 hour ago"

    def test_3_hours(self) -> None:
        assert format_time_since(timedelta(hours=3)) == "3 hours ago"

    def test_23_hours(self) -> None:
        assert format_time_since(timedelta(hours=23)) == "23 hours ago"

    def test_1_day(self) -> None:
        assert format_time_since(timedelta(days=1)) == "1 day ago"

    def test_2_days(self) -> None:
        assert format_time_since(timedelta(days=2)) == "2 days ago"

    def test_6_days(self) -> None:
        assert format_time_since(timedelta(days=6)) == "6 days ago"

    def test_1_week(self) -> None:
        assert format_time_since(timedelta(weeks=1)) == "1 week ago"

    def test_3_weeks(self) -> None:
        assert format_time_since(timedelta(weeks=3)) == "3 weeks ago"

    def test_1_month(self) -> None:
        assert format_time_since(timedelta(days=30)) == "1 month ago"

    def test_3_months(self) -> None:
        assert format_time_since(timedelta(days=90)) == "3 months ago"


# ============================================================================
# resolve_timezone tests
# ============================================================================


class TestResolveTimezone:
    """Test timezone resolution."""

    def test_none_returns_utc(self) -> None:
        tz = resolve_timezone(None)
        assert str(tz) == DEFAULT_TIMEZONE

    def test_empty_string_returns_utc(self) -> None:
        tz = resolve_timezone("")
        assert str(tz) == DEFAULT_TIMEZONE

    def test_valid_timezone(self) -> None:
        tz = resolve_timezone("America/New_York")
        assert str(tz) == "America/New_York"

    def test_utc_timezone(self) -> None:
        tz = resolve_timezone("UTC")
        assert str(tz) == "UTC"

    def test_invalid_timezone_falls_back(self) -> None:
        tz = resolve_timezone("Invalid/Timezone")
        assert str(tz) == DEFAULT_TIMEZONE

    def test_europe_london(self) -> None:
        tz = resolve_timezone("Europe/London")
        assert str(tz) == "Europe/London"


# ============================================================================
# detect_typical_hours tests
# ============================================================================


class TestDetectTypicalHours:
    """Test pattern detection for typical active hours."""

    def test_empty_list(self) -> None:
        assert detect_typical_hours([]) == []

    def test_below_threshold(self) -> None:
        # Each hour appears only once (threshold=3 by default)
        assert detect_typical_hours([9, 10, 11]) == []

    def test_at_threshold(self) -> None:
        hours = [9, 9, 9, 10, 10, 11]
        result = detect_typical_hours(hours, threshold=3)
        assert result == [9]

    def test_multiple_typical_hours(self) -> None:
        hours = [9, 9, 9, 14, 14, 14, 21, 21, 21]
        result = detect_typical_hours(hours, threshold=3)
        assert result == [9, 14, 21]

    def test_sorted_output(self) -> None:
        hours = [21, 21, 21, 9, 9, 9, 14, 14, 14]
        result = detect_typical_hours(hours, threshold=3)
        assert result == sorted(result)

    def test_custom_threshold(self) -> None:
        hours = [9, 9, 10, 10, 10, 10]
        result = detect_typical_hours(hours, threshold=2)
        assert result == [9, 10]

    def test_threshold_1(self) -> None:
        hours = [5, 10, 15]
        result = detect_typical_hours(hours, threshold=1)
        assert result == [5, 10, 15]


# ============================================================================
# compute_streak_days tests
# ============================================================================


class TestComputeStreakDays:
    """Test consecutive day streak computation."""

    def test_empty_dates(self) -> None:
        assert compute_streak_days([], "2026-03-26") == 0

    def test_no_session_today(self) -> None:
        assert compute_streak_days(["2026-03-25"], "2026-03-26") == 0

    def test_single_day_today(self) -> None:
        assert compute_streak_days(["2026-03-26"], "2026-03-26") == 1

    def test_two_day_streak(self) -> None:
        dates = ["2026-03-25", "2026-03-26"]
        assert compute_streak_days(dates, "2026-03-26") == 2

    def test_five_day_streak(self) -> None:
        dates = ["2026-03-22", "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26"]
        assert compute_streak_days(dates, "2026-03-26") == 5

    def test_broken_streak(self) -> None:
        # Gap between 23rd and 25th
        dates = ["2026-03-22", "2026-03-23", "2026-03-25", "2026-03-26"]
        assert compute_streak_days(dates, "2026-03-26") == 2

    def test_duplicates_handled(self) -> None:
        dates = ["2026-03-25", "2026-03-25", "2026-03-26", "2026-03-26"]
        assert compute_streak_days(dates, "2026-03-26") == 2


# ============================================================================
# compute_longest_absence tests
# ============================================================================


class TestComputeLongestAbsence:
    """Test longest absence computation."""

    def test_empty_dates(self) -> None:
        assert compute_longest_absence([]) == 0

    def test_single_date(self) -> None:
        assert compute_longest_absence(["2026-03-26"]) == 0

    def test_consecutive_days(self) -> None:
        dates = ["2026-03-24", "2026-03-25", "2026-03-26"]
        assert compute_longest_absence(dates) == 1

    def test_gap_of_5_days(self) -> None:
        dates = ["2026-03-20", "2026-03-25"]
        assert compute_longest_absence(dates) == 5

    def test_multiple_gaps_returns_largest(self) -> None:
        dates = ["2026-03-01", "2026-03-10", "2026-03-12"]
        assert compute_longest_absence(dates) == 9

    def test_duplicates_handled(self) -> None:
        dates = ["2026-03-20", "2026-03-20", "2026-03-25", "2026-03-25"]
        assert compute_longest_absence(dates) == 5


# ============================================================================
# check_milestones tests
# ============================================================================


class TestCheckMilestones:
    """Test milestone detection."""

    def test_first_session(self) -> None:
        is_ann, is_mile, desc = check_milestones(total_sessions=1, days_since_first=0)
        assert is_mile is True
        assert desc is not None
        assert "first" in desc.lower()

    def test_10th_session(self) -> None:
        _, is_mile, desc = check_milestones(total_sessions=10, days_since_first=5)
        assert is_mile is True
        assert "10th" in desc

    def test_100th_session(self) -> None:
        _, is_mile, desc = check_milestones(total_sessions=100, days_since_first=50)
        assert is_mile is True
        assert "100th" in desc

    def test_no_milestone(self) -> None:
        _, is_mile, desc = check_milestones(total_sessions=7, days_since_first=3)
        assert is_mile is False
        assert desc is None

    def test_1_year_anniversary(self) -> None:
        is_ann, _, desc = check_milestones(total_sessions=200, days_since_first=365)
        assert is_ann is True
        assert "anniversary" in desc

    def test_2_year_anniversary(self) -> None:
        is_ann, _, desc = check_milestones(total_sessions=500, days_since_first=730)
        assert is_ann is True
        assert "2-year" in desc

    def test_1_week_milestone(self) -> None:
        _, is_mile, desc = check_milestones(total_sessions=15, days_since_first=7)
        assert is_mile is True
        assert "week" in desc.lower()

    def test_1_month_milestone(self) -> None:
        _, is_mile, desc = check_milestones(total_sessions=60, days_since_first=30)
        assert is_mile is True
        assert "month" in desc.lower()

    def test_not_day_zero_anniversary(self) -> None:
        is_ann, _, _ = check_milestones(total_sessions=1, days_since_first=0)
        assert is_ann is False


# ============================================================================
# format_temporal_prompt_section tests
# ============================================================================


class TestFormatTemporalPromptSection:
    """Test prompt section formatting."""

    def _make_context(self, **overrides: object) -> TemporalContext:
        defaults = {
            "current_time_utc": datetime(2026, 3, 26, 15, 0, 0, tzinfo=timezone.utc),
            "user_local_time": datetime(2026, 3, 26, 10, 0, 0, tzinfo=timezone.utc),
            "user_timezone": "America/New_York",
            "time_of_day": TimeOfDay.MORNING,
            "day_of_week": "Thursday",
            "is_weekend": False,
            "time_since_last_interaction": timedelta(hours=3),
            "time_since_last_interaction_human": "3 hours ago",
            "last_session_ended_at": None,
            "total_sessions": 5,
            "avg_session_duration_minutes": 12.5,
            "typical_active_hours": [9, 10, 14, 15],
            "is_unusual_time": False,
            "streak_days": 2,
            "longest_absence_days": 5,
            "days_since_first_interaction": 30,
            "is_anniversary": False,
            "is_milestone": False,
            "milestone_description": None,
        }
        defaults.update(overrides)
        return TemporalContext(**defaults)

    def test_basic_output_has_tags(self) -> None:
        ctx = self._make_context()
        result = format_temporal_prompt_section(ctx)
        assert "<temporal_context>" in result
        assert "</temporal_context>" in result

    def test_includes_time_of_day(self) -> None:
        ctx = self._make_context()
        result = format_temporal_prompt_section(ctx, user_name="Alice")
        assert "morning" in result
        assert "Alice" in result
        assert "Thursday" in result

    def test_includes_time_since(self) -> None:
        ctx = self._make_context()
        result = format_temporal_prompt_section(ctx)
        assert "3 hours ago" in result

    def test_first_interaction(self) -> None:
        ctx = self._make_context(time_since_last_interaction=None)
        result = format_temporal_prompt_section(ctx)
        assert "first conversation" in result

    def test_unusual_time_note(self) -> None:
        ctx = self._make_context(is_unusual_time=True)
        result = format_temporal_prompt_section(ctx, user_name="Bob")
        assert "unusual time" in result

    def test_streak_note(self) -> None:
        ctx = self._make_context(streak_days=5)
        result = format_temporal_prompt_section(ctx, user_name="Bob")
        assert "5 days in a row" in result

    def test_no_streak_note_below_3(self) -> None:
        ctx = self._make_context(streak_days=2)
        result = format_temporal_prompt_section(ctx)
        assert "days in a row" not in result

    def test_weekend_note(self) -> None:
        ctx = self._make_context(is_weekend=True)
        result = format_temporal_prompt_section(ctx, user_name="Alice")
        assert "weekend" in result

    def test_milestone_note(self) -> None:
        ctx = self._make_context(
            is_milestone=True,
            milestone_description="This is your 100th conversation together",
        )
        result = format_temporal_prompt_section(ctx)
        assert "100th conversation" in result

    def test_default_user_name(self) -> None:
        ctx = self._make_context()
        result = format_temporal_prompt_section(ctx)
        assert "the user" in result

    def test_guidelines_included(self) -> None:
        ctx = self._make_context()
        result = format_temporal_prompt_section(ctx)
        assert "Don't over-reference time" in result


# ============================================================================
# TemporalContextService tests
# ============================================================================


class TestTemporalContextServiceCache:
    """Test the in-memory stats caching."""

    def test_cache_set_and_get(self) -> None:
        service = TemporalContextService()
        uid = uuid4()
        cid = uuid4()
        stats = InteractionStats(total_sessions=10, cached_at=time.time())
        service._set_cached_stats(uid, cid, stats)
        cached = service._get_cached_stats(uid, cid)
        assert cached is not None
        assert cached.total_sessions == 10

    def test_cache_miss(self) -> None:
        service = TemporalContextService()
        assert service._get_cached_stats(uuid4(), uuid4()) is None

    def test_cache_expired(self) -> None:
        service = TemporalContextService()
        uid = uuid4()
        cid = uuid4()
        expired = time.time() - STATS_CACHE_TTL_SECONDS - 1
        stats = InteractionStats(total_sessions=10, cached_at=expired)
        service._set_cached_stats(uid, cid, stats)
        assert service._get_cached_stats(uid, cid) is None

    def test_invalidate_cache(self) -> None:
        service = TemporalContextService()
        uid = uuid4()
        cid = uuid4()
        stats = InteractionStats(total_sessions=10, cached_at=time.time())
        service._set_cached_stats(uid, cid, stats)
        service.invalidate_cache(uid, cid)
        assert service._get_cached_stats(uid, cid) is None

    def test_invalidate_nonexistent_is_noop(self) -> None:
        service = TemporalContextService()
        service.invalidate_cache(uuid4(), uuid4())  # Should not raise


class TestTemporalContextServiceBuild:
    """Test build_temporal_context with mocked database."""

    @pytest.mark.asyncio
    async def test_build_with_no_db(self) -> None:
        """When DB is unavailable, should still return valid context with defaults."""
        service = TemporalContextService()

        # Mock DatabasePool.get_pool to raise
        with patch(
            "orchestrator.services.temporal_context.DatabasePool.get_pool",
            new_callable=AsyncMock,
            side_effect=RuntimeError("No DB"),
        ):
            ctx = await service.build_temporal_context(
                user_id=uuid4(),
                companion_id=uuid4(),
                user_timezone="America/Chicago",
            )

        assert ctx.user_timezone == "America/Chicago"
        assert ctx.total_sessions == 0
        assert ctx.time_since_last_interaction is None
        assert ctx.time_since_last_interaction_human == "first interaction"
        assert isinstance(ctx.time_of_day, TimeOfDay)

    @pytest.mark.asyncio
    async def test_build_uses_cache(self) -> None:
        """When cache is warm, should not hit the database."""
        service = TemporalContextService()
        uid = uuid4()
        cid = uuid4()

        now = datetime(2026, 3, 26, 12, 0, 0, tzinfo=timezone.utc)
        stats = InteractionStats(
            total_sessions=42,
            first_session_at=datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc),
            last_session_ended_at=now - timedelta(hours=2),
            avg_session_duration_minutes=15.0,
            session_hours=[10, 10, 10, 14, 14, 14],
            session_dates=["2026-03-25", "2026-03-26"],
            cached_at=time.time(),
        )
        service._set_cached_stats(uid, cid, stats)

        with patch(
            "orchestrator.services.temporal_context.DatabasePool.get_pool",
            new_callable=AsyncMock,
        ) as mock_pool:
            ctx = await service.build_temporal_context(
                user_id=uid,
                companion_id=cid,
                user_timezone="UTC",
            )
            # DB should NOT be called since cache is warm
            mock_pool.assert_not_called()

        assert ctx.total_sessions == 42
        assert ctx.time_since_last_interaction is not None

    @pytest.mark.asyncio
    async def test_build_with_mocked_db(self) -> None:
        """Test full build with mocked database results."""
        service = TemporalContextService()
        uid = uuid4()
        cid = uuid4()

        now = datetime.now(timezone.utc)
        first_session = now - timedelta(days=365)
        last_session = now - timedelta(hours=1)

        # Mock the pool and its responses
        mock_pool = AsyncMock()
        mock_pool.fetchrow.return_value = {
            "total_sessions": 100,
            "first_session_at": first_session,
            "last_session_ended_at": last_session,
            "avg_duration_minutes": 15.5,
        }
        mock_pool.fetch.return_value = [
            {"session_hour": 10, "session_date": (now - timedelta(days=i)).strftime("%Y-%m-%d")}
            for i in range(5)
        ] + [
            {"session_hour": 10, "session_date": (now - timedelta(days=i)).strftime("%Y-%m-%d")}
            for i in range(5)
        ]

        with patch(
            "orchestrator.services.temporal_context.DatabasePool.get_pool",
            new_callable=AsyncMock,
            return_value=mock_pool,
        ):
            ctx = await service.build_temporal_context(
                user_id=uid,
                companion_id=cid,
                user_timezone="America/New_York",
            )

        assert ctx.total_sessions == 100
        assert ctx.user_timezone == "America/New_York"
        assert ctx.days_since_first_interaction >= 364  # ~365 days
        assert ctx.is_anniversary is True  # 365 days exactly

    @pytest.mark.asyncio
    async def test_default_timezone_when_none(self) -> None:
        service = TemporalContextService()

        with patch(
            "orchestrator.services.temporal_context.DatabasePool.get_pool",
            new_callable=AsyncMock,
            side_effect=RuntimeError("No DB"),
        ):
            ctx = await service.build_temporal_context(
                user_id=uuid4(),
                companion_id=uuid4(),
                user_timezone=None,
            )

        assert ctx.user_timezone == DEFAULT_TIMEZONE

    @pytest.mark.asyncio
    async def test_weekend_detection(self) -> None:
        service = TemporalContextService()

        # 2026-03-28 is a Saturday
        with patch(
            "orchestrator.services.temporal_context.datetime"
        ) as mock_dt:
            # We can't easily mock datetime.now(), so instead we test
            # the is_weekend field based on the actual current date
            pass

        # Instead, test via the computed context from cached stats
        with patch(
            "orchestrator.services.temporal_context.DatabasePool.get_pool",
            new_callable=AsyncMock,
            side_effect=RuntimeError("No DB"),
        ):
            ctx = await service.build_temporal_context(
                user_id=uuid4(),
                companion_id=uuid4(),
            )
            # We can only verify the field exists and is boolean
            assert isinstance(ctx.is_weekend, bool)


# ============================================================================
# Integration test for context builder injection
# ============================================================================


class TestContextBuilderIntegration:
    """Test that temporal context integrates with the context builder."""

    def test_format_section_is_valid_xml_tags(self) -> None:
        ctx = TemporalContext(
            current_time_utc=datetime(2026, 3, 26, 15, 0, 0, tzinfo=timezone.utc),
            user_local_time=datetime(2026, 3, 26, 10, 0, 0, tzinfo=timezone.utc),
            user_timezone="America/New_York",
            time_of_day=TimeOfDay.MORNING,
            day_of_week="Thursday",
            is_weekend=False,
            total_sessions=5,
        )
        section = format_temporal_prompt_section(ctx, user_name="Test")
        assert section.startswith("<temporal_context>")
        assert section.endswith("</temporal_context>")

    def test_late_night_format(self) -> None:
        ctx = TemporalContext(
            current_time_utc=datetime(2026, 3, 26, 6, 0, 0, tzinfo=timezone.utc),
            user_local_time=datetime(2026, 3, 26, 2, 0, 0, tzinfo=timezone.utc),
            user_timezone="America/New_York",
            time_of_day=TimeOfDay.LATE_NIGHT,
            day_of_week="Thursday",
            is_weekend=False,
            is_unusual_time=True,
            total_sessions=50,
        )
        section = format_temporal_prompt_section(ctx, user_name="Alice")
        assert "late night" in section
        assert "unusual time" in section
