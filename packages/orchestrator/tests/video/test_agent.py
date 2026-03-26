"""Tests for the VideoAgent pipeline."""

import asyncio
import struct
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from orchestrator.video.agent import VideoAgent, VideoAgentCallbacks, _frame_has_speech
from orchestrator.video.config import VideoSettings
from orchestrator.video.models import VideoCallConfig, VideoCallSession, VideoCallStatus


@pytest.fixture
def video_settings():
    return VideoSettings(
        livekit_api_key="test-key",
        livekit_api_secret="test-secret",
        livekit_url="ws://localhost:7880",
        simli_api_key="simli-key",
        deepgram_api_key="dg-key",
        elevenlabs_api_key="el-key",
        video_call_max_duration_minutes=1,
        _env_file=None,  # type: ignore[call-arg]
    )


@pytest.fixture
def session():
    return VideoCallSession(
        room_name="test-room",
        companion_id=uuid4(),
        user_id=uuid4(),
    )


@pytest.fixture
def call_config():
    return VideoCallConfig(
        companion_id=uuid4(),
        companion_name="TestCompanion",
        voice_id="voice-123",
        simli_face_id="face-456",
    )


@pytest.fixture
def mock_orchestrator_factory():
    mock_orchestrator = AsyncMock()
    mock_turn = MagicMock()
    mock_turn.assistant_message.content = "Hello from the companion!"
    mock_orchestrator.process_message = AsyncMock(return_value=mock_turn)

    async def factory(session_id, user_id, companion_id):
        return mock_orchestrator

    return factory


class TestFrameHasSpeech:
    """Test the energy-based VAD helper."""

    def test_silence_returns_false(self):
        """All zeros should be detected as silence."""
        silence = b"\x00" * 640  # 320 samples of silence
        assert _frame_has_speech(silence, threshold=0.5) is False

    def test_loud_signal_returns_true(self):
        """A loud sine-ish wave should be detected as speech."""
        # Generate samples at ~50% amplitude
        amplitude = 16000
        samples = [amplitude] * 160 + [-amplitude] * 160
        pcm = struct.pack(f"<{len(samples)}h", *samples)
        assert _frame_has_speech(pcm, threshold=0.5) is True

    def test_empty_data_returns_false(self):
        assert _frame_has_speech(b"", threshold=0.5) is False

    def test_single_byte_returns_false(self):
        assert _frame_has_speech(b"\x00", threshold=0.5) is False


class TestVideoAgent:
    """Test VideoAgent construction and session management."""

    def test_init(self, video_settings, session, call_config, mock_orchestrator_factory):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )
        assert agent.session.room_name == "test-room"
        assert agent.session.status == VideoCallStatus.CREATING

    @pytest.mark.asyncio
    async def test_stop_sets_ended_status(
        self, video_settings, session, call_config, mock_orchestrator_factory
    ):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )
        # Simulate that start already ran (set _running)
        agent._running = True
        session.status = VideoCallStatus.ACTIVE

        await agent._stop()

        assert session.status == VideoCallStatus.ENDED
        assert session.ended_at is not None
        assert session.duration_seconds is not None


class TestVideoAgentCallbacks:
    """Test that default callbacks are no-ops."""

    @pytest.mark.asyncio
    async def test_default_callbacks_are_noop(self):
        cb = VideoAgentCallbacks()
        session = VideoCallSession(
            room_name="r",
            companion_id=uuid4(),
            user_id=uuid4(),
        )
        # None of these should raise
        await cb.on_call_started(session)
        await cb.on_user_speech(session, "hello")
        await cb.on_companion_response(session, "hi")
        await cb.on_call_ended(session)
        await cb.on_error(session, Exception("test"))


class TestVideoAgentTranscribe:
    """Test the STT sub-pipeline in isolation."""

    @pytest.mark.asyncio
    async def test_transcribe_success(
        self, video_settings, session, call_config, mock_orchestrator_factory
    ):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "results": {
                "channels": [
                    {
                        "alternatives": [
                            {"transcript": "Hello world"}
                        ]
                    }
                ]
            },
            "metadata": {"duration": 1.5},
        }

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await agent._transcribe(b"\x00" * 640)

        assert result == "Hello world"
        assert session.total_stt_seconds == 1.5

    @pytest.mark.asyncio
    async def test_transcribe_error_returns_empty(
        self, video_settings, session, call_config, mock_orchestrator_factory
    ):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("network error"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await agent._transcribe(b"\x00" * 640)

        assert result == ""


class TestVideoAgentSynthesize:
    """Test the TTS sub-pipeline in isolation."""

    @pytest.mark.asyncio
    async def test_synthesize_success(
        self, video_settings, session, call_config, mock_orchestrator_factory
    ):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )

        # Simulate 1 second of 24kHz 16-bit mono audio
        fake_audio = b"\x00" * (24000 * 2)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.content = fake_audio

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await agent._synthesize("Hello companion")

        assert len(result) == len(fake_audio)
        assert session.total_tts_seconds == pytest.approx(1.0, abs=0.01)

    @pytest.mark.asyncio
    async def test_synthesize_error_returns_empty(
        self, video_settings, session, call_config, mock_orchestrator_factory
    ):
        agent = VideoAgent(
            settings=video_settings,
            session=session,
            call_config=call_config,
            orchestrator_factory=mock_orchestrator_factory,
        )

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("tts error"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await agent._synthesize("test")

        assert result == b""
