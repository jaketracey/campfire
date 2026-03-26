"""Video-specific configuration for LiveKit agent and Simli avatar rendering."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class VideoSettings(BaseSettings):
    """Settings for the video chat subsystem.

    Loaded from environment variables prefixed with the standard names
    (e.g. LIVEKIT_URL, SIMLI_API_KEY).  Falls back to sensible defaults
    so the orchestrator can start without video features configured.
    """

    model_config = SettingsConfigDict(
        env_file="../../.env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- LiveKit ---
    livekit_url: str = Field(
        default="ws://localhost:7880",
        description="LiveKit server WebSocket URL",
    )
    livekit_api_key: str = Field(
        default="",
        description="LiveKit API key for token generation",
    )
    livekit_api_secret: str = Field(
        default="",
        description="LiveKit API secret for token signing",
    )

    # --- Simli avatar rendering ---
    simli_api_key: str = Field(
        default="",
        description="Simli API key for avatar video generation",
    )
    simli_base_url: str = Field(
        default="https://api.simli.ai",
        description="Simli API base URL",
    )
    simli_face_id: str = Field(
        default="default",
        description="Default Simli face ID (overridden per companion)",
    )
    simli_ws_url: str = Field(
        default="wss://api.simli.ai/ws",
        description="Simli WebSocket URL for streaming audio/video",
    )

    # --- Deepgram STT ---
    deepgram_api_key: str = Field(
        default="",
        description="Deepgram API key for speech-to-text",
    )
    deepgram_model: str = Field(
        default="nova-2",
        description="Deepgram STT model",
    )
    deepgram_language: str = Field(
        default="en",
        description="Default language for STT",
    )

    # --- ElevenLabs TTS ---
    elevenlabs_api_key: str = Field(
        default="",
        description="ElevenLabs API key for text-to-speech",
    )
    elevenlabs_model: str = Field(
        default="eleven_multilingual_v2",
        description="ElevenLabs TTS model",
    )
    elevenlabs_default_voice_id: str = Field(
        default="21m00Tcm4TlvDq8ikWAM",
        description="Default ElevenLabs voice ID",
    )

    # --- Call limits ---
    video_call_max_duration_minutes: int = Field(
        default=30,
        description="Maximum video call duration before automatic termination",
    )
    video_call_max_concurrent: int = Field(
        default=10,
        description="Maximum number of concurrent video calls",
    )

    # --- Audio pipeline ---
    stt_sample_rate: int = Field(
        default=16000,
        description="Sample rate for STT input audio (Hz)",
    )
    tts_sample_rate: int = Field(
        default=24000,
        description="Sample rate for TTS output audio (Hz)",
    )
    vad_threshold: float = Field(
        default=0.5,
        description="Voice activity detection confidence threshold",
    )
    vad_silence_duration_ms: int = Field(
        default=800,
        description="Duration of silence (ms) before ending a speech segment",
    )

    @property
    def livekit_configured(self) -> bool:
        """Return True if LiveKit credentials are present."""
        return bool(self.livekit_api_key and self.livekit_api_secret)

    @property
    def simli_configured(self) -> bool:
        """Return True if Simli API key is present."""
        return bool(self.simli_api_key)

    @property
    def deepgram_configured(self) -> bool:
        """Return True if Deepgram API key is present."""
        return bool(self.deepgram_api_key)

    @property
    def elevenlabs_configured(self) -> bool:
        """Return True if ElevenLabs API key is present."""
        return bool(self.elevenlabs_api_key)

    @property
    def fully_configured(self) -> bool:
        """Return True if all required services are configured."""
        return (
            self.livekit_configured
            and self.simli_configured
            and self.deepgram_configured
            and self.elevenlabs_configured
        )


@lru_cache
def get_video_settings() -> VideoSettings:
    """Get cached video settings instance."""
    return VideoSettings()
