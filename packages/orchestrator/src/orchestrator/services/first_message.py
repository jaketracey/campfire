"""First message generation service.

Generates the opening message a companion sends when meeting a user for the
first time (or returning after time away).  Uses archetype-specific prompt
templates and optionally calls the LLM for a more personalised variant.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

import structlog

from orchestrator.models.conversation import CompanionSpec
from orchestrator.prompts.manager import get_prompt_manager

logger = structlog.get_logger()


class FirstMessageContext(str, Enum):
    """Context hint used to pick the right first-message variant."""

    DEFAULT = "default"
    RETURNING = "returning"
    LATE_NIGHT = "late_night"
    MORNING = "morning"


# -----------------------------------------------------------------------
# Template-based generation (fast, no LLM call)
# -----------------------------------------------------------------------

def _detect_context() -> FirstMessageContext:
    """Determine the message context from the current time of day."""
    hour = datetime.utcnow().hour
    if 5 <= hour < 12:
        return FirstMessageContext.MORNING
    if hour >= 22 or hour < 5:
        return FirstMessageContext.LATE_NIGHT
    return FirstMessageContext.DEFAULT


def _template_name_for(archetype: str | None, context: FirstMessageContext) -> str:
    """Build the prompt-manager template name for the given archetype + context.

    Falls back to the generic template if no archetype-specific one exists.
    """
    if archetype:
        return f"first_message_{archetype}_{context.value}"
    return f"first_message_{context.value}"


def _render_template(
    companion_spec: CompanionSpec,
    user_name: str,
    context: FirstMessageContext,
) -> str | None:
    """Attempt to render a first-message template.

    Returns ``None`` when the template does not exist in the prompt manager.
    """
    manager = get_prompt_manager()
    template_name = _template_name_for(companion_spec.archetype, context)
    try:
        template = manager.get_template(template_name)
    except KeyError:
        # Fall back to generic context template
        try:
            template = manager.get_template(f"first_message_{context.value}")
        except KeyError:
            return None

    try:
        return template.render(
            companion_name=companion_spec.name,
            user_name=user_name,
            time_of_day=context.value.replace("_", " "),
        )
    except Exception:
        logger.warning(
            "first_message_template_render_failed",
            template=template_name,
            exc_info=True,
        )
        return None


# -----------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------

async def generate_first_message(
    companion_spec: CompanionSpec,
    user_name: str,
    context: FirstMessageContext | None = None,
    *,
    llm_client: Any | None = None,
) -> str:
    """Generate the first message for a companion to send to a user.

    Parameters
    ----------
    companion_spec:
        The full companion specification.
    user_name:
        The user's display name.
    context:
        An explicit context hint; auto-detected from the clock when *None*.
    llm_client:
        Optional async callable ``(system_prompt, user_prompt) -> str`` for
        LLM-backed personalisation.  When provided the service will call the
        model and fall back to the template if the call fails.
    """
    if context is None:
        context = _detect_context()

    # --- Try the template first (always available, zero latency) -----------
    template_msg = _render_template(companion_spec, user_name, context)

    # --- Optionally enhance via LLM ---------------------------------------
    if llm_client is not None:
        try:
            enhanced = await _enhance_with_llm(
                companion_spec, user_name, context, template_msg, llm_client
            )
            if enhanced:
                return enhanced
        except Exception:
            logger.warning(
                "first_message_llm_enhancement_failed",
                companion_id=str(companion_spec.id),
                exc_info=True,
            )

    # --- Fall back to template or hard-coded default ----------------------
    if template_msg:
        return template_msg

    return (
        f"Hey {user_name}! I'm {companion_spec.name}. "
        "Really glad to meet you. What's on your mind?"
    )


async def _enhance_with_llm(
    companion_spec: CompanionSpec,
    user_name: str,
    context: FirstMessageContext,
    template_msg: str | None,
    llm_client: Any,
) -> str | None:
    """Call the LLM to produce a truly personalised first message."""

    archetype_label = companion_spec.archetype or "companion"
    traits_str = ", ".join(companion_spec.personality_traits) if companion_spec.personality_traits else "warm, friendly"

    system_prompt = (
        f"You are {companion_spec.name}, a {archetype_label} personality. "
        f"Your traits: {traits_str}. "
        f"Your communication style: {companion_spec.communication_style}. "
        "Generate a short, compelling first message (2-4 short paragraphs) "
        f"to greet {user_name}. Context: {context.value.replace('_', ' ')}. "
        "Be authentic to your personality. Do NOT mention that you are an AI."
    )

    user_prompt = (
        f"Write your opening message to {user_name}. "
        "Make it feel personal and memorable."
    )

    if template_msg:
        user_prompt += (
            "\n\nHere is a reference for tone and length (do not copy verbatim):\n"
            f"{template_msg}"
        )

    result: str = await llm_client(system_prompt, user_prompt)
    stripped = result.strip()
    return stripped if stripped else None
