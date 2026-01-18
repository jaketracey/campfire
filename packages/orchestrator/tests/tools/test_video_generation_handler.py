"""
VideoGenerationHandler Tests

Tests for the video generation handler, including:
- Basic video generation
- Visual prompt augmentation integration
- Provider fallback behavior
- Rate limiting
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolCallContext, ToolResult
from orchestrator.tools.handlers import VideoGenerationHandler


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        fal_api_key="test-fal-key",
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
    """Create a VideoGenerationHandler instance."""
    return VideoGenerationHandler(settings, event_emitter, http_client)


@pytest.fixture
def sample_tool_call():
    """Create a basic video generation tool call."""
    return ToolCall(
        id="test-call-id",
        name="video_generation",
        arguments={
            "prompt": "a person walking on the beach",
            "duration_seconds": 5,
        },
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
        {"role": "user", "content": "Can you show me a video of you at the beach?"},
        {"role": "assistant", "content": "Sure! I'll create a video of me walking there."},
    ]


@pytest.fixture
def tool_call_with_context(sample_companion_spec, sample_recent_turns):
    """Create a tool call with context for augmentation."""
    return ToolCall(
        id="test-call-id",
        name="video_generation",
        arguments={
            "prompt": "walking on the beach",
            "duration_seconds": 5,
        },
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
        context=ToolCallContext(
            companion_spec=sample_companion_spec,
            recent_turns=sample_recent_turns,
        ),
    )


@pytest.fixture
def tool_call_with_source_image():
    """Create a tool call with source image for image-to-video."""
    return ToolCall(
        id="test-call-id",
        name="video_generation",
        arguments={
            "prompt": "gentle ocean waves",
            "source_image_url": "https://example.com/beach.png",
            "duration_seconds": 5,
        },
        turn_id=uuid4(),
        session_id=uuid4(),
        user_id=uuid4(),
        companion_id=uuid4(),
    )


class TestVideoGenerationHandlerBasics:
    """Basic tests for VideoGenerationHandler."""

    def test_handler_name(self, handler):
        """Handler should have correct name."""
        assert handler.name == "video_generation"

    def test_lazy_provider_init(self, handler):
        """Video provider should be lazily initialized."""
        assert handler._fal_video_provider is None

    def test_lazy_visual_augmenter_init(self, handler):
        """Visual augmenter should be lazily initialized."""
        assert handler._visual_augmenter is None


class TestVideoGenerationExecution:
    """Tests for video generation execution."""

    @pytest.mark.asyncio
    async def test_execute_basic_video_generation(self, handler, sample_tool_call):
        """Should generate video with basic parameters."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = "https://example.com/thumb.jpg"

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert result.success is True
        assert "video.mp4" in result.output
        assert result.metadata["video_url"] == "https://example.com/video.mp4"
        assert result.metadata["duration_seconds"] == 5.0

    @pytest.mark.asyncio
    async def test_execute_with_source_image(self, handler, tool_call_with_source_image):
        """Should pass source image URL for image-to-video generation."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call_with_source_image)

        assert result.success is True
        # Verify source_image_url was passed
        call_kwargs = handler._generate_video.call_args[1]
        assert call_kwargs["source_image_url"] == "https://example.com/beach.png"

    @pytest.mark.asyncio
    async def test_execute_handles_generation_error(self, handler, sample_tool_call):
        """Should handle video generation errors gracefully."""
        handler._generate_video = AsyncMock(
            side_effect=RuntimeError("Video generation failed")
        )

        result = await handler.execute(sample_tool_call)

        assert result.success is False
        assert "Video generation failed" in result.error

    @pytest.mark.asyncio
    async def test_execute_emits_event(self, handler, sample_tool_call, event_emitter):
        """Should emit completion event."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(sample_tool_call)

        event_emitter.emit.assert_called_once()
        event = event_emitter.emit.call_args[0][0]
        assert event.tool_name == "video_generation"


