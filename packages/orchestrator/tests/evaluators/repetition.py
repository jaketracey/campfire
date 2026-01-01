"""
Repetition detection for catching duplicate/near-duplicate responses.

This is the primary tool for debugging the reported 5-15 turn duplication issue.
"""

from dataclasses import dataclass, field
import difflib
from collections import Counter
import re


@dataclass
class RepetitionResult:
    """Results of repetition analysis."""

    exact_duplicates: list[tuple[int, int]] = field(default_factory=list)
    near_duplicates: list[tuple[int, int, float]] = field(default_factory=list)
    phrase_repetitions: dict[str, list[int]] = field(default_factory=dict)
    severity: str = "none"
    details: str = ""


class RepetitionDetector:
    """
    Detects various forms of repetition in conversation responses.

    Detection methods:
    1. Exact match (after normalization)
    2. High similarity (>0.8 Jaccard/cosine on n-grams)
    3. Repeated phrases (>5 words appearing 3+ times)
    4. Structural repetition (same sentence patterns)
    """

    def __init__(
        self,
        similarity_threshold: float = 0.8,
        phrase_min_words: int = 5,
        phrase_min_occurrences: int = 3,
    ):
        self.similarity_threshold = similarity_threshold
        self.phrase_min_words = phrase_min_words
        self.phrase_min_occurrences = phrase_min_occurrences

    def analyze(self, responses: list[str]) -> RepetitionResult:
        """Analyze a list of responses for repetition patterns."""
        if len(responses) < 2:
            return RepetitionResult(severity="none", details="Not enough responses to analyze")

        # 1. Check for exact duplicates
        exact_dupes = self._find_exact_duplicates(responses)

        # 2. Check for near duplicates
        near_dupes = self._find_near_duplicates(responses)

        # 3. Check for repeated phrases
        phrase_reps = self._find_phrase_repetitions(responses)

        # 4. Determine severity
        severity = self._calculate_severity(exact_dupes, near_dupes, phrase_reps, len(responses))

        # 5. Generate details
        details = self._generate_details(exact_dupes, near_dupes, phrase_reps)

        return RepetitionResult(
            exact_duplicates=exact_dupes,
            near_duplicates=near_dupes,
            phrase_repetitions=phrase_reps,
            severity=severity,
            details=details,
        )

    def _normalize(self, text: str) -> str:
        """Normalize text for comparison."""
        # Lowercase and remove extra whitespace
        text = text.lower().strip()
        text = re.sub(r"\s+", " ", text)
        # Remove punctuation for comparison
        text = re.sub(r"[^\w\s]", "", text)
        return text

    def _find_exact_duplicates(self, responses: list[str]) -> list[tuple[int, int]]:
        """Find response pairs that are exact duplicates after normalization."""
        results = []
        normalized = [self._normalize(r) for r in responses]

        for i, norm_a in enumerate(normalized):
            for j in range(i + 1, len(normalized)):
                norm_b = normalized[j]
                if norm_a == norm_b and len(norm_a) > 20:  # Ignore very short responses
                    results.append((i, j))

        return results

    def _find_near_duplicates(self, responses: list[str]) -> list[tuple[int, int, float]]:
        """Find response pairs with high similarity."""
        results = []

        for i, resp_a in enumerate(responses):
            for j in range(i + 1, len(responses)):
                resp_b = responses[j]
                similarity = self._calculate_similarity(resp_a, resp_b)
                if similarity >= self.similarity_threshold:
                    results.append((i, j, similarity))

        return results

    def _calculate_similarity(self, text_a: str, text_b: str) -> float:
        """Calculate normalized similarity between two texts."""
        # Use SequenceMatcher for quick similarity
        norm_a = self._normalize(text_a)
        norm_b = self._normalize(text_b)

        if not norm_a or not norm_b:
            return 0.0

        ratio = difflib.SequenceMatcher(None, norm_a, norm_b).ratio()
        return ratio

    def _extract_phrases(self, text: str, min_words: int) -> list[str]:
        """Extract phrases of minimum length from text."""
        words = self._normalize(text).split()
        phrases = []

        for i in range(len(words) - min_words + 1):
            phrase = " ".join(words[i : i + min_words])
            phrases.append(phrase)

        return phrases

    def _find_phrase_repetitions(self, responses: list[str]) -> dict[str, list[int]]:
        """Find phrases that appear across multiple responses."""
        phrase_locations: dict[str, list[int]] = {}

        for turn_idx, response in enumerate(responses):
            phrases = self._extract_phrases(response, self.phrase_min_words)
            seen_in_turn: set[str] = set()

            for phrase in phrases:
                if phrase in seen_in_turn:
                    continue
                seen_in_turn.add(phrase)

                if phrase not in phrase_locations:
                    phrase_locations[phrase] = []
                phrase_locations[phrase].append(turn_idx)

        # Filter to phrases appearing in multiple responses
        repeated = {
            phrase: turns
            for phrase, turns in phrase_locations.items()
            if len(turns) >= self.phrase_min_occurrences
        }

        return repeated

    def _calculate_severity(
        self,
        exact_dupes: list[tuple[int, int]],
        near_dupes: list[tuple[int, int, float]],
        phrase_reps: dict[str, list[int]],
        total_responses: int,
    ) -> str:
        """Calculate overall severity of repetition."""
        # Exact duplicates are severe
        if len(exact_dupes) > 0:
            return "severe"

        # Multiple near-duplicates are moderate to severe
        if len(near_dupes) >= 3:
            return "severe"
        if len(near_dupes) >= 2:
            return "moderate"
        if len(near_dupes) == 1:
            return "minor"

        # Many repeated phrases are moderate
        if len(phrase_reps) >= 5:
            return "moderate"
        if len(phrase_reps) >= 2:
            return "minor"

        return "none"

    def _generate_details(
        self,
        exact_dupes: list[tuple[int, int]],
        near_dupes: list[tuple[int, int, float]],
        phrase_reps: dict[str, list[int]],
    ) -> str:
        """Generate human-readable details of repetition findings."""
        parts = []

        if exact_dupes:
            pairs = ", ".join(f"({a+1}, {b+1})" for a, b in exact_dupes)
            parts.append(f"Exact duplicates at turns: {pairs}")

        if near_dupes:
            pairs = ", ".join(f"({a+1}, {b+1}: {sim:.0%})" for a, b, sim in near_dupes)
            parts.append(f"Near duplicates at turns: {pairs}")

        if phrase_reps:
            phrases = list(phrase_reps.keys())[:3]  # Show top 3
            examples = "; ".join(f'"{p}"' for p in phrases)
            parts.append(f"Repeated phrases ({len(phrase_reps)} total): {examples}")

        return " | ".join(parts) if parts else "No significant repetition detected"


def analyze_conversation_repetition(
    responses: list[str],
    similarity_threshold: float = 0.8,
) -> RepetitionResult:
    """Convenience function to analyze conversation repetition."""
    detector = RepetitionDetector(similarity_threshold=similarity_threshold)
    return detector.analyze(responses)
