"""
Lorebook Service Tests

Tests for the lorebook/world info system that injects contextual
lore entries when trigger keywords are detected in conversation.
"""

import pytest
from uuid import uuid4
from datetime import datetime

from orchestrator.services.lorebook import (
    LorebookService,
    LorebookEntry,
    LorebookMatch,
    LorebookConfig,
)


@pytest.fixture
def lorebook_service():
    """Create a lorebook service with default config."""
    return LorebookService(
        config=LorebookConfig(
            max_entries_per_prompt=5,
            max_content_length=2000,
            default_scan_depth=10,
        )
    )


@pytest.fixture
def sample_entries():
    """Create sample lorebook entries."""
    return [
        LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="The Crystal Palace",
            trigger_keywords=["crystal palace", "palace", "royal residence"],
            content="The Crystal Palace is the seat of power in Aetheria, a magnificent structure made of enchanted crystal that glows with an inner light.",
            priority=10,
            scan_depth=5,
            is_case_sensitive=False,
            is_enabled=True,
        ),
        LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Queen Seraphina",
            trigger_keywords=["queen", "seraphina", "her majesty"],
            content="Queen Seraphina rules Aetheria with wisdom and compassion. She possesses the rare gift of foresight.",
            priority=5,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        ),
        LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="The Shadowlands",
            trigger_keywords=["shadowlands", "dark realm", "forbidden territory"],
            content="The Shadowlands are a cursed region where light cannot penetrate. Few who enter ever return.",
            priority=8,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        ),
        LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Aetherian Magic",
            trigger_keywords=["magic", "spellcasting", "enchantment"],
            content="Magic in Aetheria flows from crystalline ley lines that crisscross the land.",
            priority=3,
            scan_depth=15,
            is_case_sensitive=False,
            is_enabled=True,
        ),
        LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Disabled Entry",
            trigger_keywords=["disabled", "inactive"],
            content="This entry should never be matched.",
            priority=100,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=False,  # Disabled
        ),
    ]


@pytest.fixture
def sample_messages():
    """Create sample conversation messages."""
    return [
        {"role": "user", "content": "Tell me about the queen's palace."},
        {"role": "assistant", "content": "Of course! What would you like to know?"},
        {"role": "user", "content": "Is it true that magic flows there strongly?"},
        {"role": "assistant", "content": "Yes, the Crystal Palace is built on a major ley line convergence."},
        {"role": "user", "content": "What about the Shadowlands? Are they dangerous?"},
    ]


class TestLorebookServiceBasics:
    """Basic tests for LorebookService initialization."""

    def test_init_with_defaults(self):
        """Should initialize with default configuration."""
        service = LorebookService()
        assert service.config is not None
        assert service.config.max_entries_per_prompt > 0

    def test_init_with_custom_config(self):
        """Should accept custom configuration."""
        config = LorebookConfig(
            max_entries_per_prompt=10,
            max_content_length=5000,
            default_scan_depth=20,
        )
        service = LorebookService(config=config)
        assert service.config.max_entries_per_prompt == 10
        assert service.config.max_content_length == 5000


