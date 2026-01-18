"""Lorebook/World Info Service.

This service provides SillyTavern-style lorebook functionality, injecting
contextual lore entries into prompts when trigger keywords are detected
in the conversation.
"""

import re
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger()


@dataclass
class LorebookConfig:
    """Configuration for the lorebook service."""

    max_entries_per_prompt: int = 5
    """Maximum number of lorebook entries to inject per prompt."""

    max_content_length: int = 2000
    """Maximum total content length for lorebook context."""

    default_scan_depth: int = 10
    """Default number of messages to scan for triggers."""


@dataclass
class LorebookEntry:
    """A lorebook/world info entry."""

    id: UUID
    """Unique identifier for the entry."""

    companion_id: UUID
    """The companion this entry belongs to."""

    name: str
    """Display name for the entry."""

    trigger_keywords: list[str]
    """Keywords that trigger this entry's injection."""

    content: str
    """The lore content to inject when triggered."""

    priority: int = 0
    """Higher priority entries are injected first."""

    scan_depth: int = 10
    """How many messages back to scan for this entry's triggers."""

    is_case_sensitive: bool = False
    """Whether keyword matching should be case sensitive."""

    is_enabled: bool = True
    """Whether this entry is active."""

    created_at: str | None = None
    """When the entry was created."""

    updated_at: str | None = None
    """When the entry was last updated."""


@dataclass
class LorebookMatch:
    """Result of a lorebook keyword match."""

    entry: LorebookEntry
    """The matched entry."""

    matched_keyword: str
    """The keyword that triggered the match."""

    matched_in_message_index: int
    """Index of the message where the match was found."""


class LorebookService:
    """Service for matching and injecting lorebook entries.

    Scans conversation history for trigger keywords and returns matching
    lorebook entries to inject into the prompt.
    """

    def __init__(self, config: LorebookConfig | None = None):
        """Initialize the lorebook service.

        Args:
            config: Optional configuration. Uses defaults if not provided.
        """
        self.config = config or LorebookConfig()

    def find_matches(
        self,
        entries: list[LorebookEntry],
        messages: list[dict[str, Any]],
        scan_depth: int | None = None,
    ) -> list[LorebookMatch]:
        """Find lorebook entries matching keywords in messages.

        Args:
            entries: Available lorebook entries to match against.
            messages: Conversation messages to scan.
            scan_depth: How many recent messages to scan. Defaults to config.

        Returns:
            List of matching entries, sorted by priority (descending).
        """
        if not entries or not messages:
            return []

        effective_scan_depth = scan_depth or self.config.default_scan_depth
        matches: list[LorebookMatch] = []
        seen_entry_ids: set[UUID] = set()

        # Get messages to scan (most recent N)
        messages_to_scan = messages[-effective_scan_depth:]
        base_index = len(messages) - len(messages_to_scan)

        for entry in entries:
            if not entry.is_enabled:
                continue

            # Use entry-specific scan depth if smaller
            entry_scan_depth = min(entry.scan_depth, effective_scan_depth)
            entry_messages = messages_to_scan[-entry_scan_depth:]
            entry_base_index = len(messages) - len(entry_messages)

            match = self._find_keyword_match(
                entry=entry,
                messages=entry_messages,
                base_message_index=entry_base_index,
            )

            if match and entry.id not in seen_entry_ids:
                matches.append(match)
                seen_entry_ids.add(entry.id)

        # Sort by priority (descending)
        matches.sort(key=lambda m: m.entry.priority, reverse=True)

        # Limit to max entries
        matches = matches[: self.config.max_entries_per_prompt]

        logger.debug(
            "lorebook_matches_found",
            match_count=len(matches),
            scanned_messages=len(messages_to_scan),
            entry_names=[m.entry.name for m in matches],
        )

        return matches

    def _find_keyword_match(
        self,
        entry: LorebookEntry,
        messages: list[dict[str, Any]],
        base_message_index: int,
    ) -> LorebookMatch | None:
        """Find if any keyword from entry matches in messages.

        Args:
            entry: The lorebook entry to check.
            messages: Messages to scan.
            base_message_index: Index offset for message tracking.

        Returns:
            LorebookMatch if found, None otherwise.
        """
        for i, message in enumerate(messages):
            content = message.get("content", "")
            if not isinstance(content, str):
                continue

            for keyword in entry.trigger_keywords:
                if self._keyword_matches(keyword, content, entry.is_case_sensitive):
                    return LorebookMatch(
                        entry=entry,
                        matched_keyword=keyword,
                        matched_in_message_index=base_message_index + i,
                    )

        return None

    def _keyword_matches(
        self,
        keyword: str,
        text: str,
        case_sensitive: bool,
    ) -> bool:
        """Check if keyword matches in text with word boundary checking.

        Args:
            keyword: The keyword to match.
            text: The text to search in.
            case_sensitive: Whether matching should be case sensitive.

        Returns:
            True if keyword matches at word boundaries.
        """
        # Escape special regex characters in keyword
        escaped_keyword = re.escape(keyword)

        # Determine if we should use word boundaries
        # Word boundaries only work properly with word characters at edges
        starts_with_word = keyword and keyword[0].isalnum()
        ends_with_word = keyword and keyword[-1].isalnum()

        # Build regex pattern with appropriate boundaries
        prefix = r"\b" if starts_with_word else r"(?<![a-zA-Z0-9_])"
        suffix = r"\b" if ends_with_word else r"(?![a-zA-Z0-9_])"

        # Handle edge case where keyword is at start/end of text
        # by making the lookbehind/lookahead optional at string boundaries
        if not starts_with_word:
            prefix = rf"(?:^|{prefix})"
        if not ends_with_word:
            suffix = rf"(?:{suffix}|$)"

        pattern = f"{prefix}{escaped_keyword}{suffix}"

        flags = 0 if case_sensitive else re.IGNORECASE

        try:
            return bool(re.search(pattern, text, flags))
        except re.error:
            # Fallback to simple substring match if regex fails
            if case_sensitive:
                return keyword in text
            return keyword.lower() in text.lower()

    def format_for_prompt(
        self,
        matches: list[LorebookMatch],
    ) -> str:
        """Format matched entries for prompt injection.

        Args:
            matches: List of matched lorebook entries.

        Returns:
            Formatted string for prompt injection, or empty string.
        """
        if not matches:
            return ""

        lines = ["<lorebook_context>"]
        lines.append("World information relevant to this conversation:")
        lines.append("")

        total_length = 0
        max_length = self.config.max_content_length

        for match in matches:
            entry = match.entry

            # Check if we have room for this entry
            entry_content = entry.content
            if total_length + len(entry_content) > max_length:
                # Truncate to fit
                available = max_length - total_length - 50  # Leave room for truncation marker
                if available > 100:
                    entry_content = entry_content[:available] + "..."
                else:
                    break  # No more room

            lines.append(f"**{entry.name}**")
            lines.append(entry_content)
            lines.append("")

            total_length += len(entry_content)

        lines.append(
            "Use this world information naturally in your responses when relevant. "
            "Do not explicitly reference that you have 'lore' or 'world info'."
        )
        lines.append("</lorebook_context>")

        return "\n".join(lines)


# Singleton instance
_lorebook_service: LorebookService | None = None


def get_lorebook_service(config: LorebookConfig | None = None) -> LorebookService:
    """Get the singleton lorebook service.

    Args:
        config: Optional configuration for the service.

    Returns:
        The LorebookService instance.
    """
    global _lorebook_service
    if _lorebook_service is None:
        _lorebook_service = LorebookService(config)
    return _lorebook_service
