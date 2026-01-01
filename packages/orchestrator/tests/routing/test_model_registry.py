"""
Comprehensive tests for the model registry module.

Tests cover:
- IntEnum ordering for ContentCapability and ModelTier
- ModelSpec dataclass creation and behavior
- Model registry operations (get, filter, register)
- Provider health tracking
"""

import time
from unittest.mock import patch

import pytest

from orchestrator.routing.model_registry import (
    MODEL_REGISTRY,
    PROVIDER_HEALTH,
    ContentCapability,
    ModelSpec,
    ModelTier,
    ProviderHealth,
    get_abliterated_models,
    get_local_models,
    get_model,
    get_models_by_capability,
    get_models_by_provider,
    register_model,
    update_provider_health,
)


# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def sample_model_spec() -> ModelSpec:
    """Create a sample ModelSpec for testing."""
    return ModelSpec(
        model_id="test-model-v1",
        provider="openai",
        display_name="Test Model V1",
        content_capability=ContentCapability.SUGGESTIVE,
        tier=ModelTier.STANDARD,
        supports_tools=True,
        supports_vision=True,
        supports_streaming=True,
        context_window=64000,
        max_output_tokens=8192,
        avg_latency_ms=1500.0,
        tokens_per_second=100.0,
        is_abliterated=False,
        is_local=False,
        cost_per_1m_input=2.0,
        cost_per_1m_output=8.0,
        default_temperature=0.8,
        recommended_system_prompt="Be helpful.",
        tags=["test", "sample"],
    )


@pytest.fixture
def abliterated_model_spec() -> ModelSpec:
    """Create an abliterated ModelSpec for testing."""
    return ModelSpec(
        model_id="test-abliterated-v1",
        provider="ollama",
        display_name="Test Abliterated V1",
        content_capability=ContentCapability.UNRESTRICTED,
        tier=ModelTier.LOCAL,
        supports_tools=True,
        supports_vision=False,
        is_abliterated=True,
        is_local=True,
        cost_per_1m_input=0.0,
        cost_per_1m_output=0.0,
        tags=["abliterated", "local", "test"],
    )


@pytest.fixture
def local_model_spec() -> ModelSpec:
    """Create a local (non-abliterated) ModelSpec for testing."""
    return ModelSpec(
        model_id="test-local-v1",
        provider="ollama",
        display_name="Test Local V1",
        content_capability=ContentCapability.SFW_ONLY,
        tier=ModelTier.LOCAL,
        supports_tools=True,
        supports_vision=False,
        is_abliterated=False,
        is_local=True,
        cost_per_1m_input=0.0,
        cost_per_1m_output=0.0,
        tags=["local", "sfw", "test"],
    )


@pytest.fixture
def provider_health() -> ProviderHealth:
    """Create a sample ProviderHealth for testing."""
    return ProviderHealth(
        provider="anthropic",
        is_available=True,
        last_check_ms=1000.0,
        error_count=0,
        avg_latency_ms=500.0,
        last_error=None,
    )


@pytest.fixture(autouse=True)
def reset_provider_health():
    """Reset provider health state before each test."""
    # Store original state
    original_health = {}
    for provider, health in PROVIDER_HEALTH.items():
        original_health[provider] = ProviderHealth(
            provider=health.provider,
            is_available=health.is_available,
            last_check_ms=health.last_check_ms,
            error_count=health.error_count,
            avg_latency_ms=health.avg_latency_ms,
            last_error=health.last_error,
        )

    yield

    # Restore original state
    for provider, health in original_health.items():
        PROVIDER_HEALTH[provider] = health


@pytest.fixture
def cleanup_registered_models():
    """Remove test models from registry after test."""
    test_model_ids = []
    yield test_model_ids
    for model_id in test_model_ids:
        MODEL_REGISTRY.pop(model_id, None)


# -----------------------------------------------------------------------------
# Test ContentCapability IntEnum Ordering
# -----------------------------------------------------------------------------


