"""Base classes for provider implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, AsyncGenerator, TypeVar

# Self type for methods that return the same class type
# Using TypeVar since Self was added in Python 3.11
_T = TypeVar("_T", bound="LLMProvider")


@dataclass
class LLMResponse:
    """Response from an LLM provider."""

    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: float = 0.0
    raw_response: dict[str, Any] | None = None


@dataclass
class STTResult:
    """Result from speech-to-text transcription."""

    text: str
    confidence: float
    language: str
    duration_seconds: float
    words: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: float = 0.0


@dataclass
class TTSResult:
    """Result from text-to-speech synthesis."""

    audio_data: bytes
    format: str
    duration_seconds: float
    latency_ms: float = 0.0


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...

    @property
    def current_model(self) -> str:
        """Return the active model ID.

        Returns the model that will be used for the next request.
        Subclasses should override this to support model override.
        """
        raise NotImplementedError("Subclass must implement current_model property")

    def with_model(self: _T, model_id: str) -> _T:
        """Return a new provider instance configured for a specific model.

        This allows the model router to dynamically select which model
        to use for a specific request.

        Args:
            model_id: The model ID to use.

        Returns:
            A new provider instance configured with the specified model.
        """
        raise NotImplementedError("Subclass must implement with_model method")

    @abstractmethod
    async def generate(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        stop_sequences: list[str] | None = None,
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        """Generate a response from the LLM.

        Args:
            response_format: Optional format specification. For JSON output,
                use {"type": "json_object"}. Not all providers support this.
        """
        ...

    @abstractmethod
    async def generate_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        stop_sequences: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response from the LLM."""
        ...

    @abstractmethod
    async def count_tokens(self, text: str) -> int:
        """Count tokens in a text string."""
        ...


class STTProvider(ABC):
    """Abstract base class for speech-to-text providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...

    @abstractmethod
    async def transcribe(
        self,
        audio_data: bytes,
        language: str = "en-US",
        model: str | None = None,
    ) -> STTResult:
        """Transcribe audio to text."""
        ...

    @abstractmethod
    async def transcribe_stream(
        self,
        audio_stream: AsyncGenerator[bytes, None],
        language: str = "en-US",
        model: str | None = None,
    ) -> AsyncGenerator[STTResult, None]:
        """Transcribe streaming audio to text."""
        ...


class TTSProvider(ABC):
    """Abstract base class for text-to-speech providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice_id: str,
        model: str | None = None,
        output_format: str = "mp3",
    ) -> TTSResult:
        """Synthesize text to speech."""
        ...

    @abstractmethod
    async def synthesize_stream(
        self,
        text: str,
        voice_id: str,
        model: str | None = None,
        output_format: str = "mp3",
    ) -> AsyncGenerator[bytes, None]:
        """Synthesize text to streaming audio."""
        ...

    @abstractmethod
    async def list_voices(self) -> list[dict[str, Any]]:
        """List available voices."""
        ...


class ImageProvider(ABC):
    """Abstract base class for image generation providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        size: str = "512x512",
        style: str | None = None,
        negative_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate an image from a text prompt."""
        ...

    @abstractmethod
    async def analyze(
        self,
        image_url: str,
        prompt: str | None = None,
    ) -> str:
        """Analyze an image and return a description."""
        ...
