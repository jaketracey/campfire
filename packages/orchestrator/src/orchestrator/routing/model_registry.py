"""Model registry for available LLM models and their capabilities."""

from dataclasses import dataclass, field
from enum import IntEnum, auto
from typing import Literal

import structlog

logger = structlog.get_logger()


class ContentCapability(IntEnum):
    """Content capability levels for models.

    Higher values indicate more permissive content handling.
    """

    SFW_ONLY = auto()       # Safe for work content only
    SUGGESTIVE = auto()     # Mild suggestive content allowed
    NSFW_TEXT = auto()      # Explicit text content allowed
    NSFW_ROLEPLAY = auto()  # Explicit roleplay scenarios
    UNRESTRICTED = auto()   # No content restrictions (abliterated models)


class ModelTier(IntEnum):
    """Model quality/capability tiers."""

    LOCAL = auto()      # Local models, no API cost but variable quality
    FAST = auto()       # Optimized for speed/cost (e.g., GPT-4o-mini, Claude Haiku)
    STANDARD = auto()   # Good balance of capability and cost (e.g., Claude Sonnet)
    FLAGSHIP = auto()   # Highest capability, highest cost (e.g., GPT-4, Claude Opus)


ProviderType = Literal["anthropic", "openai", "ollama", "together", "groq", "bedrock", "sagemaker"]


@dataclass
class ModelSpec:
    """Specification for an LLM model."""

    model_id: str
    provider: ProviderType
    display_name: str
    content_capability: ContentCapability
    tier: ModelTier

    # Capabilities
    supports_tools: bool = True
    supports_vision: bool = False
    supports_streaming: bool = True

    # Performance characteristics
    context_window: int = 128000
    max_output_tokens: int = 4096
    avg_latency_ms: float = 1000.0
    tokens_per_second: float = 50.0

    # Content handling
    is_abliterated: bool = False
    is_local: bool = False

    # Cost (per 1M tokens, input/output)
    cost_per_1m_input: float = 0.0
    cost_per_1m_output: float = 0.0

    # Optional model-specific settings
    default_temperature: float = 0.7
    recommended_system_prompt: str | None = None

    # Metadata
    tags: list[str] = field(default_factory=list)

    def __hash__(self) -> int:
        return hash((self.model_id, self.provider))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ModelSpec):
            return False
        return self.model_id == other.model_id and self.provider == other.provider


@dataclass
class ProviderHealth:
    """Health status for a provider."""

    provider: ProviderType
    is_available: bool = True
    last_check_ms: float = 0.0
    error_count: int = 0
    avg_latency_ms: float = 0.0
    last_error: str | None = None


# Global provider health tracking
PROVIDER_HEALTH: dict[ProviderType, ProviderHealth] = {
    "anthropic": ProviderHealth(provider="anthropic"),
    "openai": ProviderHealth(provider="openai"),
    "ollama": ProviderHealth(provider="ollama"),
    "together": ProviderHealth(provider="together"),
    "groq": ProviderHealth(provider="groq"),
    "bedrock": ProviderHealth(provider="bedrock"),
    "sagemaker": ProviderHealth(provider="sagemaker"),
}


