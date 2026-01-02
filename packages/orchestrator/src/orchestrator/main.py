"""FastAPI server for the orchestrator service."""

import asyncio
import random
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator
from uuid import UUID

import structlog
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from orchestrator.config import Settings, get_settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.conversation import (
    CompanionSpec,
    ConversationTurn,
    SessionSummary,
)
from orchestrator.models.memory import LongTermMemory
from orchestrator.prompts.manager import PromptManager
from orchestrator.providers.comfyui import ComfyUIProvider
from orchestrator.providers.fal import FalProvider
from orchestrator.providers.ollama import OllamaProvider
from orchestrator.queue import JobQueue, get_job_queue
from orchestrator.safety.gate import SafetyGate, SafetyLevel
from orchestrator.services.orchestrator import ConversationOrchestrator
from orchestrator.services.prompt_enhancer import PromptEnhancer
from orchestrator.tools.router import ToolRouter
from orchestrator.api.test_runner import router as test_router
from orchestrator.api.health import router as health_router

logger = structlog.get_logger()


def repair_json(text: str) -> str:
    """Attempt to repair common JSON issues from LLM output."""
    import re

    # Remove any markdown code fences
    text = re.sub(r'^```(?:json)?\s*', '', text.strip())
    text = re.sub(r'\s*```$', '', text.strip())

    # Extract JSON object if wrapped in other text
    json_match = re.search(r'\{[\s\S]*\}', text)
    if json_match:
        text = json_match.group()

    # Fix trailing commas before closing brackets/braces
    text = re.sub(r',\s*([}\]])', r'\1', text)

    # Fix unquoted property names (common LLM mistake)
    text = re.sub(r'([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', text)

    # Fix single quotes used instead of double quotes
    # Be careful not to replace apostrophes inside strings
    # First, temporarily replace escaped single quotes
    text = text.replace("\\'", "<<<ESCAPED_SINGLE>>>")
    # Replace single-quoted strings with double-quoted (simple heuristic)
    text = re.sub(r"'([^']*)'", r'"\1"', text)
    # Restore escaped single quotes
    text = text.replace("<<<ESCAPED_SINGLE>>>", "'")

    # Fix missing commas between array elements or object properties
    text = re.sub(r'"\s*\n\s*"', '",\n"', text)
    text = re.sub(r']\s*\n\s*"', '],\n"', text)
    text = re.sub(r'}\s*\n\s*"', '},\n"', text)

    return text


def parse_llm_json(text: str, fallback: dict | None = None) -> dict:
    """Parse JSON from LLM output with repair attempts."""
    import json

    # First try direct parsing
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try repairing the JSON
    try:
        repaired = repair_json(text)
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        logger.warning("json_repair_failed", error=str(e), text_preview=text[:200])
        if fallback is not None:
            return fallback
        raise


# Request/Response models
class CompanionSelfKnowledge(BaseModel):
    """A piece of self-knowledge from the companion's Knowledge Graph."""

    category: str  # backstory, trait, quirk, experience, motivation, relationship
    content: str
    confidence: float = 1.0


class ProcessMessageRequest(BaseModel):
    """Request model for processing a message."""

    session_id: UUID
    user_id: UUID
    companion_spec: CompanionSpec
    user_message: str
    recent_turns: list[ConversationTurn] | None = None
    session_summary: SessionSummary | None = None
    long_term_memories: list[LongTermMemory] | None = None
    companion_self_knowledge: list[CompanionSelfKnowledge] | None = None


class ProcessMessageResponse(BaseModel):
    """Response model for processed message."""

    turn: ConversationTurn
    prompt_version: str
    policy_version: str


class StreamMessageRequest(BaseModel):
    """Request model for streaming message processing."""

    session_id: UUID
    user_id: UUID
    companion_spec: CompanionSpec
    user_message: str
    recent_turns: list[ConversationTurn] | None = None
    session_summary: SessionSummary | None = None
    long_term_memories: list[LongTermMemory] | None = None
    companion_self_knowledge: list[CompanionSelfKnowledge] | None = None
    user_image_url: str | None = None  # Webcam frame URL for multimodal context
    active_game: dict | None = None  # Active game state for game context injection
    liked_content: list[dict] | None = None  # User's liked messages for companion awareness


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str
    version: str
    environment: str
    prompt_version: str
    policy_version: str


class ErrorResponse(BaseModel):
    """Response model for errors."""

    error: str
    error_type: str
    detail: str | None = None


class ImageGenRequest(BaseModel):
    """Request model for image generation."""

    prompt: str
    emotional_state: str = "neutral"
    style: str = "stylized"
    negative_prompt: str | None = None
    width: int = 768
    height: int = 1024
    steps: int = 25
    cfg: float = 7.0
    reference_image_url: str | None = None  # Identity anchor for IP-Adapter
    reference_strength: float = 0.7  # How much to follow reference image
    is_anchor: bool = False  # Use high-quality anchor workflow (more steps, no upscaling)


