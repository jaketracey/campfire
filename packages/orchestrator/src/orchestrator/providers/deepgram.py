"""Deepgram speech-to-text provider implementation."""

import time
from typing import Any, AsyncGenerator

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from orchestrator.config import Settings
from orchestrator.providers.base import STTProvider, STTResult

logger = structlog.get_logger()


class DeepgramProvider(STTProvider):
    """Deepgram speech-to-text provider."""

    BASE_URL = "https://api.deepgram.com/v1"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.deepgram_api_key
        self.default_model = settings.deepgram_model
        self.default_language = settings.deepgram_language
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "deepgram"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.BASE_URL,
                headers={
                    "Authorization": f"Token {self.api_key}",
                    "Content-Type": "audio/wav",
                },
                timeout=60.0,
            )
        return self._client

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def transcribe(
        self,
        audio_data: bytes,
        language: str | None = None,
        model: str | None = None,
    ) -> STTResult:
        """Transcribe audio to text."""
        start_time = time.time()

        client = await self._get_client()

        params = {
            "model": model or self.default_model,
            "language": language or self.default_language,
            "punctuate": "true",
            "diarize": "false",
            "smart_format": "true",
        }

        try:
            response = await client.post(
                "/listen",
                params=params,
                content=audio_data,
            )
            response.raise_for_status()

            result = response.json()
            latency_ms = (time.time() - start_time) * 1000

            # Extract transcription
            alternatives = (
                result.get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [{}])
            )

            if not alternatives:
                return STTResult(
                    text="",
                    confidence=0.0,
                    language=language or self.default_language,
                    duration_seconds=0.0,
                    latency_ms=latency_ms,
                )

            best = alternatives[0]
            transcript = best.get("transcript", "")
            confidence = best.get("confidence", 0.0)

            # Extract word timings
            words = []
            for word_data in best.get("words", []):
                words.append({
                    "word": word_data.get("word", ""),
                    "start": word_data.get("start", 0.0),
                    "end": word_data.get("end", 0.0),
                    "confidence": word_data.get("confidence", 0.0),
                })

            # Calculate duration from metadata or word timings
            metadata = result.get("metadata", {})
            duration = metadata.get("duration", 0.0)
            if not duration and words:
                duration = words[-1].get("end", 0.0)

            logger.info(
                "deepgram_transcription",
                transcript_length=len(transcript),
                confidence=confidence,
                duration_seconds=duration,
                latency_ms=latency_ms,
            )

            return STTResult(
                text=transcript,
                confidence=confidence,
                language=language or self.default_language,
                duration_seconds=duration,
                words=words,
                latency_ms=latency_ms,
            )

        except httpx.HTTPStatusError as e:
            logger.error(
                "deepgram_api_error",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error("deepgram_transcription_error", error=str(e))
            raise

    async def transcribe_stream(
        self,
        audio_stream: AsyncGenerator[bytes, None],
        language: str | None = None,
        model: str | None = None,
    ) -> AsyncGenerator[STTResult, None]:
        """Transcribe streaming audio to text.

        Note: This is a simplified implementation. Production would use
        Deepgram's WebSocket streaming API for real-time transcription.
        """
        # Collect audio chunks and transcribe in batches
        buffer = bytearray()
        chunk_duration_ms = 1000  # Process every second of audio

        async for chunk in audio_stream:
            buffer.extend(chunk)

            # Estimate if we have enough audio (assuming 16kHz, 16-bit mono)
            samples = len(buffer) // 2
            duration_ms = (samples / 16000) * 1000

            if duration_ms >= chunk_duration_ms:
                result = await self.transcribe(
                    audio_data=bytes(buffer),
                    language=language,
                    model=model,
                )
                yield result
                buffer.clear()

        # Process remaining audio
        if buffer:
            result = await self.transcribe(
                audio_data=bytes(buffer),
                language=language,
                model=model,
            )
            yield result

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
