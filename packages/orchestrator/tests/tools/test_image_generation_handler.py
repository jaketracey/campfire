"""
ImageGenerationHandler Tests

Tests for the image generation handler, particularly focusing on
the visual prompt augmentation integration.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolCallContext, ToolResult
from orchestrator.tools.handlers import ImageGenerationHandler


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        fal_api_key="test-fal-key",
        replicate_api_key="test-replicate-key",
    )


@pytest.fixture
def event_emitter():
    """Create a mock event emitter."""
    emitter = AsyncMock(spec=EventEmitter)
    emitter.emit = AsyncMock()
    return emitter


@pytest.fixture
def http_client():
    """Create a mock HTTP client."""
    return MagicMock()


@pytest.fixture
def handler(settings, event_emitter, http_client):
    """Create an ImageGenerationHandler instance."""
    return ImageGenerationHandler(settings, event_emitter, http_client)


@pytest.fixture
def sample_tool_call():
    """Create a basic tool call without context."""
    return ToolCall(
        id="test-call-id",
        name="image_generation",
        arguments={"prompt": "a beautiful sunset", "style": "realistic", "size": "512x512"},
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
    )


@pytest.fixture
def sample_companion_spec():
    """Create a sample companion spec with visual style."""
    return {
        "id": str(uuid4()),
        "name": "Luna",
        "visual_style": {
            "appearance": {
                "gender": "female",
                "ethnicity": "east-asian",
                "hairColor": "black",
                "bodyType": "athletic",
            },
            "style_type": "photorealistic",
            "constraints": ["tasteful", "no nudity"],
        },
    }


@pytest.fixture
def sample_recent_turns():
    """Create sample recent conversation turns."""
    return [
        {"role": "user", "content": "Can you show me a picture of you at the beach?"},
        {"role": "assistant", "content": "Sure! I'm wearing my favorite sundress today."},
    ]


@pytest.fixture
def tool_call_with_context(sample_companion_spec, sample_recent_turns):
    """Create a tool call with context for augmentation."""
    return ToolCall(
        id="test-call-id",
        name="image_generation",
        arguments={"prompt": "a beautiful portrait", "style": "realistic", "size": "512x512"},
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
        context=ToolCallContext(
            companion_spec=sample_companion_spec,
            recent_turns=sample_recent_turns,
        ),
    )


class TestImageGenerationHandlerBasics:
    """Basic tests for ImageGenerationHandler."""

    def test_handler_name(self, handler):
        """Handler should have correct name."""
        assert handler.name == "image_generation"

    def test_lazy_visual_augmenter_init(self, handler):
        """Visual augmenter should be lazily initialized."""
        assert handler._visual_augmenter is None
        augmenter = handler._get_visual_augmenter()
        assert augmenter is not None
        assert handler._visual_augmenter is augmenter

    def test_visual_augmenter_singleton(self, handler):
        """Same augmenter instance should be returned."""
        augmenter1 = handler._get_visual_augmenter()
        augmenter2 = handler._get_visual_augmenter()
        assert augmenter1 is augmenter2


class TestPromptAugmentation:
    """Tests for prompt augmentation behavior."""

    @pytest.mark.asyncio
    async def test_execute_without_context_uses_original_prompt(
        self, handler, sample_tool_call
    ):
        """When no context is provided, original prompt should be used."""
        # Mock the _generate_image method
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert result.success is True
        # Verify _generate_image was called with original prompt
        call_args = handler._generate_image.call_args
        assert call_args[0][0] == "a beautiful sunset"  # Original prompt
        assert call_args[1].get("negative_prompt") is None

    @pytest.mark.asyncio
    async def test_execute_with_context_augments_prompt(
        self, handler, tool_call_with_context
    ):
        """When context is provided, prompt should be augmented."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call_with_context)

        assert result.success is True
        # Verify _generate_image was called with augmented prompt
        call_args = handler._generate_image.call_args
        augmented_prompt = call_args[0][0]

        # Should contain character details
        assert "Character:" in augmented_prompt
        assert "female" in augmented_prompt
        assert "East Asian" in augmented_prompt
        assert "athletic build" in augmented_prompt
        assert "black hair" in augmented_prompt

        # Should contain original prompt
        assert "a beautiful portrait" in augmented_prompt

        # Should have negative prompt (4th positional arg)
        negative_prompt = call_args[0][3]
        assert negative_prompt is not None
        assert "low quality" in negative_prompt

    @pytest.mark.asyncio
    async def test_augmented_prompt_includes_style_constraints(
        self, handler, tool_call_with_context
    ):
        """Augmented prompt should include style constraints."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        call_args = handler._generate_image.call_args
        augmented_prompt = call_args[0][0]

        assert "Style constraints:" in augmented_prompt
        assert "tasteful" in augmented_prompt

    @pytest.mark.asyncio
    async def test_augmented_prompt_includes_scene_context(
        self, handler, tool_call_with_context
    ):
        """Augmented prompt should include scene context from recent turns."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        call_args = handler._generate_image.call_args
        augmented_prompt = call_args[0][0]

        # Should include context section (wearing is a scene keyword)
        assert "Context:" in augmented_prompt

    @pytest.mark.asyncio
    async def test_metadata_includes_augmentation_flag(
        self, handler, tool_call_with_context
    ):
        """Result metadata should indicate if prompt was augmented."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call_with_context)

        assert result.metadata.get("was_augmented") is True

    @pytest.mark.asyncio
    async def test_metadata_no_augmentation_flag_without_context(
        self, handler, sample_tool_call
    ):
        """Result metadata should indicate no augmentation without context."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert result.metadata.get("was_augmented") is False