# Model registry - all available models
MODEL_REGISTRY: dict[str, ModelSpec] = {
    # Anthropic models — latest generation (Claude 4.x / Haiku 4.5)
    "claude-sonnet-4-6": ModelSpec(
        model_id="claude-sonnet-4-6",
        provider="anthropic",
        display_name="Claude Sonnet 4.6",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=16384,
        avg_latency_ms=1800.0,
        tokens_per_second=100.0,
        cost_per_1m_input=3.0,
        cost_per_1m_output=15.0,
        tags=["flagship", "multimodal", "reasoning"],
    ),
    "claude-haiku-4-5-20251001": ModelSpec(
        model_id="claude-haiku-4-5-20251001",
        provider="anthropic",
        display_name="Claude Haiku 4.5",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=8192,
        avg_latency_ms=400.0,
        tokens_per_second=200.0,
        cost_per_1m_input=0.8,
        cost_per_1m_output=4.0,
        tags=["fast", "efficient"],
    ),
    # Anthropic aliases (older model IDs that map to same capabilities)
    "claude-sonnet-4-20250514": ModelSpec(
        model_id="claude-sonnet-4-20250514",
        provider="anthropic",
        display_name="Claude Sonnet 4",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=8192,
        avg_latency_ms=2000.0,
        tokens_per_second=80.0,
        cost_per_1m_input=3.0,
        cost_per_1m_output=15.0,
        tags=["flagship", "multimodal", "reasoning"],
    ),
    "claude-3-5-haiku-20241022": ModelSpec(
        model_id="claude-3-5-haiku-20241022",
        provider="anthropic",
        display_name="Claude 3.5 Haiku",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=8192,
        avg_latency_ms=500.0,
        tokens_per_second=150.0,
        cost_per_1m_input=0.8,
        cost_per_1m_output=4.0,
        tags=["fast", "efficient"],
    ),
    "claude-haiku-4-5-20251001": ModelSpec(
        model_id="claude-haiku-4-5-20251001",
        provider="anthropic",
        display_name="Claude 4.5 Haiku",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=8192,
        avg_latency_ms=400.0,
        tokens_per_second=180.0,
        cost_per_1m_input=0.8,
        cost_per_1m_output=4.0,
        tags=["fast", "efficient", "haiku"],
    ),
    "claude-opus-4-20250514": ModelSpec(
        model_id="claude-opus-4-20250514",
        provider="anthropic",
        display_name="Claude Opus 4",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FLAGSHIP,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=32000,
        avg_latency_ms=5000.0,
        tokens_per_second=30.0,
        cost_per_1m_input=15.0,
        cost_per_1m_output=75.0,
        tags=["flagship", "reasoning", "multimodal"],
    ),
    # OpenAI models
    "gpt-4-turbo-preview": ModelSpec(
        model_id="gpt-4-turbo-preview",
        provider="openai",
        display_name="GPT-4 Turbo",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FLAGSHIP,
        supports_tools=True,
        supports_vision=True,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=3000.0,
        tokens_per_second=40.0,
        cost_per_1m_input=10.0,
        cost_per_1m_output=30.0,
        tags=["gpt4", "reasoning"],
    ),
    "gpt-4o": ModelSpec(
        model_id="gpt-4o",
        provider="openai",
        display_name="GPT-4o",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=True,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=1500.0,
        tokens_per_second=80.0,
        cost_per_1m_input=5.0,
        cost_per_1m_output=15.0,
        tags=["omni", "multimodal"],
    ),
    "gpt-4o-mini": ModelSpec(
        model_id="gpt-4o-mini",
        provider="openai",
        display_name="GPT-4o Mini",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=True,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=800.0,
        tokens_per_second=120.0,
        cost_per_1m_input=0.15,
        cost_per_1m_output=0.6,
        tags=["fast", "cheap"],
    ),
    # Ollama local models - SFW primary
    "qwen2.5:latest": ModelSpec(
        model_id="qwen2.5:latest",
        provider="ollama",
        display_name="Qwen 2.5 7B",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.LOCAL,
        supports_tools=True,
        supports_vision=False,
        context_window=32768,
        max_output_tokens=4096,
        avg_latency_ms=500.0,
        tokens_per_second=100.0,
        is_abliterated=False,
        is_local=True,
        cost_per_1m_input=0.0,
        cost_per_1m_output=0.0,
        tags=["local", "sfw", "primary", "qwen"],
    ),
    # Ollama local models - abliterated for NSFW
    "goekdenizguelmez/JOSIEFIED-Qwen3:8b": ModelSpec(
        model_id="goekdenizguelmez/JOSIEFIED-Qwen3:8b",
        provider="ollama",
        display_name="JOSIEFIED Qwen3 8B",
        content_capability=ContentCapability.UNRESTRICTED,
        tier=ModelTier.LOCAL,
        supports_tools=True,
        supports_vision=False,
        context_window=32768,
        max_output_tokens=4096,
        avg_latency_ms=600.0,
        tokens_per_second=90.0,
        is_abliterated=True,
        is_local=True,
        cost_per_1m_input=0.0,
        cost_per_1m_output=0.0,
        tags=["local", "abliterated", "uncensored", "gabliterated", "primary"],
    ),
    "llama3.2:latest": ModelSpec(
        model_id="llama3.2:latest",
        provider="ollama",
        display_name="LLaMA 3.2",
        content_capability=ContentCapability.SFW_ONLY,
        tier=ModelTier.LOCAL,
        supports_tools=True,
        supports_vision=False,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=800.0,
        tokens_per_second=90.0,
        is_abliterated=False,
        is_local=True,
        cost_per_1m_input=0.0,
        cost_per_1m_output=0.0,
        tags=["local", "sfw", "meta"],
    ),
    # Together.ai models (for fallback)
    "meta-llama/Llama-3-70b-chat-hf": ModelSpec(
        model_id="meta-llama/Llama-3-70b-chat-hf",
        provider="together",
        display_name="Llama 3 70B",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=False,
        context_window=8192,
        max_output_tokens=4096,
        avg_latency_ms=2000.0,
        tokens_per_second=40.0,
        cost_per_1m_input=0.9,
        cost_per_1m_output=0.9,
        tags=["llama", "quality"],
    ),
    # Groq models (fast inference)
    "llama-3.1-70b-versatile": ModelSpec(
        model_id="llama-3.1-70b-versatile",
        provider="groq",
        display_name="Llama 3.1 70B (Groq)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=False,
        context_window=131072,
        max_output_tokens=8192,
        avg_latency_ms=300.0,
        tokens_per_second=300.0,
        cost_per_1m_input=0.59,
        cost_per_1m_output=0.79,
        tags=["groq", "fast", "llama"],
    ),
    "mixtral-8x7b-32768": ModelSpec(
        model_id="mixtral-8x7b-32768",
        provider="groq",
        display_name="Mixtral 8x7B (Groq)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=False,
        context_window=32768,
        max_output_tokens=4096,
        avg_latency_ms=250.0,
        tokens_per_second=400.0,
        cost_per_1m_input=0.24,
        cost_per_1m_output=0.24,
        tags=["groq", "fast", "moe"],
    ),
    # AWS Bedrock - Claude models
    "anthropic.claude-3-5-sonnet-20241022-v2:0": ModelSpec(
        model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
        provider="bedrock",
        display_name="Claude 3.5 Sonnet (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=8192,
        avg_latency_ms=2000.0,
        tokens_per_second=80.0,
        cost_per_1m_input=3.0,
        cost_per_1m_output=15.0,
        tags=["bedrock", "claude", "multimodal", "production"],
    ),
    "anthropic.claude-3-haiku-20240307-v1:0": ModelSpec(
        model_id="anthropic.claude-3-haiku-20240307-v1:0",
        provider="bedrock",
        display_name="Claude 3 Haiku (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=4096,
        avg_latency_ms=500.0,
        tokens_per_second=150.0,
        cost_per_1m_input=0.25,
        cost_per_1m_output=1.25,
        tags=["bedrock", "claude", "fast", "cheap"],
    ),
    "anthropic.claude-3-opus-20240229-v1:0": ModelSpec(
        model_id="anthropic.claude-3-opus-20240229-v1:0",
        provider="bedrock",
        display_name="Claude 3 Opus (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FLAGSHIP,
        supports_tools=True,
        supports_vision=True,
        context_window=200000,
        max_output_tokens=4096,
        avg_latency_ms=5000.0,
        tokens_per_second=30.0,
        cost_per_1m_input=15.0,
        cost_per_1m_output=75.0,
        tags=["bedrock", "claude", "flagship", "reasoning"],
    ),
    # AWS Bedrock - Llama models
    "meta.llama3-1-70b-instruct-v1:0": ModelSpec(
        model_id="meta.llama3-1-70b-instruct-v1:0",
        provider="bedrock",
        display_name="Llama 3.1 70B (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=False,
        supports_vision=False,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=3000.0,
        tokens_per_second=40.0,
        cost_per_1m_input=0.99,
        cost_per_1m_output=0.99,
        tags=["bedrock", "llama", "meta", "open-source"],
    ),
    "meta.llama3-1-8b-instruct-v1:0": ModelSpec(
        model_id="meta.llama3-1-8b-instruct-v1:0",
        provider="bedrock",
        display_name="Llama 3.1 8B (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=False,
        supports_vision=False,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=1000.0,
        tokens_per_second=100.0,
        cost_per_1m_input=0.22,
        cost_per_1m_output=0.22,
        tags=["bedrock", "llama", "fast", "cheap"],
    ),
    "meta.llama3-2-90b-instruct-v1:0": ModelSpec(
        model_id="meta.llama3-2-90b-instruct-v1:0",
        provider="bedrock",
        display_name="Llama 3.2 90B (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=False,
        supports_vision=True,
        context_window=128000,
        max_output_tokens=4096,
        avg_latency_ms=3500.0,
        tokens_per_second=35.0,
        cost_per_1m_input=2.0,
        cost_per_1m_output=2.0,
        tags=["bedrock", "llama", "multimodal"],
    ),
    # AWS Bedrock - Mistral models
    "mistral.mistral-large-2407-v1:0": ModelSpec(
        model_id="mistral.mistral-large-2407-v1:0",
        provider="bedrock",
        display_name="Mistral Large (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=False,
        context_window=128000,
        max_output_tokens=8192,
        avg_latency_ms=2500.0,
        tokens_per_second=60.0,
        cost_per_1m_input=4.0,
        cost_per_1m_output=12.0,
        tags=["bedrock", "mistral", "european"],
    ),
    "mistral.mixtral-8x7b-instruct-v0:1": ModelSpec(
        model_id="mistral.mixtral-8x7b-instruct-v0:1",
        provider="bedrock",
        display_name="Mixtral 8x7B (Bedrock)",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.FAST,
        supports_tools=True,
        supports_vision=False,
        context_window=32768,
        max_output_tokens=4096,
        avg_latency_ms=1500.0,
        tokens_per_second=80.0,
        cost_per_1m_input=0.45,
        cost_per_1m_output=0.70,
        tags=["bedrock", "mistral", "moe", "fast"],
    ),
    # AWS Bedrock - Amazon Titan models
    "amazon.titan-text-premier-v1:0": ModelSpec(
        model_id="amazon.titan-text-premier-v1:0",
        provider="bedrock",
        display_name="Titan Text Premier (Bedrock)",
        content_capability=ContentCapability.SFW_ONLY,
        tier=ModelTier.STANDARD,
        supports_tools=False,
        supports_vision=False,
        context_window=32000,
        max_output_tokens=3072,
        avg_latency_ms=2000.0,
        tokens_per_second=50.0,
        cost_per_1m_input=0.50,
        cost_per_1m_output=1.50,
        tags=["bedrock", "titan", "amazon"],
    ),
    "amazon.titan-text-express-v1": ModelSpec(
        model_id="amazon.titan-text-express-v1",
        provider="bedrock",
        display_name="Titan Text Express (Bedrock)",
        content_capability=ContentCapability.SFW_ONLY,
        tier=ModelTier.FAST,
        supports_tools=False,
        supports_vision=False,
        context_window=8000,
        max_output_tokens=2048,
        avg_latency_ms=1000.0,
        tokens_per_second=80.0,
        cost_per_1m_input=0.20,
        cost_per_1m_output=0.60,
        tags=["bedrock", "titan", "fast"],
    ),
}

