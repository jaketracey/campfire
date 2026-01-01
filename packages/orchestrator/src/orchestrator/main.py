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
from orchestrator.safety.gate import SafetyGate, SafetyLevel
from orchestrator.services.orchestrator import ConversationOrchestrator
from orchestrator.tools.router import ToolRouter

logger = structlog.get_logger()


# Request/Response models
class ProcessMessageRequest(BaseModel):
    """Request model for processing a message."""

    session_id: UUID
    user_id: UUID
    companion_spec: CompanionSpec
    user_message: str
    recent_turns: list[ConversationTurn] | None = None
    session_summary: SessionSummary | None = None
    long_term_memories: list[LongTermMemory] | None = None


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


# Application state
class AppState:
    """Application state container."""

    settings: Settings
    event_emitter: EventEmitter
    prompt_manager: PromptManager
    safety_gate: SafetyGate
    tool_router: ToolRouter
    orchestrator: ConversationOrchestrator


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

    # Initialize safety gate
    app_state.safety_gate = SafetyGate(
        event_emitter=app_state.event_emitter,
        policy_version="1.0.0",
        safety_level=SafetyLevel.STRICT if settings.safety_strict_mode else SafetyLevel.STANDARD,
        enabled=settings.safety_enabled,
        strict_mode=settings.safety_strict_mode,
        content_filter_threshold=settings.content_filter_threshold,
    )

    # Initialize tool router
    app_state.tool_router = ToolRouter(
        settings=settings,
        event_emitter=app_state.event_emitter,
    )

    # Initialize orchestrator
    app_state.orchestrator = ConversationOrchestrator(
        settings=settings,
        event_emitter=app_state.event_emitter,
        prompt_manager=app_state.prompt_manager,
        safety_gate=app_state.safety_gate,
        tool_router=app_state.tool_router,
    )

    logger.info(
        "orchestrator_service_started",
        version=settings.app_version,
        environment=settings.environment,
        prompt_version=app_state.prompt_manager.current_version,
        policy_version=app_state.safety_gate.policy_version,
    )

    yield

    # Shutdown
    logger.info("stopping_orchestrator_service")
    await app_state.tool_router.close()
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
            )

            result = await app_state.orchestrator.process_message(
                session_id=request.session_id,
                user_id=request.user_id,
                companion_spec=request.companion_spec,
                user_message=request.user_message,
                recent_turns=request.recent_turns,
                session_summary=request.session_summary,
                long_term_memories=request.long_term_memories,
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