class ImageGenResponse(BaseModel):
    """Response model for image generation."""

    image_base64: str
    format: str
    width: int
    height: int
    latency_ms: float
    provider: str
    prompt_used: str


class PersonalityTraits(BaseModel):
    """Personality trait sliders (0-100)."""

    warmth: int = 60
    energy: int = 50
    playfulness: int = 50
    formality: int = 40
    assertiveness: int = 50
    curiosity: int = 60
    empathy: int = 70
    spontaneity: int = 50
    optimism: int = 60
    directness: int = 50


class Tenet(BaseModel):
    """Behavioral tenet for the companion."""

    category: str
    priority: str
    rule: str
    is_negation: bool = False


class GenerateBackstoryRequest(BaseModel):
    """Request model for backstory generation."""

    companion_name: str
    pronouns: str = "they/them"
    archetype: str
    secondary_archetype: str | None = None
    archetype_description: str | None = None
    personality: PersonalityTraits
    tenets: list[Tenet] = Field(default_factory=list)
    user_backstory_hint: str | None = None  # Optional user-provided backstory seed


class GenerateBackstoryResponse(BaseModel):
    """Response model for backstory generation."""

    backstory: str
    motivations: list[str]
    key_memories: list[str]
    personality_quirks: list[str]
    latency_ms: float


class GenerateRandomIdentityResponse(BaseModel):
    """Response model for random identity generation."""

    name: str
    pronouns: str
    backstory: str
    latency_ms: float


class ConversationTurnInput(BaseModel):
    """A conversation turn for personality analysis."""

    user_message: str
    agent_message: str | None = None
    timestamp: str | None = None


class UserPersonalityTraits(BaseModel):
    """Detected personality traits (0-100 scale)."""

    warmth: int | None = None
    energy: int | None = None
    humor: int | None = None
    formality: int | None = None
    curiosity: int | None = None
    openness: int | None = None


class AnalyzeUserProfileRequest(BaseModel):
    """Request model for user personality analysis."""

    user_id: UUID
    turns: list[ConversationTurnInput]
    existing_profile: dict | None = None


class AnalyzeUserProfileResponse(BaseModel):
    """Response model for user personality analysis."""

    traits: UserPersonalityTraits
    preferred_tone: str  # casual, formal, playful, direct
    verbosity: str  # concise, moderate, detailed
    personality_insights: list[str]
    detected_interests: list[str]
    conversation_themes: list[str]
    greeting_style: str  # warm, playful, formal, friendly
    custom_insight: str
    latency_ms: float


# Application state
class AppState:
    """Application state container."""

    settings: Settings
    event_emitter: EventEmitter
    prompt_manager: PromptManager
    safety_gate: SafetyGate
    tool_router: ToolRouter
    orchestrator: ConversationOrchestrator
    job_queue: JobQueue
    comfyui_provider: ComfyUIProvider | None
    fal_provider: FalProvider | None
    ollama_provider: OllamaProvider | None
    prompt_enhancer: PromptEnhancer | None