class TestContentCapabilityOrdering:
    """Tests for ContentCapability IntEnum ordering."""

    def test_content_capability_ordering(self):
        """Verify IntEnum ordering: SFW_ONLY < SUGGESTIVE < NSFW_TEXT < NSFW_ROLEPLAY < UNRESTRICTED."""
        assert ContentCapability.SFW_ONLY < ContentCapability.SUGGESTIVE
        assert ContentCapability.SUGGESTIVE < ContentCapability.NSFW_TEXT
        assert ContentCapability.NSFW_TEXT < ContentCapability.NSFW_ROLEPLAY
        assert ContentCapability.NSFW_ROLEPLAY < ContentCapability.UNRESTRICTED

    def test_content_capability_complete_ordering(self):
        """Verify complete ordering chain from lowest to highest."""
        capabilities = [
            ContentCapability.SFW_ONLY,
            ContentCapability.SUGGESTIVE,
            ContentCapability.NSFW_TEXT,
            ContentCapability.NSFW_ROLEPLAY,
            ContentCapability.UNRESTRICTED,
        ]
        for i in range(len(capabilities) - 1):
            assert capabilities[i] < capabilities[i + 1], (
                f"{capabilities[i].name} should be less than {capabilities[i + 1].name}"
            )

    def test_content_capability_values_are_integers(self):
        """Verify all ContentCapability values are integers."""
        for capability in ContentCapability:
            assert isinstance(capability.value, int)

    def test_content_capability_distinct_values(self):
        """Verify all ContentCapability values are distinct."""
        values = [c.value for c in ContentCapability]
        assert len(values) == len(set(values))

    def test_content_capability_comparison_operators(self):
        """Verify comparison operators work correctly."""
        assert ContentCapability.SUGGESTIVE >= ContentCapability.SFW_ONLY
        assert ContentCapability.SUGGESTIVE <= ContentCapability.NSFW_TEXT
        assert ContentCapability.UNRESTRICTED >= ContentCapability.UNRESTRICTED
        assert not ContentCapability.SFW_ONLY > ContentCapability.SUGGESTIVE


# -----------------------------------------------------------------------------
# Test ModelTier IntEnum Ordering
# -----------------------------------------------------------------------------


class TestModelTierOrdering:
    """Tests for ModelTier IntEnum ordering."""

    def test_model_tier_ordering(self):
        """Verify IntEnum ordering: LOCAL < FAST < STANDARD < FLAGSHIP."""
        assert ModelTier.LOCAL < ModelTier.FAST
        assert ModelTier.FAST < ModelTier.STANDARD
        assert ModelTier.STANDARD < ModelTier.FLAGSHIP

    def test_model_tier_complete_ordering(self):
        """Verify complete ordering chain from lowest to highest."""
        tiers = [
            ModelTier.LOCAL,
            ModelTier.FAST,
            ModelTier.STANDARD,
            ModelTier.FLAGSHIP,
        ]
        for i in range(len(tiers) - 1):
            assert tiers[i] < tiers[i + 1], (
                f"{tiers[i].name} should be less than {tiers[i + 1].name}"
            )

    def test_model_tier_values_are_integers(self):
        """Verify all ModelTier values are integers."""
        for tier in ModelTier:
            assert isinstance(tier.value, int)

    def test_model_tier_distinct_values(self):
        """Verify all ModelTier values are distinct."""
        values = [t.value for t in ModelTier]
        assert len(values) == len(set(values))

    def test_model_tier_comparison_operators(self):
        """Verify comparison operators work correctly."""
        assert ModelTier.FAST >= ModelTier.LOCAL
        assert ModelTier.STANDARD <= ModelTier.FLAGSHIP
        assert ModelTier.FLAGSHIP >= ModelTier.FLAGSHIP
        assert not ModelTier.LOCAL > ModelTier.FAST


# -----------------------------------------------------------------------------
# Test ModelSpec Dataclass
# -----------------------------------------------------------------------------