# Build DEFAULT_MODELS list from registry for convenience
DEFAULT_MODELS: list[ModelSpec] = list(MODEL_REGISTRY.values())


def get_model(model_id: str) -> ModelSpec | None:
    """Get a model specification by ID.

    Args:
        model_id: The model identifier.

    Returns:
        ModelSpec if found, None otherwise.
    """
    return MODEL_REGISTRY.get(model_id)


def get_models_by_provider(provider: ProviderType) -> list[ModelSpec]:
    """Get all models for a specific provider.

    Args:
        provider: The provider name.

    Returns:
        List of ModelSpec for the provider.
    """
    return [m for m in MODEL_REGISTRY.values() if m.provider == provider]


def get_models_by_capability(min_capability: ContentCapability) -> list[ModelSpec]:
    """Get models that meet minimum content capability.

    Args:
        min_capability: Minimum content capability required.

    Returns:
        List of ModelSpec meeting the capability.
    """
    return [m for m in MODEL_REGISTRY.values() if m.content_capability >= min_capability]


def get_abliterated_models() -> list[ModelSpec]:
    """Get all abliterated (uncensored) models.

    Returns:
        List of abliterated ModelSpec.
    """
    return [m for m in MODEL_REGISTRY.values() if m.is_abliterated]


def get_local_models() -> list[ModelSpec]:
    """Get all local (self-hosted) models.

    Returns:
        List of local ModelSpec.
    """
    return [m for m in MODEL_REGISTRY.values() if m.is_local]


