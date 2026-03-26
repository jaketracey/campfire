"""Tests for video call API routes."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orchestrator.video.models import VideoCallStatus
from orchestrator.video.router import router, _sessions, _agent_tasks


@pytest.fixture(autouse=True)
def clean_sessions():
    """Ensure session store is clean before and after each test."""
    _sessions.clear()
    _agent_tasks.clear()
    yield
    _sessions.clear()
    _agent_tasks.clear()


@pytest.fixture
def app():
    """Create a test FastAPI app with the video router."""
    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


@pytest.fixture
def client(app):
    return TestClient(app)


class TestCreateRoom:
    """Test POST /video/rooms."""

    def test_returns_503_when_livekit_not_configured(self, client):
        """Should reject when LiveKit keys are missing."""
        with patch(
            "orchestrator.video.router.get_video_settings"
        ) as mock_settings:
            settings = MagicMock()
            settings.livekit_configured = False
            mock_settings.return_value = settings

            response = client.post(
                "/video/rooms",
                json={
                    "companion_id": str(uuid4()),
                    "user_id": str(uuid4()),
                },
            )

        assert response.status_code == 503

    def test_returns_429_when_at_capacity(self, client):
        """Should reject when max concurrent calls reached."""
        # Pre-fill sessions at capacity
        from orchestrator.video.models import VideoCallSession

        for i in range(10):
            s = VideoCallSession(
                room_name=f"room-{i}",
                companion_id=uuid4(),
                user_id=uuid4(),
                status=VideoCallStatus.ACTIVE,
            )
            _sessions[f"room-{i}"] = s

        with patch(
            "orchestrator.video.router.get_video_settings"
        ) as mock_settings:
            settings = MagicMock()
            settings.livekit_configured = True
            settings.video_call_max_concurrent = 10
            mock_settings.return_value = settings

            response = client.post(
                "/video/rooms",
                json={
                    "companion_id": str(uuid4()),
                    "user_id": str(uuid4()),
                },
            )

        assert response.status_code == 429

    def test_creates_room_successfully(self, client):
        """Happy path: room created, session tracked, token returned."""
        with patch(
            "orchestrator.video.router.get_video_settings"
        ) as mock_settings, patch(
            "orchestrator.video.router._create_livekit_room",
            new_callable=AsyncMock,
        ), patch(
            "orchestrator.video.router._generate_user_token",
            return_value="fake-jwt-token",
        ), patch(
            "orchestrator.video.router._run_agent",
            new_callable=AsyncMock,
        ):
            settings = MagicMock()
            settings.livekit_configured = True
            settings.video_call_max_concurrent = 10
            settings.livekit_url = "ws://localhost:7880"
            settings.elevenlabs_default_voice_id = "voice-1"
            settings.simli_face_id = "face-1"
            mock_settings.return_value = settings

            response = client.post(
                "/video/rooms",
                json={
                    "companion_id": str(uuid4()),
                    "user_id": str(uuid4()),
                },
            )

        assert response.status_code == 201
        data = response.json()
        assert data["token"] == "fake-jwt-token"
        assert data["livekit_url"] == "ws://localhost:7880"
        assert "room_name" in data
        assert "session_id" in data

        # Session should be tracked
        assert data["room_name"] in _sessions


class TestEndCall:
    """Test POST /video/rooms/{room_name}/end."""

    def test_404_when_room_not_found(self, client):
        response = client.post("/video/rooms/nonexistent/end")
        assert response.status_code == 404

    def test_ends_active_call(self, client):
        from orchestrator.video.models import VideoCallSession

        session = VideoCallSession(
            room_name="room-abc",
            companion_id=uuid4(),
            user_id=uuid4(),
            status=VideoCallStatus.ACTIVE,
        )
        _sessions["room-abc"] = session

        response = client.post("/video/rooms/room-abc/end")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ended"
        assert data["room_name"] == "room-abc"

    def test_end_already_ended_call(self, client):
        from orchestrator.video.models import VideoCallSession
        from datetime import datetime

        session = VideoCallSession(
            room_name="room-done",
            companion_id=uuid4(),
            user_id=uuid4(),
            status=VideoCallStatus.ENDED,
            ended_at=datetime.utcnow(),
            duration_seconds=60.0,
        )
        _sessions["room-done"] = session

        response = client.post("/video/rooms/room-done/end")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ended"
        assert data["duration_seconds"] == 60.0


class TestGetRoomStatus:
    """Test GET /video/rooms/{room_name}/status."""

    def test_404_when_room_not_found(self, client):
        response = client.get("/video/rooms/nonexistent/status")
        assert response.status_code == 404

    def test_returns_status(self, client):
        from orchestrator.video.models import VideoCallSession

        session = VideoCallSession(
            room_name="room-status",
            companion_id=uuid4(),
            user_id=uuid4(),
            status=VideoCallStatus.ACTIVE,
        )
        session.total_user_turns = 3
        session.total_companion_turns = 3
        _sessions["room-status"] = session

        response = client.get("/video/rooms/room-status/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        assert data["total_user_turns"] == 3
        assert data["total_companion_turns"] == 3
