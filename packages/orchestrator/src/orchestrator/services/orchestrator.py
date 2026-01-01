"""Main conversation orchestrator service."""

import asyncio
import json
import time
from typing import Any, AsyncGenerator
from uuid import UUID, uuid4

import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.conversation import (
    CompanionSpec,
    ConversationContext,
    ConversationTurn,
    SessionSummary,
    SituationalTenetMatch,
)
from orchestrator.models.events import BaseEvent, EventType, ProviderEvent
from orchestrator.models.gifts import GiftMemory, GiftRecallContext
from orchestrator.models.memory import LongTermMemory, CompanionSelfKnowledge
from orchestrator.models.tools import TOOL_REGISTRY, ToolCall, ToolResult
from orchestrator.prompts.manager import PromptManager
from orchestrator.providers.base import LLMProvider, LLMResponse
from orchestrator.providers.anthropic import AnthropicProvider
from orchestrator.providers.openai import OpenAIProvider
from orchestrator.providers.ollama import OllamaProvider
from orchestrator.queue import JobQueue
from orchestrator.safety.gate import SafetyGate
from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.gift_recall import GiftRecallService
from orchestrator.services.tenet_retriever import TenetRetriever
from orchestrator.services.turn_manager import TurnManager
from orchestrator.tools.router import ToolRouter

logger = structlog.get_logger()


