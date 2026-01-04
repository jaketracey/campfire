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
    gateway_internal_url: str = "http://localhost:3002"
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

    # Prompt Enhancement (for image generation - uses local Ollama)
    prompt_enhancement_enabled: bool = True
    prompt_enhancement_model: str = "goekdenizguelmez/JOSIEFIED-Qwen3:8b"
    prompt_enhancement_max_tokens: int = 200
    prompt_enhancement_temperature: float = 0.5

    # OpenAI (fallback)
    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo-preview"
    openai_max_tokens: int = 4096
    openai_timeout: float = 60.0

    # Ollama (local/self-hosted - SFW default, abliterated for NSFW via router)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:latest"  # SFW primary
    ollama_fallback_model: str = "goekdenizguelmez/JOSIEFIED-Qwen3:8b"  # abliterated fallback
    ollama_max_tokens: int = 4096
    ollama_timeout: float = 120.0
    ollama_enabled: bool = True  # Prefer Ollama over OpenAI when available

    # AWS Configuration (uses IAM role in ECS when keys are empty)
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_session_token: str = ""

    # AWS Bedrock (production LLM inference)
    bedrock_enabled: bool = False  # Enable in staging/prod
    bedrock_default_model: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_fallback_model: str = "anthropic.claude-3-haiku-20240307-v1:0"
    bedrock_max_tokens: int = 4096
    bedrock_timeout: float = 60.0

    # AWS SageMaker (custom fine-tuned models)
    sagemaker_enabled: bool = False
    sagemaker_endpoint_name: str = ""
    sagemaker_content_type: str = "application/json"
    sagemaker_accept: str = "application/json"
    sagemaker_max_tokens: int = 4096
    sagemaker_timeout: float = 120.0

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
    comfyui_default_checkpoint: str = "epiCRealismXL_Pure_fix.safetensors"  # Best photorealism
    comfyui_timeout: float = 300.0
    comfyui_enabled: bool = True  # Prefer ComfyUI over FAL when available

    # ComfyUI SDXL settings (for high-quality portrait generation)
    comfyui_sdxl_checkpoint: str = "epiCRealismXL_Pure_fix.safetensors"  # Best photorealism
    comfyui_sdxl_vae: str = "sdxl_vae.safetensors"
    comfyui_ipadapter_model: str = "ip-adapter-plus_sdxl_vit-h.safetensors"
    comfyui_clip_vision_model: str = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

    # ComfyUI quality enhancement settings
    comfyui_detail_lora: str = "detail_tweaker_xl.safetensors"
    comfyui_detail_lora_strength: float = 0.3  # Detail enhancement
    comfyui_skin_lora: str = "skin_realism_sdxl.safetensors"  # Natural skin texture
    comfyui_skin_lora_strength: float = 0.4  # Recommended strength for skin details
    comfyui_faces_lora: str = "better_faces_sdxl.safetensors"  # Improved facial features
    comfyui_faces_lora_strength: float = 0.5  # Recommended strength for faces
    comfyui_upscale_model: str = "RealESRGAN_x4plus.pth"
    comfyui_enable_upscale: bool = False  # Disabled - 4x upscaling degrades quality

    # AnimateDiff Video Generation (via ComfyUI on 5080 server)
    animatediff_enabled: bool = True
    animatediff_base_url: str = "http://localhost:8188"  # Same as ComfyUI or separate server
    animatediff_timeout: float = 600.0  # 10 minutes for video generation
    animatediff_motion_module: str = "mm_sdxl_v10_beta.ckpt"  # AnimateDiff motion module
    animatediff_default_frames: int = 48  # ~4 seconds at 12fps
    animatediff_default_fps: int = 12
    animatediff_default_width: int = 512
    animatediff_default_height: int = 768
    animatediff_video_format: str = "video/h264-mp4"  # VHS output format

    # FAL AI (Image Generation - cloud fallback, using Dreamina for photorealism)
    fal_api_key: str = ""
    fal_model: str = "fal-ai/bytedance/dreamina/v3.1/text-to-image"  # High quality photorealistic portraits

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

    # Content Routing
    content_routing_enabled: bool = True
    semantic_routing_threshold: float = 0.75
    classifier_routing_threshold: float = 0.6
    prefer_local_models: bool = True
    prefer_abliterated_for_adult: bool = True

    # Image Routing
    image_routing_enabled: bool = True
    prefer_local_image_models: bool = True

    # Intent Detection
    intent_embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    intent_classifier_model: str = "TostAI/nsfw-text-detection-large"
    intent_detection_enabled: bool = True

    # Fallback Behavior
    fallback_on_nsfw_block: str = "redirect"  # redirect | sanitize | reject

    # Abliterated Models Pool (for adult content routing)
    ollama_abliterated_models: list[str] = Field(
        default=[
            "goekdenizguelmez/JOSIEFIED-Qwen3:8b",  # Gabliterated + fine-tuned, ~5GB VRAM
        ]
    )

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