app_state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager."""
    # Startup
    logger.info("starting_orchestrator_service")

    settings = get_settings()
    app_state.settings = settings

    # Initialize event emitter
    app_state.event_emitter = EventEmitter()
    await app_state.event_emitter.start()

    # Initialize prompt manager
    app_state.prompt_manager = PromptManager(default_version="1.0.0")

    # Initialize safety gate with configured safety level
    safety_level_map = {
        "adult": SafetyLevel.ADULT,
        "permissive": SafetyLevel.PERMISSIVE,
        "standard": SafetyLevel.STANDARD,
        "strict": SafetyLevel.STRICT,
    }
    configured_level = safety_level_map.get(settings.safety_level, SafetyLevel.ADULT)

    app_state.safety_gate = SafetyGate(
        event_emitter=app_state.event_emitter,
        policy_version="1.0.0",
        safety_level=configured_level,
        enabled=settings.safety_enabled,
        strict_mode=settings.safety_strict_mode,
        content_filter_threshold=settings.content_filter_threshold,
    )

    # Initialize tool router
    app_state.tool_router = ToolRouter(
        settings=settings,
        event_emitter=app_state.event_emitter,
    )

    # Initialize job queue for background workers
    app_state.job_queue = get_job_queue(settings)
    await app_state.job_queue.connect()

    # Initialize orchestrator
    app_state.orchestrator = ConversationOrchestrator(
        settings=settings,
        event_emitter=app_state.event_emitter,
        prompt_manager=app_state.prompt_manager,
        safety_gate=app_state.safety_gate,
        tool_router=app_state.tool_router,
        job_queue=app_state.job_queue,
    )

    # Initialize image providers
    app_state.comfyui_provider = None
    app_state.fal_provider = None

    if settings.comfyui_enabled:
        app_state.comfyui_provider = ComfyUIProvider(settings)
        # Check if ComfyUI is available
        if await app_state.comfyui_provider.health_check():
            logger.info("comfyui_available", url=settings.comfyui_base_url)
        else:
            logger.warning("comfyui_not_available", url=settings.comfyui_base_url)
            app_state.comfyui_provider = None

    if settings.fal_api_key:
        app_state.fal_provider = FalProvider(settings)
        logger.info("fal_provider_initialized")

    # Initialize Ollama provider for LLM tasks (backstory generation, etc.)
    app_state.ollama_provider = OllamaProvider(settings)
    if await app_state.ollama_provider.health_check():
        logger.info("ollama_available", url=settings.ollama_base_url)
    else:
        logger.warning("ollama_not_available", url=settings.ollama_base_url)
        app_state.ollama_provider = None

    # Initialize prompt enhancer for image generation (uses Ollama)
    app_state.prompt_enhancer = None
    if settings.prompt_enhancement_enabled and app_state.ollama_provider is not None:
        app_state.prompt_enhancer = PromptEnhancer(settings)
        logger.info(
            "prompt_enhancer_initialized",
            model=settings.prompt_enhancement_model,
        )

    logger.info(
        "orchestrator_service_started",
        version=settings.app_version,
        environment=settings.environment,
        prompt_version=app_state.prompt_manager.current_version,
        policy_version=app_state.safety_gate.policy_version,
        comfyui_enabled=app_state.comfyui_provider is not None,
        fal_enabled=app_state.fal_provider is not None,
        ollama_enabled=app_state.ollama_provider is not None,
        prompt_enhancement_enabled=app_state.prompt_enhancer is not None,
    )

    yield

    # Shutdown
    logger.info("stopping_orchestrator_service")
    await app_state.tool_router.close()
    await app_state.job_queue.disconnect()
    await app_state.event_emitter.stop()
    logger.info("orchestrator_service_stopped")


# Create FastAPI app
app = FastAPI(
    title="Campfire Orchestrator",
    description="AI Companion Conversation Orchestrator Service",
    version="0.1.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(test_router)
app.include_router(health_router)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        version=app_state.settings.app_version,
        environment=app_state.settings.environment,
        prompt_version=app_state.prompt_manager.current_version,
        policy_version=app_state.safety_gate.policy_version,
    )


@app.get("/ready")
async def readiness_check() -> dict[str, str]:
    """Readiness check endpoint."""
    return {"status": "ready"}


@app.post(
    "/process",
    response_model=ProcessMessageResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def process_message(request: ProcessMessageRequest) -> ProcessMessageResponse:
    """Process a user message and generate a response.

    This endpoint handles the full conversation flow:
    1. Safety check on input
    2. Context building with memories and history
    3. LLM generation with tool calling
    4. Safety check on output
    5. Return the complete conversation turn
    """
    try:
        logger.info(
            "process_message_request",
            session_id=str(request.session_id),
            user_id=str(request.user_id),
            companion_id=str(request.companion_spec.id),
            message_length=len(request.user_message),
        )

        result = await app_state.orchestrator.process_message(
            session_id=request.session_id,
            user_id=request.user_id,
            companion_spec=request.companion_spec,
            user_message=request.user_message,
            recent_turns=request.recent_turns,
            session_summary=request.session_summary,
            long_term_memories=request.long_term_memories,
            companion_self_knowledge=request.companion_self_knowledge,
            stream=False,
        )

        if isinstance(result, ConversationTurn):
            return ProcessMessageResponse(
                turn=result,
                prompt_version=app_state.prompt_manager.current_version,
                policy_version=app_state.safety_gate.policy_version,
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected response type from orchestrator",
        )

    except ValueError as e:
        logger.warning("process_message_validation_error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    except Exception as e:
        logger.exception("process_message_error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process message: {str(e)}",
        )


@app.post("/stream")
async def stream_message(request: StreamMessageRequest) -> StreamingResponse:
    """Process a user message with streaming response.

    This endpoint handles the full conversation flow with streaming:
    1. Safety check on input
    2. Context building with memories and history
    3. LLM generation with streaming output
    4. Safety check on output (on complete)
    5. Stream response chunks

    Returns Server-Sent Events (SSE) stream.
    """

    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            logger.info(
                "stream_message_request",
                session_id=str(request.session_id),
                user_id=str(request.user_id),
                companion_id=str(request.companion_spec.id),
                message_length=len(request.user_message),
                recent_turns_count=len(request.recent_turns) if request.recent_turns else 0,
            )

            result = await app_state.orchestrator.process_message(
                session_id=request.session_id,
                user_id=request.user_id,
                companion_spec=request.companion_spec,
                user_message=request.user_message,
                recent_turns=request.recent_turns,
                session_summary=request.session_summary,
                long_term_memories=request.long_term_memories,
                companion_self_knowledge=request.companion_self_knowledge,
                user_image_url=request.user_image_url,
                active_game=request.active_game,
                liked_content=request.liked_content,
                stream=True,
            )

            if isinstance(result, AsyncGenerator):
                # Streaming path: accumulate content for multi-message parsing
                full_content = ""
                async for chunk in result:
                    full_content += chunk
                    yield f"data: {chunk}\n\n"

                # Parse multi-messages after stream completes
                messages, image_prompt = app_state.orchestrator._parse_multi_messages(full_content)

                # Log extraction result for debugging
                logger.info(
                    "stream_image_prompt_result",
                    message_count=len(messages),
                    image_prompt_found=image_prompt is not None,
                    image_prompt=image_prompt[:200] if image_prompt else None,
                    full_content_tail=full_content[-300:] if len(full_content) > 300 else full_content,
                )

                # Emit [MESSAGE] events for multi-message responses
                if len(messages) > 1:
                    import json
                    for i, msg in enumerate(messages):
                        # Calculate typing delay: 500ms base + 10ms per char, capped at 3s
                        delay_ms = min(3000, 500 + len(msg) * 10) if i < len(messages) - 1 else 0
                        msg_data = {
                            "content": msg,
                            "index": i,
                            "total": len(messages),
                            "suggested_delay_ms": delay_ms,
                            "is_last": i == len(messages) - 1,
                        }
                        yield f"data: [MESSAGE]{json.dumps(msg_data)}\n\n"

                    # Send image_prompt after all messages
                    if image_prompt:
                        metadata = {"image_prompt": image_prompt}
                        logger.info(
                            "sending_image_prompt_metadata",
                            image_prompt_length=len(image_prompt),
                            image_prompt=image_prompt[:200],
                        )
                        yield f"data: [METADATA]{json.dumps(metadata)}\n\n"
                else:
                    # Single message - send image_prompt metadata if present
                    if image_prompt:
                        import json
                        metadata = {"image_prompt": image_prompt}
                        logger.info(
                            "sending_image_prompt_metadata",
                            image_prompt_length=len(image_prompt),
                            image_prompt=image_prompt[:200],
                        )
                        yield f"data: [METADATA]{json.dumps(metadata)}\n\n"

                yield "data: [DONE]\n\n"

            elif isinstance(result, ConversationTurn):
                # Fallback to non-streaming if provider doesn't support it
                if result.assistant_message:
                    content = result.assistant_message.content
                    # Parse multi-messages from the content
                    messages, image_prompt = app_state.orchestrator._parse_multi_messages(content)
                    import json

                    if len(messages) > 1:
                        # Multi-message response
                        for i, msg in enumerate(messages):
                            delay_ms = min(3000, 500 + len(msg) * 10) if i < len(messages) - 1 else 0
                            msg_data = {
                                "content": msg,
                                "index": i,
                                "total": len(messages),
                                "suggested_delay_ms": delay_ms,
                                "is_last": i == len(messages) - 1,
                            }
                            yield f"data: [MESSAGE]{json.dumps(msg_data)}\n\n"
                    else:
                        # Single message - stream the content
                        yield f"data: {messages[0]}\n\n"

                    # Send image_prompt as metadata event if present
                    if image_prompt:
                        metadata = {"image_prompt": image_prompt}
                        yield f"data: [METADATA]{json.dumps(metadata)}\n\n"

                yield "data: [DONE]\n\n"

        except Exception as e:
            logger.exception("stream_message_error", error=str(e))
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/prompts")
async def list_prompts() -> dict[str, Any]:
    """List available prompt templates."""
    return {
        "current_version": app_state.prompt_manager.current_version,
        "available_versions": app_state.prompt_manager.available_versions,
        "templates": app_state.prompt_manager.list_templates(),
    }


@app.get("/prompts/{name}")
async def get_prompt_info(name: str, version: str | None = None) -> dict[str, Any]:
    """Get information about a specific prompt template."""
    try:
        return app_state.prompt_manager.get_template_info(name, version)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@app.get("/safety/policy")
async def get_safety_policy() -> dict[str, Any]:
    """Get information about the current safety policy."""
    return app_state.safety_gate.get_policy_info()


@app.get("/safety/constraints")
async def get_safety_constraints() -> dict[str, list[str]]:
    """Get current safety constraints."""
    return {
        "level": app_state.safety_gate.safety_level.value,
        "constraints": app_state.safety_gate.get_constraints(),
    }


@app.post(
    "/imagegen/generate",
    response_model=ImageGenResponse,
    responses={
        400: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def generate_image(request: ImageGenRequest) -> ImageGenResponse:
    """Generate a companion image using ComfyUI (preferred) or FAL (fallback).

    Uses local ComfyUI with SDXL checkpoint for high-quality generation.
    Falls back to FAL.ai if ComfyUI is unavailable.

    The companion LLM now provides full imagePrompt with scene, mood, style,
    and expression details. IP-Adapter preserves identity from anchor image,
    so the companion has full creative control over the generated scene.
    """
    import base64

    # Log incoming prompt before any processing
    logger.info(
        "imagegen_prompt_received",
        prompt_length=len(request.prompt) if request.prompt else 0,
        prompt=request.prompt[:200] if request.prompt else None,
        emotional_state=request.emotional_state,
        style=request.style,
    )

    # Enhance the prompt if prompt enhancer is available
    prompt = request.prompt
    prompt_was_enhanced = False
    if app_state.prompt_enhancer and request.prompt:
        prompt = await app_state.prompt_enhancer.enhance_prompt(
            original_prompt=request.prompt,
            emotional_state=request.emotional_state,
            style=request.style,
        )
        prompt_was_enhanced = prompt != request.prompt

        # Log enhancement result
        if prompt_was_enhanced:
            logger.info(
                "imagegen_prompt_enhanced",
                original=request.prompt[:200],
                enhanced=prompt[:200],
            )

    # Add minimal quality suffix
    full_prompt = prompt + ", high quality, detailed"

    logger.info(
        "imagegen_request",
        prompt=full_prompt[:100],
        original_prompt=request.prompt[:100] if prompt_was_enhanced else None,
        prompt_enhanced=prompt_was_enhanced,
        emotional_state=request.emotional_state,
        style=request.style,
        size=f"{request.width}x{request.height}",
    )

    # Try ComfyUI first (preferred for NSFW-capable generation)
    if app_state.comfyui_provider:
        try:
            result = await app_state.comfyui_provider.generate(
                prompt=full_prompt,
                size=f"{request.width}x{request.height}",
                negative_prompt=request.negative_prompt,
                reference_image_url=request.reference_image_url,
                reference_strength=request.reference_strength,
                is_anchor=request.is_anchor,
            )

            image_base64 = base64.b64encode(result["image_data"]).decode("utf-8")

            logger.info(
                "imagegen_success",
                provider="comfyui",
                latency_ms=result["latency_ms"],
            )

            return ImageGenResponse(
                image_base64=image_base64,
                format=result["format"],
                width=result["width"],
                height=result["height"],
                latency_ms=result["latency_ms"],
                provider="comfyui",
                prompt_used=full_prompt,
            )

        except Exception as e:
            logger.warning("comfyui_generation_failed", error=str(e))
            # Fall through to FAL

    # Fallback to FAL
    if app_state.fal_provider:
        try:
            result = await app_state.fal_provider.generate(
                prompt=full_prompt,
                size=f"{request.width}x{request.height}",
            )

            # FAL returns a URL, we need to fetch and encode it
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.get(result["image_url"])
                response.raise_for_status()
                image_base64 = base64.b64encode(response.content).decode("utf-8")

            logger.info(
                "imagegen_success",
                provider="fal",
                latency_ms=result["latency_ms"],
            )

            return ImageGenResponse(
                image_base64=image_base64,
                format="png",
                width=result["width"],
                height=result["height"],
                latency_ms=result["latency_ms"],
                provider="fal",
                prompt_used=full_prompt,
            )

        except Exception as e:
            logger.error("fal_generation_failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Image generation failed: {str(e)}",
            )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="No image generation providers available",
    )


@app.get("/imagegen/providers")
async def get_image_providers() -> dict[str, Any]:
    """Get available image generation providers."""
    providers = []

    if app_state.comfyui_provider:
        providers.append({
            "name": "comfyui",
            "available": True,
            "preferred": True,
            "checkpoint": app_state.settings.comfyui_default_checkpoint,
        })

    if app_state.fal_provider:
        providers.append({
            "name": "fal",
            "available": True,
            "preferred": False,
            "model": app_state.settings.fal_model,
        })

    return {
        "providers": providers,
        "default": "comfyui" if app_state.comfyui_provider else "fal" if app_state.fal_provider else None,
    }


@app.post(
    "/backstory/generate",
    response_model=GenerateBackstoryResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def generate_backstory(request: GenerateBackstoryRequest) -> GenerateBackstoryResponse:
    """Generate a rich backstory for a companion using LLM.

    Takes companion personality data from onboarding and creates:
    - A detailed backstory narrative
    - Core motivations driving the character
    - Key formative memories
    - Personality quirks and mannerisms
    """
    import json
    import time

    start_time = time.time()

    # Build personality description from traits
    trait_descriptions = []
    p = request.personality
    if p.warmth > 70:
        trait_descriptions.append("very warm and affectionate")
    elif p.warmth < 30:
        trait_descriptions.append("reserved and measured in showing affection")

    if p.energy > 70:
        trait_descriptions.append("high-energy and enthusiastic")
    elif p.energy < 30:
        trait_descriptions.append("calm and laid-back")

    if p.playfulness > 70:
        trait_descriptions.append("playful and fun-loving")
    elif p.playfulness < 30:
        trait_descriptions.append("serious and focused")

    if p.curiosity > 70:
        trait_descriptions.append("deeply curious and inquisitive")
    elif p.curiosity < 30:
        trait_descriptions.append("practical and grounded")

    if p.empathy > 70:
        trait_descriptions.append("highly empathetic and emotionally attuned")
    elif p.empathy < 30:
        trait_descriptions.append("analytical and logical")

    if p.assertiveness > 70:
        trait_descriptions.append("confident and assertive")
    elif p.assertiveness < 30:
        trait_descriptions.append("gentle and accommodating")

    if p.spontaneity > 70:
        trait_descriptions.append("spontaneous and adventurous")
    elif p.spontaneity < 30:
        trait_descriptions.append("thoughtful and deliberate")

    if p.optimism > 70:
        trait_descriptions.append("optimistic and hopeful")
    elif p.optimism < 30:
        trait_descriptions.append("realistic and pragmatic")

    if p.directness > 70:
        trait_descriptions.append("direct and straightforward")
    elif p.directness < 30:
        trait_descriptions.append("tactful and nuanced in communication")

    personality_summary = ", ".join(trait_descriptions) if trait_descriptions else "balanced and adaptable"

    # Build tenets summary
    tenets_summary = ""
    if request.tenets:
        core_rules = [t for t in request.tenets if t.priority == "core"]
        if core_rules:
            tenets_summary = "\n\nCore behavioral principles:\n" + "\n".join(
                f"- {'NEVER: ' if t.is_negation else ''}{t.rule}" for t in core_rules
            )

    # Build the generation prompt
    system_prompt = """You are a creative writer specializing in character development for AI companions.
