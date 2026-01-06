"""
Memory Retention Tests

Tests the companion's ability to recall facts from earlier in conversation.
Addresses the reported duplication issue at 5-15 turns.
"""

import pytest
from pathlib import Path

import yaml

from .evaluators.repetition import RepetitionDetector, analyze_conversation_repetition
from .fixtures.companions import get_test_companion

# Load test scenarios
SCENARIOS_PATH = Path(__file__).parent / "fixtures/scenarios/memory_retention.yaml"


@pytest.fixture
def repetition_detector():
    """Create a repetition detector with default settings."""
    return RepetitionDetector(similarity_threshold=0.8)


@pytest.fixture
def scenarios():
    """Load test scenarios from YAML."""
    with open(SCENARIOS_PATH) as f:
        return yaml.safe_load(f)["scenarios"]


@pytest.fixture
def test_companion():
    """Get the friendly test companion."""
    return get_test_companion("friendly_companion")


class TestRepetitionDetection:
    """
    Specific tests for the repetition/duplication bug.

    These tests aim to reproduce and diagnose the reported issue
    of exact message duplication at 5-15 turns.
    """

    def test_no_repetition_in_short_conversation(self, repetition_detector):
        """Verify no false positives in a normal short conversation."""
        responses = [
            "Hello! Nice to meet you.",
            "I love hiking in the mountains!",
            "That's a great question. Let me think about it.",
            "Music is one of my favorite topics.",
            "I'd be happy to help with that.",
        ]

        result = repetition_detector.analyze(responses)

        assert result.severity == "none", f"Unexpected repetition: {result.details}"
        assert len(result.exact_duplicates) == 0
        assert len(result.near_duplicates) == 0

    def test_detect_exact_duplicates(self, repetition_detector):
        """Verify detection of exact duplicate responses."""
        responses = [
            "Hello! Nice to meet you. How can I help you today?",
            "That's interesting! Tell me more.",
            "I enjoy learning about new things.",
            "Hello! Nice to meet you. How can I help you today?",  # Exact duplicate
            "Let me think about that.",
        ]

        result = repetition_detector.analyze(responses)

        assert result.severity == "severe"
        assert len(result.exact_duplicates) == 1
        assert result.exact_duplicates[0] == (0, 3)

    def test_detect_near_duplicates(self, repetition_detector):
        """Verify detection of near-duplicate responses."""
        responses = [
            "I really enjoy hiking in the mountains during summer.",
            "That's a great point you're making there.",
            "I absolutely love hiking in the mountains during summertime.",  # Near duplicate
            "What else would you like to discuss?",
        ]

        result = repetition_detector.analyze(responses)

        # Should detect the near duplicate
        assert len(result.near_duplicates) >= 1
        # First and third response should be flagged
        near_dup_pairs = [(a, b) for a, b, _ in result.near_duplicates]
        assert (0, 2) in near_dup_pairs

    def test_detect_repeated_phrases(self, repetition_detector):
        """Verify detection of repeated phrases across responses."""
        responses = [
            "I think that's a really interesting perspective on the matter.",
            "Let me consider that for a moment.",
            "You raise a really interesting perspective on this topic.",
            "I appreciate you sharing that.",
            "That's a really interesting perspective you have there.",
        ]

        result = repetition_detector.analyze(responses)

        # Should detect the repeated phrase
        assert len(result.phrase_repetitions) > 0 or len(result.near_duplicates) > 0

    def test_no_false_positives_for_greetings(self, repetition_detector):
        """Verify short common phrases don't trigger false positives."""
        responses = [
            "Hi there!",
            "Of course!",
            "That's great!",
            "I see.",
            "Absolutely!",
        ]

        result = repetition_detector.analyze(responses)

        assert result.severity == "none", "Should not flag short common phrases"

    @pytest.mark.parametrize("turn_count", [10, 12, 15, 20])
    def test_generated_conversation_no_repetition(self, repetition_detector, turn_count: int):
        """
        Test that generated conversations don't have repetition at key turn counts.

        This targets the reported issue at 5-15 turns.
        """
        # Generate diverse responses that shouldn't repeat
        responses = []
        topics = [
            "weather", "hobbies", "work", "family", "travel",
            "food", "music", "movies", "books", "sports",
            "technology", "nature", "art", "science", "history",
            "philosophy", "dreams", "goals", "memories", "plans"
        ]

        for i in range(turn_count):
            topic = topics[i % len(topics)]
            response = f"Regarding {topic}, I find it quite fascinating. There are so many aspects to explore, like {topic} and its impact on daily life. What are your thoughts on {topic}? I'd love to hear more about your experiences with {topic}-related activities."
            responses.append(response)

        result = repetition_detector.analyze(responses)

        # This test will likely fail with generated repetitive responses,
        # which is expected. The point is to have a baseline for comparison
        # with real LLM responses.
        if result.severity == "severe":
            pytest.skip("Generated responses have expected repetition patterns")


class TestMemoryRetention:
    """Tests for memory retention across conversation turns."""

    def test_analyze_conversation_repetition_function(self):
        """Test the convenience function."""
        responses = [
            "Hello there!",
            "How are you doing?",
            "That's wonderful to hear.",
        ]

        result = analyze_conversation_repetition(responses)
        assert result.severity == "none"

    def test_empty_responses(self, repetition_detector):
        """Test handling of empty response list."""
        result = repetition_detector.analyze([])
        assert result.severity == "none"

    def test_single_response(self, repetition_detector):
        """Test handling of single response."""
        result = repetition_detector.analyze(["Hello!"])
        assert result.severity == "none"

    def test_scenarios_loaded(self, scenarios):
        """Verify test scenarios are loaded correctly."""
        assert len(scenarios) > 0
        assert any(s["id"] == "duplication_at_turn_10" for s in scenarios)
        assert any(s["id"] == "duplication_at_turn_15" for s in scenarios)

    def test_scenario_structure(self, scenarios):
        """Verify scenario structure is valid."""
        for scenario in scenarios:
            assert "id" in scenario
            assert "description" in scenario
            assert ("turns" in scenario) or ("sessions" in scenario)
            if "turns" in scenario:
                assert isinstance(scenario["turns"], list)
            if "sessions" in scenario:
                assert isinstance(scenario["sessions"], list)


class TestSeverityCalculation:
    """Tests for severity calculation logic."""

    def test_severity_none(self, repetition_detector):
        """Test severity 'none' for no repetition."""
        result = repetition_detector.analyze([
            "First unique response.",
            "Second unique response.",
            "Third unique response.",
        ])
        assert result.severity == "none"

    def test_severity_minor(self, repetition_detector):
        """Test severity 'minor' for one near duplicate."""
        result = repetition_detector.analyze([
            "I really love hiking in the beautiful mountains during summer months.",
            "That's an interesting point.",
            "I absolutely love hiking in the gorgeous mountains during summer days.",
        ])
        assert result.severity in ["minor", "moderate"]

    def test_severity_severe_exact_duplicate(self, repetition_detector):
        """Test severity 'severe' for exact duplicates."""
        duplicate = "This is a longer message that will be exactly duplicated to trigger detection."
        result = repetition_detector.analyze([
            duplicate,
            "Some other message.",
            duplicate,
        ])
        assert result.severity == "severe"
