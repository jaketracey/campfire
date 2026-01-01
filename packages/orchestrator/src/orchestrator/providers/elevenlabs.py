"""ElevenLabs text-to-speech provider implementation."""

import time
from typing import Any, AsyncGenerator

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import TTSProvider, TTSResult

logger = structlog.get_logger()


class ElevenLabsProvider(TTSProvider):
    """ElevenLabs text-to-speech provider."""

    BASE_URL = "https://api.elevenlabs.io/v1"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.elevenlabs_api_key
        self.default_model = settings.elevenlabs_model
        self.default_voice_id = settings.elevenlabs_default_voice_id
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "elevenlabs"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.BASE_URL,
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                timeout=60.0,
            )
        return self._client

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

        client = await self._get_client()
        voice = voice_id or self.default_voice_id

        try:
            response = await client.post(
                f"/text-to-speech/{voice}",
                params={"output_format": output_format},
                json={
                    "text": text,
                    "model_id": model or self.default_model,
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "style": 0.0,
                        "use_speaker_boost": True,
                    },
                },
            )
            response.raise_for_status()

            audio_data = response.content
            latency_ms = (time.time() - start_time) * 1000

            # Estimate duration from audio size (rough approximation)
            # For mp3 at 128kbps: bytes / (128000 / 8) = seconds
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

        except httpx.HTTPStatusError as e:
            logger.error(
                "elevenlabs_api_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error("elevenlabs_synthesis_error", error=str(e))
            raise

    async def synthesize_stream(
        self,
        text: str,
        voice_id: str | None = None,
        model: str | None = None,
        output_format: str = "mp3_44100_128",
    ) -> AsyncGenerator[bytes, None]:
        """Synthesize text to streaming audio."""
        client = await self._get_client()
        voice = voice_id or self.default_voice_id

        try:
            async with client.stream(
                "POST",
                f"/text-to-speech/{voice}/stream",
                params={"output_format": output_format},
                json={
                    "text": text,
                    "model_id": model or self.default_model,
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "style": 0.0,
                        "use_speaker_boost": True,
                    },
                },
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    yield chunk

        except httpx.HTTPStatusError as e:
            logger.error(
                "elevenlabs_stream_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise

    async def list_voices(self) -> list[dict[str, Any]]:
        """List available voices."""
        client = await self._get_client()

        try:
            response = await client.get("/voices")
            response.raise_for_status()

            data = response.json()
            voices = []

            for voice in data.get("voices", []):
                voices.append({
                    "voice_id": voice.get("voice_id"),
                    "name": voice.get("name"),
                    "category": voice.get("category"),
                    "labels": voice.get("labels", {}),
                    "preview_url": voice.get("preview_url"),
                })

            logger.info("elevenlabs_voices_listed", count=len(voices))
            return voices

        except httpx.HTTPStatusError as e:
            logger.error(
                "elevenlabs_list_voices_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise

    async def get_voice(self, voice_id: str) -> dict[str, Any]:
        """Get details for a specific voice."""
        client = await self._get_client()

        try:
            response = await client.get(f"/voices/{voice_id}")
            response.raise_for_status()
            return response.json()

        except httpx.HTTPStatusError as e:
            logger.error(
                "elevenlabs_get_voice_error",
                voice_id=voice_id,
                status_code=e.response.status_code,
                error=str(e),
            )
            raise

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
