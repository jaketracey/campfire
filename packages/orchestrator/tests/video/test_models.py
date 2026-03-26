"""Tests for video call models."""

from uuid import uuid4

import pytest

from orchestrator.video.models import (
    CreateRoomRequest,
    CreateRoomResponse,
    EndCallResponse,
    RoomStatusResponse,
    VideoCallConfig,
    VideoCallSession,
    VideoCallStatus,
)


class TestVideoCallSession:
    """Test VideoCallSession model."""

    def test_defaults(self):
        session = VideoCallSession(
            room_name="test-room",
            companion_id=uuid4(),
            user_id=uuid4(),
        )
        assert session.status == VideoCallStatus.CREATING
        assert session.total_user_turns == 0
        assert session.total_companion_turns == 0
        assert session.ended_at is None
        assert session.duration_seconds is None

    def test_mutable(self):
        session = VideoCallSession(
            room_name="test-room",
            companion_id=uuid4(),
            user_id=uuid4(),
        )
        session.status = VideoCallStatus.ACTIVE
        session.total_user_turns = 5
        assert session.status == VideoCallStatus.ACTIVE
        assert session.total_user_turns == 5


class TestVideoCallConfig:
    """Test VideoCallConfig model."""

    def test_defaults(self):
        config = VideoCallConfig(
            companion_id=uuid4(),
            companion_name="TestBot",
        )
        assert config.voice_id == "21m00Tcm4TlvDq8ikWAM"
        assert config.simli_face_id == "default"
        assert config.temperature == 0.8

    def test_frozen(self):
        config = VideoCallConfig(
            companion_id=uuid4(),
            companion_name="TestBot",
        )
        with pytest.raises(Exception):
            config.voice_id = "other"  # type: ignore[misc]


class TestVideoCallStatus:
    """Test VideoCallStatus enum."""

    def test_values(self):
        assert VideoCallStatus.CREATING == "creating"
        assert VideoCallStatus.ACTIVE == "active"
        assert VideoCallStatus.ENDED == "ended"
        assert VideoCallStatus.ERROR == "error"


class TestRequestResponseModels:
    """Test API request/response schemas."""

    def test_create_room_request(self):
        req = CreateRoomRequest(
            companion_id=uuid4(),
            user_id=uuid4(),
        )
        assert req.voice_id is None
        assert req.simli_face_id is None

    def test_create_room_response(self):
        resp = CreateRoomResponse(
            room_name="test-room",
            token="jwt-token",
            livekit_url="ws://localhost:7880",
            session_id=uuid4(),
        )
        assert resp.room_name == "test-room"

    def test_end_call_response(self):
        resp = EndCallResponse(
            room_name="test-room",
            status=VideoCallStatus.ENDED,
            duration_seconds=120.5,
        )
        assert resp.duration_seconds == 120.5

    def test_room_status_response(self):
        from datetime import datetime

        resp = RoomStatusResponse(
            room_name="test-room",
            status=VideoCallStatus.ACTIVE,
            started_at=datetime.utcnow(),
        )
        assert resp.total_user_turns == 0
