"""Configuration settings for the orchestrator service."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file="../../.env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "campfire-orchestrator"
    app_version: str = "0.1.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = Field(default=False, validation_alias="ORCHESTRATOR_DEBUG")
    log_level: str = "INFO"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 4

    # Gateway (internal API)
    gateway_internal_url: str = "http://localhost:3001"
    internal_service_key: str = Field(
        default="dev-internal-service-key",
        validation_alias="INTERNAL_SERVICE_KEY"
    )

    # Database
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/campfire"
    )
    database_pool_size: int = 20
    database_max_overflow: int = 10

    # Redis
    redis_url: RedisDsn = Field(default="redis://localhost:6379/0")
    redis_pool_size: int = 10

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"
    anthropic_max_tokens: int = 4096
    anthropic_timeout: float = 60.0

    # OpenAI (fallback)
    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo-preview"
    openai_max_tokens: int = 4096
    openai_timeout: float = 60.0

    # Ollama (local/self-hosted - abliterated models)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "huihui_ai/qwen3-abliterated:8b"
    ollama_fallback_model: str = "dolphin-llama3:8b"
    ollama_max_tokens: int = 4096
    ollama_timeout: float = 120.0
    ollama_enabled: bool = True  # Prefer Ollama over OpenAI when available

    # Deepgram (STT)
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-2"
    deepgram_language: str = "en-US"

    # ElevenLabs (TTS)
    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"
    elevenlabs_default_voice_id: str = "21m00Tcm4TlvDq8ikWAM"

    # ComfyUI (local/self-hosted image generation - preferred)
    comfyui_base_url: str = "http://localhost:8188"
    comfyui_default_checkpoint: str = "Juggernaut-X-RunDiffusion-NSFW.safetensors"
    comfyui_timeout: float = 300.0
    comfyui_enabled: bool = True  # Prefer ComfyUI over FAL when available

    # ComfyUI SDXL settings (for high-quality portrait generation)
    comfyui_sdxl_checkpoint: str = "sd_xl_base_1.0.safetensors"
    comfyui_sdxl_vae: str = "sdxl_vae.safetensors"
    comfyui_ipadapter_model: str = "ip-adapter-plus_sdxl_vit-h.safetensors"
    comfyui_clip_vision_model: str = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

    # FAL AI (Image Generation - cloud fallback)
    fal_api_key: str = ""
    fal_model: str = "fal-ai/flux/schnell"

    # Replicate (Image Generation - fallback)
    replicate_api_key: str = ""
    replicate_model: str = "stability-ai/sdxl:latest"

    # Safety
    safety_enabled: bool = True
    safety_strict_mode: bool = False
    safety_level: str = "adult"  # adult, permissive, standard, strict
    content_filter_threshold: float = 0.7

    # Rate Limiting
    rate_limit_requests_per_minute: int = 60
    rate_limit_tokens_per_minute: int = 100000

    # Cost Tracking
    cost_tracking_enabled: bool = True
    cost_alert_threshold_usd: float = 100.0

    # Observability
    otel_enabled: bool = False
    otel_endpoint: str = ""
    otel_service_name: str = "orchestrator"
    prometheus_enabled: bool = True
    prometheus_port: int = 9090

    # Context Limits
    max_context_tokens: int = 128000
    max_turn_window: int = 50
    default_turn_window: int = 20

    # Memory
    memory_search_top_k: int = 10
    memory_relevance_threshold: float = 0.5

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment == "development"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
