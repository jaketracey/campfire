"""FastAPI routes for video call management.

Endpoints:
    POST /video/rooms          -- Create a LiveKit room and return a user token
    POST /video/rooms/{name}/end -- End a video call
    GET  /video/rooms/{name}/status -- Get call status
"""

from __future__ import annotations

import asyncio
import secrets
import time
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status

from orchestrator.video.config import VideoSettings, get_video_settings
from orchestrator.video.models import (
    CreateRoomRequest,
    CreateRoomResponse,
    EndCallResponse,
    RoomStatusResponse,
    VideoCallConfig,
    VideoCallSession,
    VideoCallStatus,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/video", tags=["video"])

# In-memory session store.  For production this would be Redis-backed;
# keeping it simple here so the feature can ship and iterate.
_sessions: dict[str, VideoCallSession] = {}
_agent_tasks: dict[str, asyncio.Task[None]] = {}


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _generate_room_name() -> str:
    """Generate a unique, URL-safe room name."""
    return f"campfire-{secrets.token_urlsafe(8)}"


def _generate_user_token(
    settings: VideoSettings, room_name: str, user_id: UUID
) -> str:
    """Generate a LiveKit access token for the end-user participant."""
    from livekit import api

    token = api.AccessToken(
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )
    token.with_identity(f"user-{user_id}")
    token.with_name(f"user-{user_id}")
    grant = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    )
    token.with_grants(grant)
    return str(token.to_jwt())


async def _create_livekit_room(settings: VideoSettings, room_name: str) -> None:
    """Create a LiveKit room via the server API."""
    from livekit import api

    lk_api = api.LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )
    try:
        await lk_api.room.create_room(
            api.CreateRoomRequest(name=room_name, empty_timeout=300, max_participants=2)
        )
    finally:
        await lk_api.aclose()


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------


@router.post("/rooms", response_model=CreateRoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(body: CreateRoomRequest) -> CreateRoomResponse:
    """Create a new video call room and return connection details.

    This will:
    1. Create a LiveKit room
    2. Generate a participant token for the user
    3. Spawn the AI agent in the background to join the room
    """
    settings = get_video_settings()

    if not settings.livekit_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit is not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        )

    # Enforce concurrency limit
    active_count = sum(
        1 for s in _sessions.values() if s.status == VideoCallStatus.ACTIVE
    )
    if active_count >= settings.video_call_max_concurrent:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Maximum concurrent video calls reached.",
        )

    room_name = _generate_room_name()

    # Create session tracking object
    session = VideoCallSession(
        room_name=room_name,
        companion_id=body.companion_id,
        user_id=body.user_id,
        status=VideoCallStatus.CREATING,
    )
    _sessions[room_name] = session

    # Build per-companion call config
    call_config = VideoCallConfig(
        companion_id=body.companion_id,
        companion_name="Companion",  # Will be enriched when wired to DB
        voice_id=body.voice_id or settings.elevenlabs_default_voice_id,
        simli_face_id=body.simli_face_id or settings.simli_face_id,
    )

    try:
        # Create the LiveKit room
        await _create_livekit_room(settings, room_name)

        # Generate the user's participant token
        user_token = _generate_user_token(settings, room_name, body.user_id)

        session.status = VideoCallStatus.WAITING

        # Spawn the agent in the background (it will wait for the user to join)
        task = asyncio.create_task(
            _run_agent(settings, session, call_config),
            name=f"agent-{room_name}",
        )
        _agent_tasks[room_name] = task

        logger.info(
            "video_room_created",
            room=room_name,
            companion_id=str(body.companion_id),
            user_id=str(body.user_id),
        )

        return CreateRoomResponse(
            room_name=room_name,
            token=user_token,
            livekit_url=settings.livekit_url,
            session_id=session.id,
        )

    except Exception as exc:
        session.status = VideoCallStatus.ERROR
        session.error_message = str(exc)
        logger.error("create_room_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create room: {exc}",
        ) from exc


@router.post("/rooms/{room_name}/end", response_model=EndCallResponse)
async def end_call(room_name: str) -> EndCallResponse:
    """Gracefully end an active video call."""
    session = _sessions.get(room_name)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room '{room_name}' not found.",
        )

    # Cancel the agent task
    task = _agent_tasks.get(room_name)
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Update session state if the agent didn't already
    if session.status not in (VideoCallStatus.ENDED, VideoCallStatus.ERROR):
        from datetime import datetime

        session.status = VideoCallStatus.ENDED
        session.ended_at = datetime.utcnow()
        if session.started_at and session.ended_at:
            session.duration_seconds = (
                session.ended_at - session.started_at
            ).total_seconds()

    logger.info("video_call_ended", room=room_name)

    return EndCallResponse(
        room_name=room_name,
        status=session.status,
        duration_seconds=session.duration_seconds,
    )


@router.get("/rooms/{room_name}/status", response_model=RoomStatusResponse)
async def get_room_status(room_name: str) -> RoomStatusResponse:
    """Get the current status of a video call."""
    session = _sessions.get(room_name)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room '{room_name}' not found.",
        )

    return RoomStatusResponse(
        room_name=session.room_name,
        status=session.status,
        started_at=session.started_at,
        ended_at=session.ended_at,
        duration_seconds=session.duration_seconds,
        total_user_turns=session.total_user_turns,
        total_companion_turns=session.total_companion_turns,
    )


# ------------------------------------------------------------------
# Background agent runner
# ------------------------------------------------------------------


async def _run_agent(
    settings: VideoSettings,
    session: VideoCallSession,
    call_config: VideoCallConfig,
) -> None:
    """Launch a VideoAgent for the given session.

    This runs as an ``asyncio.Task`` created in :func:`create_room`.
    """
    from orchestrator.video.agent import VideoAgent

    async def orchestrator_factory(
        session_id: UUID, user_id: UUID, companion_id: UUID
    ) -> Any:
        """Return the shared ConversationOrchestrator from the app state.

        Imports are deferred to avoid circular dependencies with main.py.
        """
        from orchestrator.main import app_state

        return app_state.orchestrator

    agent = VideoAgent(
        settings=settings,
        session=session,
        call_config=call_config,
        orchestrator_factory=orchestrator_factory,
    )

    try:
        await agent.run()
    except asyncio.CancelledError:
        await agent.stop()
    except Exception as exc:
        logger.error("agent_task_failed", room=session.room_name, error=str(exc))
        session.status = VideoCallStatus.ERROR
        session.error_message = str(exc)