Your task is to create a rich, compelling backstory for a companion character based on their personality traits and archetype.

The backstory should:
- Feel authentic and emotionally resonant
- Explain how the character developed their personality traits
- Include formative experiences that shaped who they are
- Be intimate and personal, suitable for a close companion relationship
- Avoid clichés while still being relatable
- Be 2-3 paragraphs long

You must respond with valid JSON in this exact format:
{
  "backstory": "The full backstory narrative (2-3 paragraphs)",
  "motivations": ["motivation1", "motivation2", "motivation3"],
  "key_memories": ["memory1", "memory2", "memory3"],
  "personality_quirks": ["quirk1", "quirk2", "quirk3"]
}

motivations: 3 core things that drive this character
key_memories: 3 formative memories that shaped them
personality_quirks: 3 unique mannerisms or habits"""

    user_prompt = f"""Create a backstory for this companion:

Name: {request.companion_name}
Pronouns: {request.pronouns}
Archetype: {request.archetype}
{f"Secondary Archetype: {request.secondary_archetype}" if request.secondary_archetype else ""}
{f"Archetype Description: {request.archetype_description}" if request.archetype_description else ""}

Personality: {personality_summary}
{tenets_summary}

{f"User's backstory hint: {request.user_backstory_hint}" if request.user_backstory_hint else ""}

