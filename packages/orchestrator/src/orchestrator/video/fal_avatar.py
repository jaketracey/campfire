"""FAL-based avatar client for lip-synced video generation.

Uses fal-ai/live-avatar to generate lip-synced video from a static
companion reference image and audio chunks.  This replaces Simli by
using the companion's own PuLID-generated face instead of a generic avatar.

Pipeline (per audio chunk):
    1. Buffer PCM audio until chunk duration is reached
    2. Convert PCM -> WAV
    3. Upload WAV to FAL storage
    4. Submit to fal-ai/live-avatar (image_url + audio_url)
    5. Poll for completion
    6. Download video, extract frames
    7. Queue frames for LiveKit publishing
"""

from __future__ import annotations

import asyncio
import io
import struct
import time
import wave
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

from orchestrator.video.config import VideoSettings

logger = structlog.get_logger()

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class VideoFrame:
    """A single decoded video frame for LiveKit publishing."""

    data: bytes
    timestamp_ms: float
    width: int = 512
    height: int = 512
    format: str = "i420"


@dataclass
class FalAvatarConnectionState:
    """Internal bookkeeping for a FAL avatar session."""

    connected: bool = False
    reference_image_url: str = ""
    chunks_submitted: int = 0
    frames_produced: int = 0
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Audio utilities
# ---------------------------------------------------------------------------


