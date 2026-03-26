"""Proactive outreach service.

Evaluates whether a companion should proactively reach out to a user
and generates natural check-in messages using the LLM.
"""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import structlog

from orchestrator.config import Settings
from orchestrator.models.proactive import (
    DeliveryChannel,
    EvaluateOutreachRequest,
    GenerateOutreachRequest,
    OutreachConfig,
    OutreachContext,
    OutreachDecision,
    OutreachRecord,
    OutreachTrigger,
)
from orchestrator.prompts.manager import PromptManager
from orchestrator.providers.base import LLMProvider

logger = structlog.get_logger()

# Sentinel the LLM returns when it decides not to reach out
NO_OUTREACH_SENTINEL = "NO_OUTREACH"

# Default outreach config used when none is stored
DEFAULT_OUTREACH_CONFIG = OutreachConfig()


class ProactiveOutreachService:
    """Service for evaluating and generating proactive outreach messages."""

    def __init__(
        self,
        settings: Settings,
        prompt_manager: PromptManager,
        llm_provider: LLMProvider | None = None,
        gateway_url: str | None = None,
        internal_service_key: str | None = None,
    ):
        self.settings = settings
        self.prompt_manager = prompt_manager
        self.llm_provider = llm_provider
        self.gateway_url = gateway_url or settings.gateway_internal_url
        self.internal_service_key = internal_service_key or settings.internal_service_key

    async def evaluate_outreach(
        self,
        user_id: str,
        companion_id: str,
    ) -> OutreachDecision:
        """Evaluate whether a companion should reach out to a user.

        Checks eligibility rules, gathers context, then asks the LLM
        to generate a message (or decide not to).
        """
        log = logger.bind(user_id=user_id, companion_id=companion_id)

        # 1. Fetch outreach config for this companion
        config = await self._get_outreach_config(companion_id)
        if not config.enabled:
            log.debug("outreach_disabled")
            return OutreachDecision(
                should_reach_out=False,
                trigger=OutreachTrigger.SCHEDULED_CHECKIN,
                confidence=1.0,
                reasoning="Outreach disabled for this companion",
            )

        # 2. Check eligibility rules
        eligible, reason = await self._check_eligibility(
            user_id, companion_id, config
        )
        if not eligible:
            log.debug("outreach_ineligible", reason=reason)
            return OutreachDecision(
                should_reach_out=False,
                trigger=OutreachTrigger.SCHEDULED_CHECKIN,
                confidence=1.0,
                reasoning=reason,
            )

        # 3. Determine trigger type
        trigger = await self._determine_trigger(user_id, companion_id, config)

        # 4. Gather context for the LLM
        context = await self._gather_context(user_id, companion_id)

        # 5. Generate message via LLM
        message = await self._generate_message(context, trigger)

        if message is None:
            log.info("outreach_llm_declined", trigger=trigger.value)
            return OutreachDecision(
                should_reach_out=False,
                trigger=trigger,
                confidence=0.7,
                reasoning="LLM decided not to reach out (NO_OUTREACH)",
            )

        log.info("outreach_approved", trigger=trigger.value)
        return OutreachDecision(
            should_reach_out=True,
            trigger=trigger,
            message=message,
            confidence=0.85,
            reasoning=f"Outreach approved via {trigger.value}",
        )

    async def generate_outreach_message(
        self,
        context: OutreachContext,
        trigger: OutreachTrigger,
    ) -> str | None:
        """Generate an outreach message from pre-gathered context.

        Returns None if the LLM decides not to reach out.
        """
        return await self._generate_message(context, trigger)

    # ---- Internal helpers ----

    async def _get_outreach_config(self, companion_id: str) -> OutreachConfig:
        """Fetch outreach config for a companion from the gateway."""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.gateway_url}/api/v1/outreach/config/{companion_id}",
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return OutreachConfig(**data.get("config", {}))
        except Exception as e:
            logger.warning("outreach_config_fetch_failed", error=str(e))

        return DEFAULT_OUTREACH_CONFIG

    async def _check_eligibility(
        self,
        user_id: str,
        companion_id: str,
        config: OutreachConfig,
    ) -> tuple[bool, str]:
        """Check whether this user-companion pair is eligible for outreach."""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10.0) as client:
                # Check interaction history and recent outreach
                resp = await client.get(
                    f"{self.gateway_url}/api/v1/outreach/eligibility",
                    params={
                        "userId": user_id,
                        "companionId": companion_id,
                        "minIntervalHours": config.min_interval_hours,
                        "maxDaily": config.max_daily,
                    },
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if not data.get("eligible", False):
                        return False, data.get("reason", "Ineligible")
                    return True, ""
                else:
                    # If endpoint is not available, use conservative defaults
                    logger.warning(
                        "eligibility_check_failed",
                        status=resp.status_code,
                    )
                    return False, "Eligibility check unavailable"
        except Exception as e:
            logger.warning("eligibility_check_error", error=str(e))
            return False, f"Eligibility check error: {e}"

    async def _determine_trigger(
        self,
        user_id: str,
        companion_id: str,
        config: OutreachConfig,
    ) -> OutreachTrigger:
        """Determine which trigger type applies for this outreach."""
        enabled = set(config.triggers_enabled)

        # Try to detect followup opportunities first
        if OutreachTrigger.FOLLOWUP in enabled:
            has_unfinished = await self._has_unfinished_topics(user_id, companion_id)
            if has_unfinished:
                return OutreachTrigger.FOLLOWUP

        # Default to scheduled check-in
        if OutreachTrigger.SCHEDULED_CHECKIN in enabled:
            return OutreachTrigger.SCHEDULED_CHECKIN

        # Fallback to time-based
        if OutreachTrigger.TIME_BASED in enabled:
            return OutreachTrigger.TIME_BASED

        return OutreachTrigger.SCHEDULED_CHECKIN

    async def _has_unfinished_topics(
        self, user_id: str, companion_id: str
    ) -> bool:
        """Check if there are unfinished topics from the last conversation."""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.gateway_url}/api/v1/sessions",
                    params={
                        "userId": user_id,
                        "companionId": companion_id,
                        "limit": "1",
                    },
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    sessions = data.get("sessions", [])
                    if sessions:
                        summary = sessions[0].get("summary", "")
                        # Simple heuristic: check for unfinished markers
                        unfinished_markers = [
                            "promised to",
                            "will follow up",
                            "next time",
                            "to be continued",
                            "unfinished",
                            "wants to discuss",
                        ]
                        return any(
                            marker in summary.lower()
                            for marker in unfinished_markers
                        )
        except Exception as e:
            logger.debug("unfinished_topics_check_failed", error=str(e))

        return False

    async def _gather_context(
        self,
        user_id: str,
        companion_id: str,
    ) -> OutreachContext:
        """Gather all context needed for outreach message generation."""
        context = OutreachContext(
            user_id=UUID(user_id),
            companion_id=UUID(companion_id),
            companion_name="Companion",
            user_name="User",
        )

        try:
            import httpx

            async with httpx.AsyncClient(timeout=15.0) as client:
                # Fetch companion info
                companion_resp = await client.get(
                    f"{self.gateway_url}/api/v1/companions/{companion_id}",
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if companion_resp.status_code == 200:
                    companion = companion_resp.json()
                    context.companion_name = companion.get("name", "Companion")

                # Fetch user info
                user_resp = await client.get(
                    f"{self.gateway_url}/api/v1/users/{user_id}",
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if user_resp.status_code == 200:
                    user = user_resp.json()
                    context.user_name = user.get("displayName", user.get("name", "User"))
                    context.user_timezone = user.get("timezone", "UTC")

                # Fetch last session summary
                sessions_resp = await client.get(
                    f"{self.gateway_url}/api/v1/sessions",
                    params={
                        "userId": user_id,
                        "companionId": companion_id,
                        "limit": "1",
                    },
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if sessions_resp.status_code == 200:
                    data = sessions_resp.json()
                    sessions = data.get("sessions", [])
                    if sessions:
                        last = sessions[0]
                        context.last_session_summary = last.get("summary", "")
                        last_at = last.get("updatedAt") or last.get("createdAt")
                        if last_at:
                            context.time_since_last_chat = _format_time_since(last_at)

                # Fetch recent memories
                memories_resp = await client.get(
                    f"{self.gateway_url}/api/v1/memories",
                    params={
                        "userId": user_id,
                        "companionId": companion_id,
                        "limit": "10",
                        "sort": "importance",
                    },
                    headers={"x-internal-service-key": self.internal_service_key},
                )
                if memories_resp.status_code == 200:
                    data = memories_resp.json()
                    memories = data.get("memories", [])
                    if memories:
                        memory_texts = [
                            m.get("content", "") for m in memories[:5]
                        ]
                        context.recent_memories = "\n".join(
                            f"- {m}" for m in memory_texts if m
                        )

                # Calculate user local time
                context.user_local_time = _get_user_local_time(context.user_timezone)

        except Exception as e:
            logger.warning("context_gathering_failed", error=str(e))

        return context

    async def _generate_message(
        self,
        context: OutreachContext,
        trigger: OutreachTrigger,
    ) -> str | None:
        """Use the LLM to generate an outreach message, or None if declined."""
        # Select the right prompt template
        template_name = (
            "proactive_followup"
            if trigger == OutreachTrigger.FOLLOWUP
            else "proactive_outreach"
        )

        try:
            prompt = self.prompt_manager.get_prompt(
                template_name,
                companion_name=context.companion_name,
                user_name=context.user_name,
                relationship_stage=context.relationship_stage,
                time_since_last_chat=context.time_since_last_chat or "unknown",
                last_session_summary=context.last_session_summary or "No previous session summary available.",
                recent_memories=context.recent_memories or "No specific memories to reference.",
                user_local_time=context.user_local_time or "unknown",
            )
        except KeyError:
            logger.error("proactive_prompt_not_found", template=template_name)
            return None

        if self.llm_provider is None:
            logger.warning("no_llm_provider_for_proactive")
            return None

        try:
            response = await self.llm_provider.generate(
                messages=[
                    {"role": "user", "content": prompt},
                ],
                max_tokens=300,
                temperature=0.8,
            )

            text = response.content.strip()

            # Check if LLM declined
            if NO_OUTREACH_SENTINEL in text:
                return None

            # Clean up: remove any extraneous framing
            if text.startswith('"') and text.endswith('"'):
                text = text[1:-1]

            return text

        except Exception as e:
            logger.error("proactive_llm_generation_failed", error=str(e))
            return None


def _format_time_since(iso_timestamp: str) -> str:
    """Format time since an ISO timestamp into a human-readable string."""
    try:
        then = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = now - then

        if delta.days > 30:
            months = delta.days // 30
            return f"about {months} month{'s' if months != 1 else ''}"
        elif delta.days > 0:
            return f"{delta.days} day{'s' if delta.days != 1 else ''}"
        elif delta.seconds >= 3600:
            hours = delta.seconds // 3600
            return f"{hours} hour{'s' if hours != 1 else ''}"
        else:
            minutes = max(1, delta.seconds // 60)
            return f"{minutes} minute{'s' if minutes != 1 else ''}"
    except Exception:
        return "some time"


def _get_user_local_time(timezone_str: str) -> str:
    """Get the current time in the user's timezone as a readable string."""
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(timezone_str)
        now = datetime.now(tz)
        return now.strftime("%A, %I:%M %p")
    except Exception:
        return datetime.now(timezone.utc).strftime("%A, %I:%M %p UTC")