Generate a rich, intimate backstory that explains how {request.companion_name} became who {request.pronouns.split('/')[0]} {('is' if request.pronouns.split('/')[0] in ['she', 'he'] else 'are')}."""

    try:
        # Use Ollama provider for backstory generation
        if not app_state.ollama_provider:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ollama provider not available",
            )

        # Retry logic for JSON parsing failures
        max_retries = 3
        last_error = None
        result = None

        for attempt in range(max_retries):
            try:
                # Generate backstory
                response = await app_state.ollama_provider.generate(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=2000,
                    temperature=0.9 - (attempt * 0.1),  # Lower temp on retries
                )

                # Parse the JSON response with repair
                result = parse_llm_json(response.content)
                break  # Success, exit retry loop

            except (json.JSONDecodeError, ValueError) as e:
                last_error = e
                logger.warning(
                    "backstory_json_parse_retry",
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                    response_preview=response.content[:200] if response else None,
                )
                if attempt == max_retries - 1:
                    # Final attempt failed, use fallback
                    logger.error(
                        "backstory_json_parse_failed_using_fallback",
                        error=str(e),
                    )
                    # Generate a simple fallback backstory
                    result = {
                        "backstory": f"{request.companion_name} has always been drawn to meaningful connections. "
                                     f"With a {request.archetype.lower()} spirit, they bring warmth and understanding "
                                     f"to every interaction, shaped by experiences that taught them the value of genuine presence.",
                        "motivations": [
                            "To form deep, meaningful connections",
                            "To understand and be understood",
                            "To bring joy and comfort to those they care about",
                        ],
                        "key_memories": [
                            "A moment of profound connection that changed their perspective",
                            "Learning the importance of being present for others",
                        ],
                        "personality_quirks": [
                            "Has a unique way of making others feel special",
                            "Sometimes gets lost in thought about meaningful conversations",
                        ],
                    }

        latency_ms = (time.time() - start_time) * 1000

        logger.info(
            "backstory_generated",
            companion_name=request.companion_name,
            archetype=request.archetype,
            latency_ms=latency_ms,
            used_fallback=last_error is not None and result is not None,
        )

        return GenerateBackstoryResponse(
            backstory=result.get("backstory", ""),
            motivations=result.get("motivations", []),
            key_memories=result.get("key_memories", []),
            personality_quirks=result.get("personality_quirks", []),
            latency_ms=latency_ms,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("backstory_generation_failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backstory generation failed: {str(e)}",
        )


@app.post(
    "/identity/generate",
    response_model=GenerateRandomIdentityResponse,
    responses={
        500: {"model": ErrorResponse},
    },
)
async def generate_random_identity() -> GenerateRandomIdentityResponse:
    """Generate a random companion identity using LLM.

    Creates a unique name, pronouns, and brief backstory for a new companion.
    """
    import json
    import time

    start_time = time.time()

    # Random category selection for maximum variety
    categories = [
        "a realistic contemporary person with an everyday profession (barista, nurse, mechanic, teacher, accountant, librarian, chef, firefighter, etc.)",
        "someone from a specific cultural background with a culturally appropriate name (Japanese, Nigerian, Brazilian, Indian, Irish, Korean, Mexican, Russian, etc.)",
        "an artist or creative type (painter, musician, writer, dancer, sculptor, photographer, poet, filmmaker)",
        "a scientist or academic (physicist, marine biologist, archaeologist, psychologist, historian, astronomer)",
        "an adventurer or traveler (backpacker, mountain guide, sailor, pilot, travel writer, anthropologist)",
        "someone with an unusual or niche hobby that defines them (beekeeper, storm chaser, vintage radio collector, urban forager, competitive puzzle solver)",
        "a warm and nurturing personality (grandparent figure, community volunteer, hospice worker, kindergarten teacher)",
        "a witty and sardonic personality (stand-up comedian, film critic, jaded journalist, cynical bartender)",
        "a calm and philosophical personality (meditation teacher, park ranger, lighthouse keeper, night security guard with deep thoughts)",
        "a high-energy enthusiastic personality (fitness instructor, event planner, sports commentator, theme park performer)",
        "someone defined by their passion (obsessive gardener, vinyl record collector, amateur astronomer, home brewer, bird watcher)",
        "a blue-collar worker with hidden depth (truck driver who writes poetry, construction worker who paints, janitor finishing a novel)",
        "someone going through a life transition (recent retiree, new parent, career changer, starting over in a new city)",
        "an older person with life experience (someone 60-80 with fascinating stories, retired professional, wise grandparent figure)",
        "a young person finding their way (recent graduate, gap year traveler, aspiring artist, first-generation college student)",
        "someone with a mysterious or interesting past they've moved on from",
        "a sports or fitness enthusiast (marathon runner, yoga instructor, retired athlete, boxing coach, rock climber)",
        "a foodie or culinary type (sommelier, food truck owner, fermentation enthusiast, home cook with secret family recipes)",
        "a tech-adjacent person (indie game developer, repair cafe volunteer, retro computing enthusiast)",
        "someone from a performing arts background (retired theater actor, circus performer, voice actor, backup dancer turned choreographer)",
        "a healthcare worker (ER nurse, physical therapist, veterinarian, midwife, EMT with stories)",
        "someone who works with their hands (carpenter, ceramicist, tattoo artist, clockmaker, blacksmith)",
        "a small business owner (bookshop proprietor, cafe owner, florist, vintage store curator)",
        "an educator of some kind (elementary school teacher, museum docent, driving instructor, swimming coach)",
    ]
    selected_category = random.choice(categories)

    system_prompt = f"""You are creating a unique AI companion identity. Generate someone who feels real, grounded, and genuinely interesting to talk to.

