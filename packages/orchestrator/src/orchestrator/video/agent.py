"""LiveKit AI agent that orchestrates the real-time video chat pipeline.

Pipeline overview::

    User audio (LiveKit track)
      -> VAD (voice activity detection for turn-taking)
      -> Deepgram STT (streaming transcription)
      -> ConversationOrchestrator.process_message() (LLM + tools + memory)
      -> ElevenLabs TTS (streaming audio)
      -> Simli API (audio -> lip-synced avatar video frames)
      -> Publish audio + video tracks back to LiveKit room

The agent joins a LiveKit room as a server-side participant and manages
the full duplex pipeline for one companion <-> one user interaction.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from uuid import UUID

import structlog

from orchestrator.video.config import VideoSettings
from orchestrator.video.fal_avatar import FalAvatarClient
from orchestrator.video.models import (
    VideoCallConfig,
    VideoCallSession,
    VideoCallStatus,
)
from orchestrator.video.simli import SimliClient

logger = structlog.get_logger()

# Re-export for convenience
__all__ = ["VideoAgent", "VideoAgentCallbacks"]


class VideoAgentCallbacks:
    """Hook points for external code to observe agent lifecycle events.

    Subclass and override the methods you care about.
    """

    async def on_call_started(self, session: VideoCallSession) -> None:
        """Called when the agent has joined the room and is ready."""

    async def on_user_speech(self, session: VideoCallSession, text: str) -> None:
        """Called when a user utterance has been transcribed."""

    async def on_companion_response(
        self, session: VideoCallSession, text: str
    ) -> None:
        """Called when the LLM has produced a text response."""

    async def on_call_ended(self, session: VideoCallSession) -> None:
        """Called when the call has ended (gracefully or due to error)."""

    async def on_error(self, session: VideoCallSession, error: Exception) -> None:
        """Called on unrecoverable errors."""


class VideoAgent:
    """Manages a single video call between one user and one AI companion.

    Instantiate one ``VideoAgent`` per call, then call :meth:`run` to start
    the pipeline.  The agent will keep running until the call ends or the
    max duration is reached.

    Parameters
    ----------
    settings:
        Video-specific settings (keys, URLs, limits).
    session:
        Mutable session state for this call.
    call_config:
        Per-companion voice/avatar configuration.
    orchestrator_factory:
        An async callable that, given ``(session_id, user_id, companion_id)``,
        returns a ``ConversationOrchestrator`` ready to process messages.
        This keeps the agent decoupled from the FastAPI dependency graph.
    callbacks:
        Optional lifecycle hooks.
    """

    def __init__(
        self,
        settings: VideoSettings,
        session: VideoCallSession,
        call_config: VideoCallConfig,
        orchestrator_factory: Any,
        callbacks: VideoAgentCallbacks | None = None,
    ) -> None:
        self._settings = settings
        self._session = session
        self._config = call_config
        self._orchestrator_factory = orchestrator_factory
        self._callbacks = callbacks or VideoAgentCallbacks()

        # Runtime state
        self._running = False
        self._avatar_client: FalAvatarClient | SimliClient | None = None
        self._lk_room: Any | None = None  # livekit.rtc.Room
        self._pipeline_task: asyncio.Task[None] | None = None
        self._max_duration_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def session(self) -> VideoCallSession:
        return self._session

    async def run(self) -> None:
        """Entry point: join the LiveKit room and run the pipeline loop.

        This method blocks until the call ends.
        """
        try:
            await self._start()
            # Block until the call finishes
            if self._pipeline_task is not None:
                await self._pipeline_task
        except asyncio.CancelledError:
            logger.info("video_agent_cancelled", room=self._session.room_name)
        except Exception as exc:
            logger.error(
                "video_agent_fatal",
                room=self._session.room_name,
                error=str(exc),
            )
            self._session.status = VideoCallStatus.ERROR
            self._session.error_message = str(exc)
            await self._callbacks.on_error(self._session, exc)
        finally:
            await self._stop()

    async def stop(self) -> None:
        """Request a graceful shutdown from outside the run loop."""
        self._running = False
        if self._pipeline_task is not None:
            self._pipeline_task.cancel()

    # ------------------------------------------------------------------
    # Lifecycle helpers
    # ------------------------------------------------------------------

    async def _start(self) -> None:
        """Connect to LiveKit, Simli, and launch background tasks."""
        from livekit import rtc

        self._running = True
        self._session.status = VideoCallStatus.ACTIVE

        # 1. Connect to LiveKit room as the companion bot
        self._lk_room = rtc.Room()
        lk_token = _generate_agent_token(
            self._settings,
            self._session.room_name,
            identity=f"companion-{self._config.companion_id}",
        )
        await self._lk_room.connect(self._settings.livekit_url, lk_token)
        logger.info(
            "video_agent_joined_room",
            room=self._session.room_name,
            identity=f"companion-{self._config.companion_id}",
        )

        # 2. Connect to avatar rendering provider
        if self._settings.avatar_provider == "fal":
            fal_client = FalAvatarClient(self._settings)
            await fal_client.connect(
                reference_image_url=self._config.avatar_url,
            )
            self._avatar_client = fal_client
            logger.info("video_agent_avatar_provider", provider="fal")
        else:
            simli_client = SimliClient(self._settings)
            await simli_client.connect(face_id=self._config.simli_face_id)
            self._avatar_client = simli_client
            logger.info("video_agent_avatar_provider", provider="simli")

        # 3. Start the pipeline loop
        self._pipeline_task = asyncio.create_task(
            self._pipeline_loop(), name="video-pipeline"
        )

        # 4. Enforce max call duration
        max_seconds = self._settings.video_call_max_duration_minutes * 60
        self._max_duration_task = asyncio.create_task(
            self._enforce_max_duration(max_seconds), name="max-duration"
        )

        await self._callbacks.on_call_started(self._session)

    async def _stop(self) -> None:
        """Tear down connections and update session state."""
        self._running = False
        self._session.status = VideoCallStatus.ENDING

        # Cancel background tasks
        for task in (self._max_duration_task, self._pipeline_task):
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        # Disconnect avatar client
        if self._avatar_client is not None:
            await self._avatar_client.close()
            self._avatar_client = None

        # Disconnect LiveKit
        if self._lk_room is not None:
            await self._lk_room.disconnect()
            self._lk_room = None

        # Finalise session
        from datetime import datetime

        self._session.ended_at = datetime.utcnow()
        if self._session.started_at and self._session.ended_at:
            self._session.duration_seconds = (
                self._session.ended_at - self._session.started_at
            ).total_seconds()
        self._session.status = VideoCallStatus.ENDED

        await self._callbacks.on_call_ended(self._session)
        logger.info(
            "video_agent_stopped",
            room=self._session.room_name,
            duration_s=self._session.duration_seconds,
            user_turns=self._session.total_user_turns,
            companion_turns=self._session.total_companion_turns,
        )

    # ------------------------------------------------------------------
    # Core pipeline
    # ------------------------------------------------------------------

    async def _pipeline_loop(self) -> None:
        """Main loop: listen for user audio, transcribe, respond, render.

        The loop is structured around *turns*:
            1. Accumulate user audio until VAD detects end-of-speech
            2. Transcribe the accumulated audio via Deepgram
            3. Send transcription to the ConversationOrchestrator
            4. Stream LLM text to ElevenLabs TTS
            5. Stream TTS audio to Simli for video rendering
            6. Publish video + audio back to LiveKit
        """
        from livekit import rtc

        if self._lk_room is None:
            return

        # Create audio/video source tracks for the companion
        audio_source = rtc.AudioSource(
            sample_rate=self._settings.tts_sample_rate,
            num_channels=1,
        )
        video_source = rtc.VideoSource(
            width=512,
            height=512,
        )

        audio_track = rtc.LocalAudioTrack.create_audio_track("companion-audio", audio_source)
        video_track = rtc.LocalVideoTrack.create_video_track("companion-video", video_source)

        audio_pub_options = rtc.TrackPublishOptions()
        video_pub_options = rtc.TrackPublishOptions()

        await self._lk_room.local_participant.publish_track(audio_track, audio_pub_options)
        await self._lk_room.local_participant.publish_track(video_track, video_pub_options)

        logger.info("video_agent_tracks_published", room=self._session.room_name)

        # Prepare the orchestrator (reuses existing LLM pipeline)
        orchestrator = await self._orchestrator_factory(
            self._session.id,
            self._session.user_id,
            self._config.companion_id,
        )

        # Subscribe to the user's audio track
        audio_stream = await self._subscribe_to_user_audio()
        if audio_stream is None:
            logger.warning("no_user_audio_track", room=self._session.room_name)
            return

        # --- Turn loop ---
        speech_buffer = bytearray()
        silence_frames = 0
        frames_per_silence_window = int(
            self._settings.vad_silence_duration_ms
            / 20  # assume 20ms frames
        )

        while self._running:
            try:
                frame = await asyncio.wait_for(
                    audio_stream.__anext__(), timeout=1.0
                )
            except (asyncio.TimeoutError, StopAsyncIteration):
                continue

            # Extract PCM data from AudioFrameEvent
            # LiveKit's AudioFrameEvent has .frame (AudioFrame) which has .data (memoryview)
            try:
                if hasattr(frame, 'frame'):
                    af = frame.frame
                    pcm_data = bytes(af.data) if hasattr(af, 'data') else bytes(af)
                else:
                    pcm_data = bytes(frame.data) if hasattr(frame, 'data') else bytes(frame)
            except Exception:
                continue

            # Simple energy-based VAD
            is_speech = _frame_has_speech(
                pcm_data, threshold=self._settings.vad_threshold
            )

            if is_speech:
                speech_buffer.extend(pcm_data)
                silence_frames = 0
            elif len(speech_buffer) > 0:
                silence_frames += 1
                if silence_frames >= frames_per_silence_window:
                    # End of user turn -- process the speech
                    await self._process_user_turn(
                        bytes(speech_buffer),
                        orchestrator,
                        audio_source,
                        video_source,
                    )
                    speech_buffer.clear()
                    silence_frames = 0

    async def _subscribe_to_user_audio(self) -> Any | None:
        """Wait for the user participant and return an audio stream."""
        from livekit import rtc

        if self._lk_room is None:
            return None

        # Wait up to 30 s for a remote participant to publish an audio track
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline and self._running:
            for participant in self._lk_room.remote_participants.values():
                for track_pub in participant.track_publications.values():
                    if (
                        track_pub.track is not None
                        and track_pub.kind == rtc.TrackKind.KIND_AUDIO
                    ):
                        stream = rtc.AudioStream(track_pub.track)
                        self._session.participant_sid = participant.sid
                        logger.info(
                            "subscribed_user_audio",
                            participant=participant.identity,
                        )
                        return stream
            await asyncio.sleep(0.5)

        return None

    async def _process_user_turn(
        self,
        audio_data: bytes,
        orchestrator: Any,
        audio_source: Any,
        video_source: Any,
    ) -> None:
        """Run the full STT -> LLM -> TTS -> Simli pipeline for one user turn."""
        self._session.total_user_turns += 1

        # --- 1. STT via Deepgram ---
        transcript = await self._transcribe(audio_data)
        if not transcript or not transcript.strip():
            return

        await self._callbacks.on_user_speech(self._session, transcript)
        logger.info(
            "user_speech_transcribed",
            room=self._session.room_name,
            text=transcript[:100],
        )

        # --- 2. LLM via ConversationOrchestrator ---
        llm_response_text = await self._get_llm_response(orchestrator, transcript)
        if not llm_response_text:
            return

        self._session.total_companion_turns += 1
        await self._callbacks.on_companion_response(self._session, llm_response_text)

        # --- 3. TTS via ElevenLabs ---
        tts_audio = await self._synthesize(llm_response_text)
        if not tts_audio:
            return

        # --- 4. Send TTS audio to Simli and get video frames ---
        await self._render_and_publish(tts_audio, audio_source, video_source)

    # ------------------------------------------------------------------
    # Sub-pipeline steps
    # ------------------------------------------------------------------

    async def _transcribe(self, audio_data: bytes) -> str:
        """Transcribe audio via Deepgram REST endpoint."""
        import httpx

        url = "https://api.deepgram.com/v1/listen"
        headers = {
            "Authorization": f"Token {self._settings.deepgram_api_key}",
            "Content-Type": "audio/raw;encoding=linear16;"
            f"sample_rate={self._settings.stt_sample_rate};channels=1",
        }
        params = {
            "model": self._settings.deepgram_model,
            "language": self._settings.deepgram_language,
            "punctuate": "true",
            "smart_format": "true",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    url, headers=headers, params=params, content=audio_data
                )
                resp.raise_for_status()
                data = resp.json()

            alternatives = (
                data.get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [])
            )
            if alternatives:
                transcript: str = str(alternatives[0].get("transcript", ""))
                self._session.total_stt_seconds += float(
                    data.get("metadata", {}).get("duration", 0.0)
                )
                return transcript
        except Exception as exc:
            logger.error("deepgram_transcribe_error", error=str(exc))

        return ""

    async def _get_llm_response(
        self, orchestrator: Any, user_text: str
    ) -> str:
        """Get the companion's text response via the existing orchestrator."""
        try:
            from orchestrator.models.conversation import CompanionSpec

            # Build a minimal CompanionSpec from call config
            companion_spec = CompanionSpec(
                id=self._config.companion_id,
                name=self._config.companion_name,
                description="",
                system_prompt=self._config.system_prompt,
                voice_id=self._config.voice_id,
                temperature=self._config.temperature,
                max_context_turns=self._config.max_context_turns,
            )

            result = await orchestrator.process_message(
                session_id=self._session.id,
                user_id=self._session.user_id,
                companion_spec=companion_spec,
                user_message=user_text,
            )

            # process_message returns a ConversationTurn
            if hasattr(result, "assistant_message") and result.assistant_message:
                return str(result.assistant_message.content)
            return ""
        except Exception as exc:
            logger.error("llm_response_error", error=str(exc))
            return ""

    async def _synthesize(self, text: str) -> bytes:
        """Convert text to PCM audio via ElevenLabs."""
        import httpx

        voice_id = self._config.voice_id
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": self._settings.elevenlabs_api_key,
            "Content-Type": "application/json",
            "Accept": "audio/pcm",
        }
        payload = {
            "text": text,
            "model_id": self._config.tts_model,
            "output_format": f"pcm_{self._settings.tts_sample_rate}",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                audio_bytes = resp.content
                duration = len(audio_bytes) / (self._settings.tts_sample_rate * 2)
                self._session.total_tts_seconds += duration
                return audio_bytes
        except Exception as exc:
            logger.error("elevenlabs_tts_error", error=str(exc))
            return b""

    async def _render_and_publish(
        self,
        tts_audio: bytes,
        audio_source: Any,
        video_source: Any,
    ) -> None:
        """Stream TTS audio through avatar client and publish video + audio."""
        from livekit import rtc

        if self._avatar_client is None or not self._avatar_client.connected:
            # Fallback: publish audio only (no avatar video)
            await self._publish_audio_only(tts_audio, audio_source)
            return

        # Send audio to avatar client in chunks and collect video frames
        chunk_size = self._settings.tts_sample_rate * 2 // 25  # ~40ms chunks
        offset = 0

        while offset < len(tts_audio) and self._running:
            chunk = tts_audio[offset : offset + chunk_size]
            offset += chunk_size

            await self._avatar_client.send_audio(chunk)

            # Publish the audio chunk to LiveKit
            audio_frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=self._settings.tts_sample_rate,
                num_channels=1,
                samples_per_channel=len(chunk) // 2,
            )
            await audio_source.capture_frame(audio_frame)

            # Drain any available video frames from avatar client
            video_frames = await self._avatar_client.drain_video(timeout=0.02)
            for vf in video_frames:
                lk_frame = rtc.VideoFrame(
                    width=512,
                    height=512,
                    type=rtc.VideoBufferType.I420,
                    data=vf.data,
                )
                video_source.capture_frame(lk_frame)

            # Pace output to roughly real-time
            await asyncio.sleep(chunk_size / (self._settings.tts_sample_rate * 2))

        # Flush remaining audio (important for FalAvatarClient which buffers)
        if hasattr(self._avatar_client, "flush"):
            await self._avatar_client.flush()

    async def _publish_audio_only(
        self, tts_audio: bytes, audio_source: Any
    ) -> None:
        """Fallback: publish TTS audio without avatar video."""
        from livekit import rtc

        chunk_size = self._settings.tts_sample_rate * 2 // 25
        offset = 0

        while offset < len(tts_audio) and self._running:
            chunk = tts_audio[offset : offset + chunk_size]
            offset += chunk_size

            audio_frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=self._settings.tts_sample_rate,
                num_channels=1,
                samples_per_channel=len(chunk) // 2,
            )
            await audio_source.capture_frame(audio_frame)
            await asyncio.sleep(chunk_size / (self._settings.tts_sample_rate * 2))

    # ------------------------------------------------------------------
    # Max duration enforcement
    # ------------------------------------------------------------------

    async def _enforce_max_duration(self, max_seconds: int) -> None:
        """Cancel the call after the configured maximum duration."""
        await asyncio.sleep(max_seconds)
        logger.warning(
            "video_call_max_duration_reached",
            room=self._session.room_name,
            max_minutes=self._settings.video_call_max_duration_minutes,
        )
        await self.stop()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _generate_agent_token(
    settings: VideoSettings, room_name: str, identity: str
) -> str:
    """Generate a LiveKit access token for the agent participant."""
    from livekit import api

    token = api.AccessToken(
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )
    token.with_identity(identity)
    token.with_name(identity)
    grant = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    )
    token.with_grants(grant)
    return str(token.to_jwt())


def _frame_has_speech(pcm_data: bytes, threshold: float = 0.5) -> bool:
    """Simple energy-based voice activity detection on 16-bit PCM.

    Returns True if the RMS energy of the frame exceeds a fraction of the
    maximum possible amplitude, scaled by ``threshold``.
    """
    if not pcm_data or len(pcm_data) < 2:
        return False

    import struct

    # Ensure we only unpack complete 16-bit samples
    num_samples = len(pcm_data) // 2
    if num_samples == 0:
        return False
    usable_bytes = num_samples * 2
    samples = struct.unpack(f"<{num_samples}h", pcm_data[:usable_bytes])

    # RMS energy
    sum_sq = sum(s * s for s in samples)
    rms = (sum_sq / num_samples) ** 0.5

    # Normalise to 0-1 range (max amplitude for 16-bit is 32767)
    normalised = rms / 32767.0

    return bool(normalised > (threshold * 0.02))  # threshold=0.5 -> ~1% of max amp
