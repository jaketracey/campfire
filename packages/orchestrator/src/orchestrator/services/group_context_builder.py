"""Group context builder for multi-companion conversations.

Extends the standard context builder to handle group chat scenarios
with multiple companion participants.
"""

from typing import Any
from uuid import UUID

import structlog

from orchestrator.config import Settings
from orchestrator.models.conversation import Message, MessageRole
from orchestrator.models.group_chat import (
    GroupChatContext,
    GroupConversationTurn,
    GroupMessage,
    GroupParticipant,
    ParticipantRole,
)
from orchestrator.prompts.manager import PromptManager

logger = structlog.get_logger()


class GroupContextBuilder:
    """Builds context and prompts for group chat conversations."""

    def __init__(self, settings: Settings, prompt_manager: PromptManager):
        self.settings = settings
        self.prompt_manager = prompt_manager

    def build_system_prompt(
        self,
        speaking_companion: GroupParticipant,
        context: GroupChatContext,
        available_tools: list[str] | None = None,
    ) -> str:
        """Build the system prompt for a companion speaking in a group chat.

        Args:
            speaking_companion: The companion who will be responding
            context: The group chat context
            available_tools: List of available tool names

        Returns:
            The system prompt string
        """
        spec = speaking_companion.companion_spec

        # Build identity section
        identity_lines = [
            f"Name: {spec.name}",
            f"Description: {spec.description}",
        ]
        identity_section = "\n".join(identity_lines)

        # Build personality section
        personality_lines = []
        if spec.archetype:
            personality_lines.append(f"Archetype: {spec.archetype}")
        if spec.personality_traits:
            personality_lines.append(f"Traits: {', '.join(spec.personality_traits)}")
        personality_lines.append(f"Communication style: {spec.communication_style}")
        personality_section = "\n".join(personality_lines)

        # Build tenets section
        tenets_lines = []
        for tenet in spec.core_tenets[:5]:  # Limit to top 5 tenets
            prefix = "DON'T" if tenet.is_negation else "DO"
            tenets_lines.append(f"- {prefix}: {tenet.rule}")
        tenets_section = "\n".join(tenets_lines) or "Be friendly, respectful, and authentic."

        # Build participants section
        participants_section = self._build_participants_section(
            speaking_companion, context.active_participants
        )

        # Build tools section
        if available_tools:
            tools_section = "You can use: " + ", ".join(available_tools)
        else:
            tools_section = "No special tools available."

        return self.prompt_manager.get_prompt_effective(
            "orchestrator.group_system_prompt",
            version=self.prompt_manager.current_version,
            companion_id=str(spec.id),
            companion_name=spec.name,
            identity_section=identity_section,
            personality_section=personality_section,
            tenets_section=tenets_section,
            participants_section=participants_section,
            tools_section=tools_section,
        )

    def build_reaction_prompt(
        self,
        reactor: GroupParticipant,
        speaker: GroupParticipant,
        speaker_message: str,
    ) -> str:
        """Build a prompt for a companion to add a reaction.

        Args:
            reactor: The companion adding a reaction
            speaker: The companion who spoke
            speaker_message: What the speaker said

        Returns:
            The reaction prompt string
        """
        spec = reactor.companion_spec
        personality_summary = (
            ", ".join(spec.personality_traits[:3])
            if spec.personality_traits
            else spec.communication_style
        )

        return self.prompt_manager.get_prompt_effective(
            "orchestrator.group_reaction_prompt",
            version=self.prompt_manager.current_version,
            companion_id=str(spec.id),
            companion_name=spec.name,
            speaker_name=speaker.companion_spec.name,
            speaker_message=speaker_message[:500],
            personality_summary=personality_summary,
            relationship=reactor.relationship_to_primary or "friend",
        )

    def build_messages(
        self,
        context: GroupChatContext,
        user_message: str,
        max_turns: int = 10,
    ) -> list[dict[str, Any]]:
        """Build the message history for the LLM.

        In group chat, messages are labeled by speaker to help the model
        understand the conversation flow.

        Args:
            context: The group chat context
            user_message: The new user message
            max_turns: Maximum number of turns to include

        Returns:
            List of messages in OpenAI/Anthropic format
        """
        messages: list[dict[str, Any]] = []

        # Add recent turns
        for turn in context.recent_turns[-max_turns:]:
            # Add user message
            messages.append({
                "role": "user",
                "content": turn.user_message.content,
            })

            # Add companion messages with speaker labels
            for group_msg in turn.companion_messages:
                # Label the message with speaker name for context
                if group_msg.is_reaction:
                    content = f"[{group_msg.speaker_name} adds]: {group_msg.content}"
                else:
                    content = f"[{group_msg.speaker_name}]: {group_msg.content}"

                messages.append({
                    "role": "assistant",
                    "content": content,
                })

        # Add the new user message
        messages.append({
            "role": "user",
            "content": user_message,
        })

        return messages

    def build_reaction_messages(
        self,
        primary_response: str,
        speaker_name: str,
        user_message: str,
    ) -> list[dict[str, Any]]:
        """Build messages for generating a reaction.

        Args:
            primary_response: The primary speaker's response
            speaker_name: Name of the primary speaker
            user_message: The original user message

        Returns:
            List of messages for the reaction prompt
        """
        return [
            {
                "role": "user",
                "content": user_message,
            },
            {
                "role": "assistant",
                "content": f"[{speaker_name}]: {primary_response}",
            },
        ]

    def _build_participants_section(
        self,
        speaking_companion: GroupParticipant,
        all_participants: list[GroupParticipant],
    ) -> str:
        """Build the section describing other participants."""
        lines = []
        for p in all_participants:
            if p.companion_id == speaking_companion.companion_id:
                continue  # Skip self

            desc = f"- {p.companion_spec.name}"
            if p.relationship_to_primary:
                desc += f" ({p.relationship_to_primary})"
            if p.companion_spec.archetype:
                desc += f" - {p.companion_spec.archetype}"

            lines.append(desc)

        if not lines:
            return "(No other companions in this conversation)"

        return "\n".join(lines)

    def format_group_history_for_context(
        self,
        turns: list[GroupConversationTurn],
        max_chars: int = 4000,
    ) -> str:
        """Format group conversation history for context windows.

        Creates a readable transcript of the group conversation.

        Args:
            turns: List of group conversation turns
            max_chars: Maximum characters to include

        Returns:
            Formatted conversation history
        """
        lines: list[str] = []
        total_chars = 0

        for turn in reversed(turns):
            # Format user message
            user_line = f"User: {turn.user_message.content}"

            # Format companion responses
            companion_lines = []
            for msg in turn.companion_messages:
                prefix = "(reaction) " if msg.is_reaction else ""
                companion_lines.append(f"{prefix}{msg.speaker_name}: {msg.content}")

            # Calculate length
            turn_text = user_line + "\n" + "\n".join(companion_lines)
            if total_chars + len(turn_text) > max_chars:
                break

            lines.insert(0, turn_text)
            total_chars += len(turn_text) + 1

        return "\n\n".join(lines)

    def extract_friend_info_for_tools(
        self,
        context: GroupChatContext,
    ) -> list[dict[str, Any]]:
        """Extract friend information for the invite_friend tool.

        Returns a list of available friends that can be invited.

        Args:
            context: The group chat context

        Returns:
            List of friend info dicts
        """
        # This would be populated from the companion's friend list
        # For now, return empty list - real implementation would query gateway
        return []
