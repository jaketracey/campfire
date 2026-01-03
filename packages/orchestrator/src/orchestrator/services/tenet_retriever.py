"""Tenet retriever for fetching behavioral tenets from gateway."""

import httpx
import structlog
from typing import Any

from orchestrator.config import Settings
from orchestrator.models.conversation import (
    BehavioralTenet,
    SituationalTenetMatch,
    TenetCategory,
    TenetPriority,
)

logger = structlog.get_logger()

# Context keywords for extracting conversation contexts from messages
CONTEXT_KEYWORDS: dict[str, list[str]] = {
    "humor": ["joke", "funny", "laugh", "lol", "haha", "comedy", "hilarious"],
    "advice": ["advice", "suggest", "recommend", "should i", "help me decide", "what do you think"],
    "emotional": ["sad", "happy", "angry", "frustrated", "anxious", "worried", "stressed", "excited"],
    "personal": ["my life", "my family", "my job", "my relationship", "tell you about"],
    "technical": ["code", "programming", "debug", "error", "bug", "fix", "implement"],
    "creative": ["write", "story", "poem", "creative", "imagine", "roleplay"],
    "finances": ["money", "finances", "budget", "invest", "save", "spend", "cost"],
    "health": ["health", "exercise", "diet", "sleep", "doctor", "symptoms", "sick"],
    "relationship": ["dating", "relationship", "partner", "love", "breakup", "marriage"],
}


class TenetRetriever:
    """Retrieves behavioral tenets from gateway service."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.gateway_url = settings.gateway_internal_url
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def get_core_tenets(self, companion_id: str) -> list[BehavioralTenet]:
        """Fetch core tenets for a companion from gateway.

        Args:
            companion_id: The companion's UUID

        Returns:
            List of core behavioral tenets
        """
        try:
            client = await self._get_client()
            url = f"{self.gateway_url}/api/v1/internal/companions/{companion_id}/tenets/core"
            response = await client.get(url)
            response.raise_for_status()

            data = response.json()
            tenets = []

            for item in data.get("tenets", []):
                tenet = BehavioralTenet(
                    id=item["id"],
                    category=TenetCategory(item["category"]),
                    priority=TenetPriority.CORE,
                    rule=item["rule"],
                    is_negation=item.get("isNegation", False),
                )
                tenets.append(tenet)

            logger.debug(
                "fetched_core_tenets",
                companion_id=companion_id,
                count=len(tenets),
            )
            return tenets

        except httpx.HTTPError as e:
            logger.warning(
                "failed_to_fetch_core_tenets",
                companion_id=companion_id,
                error=str(e),
            )
            return []

    async def search_situational_tenets(
        self,
        companion_id: str,
        user_message: str,
        embedding: list[float] | None = None,
        limit: int = 5,
    ) -> list[SituationalTenetMatch]:
        """Search for situational tenets based on message context.

        Args:
            companion_id: The companion's UUID
            user_message: The current user message
            embedding: Optional embedding vector for semantic search
            limit: Maximum number of tenets to return

        Returns:
            List of matched situational tenets
        """
        # Extract contexts from the message
        contexts = self.extract_contexts_from_message(user_message)

        if not contexts and not embedding:
            return []

        try:
            client = await self._get_client()
            url = f"{self.gateway_url}/api/v1/internal/companions/{companion_id}/tenets/search"

            payload: dict[str, Any] = {
                "contexts": contexts,
                "limit": limit,
            }

            if embedding:
                payload["embedding"] = embedding

            response = await client.post(url, json=payload)
            response.raise_for_status()

            data = response.json()
            matches = []

            for item in data.get("tenets", []):
                match = SituationalTenetMatch(
                    id=item["id"],
                    category=TenetCategory(item["category"]),
                    rule=item["rule"],
                    is_negation=item.get("isNegation", False),
                    match_type=item.get("matchType", "context"),
                    similarity=item.get("similarity", 1.0),
                )
                matches.append(match)

            logger.debug(
                "searched_situational_tenets",
                companion_id=companion_id,
                contexts=contexts,
                matches=len(matches),
            )
            return matches

        except httpx.HTTPError as e:
            logger.warning(
                "failed_to_search_situational_tenets",
                companion_id=companion_id,
                error=str(e),
            )
            return []

    def extract_contexts_from_message(self, message: str) -> list[str]:
        """Extract context tags from a user message.

        Analyzes the message for keywords that indicate conversation contexts
        such as emotional state, topic areas, or request types.

        Args:
            message: The user message to analyze

        Returns:
            List of context tags
        """
        message_lower = message.lower()
        contexts: set[str] = set()

        for context, keywords in CONTEXT_KEYWORDS.items():
            for keyword in keywords:
                if keyword in message_lower:
                    contexts.add(context)
                    break

        return list(contexts)
