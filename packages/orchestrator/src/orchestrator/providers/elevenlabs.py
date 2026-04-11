"""ElevenLabs text-to-speech provider implementation.

Uses the official ``elevenlabs`` Python SDK for REST calls and raw
``aiohttp`` WebSockets for the real-time text-to-speech streaming
endpoint (lowest-latency path used by the video pipeline).
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, AsyncGenerator

import aiohttp
import structlog
from elevenlabs import AsyncElevenLabs, VoiceSettings
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import TTSProvider, TTSResult

logger = structlog.get_logger()

# Default voice settings used across all synthesis methods.
_DEFAULT_VOICE_SETTINGS = VoiceSettings(
    stability=0.5,
    similarity_boost=0.75,
    style=0.0,
    use_speaker_boost=True,
)


class ElevenLabsProvider(TTSProvider):
    """ElevenLabs text-to-speech provider backed by the official SDK."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.default_model = settings.elevenlabs_model
        self.default_voice_id = settings.elevenlabs_default_voice_id
        self._client: AsyncElevenLabs | None = None

    @property
    def name(self) -> str:
        return "elevenlabs"

    def _get_client(self) -> AsyncElevenLabs:
        """Get or create the async SDK client."""
        if self._client is None:
            self._client = AsyncElevenLabs(api_key=self.settings.elevenlabs_api_key)
        return self._client

    # ------------------------------------------------------------------
    # synthesize – single-shot text-to-speech
    # ------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        model: str | None = None,
        output_format: str = "mp3_44100_128",
    ) -> TTSResult:
        """Synthesize text to speech."""
        start_time = time.time()

        client = self._get_client()
        voice = voice_id or self.default_voice_id

        try:
            audio_iterator = await client.text_to_speech.convert(
                text=text,
                voice_id=voice,
                model_id=model or self.default_model,
                output_format=output_format,
                voice_settings=_DEFAULT_VOICE_SETTINGS,
            )

            # The SDK may return an async iterator of bytes or raw bytes.
            if hasattr(audio_iterator, "__aiter__"):
                audio_data = b"".join([chunk async for chunk in audio_iterator])
            else:
                audio_data = audio_iterator  # type: ignore[assignment]

            latency_ms = (time.time() - start_time) * 1000

            # Rough duration estimate (mp3 128 kbps -> bytes / 16000)
            estimated_duration = len(audio_data) / 16000

            logger.info(
                "elevenlabs_synthesis",
                text_length=len(text),
                audio_bytes=len(audio_data),
                estimated_duration=estimated_duration,
                latency_ms=latency_ms,
            )

            return TTSResult(
                audio_data=audio_data,
                format=output_format,
                duration_seconds=estimated_duration,
                latency_ms=latency_ms,
            )

        except Exception as e:
            logger.error("elevenlabs_synthesis_error", error=str(e))
            raise

    # ------------------------------------------------------------------
    # synthesize_stream – chunked HTTP streaming
    # ------------------------------------------------------------------

    async def synthesize_stream(
        self,
        text: str,
        voice_id: str | None = None,
        model: str | None = None,
        output_format: str = "mp3_44100_128",
    ) -> AsyncGenerator[bytes, None]:
        """Synthesize text to streaming audio."""
        client = self._get_client()
        voice = voice_id or self.default_voice_id

        try:
            audio_stream = await client.text_to_speech.convert_as_stream(
                text=text,
                voice_id=voice,
                model_id=model or self.default_model,
                output_format=output_format,
                voice_settings=_DEFAULT_VOICE_SETTINGS,
            )

            async for chunk in audio_stream:
                yield chunk

        except Exception as e:
            logger.error("elevenlabs_stream_error", error=str(e))
            raise

    # ------------------------------------------------------------------
    # list_voices / get_voice
    # ------------------------------------------------------------------

    async def list_voices(self) -> list[dict[str, Any]]:
        """List available voices."""
        client = self._get_client()

        try:
            response = await client.voices.get_all()
            voices = []

            for voice in response.voices:
                voices.append({
                    "voice_id": voice.voice_id,
                    "name": voice.name,
                    "category": voice.category,
                    "labels": voice.labels or {},
                    "preview_url": voice.preview_url,
                })

            logger.info("elevenlabs_voices_listed", count=len(voices))
            return voices

        except Exception as e:
            logger.error("elevenlabs_list_voices_error", error=str(e))
            raise

    async def get_voice(self, voice_id: str) -> dict[str, Any]:
        """Get details for a specific voice."""
        client = self._get_client()

        try:
            voice = await client.voices.get(voice_id)
            # Prefer model_dump() (Pydantic v2) with fallback to dict()
            if hasattr(voice, "model_dump"):
                return voice.model_dump()
            return voice.dict()  # type: ignore[union-attr]

        except Exception as e:
            logger.error(
                "elevenlabs_get_voice_error",
                voice_id=voice_id,
                error=str(e),
            )
            raise

    # ------------------------------------------------------------------
    # synthesize_websocket – real-time streaming via WebSocket
    # ------------------------------------------------------------------

    async def synthesize_websocket(
        self,
        text_stream: AsyncGenerator[str, None],
        voice_id: str | None = None,
        model: str | None = None,
        output_format: str = "pcm_24000",
    ) -> AsyncGenerator[bytes, None]:
        """Stream text chunks to audio via WebSocket for lowest latency.

        Uses the ElevenLabs WebSocket ``stream-input`` API to convert text
        chunks to audio incrementally as they arrive from the LLM.

        Args:
            text_stream: Async generator yielding text chunks from LLM.
            voice_id: Voice to use (falls back to default).
            model: TTS model (recommend ``eleven_flash_v2_5`` for lowest latency).
            output_format: Audio format (``pcm_24000`` for real-time).

        Yields:
            Raw audio bytes (PCM or other, per *output_format*).
        """
        voice = voice_id or self.default_voice_id
        model_id = model or self.default_model
        ws_url = (
            f"wss://api.elevenlabs.io/v1/text-to-speech/{voice}"
            f"/stream-input?model_id={model_id}&output_format={output_format}"
        )

        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(ws_url) as ws:
                # 1. Send initial configuration message
                init_msg = {
                    "text": " ",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "style": 0.0,
                        "use_speaker_boost": True,
                    },
                    "xi_api_key": self.settings.elevenlabs_api_key,
                }
                await ws.send_json(init_msg)

                # 2. Send text chunks as they arrive from the LLM
                async for text_chunk in text_stream:
                    if text_chunk:
                        await ws.send_json({"text": text_chunk})

                        # Drain any audio that has arrived while we were sending
                        while True:
                            try:
                                msg = await ws.receive(timeout=0.01)
                            except Exception:
                                break
                            if msg.type in (
                                aiohttp.WSMsgType.CLOSE,
                                aiohttp.WSMsgType.CLOSING,
                                aiohttp.WSMsgType.CLOSED,
                            ):
                                return
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                data = json.loads(msg.data)
                                if data.get("audio"):
                                    yield base64.b64decode(data["audio"])
                                if data.get("isFinal"):
                                    return

                # 3. Flush remaining audio
                await ws.send_json({"text": "", "flush": True})

                # 4. Receive remaining audio chunks until final message
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("audio"):
                            yield base64.b64decode(data["audio"])
                        if data.get("isFinal"):
                            break
                    elif msg.type in (
                        aiohttp.WSMsgType.ERROR,
                        aiohttp.WSMsgType.CLOSE,
                        aiohttp.WSMsgType.CLOSING,
                        aiohttp.WSMsgType.CLOSED,
                    ):
                        break

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Close the SDK client."""
        self._client = None  # SDK handles cleanup
