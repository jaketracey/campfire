"""Tenet retriever for fetching behavioral tenets from gateway."""

import time
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

# Cache configuration
DEFAULT_CACHE_MAX_AGE = 3600.0  # 1 hour stale limit for cached tenets

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
    """Retrieves behavioral tenets from gateway service.

    Includes stale-while-revalidate caching to ensure tenets are available
    even when the gateway is temporarily unreachable.
    """

    def __init__(
        self,
        settings: Settings,
        cache_max_age: float = DEFAULT_CACHE_MAX_AGE,
    ):
        self.settings = settings
        self.gateway_url = settings.gateway_internal_url
        self._client: httpx.AsyncClient | None = None

        # Cache for core tenets per companion
        self._cached_core_tenets: dict[str, list[BehavioralTenet]] = {}
        self._core_cache_timestamps: dict[str, float] = {}

        # Cache for situational tenets (keyed by companion_id + context hash)
        self._cached_situational_tenets: dict[str, list[SituationalTenetMatch]] = {}
        self._situational_cache_timestamps: dict[str, float] = {}

        # Maximum age for stale cache (after this, don't use cached data)
        self._cache_max_age = cache_max_age

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

        Includes stale-while-revalidate caching. On HTTP failure, returns
        cached data if available and not too stale.

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

            # Cache on success
            self._cached_core_tenets[companion_id] = tenets
            self._core_cache_timestamps[companion_id] = time.time()

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
            # Try to return cached data
            return self._get_cached_core_tenets(companion_id)

    def _get_cached_core_tenets(self, companion_id: str) -> list[BehavioralTenet]:
        """Get cached core tenets if available and not too stale.

        Args:
            companion_id: The companion's UUID

        Returns:
            Cached tenets if available, empty list otherwise.
        """
        if companion_id not in self._cached_core_tenets:
            return []

        cache_time = self._core_cache_timestamps.get(companion_id, 0)
        cache_age = time.time() - cache_time

        if cache_age > self._cache_max_age:
            logger.debug(
                "core_tenets_cache_too_stale",
                companion_id=companion_id,
                cache_age_seconds=cache_age,
                max_age=self._cache_max_age,
            )
            return []

        tenets = self._cached_core_tenets[companion_id]
        logger.info(
            "using_cached_core_tenets",
            companion_id=companion_id,
            cache_age_seconds=round(cache_age, 1),
            count=len(tenets),
        )
        return tenets

    async def search_situational_tenets(
        self,
        companion_id: str,
        user_message: str,
        embedding: list[float] | None = None,
        limit: int = 5,
    ) -> list[SituationalTenetMatch]:
        """Search for situational tenets based on message context.

        Includes stale-while-revalidate caching based on context. On HTTP
        failure, returns cached data if available for similar contexts.

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

        # Create cache key from companion_id and sorted contexts
        cache_key = f"{companion_id}:{','.join(sorted(contexts))}"

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

            # Cache on success (only cache context-based searches, not embeddings)
            if not embedding:
                self._cached_situational_tenets[cache_key] = matches
                self._situational_cache_timestamps[cache_key] = time.time()

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
            # Try to return cached data
            return self._get_cached_situational_tenets(cache_key, companion_id)

    def _get_cached_situational_tenets(
        self,
        cache_key: str,
        companion_id: str,
    ) -> list[SituationalTenetMatch]:
        """Get cached situational tenets if available and not too stale.

        Args:
            cache_key: The cache key (companion_id + contexts)
            companion_id: The companion's UUID (for logging)

        Returns:
            Cached tenets if available, empty list otherwise.
        """
        if cache_key not in self._cached_situational_tenets:
            return []

        cache_time = self._situational_cache_timestamps.get(cache_key, 0)
        cache_age = time.time() - cache_time

        if cache_age > self._cache_max_age:
            logger.debug(
                "situational_tenets_cache_too_stale",
                companion_id=companion_id,
                cache_key=cache_key,
                cache_age_seconds=cache_age,
                max_age=self._cache_max_age,
            )
            return []

        tenets = self._cached_situational_tenets[cache_key]
        logger.info(
            "using_cached_situational_tenets",
            companion_id=companion_id,
            cache_key=cache_key,
            cache_age_seconds=round(cache_age, 1),
            count=len(tenets),
        )
        return tenets

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
