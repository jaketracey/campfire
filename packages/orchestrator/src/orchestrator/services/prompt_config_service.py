"""Prompt configuration service (DB-backed) with caching."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import structlog

from orchestrator.prompts.manager import PromptManager, PromptTemplate
from orchestrator.repositories.prompt_templates import PromptTemplatesRepository

logger = structlog.get_logger()


@dataclass
class CachedPromptConfig:
    default_version: str
    versions: list[str]
    loaded_at: float
    ttl_seconds: float = 60.0

    @property
    def is_expired(self) -> bool:
        return time.time() - self.loaded_at > self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        return time.time() - self.loaded_at


class PromptConfigService:
    """Loads prompt templates from the database and registers them into PromptManager."""

    def __init__(self, prompt_manager: PromptManager, cache_ttl_seconds: float = 60.0) -> None:
        self._repo = PromptTemplatesRepository()
        self._prompt_manager = prompt_manager
        self._cache: CachedPromptConfig | None = None
        self._cache_ttl = cache_ttl_seconds
        self._refresh_lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        logger.info("initializing_prompt_config_service")
        await self._refresh()
        self._initialized = True
        logger.info(
            "prompt_config_service_initialized",
            default_version=self._cache.default_version if self._cache else None,
            versions=self._cache.versions if self._cache else None,
        )

    async def refresh_if_needed(self) -> None:
        if self._cache is None or self._cache.is_expired:
            await self._refresh()

    async def force_refresh(self) -> None:
        await self._refresh()

    async def _refresh(self) -> None:
        async with self._refresh_lock:
            default_version = await self._repo.get_default_version()
            versions = await self._repo.list_versions()
            templates = await self._repo.get_all_templates()

            # Build a new PromptManager in-memory template map by re-registering templates.
            # PromptManager doesn't support "clear", so callers should create it empty when used with DB.
            loaded_versions: set[str] = set()
            loaded_templates = 0

            for t in templates:
                name = t.prompt_key
                if t.companion_id is not None:
                    name = f"{name}::companion:{t.companion_id}"

                self._prompt_manager.register_template(
                    PromptTemplate(
                        name=name,
                        version=t.version,
                        template=t.template,
                        description=t.description,
                        variables=t.variables,
                    )
                )
                loaded_versions.add(t.version)
                loaded_templates += 1

            if default_version not in loaded_versions:
                raise RuntimeError(
                    f"Default prompt version '{default_version}' not found in database prompt templates"
                )

            self._prompt_manager.set_default_version(default_version)

            self._cache = CachedPromptConfig(
                default_version=default_version,
                versions=versions,
                loaded_at=time.time(),
                ttl_seconds=self._cache_ttl,
            )

            logger.debug(
                "prompt_config_cache_refreshed",
                templates_loaded=loaded_templates,
                versions_loaded=sorted(loaded_versions),
                default_version=default_version,
            )

    def get_cache_status(self) -> dict:
        if self._cache is None:
            return {
                "initialized": self._initialized,
                "cache_loaded": False,
                "default_version": None,
                "versions": [],
            }
        return {
            "initialized": self._initialized,
            "cache_loaded": True,
            "cache_age_seconds": self._cache.age_seconds,
            "cache_expired": self._cache.is_expired,
            "default_version": self._cache.default_version,
            "versions": self._cache.versions,
        }

