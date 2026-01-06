"""Group conversation orchestrator.

Manages multi-companion group chat conversations, coordinating between
the response selector, context builder, and LLM providers.
"""

import time
from typing import Any, AsyncGenerator
from uuid import UUID, uuid4

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.conversation import Message, MessageRole
from orchestrator.models.group_chat import (
    GroupChatContext,
    GroupChatRequest,
    GroupChatResponse,
    GroupConversationTurn,
    GroupMessage,
    GroupParticipant,
    SpeakerType,
    get_theme_color,
)
from orchestrator.providers.ollama import OllamaProvider
from orchestrator.prompts.manager import PromptManager
from orchestrator.services.group_context_builder import GroupContextBuilder
from orchestrator.services.response_selector import ResponseSelector

logger = structlog.get_logger()


class GroupConversationOrchestrator:
    """Orchestrates multi-companion group conversations."""

    def __init__(
        self,
        settings: Settings,
        prompt_manager: PromptManager,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings
        self.prompt_manager = prompt_manager
        self.event_emitter = event_emitter
        self.http_client = http_client or httpx.AsyncClient(timeout=60.0)

        # Initialize components
        self.response_selector = ResponseSelector(settings, prompt_manager, self.http_client)
        self.context_builder = GroupContextBuilder(settings, prompt_manager)
        self.ollama_provider = OllamaProvider(settings)

    async def process_message(
        self,
        context: GroupChatContext,
        user_message: str,
    ) -> GroupChatResponse:
        """Process a user message in a group chat context.

        This is the main entry point for group chat message processing.
        It coordinates speaker selection, response generation, and reactions.

        Args:
            context: The group chat context with participants and history
            user_message: The user's new message

        Returns:
            GroupChatResponse with primary response and any reactions
        """
        start_time = time.time()
        turn_id = uuid4()

        logger.info(
            "group_chat_processing",
            session_id=str(context.session_id),
            participant_count=len(context.active_participants),
            user_message_preview=user_message[:50],
        )

        # Step 1: Select who should respond
        selection = await self.response_selector.select_speaker(
            context, user_message
        )

        logger.debug(
            "speaker_selected",
            primary_speaker=selection.primary_speaker.companion_spec.name,
            should_react=selection.should_react,
            reactor_count=len(selection.reactors),
        )

        # Step 2: Generate primary response
        primary_response = await self._generate_response(
            context=context,
            speaker=selection.primary_speaker,
            user_message=user_message,
            turn_id=turn_id,
            is_reaction=False,
        )

        # Step 3: Generate reactions if needed
        reactions: list[GroupMessage] = []
        if selection.should_react and selection.reactors:
            for reactor in selection.reactors[:1]:  # Limit to 1 reaction
                # Check if reaction is still appropriate given the response
                should_react = await self.response_selector.check_should_react(
                    reactor=reactor,
                    speaker=selection.primary_speaker,
                    response_preview=primary_response.content[:200],
                    context=context,
                )

                if should_react:
                    reaction = await self._generate_reaction(
                        context=context,
                        reactor=reactor,
                        speaker=selection.primary_speaker,
                        primary_response=primary_response.content,
                        user_message=user_message,
                        turn_id=turn_id,
                    )
                    reactions.append(reaction)

        duration_ms = (time.time() - start_time) * 1000

        logger.info(
            "group_chat_completed",
            session_id=str(context.session_id),
            primary_speaker=selection.primary_speaker.companion_spec.name,
            reaction_count=len(reactions),
            duration_ms=duration_ms,
        )

        return GroupChatResponse(
            turn_id=turn_id,
            primary_response=primary_response,
            reactions=reactions,
            latency_ms=duration_ms,
        )

    async def process_message_streaming(
        self,
        context: GroupChatContext,
        user_message: str,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Process a message with streaming output.

        Yields events as responses are generated:
        - speaker_start: When a companion starts speaking
        - chunk: A text chunk from the response
        - speaker_end: When a companion finishes speaking

        Args:
            context: The group chat context
            user_message: The user's new message

        Yields:
            Event dictionaries with type and data
        """
        turn_id = uuid4()

        # Step 1: Select speaker
        selection = await self.response_selector.select_speaker(
            context, user_message
        )

        # Step 2: Stream primary response
        speaker = selection.primary_speaker
        yield {
            "type": "speaker_start",
            "turn_id": str(turn_id),
            "companion_id": str(speaker.companion_id),
            "companion_name": speaker.companion_spec.name,
            "theme_color": speaker.theme_color,
            "is_reaction": False,
        }

        full_response = ""
        async for chunk in self._stream_response(
            context=context,
            speaker=speaker,
            user_message=user_message,
        ):
            full_response += chunk
            yield {
                "type": "chunk",
                "turn_id": str(turn_id),
                "companion_id": str(speaker.companion_id),
                "content": chunk,
                "is_reaction": False,
            }

        yield {
            "type": "speaker_end",
            "turn_id": str(turn_id),
            "companion_id": str(speaker.companion_id),
            "companion_name": speaker.companion_spec.name,
            "full_message": full_response,
            "is_reaction": False,
        }

        # Step 3: Check for reactions
        if selection.should_react and selection.reactors:
            for reactor in selection.reactors[:1]:
                should_react = await self.response_selector.check_should_react(
                    reactor=reactor,
                    speaker=speaker,
                    response_preview=full_response[:200],
                    context=context,
                )

                if should_react:
                    yield {
                        "type": "speaker_start",
                        "turn_id": str(turn_id),
                        "companion_id": str(reactor.companion_id),
                        "companion_name": reactor.companion_spec.name,
                        "theme_color": reactor.theme_color,
                        "is_reaction": True,
                    }

                    reaction_response = ""
                    async for chunk in self._stream_reaction(
                        context=context,
                        reactor=reactor,
                        speaker=speaker,
                        primary_response=full_response,
                        user_message=user_message,
                    ):
                        reaction_response += chunk
                        yield {
                            "type": "chunk",
                            "turn_id": str(turn_id),
                            "companion_id": str(reactor.companion_id),
                            "content": chunk,
                            "is_reaction": True,
                        }

                    yield {
                        "type": "speaker_end",
                        "turn_id": str(turn_id),
                        "companion_id": str(reactor.companion_id),
                        "companion_name": reactor.companion_spec.name,
                        "full_message": reaction_response,
                        "is_reaction": True,
                    }

    async def _generate_response(
        self,
        context: GroupChatContext,
        speaker: GroupParticipant,
        user_message: str,
        turn_id: UUID,
        is_reaction: bool,
    ) -> GroupMessage:
        """Generate a response from a companion."""
        # Build system prompt
        system_prompt = self.context_builder.build_system_prompt(
            speaking_companion=speaker,
            context=context,
            available_tools=["invite_friend", "dismiss_friend"] if not is_reaction else None,
        )

        # Build message history
        messages = self.context_builder.build_messages(
            context=context,
            user_message=user_message,
        )

        # Generate response using Ollama
        response = await self.ollama_provider.generate(
            model=self.settings.chat_model or "llama3.2:8b",
            system_prompt=system_prompt,
            messages=messages,
            temperature=speaker.companion_spec.temperature,
        )

        return GroupMessage(
            speaker_id=speaker.companion_id,
            speaker_type=SpeakerType.COMPANION,
            speaker_name=speaker.companion_spec.name,
            theme_color=speaker.theme_color,
            content=response,
            is_reaction=is_reaction,
        )

    async def _generate_reaction(
        self,
        context: GroupChatContext,
        reactor: GroupParticipant,
        speaker: GroupParticipant,
        primary_response: str,
        user_message: str,
        turn_id: UUID,
    ) -> GroupMessage:
        """Generate a reaction to the primary response."""
        # Build reaction prompt
        system_prompt = self.context_builder.build_reaction_prompt(
            reactor=reactor,
            speaker=speaker,
            speaker_message=primary_response,
        )

        # Build messages for reaction context
        messages = self.context_builder.build_reaction_messages(
            primary_response=primary_response,
            speaker_name=speaker.companion_spec.name,
            user_message=user_message,
        )

        # Generate reaction using Ollama (with lower token limit)
        response = await self.ollama_provider.generate(
            model=self.settings.chat_model or "llama3.2:8b",
            system_prompt=system_prompt,
            messages=messages,
            temperature=reactor.companion_spec.temperature,
            max_tokens=100,  # Keep reactions short
        )

        return GroupMessage(
            speaker_id=reactor.companion_id,
            speaker_type=SpeakerType.COMPANION,
            speaker_name=reactor.companion_spec.name,
            theme_color=reactor.theme_color,
            content=response,
            is_reaction=True,
            reacting_to=speaker.companion_id,
        )

    async def _stream_response(
        self,
        context: GroupChatContext,
        speaker: GroupParticipant,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """Stream a response from a companion."""
        system_prompt = self.context_builder.build_system_prompt(
            speaking_companion=speaker,
            context=context,
            available_tools=["invite_friend", "dismiss_friend"],
        )

        messages = self.context_builder.build_messages(
            context=context,
            user_message=user_message,
        )

        async for chunk in self.ollama_provider.stream_generate(
            model=self.settings.chat_model or "llama3.2:8b",
            system_prompt=system_prompt,
            messages=messages,
            temperature=speaker.companion_spec.temperature,
        ):
            yield chunk

    async def _stream_reaction(
        self,
        context: GroupChatContext,
        reactor: GroupParticipant,
        speaker: GroupParticipant,
        primary_response: str,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """Stream a reaction response."""
        system_prompt = self.context_builder.build_reaction_prompt(
            reactor=reactor,
            speaker=speaker,
            speaker_message=primary_response,
        )

        messages = self.context_builder.build_reaction_messages(
            primary_response=primary_response,
            speaker_name=speaker.companion_spec.name,
            user_message=user_message,
        )

        async for chunk in self.ollama_provider.stream_generate(
            model=self.settings.chat_model or "llama3.2:8b",
            system_prompt=system_prompt,
            messages=messages,
            temperature=reactor.companion_spec.temperature,
            max_tokens=100,
        ):
            yield chunk

    async def close(self) -> None:
        """Clean up resources."""
        await self.response_selector.close()
        await self.http_client.aclose()
