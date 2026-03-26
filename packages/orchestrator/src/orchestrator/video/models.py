"""Pydantic models for video call state and configuration."""

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class VideoCallStatus(str, Enum):
    """Lifecycle status of a video call."""

    CREATING = "creating"
    WAITING = "waiting"       # Room created, waiting for participants
    ACTIVE = "active"         # Call in progress
    ENDING = "ending"         # Graceful shutdown in progress
    ENDED = "ended"           # Call terminated
    ERROR = "error"           # Unrecoverable error


class VideoCallSession(BaseModel):
    """Tracks the state of a single video call."""

    id: UUID = Field(default_factory=uuid4)
    room_name: str
    participant_sid: str | None = None
    companion_id: UUID
    user_id: UUID
    status: VideoCallStatus = VideoCallStatus.CREATING
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: datetime | None = None
    duration_seconds: float | None = None
    error_message: str | None = None

    # Metrics collected during the call
    total_user_turns: int = 0
    total_companion_turns: int = 0
    total_stt_seconds: float = 0.0
    total_tts_seconds: float = 0.0

    class Config:
        frozen = False  # Mutable -- updated throughout the call lifecycle


class VideoCallConfig(BaseModel):
    """Per-companion configuration for a video call.

    Merges companion-level overrides (voice, face) with system defaults.
    """

    companion_id: UUID
    companion_name: str

    # Voice
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # ElevenLabs default (Rachel)
    tts_model: str = "eleven_multilingual_v2"

    # Avatar / visual
    simli_face_id: str = "default"
    avatar_url: str | None = None

    # LLM behaviour overrides (passed through to ConversationOrchestrator)
    temperature: float = 0.8
    max_context_turns: int = 20
    system_prompt: str = ""

    class Config:
        frozen = True


# --- Request / response schemas for the REST API ---


class CreateRoomRequest(BaseModel):
    """Request body for POST /video/rooms."""

    companion_id: UUID
    user_id: UUID
    # Optional overrides
    voice_id: str | None = None
    simli_face_id: str | None = None


class CreateRoomResponse(BaseModel):
    """Response from POST /video/rooms."""

    room_name: str
    token: str  # LiveKit participant token for the user
    livekit_url: str
    session_id: UUID


class EndCallResponse(BaseModel):
    """Response from POST /video/rooms/{room_name}/end."""

    room_name: str
    status: VideoCallStatus
    duration_seconds: float | None = None


class RoomStatusResponse(BaseModel):
    """Response from GET /video/rooms/{room_name}/status."""

    room_name: str
    status: VideoCallStatus
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: float | None = None
    total_user_turns: int = 0
    total_companion_turns: int = 0
