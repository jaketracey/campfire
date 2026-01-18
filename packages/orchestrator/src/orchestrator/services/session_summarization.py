"""Session Summarization Service.

This service generates summaries of conversation sessions
when they exceed a turn threshold, enabling context retention
for long conversations and across sessions.
"""

import json
from typing import Any
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings

logger = structlog.get_logger()

# Summarization prompt template for LLM
SUMMARIZATION_PROMPT = """Summarize the following conversation between a user and their AI companion.

<conversation>
{conversation}
</conversation>

{companion_context}

Create a concise summary that captures:
1. The main topics discussed
2. Key facts about the user (preferences, information shared, goals)
3. Important decisions or conclusions reached
4. The emotional tone of the conversation

Output JSON in this exact format:
{{
  "summary": "A 2-3 paragraph summary of the conversation",
  "key_facts": ["List of important facts about the user"],
  "emotional_tone": "Brief description of the conversation's emotional tone"
}}

Focus on information that would be useful for future conversations to maintain continuity.
Output ONLY valid JSON, no markdown or explanation."""


class SessionSummaryResult:
    """Result of session summarization."""

    def __init__(
        self,
        summary: str | None = None,
        key_facts: list[str] | None = None,
        emotional_tone: str | None = None,
        success: bool = True,
        error: str | None = None,
    ):
        self.summary = summary
        self.key_facts = key_facts or []
        self.emotional_tone = emotional_tone
        self.success = success
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "key_facts": self.key_facts,
            "emotional_tone": self.emotional_tone,
            "success": self.success,
            "error": self.error,
        }

    @property
    def has_summary(self) -> bool:
        """Check if a summary was generated."""
        return bool(self.summary and self.summary.strip())


