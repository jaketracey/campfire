"""
Tests for video generation tool definition.

Verifies that the VIDEO_GENERATION tool is properly defined
and can be converted to provider-specific formats.
"""

import pytest

from orchestrator.models.tools import (
    ToolType,
    ToolDefinition,
    VIDEO_GENERATION_TOOL,
    TOOL_REGISTRY,
)


class TestVideoGenerationToolType:
    """Tests for VIDEO_GENERATION tool type."""

    def test_video_generation_tool_type_exists(self):
        """VIDEO_GENERATION should be a valid ToolType."""
        assert ToolType.VIDEO_GENERATION == "video_generation"

    def test_video_generation_in_registry(self):
        """VIDEO_GENERATION should be in the tool registry."""
        assert "video_generation" in TOOL_REGISTRY


class TestVideoGenerationToolDefinition:
    """Tests for VIDEO_GENERATION_TOOL definition."""

    def test_tool_name(self):
        """Tool should have correct name."""
        assert VIDEO_GENERATION_TOOL.name == "video_generation"

    def test_tool_type(self):
        """Tool should have correct type."""
        assert VIDEO_GENERATION_TOOL.tool_type == ToolType.VIDEO_GENERATION

    def test_tool_description_is_descriptive(self):
        """Tool description should explain video generation."""
        desc = VIDEO_GENERATION_TOOL.description.lower()
        assert "video" in desc
        assert "generate" in desc or "create" in desc

    def test_prompt_parameter_exists(self):
        """Should have a prompt parameter."""
        assert "prompt" in VIDEO_GENERATION_TOOL.parameters
        param = VIDEO_GENERATION_TOOL.parameters["prompt"]
        assert param["type"] == "string"

    def test_prompt_is_required(self):
        """Prompt should be a required parameter."""
        assert "prompt" in VIDEO_GENERATION_TOOL.required_params

    def test_duration_parameter_exists(self):
        """Should have a duration_seconds parameter."""
        assert "duration_seconds" in VIDEO_GENERATION_TOOL.parameters
        param = VIDEO_GENERATION_TOOL.parameters["duration_seconds"]
        assert param["type"] == "integer"

    def test_duration_has_default(self):
        """Duration should have a default value."""
        param = VIDEO_GENERATION_TOOL.parameters["duration_seconds"]
        assert "default" in param
        assert param["default"] == 5

    def test_source_image_parameter_exists(self):
        """Should have a source_image_url parameter for image-to-video."""
        assert "source_image_url" in VIDEO_GENERATION_TOOL.parameters
        param = VIDEO_GENERATION_TOOL.parameters["source_image_url"]
        assert param["type"] == "string"

    def test_aspect_ratio_parameter_exists(self):
        """Should have an aspect_ratio parameter."""
        assert "aspect_ratio" in VIDEO_GENERATION_TOOL.parameters
        param = VIDEO_GENERATION_TOOL.parameters["aspect_ratio"]
        assert param["type"] == "string"
        assert "enum" in param
        # Should support common aspect ratios
        assert "16:9" in param["enum"]
        assert "9:16" in param["enum"]

    def test_requires_confirmation(self):
        """Video generation should require confirmation due to cost."""
        assert VIDEO_GENERATION_TOOL.requires_confirmation is True

    def test_cost_estimate_set(self):
        """Should have a cost estimate set."""
        assert VIDEO_GENERATION_TOOL.cost_estimate_usd > 0
        # Video is more expensive than images
        assert VIDEO_GENERATION_TOOL.cost_estimate_usd >= 0.10

    def test_timeout_is_longer(self):
        """Video generation should have longer timeout."""
        # Video takes longer than images
        assert VIDEO_GENERATION_TOOL.timeout_seconds >= 120.0


class TestVideoGenerationOpenAIFormat:
    """Tests for OpenAI function format conversion."""

    def test_to_openai_function(self):
        """Should convert to valid OpenAI function format."""
        openai_func = VIDEO_GENERATION_TOOL.to_openai_function()
        
        assert openai_func["type"] == "function"
        assert openai_func["function"]["name"] == "video_generation"
        assert "description" in openai_func["function"]
        assert "parameters" in openai_func["function"]

    def test_openai_parameters_schema(self):
        """OpenAI format should have proper JSON schema."""
        openai_func = VIDEO_GENERATION_TOOL.to_openai_function()
        params = openai_func["function"]["parameters"]
        
        assert params["type"] == "object"
        assert "properties" in params
        assert "required" in params
        assert "prompt" in params["required"]

    def test_openai_prompt_property(self):
        """OpenAI format should include prompt property."""
        openai_func = VIDEO_GENERATION_TOOL.to_openai_function()
        props = openai_func["function"]["parameters"]["properties"]
        
        assert "prompt" in props
        assert props["prompt"]["type"] == "string"


class TestVideoGenerationAnthropicFormat:
    """Tests for Anthropic tool format conversion."""

    def test_to_anthropic_tool(self):
        """Should convert to valid Anthropic tool format."""
        anthropic_tool = VIDEO_GENERATION_TOOL.to_anthropic_tool()
        
        assert anthropic_tool["name"] == "video_generation"
        assert "description" in anthropic_tool
        assert "input_schema" in anthropic_tool

    def test_anthropic_input_schema(self):
        """Anthropic format should have proper input schema."""
        anthropic_tool = VIDEO_GENERATION_TOOL.to_anthropic_tool()
        schema = anthropic_tool["input_schema"]
        
        assert schema["type"] == "object"
        assert "properties" in schema
        assert "required" in schema

    def test_anthropic_prompt_property(self):
        """Anthropic format should include prompt property."""
        anthropic_tool = VIDEO_GENERATION_TOOL.to_anthropic_tool()
        props = anthropic_tool["input_schema"]["properties"]
        
        assert "prompt" in props
        assert props["prompt"]["type"] == "string"


class TestToolRegistryIntegrity:
    """Tests to ensure tool registry is properly updated."""

    def test_video_generation_retrievable_from_registry(self):
        """Should be able to retrieve VIDEO_GENERATION from registry."""
        tool = TOOL_REGISTRY.get("video_generation")
        assert tool is not None
        assert tool == VIDEO_GENERATION_TOOL

    def test_image_generation_still_in_registry(self):
        """IMAGE_GENERATION should still be in registry."""
        assert "image_generation" in TOOL_REGISTRY

    def test_registry_tool_types_unique(self):
        """All tools in registry should have unique names."""
        names = list(TOOL_REGISTRY.keys())
        assert len(names) == len(set(names))