def update_provider_health(
    provider: ProviderType,
    is_available: bool,
    latency_ms: float | None = None,
    error: str | None = None,
) -> None:
    """Update health status for a provider.

    Args:
        provider: The provider to update.
        is_available: Whether the provider is available.
        latency_ms: Optional latency measurement.
        error: Optional error message.
    """
    import time

    health = PROVIDER_HEALTH.get(provider)
    if health is None:
        health = ProviderHealth(provider=provider)
        PROVIDER_HEALTH[provider] = health

    health.is_available = is_available
    health.last_check_ms = time.time() * 1000

    if latency_ms is not None:
        # Exponential moving average
        health.avg_latency_ms = (health.avg_latency_ms * 0.8) + (latency_ms * 0.2)

    if error:
        health.error_count += 1
        health.last_error = error
    elif is_available:
        health.error_count = 0
        health.last_error = None

    logger.debug(
        "provider_health_updated",
        provider=provider,
        is_available=is_available,
        avg_latency_ms=health.avg_latency_ms,
        error_count=health.error_count,
    )


def get_available_providers() -> list[ProviderType]:
    """Get list of currently available providers.

    Returns:
        List of available provider names.
    """
    return [p for p, h in PROVIDER_HEALTH.items() if h.is_available]


def register_model(model: ModelSpec) -> None:
    """Register a new model or update an existing one in the registry.

    Args:
        model: The ModelSpec to register.
    """
    MODEL_REGISTRY[model.model_id] = model
    logger.info(
        "model_registered",
        model_id=model.model_id,
        provider=model.provider,
        display_name=model.display_name,
    )
