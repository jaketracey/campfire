"""Tests for the Simli avatar client."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from orchestrator.video.config import VideoSettings
from orchestrator.video.simli import SimliClient, SimliConnectionState, SimliVideoFrame


@pytest.fixture
def video_settings():
    return VideoSettings(
        simli_api_key="test-key",
        simli_ws_url="wss://test.simli.ai/ws",
        tts_sample_rate=24000,
        _env_file=None,  # type: ignore[call-arg]
    )


@pytest.fixture
def simli_client(video_settings):
    return SimliClient(video_settings)


class TestSimliConnectionState:
    def test_defaults(self):
        state = SimliConnectionState()
        assert state.connected is False
        assert state.frames_sent == 0
        assert state.frames_received == 0
        assert state.errors == []


class TestSimliVideoFrame:
    def test_creation(self):
        frame = SimliVideoFrame(data=b"\x00" * 100, timestamp_ms=33.3)
        assert len(frame.data) == 100
        assert frame.codec == "h264"


class TestSimliClient:
    def test_initial_state(self, simli_client):
        assert simli_client.connected is False

    @pytest.mark.asyncio
    async def test_send_audio_raises_when_not_connected(self, simli_client):
        with pytest.raises(RuntimeError, match="not connected"):
            await simli_client.send_audio(b"\x00" * 100)

    @pytest.mark.asyncio
    async def test_close_when_not_connected_is_noop(self, simli_client):
        # Should not raise
        await simli_client.close()

    @pytest.mark.asyncio
    async def test_connect_sends_start_message(self, simli_client):
        """Verify connect() opens a WebSocket and sends the start command."""
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.send_str = AsyncMock()
        mock_ws.send_bytes = AsyncMock()
        mock_ws.__aiter__ = AsyncMock(return_value=iter([]))

        mock_session = AsyncMock()
        mock_session.ws_connect = AsyncMock(return_value=mock_ws)
        mock_session.closed = False

        with patch("aiohttp.ClientSession", return_value=mock_session):
            await simli_client.connect(face_id="test-face")

        assert simli_client.connected is True

        # Verify the start message was sent
        mock_ws.send_str.assert_called_once()
        sent_msg = json.loads(mock_ws.send_str.call_args[0][0])
        assert sent_msg["type"] == "start"
        assert sent_msg["face_id"] == "test-face"
        assert sent_msg["audio_sample_rate"] == 24000

        # Cleanup
        simli_client._state.connected = False
        simli_client._close_event.set()
        if simli_client._receive_task:
            simli_client._receive_task.cancel()
            try:
                await simli_client._receive_task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_send_audio_after_connect(self, simli_client):
        """Verify send_audio forwards bytes to the WebSocket."""
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.send_str = AsyncMock()
        mock_ws.send_bytes = AsyncMock()
        mock_ws.__aiter__ = AsyncMock(return_value=iter([]))

        mock_session = AsyncMock()
        mock_session.ws_connect = AsyncMock(return_value=mock_ws)
        mock_session.closed = False

        with patch("aiohttp.ClientSession", return_value=mock_session):
            await simli_client.connect(face_id="face1")

        audio_chunk = b"\x00" * 1920
        result = await simli_client.send_audio(audio_chunk)

        mock_ws.send_bytes.assert_called_once_with(audio_chunk)
        assert result is None  # No video frames queued yet

        # Cleanup
        simli_client._state.connected = False
        simli_client._close_event.set()
        if simli_client._receive_task:
            simli_client._receive_task.cancel()
            try:
                await simli_client._receive_task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_drain_video_returns_empty_when_no_frames(self, simli_client):
        frames = await simli_client.drain_video(timeout=0.01)
        assert frames == []

    @pytest.mark.asyncio
    async def test_drain_video_returns_queued_frames(self, simli_client):
        frame = SimliVideoFrame(data=b"\x01\x02", timestamp_ms=0.0)
        simli_client._video_queue.put_nowait(frame)

        frames = await simli_client.drain_video(timeout=0.1)
        assert len(frames) == 1
        assert frames[0].data == b"\x01\x02"
