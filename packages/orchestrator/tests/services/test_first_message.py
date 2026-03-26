"""Tests for the first message generation service."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from orchestrator.models.conversation import CompanionSpec
from orchestrator.services.first_message import (
    FirstMessageContext,
    generate_first_message,
)


def _make_spec(
    name: str = "Luna",
    archetype: str | None = "caregiver",
    personality_traits: list[str] | None = None,
) -> CompanionSpec:
    """Build a minimal CompanionSpec for testing."""
    return CompanionSpec(
        id=uuid4(),
        name=name,
        description="A test companion",
        personality_traits=personality_traits or ["warm", "caring"],
        communication_style="warm and nurturing",
        system_prompt="You are a companion.",
        archetype=archetype,
    )


# ---------------------------------------------------------------------------
# Template-based generation
# ---------------------------------------------------------------------------


class TestTemplateGeneration:
    """Tests for template-based (zero-latency) first message generation."""

    @pytest.mark.asyncio
    async def test_default_context_returns_message(self) -> None:
        spec = _make_spec()
        msg = await generate_first_message(spec, "Alice", FirstMessageContext.DEFAULT)
        assert len(msg) > 0
        assert "Alice" in msg or spec.name in msg

    @pytest.mark.asyncio
    async def test_morning_context(self) -> None:
        spec = _make_spec()
        msg = await generate_first_message(spec, "Bob", FirstMessageContext.MORNING)
        assert len(msg) > 0

    @pytest.mark.asyncio
    async def test_late_night_context(self) -> None:
        spec = _make_spec()
        msg = await generate_first_message(spec, "Charlie", FirstMessageContext.LATE_NIGHT)
        assert len(msg) > 0

    @pytest.mark.asyncio
    async def test_returning_context(self) -> None:
        spec = _make_spec()
        msg = await generate_first_message(spec, "Dana", FirstMessageContext.RETURNING)
        assert len(msg) > 0

    @pytest.mark.asyncio
    async def test_archetype_specific_template_used(self) -> None:
        """Caregiver archetype should produce a caregiver-flavoured message."""
        spec = _make_spec(archetype="caregiver")
        msg = await generate_first_message(spec, "Eve", FirstMessageContext.DEFAULT)
        assert len(msg) > 0
        # Should contain the companion name somewhere (template variable)
        assert spec.name in msg

    @pytest.mark.asyncio
    async def test_unknown_archetype_falls_back_to_generic(self) -> None:
        spec = _make_spec(archetype="nonexistent_archetype")
        msg = await generate_first_message(spec, "Frank", FirstMessageContext.DEFAULT)
        assert len(msg) > 0

    @pytest.mark.asyncio
    async def test_no_archetype_uses_generic(self) -> None:
        spec = _make_spec(archetype=None)
        msg = await generate_first_message(spec, "Grace", FirstMessageContext.DEFAULT)
        assert len(msg) > 0


# ---------------------------------------------------------------------------
# Auto-detection of context
# ---------------------------------------------------------------------------


class TestContextAutoDetection:
    @pytest.mark.asyncio
    async def test_auto_detects_context(self) -> None:
        """When no context is given, message is still generated."""
        spec = _make_spec()
        msg = await generate_first_message(spec, "Hank")
        assert len(msg) > 0

    @pytest.mark.asyncio
    @patch("orchestrator.services.first_message._detect_context")
    async def test_morning_detection(self, mock_detect: AsyncMock) -> None:
        mock_detect.return_value = FirstMessageContext.MORNING
        spec = _make_spec()
        msg = await generate_first_message(spec, "Irene")
        assert len(msg) > 0


# ---------------------------------------------------------------------------
# LLM enhancement
# ---------------------------------------------------------------------------


class TestLLMEnhancement:
    @pytest.mark.asyncio
    async def test_llm_enhancement_used_when_available(self) -> None:
        spec = _make_spec()
        llm_mock = AsyncMock(return_value="Hey there! I'm so happy to finally meet you, Jack!")
        msg = await generate_first_message(
            spec, "Jack", FirstMessageContext.DEFAULT, llm_client=llm_mock
        )
        assert "Jack" in msg
        llm_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_llm_failure_falls_back_to_template(self) -> None:
        spec = _make_spec()
        llm_mock = AsyncMock(side_effect=RuntimeError("LLM unavailable"))
        msg = await generate_first_message(
            spec, "Karen", FirstMessageContext.DEFAULT, llm_client=llm_mock
        )
        # Should still return a valid message from the template
        assert len(msg) > 0

    @pytest.mark.asyncio
    async def test_llm_empty_response_falls_back_to_template(self) -> None:
        spec = _make_spec()
        llm_mock = AsyncMock(return_value="   ")
        msg = await generate_first_message(
            spec, "Leo", FirstMessageContext.DEFAULT, llm_client=llm_mock
        )
        assert len(msg) > 0


# ---------------------------------------------------------------------------
# Hard-coded fallback
# ---------------------------------------------------------------------------


class TestHardCodedFallback:
    @pytest.mark.asyncio
    async def test_fallback_when_no_template_and_no_llm(self) -> None:
        """Even with a missing archetype and no LLM, we get a message."""
        spec = _make_spec(archetype="zzz_does_not_exist")
        msg = await generate_first_message(
            spec, "Monica", FirstMessageContext.RETURNING
        )
        assert len(msg) > 0
        assert "Monica" in msg or spec.name in msg
