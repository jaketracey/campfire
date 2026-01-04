"""Image model registry for available image generation models and their capabilities."""

from dataclasses import dataclass, field
from enum import IntEnum, auto
from typing import Literal

import structlog

logger = structlog.get_logger()


class ImageModelTier(IntEnum):
    """Image model quality/capability tiers."""

    LOCAL = auto()      # Local models (ComfyUI), no API cost
    FAST = auto()       # Optimized for speed (e.g., SDXL Turbo, Flux Schnell)
    STANDARD = auto()   # Good balance of quality and speed
    QUALITY = auto()    # High quality, slower generation


ImageProviderType = Literal["comfyui", "fal", "replicate"]


@dataclass
class ImageModelSpec:
    """Specification for an image generation model."""

    model_id: str
    provider: ImageProviderType
    display_name: str
    tier: ImageModelTier

    # Resolution capabilities
    max_resolution: tuple[int, int] = (1024, 1024)
    supported_aspect_ratios: list[str] = field(
        default_factory=lambda: ["1:1", "3:4", "4:3", "9:16", "16:9"]
    )

    # Feature capabilities
    supports_ip_adapter: bool = False
    supports_inpainting: bool = False
    supports_controlnet: bool = False
    supports_img2img: bool = False

    # Content capabilities
    nsfw_capable: bool = False

    # Performance characteristics
    avg_generation_time: float = 10.0  # seconds
    cost_per_image: float = 0.0  # USD

    # Model-specific settings
    default_steps: int = 30
    default_cfg_scale: float = 7.0
    default_sampler: str = "euler_ancestral"

    # Provider-specific identifiers
    checkpoint_name: str | None = None  # For ComfyUI
    fal_endpoint: str | None = None  # For FAL.ai
    replicate_version: str | None = None  # For Replicate

    # Metadata
    tags: list[str] = field(default_factory=list)
    is_local: bool = False

    def __hash__(self) -> int:
        return hash((self.model_id, self.provider))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ImageModelSpec):
            return False
        return self.model_id == other.model_id and self.provider == other.provider


@dataclass
class ImageProviderHealth:
    """Health status for an image provider."""

    provider: ImageProviderType
    is_available: bool = True
    last_check_ms: float = 0.0
    error_count: int = 0
    avg_generation_time: float = 0.0
    last_error: str | None = None


# Global provider health tracking
IMAGE_PROVIDER_HEALTH: dict[ImageProviderType, ImageProviderHealth] = {
    "comfyui": ImageProviderHealth(provider="comfyui"),
    "fal": ImageProviderHealth(provider="fal"),
    "replicate": ImageProviderHealth(provider="replicate"),
}


# Image model registry - all available image models
IMAGE_MODEL_REGISTRY: dict[str, ImageModelSpec] = {
    # ComfyUI models (Local, NSFW-capable)
    "comfyui/epicrealism": ImageModelSpec(
        model_id="comfyui/epicrealism",
        provider="comfyui",
        display_name="EpicRealism XL",
        tier=ImageModelTier.QUALITY,
        max_resolution=(1024, 1536),
        supports_ip_adapter=True,
        supports_inpainting=True,
        supports_controlnet=True,
        supports_img2img=True,
        nsfw_capable=True,
        avg_generation_time=15.0,
        cost_per_image=0.0,
        default_steps=30,
        default_cfg_scale=7.0,
        default_sampler="euler_ancestral",
        checkpoint_name="epiCRealismXL_Pure_fix.safetensors",
        is_local=True,
        tags=["photorealistic", "portrait", "quality", "local"],
    ),
    "comfyui/sdxl-base": ImageModelSpec(
        model_id="comfyui/sdxl-base",
        provider="comfyui",
        display_name="SDXL Base",
        tier=ImageModelTier.STANDARD,
        max_resolution=(1024, 1536),
        supports_ip_adapter=True,
        supports_inpainting=True,
        supports_controlnet=True,
        supports_img2img=True,
        nsfw_capable=True,
        avg_generation_time=12.0,
        cost_per_image=0.0,
        default_steps=25,
        default_cfg_scale=7.5,
        default_sampler="euler_ancestral",
        checkpoint_name="sd_xl_base_1.0.safetensors",
        is_local=True,
        tags=["sdxl", "versatile", "local"],
    ),
    "comfyui/sdxl-turbo": ImageModelSpec(
        model_id="comfyui/sdxl-turbo",
        provider="comfyui",
        display_name="SDXL Turbo (Fast)",
        tier=ImageModelTier.FAST,
        max_resolution=(1024, 1024),
        supports_ip_adapter=False,
        supports_inpainting=False,
        supports_controlnet=False,
        supports_img2img=True,
        nsfw_capable=True,
        avg_generation_time=3.0,
        cost_per_image=0.0,
        default_steps=4,
        default_cfg_scale=1.0,
        default_sampler="euler_ancestral",
        checkpoint_name="sd_xl_turbo_1.0_fp16.safetensors",
        is_local=True,
        tags=["fast", "turbo", "local"],
    ),
    # FAL.ai models (Cloud, SFW-only)
    "fal/dreamina-v3.1": ImageModelSpec(
        model_id="fal/dreamina-v3.1",
        provider="fal",
        display_name="Bytedance Dreamina 3.1",
        tier=ImageModelTier.QUALITY,
        max_resolution=(1024, 1536),
        supports_ip_adapter=False,
        supports_inpainting=False,
        supports_controlnet=False,
        supports_img2img=False,
        nsfw_capable=False,
        avg_generation_time=8.0,
        cost_per_image=0.02,
        default_steps=30,
        default_cfg_scale=7.0,
        fal_endpoint="fal-ai/bytedance/dreamina/v3.1/text-to-image",
        is_local=False,
        tags=["photorealistic", "portrait", "cloud"],
    ),
    "fal/flux-1.1-pro": ImageModelSpec(
        model_id="fal/flux-1.1-pro",
        provider="fal",
        display_name="Flux 1.1 Pro",
        tier=ImageModelTier.QUALITY,
        max_resolution=(1024, 1536),
        supports_ip_adapter=True,
        supports_inpainting=False,
        supports_controlnet=False,
        supports_img2img=True,
        nsfw_capable=False,
        avg_generation_time=10.0,
        cost_per_image=0.04,
        default_steps=28,
        default_cfg_scale=3.5,
        fal_endpoint="fal-ai/flux-pro/v1.1",
        is_local=False,
        tags=["quality", "versatile", "cloud"],
    ),
    "fal/flux-schnell": ImageModelSpec(
        model_id="fal/flux-schnell",
        provider="fal",
        display_name="Flux Schnell (Fast)",
        tier=ImageModelTier.FAST,
        max_resolution=(1024, 1024),
        supports_ip_adapter=False,
        supports_inpainting=False,
        supports_controlnet=False,
        supports_img2img=False,
        nsfw_capable=False,
        avg_generation_time=2.0,
        cost_per_image=0.003,
        default_steps=4,
        default_cfg_scale=1.0,
        fal_endpoint="fal-ai/flux/schnell",
        is_local=False,
        tags=["fast", "cheap", "cloud"],
    ),
    "fal/flux-dev": ImageModelSpec(
        model_id="fal/flux-dev",
        provider="fal",
        display_name="Flux Dev",
        tier=ImageModelTier.STANDARD,
        max_resolution=(1024, 1536),
        supports_ip_adapter=False,
        supports_inpainting=False,
        supports_controlnet=False,
        supports_img2img=False,
        nsfw_capable=False,
        avg_generation_time=5.0,
        cost_per_image=0.025,
        default_steps=28,
        default_cfg_scale=3.5,
        fal_endpoint="fal-ai/flux/dev",
        is_local=False,
        tags=["balanced", "cloud"],
    ),
}