class ConversationOrchestrator:
    """Orchestrates conversation flow between user, LLM, and tools."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        prompt_manager: PromptManager,
        safety_gate: SafetyGate,
        tool_router: ToolRouter,
        job_queue: JobQueue | None = None,
        primary_provider: LLMProvider | None = None,
        fallback_provider: LLMProvider | None = None,
        tenet_retriever: TenetRetriever | None = None,
        gift_recall_service: GiftRecallService | None = None,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.prompt_manager = prompt_manager
        self.safety_gate = safety_gate
        self.tool_router = tool_router
        self.job_queue = job_queue

        # Initialize providers
        # Use Ollama (local abliterated model) when enabled, fallback to OpenAI/Anthropic
        if primary_provider:
            self.primary_provider = primary_provider
        elif settings.ollama_enabled:
            self.primary_provider = OllamaProvider(settings)
            logger.info("using_ollama_provider", model=settings.ollama_model)
        else:
            self.primary_provider = OpenAIProvider(settings)

        self.fallback_provider = fallback_provider or AnthropicProvider(settings)

        # Initialize services
        self.context_builder = ContextBuilder(
            prompt_manager=prompt_manager,
            max_context_tokens=settings.max_context_tokens,
            default_turn_window=settings.default_turn_window,
        )
        self.turn_manager = TurnManager(event_emitter)
        self.tenet_retriever = tenet_retriever or TenetRetriever(settings)
        self.gift_recall_service = gift_recall_service or GiftRecallService(settings)

    async def process_message(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        user_message: str,
        recent_turns: list[ConversationTurn] | None = None,
        session_summary: SessionSummary | None = None,
        long_term_memories: list[LongTermMemory] | None = None,
        companion_self_knowledge: list[CompanionSelfKnowledge] | None = None,
        stream: bool = False,
    ) -> ConversationTurn | AsyncGenerator[str, None]:
        """Process a user message and generate a response."""
        start_time = time.time()

        # Safety check on input
        input_safe, input_flags = await self.safety_gate.check_input(
            content=user_message,
            user_id=user_id,
            session_id=session_id,
        )

        if not input_safe:
            logger.warning(
                "input_blocked_by_safety",
                user_id=str(user_id),
                flags=input_flags,
            )
            # Return a safety response
            return await self._create_safety_response(
                session_id=session_id,
                user_id=user_id,
                companion_spec=companion_spec,
                user_message=user_message,
                safety_flags=input_flags,
            )

        # Start turn
        turn_id, user_msg = await self.turn_manager.start_turn(
            session_id=session_id,
            user_id=user_id,
            companion_id=companion_spec.id,
            user_message=user_message,
            model=self.settings.anthropic_model,
            prompt_version=self.prompt_manager.current_version,
            policy_version=self.safety_gate.policy_version,
        )

        try:
            # Retrieve situational tenets based on message context
            situational_tenets: list[SituationalTenetMatch] = []
            if self.tenet_retriever:
                try:
                    situational_tenets = await self.tenet_retriever.search_situational_tenets(
                        companion_id=str(companion_spec.id),
                        user_message=user_message,
                        limit=5,
                    )
                    if situational_tenets:
                        logger.debug(
                            "situational_tenets_retrieved",
                            companion_id=str(companion_spec.id),
                            count=len(situational_tenets),
                        )
                except Exception as e:
                    logger.warning(
                        "tenet_retrieval_failed",
                        error=str(e),
                        companion_id=str(companion_spec.id),
                    )

            # Fetch gift memories for context
            gift_memories: list[GiftMemory] = []
            pending_gift_recall: GiftRecallContext | None = None

            try:
                # Get gift memories for context building
                gift_memories = await self.gift_recall_service.get_gift_memories(
                    user_id=user_id,
                    companion_id=companion_spec.id,
                    limit=5,
                )

                if gift_memories:
                    logger.debug(
                        "gift_memories_retrieved",
                        user_id=str(user_id),
                        companion_id=str(companion_spec.id),
                        count=len(gift_memories),
                    )

                # Check for surprise gift recall trigger
                current_turn = len(recent_turns) + 1 if recent_turns else 1
                current_context = user_message

                # Add recent conversation for context
                if recent_turns:
                    recent_messages = [
                        t.user_message.content
                        for t in recent_turns[-3:]
                        if t.user_message
                    ]
                    current_context = " ".join(recent_messages + [user_message])

                pending_gift_recall = await self.gift_recall_service.should_trigger_recall(
                    session_id=session_id,
                    user_id=user_id,
                    companion_id=companion_spec.id,
                    current_turn=current_turn,
                    current_context=current_context,
                )

                if pending_gift_recall:
                    logger.info(
                        "gift_recall_triggered",
                        session_id=str(session_id),
                        gift_id=str(pending_gift_recall.gift_id),
                        trigger=pending_gift_recall.trigger,
                    )

            except Exception as e:
                logger.warning(
                    "gift_context_retrieval_failed",
                    error=str(e),
                    user_id=str(user_id),
                    companion_id=str(companion_spec.id),
                )

            # Build context with situational tenets
            context = self.context_builder.build_context(
                session_id=session_id,
                user_id=user_id,
                companion_spec=companion_spec,
                recent_turns=recent_turns or [],
                session_summary=session_summary,
                long_term_memories=long_term_memories,
                safety_constraints=self.safety_gate.get_constraints(),
                active_tools=companion_spec.allowed_tools,
                situational_tenets=situational_tenets,
                prompt_version=self.prompt_manager.current_version,
                policy_version=self.safety_gate.policy_version,
            )

            # Build messages with gift context and companion self-knowledge
            messages = self.context_builder.build_messages(
                context=context,
                current_user_message=user_message,
                gift_memories=gift_memories,
                pending_gift_recall=pending_gift_recall,
                companion_self_knowledge=companion_self_knowledge,
            )

            # Get available tools
            tools = self._get_available_tools(companion_spec.allowed_tools)

            # Generate response (with tool loop)
            response, tool_calls, tool_results = await self._generate_with_tools(
                messages=messages,
                tools=tools,
                context=context,
                turn_id=turn_id,
                max_tool_iterations=5,
            )

            # Safety check on output
            output_safe, output_flags = await self.safety_gate.check_output(
                content=response.content,
                user_id=user_id,
                session_id=session_id,
            )

            all_safety_flags = input_flags + output_flags

            if not output_safe:
                logger.warning(
                    "output_modified_by_safety",
                    user_id=str(user_id),
                    flags=output_flags,
                )
                response = await self._apply_safety_filter(response, output_flags)

            # Calculate latency
            latency_ms = (time.time() - start_time) * 1000

            # Complete turn
            turn = await self.turn_manager.complete_turn(
                turn_id=turn_id,
                assistant_response=response.content,
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
                latency_ms=latency_ms,
                tools_invoked=[tc.name for tc in tool_calls],
                tool_calls=[self._serialize_tool_call(tc) for tc in tool_calls],
                tool_results=[self._serialize_tool_result(tr) for tr in tool_results],
                safety_flags=all_safety_flags,
            )

            # Fire-and-forget KG extraction (don't block response)
            asyncio.create_task(
                self._extract_knowledge_graph(
                    session_id=session_id,
                    user_id=user_id,
                    companion_spec=companion_spec,
                    turn_id=turn_id,
                    user_message=user_message,
                    assistant_response=response.content,
                )
            )

            # Record gift recall if one was triggered
            if pending_gift_recall:
                asyncio.create_task(
                    self.gift_recall_service.record_recall(
                        gift_id=pending_gift_recall.gift_id,
                        session_id=session_id,
                        trigger=pending_gift_recall.trigger,
                    )
                )

            return turn

        except Exception as e:
            logger.exception("orchestration_failed", error=str(e))
            await self.turn_manager.fail_turn(
                turn_id=turn_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    async def _generate_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        context: ConversationContext,
        turn_id: UUID,
        max_tool_iterations: int = 5,
    ) -> tuple[LLMResponse, list[ToolCall], list[ToolResult]]:
        """Generate response with tool calling loop."""
        all_tool_calls: list[ToolCall] = []
        all_tool_results: list[ToolResult] = []
        current_messages = messages.copy()

        for iteration in range(max_tool_iterations):
            # Call LLM
            response = await self._call_llm_with_fallback(
                messages=current_messages,
                tools=tools if iteration < max_tool_iterations - 1 else None,
            )

            # Check for tool calls
            if not response.tool_calls:
                return response, all_tool_calls, all_tool_results

            # Process tool calls
            tool_calls = [
                ToolCall(
                    id=tc["id"],
                    name=tc["name"],
                    arguments=tc["arguments"],
                    turn_id=turn_id,
                    session_id=context.session_id,
                    user_id=context.user_id,
                    companion_id=context.companion_spec.id,
                )
                for tc in response.tool_calls
            ]

            all_tool_calls.extend(tool_calls)

            # Execute tools
            tool_results = await self.tool_router.execute_tools(tool_calls)
            all_tool_results.extend(tool_results)

            # Add tool results to messages
            current_messages.append({
                "role": "assistant",
                "content": response.content,
                "tool_calls": response.tool_calls,
            })

            for result in tool_results:
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.to_message_content(),
                })

        # Max iterations reached
        logger.warning("max_tool_iterations_reached", turn_id=str(turn_id))
        return response, all_tool_calls, all_tool_results

    async def _call_llm_with_fallback(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        """Call primary LLM with fallback to secondary."""
        provider_name = self.primary_provider.name
        try:
            # Emit provider request event
            await self.event_emitter.emit(
                ProviderEvent(
                    type=EventType.PROVIDER_REQUEST_STARTED,
                    session_id=UUID(int=0),
                    user_id=UUID(int=0),
                    companion_id=UUID(int=0),
                    provider=provider_name,
                    model=self._get_model_for_provider(provider_name),
                    operation="chat_completion",
                )
            )

            response = await self.primary_provider.generate(
                messages=messages,
                tools=tools,
                max_tokens=self._get_max_tokens_for_provider(provider_name),
                temperature=0.7,
            )

            await self.event_emitter.emit(
                ProviderEvent(
                    type=EventType.PROVIDER_REQUEST_COMPLETED,
                    session_id=UUID(int=0),
                    user_id=UUID(int=0),
                    companion_id=UUID(int=0),
                    provider=provider_name,
                    model=self._get_model_for_provider(provider_name),
                    operation="chat_completion",
                    latency_ms=response.latency_ms,
                )
            )

            return response

        except Exception as primary_error:
            fallback_name = self.fallback_provider.name
            logger.warning(
                "primary_provider_failed",
                provider=provider_name,
                error=str(primary_error),
                fallback=fallback_name,
            )

            # Emit fallback event
            await self.event_emitter.emit(
                ProviderEvent(
                    type=EventType.PROVIDER_FALLBACK,
                    session_id=UUID(int=0),
                    user_id=UUID(int=0),
                    companion_id=UUID(int=0),
                    provider=fallback_name,
                    model=self._get_model_for_provider(fallback_name),
                    operation="chat_completion",
                    error_type=type(primary_error).__name__,
                )
            )

            # Try fallback
            return await self.fallback_provider.generate(
                messages=messages,
                tools=tools,
                max_tokens=self._get_max_tokens_for_provider(fallback_name),
                temperature=0.7,
            )

    def _get_model_for_provider(self, provider: str) -> str:
        """Get the model name for a provider."""
        if provider == "ollama":
            return self.settings.ollama_model
        elif provider == "anthropic":
            return self.settings.anthropic_model
        elif provider == "openai":
            return self.settings.openai_model
        return "unknown"

    def _get_max_tokens_for_provider(self, provider: str) -> int:
        """Get max tokens for a provider."""
        if provider == "ollama":
            return self.settings.ollama_max_tokens
        elif provider == "anthropic":
            return self.settings.anthropic_max_tokens
        elif provider == "openai":
            return self.settings.openai_max_tokens
        return 4096

    async def _create_safety_response(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        user_message: str,
        safety_flags: list[str],
    ) -> ConversationTurn:
        """Create a response when input is blocked by safety."""
        turn_id, user_msg = await self.turn_manager.start_turn(
            session_id=session_id,
            user_id=user_id,
            companion_id=companion_spec.id,
            user_message=user_message,
            model="safety_filter",
            prompt_version=self.prompt_manager.current_version,
            policy_version=self.safety_gate.policy_version,
        )

        # Use adult-appropriate safety response when in adult mode
        is_adult = companion_spec.safety_level == "adult"
        template_name = "safety_response_adult" if is_adult else "safety_response"

        safety_response = self.prompt_manager.get_prompt(
            template_name,
            version=self.prompt_manager.current_version,
        )

        return await self.turn_manager.complete_turn(
            turn_id=turn_id,
            assistant_response=safety_response,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=0,
            safety_flags=safety_flags,
        )

    async def _apply_safety_filter(
        self,
        response: LLMResponse,
        safety_flags: list[str],
    ) -> LLMResponse:
        """Apply safety filtering to response content."""
        filtered_content = self.safety_gate.filter_content(
            content=response.content,
            flags=safety_flags,
        )

        return LLMResponse(
            content=filtered_content,
            model=response.model,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            finish_reason="safety_filtered",
            tool_calls=response.tool_calls,
            latency_ms=response.latency_ms,
        )

    def _get_available_tools(
        self,
        allowed_tools: list[str],
    ) -> list[dict[str, Any]]:
        """Get tool definitions for allowed tools."""
        tools = []
        for tool_name in allowed_tools:
            if tool_name in TOOL_REGISTRY:
                tool_def = TOOL_REGISTRY[tool_name]
                tools.append(tool_def.to_anthropic_tool())
        return tools

    def _serialize_tool_call(self, tool_call: ToolCall) -> dict[str, Any]:
        """Serialize a tool call for storage."""
        return {
            "id": tool_call.id,
            "name": tool_call.name,
            "arguments": tool_call.arguments,
            "created_at": tool_call.created_at.isoformat(),
        }

    def _serialize_tool_result(self, tool_result: ToolResult) -> dict[str, Any]:
        """Serialize a tool result for storage."""
        return {
            "tool_call_id": tool_result.tool_call_id,
            "name": tool_result.name,
            "success": tool_result.success,
            "output": tool_result.output,
            "error": tool_result.error,
            "duration_ms": tool_result.duration_ms,
            "cost_usd": tool_result.cost_usd,
        }

    async def _extract_knowledge_graph(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        turn_id: UUID,
        user_message: str,
        assistant_response: str,
    ) -> None:
        """Extract entities and relationships from conversation turn.

        This runs asynchronously after the turn completes to avoid
        adding latency to the user experience.
        """
        # Check if KG extraction is enabled for this companion
        if not getattr(companion_spec, 'allow_kg_extraction', True):
            logger.debug(
                "kg_extraction_disabled",
                companion_id=str(companion_spec.id),
            )
            return

        try:
            # Build the conversation text for extraction
            conversation_text = f"""User: {user_message}
