"""Response selector for group chat conversations.

Determines which companion(s) should respond to a user message in a group chat context.
Uses Ollama for lightweight speaker selection decisions.
"""

import re
import time
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.models.group_chat import (
    GroupChatContext,
    GroupMessage,
    GroupParticipant,
    SpeakerSelection,
)
from orchestrator.prompts.manager import PromptManager

logger = structlog.get_logger()


class ResponseSelector:
    """Selects which companion(s) should respond in a group chat."""

    def __init__(
        self,
        settings: Settings,
        prompt_manager: PromptManager,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.prompt_manager = prompt_manager
        self.http_client = http_client or httpx.AsyncClient(timeout=30.0)
        self.ollama_url = settings.ollama_url or "http://localhost:11434"
        self.selector_model = settings.selector_model or "llama3.2:3b"  # Fast, lightweight model

    async def select_speaker(
        self,
        context: GroupChatContext,
        user_message: str,
    ) -> SpeakerSelection:
        """Select which companion should respond to the user message.

        Args:
            context: The group chat context with participants and history
            user_message: The user's new message

        Returns:
            SpeakerSelection with primary speaker and optional reactors
        """
        start_time = time.time()

        # If only one active participant, they're the speaker
        active = context.active_participants
        if len(active) <= 1:
            speaker = active[0] if active else context.host_companion
            return SpeakerSelection(
                primary_speaker=speaker,
                should_react=False,
                reactors=[],
                reasoning="Only one active participant",
            )

        # Check for direct @mention
        mentioned = self._check_mention(user_message, active)
        if mentioned:
            return SpeakerSelection(
                primary_speaker=mentioned,
                should_react=False,
                reactors=[],
                reasoning=f"User directly mentioned {mentioned.companion_spec.name}",
            )

        # Use LLM to select speaker
        try:
            selection = await self._llm_select_speaker(context, user_message, active)
            duration_ms = (time.time() - start_time) * 1000
            logger.debug(
                "speaker_selected",
                primary=str(selection.primary_speaker.companion_id),
                should_react=selection.should_react,
                reactor_count=len(selection.reactors),
                duration_ms=duration_ms,
            )
            return selection
        except Exception as e:
            logger.exception("speaker_selection_failed", error=str(e))
            # Fallback: host companion responds
            return SpeakerSelection(
                primary_speaker=context.host_companion,
                should_react=False,
                reactors=[],
                reasoning=f"Fallback to host due to error: {str(e)}",
            )

    async def check_should_react(
        self,
        reactor: GroupParticipant,
        speaker: GroupParticipant,
        response_preview: str,
        context: GroupChatContext,
    ) -> bool:
        """Check if a companion should add a reaction to a response.

        This is called after the primary response is generated to see if
        anyone else should chime in with a brief reaction.

        Args:
            reactor: The potential reactor
            speaker: The primary speaker
            response_preview: Preview of the primary response (first 200 chars)
            context: The group chat context

        Returns:
            True if the reactor should add a reaction
        """
        # Don't react to yourself
        if reactor.companion_id == speaker.companion_id:
            return False

        # Limit reactions - only check occasionally
        if len(context.recent_turns) > 0:
            last_turn = context.recent_turns[-1]
            if any(m.speaker_id == reactor.companion_id for m in last_turn.companion_messages):
                # Already spoke recently, don't react
                return False

        try:
            prompt = self.prompt_manager.get_prompt_effective(
                "orchestrator.reaction_check_prompt",
                version=self.prompt_manager.current_version,
                companion_id=str(reactor.companion_spec.id),
                reactor_name=reactor.companion_spec.name,
                reactor_desc=reactor.relationship_to_primary or "friend",
                speaker_name=speaker.companion_spec.name,
                response_preview=response_preview[:200],
                relationship=reactor.relationship_to_primary or "friends",
                reactor_personality=", ".join(reactor.companion_spec.personality_traits[:3])
                if reactor.companion_spec.personality_traits
                else "friendly",
            )

            response = await self._call_ollama(prompt)
            result = self._parse_json_response(response)
            return result.get("should_react", False)
        except Exception as e:
            logger.debug("reaction_check_failed", error=str(e))
            return False

    def _check_mention(
        self,
        message: str,
        participants: list[GroupParticipant],
    ) -> GroupParticipant | None:
        """Check if the message directly mentions a participant."""
        message_lower = message.lower()

        for participant in participants:
            name = participant.companion_spec.name.lower()
            # Check for @mention or direct address
            patterns = [
                f"@{name}",
                f"hey {name}",
                f"hi {name}",
                f"{name},",
                f"{name}:",
            ]
            for pattern in patterns:
                if pattern in message_lower:
                    return participant
        return None

    async def _llm_select_speaker(
        self,
        context: GroupChatContext,
        user_message: str,
        participants: list[GroupParticipant],
    ) -> SpeakerSelection:
        """Use LLM to select the primary speaker."""
        # Build participant list
        participant_lines = []
        for p in participants:
            desc = f"- {p.companion_spec.name} (ID: {p.companion_id})"
            if p.relationship_to_primary:
                desc += f" - {p.relationship_to_primary}"
            if p.companion_spec.personality_traits:
                desc += f" - Traits: {', '.join(p.companion_spec.personality_traits[:3])}"
            participant_lines.append(desc)

        # Build recent messages
        message_lines = []
        for turn in context.recent_turns[-5:]:  # Last 5 turns
            message_lines.append(f"User: {turn.user_message.content[:100]}")
            for msg in turn.companion_messages:
                prefix = "[Reaction]" if msg.is_reaction else ""
                message_lines.append(f"{prefix}{msg.speaker_name}: {msg.content[:100]}")

        prompt = self.prompt_manager.get_prompt(
            "orchestrator.speaker_selection_prompt",
            version=self.prompt_manager.current_version,
            participants="\n".join(participant_lines),
            recent_messages="\n".join(message_lines) or "(No recent messages)",
            user_message=user_message[:500],
        )

        response = await self._call_ollama(prompt)
        result = self._parse_json_response(response)

        # Find the primary speaker
        primary_id = result.get("primary_speaker_id", "")
        primary = self._find_participant(primary_id, participants)
        if not primary:
            primary = context.host_companion

        # Find reactors
        reactors: list[GroupParticipant] = []
        if result.get("should_react", False):
            reactor_ids = result.get("reactor_ids", [])
            for rid in reactor_ids[:1]:  # Max 1 reactor
                reactor = self._find_participant(rid, participants)
                if reactor and reactor.companion_id != primary.companion_id:
                    reactors.append(reactor)

        return SpeakerSelection(
            primary_speaker=primary,
            should_react=len(reactors) > 0,
            reactors=reactors,
            reasoning=result.get("reasoning", ""),
        )

    def _find_participant(
        self,
        companion_id: str,
        participants: list[GroupParticipant],
    ) -> GroupParticipant | None:
        """Find a participant by ID."""
        try:
            target_id = UUID(companion_id)
            for p in participants:
                if p.companion_id == target_id:
                    return p
        except (ValueError, TypeError):
            pass
        return None

    async def _call_ollama(self, prompt: str) -> str:
        """Call Ollama API for inference."""
        response = await self.http_client.post(
            f"{self.ollama_url}/api/generate",
            json={
                "model": self.selector_model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,  # Low temperature for consistent decisions
                    "num_predict": 200,  # Short response
                },
            },
        )
        response.raise_for_status()
        result = response.json()
        return result.get("response", "")

    def _parse_json_response(self, response: str) -> dict:
        """Parse JSON from LLM response, handling common formatting issues."""
        # Try to extract JSON from the response
        response = response.strip()

        # Try direct parsing
        try:
            import json
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # Try to find JSON in the response
        json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
        if json_match:
            try:
                import json
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        # Return empty dict if parsing fails
        logger.debug("json_parse_failed", response=response[:200])
        return {}

    async def close(self) -> None:
        """Clean up resources."""
        await self.http_client.aclose()