class SessionSummarizationService:
    """Service for generating session summaries.

    This service analyzes conversation turns and generates
    summaries that can be stored and used for context retention.
    """

    # Default turn threshold for summarization
    DEFAULT_THRESHOLD = 20

    # Default interval between summarizations (in turns)
    DEFAULT_INTERVAL = 20

    # Minimum turns required to generate a meaningful summary
    MIN_TURNS_FOR_SUMMARY = 3

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.http_client = http_client or httpx.AsyncClient(timeout=60.0)

        # Use a cheap/fast model for summarization
        self.summarization_model = settings.kg_extraction_model or "claude-3-haiku-20240307"
        self.gateway_url = settings.gateway_url or "http://localhost:3000"

    def should_summarize(
        self,
        turn_count: int,
        threshold: int | None = None,
        last_summary_turn: int | None = None,
        summary_interval: int | None = None,
        has_existing_summary: bool = False,
    ) -> bool:
        """Determine if summarization should be performed.

        Args:
            turn_count: Current number of turns in session
            threshold: Turn threshold to trigger summarization (default: 20)
            last_summary_turn: Turn number when last summary was generated
            summary_interval: Minimum turns between summaries
            has_existing_summary: Whether session already has a summary

        Returns:
            True if summarization should be performed
        """
        threshold = threshold or self.DEFAULT_THRESHOLD
        summary_interval = summary_interval or self.DEFAULT_INTERVAL

        # Not enough turns yet
        if turn_count < threshold:
            return False

        # If there's an existing summary from a recent turn, skip
        if has_existing_summary and last_summary_turn is not None:
            if turn_count - last_summary_turn < summary_interval:
                return False

        # If we've summarized before, check interval
        if last_summary_turn is not None:
            if turn_count - last_summary_turn < summary_interval:
                return False

        return True

    async def generate_summary(
        self,
        turns: list[dict[str, Any]],
        session_id: UUID,
        companion_name: str | None = None,
    ) -> SessionSummaryResult:
        """Generate a summary from conversation turns.

        Args:
            turns: List of turn dicts with 'role' and 'content'
            session_id: Session ID for logging
            companion_name: Optional companion name for context

        Returns:
            SessionSummaryResult with generated summary
        """
        if not turns or len(turns) < self.MIN_TURNS_FOR_SUMMARY:
            return SessionSummaryResult(
                summary=None,
                success=True,
                error="Insufficient turns for summarization",
            )

        try:
            # Build conversation text
            conversation_text = self._build_conversation_text(turns)

            if not conversation_text.strip():
                return SessionSummaryResult(
                    summary=None,
                    success=True,
                    error="No conversation content to summarize",
                )

            # Build companion context
            companion_context = ""
            if companion_name:
                companion_context = f"The AI companion's name is {companion_name}."

            # Build prompt
            prompt = SUMMARIZATION_PROMPT.format(
                conversation=conversation_text,
                companion_context=companion_context,
            )

            # Call LLM
            response = await self._call_summarization_llm(prompt)

            # Parse response
            result = self._parse_summarization_response(response)

            logger.info(
                "session_summarization_completed",
                session_id=str(session_id),
                summary_length=len(result.summary) if result.summary else 0,
                key_facts_count=len(result.key_facts),
            )

            return result

        except Exception as e:
            logger.error(
                "session_summarization_failed",
                error=str(e),
                session_id=str(session_id),
            )
            return SessionSummaryResult(
                summary=None,
                success=False,
                error=str(e),
            )

    async def submit_summary(
        self,
        session_id: UUID,
        summary: SessionSummaryResult,
        user_id: UUID,
    ) -> bool:
        """Submit generated summary to the gateway for storage.

        Args:
            session_id: Session ID to update
            summary: The generated summary
            user_id: User ID for authentication

        Returns:
            True if submission was successful
        """
        if not summary.has_summary:
            logger.debug("no_summary_to_submit", session_id=str(session_id))
            return True

        try:
            payload = {
                "sessionId": str(session_id),
                "summary": summary.summary,
                "keyFacts": summary.key_facts,
                "emotionalTone": summary.emotional_tone,
            }

            response = await self.http_client.post(
                f"{self.gateway_url}/api/v1/sessions/internal/summary",
                json=payload,
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key or "",
                    "X-User-Id": str(user_id),
                },
            )

            if response.status_code in (200, 201):
                logger.info(
                    "session_summary_submitted",
                    session_id=str(session_id),
                )
                return True
            else:
                logger.warning(
                    "session_summary_submit_failed",
                    status_code=response.status_code,
                    response=response.text[:500],
                )
                return False

        except Exception as e:
            logger.error("session_summary_submit_error", error=str(e))
            return False

    async def summarize_and_store(
        self,
        turns: list[dict[str, Any]],
        session_id: UUID,
        user_id: UUID,
        companion_name: str | None = None,
    ) -> SessionSummaryResult:
        """Convenience method to generate and submit a summary.

        Args:
            turns: Conversation turns
            session_id: Session ID
            user_id: User ID
            companion_name: Optional companion name

        Returns:
            SessionSummaryResult (also submitted to gateway)
        """
        result = await self.generate_summary(
            turns=turns,
            session_id=session_id,
            companion_name=companion_name,
        )

        if result.success and result.has_summary:
            await self.submit_summary(
                session_id=session_id,
                summary=result,
                user_id=user_id,
            )

        return result

    async def _call_summarization_llm(self, prompt: str) -> str:
        """Call the LLM for summarization.

        Uses a cheap/fast model for cost efficiency.
        """
        # Import here to avoid circular dependency
        from orchestrator.providers.anthropic import AnthropicProvider

        provider = AnthropicProvider(self.settings)

        response = await provider.generate(
            messages=[{"role": "user", "content": prompt}],
            model=self.summarization_model,
            max_tokens=1500,
            temperature=0.3,  # Moderate temperature for summaries
        )

        return response.content

    def _parse_summarization_response(self, response: str) -> SessionSummaryResult:
        """Parse the LLM summarization response."""
        try:
            # Clean up response - remove markdown code blocks if present
            cleaned = response.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned = "\n".join(lines)

            # Try to parse as JSON
            try:
                data = json.loads(cleaned)
                return SessionSummaryResult(
                    summary=data.get("summary"),
                    key_facts=data.get("key_facts", []),
                    emotional_tone=data.get("emotional_tone"),
                )
            except json.JSONDecodeError:
                # Fall back to treating response as plain text summary
                if cleaned and len(cleaned) > 20:
                    return SessionSummaryResult(
                        summary=cleaned,
                        key_facts=[],
                        emotional_tone=None,
                    )
                raise

        except json.JSONDecodeError as e:
            logger.warning(
                "session_summarization_parse_failed",
                error=str(e),
                response_preview=response[:200],
            )
            return SessionSummaryResult(
                summary=None,
                success=False,
                error=f"Failed to parse LLM response: {e}",
            )

    def _build_conversation_text(
        self,
        turns: list[dict[str, Any]],
        max_tokens: int = 6000,
    ) -> str:
        """Build conversation text from turns.

        Args:
            turns: List of turn dicts with 'role' and 'content'
            max_tokens: Maximum approximate tokens (chars / 4)

        Returns:
            Formatted conversation text
        """
        if not turns:
            return ""

        lines = []
        total_chars = 0
        max_chars = max_tokens * 4  # Rough approximation

        for turn in turns:
            content = turn.get("content", "")
            if not content or not content.strip():
                continue

            role = turn.get("role", "user")
            prefix = "User:" if role == "user" else "Assistant:"
            line = f"{prefix} {content}"

            # Check if adding this line would exceed limit
            if total_chars + len(line) > max_chars:
                # Add truncation notice and stop
                lines.append("... [conversation truncated for length]")
                break

            lines.append(line)
            total_chars += len(line)

        return "\n".join(lines)


# Singleton instance
_summarization_service: SessionSummarizationService | None = None


def get_session_summarization_service(settings: Settings) -> SessionSummarizationService:
    """Get the singleton session summarization service."""
    global _summarization_service
    if _summarization_service is None:
        _summarization_service = SessionSummarizationService(settings)
    return _summarization_service
