"""Companion self-knowledge service with TTL caching."""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.models.memory import CompanionSelfKnowledge

logger = structlog.get_logger()


@dataclass
class CachedSelfKnowledge:
    """Cached self-knowledge for a companion."""

    companion_id: UUID
    items: list[CompanionSelfKnowledge]
    loaded_at: float
    ttl_seconds: float = 300.0  # 5 minutes default

    @property
    def is_expired(self) -> bool:
        """Check if the cache has expired."""
        return time.time() - self.loaded_at > self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        """Get the age of the cache in seconds."""
        return time.time() - self.loaded_at


class SelfKnowledgeService:
    """Service for fetching and caching companion self-knowledge.

    Maintains an in-memory cache of self-knowledge per companion with
    TTL-based expiration. Uses stale-while-revalidate pattern - returns
    stale data if gateway fetch fails.
    """

    def __init__(
        self,
        settings: Settings,
        cache_ttl_seconds: float = 300.0,  # 5 minutes
    ):
        """Initialize the self-knowledge service.

        Args:
            settings: Application settings with gateway URL and service key.
            cache_ttl_seconds: Time-to-live for cached self-knowledge.
        """
        self.settings = settings
        self._cache: dict[str, CachedSelfKnowledge] = {}
        self._cache_ttl = cache_ttl_seconds
        self._refresh_locks: dict[str, asyncio.Lock] = {}
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    def _get_lock(self, companion_id: str) -> asyncio.Lock:
        """Get or create a lock for a companion's cache refresh."""
        if companion_id not in self._refresh_locks:
            self._refresh_locks[companion_id] = asyncio.Lock()
        return self._refresh_locks[companion_id]

    async def get_self_knowledge(
        self,
        companion_id: UUID,
        force_refresh: bool = False,
    ) -> list[CompanionSelfKnowledge]:
        """Get cached self-knowledge for a companion.

        Args:
            companion_id: The companion's UUID.
            force_refresh: Force a cache refresh regardless of TTL.

        Returns:
            List of CompanionSelfKnowledge items.
        """
        cache_key = str(companion_id)

        # Check cache first (unless force refresh)
        if not force_refresh and cache_key in self._cache:
            cached = self._cache[cache_key]
            if not cached.is_expired:
                logger.debug(
                    "self_knowledge_cache_hit",
                    companion_id=cache_key,
                    age_seconds=round(cached.age_seconds, 1),
                    item_count=len(cached.items),
                )
                return cached.items

        # Refresh cache
        return await self._refresh_cache(companion_id)

    async def _refresh_cache(
        self,
        companion_id: UUID,
    ) -> list[CompanionSelfKnowledge]:
        """Refresh the cache for a companion."""
        cache_key = str(companion_id)
        lock = self._get_lock(cache_key)

        async with lock:
            # Double-check after acquiring lock
            if cache_key in self._cache and not self._cache[cache_key].is_expired:
                return self._cache[cache_key].items

            try:
                items = await self._fetch_from_gateway(companion_id)

                self._cache[cache_key] = CachedSelfKnowledge(
                    companion_id=companion_id,
                    items=items,
                    loaded_at=time.time(),
                    ttl_seconds=self._cache_ttl,
                )

                logger.debug(
                    "self_knowledge_cache_refreshed",
                    companion_id=cache_key,
                    item_count=len(items),
                )

                return items

            except Exception as e:
                logger.warning(
                    "self_knowledge_fetch_failed",
                    companion_id=cache_key,
                    error=str(e),
                )
                # Stale-while-revalidate: return cached data if available
                if cache_key in self._cache:
                    logger.info(
                        "using_stale_self_knowledge_cache",
                        companion_id=cache_key,
                        stale_age_seconds=round(self._cache[cache_key].age_seconds, 1),
                    )
                    return self._cache[cache_key].items
                return []

    async def _fetch_from_gateway(
        self,
        companion_id: UUID,
    ) -> list[CompanionSelfKnowledge]:
        """Fetch self-knowledge from gateway service."""
        client = await self._get_client()
        url = f"{self.settings.gateway_internal_url}/api/v1/internal/companions/{companion_id}/self-knowledge"

        response = await client.get(
            url,
            headers={
                "X-Internal-Service-Key": self.settings.internal_service_key,
            },
        )
        response.raise_for_status()

        data = response.json()
        items = []

        for item in data.get("items", []):
            items.append(
                CompanionSelfKnowledge(
                    category=item["category"],
                    content=item["content"],
                    confidence=item.get("confidence", 1.0),
                )
            )

        return items

    def invalidate_cache(self, companion_id: UUID) -> None:
        """Invalidate cache for a specific companion."""
        cache_key = str(companion_id)
        if cache_key in self._cache:
            del self._cache[cache_key]
            logger.debug(
                "self_knowledge_cache_invalidated",
                companion_id=cache_key,
            )

    def clear_all_caches(self) -> None:
        """Clear all cached self-knowledge."""
        count = len(self._cache)
        self._cache.clear()
        logger.info("self_knowledge_cache_cleared", entries_cleared=count)

    def get_cache_status(self) -> dict:
        """Get the current cache status for monitoring."""
        return {
            "companions_cached": len(self._cache),
            "cache_ttl_seconds": self._cache_ttl,
            "cache_entries": {
                k: {
                    "item_count": len(v.items),
                    "age_seconds": round(v.age_seconds, 1),
                    "is_expired": v.is_expired,
                }
                for k, v in self._cache.items()
            },
        }

    async def close(self) -> None:
        """Clean up resources."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
