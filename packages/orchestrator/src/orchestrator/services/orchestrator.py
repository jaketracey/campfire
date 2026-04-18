"""Main conversation orchestrator service."""

import asyncio
from datetime import datetime
import json
import re
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
from orchestrator.models.events import (
    BaseEvent,
    ContentBlockedEvent,
    ContentRoutingEvent,
    CostTrackingEvent,
    EventType,
    ProviderEvent,
)
from orchestrator.routing import (
    ContentCapability,
    IntentDetector,
    MODEL_REGISTRY,
    ModelRouter,
    RoutingDecision,
    get_model,
)
from orchestrator.models.gifts import GiftMemory, GiftRecallContext
from orchestrator.models.memory import LongTermMemory, CompanionSelfKnowledge
from orchestrator.models.tools import TOOL_REGISTRY, ToolCall, ToolCallContext, ToolResult
from orchestrator.prompts.manager import PromptManager
from orchestrator.providers.base import LLMProvider, LLMResponse
from orchestrator.providers.anthropic import AnthropicProvider
from orchestrator.providers.openai import OpenAIProvider
from orchestrator.providers.ollama import OllamaProvider
from orchestrator.providers.bedrock import BedrockProvider
from orchestrator.providers.sagemaker import SageMakerProvider
from orchestrator.queue import JobQueue
from orchestrator.safety.gate import SafetyGate
from orchestrator.services.context_builder import ContextBuilder
from orchestrator.services.emotional_state import EmotionalStateService, get_emotional_state_service
from orchestrator.services.gift_recall import GiftRecallService
from orchestrator.services.hybrid_search import (
    get_hybrid_search_service,
    HybridSearchService,
    KGContextItem,
    SearchQuery,
)
from orchestrator.services.kg_extraction import get_kg_extraction_service, KGExtractionService
from orchestrator.services.routing_config_service import RoutingConfigService
from orchestrator.services.session_summarization import (
    get_session_summarization_service,
    SessionSummarizationService,
)
from orchestrator.services.tenet_retriever import TenetRetriever
from orchestrator.services.temporal_context import TemporalContext, TemporalContextService
from orchestrator.services.turn_manager import TurnManager
from orchestrator.utils import (
    build_tool_context_metadata,
    normalize_tool_name,
    normalize_tool_names,
)
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
        intent_detector: IntentDetector | None = None,
        model_router: ModelRouter | None = None,
        routing_config_service: RoutingConfigService | None = None,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.prompt_manager = prompt_manager
        self.safety_gate = safety_gate
        self.tool_router = tool_router
        self.job_queue = job_queue

        # Initialize providers
        # Priority: provided > Bedrock (prod) > Ollama (dev) > OpenAI
        if primary_provider:
            self.primary_provider = primary_provider
        elif settings.bedrock_enabled:
            self.primary_provider = BedrockProvider(settings)
            logger.info("using_bedrock_provider", model=settings.bedrock_default_model)
        elif settings.ollama_enabled:
            self.primary_provider = OllamaProvider(settings)
            logger.info("using_ollama_provider", model=settings.ollama_model)
        else:
            self.primary_provider = OpenAIProvider(settings)

        self.fallback_provider = fallback_provider or AnthropicProvider(settings)

        # Optional SageMaker provider for custom fine-tuned models
        self.sagemaker_provider: SageMakerProvider | None = None
        if settings.sagemaker_enabled and settings.sagemaker_endpoint_name:
            self.sagemaker_provider = SageMakerProvider(settings)
            logger.info("sagemaker_provider_enabled", endpoint=settings.sagemaker_endpoint_name)

        # Initialize services
        self.context_builder = ContextBuilder(
            prompt_manager=prompt_manager,
            max_context_tokens=settings.max_context_tokens,
            default_turn_window=settings.default_turn_window,
        )
        self.turn_manager = TurnManager(event_emitter)
        self.tenet_retriever = tenet_retriever or TenetRetriever(settings)
        self.gift_recall_service = gift_recall_service or GiftRecallService(settings)
        self.temporal_context_service = TemporalContextService()

        # Store routing config service for database-driven routing
        self.routing_config_service = routing_config_service

        # Initialize content routing (if enabled)
        self._content_routing_enabled = settings.content_routing_enabled
        if self._content_routing_enabled:
            self.intent_detector = intent_detector or IntentDetector(
                semantic_threshold=settings.semantic_routing_threshold,
                classifier_threshold=settings.classifier_routing_threshold,
            )
            self.model_router = model_router or ModelRouter(
                intent_detector=self.intent_detector,
                prefer_local=settings.prefer_local_models,
                routing_config_service=routing_config_service,
            )
            logger.info(
                "content_routing_enabled",
                semantic_threshold=settings.semantic_routing_threshold,
                classifier_threshold=settings.classifier_routing_threshold,
                prefer_local=settings.prefer_local_models,
                db_routing_enabled=routing_config_service is not None,
            )
        else:
            self.intent_detector = None
            self.model_router = None

        # Store current routing decision for use during LLM calls
        self._current_routing_decision: RoutingDecision | None = None

        # Initialize KG extraction service
        self._kg_extraction_service: KGExtractionService | None = None
        if settings.kg_extraction_enabled:
            self._kg_extraction_service = get_kg_extraction_service(settings)
            logger.info(
                "kg_extraction_enabled",
                model=settings.kg_extraction_model,
                interval=settings.kg_extraction_interval,
            )

        # Track last extraction turn per session for rate limiting
        self._last_extraction_turns: dict[UUID, int] = {}

        # Initialize session summarization service
        self._summarization_service: SessionSummarizationService | None = None
        if settings.session_summarization_enabled:
            self._summarization_service = get_session_summarization_service(settings)
            logger.info(
                "session_summarization_enabled",
                threshold=settings.session_summarization_threshold,
                interval=settings.session_summarization_interval,
            )

        # Track last summarization turn per session
        self._last_summarization_turns: dict[UUID, int] = {}

        # Initialize hybrid search service for enhanced memory + KG retrieval
        self._hybrid_search_service: HybridSearchService | None = None
        if settings.kg_extraction_enabled:  # Hybrid search depends on KG being available
            self._hybrid_search_service = get_hybrid_search_service(settings)
            logger.info(
                "hybrid_search_enabled",
                kg_traversal_depth=1,
                rrf_k=60,
            )

        # Initialize emotional state service
        self._emotional_state_service = get_emotional_state_service(settings)

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
        user_image_url: str | None = None,
        active_game: dict | None = None,
        liked_content: list[dict] | None = None,
        engagement_level: str | None = None,
        user_timezone: str | None = None,
        user_display_name: str | None = None,
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

        # Content routing - route to appropriate model based on intent
        routing_decision: RoutingDecision | None = None
        if self._content_routing_enabled:
            routing_decision = await self._route_content(
                user_message=user_message,
                companion_spec=companion_spec,
            )

            if routing_decision:
                # Emit content routing event
                await self.event_emitter.emit(
                    ContentRoutingEvent(
                        type=EventType.CONTENT_ROUTED,
                        session_id=session_id,
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        intent=routing_decision.intent_result.intent.value,
                        confidence=routing_decision.intent_result.confidence,
                        detection_method=routing_decision.intent_result.detection_method,
                        selected_model=(
                            routing_decision.model_spec.model_id
                            if routing_decision.model_spec
                            else "none"
                        ),
                        selected_provider=(
                            routing_decision.model_spec.provider
                            if routing_decision.model_spec
                            else "none"
                        ),
                        routing_reason=routing_decision.routing_reason,
                        content_blocked=routing_decision.content_blocked,
                        block_reason=routing_decision.block_reason,
                        latency_ms=routing_decision.intent_result.latency_ms,
                    )
                )

                # Check if content should be blocked/redirected
                if routing_decision.content_blocked:
                    # Emit content blocked event
                    await self.event_emitter.emit(
                        ContentBlockedEvent(
                            type=EventType.CONTENT_BLOCKED,
                            session_id=session_id,
                            user_id=user_id,
                            companion_id=companion_spec.id,
                            detected_intent=routing_decision.intent_result.intent.value,
                            companion_safety_level=companion_spec.safety_level,
                            block_reason=routing_decision.block_reason or "Content exceeds safety level",
                        )
                    )

                    logger.warning(
                        "content_blocked_by_routing",
                        user_id=str(user_id),
                        intent=routing_decision.intent_result.intent.value,
                        safety_level=companion_spec.safety_level,
                        block_reason=routing_decision.block_reason,
                    )

                    # Return an in-character redirect response
                    return await self._create_content_redirect_response(
                        session_id=session_id,
                        user_id=user_id,
                        companion_spec=companion_spec,
                        user_message=user_message,
                        routing_decision=routing_decision,
                    )

                # Store routing decision for use in _call_llm_with_fallback
                self._current_routing_decision = routing_decision

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

            # Perform hybrid search to get KG context (if enabled)
            kg_context: list[KGContextItem] = []
            if self._hybrid_search_service:
                try:
                    search_query = SearchQuery(
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        query_text=user_message,
                        limit=self.settings.memory_search_top_k,
                        min_similarity=self.settings.memory_relevance_threshold,
                        include_kg_context=True,
                        kg_traversal_depth=1,
                    )

                    hybrid_result = await self._hybrid_search_service.search(search_query)

                    # Use KG context from hybrid search
                    kg_context = hybrid_result.kg_context

                    if kg_context:
                        logger.debug(
                            "hybrid_search_kg_context",
                            user_id=str(user_id),
                            companion_id=str(companion_spec.id),
                            kg_entity_count=len(kg_context),
                            entities=[item.entity_name for item in kg_context],
                        )
                except Exception as e:
                    logger.warning(
                        "hybrid_search_failed",
                        error=str(e),
                        user_id=str(user_id),
                        companion_id=str(companion_spec.id),
                    )

            # Proactive memory injection: automatically retrieve relevant
            # memories based on the user message so the character "naturally
            # remembers" things without the LLM needing to call memory_read.
            if (
                self.settings.proactive_memory_enabled
                and self._hybrid_search_service
            ):
                try:
                    proactive_query = SearchQuery(
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        query_text=user_message,
                        limit=self.settings.proactive_memory_top_k,
                        min_similarity=self.settings.memory_relevance_threshold,
                        include_kg_context=False,
                    )
                    proactive_result = await self._hybrid_search_service.search(
                        proactive_query
                    )

                    if proactive_result.memories:
                        # Deduplicate against already-provided long_term_memories
                        existing_ids = {
                            m.id for m in (long_term_memories or [])
                        }
                        new_memories = [
                            m
                            for m in proactive_result.memories
                            if m.id not in existing_ids
                        ]

                        if new_memories:
                            long_term_memories = list(
                                long_term_memories or []
                            ) + new_memories
                            logger.debug(
                                "proactive_memories_injected",
                                user_id=str(user_id),
                                companion_id=str(companion_spec.id),
                                injected_count=len(new_memories),
                                total_memories=len(long_term_memories),
                            )
                except Exception as e:
                    logger.warning(
                        "proactive_memory_injection_failed",
                        error=str(e),
                        user_id=str(user_id),
                        companion_id=str(companion_spec.id),
                    )

            # Build temporal context for time awareness
            temporal_ctx: TemporalContext | None = None
            try:
                temporal_ctx = await self.temporal_context_service.build_temporal_context(
                    user_id=user_id,
                    companion_id=companion_spec.id,
                    user_timezone=user_timezone,
                )
                logger.debug(
                    "temporal_context_built",
                    user_id=str(user_id),
                    companion_id=str(companion_spec.id),
                    time_of_day=temporal_ctx.time_of_day.value,
                    total_sessions=temporal_ctx.total_sessions,
                )
            except Exception as e:
                logger.warning(
                    "temporal_context_build_failed",
                    error=str(e),
                    user_id=str(user_id),
                    companion_id=str(companion_spec.id),
                )

            # Fetch and optionally decay emotional state
            emotional_state = None
            try:
                emotional_state = await self._emotional_state_service.get_current_state(
                    companion_id=companion_spec.id,
                    user_id=user_id,
                )
                # Apply time-based decay before using the state
                emotional_state = await self._emotional_state_service.apply_time_decay(
                    companion_id=companion_spec.id,
                    user_id=user_id,
                    companion_spec=companion_spec,
                )
            except Exception as e:
                logger.warning(
                    "emotional_state_fetch_failed",
                    error=str(e),
                    companion_id=str(companion_spec.id),
                    user_id=str(user_id),
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

            # Build messages with gift context, companion self-knowledge, KG context, temporal context, and emotional state
            messages = self.context_builder.build_messages(
                context=context,
                current_user_message=user_message,
                gift_memories=gift_memories,
                pending_gift_recall=pending_gift_recall,
                companion_self_knowledge=companion_self_knowledge,
                user_image_url=user_image_url,
                active_game=active_game,
                liked_content=liked_content,
                engagement_level=engagement_level,
                kg_context=kg_context,
                temporal_context=temporal_ctx,
                user_display_name=user_display_name,
                emotional_state=emotional_state,
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

            # Parse image_prompt from response content
            cleaned_content, image_prompt = self._parse_image_prompt(response.content)
            tool_context_metadata: dict[str, Any] = build_tool_context_metadata(
                [self._serialize_tool_call(tc) for tc in tool_calls],
                [self._serialize_tool_result(tr) for tr in tool_results],
            )
            current_turn_count = len(recent_turns) + 1 if recent_turns else 1
            generated_image_url = self._extract_generated_image_url(
                tool_context_metadata["tool_results"]
            )

            # Complete turn
            turn = await self.turn_manager.complete_turn(
                turn_id=turn_id,
                assistant_response=cleaned_content,
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
                latency_ms=latency_ms,
                tools_invoked=tool_context_metadata["tools_invoked"],
                tool_calls=tool_context_metadata["tool_calls"],
                tool_results=tool_context_metadata["tool_results"],
                safety_flags=all_safety_flags,
                image_prompt=image_prompt,
            )

            # Emit cost tracking event (fire-and-forget)
            # Determine provider and model used
            provider_name = (
                self._current_routing_decision.model_spec.provider
                if self._current_routing_decision and self._current_routing_decision.model_spec
                else ("bedrock" if self.settings.bedrock_enabled else "ollama" if self.settings.ollama_enabled else "anthropic")
            )
            model_name = (
                self._current_routing_decision.model_spec.model_id
                if self._current_routing_decision and self._current_routing_decision.model_spec
                else response.model or self.settings.bedrock_default_model if self.settings.bedrock_enabled else self.settings.ollama_model
            )
            asyncio.create_task(
                self._emit_cost_tracking_event(
                    session_id=session_id,
                    user_id=user_id,
                    companion_id=companion_spec.id,
                    turn_id=turn_id,
                    response=response,
                    provider=provider_name,
                    model=model_name,
                )
            )

            # Fire-and-forget KG extraction (don't block response)
            # Calculate turn count from recent turns for rate limiting
            current_turn_count = len(recent_turns) + 1 if recent_turns else 1
            asyncio.create_task(
                self._extract_knowledge_graph(
                    session_id=session_id,
                    user_id=user_id,
                    companion_spec=companion_spec,
                    turn_id=turn_id,
                    user_message=user_message,
                    assistant_response=cleaned_content,
                    turn_count=current_turn_count,
                )
            )

            # Fire-and-forget session summarization (at threshold)
            asyncio.create_task(
                self._summarize_session_if_needed(
                    session_id=session_id,
                    user_id=user_id,
                    companion_spec=companion_spec,
                turn_count=current_turn_count,
                recent_turns=recent_turns,
                user_message=user_message,
                assistant_response=cleaned_content,
            )
            )

            # Fire-and-forget emotional state update based on turn content
            asyncio.create_task(
                self._update_emotional_state_after_turn(
                    companion_id=companion_spec.id,
                    user_id=user_id,
                    user_message=user_message,
                    assistant_response=cleaned_content,
                    companion_spec=companion_spec,
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

            # Stream mode returns structured streamed chunks with the same tool context.
            if stream:
                return self._stream_turn_response(
                    turn=turn,
                    tool_calls=tool_context_metadata["tool_calls"],
                    tool_results=tool_context_metadata["tool_results"],
                    image_prompt=image_prompt,
                    generated_image_url=generated_image_url,
                )

            # Reset routing decision after turn completes
            self._current_routing_decision = None

            return turn

        except Exception as e:
            logger.exception("orchestration_failed", error=str(e))
            await self.turn_manager.fail_turn(
                turn_id=turn_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            # Reset routing decision on error
            self._current_routing_decision = None
            raise

    async def _stream_turn_response(
        self,
        turn: ConversationTurn,
        tool_calls: list[dict[str, Any]],
        tool_results: list[dict[str, Any]],
        image_prompt: str | None = None,
        generated_image_url: str | None = None,
        tooling_unavailable_reason: str | None = None,
        chunk_size: int = 64,
    ) -> AsyncGenerator[str, None]:
        """Emit streamed assistant content and final tool metadata payload."""
        content = turn.assistant_message.content if turn.assistant_message else ""
        if not content:
            content = ""

        for index in range(0, len(content), chunk_size):
            yield content[index:index + chunk_size]

        metadata = build_tool_context_metadata(
            tool_calls=tool_calls,
            tool_results=tool_results,
            tooling_unavailable_reason=tooling_unavailable_reason,
        )
        if generated_image_url:
            metadata["generated_image_url"] = generated_image_url
        if image_prompt:
            metadata["image_prompt"] = image_prompt

        yield f"[METADATA]{json.dumps(metadata)}"

    def _extract_generated_image_url(self, tool_results: list[dict[str, Any]]) -> str | None:
        """Extract the latest generated image URL from image generation tool results."""
        for tool_result in reversed(tool_results):
            if normalize_tool_name(str(tool_result.get("name", ""))) != "image_generation":
                continue

            metadata = tool_result.get("metadata")
            if isinstance(metadata, dict):
                image_url = self._to_string_or_none(metadata.get("image_url"))
                if image_url:
                    return image_url

            output = tool_result.get("output")
            if isinstance(output, str):
                image_url_match = re.search(r"https?://\S+", output)
                if image_url_match:
                    return image_url_match.group(0).rstrip(".,)")

        return None


    @staticmethod
    def _to_string_or_none(value: Any) -> str | None:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return None

    def clear_current_routing_decision(self) -> None:
        """Clear cached routing decision after a stream request has fully completed."""
        self._current_routing_decision = None

    def get_last_model_info(self) -> dict[str, str | int | None]:
        """Get information about the last model used for LLM generation.

        Returns dict with provider, model, prompt_tokens, completion_tokens.
        Returns empty values if no routing decision is available.
        """
        if not self._current_routing_decision or not self._current_routing_decision.model_spec:
            # Fall back to primary provider info
            return {
                "provider": self.primary_provider.name if self.primary_provider else None,
                "model": self._get_model_for_provider(self.primary_provider.name) if self.primary_provider else None,
                "prompt_tokens": None,
                "completion_tokens": None,
            }

        model_spec = self._current_routing_decision.model_spec
        return {
            "provider": model_spec.provider,
            "model": model_spec.model_id,
            "prompt_tokens": None,  # Will be filled in by caller if available
            "completion_tokens": None,
        }

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
        all_background_image_tasks: list[tuple[ToolCall, asyncio.Task[ToolResult]]] = []
        current_messages = messages.copy()

        for iteration in range(max_tool_iterations):
            # Call LLM
            response = await self._call_llm_with_fallback(
                messages=current_messages,
                tools=tools if iteration < max_tool_iterations - 1 else None,
            )

            # Check for tool calls
            if not response.tool_calls:
                # Collect any background image results before returning
                await self._collect_background_image_results(all_background_image_tasks, all_tool_results)
                return response, all_tool_calls, all_tool_results

            # Process tool calls
            tool_calls: list[ToolCall] = []
            for raw_tool_call in response.tool_calls:
                normalized_tool_call = self._coerce_tool_call(
                    raw_tool_call,
                    turn_id,
                    context,
                )
                if normalized_tool_call is not None:
                    tool_calls.append(normalized_tool_call)
            if len(tool_calls) != len(response.tool_calls):
                logger.warning(
                    "tool_call_normalization_filtered",
                    expected_count=len(response.tool_calls),
                    normalized_count=len(tool_calls),
                )

            all_tool_calls.extend(tool_calls)

            # Image generation runs in background — give LLM a fast placeholder
            # so it can write its text response immediately (~3s instead of ~15s)
            sync_tool_calls: list[ToolCall] = []

            for tc in tool_calls:
                if normalize_tool_name(tc.name) == "image_generation":
                    # Fire image gen in background
                    task = asyncio.create_task(self.tool_router.execute_tool(tc))
                    all_background_image_tasks.append((tc, task))
                    # Give LLM a fast placeholder result
                    all_tool_results.append(ToolResult(
                        tool_call_id=tc.id,
                        name=tc.name,
                        success=True,
                        output="Image generated successfully. It will appear in the chat.",
                        duration_ms=50,
                        metadata={"async": True, "image_url": "pending"},
                    ))
                else:
                    sync_tool_calls.append(tc)

            # Execute synchronous tools normally
            if sync_tool_calls:
                sync_results = await self.tool_router.execute_tools(sync_tool_calls)
                all_tool_results.extend(sync_results)

            # Add tool results to messages for next LLM iteration
            current_messages.append({
                "role": "assistant",
                "content": response.content,
                "tool_calls": response.tool_calls,
            })

            # Combine sync results + placeholder results for the message context
            iteration_results = list(sync_results) if sync_tool_calls else []
            for tc, _ in all_background_image_tasks:
                # Find the placeholder result for this tool call
                for r in all_tool_results:
                    if r.tool_call_id == tc.id:
                        iteration_results.append(r)
                        break

            for result in iteration_results:
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": result.tool_call_id,
                    "content": result.to_message_content(),
                })

        # Collect any remaining background image results
        await self._collect_background_image_results(all_background_image_tasks, all_tool_results)

        # Max iterations reached
        logger.warning("max_tool_iterations_reached", turn_id=str(turn_id))
        return response, all_tool_calls, all_tool_results

    @staticmethod
    async def _collect_background_image_results(
        tasks: list[tuple[ToolCall, asyncio.Task[ToolResult]]],
        all_results: list[ToolResult],
    ) -> None:
        """Collect results from background image generation tasks, replacing placeholders."""
        for tc, task in tasks:
            if task.done() or not task.cancelled():
                try:
                    real_result = await task
                    for i, r in enumerate(all_results):
                        if r.tool_call_id == tc.id and r.metadata and r.metadata.get("async"):
                            all_results[i] = real_result
                            break
                    logger.info(
                        "background_image_gen_completed",
                        tool_call_id=tc.id,
                        success=real_result.success,
                        has_image=bool(real_result.metadata and real_result.metadata.get("image_url")),
                    )
                except Exception as e:
                    logger.warning("background_image_gen_failed", error=str(e), tool_call_id=tc.id)

    async def _call_llm_with_fallback(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        """Call primary LLM with fallback to secondary.

        When content routing is enabled and a routing decision is available,
        the selected provider/model from routing will be used instead of
        the default primary provider.
        """
        # Use routed provider/model if available from content routing
        provider, model_id = self._get_routed_provider_and_model()
        provider_name = provider.name if provider else self.primary_provider.name
        active_provider = provider or self.primary_provider

        try:
            # Emit provider request event
            await self.event_emitter.emit(
                ProviderEvent(
                    type=EventType.PROVIDER_REQUEST_STARTED,
                    session_id=UUID(int=0),
                    user_id=UUID(int=0),
                    companion_id=UUID(int=0),
                    provider=provider_name,
                    model=model_id or self._get_model_for_provider(provider_name),
                    operation="chat_completion",
                )
            )

            response = await active_provider.generate(
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
                    model=model_id or self._get_model_for_provider(provider_name),
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

    def _get_routed_provider_and_model(self) -> tuple[LLMProvider | None, str | None]:
        """Get the provider and model from content routing decision.

        Returns:
            Tuple of (provider, model_id) if routing decision has a selected model,
            otherwise (None, None) to use default provider.
        """
        if not self._current_routing_decision or not self._current_routing_decision.model_spec:
            return None, None

        model_spec = self._current_routing_decision.model_spec
        provider_name = model_spec.provider.lower()

        logger.info(
            "using_routed_model",
            provider=provider_name,
            model_id=model_spec.model_id,
            is_abliterated=model_spec.is_abliterated,
        )

        # Map provider name to provider instance
        if provider_name == "bedrock" and self.settings.bedrock_enabled:
            # Route to Bedrock with the specified model
            if self.primary_provider.name == "bedrock":
                routed_provider = self.primary_provider.with_model(model_spec.model_id)
                return routed_provider, model_spec.model_id
            # Create a new Bedrock provider for this model
            bedrock_provider = BedrockProvider(self.settings, model_override=model_spec.model_id)
            return bedrock_provider, model_spec.model_id

        elif provider_name == "sagemaker" and self.sagemaker_provider:
            # Route to SageMaker endpoint
            routed_provider = self.sagemaker_provider.with_model(model_spec.model_id)
            return routed_provider, model_spec.model_id

        elif provider_name == "ollama" and self.settings.ollama_enabled:
            # For Ollama, dynamically use the routed model
            if self.primary_provider.name == "ollama":
                routed_provider = self.primary_provider.with_model(model_spec.model_id)
                return routed_provider, model_spec.model_id
            return None, None

        elif provider_name == "anthropic":
            if self.primary_provider.name == "anthropic":
                return self.primary_provider, model_spec.model_id
            elif self.fallback_provider.name == "anthropic":
                return self.fallback_provider, model_spec.model_id

        elif provider_name == "openai":
            if self.primary_provider.name == "openai":
                return self.primary_provider, model_spec.model_id
            elif self.fallback_provider.name == "openai":
                return self.fallback_provider, model_spec.model_id

        return None, None

    def _get_model_for_provider(self, provider: str) -> str:
        """Get the model name for a provider."""
        if provider == "bedrock":
            return self.settings.bedrock_default_model
        elif provider == "sagemaker":
            return self.settings.sagemaker_endpoint_name
        elif provider == "ollama":
            return self.settings.ollama_model
        elif provider == "anthropic":
            return self.settings.anthropic_model
        elif provider == "openai":
            return self.settings.openai_model
        return "unknown"

    def _get_max_tokens_for_provider(self, provider: str) -> int:
        """Get max tokens for a provider."""
        if provider == "bedrock":
            return self.settings.bedrock_max_tokens
        elif provider == "sagemaker":
            return self.settings.sagemaker_max_tokens
        elif provider == "ollama":
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
        template_name = (
            "orchestrator.safety_response_adult"
            if is_adult
            else "orchestrator.safety_response"
        )

        safety_response = self.prompt_manager.get_prompt_effective(
            template_name,
            version=self.prompt_manager.current_version,
            companion_id=str(companion_spec.id),
        )

        return await self.turn_manager.complete_turn(
            turn_id=turn_id,
            assistant_response=safety_response,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=0,
            safety_flags=safety_flags,
        )

    async def _route_content(
        self,
        user_message: str,
        companion_spec: CompanionSpec,
    ) -> RoutingDecision | None:
        """Route content to appropriate model based on intent and companion settings.

        Uses database routing rules first (chat_simple/chat_complex), falling back
        to capability-based routing if DB routing returns no match.

        Args:
            user_message: The user's message to analyze.
            companion_spec: The companion specification with safety settings.

        Returns:
            RoutingDecision with selected model or block reason, or None if
            content routing is disabled.
        """
        if not self._content_routing_enabled or not self.model_router:
            return None

        # Try DB routing first — respects configured model preferences
        use_case = "chat_complex" if companion_spec.allowed_tools else "chat_simple"
        db_model = await self.model_router.route_by_use_case(
            use_case=use_case,
            companion_id=companion_spec.id if hasattr(companion_spec, "id") else None,
        )
        if db_model:
            # Still need intent detection for safety gating
            routing_decision = await self.model_router.route(
                user_message=user_message,
                companion_safety_level=companion_spec.safety_level,
                require_tools=bool(companion_spec.allowed_tools),
            )
            if routing_decision and not routing_decision.content_blocked:
                # Override the capability-selected model with the DB-routed one
                routing_decision = RoutingDecision(
                    model_spec=db_model,
                    intent_result=routing_decision.intent_result,
                    routing_reason=f"DB routing: {use_case} → {db_model.model_id}",
                    fallback_used=False,
                    content_blocked=False,
                )
            return routing_decision

        # Fallback to capability-based routing
        return await self.model_router.route(
            user_message=user_message,
            companion_safety_level=companion_spec.safety_level,
            require_tools=bool(companion_spec.allowed_tools),
        )

    async def _create_content_redirect_response(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        user_message: str,
        routing_decision: RoutingDecision,
    ) -> ConversationTurn:
        """Create an in-character response that redirects the conversation.

        When content is blocked due to safety level restrictions, this method
        generates a response that stays in-character while gently redirecting
        the conversation to appropriate topics.

        Args:
            session_id: The session ID.
            user_id: The user ID.
            companion_spec: The companion specification.
            user_message: The original user message.
            routing_decision: The routing decision with block reason.

        Returns:
            A conversation turn with the redirect response.
        """
        turn_id, user_msg = await self.turn_manager.start_turn(
            session_id=session_id,
            user_id=user_id,
            companion_id=companion_spec.id,
            user_message=user_message,
            model="content_router",
            prompt_version=self.prompt_manager.current_version,
            policy_version=self.safety_gate.policy_version,
        )

        redirect_response = self.prompt_manager.get_prompt_effective(
            "orchestrator.content_redirect",
            version=self.prompt_manager.current_version,
            companion_id=str(companion_spec.id),
            companion_name=companion_spec.name,
            detected_intent=routing_decision.intent_result.intent.value,
        )

        return await self.turn_manager.complete_turn(
            turn_id=turn_id,
            assistant_response=redirect_response,
            prompt_tokens=0,
            completion_tokens=0,
            latency_ms=routing_decision.intent_result.latency_ms,
            safety_flags=["content_redirect", routing_decision.intent_result.intent.value],
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
        normalized_tools = normalize_tool_names(allowed_tools)
        for tool_name in normalized_tools:
            if tool_name in TOOL_REGISTRY:
                tool_def = TOOL_REGISTRY[tool_name]
                tools.append(tool_def.to_anthropic_tool())
        return tools

    @staticmethod
    def _coerce_tool_status(value: Any) -> str:
        if isinstance(value, str):
            status = value.strip().lower()
            if status in {"requested", "running", "succeeded", "failed", "cancelled"}:
                return status
        return "requested"

    @staticmethod
    def _coerce_attempt_count(value: Any) -> int:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return max(1, int(value))
        return 1

    @staticmethod
    def _coerce_tool_arguments(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                logger.warning("tool_arguments_json_parse_failed", raw=value[:200])
        return {}

    def _coerce_tool_timestamp(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None

    @staticmethod
    def _coerce_tool_name(raw_name: Any) -> str:
        if isinstance(raw_name, str):
            return normalize_tool_name(raw_name)
        return ""

    def _coerce_tool_call(
        self,
        raw_tool_call: Any,
        turn_id: UUID,
        context: ConversationContext,
    ) -> ToolCall | None:
        if not isinstance(raw_tool_call, dict):
            logger.warning("invalid_tool_call_payload", tool_call_type=str(type(raw_tool_call)))
            return None

        tool_call_id = raw_tool_call.get("id") or raw_tool_call.get("tool_call_id")
        if not isinstance(tool_call_id, str) or not tool_call_id.strip():
            tool_call_id = str(uuid4())

        function_payload = raw_tool_call.get("function")
        if isinstance(function_payload, dict):
            raw_name = raw_tool_call.get("name") or function_payload.get("name")
            raw_arguments = raw_tool_call.get("arguments", function_payload.get("arguments"))
        else:
            raw_name = raw_tool_call.get("name")
            raw_arguments = raw_tool_call.get("arguments")

        name = self._coerce_tool_name(raw_name)
        if not name:
            logger.warning("tool_call_missing_name", raw_tool_call_id=tool_call_id)
            return None

        tool_call_context = ToolCallContext(
            companion_spec=context.companion_spec.model_dump(),
            recent_turns=[
                {"role": "user", "content": t.user_message.content}
                for t in context.recent_turns[-5:]
                if t.user_message
            ] + [
                {"role": "assistant", "content": t.assistant_message.content}
                for t in context.recent_turns[-5:]
                if t.assistant_message
            ],
        )

        return ToolCall(
            id=tool_call_id,
            name=name,
            arguments=self._coerce_tool_arguments(raw_arguments),
            turn_id=turn_id,
            session_id=context.session_id,
            user_id=context.user_id,
            companion_id=context.companion_spec.id,
            context=tool_call_context,
            status=self._coerce_tool_status(raw_tool_call.get("status")),
            attempt_count=self._coerce_attempt_count(raw_tool_call.get("attempt_count")),
            started_at=self._coerce_tool_timestamp(raw_tool_call.get("started_at")),
            ended_at=self._coerce_tool_timestamp(raw_tool_call.get("ended_at")),
        )

    def _serialize_tool_call(self, tool_call: ToolCall) -> dict[str, Any]:
        """Serialize a tool call for storage."""
        return {
            "id": tool_call.id,
            "name": tool_call.name,
            "arguments": tool_call.arguments,
            "created_at": tool_call.created_at.isoformat(),
            "status": tool_call.status,
            "attempt_count": tool_call.attempt_count,
            "started_at": tool_call.started_at.isoformat() if tool_call.started_at else None,
            "ended_at": tool_call.ended_at.isoformat() if tool_call.ended_at else None,
        }

    def _serialize_tool_result(self, tool_result: ToolResult) -> dict[str, Any]:
        """Serialize a tool result for storage."""
        return {
            "tool_call_id": tool_result.tool_call_id,
            "name": tool_result.name,
            "success": tool_result.success,
            "output": tool_result.output,
            "error": tool_result.error,
            "status": tool_result.status,
            "attempt_count": tool_result.attempt_count,
            "started_at": tool_result.started_at.isoformat() if tool_result.started_at else None,
            "ended_at": tool_result.ended_at.isoformat() if tool_result.ended_at else None,
            "created_at": tool_result.created_at.isoformat(),
            "duration_ms": tool_result.duration_ms,
            "cost_usd": tool_result.cost_usd,
            "metadata": tool_result.metadata,
        }

    async def _emit_cost_tracking_event(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_id: UUID,
        turn_id: UUID,
        response: LLMResponse,
        provider: str,
        model: str,
    ) -> None:
        """Emit a cost tracking event for the LLM call.

        Calculates cost based on token usage and model pricing from the registry.
        """
        # Get model spec for pricing info
        model_spec = get_model(model)

        # Calculate cost
        if model_spec:
            input_cost = (response.prompt_tokens / 1_000_000) * model_spec.cost_per_1m_input
            output_cost = (response.completion_tokens / 1_000_000) * model_spec.cost_per_1m_output
            cost_usd = input_cost + output_cost
        else:
            # Default to zero for unknown models (e.g., local Ollama)
            cost_usd = 0.0

        # Only emit if there are actual tokens used
        if response.prompt_tokens == 0 and response.completion_tokens == 0:
            return

        event = CostTrackingEvent(
            type=EventType.COST_INCURRED,
            session_id=session_id,
            user_id=user_id,
            companion_id=companion_id,
            turn_id=turn_id,
            provider=provider,
            model=model,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            total_tokens=response.prompt_tokens + response.completion_tokens,
            cost_usd=cost_usd,
        )

        await self.event_emitter.emit(event)

        logger.info(
            "cost_tracking_event_emitted",
            turn_id=str(turn_id),
            provider=provider,
            model=model,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            cost_usd=cost_usd,
        )

    @staticmethod
    def _strip_xml_wrapper_tags(text: str) -> str:
        """Strip <message>...</message> wrapper tags the LLM sometimes adds."""
        return re.sub(r'</?message>', '', text, flags=re.IGNORECASE).strip()

    def _parse_image_prompt(self, content: str) -> tuple[str, str | None]:
        """Parse image_prompt from response content.

        Extracts the image_prompt from <image_prompt>...</image_prompt> tags
        and returns the cleaned content without the tag.

        Returns:
            tuple of (cleaned_content, image_prompt or None)
        """
        structured = self._parse_structured_response(content)
        if structured is not None:
            messages, image_prompt = structured
            cleaned_content = "\n".join(messages).strip()
            return self._strip_xml_wrapper_tags(cleaned_content), image_prompt

        # Log incoming content for debugging
        logger.debug(
            "image_prompt_parse_input",
            content_length=len(content),
            content_tail=content[-500:] if len(content) > 500 else content,
        )

        # Match <image_prompt>...</image_prompt> anywhere in the content
        pattern = r'<image_prompt>(.*?)</image_prompt>'
        match = re.search(pattern, content, re.DOTALL)

        if match:
            image_prompt = match.group(1).strip()
            # Remove the image_prompt tag from the content
            cleaned_content = re.sub(pattern, '', content, flags=re.DOTALL).strip()

            logger.info(
                "image_prompt_extracted",
                image_prompt_length=len(image_prompt),
                image_prompt=image_prompt[:200],
            )
            return self._strip_xml_wrapper_tags(cleaned_content), image_prompt

        # Log when no image_prompt found
        logger.warning(
            "image_prompt_not_found",
            content_length=len(content),
            content_tail=content[-300:] if len(content) > 300 else content,
        )
        return self._strip_xml_wrapper_tags(content), None

    def _parse_structured_response(self, content: str) -> tuple[list[str], str | None] | None:
        """Parse optional JSON response envelope.

        Supported shapes:
        - {"messages": ["...", "..."], "image_prompt": "..."}
        - {"message": "...", "image_prompt": "..."}
        - {"content": "...", "imagePrompt": "..."}
        """
        parsed = self._try_load_json(content)
        if not isinstance(parsed, dict):
            return None

        image_prompt_raw = parsed.get("image_prompt", parsed.get("imagePrompt"))
        image_prompt = image_prompt_raw.strip() if isinstance(image_prompt_raw, str) and image_prompt_raw.strip() else None

        messages: list[str] = []
        raw_messages = parsed.get("messages")
        if isinstance(raw_messages, list):
            for item in raw_messages:
                if isinstance(item, str) and item.strip():
                    messages.append(item.strip())
                elif isinstance(item, dict):
                    text_value = item.get("content", item.get("message", item.get("text")))
                    if isinstance(text_value, str) and text_value.strip():
                        messages.append(text_value.strip())
        else:
            single_value = parsed.get("message", parsed.get("content", parsed.get("text")))
            if isinstance(single_value, str) and single_value.strip():
                messages.append(single_value.strip())

        if not messages:
            return None

        logger.info(
            "structured_response_parsed",
            message_count=len(messages),
            image_prompt_found=image_prompt is not None,
        )
        return messages, image_prompt

    def _try_load_json(self, content: str) -> dict[str, Any] | None:
        """Best-effort JSON parser for model output."""
        candidate = content.strip()
        if not candidate:
            return None

        # Strip fenced code block wrapper if present.
        if candidate.startswith("```"):
            lines = candidate.splitlines()
            if len(lines) >= 3:
                candidate = "\n".join(lines[1:-1]).strip()

        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            pass

        # Fallback: parse the first top-level JSON object in mixed text output.
        first_brace = candidate.find("{")
        last_brace = candidate.rfind("}")
        if first_brace == -1 or last_brace <= first_brace:
            return None

        snippet = candidate[first_brace:last_brace + 1]
        try:
            parsed = json.loads(snippet)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    def _parse_multi_messages(self, content: str) -> tuple[list[str], str | None]:
        """Parse multi-message response from LLM output.

        Extracts individual messages from <message>...</message> tags.
        Also extracts image_prompt from within messages (should be in last one).

        Returns:
            tuple of (list of message strings, image_prompt or None)
        """
        structured = self._parse_structured_response(content)
        if structured is not None:
            return structured

        # Check if content uses multi-message format
        message_pattern = r'<message>(.*?)</message>'
        matches = re.findall(message_pattern, content, re.DOTALL)

        if not matches:
            # No message tags - treat entire content as single message
            # Still parse image_prompt from it
            cleaned, image_prompt = self._parse_image_prompt(content)
            return [cleaned.strip()], image_prompt

        # Extract image_prompt from all messages (should be in last one)
        image_prompt = None
        cleaned_messages = []

        for msg in matches:
            msg_content = msg.strip()
            # Check this message for image_prompt
            msg_cleaned, msg_image_prompt = self._parse_image_prompt(msg_content)
            if msg_image_prompt:
                image_prompt = msg_image_prompt
            if msg_cleaned.strip():
                cleaned_messages.append(msg_cleaned.strip())

        # Filter empty messages
        cleaned_messages = [m for m in cleaned_messages if m]

        # Fallback: if no valid messages found, return original as single message
        if not cleaned_messages:
            cleaned, image_prompt = self._parse_image_prompt(content)
            return [cleaned.strip()], image_prompt

        return cleaned_messages, image_prompt

    async def _update_emotional_state_after_turn(
        self,
        companion_id: UUID,
        user_id: UUID,
        user_message: str,
        assistant_response: str,
        companion_spec: CompanionSpec | None = None,
    ) -> None:
        """Update the companion emotional state after a conversation turn (fire-and-forget)."""
        try:
            # Quick heuristic sentiment detection from user message
            sentiment = self._detect_simple_sentiment(user_message)

            # Build a compact turn summary
            summary = user_message[:80]

            await self._emotional_state_service.update_after_turn(
                companion_id=companion_id,
                user_id=user_id,
                turn_summary=summary,
                user_sentiment=sentiment,
                companion_spec=companion_spec,
            )
        except Exception as e:
            logger.warning(
                "emotional_state_update_failed",
                error=str(e),
                companion_id=str(companion_id),
                user_id=str(user_id),
            )

    @staticmethod
    def _detect_simple_sentiment(text: str) -> str:
        """Simple keyword-based sentiment detection for emotional state updates.

        This is intentionally lightweight. A more sophisticated approach would use
        the LLM or a dedicated sentiment model, but this keeps the emotional state
        update fast and free of extra API calls.
        """
        text_lower = text.lower()

        very_positive_markers = [
            "love", "amazing", "wonderful", "fantastic", "incredible", "best",
            "thank you so much", "you're the best", "perfect", "!!!",
        ]
        positive_markers = [
            "good", "great", "nice", "happy", "thanks", "glad", "cool",
            "awesome", "fun", "like", "enjoy", "appreciate", ":)", "haha",
        ]
        negative_markers = [
            "bad", "sad", "annoyed", "frustrated", "tired", "bored",
            "worried", "stressed", "upset", "angry", "hate", ":(", "ugh",
        ]
        very_negative_markers = [
            "terrible", "awful", "worst", "depressed", "hopeless", "miserable",
            "devastated", "furious", "heartbroken",
        ]

        vp = sum(1 for m in very_positive_markers if m in text_lower)
        p = sum(1 for m in positive_markers if m in text_lower)
        n = sum(1 for m in negative_markers if m in text_lower)
        vn = sum(1 for m in very_negative_markers if m in text_lower)

        score = vp * 2 + p - n - vn * 2

        if score >= 3:
            return "very_positive"
        if score >= 1:
            return "positive"
        if score <= -3:
            return "very_negative"
        if score <= -1:
            return "negative"
        return "neutral"

    async def _extract_knowledge_graph(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        turn_id: UUID,
        user_message: str,
        assistant_response: str,
        turn_count: int = 1,
    ) -> None:
        """Extract entities and relationships from conversation turn.

        This runs asynchronously after the turn completes to avoid
        adding latency to the user experience. Uses KGExtractionService
        for rate-limited, efficient extraction.

        Args:
            session_id: Current session ID
            user_id: User ID
            companion_spec: Companion specification
            turn_id: ID of the current turn
            user_message: User's message content
            assistant_response: Assistant's response content
            turn_count: Current turn number in session (for rate limiting)
        """
        # Check if KG extraction is enabled globally
        if not self._kg_extraction_service:
            logger.debug("kg_extraction_service_not_initialized")
            return

        # Check if KG extraction is enabled for this companion
        if not getattr(companion_spec, 'allow_kg_extraction', True):
            logger.debug(
                "kg_extraction_disabled_for_companion",
                companion_id=str(companion_spec.id),
            )
            return

        try:
            # Check rate limiting using service's should_extract heuristic
            last_extraction_turn = self._last_extraction_turns.get(session_id)
            should_extract = self._kg_extraction_service.should_extract(
                user_message=user_message,
                turn_count=turn_count,
                last_extraction_turn=last_extraction_turn,
                extraction_interval=self.settings.kg_extraction_interval,
            )

            if not should_extract:
                logger.debug(
                    "kg_extraction_skipped",
                    session_id=str(session_id),
                    turn_count=turn_count,
                    last_extraction_turn=last_extraction_turn,
                    reason="rate_limited_or_not_extractable",
                )
                return

            # Perform extraction using the service
            extraction = await self._kg_extraction_service.extract_from_turn(
                user_message=user_message,
                assistant_message=assistant_response,
                user_id=user_id,
                companion_id=companion_spec.id,
            )

            if not extraction.success:
                logger.warning(
                    "kg_extraction_failed",
                    session_id=str(session_id),
                    turn_id=str(turn_id),
                    error=extraction.error,
                )
                return

            if not extraction.has_extractions:
                logger.debug(
                    "kg_extraction_empty",
                    session_id=str(session_id),
                    turn_id=str(turn_id),
                )
                # Still update last extraction turn to avoid repeated attempts
                self._last_extraction_turns[session_id] = turn_count
                return

            # Submit extraction to gateway via service
            submitted = await self._kg_extraction_service.submit_extraction(
                extraction=extraction,
                user_id=user_id,
                companion_id=companion_spec.id,
                session_id=session_id,
                turn_id=turn_id,
                auto_approve=self.settings.kg_extraction_auto_approve,
            )

            # Update last extraction turn for rate limiting
            self._last_extraction_turns[session_id] = turn_count

            if submitted:
                logger.info(
                    "kg_extraction_submitted",
                    session_id=str(session_id),
                    turn_id=str(turn_id),
                    entity_count=len(extraction.entities),
                    relation_count=len(extraction.relations),
                    turn_count=turn_count,
                )

                # Emit event for audit/tracking
                await self.event_emitter.emit(
                    BaseEvent(
                        type=EventType.KG_PROPOSE,
                        session_id=session_id,
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        payload={
                            "entities": extraction.entities,
                            "relations": extraction.relations,
                            "reasoning": extraction.reasoning,
                        },
                    )
                )
            else:
                logger.warning(
                    "kg_extraction_submit_failed",
                    session_id=str(session_id),
                    turn_id=str(turn_id),
                )

        except Exception as e:
            logger.error(
                "kg_extraction_error",
                error=str(e),
                session_id=str(session_id),
                turn_id=str(turn_id),
            )

    async def _summarize_session_if_needed(
        self,
        session_id: UUID,
        user_id: UUID,
        companion_spec: CompanionSpec,
        turn_count: int,
        recent_turns: list[ConversationTurn] | None,
        user_message: str,
        assistant_response: str,
    ) -> None:
        """Summarize session if it has reached the turn threshold.

        This runs asynchronously after the turn completes to avoid
        adding latency to the user experience.

        Args:
            session_id: Current session ID
            user_id: User ID
            companion_spec: Companion specification
            turn_count: Current turn number in session
            recent_turns: Recent conversation turns
            user_message: Current user message
            assistant_response: Current assistant response
        """
        # Check if summarization service is enabled
        if not self._summarization_service:
            return

        try:
            # Check if we should summarize
            last_summary_turn = self._last_summarization_turns.get(session_id)
            should_summarize = self._summarization_service.should_summarize(
                turn_count=turn_count,
                threshold=self.settings.session_summarization_threshold,
                last_summary_turn=last_summary_turn,
                summary_interval=self.settings.session_summarization_interval,
            )

            if not should_summarize:
                logger.debug(
                    "session_summarization_skipped",
                    session_id=str(session_id),
                    turn_count=turn_count,
                    threshold=self.settings.session_summarization_threshold,
                )
                return

            # Build turns list for summarization
            turns_for_summary: list[dict[str, Any]] = []

            # Add recent turns
            if recent_turns:
                for turn in recent_turns:
                    if turn.user_message:
                        turns_for_summary.append({
                            "role": "user",
                            "content": turn.user_message.content,
                        })
                    if turn.assistant_message:
                        turns_for_summary.append({
                            "role": "assistant",
                            "content": turn.assistant_message.content,
                        })

            # Add current turn
            turns_for_summary.append({"role": "user", "content": user_message})
            turns_for_summary.append({"role": "assistant", "content": assistant_response})

            # Generate and submit summary
            result = await self._summarization_service.summarize_and_store(
                turns=turns_for_summary,
                session_id=session_id,
                user_id=user_id,
                companion_name=companion_spec.name,
            )

            if result.success and result.has_summary:
                # Update last summarization turn
                self._last_summarization_turns[session_id] = turn_count

                logger.info(
                    "session_summarization_completed",
                    session_id=str(session_id),
                    turn_count=turn_count,
                    summary_length=len(result.summary) if result.summary else 0,
                )

                # Emit event for tracking
                await self.event_emitter.emit(
                    BaseEvent(
                        type=EventType.SESSION_SUMMARIZED,
                        session_id=session_id,
                        user_id=user_id,
                        companion_id=companion_spec.id,
                        payload={
                            "turn_count": turn_count,
                            "summary_preview": (
                                result.summary[:200] + "..."
                                if result.summary and len(result.summary) > 200
                                else result.summary
                            ),
                            "key_facts_count": len(result.key_facts),
                        },
                    )
                )
            else:
                logger.warning(
                    "session_summarization_failed",
                    session_id=str(session_id),
                    error=result.error,
                )

        except Exception as e:
            logger.error(
                "session_summarization_error",
                error=str(e),
                session_id=str(session_id),
                turn_count=turn_count,
            )