class TestNegativePromptGeneration:
    """Tests for negative prompt generation."""

    @pytest.mark.asyncio
    async def test_negative_prompt_includes_quality_terms(
        self, handler, tool_call_with_context
    ):
        """Negative prompt should include quality negatives."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        call_args = handler._generate_image.call_args
        negative_prompt = call_args[0][3]  # 4th positional arg

        assert "low quality" in negative_prompt
        assert "blurry" in negative_prompt
        assert "bad anatomy" in negative_prompt

    @pytest.mark.asyncio
    async def test_negative_prompt_includes_gender_specific_terms(
        self, handler, tool_call_with_context
    ):
        """Negative prompt should include gender-specific negatives."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        call_args = handler._generate_image.call_args
        negative_prompt = call_args[0][3]  # 4th positional arg

        # Female character should have masculine features negative
        assert "masculine features" in negative_prompt

    @pytest.mark.asyncio
    async def test_negative_prompt_includes_hair_color_negative(
        self, handler, tool_call_with_context
    ):
        """Negative prompt should include wrong hair color negative."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        call_args = handler._generate_image.call_args
        negative_prompt = call_args[0][3]  # 4th positional arg

        assert "wrong hair color" in negative_prompt


class TestEventEmission:
    """Tests for event emission with augmented prompts."""

    @pytest.mark.asyncio
    async def test_event_includes_original_and_augmented_prompts(
        self, handler, tool_call_with_context, event_emitter
    ):
        """Event should include both original and augmented prompts."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        # Check emitted event
        event_emitter.emit.assert_called_once()
        event = event_emitter.emit.call_args[0][0]

        assert event.input_params["prompt"] == "a beautiful portrait"
        assert "Character:" in event.input_params["augmented_prompt"]
        assert event.input_params["was_augmented"] is True


class TestProviderFallback:
    """Tests for provider fallback behavior."""

    @pytest.mark.asyncio
    async def test_fal_provider_used_first(self, settings, event_emitter, http_client):
        """FAL provider should be tried first."""
        handler = ImageGenerationHandler(settings, event_emitter, http_client)

        with patch.object(handler, "_get_fal_provider") as mock_fal:
            mock_provider = AsyncMock()
            mock_provider.generate = AsyncMock(return_value={"image_url": "https://fal.ai/img.png"})
            mock_fal.return_value = mock_provider

            tool_call = ToolCall(
                id="test",
                name="image_generation",
                arguments={"prompt": "test"},
                turn_id=uuid4(),
                session_id=uuid4(),
                user_id=uuid4(),
                companion_id=uuid4(),
            )

            result = await handler.execute(tool_call)

            assert result.success is True
            assert result.metadata["provider"] == "fal"

    @pytest.mark.asyncio
    async def test_replicate_fallback_on_fal_failure(
        self, settings, event_emitter, http_client
    ):
        """Should fall back to Replicate when FAL fails."""
        handler = ImageGenerationHandler(settings, event_emitter, http_client)

        with patch.object(handler, "_get_fal_provider") as mock_fal, \
             patch.object(handler, "_get_replicate_provider") as mock_replicate:

            # FAL fails
            failing_provider = AsyncMock()
            failing_provider.generate = AsyncMock(side_effect=Exception("FAL error"))
            mock_fal.return_value = failing_provider

            # Replicate succeeds
            replicate_provider = AsyncMock()
            replicate_provider.generate = AsyncMock(
                return_value={"image_url": "https://replicate.com/img.png"}
            )
            mock_replicate.return_value = replicate_provider

            tool_call = ToolCall(
                id="test",
                name="image_generation",
                arguments={"prompt": "test"},
                turn_id=uuid4(),
                session_id=uuid4(),
                user_id=uuid4(),
                companion_id=uuid4(),
            )

            result = await handler.execute(tool_call)

            assert result.success is True
            assert result.metadata["provider"] == "replicate"


class TestEdgeCases:
    """Edge case tests."""

    @pytest.mark.asyncio
    async def test_empty_visual_style_in_context(self, handler):
        """Should handle context with empty visual_style."""
        tool_call = ToolCall(
            id="test",
            name="image_generation",
            arguments={"prompt": "test prompt"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            context=ToolCallContext(
                companion_spec={"name": "Test", "visual_style": {}},
                recent_turns=[],
            ),
        )

        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_context_with_no_appearance(self, handler):
        """Should handle context without appearance data."""
        tool_call = ToolCall(
            id="test",
            name="image_generation",
            arguments={"prompt": "test prompt"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            context=ToolCallContext(
                companion_spec={"name": "Test"},
                recent_turns=[],
            ),
        )

        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_handles_none_recent_turns(self, handler, sample_companion_spec):
        """Should handle None recent_turns in context."""
        tool_call = ToolCall(
            id="test",
            name="image_generation",
            arguments={"prompt": "test prompt"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            context=ToolCallContext(
                companion_spec=sample_companion_spec,
                recent_turns=None,
            ),
        )

        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_negative_prompt_passed_to_provider(self, handler, tool_call_with_context):
        """Negative prompt should be passed to the provider."""
        mock_result = {"image_url": "https://example.com/image.png", "provider": "fal"}
        handler._generate_image = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call_with_context)

        # Verify negative_prompt was passed (4th positional arg)
        call_args = handler._generate_image.call_args
        negative_prompt = call_args[0][3]
        assert negative_prompt is not None