def get_image_model(model_id: str) -> ImageModelSpec | None:
    """Get an image model specification by ID.

    Args:
        model_id: The model identifier.

    Returns:
        ImageModelSpec if found, None otherwise.
    """
    return IMAGE_MODEL_REGISTRY.get(model_id)


def get_image_models_by_provider(provider: ImageProviderType) -> list[ImageModelSpec]:
    """Get all image models for a specific provider.

    Args:
        provider: The provider name.

    Returns:
        List of ImageModelSpec for the provider.
    """
    return [m for m in IMAGE_MODEL_REGISTRY.values() if m.provider == provider]


def get_nsfw_capable_models() -> list[ImageModelSpec]:
    """Get all NSFW-capable image models.

    Returns:
        List of NSFW-capable ImageModelSpec.
    """
    return [m for m in IMAGE_MODEL_REGISTRY.values() if m.nsfw_capable]


def get_ip_adapter_capable_models() -> list[ImageModelSpec]:
    """Get all models that support IP-Adapter.

    Returns:
        List of IP-Adapter capable ImageModelSpec.
    """
    return [m for m in IMAGE_MODEL_REGISTRY.values() if m.supports_ip_adapter]


def get_local_image_models() -> list[ImageModelSpec]:
    """Get all local (self-hosted) image models.

    Returns:
        List of local ImageModelSpec.
    """
    return [m for m in IMAGE_MODEL_REGISTRY.values() if m.is_local]


def update_image_provider_health(
    provider: ImageProviderType,
    is_available: bool,
    generation_time: float | None = None,
    error: str | None = None,
) -> None:
    """Update health status for an image provider.

    Args:
        provider: The provider to update.
        is_available: Whether the provider is available.
        generation_time: Optional generation time measurement.
        error: Optional error message.
    """
    import time

    health = IMAGE_PROVIDER_HEALTH.get(provider)
    if health is None:
        health = ImageProviderHealth(provider=provider)
        IMAGE_PROVIDER_HEALTH[provider] = health

    health.is_available = is_available
    health.last_check_ms = time.time() * 1000

    if generation_time is not None:
        # Exponential moving average
        health.avg_generation_time = (health.avg_generation_time * 0.8) + (generation_time * 0.2)

    if error:
        health.error_count += 1
        health.last_error = error
    elif is_available:
        health.error_count = 0
        health.last_error = None

    logger.debug(
        "image_provider_health_updated",
        provider=provider,
        is_available=is_available,
        avg_generation_time=health.avg_generation_time,
        error_count=health.error_count,
    )


def get_available_image_providers() -> list[ImageProviderType]:
    """Get list of currently available image providers.

    Returns:
        List of available provider names.
    """
    return [p for p, h in IMAGE_PROVIDER_HEALTH.items() if h.is_available]


def register_image_model(model: ImageModelSpec) -> None:
    """Register a new image model or update an existing one in the registry.

    Args:
        model: The ImageModelSpec to register.
    """
    IMAGE_MODEL_REGISTRY[model.model_id] = model
    logger.info(
        "image_model_registered",
        model_id=model.model_id,
        provider=model.provider,
        display_name=model.display_name,
    )