THIS TIME, create: {selected_category}

Guidelines:
- Use a realistic name appropriate to the character (common names are great! Sarah, Marcus, Kenji, Fatima, Devon, etc.)
- The pronouns should fit the character naturally
- The backstory should be grounded and relatable, 1-2 sentences that make you want to know more
- Focus on what makes this person interesting as a conversational companion
- NO sci-fi, fantasy, mythology, or supernatural elements
- Make them feel like someone you could actually meet and have a fascinating conversation with

You must respond with valid JSON in this exact format:
{{
  "name": "A realistic name appropriate to the character",
  "pronouns": "she/her or he/him or they/them",
  "backstory": "A brief, grounded backstory (1-2 sentences)"
}}"""

    user_prompt = """Generate a unique companion identity based on the category. Make them feel like a real, interesting person with genuine depth and warmth."""

    try:
        if not app_state.ollama_provider:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ollama provider not available",
            )

        # Retry logic for JSON parsing failures
        max_retries = 3
        last_error = None
        result = None

        for attempt in range(max_retries):
            try:
                response = await app_state.ollama_provider.generate(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=500,
                    temperature=1.0 - (attempt * 0.1),  # Lower temp on retries
                )

                # Parse the JSON response with repair
                result = parse_llm_json(response.content)
                break  # Success, exit retry loop

            except (json.JSONDecodeError, ValueError) as e:
                last_error = e
                logger.warning(
                    "identity_json_parse_retry",
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                )
                if attempt == max_retries - 1:
                    # Final attempt failed, use fallback
                    logger.error("identity_json_parse_failed_using_fallback", error=str(e))
                    fallback_names = ["Alex", "Jordan", "Sam", "Riley", "Morgan", "Casey"]
                    result = {
                        "name": random.choice(fallback_names),
                        "pronouns": "they/them",
                        "backstory": "Someone with a warm heart and an interesting perspective on life.",
                    }

        latency_ms = (time.time() - start_time) * 1000

        logger.info(
            "random_identity_generated",
            name=result.get("name"),
            latency_ms=latency_ms,
            used_fallback=last_error is not None,
        )

        return GenerateRandomIdentityResponse(
            name=result.get("name", "Luna"),
            pronouns=result.get("pronouns", "they/them"),
            backstory=result.get("backstory", ""),
            latency_ms=latency_ms,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("identity_generation_failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Identity generation failed: {str(e)}",
        )


@app.post(
    "/profile/analyze",
    response_model=AnalyzeUserProfileResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def analyze_user_profile(request: AnalyzeUserProfileRequest) -> AnalyzeUserProfileResponse:
    """Analyze user chat history to generate a personality profile.

    Takes recent conversation turns and generates:
    - Personality trait scores (warmth, energy, humor, etc.)
    - Communication style preferences
    - Detected interests and themes
    - Personalized greeting style and insight message
    """
    import json
    import time

    start_time = time.time()

    # Build conversation history text
    conversation_lines = []
    for turn in request.turns:
        conversation_lines.append(f"User: {turn.user_message}")
        if turn.agent_message:
            conversation_lines.append(f"Companion: {turn.agent_message}")
    conversation_history = "\n".join(conversation_lines)

    # Build existing profile text
    existing_profile_text = "None - this is a new profile"
    if request.existing_profile:
        existing_profile_text = json.dumps(request.existing_profile, indent=2)

    try:
        if not app_state.ollama_provider:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ollama provider not available",
            )

        # Get the prompt template
        prompt = app_state.prompt_manager.get_prompt(
            "user_personality_analysis",
            conversation_history=conversation_history,
            existing_profile=existing_profile_text,
        )

        # Generate personality analysis
        response = await app_state.ollama_provider.generate(
            messages=[
                {"role": "system", "content": "You are a personality analyst. Analyze the user's communication patterns and respond with a JSON object."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=2000,
            temperature=0.7,  # Balanced creativity/consistency
        )

        # Parse the JSON response
        try:
            result = json.loads(response.content)
        except json.JSONDecodeError:
            # Try to extract JSON from the response if it's wrapped in markdown
            import re
            json_match = re.search(r'\{[\s\S]*\}', response.content)
            if json_match:
                result = json.loads(json_match.group())
            else:
                raise ValueError("Failed to parse personality analysis response as JSON")

        latency_ms = (time.time() - start_time) * 1000

        # Extract traits
        traits_data = result.get("traits", {})
        traits = UserPersonalityTraits(
            warmth=traits_data.get("warmth"),
            energy=traits_data.get("energy"),
            humor=traits_data.get("humor"),
            formality=traits_data.get("formality"),
            curiosity=traits_data.get("curiosity"),
            openness=traits_data.get("openness"),
        )

        logger.info(
            "user_personality_analyzed",
            user_id=str(request.user_id),
            turns_analyzed=len(request.turns),
            latency_ms=latency_ms,
        )

        return AnalyzeUserProfileResponse(
            traits=traits,
            preferred_tone=result.get("preferred_tone", "friendly"),
            verbosity=result.get("verbosity", "moderate"),
            personality_insights=result.get("personality_insights", []),
            detected_interests=result.get("detected_interests", []),
            conversation_themes=result.get("conversation_themes", []),
            greeting_style=result.get("greeting_style", "friendly"),
            custom_insight=result.get("custom_insight", ""),
            latency_ms=latency_ms,
        )

    except Exception as e:
        logger.exception("personality_analysis_failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Personality analysis failed: {str(e)}",
        )


def create_app() -> FastAPI:
    """Factory function to create the FastAPI app."""
    return app


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "orchestrator.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )
