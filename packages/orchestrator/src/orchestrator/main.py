"""FastAPI server for the orchestrator service."""

import asyncio
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
from orchestrator.tools.router import ToolRouter

logger = structlog.get_logger()


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

    logger.info(
        "orchestrator_service_started",
        version=settings.app_version,
        environment=settings.environment,
        prompt_version=app_state.prompt_manager.current_version,
        policy_version=app_state.safety_gate.policy_version,
        comfyui_enabled=app_state.comfyui_provider is not None,
        fal_enabled=app_state.fal_provider is not None,
        ollama_enabled=app_state.ollama_provider is not None,
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
                stream=True,
            )

            if isinstance(result, AsyncGenerator):
                async for chunk in result:
                    yield f"data: {chunk}\n\n"
                yield "data: [DONE]\n\n"
            elif isinstance(result, ConversationTurn):
                # Fallback to non-streaming if provider doesn't support it
                if result.assistant_message:
                    yield f"data: {result.assistant_message.content}\n\n"
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
    """
    import base64

    # Build the full prompt with emotional modifiers (sensual/intimate style)
    emotional_modifiers = {
        "happy": "radiant smile, sparkling eyes, joyful and flirty expression, warm glow",
        "calm": "serene sensual expression, relaxed intimate pose, soft bedroom lighting, dreamy",
        "curious": "alluring curious gaze, head tilted seductively, inviting expression",
        "excited": "energetic, flushed cheeks, excited anticipation, dynamic sensual pose",
        "thoughtful": "contemplative sultry gaze, pensive expression, soft romantic focus",
        "supportive": "warm empathetic gaze, inviting open posture, intimate comforting presence",
        "playful": "mischievous flirty smile, sparkling teasing eyes, playful seductive pose",
        "neutral": "confident sensual expression, alluring gaze, intimate presence",
    }

    style_prompts = {
        "realistic": "photorealistic, highly detailed, 8k, professional boudoir photography, intimate lighting",
        "stylized": "beautiful stylized render, soft romantic lighting, sensual artistic style",
        "abstract": "ethereal sensual art, soft flowing forms, romantic abstract lighting",
        "minimal": "elegant minimalist, tasteful intimate, soft clean aesthetic",
        "anime": "beautiful anime style, expressive sensual, romantic illustration, detailed",
    }

    # Build full prompt
    full_prompt = request.prompt
    if request.emotional_state in emotional_modifiers:
        full_prompt += f", {emotional_modifiers[request.emotional_state]}"
    if request.style in style_prompts:
        full_prompt += f", {style_prompts[request.style]}"
    full_prompt += ", high quality, detailed, beautiful lighting"

    logger.info(
        "imagegen_request",
        prompt=full_prompt[:100],
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

        # Generate backstory
        response = await app_state.ollama_provider.generate(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=2000,
            temperature=0.9,  # Higher creativity for backstory
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
                raise ValueError("Failed to parse backstory response as JSON")

        latency_ms = (time.time() - start_time) * 1000

        logger.info(
            "backstory_generated",
            companion_name=request.companion_name,
            archetype=request.archetype,
            latency_ms=latency_ms,
        )

        return GenerateBackstoryResponse(
            backstory=result.get("backstory", ""),
            motivations=result.get("motivations", []),
            key_memories=result.get("key_memories", []),
            personality_quirks=result.get("personality_quirks", []),
            latency_ms=latency_ms,
        )

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

    system_prompt = """You are a creative writer creating unique AI companion identities.
Generate a compelling, memorable companion identity that feels intimate and personal.

The name should be:
- Unique and memorable (not common names like "Alex" or "Sam")
- Can be fantastical, mythological, celestial, or nature-inspired
- Easy to pronounce and remember
- Examples: Luna, Kira, Zephyr, Nova, Orion, Sage, Echo, Ember, Aria, Phoenix

The backstory should be:
- 1-2 sentences that hint at mystery and depth
- Evocative and intriguing
- Personal and intimate in tone

You must respond with valid JSON in this exact format:
{
  "name": "A unique companion name",
  "pronouns": "she/her or he/him or they/them",
  "backstory": "A brief, intriguing backstory (1-2 sentences)"
}"""

    user_prompt = """Generate a unique, captivating companion identity. Be creative and make the character feel special and memorable."""

    try:
        if not app_state.ollama_provider:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ollama provider not available",
            )

        response = await app_state.ollama_provider.generate(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=500,
            temperature=1.0,  # High creativity for variety
        )

        # Parse the JSON response
        try:
            result = json.loads(response.content)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{[\s\S]*\}', response.content)
            if json_match:
                result = json.loads(json_match.group())
            else:
                raise ValueError("Failed to parse identity response as JSON")

        latency_ms = (time.time() - start_time) * 1000

        logger.info(
            "random_identity_generated",
            name=result.get("name"),
            latency_ms=latency_ms,
        )

        return GenerateRandomIdentityResponse(
            name=result.get("name", "Luna"),
            pronouns=result.get("pronouns", "they/them"),
            backstory=result.get("backstory", ""),
            latency_ms=latency_ms,
        )

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