Assistant: {assistant_response}"""

            # Get the extraction prompt
            extraction_prompt = self.prompt_manager.get_prompt(
                "kg_extraction",
                text=conversation_text,
            )

            # Call LLM for extraction (use primary provider - typically OpenAI)
            messages = [
                {"role": "system", "content": "You are a knowledge graph extraction system. Extract entities and relationships from conversations and return valid JSON."},
                {"role": "user", "content": extraction_prompt},
            ]

            response = await self.primary_provider.generate(
                messages=messages,
                tools=None,
                max_tokens=2000,
                temperature=0.1,  # Low temperature for consistent extraction
            )

            # Parse the JSON response
            try:
                # Try to extract JSON from the response
                content = response.content.strip()
                # Handle markdown code blocks
                if content.startswith("```"):
                    lines = content.split("\n")
                    content = "\n".join(lines[1:-1])
                
                kg_data = json.loads(content)
            except json.JSONDecodeError as e:
                logger.warning(
                    "kg_extraction_parse_failed",
                    error=str(e),
                    content_preview=response.content[:200],
                )
                return

            entities = kg_data.get("entities", [])
            relationships = kg_data.get("relationships", [])

            if not entities and not relationships:
                logger.debug(
                    "kg_extraction_empty",
                    session_id=str(session_id),
                    turn_id=str(turn_id),
                )
                return

            logger.info(
                "kg_extraction_completed",
                session_id=str(session_id),
                turn_id=str(turn_id),
                entity_count=len(entities),
                relationship_count=len(relationships),
            )

            # Add jobs to queue for each relationship
            for rel in relationships:
                source_entity = rel.get("source")
                target_entity = rel.get("target")
                relation_type = rel.get("type", "related_to")

                if not source_entity or not target_entity:
                    continue

                # Generate IDs for entities and edge
                source_id = str(uuid4())
                target_id = str(uuid4())
                edge_id = str(uuid4())

                edge_data = {
                    "id": edge_id,
                    "sourceEntity": source_id,
                    "targetEntity": target_id,
                    "relationType": relation_type,
                    "confidence": rel.get("confidence", 0.8),
                    "sourceEventId": str(turn_id),
                }

                entity_data = [
                    {
                        "id": source_id,
                        "name": source_entity,
                        "type": self._infer_entity_type(source_entity, entities),
                    },
                    {
                        "id": target_id,
                        "name": target_entity,
                        "type": self._infer_entity_type(target_entity, entities),
                    },
                ]

                # Add job to queue for worker processing
                if self.job_queue:
                    try:
                        await self.job_queue.add_kg_proposal_job(
                            user_id=str(user_id),
                            companion_id=str(companion_spec.id),
                            edge=edge_data,
                            entities=entity_data,
                        )
                    except Exception as queue_error:
                        logger.warning(
                            "kg_queue_job_failed",
                            error=str(queue_error),
                            edge_id=edge_id,
                        )

                # Also emit event for audit/tracking
                await self.event_emitter.emit(
                    BaseEvent(
                        type=EventType.KG_PROPOSE,
                        session_id=session_id,
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        payload={
                            "edge": edge_data,
                            "entities": entity_data,
                        },
                    )
                )

        except Exception as e:
            logger.error(
                "kg_extraction_failed",
                error=str(e),
                session_id=str(session_id),
                turn_id=str(turn_id),
            )

    def _infer_entity_type(
        self,
        entity_name: str,
        entities: list[dict[str, Any]],
    ) -> str:
        """Infer entity type from extraction results."""
        for entity in entities:
            if entity.get("name") == entity_name or entity.get("id") == entity_name:
                return entity.get("type", "unknown")
        return "unknown"