class TestPromptAugmentation:
    """Tests for prompt augmentation in video generation."""

    @pytest.mark.asyncio
    async def test_augments_prompt_with_context(self, handler, tool_call_with_context):
        """Should augment prompt with character visual details."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call_with_context)

        assert result.success is True
        # Check augmented prompt was used
        call_kwargs = handler._generate_video.call_args[1]
        augmented_prompt = call_kwargs["prompt"]
        assert "Character:" in augmented_prompt
        assert "female" in augmented_prompt

    @pytest.mark.asyncio
    async def test_no_augmentation_without_context(self, handler, sample_tool_call):
        """Should use original prompt without context."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(sample_tool_call)

        call_kwargs = handler._generate_video.call_args[1]
        # Original prompt without augmentation
        assert call_kwargs["prompt"] == "a person walking on the beach"

    @pytest.mark.asyncio
    async def test_metadata_includes_augmentation_flag(
        self, handler, tool_call_with_context
    ):
        """Result metadata should indicate if prompt was augmented."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call_with_context)

        assert result.metadata.get("was_augmented") is True


class TestVideoParameters:
    """Tests for video generation parameters."""

    @pytest.mark.asyncio
    async def test_default_duration(self, handler):
        """Should use default duration when not specified."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call)

        call_kwargs = handler._generate_video.call_args[1]
        assert call_kwargs["duration_seconds"] == 5  # Default duration

    @pytest.mark.asyncio
    async def test_custom_duration(self, handler):
        """Should use custom duration when specified."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video", "duration_seconds": 10},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 10.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call)

        call_kwargs = handler._generate_video.call_args[1]
        assert call_kwargs["duration_seconds"] == 10

    @pytest.mark.asyncio
    async def test_aspect_ratio_portrait(self, handler):
        """Should handle portrait aspect ratio."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video", "aspect_ratio": "9:16"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call)

        call_kwargs = handler._generate_video.call_args[1]
        # Portrait should have height > width
        assert call_kwargs["height"] > call_kwargs["width"]

    @pytest.mark.asyncio
    async def test_aspect_ratio_landscape(self, handler):
        """Should handle landscape aspect ratio."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video", "aspect_ratio": "16:9"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1920
        mock_result.height = 1080
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        await handler.execute(tool_call)

        call_kwargs = handler._generate_video.call_args[1]
        # Landscape should have width > height
        assert call_kwargs["width"] > call_kwargs["height"]


class TestOutputFormatting:
    """Tests for video result output formatting."""

    @pytest.mark.asyncio
    async def test_output_includes_video_url(self, handler, sample_tool_call):
        """Output should include video URL."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert "https://example.com/video.mp4" in result.output

    @pytest.mark.asyncio
    async def test_output_includes_duration(self, handler, sample_tool_call):
        """Output should include video duration."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert "5" in result.output  # Duration in seconds

    @pytest.mark.asyncio
    async def test_metadata_includes_thumbnail(self, handler, sample_tool_call):
        """Metadata should include thumbnail URL when available."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = "https://example.com/thumb.jpg"

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        assert result.metadata["thumbnail_url"] == "https://example.com/thumb.jpg"


class TestCostEstimation:
    """Tests for video generation cost tracking."""

    @pytest.mark.asyncio
    async def test_cost_included_in_result(self, handler, sample_tool_call):
        """Result should include cost estimate."""
        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(sample_tool_call)

        # Video generation should have a cost estimate
        assert result.cost_usd > 0


class TestEdgeCases:
    """Edge case tests for video generation handler."""

    @pytest.mark.asyncio
    async def test_empty_prompt(self, handler):
        """Should handle empty prompt gracefully."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": ""},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call)

        # Should still attempt generation (provider might have defaults)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_context_with_empty_visual_style(self, handler):
        """Should handle context with empty visual_style."""
        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
            context=ToolCallContext(
                companion_spec={"name": "Test", "visual_style": {}},
                recent_turns=[],
            ),
        )

        mock_result = MagicMock()
        mock_result.video_url = "https://example.com/video.mp4"
        mock_result.request_id = "req-123"
        mock_result.duration_seconds = 5.0
        mock_result.width = 1080
        mock_result.height = 1920
        mock_result.latency_ms = 10000.0
        mock_result.thumbnail_url = None

        handler._generate_video = AsyncMock(return_value=mock_result)

        result = await handler.execute(tool_call)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_no_provider_configured(self, event_emitter, http_client):
        """Should fail gracefully when no provider is configured."""
        # Create settings without FAL key by using empty string
        settings = Settings(fal_api_key="")
        handler = VideoGenerationHandler(settings, event_emitter, http_client)
        # Force provider to be None by setting internal state
        handler._fal_video_provider = None

        # Mock the _get_fal_video_provider to return None
        def mock_get_provider():
            return None
        handler._get_fal_video_provider = mock_get_provider

        tool_call = ToolCall(
            id="test",
            name="video_generation",
            arguments={"prompt": "test video"},
            turn_id=uuid4(),
            session_id=uuid4(),
            user_id=uuid4(),
            companion_id=uuid4(),
        )

        result = await handler.execute(tool_call)

        assert result.success is False
        assert "provider" in result.error.lower()