def pcm_to_wav(
    pcm_data: bytes,
    sample_rate: int = 24000,
    channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    """Wrap raw 16-bit PCM data in a WAV container.

    Args:
        pcm_data: Raw PCM bytes (signed 16-bit little-endian).
        sample_rate: Audio sample rate in Hz.
        channels: Number of audio channels.
        sample_width: Bytes per sample (2 for 16-bit).

    Returns:
        Complete WAV file as bytes.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()


async def upload_audio_to_fal(wav_data: bytes, api_key: str) -> str:
    """Upload a WAV file to FAL's file storage and return a public URL.

    Uses the FAL storage upload endpoint which returns a CDN-backed URL
    suitable for passing to FAL model endpoints.

    Args:
        wav_data: Complete WAV file bytes.
        api_key: FAL API key for authentication.

    Returns:
        Public URL of the uploaded file.

    Raises:
        RuntimeError: If upload fails.
    """
    upload_url = "https://fal.run/fal-ai/file-storage/upload"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            upload_url,
            headers={
                "Authorization": f"Key {api_key}",
                "Content-Type": "audio/wav",
            },
            content=wav_data,
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"FAL file upload failed: {resp.status_code} {resp.text[:200]}"
            )
        data = resp.json()
        url = data.get("url") or data.get("file_url") or data.get("access_url")
        if not url:
            raise RuntimeError(f"FAL file upload returned no URL: {data}")
        return str(url)


# ---------------------------------------------------------------------------
# Video frame extraction
# ---------------------------------------------------------------------------


async def extract_frames_from_video(
    video_url: str,
    target_fps: float = 30.0,
    width: int = 512,
    height: int = 512,
) -> list[VideoFrame]:
    """Download a video and extract frames as I420 byte buffers.

    Uses PyAV (ffmpeg) for decoding.  Falls back to an empty list if
    the video cannot be decoded rather than crashing the pipeline.

    Args:
        video_url: Public URL of the video to download.
        target_fps: Target frame rate for extraction.
        width: Target frame width.
        height: Target frame height.

    Returns:
        List of VideoFrame objects in I420 format.
    """
    try:
        import av
    except ImportError:
        logger.error("pyav_not_installed", hint="pip install av")
        return []

    frames: list[VideoFrame] = []

    try:
        # Download video
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(video_url)
            resp.raise_for_status()
            video_bytes = resp.content

        # Decode in a thread to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        frames = await loop.run_in_executor(
            None, _decode_video_frames, video_bytes, target_fps, width, height
        )
    except Exception as exc:
        logger.error("frame_extraction_failed", error=str(exc))

    return frames


def _pack_plane(plane: Any, width: int, height: int) -> bytes:
    """Extract tightly-packed bytes from a PyAV VideoPlane, stripping stride padding.

    PyAV planes may have ``line_size`` (stride) > ``width`` due to memory
    alignment.  ``bytes(plane)`` returns the full padded buffer which breaks
    I420 layout expectations in downstream consumers like LiveKit.
    """
    if plane.line_size == width:
        return bytes(plane)
    # Stride padding present — copy only the valid pixels per row
    buf = memoryview(plane)
    stride = plane.line_size
    return b"".join(bytes(buf[row * stride : row * stride + width]) for row in range(height))


def _decode_video_frames(
    video_bytes: bytes,
    target_fps: float,
    width: int,
    height: int,
) -> list[VideoFrame]:
    """Synchronous video decode using PyAV. Runs in a thread executor."""
    import av

    frames: list[VideoFrame] = []
    container = av.open(io.BytesIO(video_bytes))

    stream = container.streams.video[0]
    stream.thread_type = "AUTO"

    # Calculate frame interval for target fps
    source_fps = float(stream.average_rate) if stream.average_rate else 30.0
    frame_interval = max(1, int(source_fps / target_fps))

    frame_index = 0
    for frame in container.decode(video=0):
        if frame_index % frame_interval != 0:
            frame_index += 1
            continue

        # Resize and convert to YUV420P (I420)
        frame = frame.reformat(width=width, height=height, format="yuv420p")
        # Concatenate Y, U, V planes into a tightly-packed buffer.
        # PyAV planes may include stride padding (line_size > width),
        # so we must strip padding to produce valid I420 for LiveKit.
        i420_data = (
            _pack_plane(frame.planes[0], width, height)
            + _pack_plane(frame.planes[1], width // 2, height // 2)
            + _pack_plane(frame.planes[2], width // 2, height // 2)
        )

        timestamp_ms = len(frames) * (1000.0 / target_fps)
        frames.append(
            VideoFrame(
                data=i420_data,
                timestamp_ms=timestamp_ms,
                width=width,
                height=height,
            )
        )
        frame_index += 1

    container.close()
    return frames


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class FalAvatarClient:
    """Async client that generates lip-synced avatar video via FAL.

    Drop-in replacement for SimliClient.  Instead of a persistent
    WebSocket, audio is buffered into chunks and submitted as
    asynchronous FAL queue jobs.

    Usage::

        client = FalAvatarClient(settings)
        await client.connect(reference_image_url="https://...")
        # In your pipeline loop:
        video_frame = await client.send_audio(pcm_chunk)
        frames = await client.drain_video(timeout=0.05)
        # At end of TTS output:
        await client.flush()
        # When done:
        await client.close()
    """

    def __init__(self, settings: VideoSettings) -> None:
        self._settings = settings
        self._state = FalAvatarConnectionState()
        self._audio_buffer = bytearray()
        self._chunk_duration_seconds = settings.avatar_chunk_duration_seconds
        self._video_queue: asyncio.Queue[VideoFrame] = asyncio.Queue(maxsize=120)
        self._generation_tasks: list[asyncio.Task[None]] = []
        self._close_event = asyncio.Event()

    # -- public API ---------------------------------------------------------

    @property
    def connected(self) -> bool:
        return self._state.connected

    async def connect(
        self,
        face_id: str | None = None,
        reference_image_url: str | None = None,
    ) -> None:
        """Initialise the client with the companion's reference image.

        Args:
            face_id: Ignored (Simli compatibility parameter).
            reference_image_url: URL of the companion's anchor/reference
                face image used for lip-sync generation.
        """
        if self._state.connected:
            logger.warning("fal_avatar_already_connected")
            return

        if not reference_image_url:
            raise ValueError(
                "FalAvatarClient requires a reference_image_url "
                "(the companion's anchor face image)"
            )

        self._state.reference_image_url = reference_image_url
        self._state.connected = True
        self._close_event.clear()

        logger.info(
            "fal_avatar_connected",
            reference_image_url=reference_image_url[:80],
            chunk_duration_s=self._chunk_duration_seconds,
            model=self._settings.fal_avatar_model,
        )

    async def send_audio(self, pcm_data: bytes) -> VideoFrame | None:
        """Buffer incoming PCM audio.  When a full chunk is accumulated,
        fire off an async FAL generation task.

        Returns the next available video frame (non-blocking), or None.
        """
        if not self._state.connected:
            raise RuntimeError("FalAvatarClient is not connected")

        self._audio_buffer.extend(pcm_data)

        # Check if we have enough audio for a chunk
        chunk_size = int(
            self._chunk_duration_seconds * self._settings.tts_sample_rate * 2
        )  # 16-bit PCM = 2 bytes per sample

        if len(self._audio_buffer) >= chunk_size:
            chunk = bytes(self._audio_buffer[:chunk_size])
            self._audio_buffer = self._audio_buffer[chunk_size:]
            self._dispatch_chunk(chunk)

        return self._try_get_frame()

    async def drain_video(self, timeout: float = 0.05) -> list[VideoFrame]:
        """Drain all queued video frames, waiting up to *timeout* for the first."""
        frames: list[VideoFrame] = []
        try:
            frame = await asyncio.wait_for(
                self._video_queue.get(), timeout=timeout
            )
            frames.append(frame)
            # Grab remaining without waiting
            while not self._video_queue.empty():
                frames.append(self._video_queue.get_nowait())
        except (asyncio.TimeoutError, asyncio.QueueEmpty):
            pass
        return frames

    async def flush(self) -> None:
        """Process any remaining audio in the buffer (end of speech)."""
        if len(self._audio_buffer) > 0:
            chunk = bytes(self._audio_buffer)
            self._audio_buffer.clear()
            self._dispatch_chunk(chunk)

    async def close(self) -> None:
        """Cancel pending generation tasks and clean up."""
        if not self._state.connected:
            return

        self._state.connected = False
        self._close_event.set()

        # Cancel all pending generation tasks
        for task in self._generation_tasks:
            if not task.done():
                task.cancel()

        # Wait for cancellations to complete
        if self._generation_tasks:
            await asyncio.gather(*self._generation_tasks, return_exceptions=True)
        self._generation_tasks.clear()

        logger.info(
            "fal_avatar_disconnected",
            chunks_submitted=self._state.chunks_submitted,
            frames_produced=self._state.frames_produced,
            errors=len(self._state.errors),
        )

    # -- internals ----------------------------------------------------------

    def _dispatch_chunk(self, pcm_chunk: bytes) -> None:
        """Create a background task to generate video for an audio chunk."""
        self._state.chunks_submitted += 1
        task = asyncio.create_task(
            self._generate_clip(pcm_chunk),
            name=f"fal-avatar-clip-{self._state.chunks_submitted}",
        )
        self._generation_tasks.append(task)
        # Clean up completed tasks to avoid unbounded growth
        self._generation_tasks = [t for t in self._generation_tasks if not t.done()]

    def _try_get_frame(self) -> VideoFrame | None:
        """Non-blocking attempt to get the next video frame."""
        try:
            return self._video_queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    async def _generate_clip(self, pcm_audio: bytes) -> None:
        """Core pipeline: upload audio, call FAL, extract frames, enqueue.

        Steps:
            1. Convert PCM to WAV
            2. Upload WAV to FAL storage
            3. Submit to fal-ai/live-avatar
            4. Poll for completion
            5. Download result video
            6. Extract frames and push to queue
        """
        if self._close_event.is_set():
            return

        clip_start = time.monotonic()
        chunk_id = self._state.chunks_submitted

        try:
            # 1. PCM -> WAV
            wav_data = pcm_to_wav(
                pcm_audio,
                sample_rate=self._settings.tts_sample_rate,
                channels=1,
            )

            # 2. Upload to FAL storage
            audio_url = await upload_audio_to_fal(
                wav_data, self._settings.fal_api_key
            )

            if self._close_event.is_set():
                return

            # 3. Submit to FAL live-avatar queue
            request_id = await self._submit_to_fal(audio_url)

            if self._close_event.is_set():
                return

            # 4. Poll for completion
            result = await self._poll_fal_result(request_id)

            if self._close_event.is_set():
                return

            # 5. Extract video URL from result
            video_url = self._extract_video_url(result)
            if not video_url:
                logger.error(
                    "fal_avatar_no_video_url",
                    chunk_id=chunk_id,
                    result_keys=list(result.keys()),
                )
                return

            # 6. Extract frames from video
            frames = await extract_frames_from_video(
                video_url,
                target_fps=30.0,
                width=512,
                height=512,
            )

            # 7. Enqueue frames
            for frame in frames:
                if self._close_event.is_set():
                    break
                try:
                    self._video_queue.put_nowait(frame)
                    self._state.frames_produced += 1
                except asyncio.QueueFull:
                    # Drop oldest to keep latency low
                    try:
                        self._video_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    self._video_queue.put_nowait(frame)
                    self._state.frames_produced += 1

            elapsed_ms = (time.monotonic() - clip_start) * 1000
            logger.info(
                "fal_avatar_clip_generated",
                chunk_id=chunk_id,
                frames=len(frames),
                elapsed_ms=f"{elapsed_ms:.0f}",
            )

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error_msg = f"Clip {chunk_id}: {exc}"
            self._state.errors.append(error_msg)
            logger.error(
                "fal_avatar_clip_error",
                chunk_id=chunk_id,
                error=str(exc),
            )

    async def _submit_to_fal(self, audio_url: str) -> str:
        """Submit a lip-sync job to the FAL queue and return the request ID."""
        endpoint = self._settings.fal_avatar_model
        queue_url = f"https://queue.fal.run/{endpoint}"

        payload = {
            "image_url": self._state.reference_image_url,
            "audio_url": audio_url,
            "acceleration": self._settings.fal_avatar_acceleration,
            "num_clips": 1,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                queue_url,
                headers={
                    "Authorization": f"Key {self._settings.fal_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"FAL queue submit failed: {resp.status_code} {resp.text[:300]}"
                )

            data = resp.json()
            request_id = data.get("request_id")
            if not request_id:
                raise RuntimeError(f"FAL queue returned no request_id: {data}")

            logger.debug(
                "fal_avatar_job_submitted",
                request_id=request_id,
                endpoint=endpoint,
            )
            return str(request_id)

    async def _poll_fal_result(
        self,
        request_id: str,
        max_wait_seconds: float = 120.0,
        poll_interval: float = 1.0,
    ) -> dict[str, Any]:
        """Poll the FAL queue for job completion."""
        endpoint = self._settings.fal_avatar_model
        status_url = (
            f"https://queue.fal.run/{endpoint}/requests/{request_id}/status"
        )
        result_url = (
            f"https://queue.fal.run/{endpoint}/requests/{request_id}"
        )

        elapsed = 0.0
        async with httpx.AsyncClient(timeout=30.0) as client:
            while elapsed < max_wait_seconds:
                if self._close_event.is_set():
                    raise asyncio.CancelledError("Client closed during poll")

                resp = await client.get(
                    status_url,
                    headers={"Authorization": f"Key {self._settings.fal_api_key}"},
                )
                resp.raise_for_status()
                status_data = resp.json()
                status = status_data.get("status")

                if status == "COMPLETED":
                    result_resp = await client.get(
                        result_url,
                        headers={
                            "Authorization": f"Key {self._settings.fal_api_key}"
                        },
                    )
                    result_resp.raise_for_status()
                    result_data: dict[str, Any] = result_resp.json()
                    return result_data
                elif status == "FAILED":
                    error = status_data.get("error", "Unknown")
                    raise RuntimeError(
                        f"FAL live-avatar job failed: {error}"
                    )

                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                # Back off slightly over time
                poll_interval = min(poll_interval * 1.1, 5.0)

        raise TimeoutError(
            f"FAL live-avatar request {request_id} timed out "
            f"after {max_wait_seconds}s"
        )

    @staticmethod
    def _extract_video_url(result: dict[str, Any]) -> str | None:
        """Extract the video URL from a FAL result payload.

        The response shape varies by model version, so we try several
        common patterns.
        """
        # Direct video field
        if "video" in result:
            v = result["video"]
            if isinstance(v, dict):
                return v.get("url")
            if isinstance(v, str):
                return v

        # video_url field
        if "video_url" in result:
            return str(result["video_url"])

        # Nested output
        if "output" in result:
            out = result["output"]
            if isinstance(out, dict):
                return out.get("video_url") or out.get("url")
            if isinstance(out, str):
                return out

        return None