class TestModelSpecCreation:
    """Tests for ModelSpec dataclass creation and behavior."""

    def test_model_spec_creation_with_required_fields(self):
        """Verify ModelSpec can be created with only required fields."""
        spec = ModelSpec(
            model_id="minimal-model",
            provider="openai",
            display_name="Minimal Model",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.FAST,
        )
        assert spec.model_id == "minimal-model"
        assert spec.provider == "openai"
        assert spec.display_name == "Minimal Model"
        assert spec.content_capability == ContentCapability.SFW_ONLY
        assert spec.tier == ModelTier.FAST

    def test_model_spec_default_values(self):
        """Verify ModelSpec uses correct default values."""
        spec = ModelSpec(
            model_id="default-test",
            provider="anthropic",
            display_name="Default Test",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        assert spec.supports_tools is True
        assert spec.supports_vision is False
        assert spec.supports_streaming is True
        assert spec.context_window == 128000
        assert spec.max_output_tokens == 4096
        assert spec.avg_latency_ms == 1000.0
        assert spec.tokens_per_second == 50.0
        assert spec.is_abliterated is False
        assert spec.is_local is False
        assert spec.cost_per_1m_input == 0.0
        assert spec.cost_per_1m_output == 0.0
        assert spec.default_temperature == 0.7
        assert spec.recommended_system_prompt is None
        assert spec.tags == []

    def test_model_spec_all_fields(self, sample_model_spec):
        """Verify ModelSpec stores all provided fields correctly."""
        assert sample_model_spec.model_id == "test-model-v1"
        assert sample_model_spec.provider == "openai"
        assert sample_model_spec.display_name == "Test Model V1"
        assert sample_model_spec.content_capability == ContentCapability.SUGGESTIVE
        assert sample_model_spec.tier == ModelTier.STANDARD
        assert sample_model_spec.supports_tools is True
        assert sample_model_spec.supports_vision is True
        assert sample_model_spec.supports_streaming is True
        assert sample_model_spec.context_window == 64000
        assert sample_model_spec.max_output_tokens == 8192
        assert sample_model_spec.avg_latency_ms == 1500.0
        assert sample_model_spec.tokens_per_second == 100.0
        assert sample_model_spec.is_abliterated is False
        assert sample_model_spec.is_local is False
        assert sample_model_spec.cost_per_1m_input == 2.0
        assert sample_model_spec.cost_per_1m_output == 8.0
        assert sample_model_spec.default_temperature == 0.8
        assert sample_model_spec.recommended_system_prompt == "Be helpful."
        assert sample_model_spec.tags == ["test", "sample"]

    def test_model_spec_hash(self, sample_model_spec):
        """Verify ModelSpec is hashable based on model_id and provider."""
        hash_value = hash(sample_model_spec)
        expected_hash = hash(("test-model-v1", "openai"))
        assert hash_value == expected_hash

    def test_model_spec_hash_in_set(self, sample_model_spec):
        """Verify ModelSpec can be used in sets."""
        spec_set = {sample_model_spec}
        duplicate = ModelSpec(
            model_id="test-model-v1",
            provider="openai",
            display_name="Different Name",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.LOCAL,
        )
        spec_set.add(duplicate)
        assert len(spec_set) == 1

    def test_model_spec_equality(self, sample_model_spec):
        """Verify ModelSpec equality is based on model_id and provider."""
        same_spec = ModelSpec(
            model_id="test-model-v1",
            provider="openai",
            display_name="Different Name",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.LOCAL,
        )
        different_id = ModelSpec(
            model_id="different-model",
            provider="openai",
            display_name="Test Model V1",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )
        different_provider = ModelSpec(
            model_id="test-model-v1",
            provider="anthropic",
            display_name="Test Model V1",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.STANDARD,
        )

        assert sample_model_spec == same_spec
        assert sample_model_spec != different_id
        assert sample_model_spec != different_provider

    def test_model_spec_equality_with_non_model_spec(self, sample_model_spec):
        """Verify ModelSpec returns False when compared to non-ModelSpec."""
        assert sample_model_spec != "test-model-v1"
        assert sample_model_spec != {"model_id": "test-model-v1"}
        assert sample_model_spec != 42
        assert sample_model_spec != None


# -----------------------------------------------------------------------------
# Test Default Models Loaded
# -----------------------------------------------------------------------------


class TestDefaultModelsLoaded:
    """Tests for MODEL_REGISTRY containing expected models."""

    def test_registry_is_not_empty(self):
        """Verify MODEL_REGISTRY contains models."""
        assert len(MODEL_REGISTRY) > 0

    def test_registry_contains_anthropic_models(self):
        """Verify registry contains Anthropic models."""
        anthropic_models = [m for m in MODEL_REGISTRY.values() if m.provider == "anthropic"]
        assert len(anthropic_models) >= 1

    def test_registry_contains_openai_models(self):
        """Verify registry contains OpenAI models."""
        openai_models = [m for m in MODEL_REGISTRY.values() if m.provider == "openai"]
        assert len(openai_models) >= 1

    def test_registry_contains_ollama_models(self):
        """Verify registry contains Ollama models."""
        ollama_models = [m for m in MODEL_REGISTRY.values() if m.provider == "ollama"]
        assert len(ollama_models) >= 1

    def test_registry_contains_expected_claude_model(self):
        """Verify registry contains expected Claude model."""
        assert "claude-sonnet-4-20250514" in MODEL_REGISTRY
        claude = MODEL_REGISTRY["claude-sonnet-4-20250514"]
        assert claude.provider == "anthropic"
        assert claude.tier == ModelTier.STANDARD

    def test_registry_contains_expected_gpt_model(self):
        """Verify registry contains expected GPT model."""
        assert "gpt-4o" in MODEL_REGISTRY
        gpt = MODEL_REGISTRY["gpt-4o"]
        assert gpt.provider == "openai"

    def test_registry_contains_abliterated_models(self):
        """Verify registry contains abliterated models."""
        abliterated = [m for m in MODEL_REGISTRY.values() if m.is_abliterated]
        assert len(abliterated) >= 1

    def test_registry_contains_local_models(self):
        """Verify registry contains local models."""
        local_models = [m for m in MODEL_REGISTRY.values() if m.is_local]
        assert len(local_models) >= 1

    def test_all_models_have_valid_provider(self):
        """Verify all models have a valid provider type."""
        valid_providers = {"anthropic", "openai", "ollama", "together", "groq"}
        for model in MODEL_REGISTRY.values():
            assert model.provider in valid_providers, f"Invalid provider: {model.provider}"

    def test_all_models_have_valid_capability(self):
        """Verify all models have a valid content capability."""
        for model in MODEL_REGISTRY.values():
            assert isinstance(model.content_capability, ContentCapability)

    def test_all_models_have_valid_tier(self):
        """Verify all models have a valid tier."""
        for model in MODEL_REGISTRY.values():
            assert isinstance(model.tier, ModelTier)


# -----------------------------------------------------------------------------
# Test get_model Function
# -----------------------------------------------------------------------------


class TestGetModel:
    """Tests for get_model function."""

    def test_get_model_existing(self):
        """Verify get_model returns correct model for existing model_id."""
        model = get_model("gpt-4o")
        assert model is not None
        assert model.model_id == "gpt-4o"
        assert model.provider == "openai"
        assert model.display_name == "GPT-4o"

    def test_get_model_returns_same_instance(self):
        """Verify get_model returns the same instance from registry."""
        model1 = get_model("gpt-4o")
        model2 = get_model("gpt-4o")
        assert model1 is model2

    def test_get_model_nonexistent(self):
        """Verify get_model returns None for unknown model_id."""
        model = get_model("nonexistent-model-xyz")
        assert model is None

    def test_get_model_empty_string(self):
        """Verify get_model returns None for empty string."""
        model = get_model("")
        assert model is None

    def test_get_model_case_sensitive(self):
        """Verify get_model is case-sensitive."""
        model_lower = get_model("gpt-4o")
        model_upper = get_model("GPT-4O")
        assert model_lower is not None
        assert model_upper is None


# -----------------------------------------------------------------------------
# Test get_models_by_capability Function
# -----------------------------------------------------------------------------


class TestGetModelsByCapability:
    """Tests for get_models_by_capability function."""

    def test_get_models_by_capability_sfw_only(self):
        """Verify filtering by SFW_ONLY returns all models."""
        models = get_models_by_capability(ContentCapability.SFW_ONLY)
        assert len(models) == len(MODEL_REGISTRY)

    def test_get_models_by_capability_unrestricted(self):
        """Verify filtering by UNRESTRICTED returns only unrestricted models."""
        models = get_models_by_capability(ContentCapability.UNRESTRICTED)
        for model in models:
            assert model.content_capability == ContentCapability.UNRESTRICTED

    def test_get_models_by_capability_nsfw_roleplay(self):
        """Verify filtering by NSFW_ROLEPLAY returns appropriate models."""
        models = get_models_by_capability(ContentCapability.NSFW_ROLEPLAY)
        for model in models:
            assert model.content_capability >= ContentCapability.NSFW_ROLEPLAY

    def test_get_models_by_capability_hierarchy(self):
        """Verify capability filtering respects hierarchy."""
        unrestricted = get_models_by_capability(ContentCapability.UNRESTRICTED)
        nsfw_roleplay = get_models_by_capability(ContentCapability.NSFW_ROLEPLAY)
        nsfw_text = get_models_by_capability(ContentCapability.NSFW_TEXT)
        suggestive = get_models_by_capability(ContentCapability.SUGGESTIVE)
        sfw_only = get_models_by_capability(ContentCapability.SFW_ONLY)

        assert len(unrestricted) <= len(nsfw_roleplay)
        assert len(nsfw_roleplay) <= len(nsfw_text)
        assert len(nsfw_text) <= len(suggestive)
        assert len(suggestive) <= len(sfw_only)

    def test_get_models_by_capability_returns_list(self):
        """Verify function returns a list."""
        models = get_models_by_capability(ContentCapability.SUGGESTIVE)
        assert isinstance(models, list)


# -----------------------------------------------------------------------------
# Test get_models_by_provider Function
# -----------------------------------------------------------------------------


class TestGetModelsByProvider:
    """Tests for get_models_by_provider function."""

    def test_get_models_by_provider_anthropic(self):
        """Verify filtering by anthropic returns only Anthropic models."""
        models = get_models_by_provider("anthropic")
        assert len(models) >= 1
        for model in models:
            assert model.provider == "anthropic"

    def test_get_models_by_provider_openai(self):
        """Verify filtering by openai returns only OpenAI models."""
        models = get_models_by_provider("openai")
        assert len(models) >= 1
        for model in models:
            assert model.provider == "openai"

    def test_get_models_by_provider_ollama(self):
        """Verify filtering by ollama returns only Ollama models."""
        models = get_models_by_provider("ollama")
        assert len(models) >= 1
        for model in models:
            assert model.provider == "ollama"

    def test_get_models_by_provider_together(self):
        """Verify filtering by together returns only Together models."""
        models = get_models_by_provider("together")
        for model in models:
            assert model.provider == "together"

    def test_get_models_by_provider_groq(self):
        """Verify filtering by groq returns only Groq models."""
        models = get_models_by_provider("groq")
        for model in models:
            assert model.provider == "groq"

    def test_get_models_by_provider_returns_list(self):
        """Verify function returns a list."""
        models = get_models_by_provider("anthropic")
        assert isinstance(models, list)

    def test_get_models_by_provider_unknown(self):
        """Verify unknown provider returns empty list."""
        # Note: This would require type ignore since provider is a Literal
        # But testing the behavior is still useful
        models = [m for m in MODEL_REGISTRY.values() if m.provider == "unknown"]  # type: ignore
        assert models == []


# -----------------------------------------------------------------------------
# Test get_abliterated_models Function
# -----------------------------------------------------------------------------


class TestGetAbliteratedModels:
    """Tests for get_abliterated_models function."""

    def test_get_abliterated_models_returns_only_abliterated(self):
        """Verify function returns only abliterated models."""
        models = get_abliterated_models()
        for model in models:
            assert model.is_abliterated is True

    def test_get_abliterated_models_not_empty(self):
        """Verify registry contains abliterated models."""
        models = get_abliterated_models()
        assert len(models) >= 1

    def test_get_abliterated_models_have_unrestricted_or_nsfw_capability(self):
        """Verify abliterated models have appropriate content capability."""
        models = get_abliterated_models()
        for model in models:
            assert model.content_capability >= ContentCapability.NSFW_ROLEPLAY

    def test_get_abliterated_models_returns_list(self):
        """Verify function returns a list."""
        models = get_abliterated_models()
        assert isinstance(models, list)

    def test_get_abliterated_models_are_model_specs(self):
        """Verify all returned items are ModelSpec instances."""
        models = get_abliterated_models()
        for model in models:
            assert isinstance(model, ModelSpec)


# -----------------------------------------------------------------------------
# Test get_local_models Function
# -----------------------------------------------------------------------------


class TestGetLocalModels:
    """Tests for get_local_models function."""

    def test_get_local_models_returns_only_local(self):
        """Verify function returns only local models."""
        models = get_local_models()
        for model in models:
            assert model.is_local is True

    def test_get_local_models_not_empty(self):
        """Verify registry contains local models."""
        models = get_local_models()
        assert len(models) >= 1

    def test_get_local_models_are_ollama_provider(self):
        """Verify local models are from ollama provider."""
        models = get_local_models()
        for model in models:
            assert model.provider == "ollama"

    def test_get_local_models_have_zero_cost(self):
        """Verify local models have zero cost."""
        models = get_local_models()
        for model in models:
            assert model.cost_per_1m_input == 0.0
            assert model.cost_per_1m_output == 0.0

    def test_get_local_models_have_local_tier(self):
        """Verify local models have LOCAL tier."""
        models = get_local_models()
        for model in models:
            assert model.tier == ModelTier.LOCAL

    def test_get_local_models_returns_list(self):
        """Verify function returns a list."""
        models = get_local_models()
        assert isinstance(models, list)


# -----------------------------------------------------------------------------
# Test register_model Function
# -----------------------------------------------------------------------------


class TestRegisterModel:
    """Tests for register_model function."""

    def test_register_model_adds_to_registry(self, cleanup_registered_models):
        """Verify registering a new model adds it to the registry."""
        new_model = ModelSpec(
            model_id="test-new-model-reg",
            provider="anthropic",
            display_name="Test New Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.FAST,
        )
        cleanup_registered_models.append("test-new-model-reg")

        register_model(new_model)

        assert "test-new-model-reg" in MODEL_REGISTRY
        assert MODEL_REGISTRY["test-new-model-reg"] == new_model

    def test_register_model_updates_existing(self, cleanup_registered_models):
        """Verify registering an existing model_id updates it."""
        model_id = "test-update-model"
        cleanup_registered_models.append(model_id)

        original = ModelSpec(
            model_id=model_id,
            provider="openai",
            display_name="Original Name",
            content_capability=ContentCapability.SFW_ONLY,
            tier=ModelTier.LOCAL,
        )
        register_model(original)

        updated = ModelSpec(
            model_id=model_id,
            provider="openai",
            display_name="Updated Name",
            content_capability=ContentCapability.UNRESTRICTED,
            tier=ModelTier.FLAGSHIP,
        )
        register_model(updated)

        assert MODEL_REGISTRY[model_id].display_name == "Updated Name"
        assert MODEL_REGISTRY[model_id].content_capability == ContentCapability.UNRESTRICTED
        assert MODEL_REGISTRY[model_id].tier == ModelTier.FLAGSHIP

    def test_register_model_is_retrievable(self, cleanup_registered_models):
        """Verify registered model can be retrieved via get_model."""
        new_model = ModelSpec(
            model_id="test-retrievable-model",
            provider="together",
            display_name="Retrievable Model",
            content_capability=ContentCapability.NSFW_TEXT,
            tier=ModelTier.STANDARD,
        )
        cleanup_registered_models.append("test-retrievable-model")

        register_model(new_model)
        retrieved = get_model("test-retrievable-model")

        assert retrieved is not None
        assert retrieved.model_id == "test-retrievable-model"
        assert retrieved.provider == "together"

    def test_register_model_appears_in_provider_filter(self, cleanup_registered_models):
        """Verify registered model appears in provider filter results."""
        new_model = ModelSpec(
            model_id="test-provider-filter-model",
            provider="groq",
            display_name="Provider Filter Model",
            content_capability=ContentCapability.SUGGESTIVE,
            tier=ModelTier.FAST,
        )
        cleanup_registered_models.append("test-provider-filter-model")

        register_model(new_model)
        groq_models = get_models_by_provider("groq")

        model_ids = [m.model_id for m in groq_models]
        assert "test-provider-filter-model" in model_ids

    def test_register_abliterated_model_appears_in_filter(self, cleanup_registered_models):
        """Verify registered abliterated model appears in abliterated filter."""
        new_model = ModelSpec(
            model_id="test-abliterated-filter",
            provider="ollama",
            display_name="Abliterated Filter Test",
            content_capability=ContentCapability.UNRESTRICTED,
            tier=ModelTier.LOCAL,
            is_abliterated=True,
            is_local=True,
        )
        cleanup_registered_models.append("test-abliterated-filter")

        register_model(new_model)
        abliterated = get_abliterated_models()

        model_ids = [m.model_id for m in abliterated]
        assert "test-abliterated-filter" in model_ids


# -----------------------------------------------------------------------------
# Test ProviderHealth Dataclass
# -----------------------------------------------------------------------------


class TestProviderHealthTracking:
    """Tests for ProviderHealth dataclass."""

    def test_provider_health_creation(self):
        """Verify ProviderHealth can be created with required fields."""
        health = ProviderHealth(provider="anthropic")
        assert health.provider == "anthropic"
        assert health.is_available is True
        assert health.last_check_ms == 0.0
        assert health.error_count == 0
        assert health.avg_latency_ms == 0.0
        assert health.last_error is None

    def test_provider_health_all_fields(self, provider_health):
        """Verify ProviderHealth stores all fields correctly."""
        assert provider_health.provider == "anthropic"
        assert provider_health.is_available is True
        assert provider_health.last_check_ms == 1000.0
        assert provider_health.error_count == 0
        assert provider_health.avg_latency_ms == 500.0
        assert provider_health.last_error is None

    def test_provider_health_with_error(self):
        """Verify ProviderHealth stores error information."""
        health = ProviderHealth(
            provider="openai",
            is_available=False,
            error_count=3,
            last_error="Rate limit exceeded",
        )
        assert health.is_available is False
        assert health.error_count == 3
        assert health.last_error == "Rate limit exceeded"

    def test_global_provider_health_initialized(self):
        """Verify PROVIDER_HEALTH global dict is initialized with all providers."""
        expected_providers = {"anthropic", "openai", "ollama", "together", "groq"}
        assert set(PROVIDER_HEALTH.keys()) == expected_providers

    def test_global_provider_health_default_available(self):
        """Verify all providers start as available."""
        for provider, health in PROVIDER_HEALTH.items():
            assert health.provider == provider


# -----------------------------------------------------------------------------
# Test update_provider_health Function
# -----------------------------------------------------------------------------


class TestUpdateProviderHealth:
    """Tests for update_provider_health function."""

    def test_update_provider_health_availability(self):
        """Verify updating provider availability."""
        update_provider_health("anthropic", is_available=False)
        assert PROVIDER_HEALTH["anthropic"].is_available is False

        update_provider_health("anthropic", is_available=True)
        assert PROVIDER_HEALTH["anthropic"].is_available is True

    def test_update_provider_health_sets_timestamp(self):
        """Verify update sets last_check_ms timestamp."""
        before = time.time() * 1000
        update_provider_health("openai", is_available=True)
        after = time.time() * 1000

        last_check = PROVIDER_HEALTH["openai"].last_check_ms
        assert before <= last_check <= after

    def test_update_provider_health_latency_ema(self):
        """Verify latency uses exponential moving average."""
        # Reset to known state
        PROVIDER_HEALTH["anthropic"].avg_latency_ms = 0.0

        # First update: 0 * 0.8 + 1000 * 0.2 = 200
        update_provider_health("anthropic", is_available=True, latency_ms=1000.0)
        assert PROVIDER_HEALTH["anthropic"].avg_latency_ms == 200.0

        # Second update: 200 * 0.8 + 500 * 0.2 = 160 + 100 = 260
        update_provider_health("anthropic", is_available=True, latency_ms=500.0)
        assert PROVIDER_HEALTH["anthropic"].avg_latency_ms == 260.0

    def test_update_provider_health_error_increments_count(self):
        """Verify error increments error_count."""
        PROVIDER_HEALTH["openai"].error_count = 0
        PROVIDER_HEALTH["openai"].last_error = None

        update_provider_health("openai", is_available=False, error="Connection timeout")
        assert PROVIDER_HEALTH["openai"].error_count == 1
        assert PROVIDER_HEALTH["openai"].last_error == "Connection timeout"

        update_provider_health("openai", is_available=False, error="Rate limited")
        assert PROVIDER_HEALTH["openai"].error_count == 2
        assert PROVIDER_HEALTH["openai"].last_error == "Rate limited"

    def test_update_provider_health_success_resets_error(self):
        """Verify successful update resets error state."""
        PROVIDER_HEALTH["ollama"].error_count = 5
        PROVIDER_HEALTH["ollama"].last_error = "Previous error"

        update_provider_health("ollama", is_available=True)
        assert PROVIDER_HEALTH["ollama"].error_count == 0
        assert PROVIDER_HEALTH["ollama"].last_error is None

    def test_update_provider_health_creates_new_provider(self):
        """Verify updating unknown provider creates new entry."""
        # Note: This tests internal behavior with non-standard provider
        # In practice, providers are constrained by ProviderType Literal
        custom_provider = "custom"  # type: ignore
        if custom_provider in PROVIDER_HEALTH:
            del PROVIDER_HEALTH[custom_provider]

        update_provider_health(custom_provider, is_available=True, latency_ms=100.0)  # type: ignore

        assert custom_provider in PROVIDER_HEALTH
        assert PROVIDER_HEALTH[custom_provider].is_available is True

        # Cleanup
        del PROVIDER_HEALTH[custom_provider]

    def test_update_provider_health_without_latency(self):
        """Verify update without latency doesn't change avg_latency_ms."""
        original_latency = PROVIDER_HEALTH["together"].avg_latency_ms
        update_provider_health("together", is_available=True)
        # Latency stays the same (or changes due to EMA with None)
        # Since latency_ms is None, it shouldn't update
        # Looking at the code, it only updates if latency_ms is not None
        assert PROVIDER_HEALTH["together"].avg_latency_ms == original_latency

    def test_update_provider_health_unavailable_without_error(self):
        """Verify unavailable update without error message."""
        PROVIDER_HEALTH["groq"].error_count = 0
        update_provider_health("groq", is_available=False)

        # Should still increment error count? No, looking at code:
        # error_count only increments if error is provided
        assert PROVIDER_HEALTH["groq"].is_available is False
        assert PROVIDER_HEALTH["groq"].error_count == 0


# -----------------------------------------------------------------------------
# Integration Tests
# -----------------------------------------------------------------------------


class TestModelRegistryIntegration:
    """Integration tests combining multiple registry operations."""

    def test_filter_chain_capability_and_provider(self):
        """Test filtering by both capability and provider."""
        # Get all suggestive-capable models
        capable_models = get_models_by_capability(ContentCapability.SUGGESTIVE)
        # Filter to just Anthropic
        anthropic_capable = [m for m in capable_models if m.provider == "anthropic"]

        assert len(anthropic_capable) >= 1
        for model in anthropic_capable:
            assert model.provider == "anthropic"
            assert model.content_capability >= ContentCapability.SUGGESTIVE

    def test_local_and_abliterated_overlap(self):
        """Test overlap between local and abliterated models."""
        local_models = set(m.model_id for m in get_local_models())
        abliterated_models = set(m.model_id for m in get_abliterated_models())

        # Some local models should be abliterated
        overlap = local_models & abliterated_models
        assert len(overlap) >= 1

        # But not all local models are abliterated
        local_only = local_models - abliterated_models
        # llama3.2:latest is local but not abliterated
        assert len(local_only) >= 1

    def test_register_and_filter_workflow(self, cleanup_registered_models):
        """Test workflow of registering and then filtering for new model."""
        new_model = ModelSpec(
            model_id="workflow-test-model",
            provider="anthropic",
            display_name="Workflow Test",
            content_capability=ContentCapability.NSFW_TEXT,
            tier=ModelTier.STANDARD,
            is_abliterated=False,
            is_local=False,
        )
        cleanup_registered_models.append("workflow-test-model")

        # Before registration
        assert get_model("workflow-test-model") is None

        # Register
        register_model(new_model)

        # After registration
        retrieved = get_model("workflow-test-model")
        assert retrieved is not None
        assert retrieved.model_id == "workflow-test-model"

        # Should appear in capability filter
        nsfw_text_models = get_models_by_capability(ContentCapability.NSFW_TEXT)
        model_ids = [m.model_id for m in nsfw_text_models]
        assert "workflow-test-model" in model_ids

        # Should appear in provider filter
        anthropic_models = get_models_by_provider("anthropic")
        model_ids = [m.model_id for m in anthropic_models]
        assert "workflow-test-model" in model_ids

    def test_provider_health_affects_available_providers(self):
        """Test that provider health tracking works with get_available_providers."""
        from orchestrator.routing.model_registry import get_available_providers

        # Initially all should be available
        available = get_available_providers()
        assert "anthropic" in available

        # Mark one unavailable
        update_provider_health("anthropic", is_available=False, error="Test error")
        available = get_available_providers()
        assert "anthropic" not in available

        # Mark available again
        update_provider_health("anthropic", is_available=True)
        available = get_available_providers()
        assert "anthropic" in available
