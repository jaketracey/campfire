"""Tests for orchestrator response parsing helpers."""

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