class TestKeywordMatching:
    """Tests for keyword matching logic."""

    def test_single_keyword_match(self, lorebook_service, sample_entries):
        """Should match a single keyword."""
        messages = [{"role": "user", "content": "Tell me about the queen."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) >= 1
        assert any(m.entry.name == "Queen Seraphina" for m in matches)

    def test_multiple_keyword_match(self, lorebook_service, sample_entries):
        """Should match multiple keywords from same entry."""
        messages = [{"role": "user", "content": "Queen Seraphina lives in the palace."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        # Should match both Queen and Palace entries
        entry_names = {m.entry.name for m in matches}
        assert "Queen Seraphina" in entry_names
        assert "The Crystal Palace" in entry_names

    def test_case_insensitive_matching(self, lorebook_service, sample_entries):
        """Should match keywords regardless of case."""
        messages = [{"role": "user", "content": "THE QUEEN rules AETHERIA."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        assert any(m.entry.name == "Queen Seraphina" for m in matches)

    def test_case_sensitive_matching(self, lorebook_service):
        """Should respect case sensitivity when enabled."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Proper Noun",
            trigger_keywords=["ProperNoun"],
            content="This is case sensitive.",
            priority=10,
            scan_depth=10,
            is_case_sensitive=True,  # Case sensitive
            is_enabled=True,
        )
        
        # Should not match lowercase
        messages = [{"role": "user", "content": "propernoun is here."}]
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        assert len(matches) == 0
        
        # Should match exact case
        messages = [{"role": "user", "content": "ProperNoun is here."}]
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        assert len(matches) == 1

    def test_phrase_matching(self, lorebook_service, sample_entries):
        """Should match multi-word phrases."""
        messages = [{"role": "user", "content": "What about the dark realm?"}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        assert any(m.entry.name == "The Shadowlands" for m in matches)

    def test_no_match_when_keywords_absent(self, lorebook_service, sample_entries):
        """Should return empty when no keywords match."""
        messages = [{"role": "user", "content": "Hello, how are you today?"}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) == 0

    def test_disabled_entries_not_matched(self, lorebook_service, sample_entries):
        """Should not match disabled entries."""
        messages = [{"role": "user", "content": "The disabled entry should be inactive."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        # Should not match the disabled entry
        assert not any(m.entry.name == "Disabled Entry" for m in matches)


class TestScanDepth:
    """Tests for conversation scan depth."""

    def test_respects_scan_depth(self, lorebook_service, sample_entries):
        """Should only scan messages within scan_depth."""
        # Create messages where keyword is outside scan depth
        messages = [
            {"role": "user", "content": "Let's talk about the queen."},  # Index 0
            {"role": "assistant", "content": "Sure!"},
            {"role": "user", "content": "What's the weather?"},
            {"role": "assistant", "content": "It's sunny."},
            {"role": "user", "content": "Any other topics?"},  # Index 4
        ]
        
        # Scan depth of 2 should not see the first message with "queen"
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=2,
        )
        
        # Queen is at index 0, but we're only scanning last 2 messages
        assert not any(m.entry.name == "Queen Seraphina" for m in matches)

    def test_entry_specific_scan_depth(self, lorebook_service):
        """Should use entry-specific scan depth when provided."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Recent Only",
            trigger_keywords=["recent"],
            content="This should only match recent messages.",
            priority=10,
            scan_depth=2,  # Very shallow scan depth
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        messages = [
            {"role": "user", "content": "I mentioned recent earlier."},  # Index 0
            {"role": "assistant", "content": "Okay."},
            {"role": "user", "content": "Now talking about other things."},
            {"role": "assistant", "content": "Sure."},
            {"role": "user", "content": "What's new?"},  # Index 4
        ]
        
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,  # Global is 10, but entry has 2
        )
        
        # Entry's scan_depth=2 should take precedence, not matching "recent" at index 0
        assert len(matches) == 0


class TestPrioritization:
    """Tests for entry prioritization."""

    def test_higher_priority_first(self, lorebook_service, sample_entries):
        """Higher priority entries should come first."""
        messages = [
            {"role": "user", "content": "Magic at the crystal palace with the queen."}
        ]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        # Should be sorted by priority (descending)
        priorities = [m.entry.priority for m in matches]
        assert priorities == sorted(priorities, reverse=True)

    def test_respects_max_entries_limit(self, lorebook_service, sample_entries):
        """Should limit number of entries returned."""
        # Create service with lower limit
        service = LorebookService(
            config=LorebookConfig(max_entries_per_prompt=2)
        )
        
        messages = [
            {"role": "user", "content": "Magic at the crystal palace with the queen in the shadowlands."}
        ]
        
        matches = service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        # Should only return 2 highest priority matches
        assert len(matches) <= 2


class TestMatchMetadata:
    """Tests for match metadata."""

    def test_match_includes_matched_keyword(self, lorebook_service, sample_entries):
        """Match should include which keyword triggered it."""
        messages = [{"role": "user", "content": "Her majesty is wise."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        queen_match = next(m for m in matches if m.entry.name == "Queen Seraphina")
        assert "her majesty" in queen_match.matched_keyword.lower()

    def test_match_includes_message_index(self, lorebook_service, sample_entries):
        """Match should include which message triggered it."""
        messages = [
            {"role": "user", "content": "Hello!"},
            {"role": "assistant", "content": "Hi there!"},
            {"role": "user", "content": "Tell me about magic."},
        ]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        magic_match = next(m for m in matches if m.entry.name == "Aetherian Magic")
        assert magic_match.matched_in_message_index == 2


class TestPromptFormatting:
    """Tests for formatting lorebook content for prompt injection."""

    def test_format_for_prompt(self, lorebook_service, sample_entries):
        """Should format entries for prompt injection."""
        messages = [{"role": "user", "content": "Tell me about the queen."}]
        
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=messages,
            scan_depth=10,
        )
        
        formatted = lorebook_service.format_for_prompt(matches)
        
        assert "<lorebook_context>" in formatted
        assert "</lorebook_context>" in formatted
        assert "Queen Seraphina" in formatted

    def test_format_empty_matches(self, lorebook_service):
        """Should return empty string for no matches."""
        formatted = lorebook_service.format_for_prompt([])
        assert formatted == ""

    def test_format_truncates_long_content(self):
        """Should truncate content that exceeds limit."""
        # Use limit of 200 with 300 char content
        # Truncation logic leaves 50 chars buffer and requires >100 available
        service = LorebookService(
            config=LorebookConfig(max_content_length=200)
        )

        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Long Entry",
            trigger_keywords=["test"],
            content="A" * 300,  # Exceeds 200 char limit
            priority=10,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )

        match = LorebookMatch(
            entry=entry,
            matched_keyword="test",
            matched_in_message_index=0,
        )

        formatted = service.format_for_prompt([match])

        # Content should be truncated
        assert "..." in formatted
        # Should not contain full content
        assert "A" * 300 not in formatted


class TestLorebookEntry:
    """Tests for LorebookEntry model."""

    def test_entry_creation(self):
        """Should create entry with all fields."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Test Entry",
            trigger_keywords=["test", "sample"],
            content="Test content.",
            priority=5,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        assert entry.name == "Test Entry"
        assert "test" in entry.trigger_keywords
        assert entry.priority == 5

    def test_entry_defaults(self):
        """Should have sensible defaults."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Minimal Entry",
            trigger_keywords=["minimal"],
            content="Minimal content.",
        )
        
        assert entry.priority == 0
        assert entry.scan_depth == 10
        assert entry.is_case_sensitive is False
        assert entry.is_enabled is True


class TestLorebookConfig:
    """Tests for LorebookConfig."""

    def test_default_config(self):
        """Should have sensible defaults."""
        config = LorebookConfig()
        
        assert config.max_entries_per_prompt == 5
        assert config.max_content_length == 2000
        assert config.default_scan_depth == 10

    def test_custom_config(self):
        """Should accept custom values."""
        config = LorebookConfig(
            max_entries_per_prompt=10,
            max_content_length=5000,
            default_scan_depth=20,
        )
        
        assert config.max_entries_per_prompt == 10
        assert config.max_content_length == 5000
        assert config.default_scan_depth == 20


class TestEdgeCases:
    """Edge case tests."""

    def test_empty_messages(self, lorebook_service, sample_entries):
        """Should handle empty message list."""
        matches = lorebook_service.find_matches(
            entries=sample_entries,
            messages=[],
            scan_depth=10,
        )
        
        assert len(matches) == 0

    def test_empty_entries(self, lorebook_service):
        """Should handle empty entry list."""
        messages = [{"role": "user", "content": "Hello!"}]
        
        matches = lorebook_service.find_matches(
            entries=[],
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) == 0

    def test_special_characters_in_keywords(self, lorebook_service):
        """Should handle special regex characters in keywords."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Special Chars",
            trigger_keywords=["C++", "test.method()", "[array]"],
            content="Content with special chars.",
            priority=10,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        messages = [{"role": "user", "content": "I'm learning C++ programming."}]
        
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) == 1

    def test_unicode_keywords(self, lorebook_service):
        """Should handle unicode in keywords."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Unicode Entry",
            trigger_keywords=["café", "日本語", "émoji"],
            content="Unicode content.",
            priority=10,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        messages = [{"role": "user", "content": "Let's meet at the café."}]
        
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) == 1

    def test_very_long_keyword(self, lorebook_service):
        """Should handle very long keywords."""
        long_keyword = "this is a very long trigger phrase that spans many words"
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Long Keyword",
            trigger_keywords=[long_keyword],
            content="Long keyword content.",
            priority=10,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        messages = [{"role": "user", "content": f"I want to mention {long_keyword} here."}]
        
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        
        assert len(matches) == 1

    def test_keyword_at_word_boundary(self, lorebook_service):
        """Should only match at word boundaries."""
        entry = LorebookEntry(
            id=uuid4(),
            companion_id=uuid4(),
            name="Word Boundary",
            trigger_keywords=["cat"],
            content="About cats.",
            priority=10,
            scan_depth=10,
            is_case_sensitive=False,
            is_enabled=True,
        )
        
        # Should not match "category" which contains "cat"
        messages = [{"role": "user", "content": "What category is this?"}]
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        assert len(matches) == 0
        
        # Should match standalone "cat"
        messages = [{"role": "user", "content": "I have a cat."}]
        matches = lorebook_service.find_matches(
            entries=[entry],
            messages=messages,
            scan_depth=10,
        )
        assert len(matches) == 1
