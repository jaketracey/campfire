"""Tests for orchestrator response parsing helpers."""

from types import SimpleNamespace

from orchestrator.main import extract_image_tool_metadata
from orchestrator.models.tools import ToolResult
from orchestrator.services.orchestrator import ConversationOrchestrator


def _make_orchestrator() -> ConversationOrchestrator:
    """Create an uninitialized orchestrator for pure parsing helper tests."""
    return ConversationOrchestrator.__new__(ConversationOrchestrator)


def test_parse_multi_messages_from_structured_json() -> None:
    orchestrator = _make_orchestrator()

    messages, image_prompt = orchestrator._parse_multi_messages(
        '{"messages":["First response","Second response"],"image_prompt":"selfie by a window"}'
    )

    assert messages == ["First response", "Second response"]
    assert image_prompt == "selfie by a window"


def test_parse_multi_messages_from_markdown_wrapped_json() -> None:
    orchestrator = _make_orchestrator()

    messages, image_prompt = orchestrator._parse_multi_messages(
        """```json
{"message":"Single reply","imagePrompt":"close-up portrait"}
```"""
    )

    assert messages == ["Single reply"]
    assert image_prompt == "close-up portrait"


def test_parse_image_prompt_from_structured_message_objects() -> None:
    orchestrator = _make_orchestrator()

    cleaned_content, image_prompt = orchestrator._parse_image_prompt(
        '{"messages":[{"content":"Hello there"}],"image_prompt":"cinematic selfie"}'
    )

    assert cleaned_content == "Hello there"
    assert image_prompt == "cinematic selfie"


def test_parse_multi_messages_falls_back_to_xml_format() -> None:
    orchestrator = _make_orchestrator()

    messages, image_prompt = orchestrator._parse_multi_messages(
        "<message>One</message><message>Two <image_prompt>neon portrait</image_prompt></message>"
    )

    assert messages == ["One", "Two"]
    assert image_prompt == "neon portrait"


def test_serialize_tool_result_includes_metadata() -> None:
    orchestrator = _make_orchestrator()
    tool_result = ToolResult(
        tool_call_id="call-1",
        name="image_generation",
        success=True,
        output="Image generated: https://example.com/image.png",
        metadata={"image_url": "https://example.com/image.png", "provider": "fal"},
    )

    serialized = orchestrator._serialize_tool_result(tool_result)

    assert serialized["metadata"] == {
        "image_url": "https://example.com/image.png",
        "provider": "fal",
    }


def test_extract_image_tool_metadata_from_turn() -> None:
    turn = SimpleNamespace(
        tool_calls=[
            {"name": "memory_read", "arguments": {"query": "test"}},
            {"name": "image_generation", "arguments": {"prompt": "cinematic portrait near campfire"}},
        ],
        tool_results=[
            {"name": "image_generation", "metadata": {"image_url": "https://example.com/generated.png"}},
        ],
    )

    image_prompt, generated_image_url = extract_image_tool_metadata(turn)  # type: ignore[arg-type]

    assert image_prompt == "cinematic portrait near campfire"
    assert generated_image_url == "https://example.com/generated.png"


def test_extract_image_tool_metadata_from_legacy_tool_name() -> None:
    turn = SimpleNamespace(
        tool_calls=[
            {"name": "image_gen", "arguments": {"prompt": "legacy portrait request"}},
            {"name": "memory_read", "arguments": {"query": "test"}},
        ],
        tool_results=[
            {"name": "image_gen", "metadata": {"image_url": "https://example.com/legacy.png"}},
        ],
    )

    image_prompt, generated_image_url = extract_image_tool_metadata(turn)  # type: ignore[arg-type]

    assert image_prompt == "legacy portrait request"
    assert generated_image_url == "https://example.com/legacy.png"
