"""Simli avatar client for real-time lip-synced video generation.

Simli takes audio frames and returns lip-synced video frames of a
photorealistic avatar.  Communication happens over a WebSocket connection
that stays open for the duration of the call.

Protocol (simplified):
    1. Open WebSocket to ``wss://api.simli.ai/ws``
    2. Send ``start`` message with face_id and audio config
    3. Stream PCM audio chunks -> receive H.264/VP8 video frames
    4. Send ``stop`` to close gracefully
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import structlog

from orchestrator.video.config import VideoSettings

logger = structlog.get_logger()

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class SimliVideoFrame:
    """A single video frame received from Simli."""

    data: bytes
    timestamp_ms: float
    width: int = 0
    height: int = 0
    codec: str = "h264"


@dataclass
class SimliConnectionState:
    """Internal bookkeeping for a Simli WebSocket session."""

    connected: bool = False
    face_id: str = "default"
    frames_sent: int = 0
    frames_received: int = 0
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class SimliClient:
    """Async client that streams audio to Simli and yields video frames.

    Usage::

        client = SimliClient(settings)
        await client.connect(face_id="abc123")
        # In your pipeline loop:
        video_frame = await client.send_audio(pcm_chunk)
        # When done:
        await client.close()
    """

    def __init__(self, settings: VideoSettings) -> None:
        self._settings = settings
        self._ws: Any | None = None  # aiohttp.ClientWebSocketResponse
        self._session: Any | None = None  # aiohttp.ClientSession
        self._state = SimliConnectionState()
        self._receive_task: asyncio.Task[None] | None = None
        self._video_queue: asyncio.Queue[SimliVideoFrame] = asyncio.Queue(maxsize=120)
        self._close_event = asyncio.Event()

    # -- public API ---------------------------------------------------------

    @property
    def connected(self) -> bool:
        return self._state.connected

    async def connect(self, face_id: str | None = None) -> None:
        """Open a WebSocket connection to Simli and send the start command."""
        import aiohttp

        if self._state.connected:
            logger.warning("simli_already_connected")
            return

        resolved_face = face_id or self._settings.simli_face_id
        self._state.face_id = resolved_face

        self._session = aiohttp.ClientSession()
        headers = {
            "Authorization": f"Bearer {self._settings.simli_api_key}",
        }

        try:
            self._ws = await self._session.ws_connect(
                self._settings.simli_ws_url,
                headers=headers,
                heartbeat=30.0,
            )
        except Exception as exc:
            logger.error("simli_connect_failed", error=str(exc))
            await self._cleanup()
            raise

        # Send start command
        import json

        start_msg = json.dumps({
            "type": "start",
            "face_id": resolved_face,
            "audio_sample_rate": self._settings.tts_sample_rate,
            "audio_encoding": "pcm_s16le",
        })
        await self._ws.send_str(start_msg)

        self._state.connected = True
        self._close_event.clear()

        # Background task to consume incoming video frames
        self._receive_task = asyncio.create_task(self._receive_loop())

        logger.info(
            "simli_connected",
            face_id=resolved_face,
            ws_url=self._settings.simli_ws_url,
        )

    async def send_audio(self, pcm_data: bytes) -> SimliVideoFrame | None:
        """Send a PCM audio chunk and return the next available video frame.

        Returns ``None`` if no frame is ready yet (non-blocking pop).
        """
        if not self._state.connected or self._ws is None:
            raise RuntimeError("SimliClient is not connected")

        await self._ws.send_bytes(pcm_data)
        self._state.frames_sent += 1

        # Try to grab a video frame without blocking
        try:
            return self._video_queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    async def drain_video(self, timeout: float = 0.05) -> list[SimliVideoFrame]:
        """Drain all queued video frames, waiting up to *timeout* seconds for the first."""
        frames: list[SimliVideoFrame] = []
        try:
            frame = await asyncio.wait_for(self._video_queue.get(), timeout=timeout)
            frames.append(frame)
            # Grab any remaining without waiting
            while not self._video_queue.empty():
                frames.append(self._video_queue.get_nowait())
        except (asyncio.TimeoutError, asyncio.QueueEmpty):
            pass
        return frames

    async def close(self) -> None:
        """Gracefully shut down the Simli connection."""
        if not self._state.connected:
            return

        self._state.connected = False
        self._close_event.set()

        if self._ws is not None and not self._ws.closed:
            import json

            try:
                await self._ws.send_str(json.dumps({"type": "stop"}))
                await self._ws.close()
            except Exception as exc:
                logger.debug("simli_close_ws_error", error=str(exc))

        if self._receive_task is not None:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        await self._cleanup()

        logger.info(
            "simli_disconnected",
            frames_sent=self._state.frames_sent,
            frames_received=self._state.frames_received,
        )

    # -- internals ----------------------------------------------------------

    async def _receive_loop(self) -> None:
        """Background task that reads video frames from the WebSocket."""
        import aiohttp
        import json as _json

        if self._ws is None:
            return

        try:
            async for msg in self._ws:
                if self._close_event.is_set():
                    break

                if msg.type == aiohttp.WSMsgType.BINARY:
                    frame = SimliVideoFrame(
                        data=msg.data,
                        timestamp_ms=self._state.frames_received * (1000.0 / 30.0),
                    )
                    self._state.frames_received += 1
                    try:
                        self._video_queue.put_nowait(frame)
                    except asyncio.QueueFull:
                        # Drop oldest frame to keep latency low
                        try:
                            self._video_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                        self._video_queue.put_nowait(frame)

                elif msg.type == aiohttp.WSMsgType.TEXT:
                    data = _json.loads(msg.data)
                    msg_type = data.get("type", "")
                    if msg_type == "error":
                        error_msg = data.get("message", "unknown")
                        self._state.errors.append(error_msg)
                        logger.error("simli_server_error", error=error_msg)
                    elif msg_type == "ready":
                        logger.info("simli_avatar_ready", face_id=self._state.face_id)

                elif msg.type in (
                    aiohttp.WSMsgType.CLOSED,
                    aiohttp.WSMsgType.ERROR,
                ):
                    logger.warning("simli_ws_closed_unexpectedly")
                    break

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("simli_receive_loop_error", error=str(exc))
            self._state.errors.append(str(exc))

    async def _cleanup(self) -> None:
        """Release the aiohttp session."""
        if self._session is not None and not self._session.closed:
            await self._session.close()
            self._session = None
        self._ws = None
