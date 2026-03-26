"""Tests for the proactive outreach service."""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from orchestrator.models.proactive import (
    OutreachConfig,
    OutreachContext,
    OutreachDecision,
    OutreachTrigger,
)
from orchestrator.services.proactive import (
    ProactiveOutreachService,
    _format_time_since,
    _get_user_local_time,
    NO_OUTREACH_SENTINEL,
)


@pytest.fixture
def settings():
    """Create a mock settings object."""
    s = MagicMock()
    s.gateway_internal_url = "http://localhost:3002"
    s.internal_service_key = "test-key"
    return s


@pytest.fixture
def prompt_manager():
    """Create a mock prompt manager."""
    pm = MagicMock()
    pm.get_prompt.return_value = "Test prompt for outreach"
    return pm


@pytest.fixture
def llm_provider():
    """Create a mock LLM provider."""
    provider = AsyncMock()
    response = MagicMock()
    response.content = "Hey, just thinking about what you said about hiking yesterday!"
    provider.generate.return_value = response
    return provider


@pytest.fixture
def service(settings, prompt_manager, llm_provider):
    """Create a ProactiveOutreachService instance."""
    return ProactiveOutreachService(
        settings=settings,
        prompt_manager=prompt_manager,
        llm_provider=llm_provider,
    )


class TestFormatTimeSince:
    """Tests for the _format_time_since helper."""

    def test_minutes_ago(self):
        now = datetime.now(timezone.utc)
        ten_min_ago = (now - timedelta(minutes=10)).isoformat()
        result = _format_time_since(ten_min_ago)
        assert "minute" in result

    def test_hours_ago(self):
        now = datetime.now(timezone.utc)
        three_hours_ago = (now - timedelta(hours=3)).isoformat()
        result = _format_time_since(three_hours_ago)
        assert "hour" in result

    def test_days_ago(self):
        now = datetime.now(timezone.utc)
        five_days_ago = (now - timedelta(days=5)).isoformat()
        result = _format_time_since(five_days_ago)
        assert "5 days" == result

    def test_one_day_ago(self):
        now = datetime.now(timezone.utc)
        one_day_ago = (now - timedelta(days=1)).isoformat()
        result = _format_time_since(one_day_ago)
        assert "1 day" == result

    def test_months_ago(self):
        now = datetime.now(timezone.utc)
        sixty_days_ago = (now - timedelta(days=60)).isoformat()
        result = _format_time_since(sixty_days_ago)
        assert "month" in result

    def test_invalid_timestamp(self):
        result = _format_time_since("not-a-date")
        assert result == "some time"


class TestGetUserLocalTime:
    """Tests for the _get_user_local_time helper."""

    def test_utc(self):
        result = _get_user_local_time("UTC")
        assert "UTC" not in result or "," in result  # Should be a formatted time

    def test_invalid_timezone(self):
        result = _get_user_local_time("Invalid/Zone")
        assert "UTC" in result  # Falls back to UTC

    def test_valid_timezone(self):
        result = _get_user_local_time("America/New_York")
        assert "," in result  # e.g., "Monday, 03:00 PM"


class TestGenerateMessage:
    """Tests for LLM message generation."""

    @pytest.mark.asyncio
    async def test_generates_message(self, service, llm_provider):
        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
            time_since_last_chat="2 days",
            user_local_time="Monday, 3:00 PM",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result is not None
        assert "hiking" in result
        llm_provider.generate.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_outreach_sentinel(self, service, llm_provider):
        """LLM can decline to send outreach."""
        response = MagicMock()
        response.content = NO_OUTREACH_SENTINEL
        llm_provider.generate.return_value = response

        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_strips_quotes(self, service, llm_provider):
        response = MagicMock()
        response.content = '"Hey, how have you been?"'
        llm_provider.generate.return_value = response

        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result == "Hey, how have you been?"

    @pytest.mark.asyncio
    async def test_llm_error_returns_none(self, service, llm_provider):
        llm_provider.generate.side_effect = Exception("LLM unavailable")

        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_no_llm_provider(self, settings, prompt_manager):
        """Service without LLM provider returns None."""
        service = ProactiveOutreachService(
            settings=settings,
            prompt_manager=prompt_manager,
            llm_provider=None,
        )

        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_followup_uses_followup_template(self, service, prompt_manager):
        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        await service._generate_message(context, OutreachTrigger.FOLLOWUP)

        # Should use the followup template
        prompt_manager.get_prompt.assert_called_once()
        call_args = prompt_manager.get_prompt.call_args
        assert call_args[0][0] == "proactive_followup"

    @pytest.mark.asyncio
    async def test_missing_template_returns_none(self, service, prompt_manager):
        prompt_manager.get_prompt.side_effect = KeyError("template not found")

        context = OutreachContext(
            user_id="00000000-0000-0000-0000-000000000001",
            companion_id="00000000-0000-0000-0000-000000000002",
            companion_name="Luna",
            user_name="Alex",
        )

        result = await service._generate_message(
            context, OutreachTrigger.SCHEDULED_CHECKIN
        )

        assert result is None


class TestOutreachConfig:
    """Tests for outreach config defaults."""

    def test_default_config(self):
        config = OutreachConfig()
        assert config.enabled is True
        assert config.min_interval_hours == 24
        assert config.max_daily == 1
        assert config.quiet_hours_start == 22
        assert config.quiet_hours_end == 8
        assert OutreachTrigger.SCHEDULED_CHECKIN in config.triggers_enabled

    def test_custom_config(self):
        config = OutreachConfig(
            enabled=False,
            min_interval_hours=12,
            max_daily=3,
            quiet_hours_start=23,
            quiet_hours_end=7,
            triggers_enabled=[OutreachTrigger.FOLLOWUP],
        )
        assert config.enabled is False
        assert config.min_interval_hours == 12
        assert config.max_daily == 3
        assert config.triggers_enabled == [OutreachTrigger.FOLLOWUP]


class TestOutreachDecision:
    """Tests for outreach decision models."""

    def test_positive_decision(self):
        decision = OutreachDecision(
            should_reach_out=True,
            trigger=OutreachTrigger.SCHEDULED_CHECKIN,
            message="Hey, how are you?",
            confidence=0.85,
            reasoning="Regular check-in approved",
        )
        assert decision.should_reach_out is True
        assert decision.message == "Hey, how are you?"

    def test_negative_decision(self):
        decision = OutreachDecision(
            should_reach_out=False,
            trigger=OutreachTrigger.SCHEDULED_CHECKIN,
            confidence=1.0,
            reasoning="Too soon since last outreach",
        )
        assert decision.should_reach_out is False
        assert decision.message is None

    def test_confidence_bounds(self):
        with pytest.raises(Exception):
            OutreachDecision(
                should_reach_out=True,
                trigger=OutreachTrigger.SCHEDULED_CHECKIN,
                confidence=1.5,  # Out of bounds
                reasoning="test",
            )


class TestDetermineTrigger:
    """Tests for trigger determination."""

    @pytest.mark.asyncio
    async def test_default_trigger(self, service):
        config = OutreachConfig()
        trigger = await service._determine_trigger(
            "user1", "companion1", config
        )
        # With no unfinished topics, should default to scheduled_checkin
        assert trigger == OutreachTrigger.SCHEDULED_CHECKIN

    @pytest.mark.asyncio
    async def test_only_time_based_enabled(self, service):
        config = OutreachConfig(
            triggers_enabled=[OutreachTrigger.TIME_BASED]
        )
        trigger = await service._determine_trigger(
            "user1", "companion1", config
        )
        assert trigger == OutreachTrigger.TIME_BASED
