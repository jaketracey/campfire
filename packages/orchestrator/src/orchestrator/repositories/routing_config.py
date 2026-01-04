"""Repository for routing configuration from the database."""

from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

import structlog

from orchestrator.db.pool import DatabasePool

logger = structlog.get_logger()


@dataclass
class DBModelConfig:
    """Model configuration from the database."""

    id: str
    model_id: str
    provider: str
    display_name: str
    is_enabled: bool
    context_window: Optional[int]
    max_output_tokens: Optional[int]
    input_cost_per_million: Optional[float]
    output_cost_per_million: Optional[float]
    capabilities: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


@dataclass
class DBRoutingEntry:
    """Routing entry from the database."""

    tier: int
    model_config_id: str
    model_id: str
    provider: str
    weight: int
    max_retries: int
    timeout_ms: int
    is_override: bool


class RoutingConfigRepository:
    """Repository for querying routing configuration from the database."""

    async def get_all_enabled_models(self) -> list[DBModelConfig]:
        """Fetch all enabled models with their provider information.

        Returns:
            list[DBModelConfig]: List of enabled model configurations.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT
                mc.id::text,
                mc.model_id,
                pc.provider,
                mc.display_name,
                mc.is_enabled,
                mc.context_window,
                mc.max_output_tokens,
                mc.input_cost_per_million::float,
                mc.output_cost_per_million::float,
                mc.capabilities,
                mc.metadata
            FROM model_configs mc
            JOIN provider_configs pc ON pc.id = mc.provider_config_id
            WHERE mc.is_enabled = TRUE AND pc.is_enabled = TRUE
            ORDER BY pc.priority ASC, mc.model_id ASC
            """
        )

        models = []
        for row in rows:
            models.append(
                DBModelConfig(
                    id=row["id"],
                    model_id=row["model_id"],
                    provider=row["provider"],
                    display_name=row["display_name"],
                    is_enabled=row["is_enabled"],
                    context_window=row["context_window"],
                    max_output_tokens=row["max_output_tokens"],
                    input_cost_per_million=row["input_cost_per_million"],
                    output_cost_per_million=row["output_cost_per_million"],
                    capabilities=row["capabilities"] or [],
                    metadata=row["metadata"] or {},
                )
            )

        logger.debug("fetched_models_from_db", count=len(models))
        return models

    async def get_effective_routing(
        self,
        companion_id: Optional[UUID],
        use_case: str,
    ) -> list[DBRoutingEntry]:
        """Get effective routing for a companion and use case.

        Uses the database function get_effective_routing which handles
        companion overrides vs platform defaults.

        Args:
            companion_id: Optional companion ID for overrides.
            use_case: The use case type (e.g., 'chat_simple', 'chat_complex').

        Returns:
            list[DBRoutingEntry]: Ordered list of routing entries by tier and weight.
        """
        rows = await DatabasePool.fetch(
            "SELECT * FROM get_effective_routing($1, $2::use_case_type)",
            companion_id,
            use_case,
        )

        entries = []
        for row in rows:
            entries.append(
                DBRoutingEntry(
                    tier=row["tier"],
                    model_config_id=str(row["model_config_id"]),
                    model_id=row["model_id"],
                    provider=row["provider"],
                    weight=row["weight"],
                    max_retries=row["max_retries"],
                    timeout_ms=row["timeout_ms"],
                    is_override=row["is_override"],
                )
            )

        logger.debug(
            "fetched_effective_routing",
            companion_id=str(companion_id) if companion_id else None,
            use_case=use_case,
            entries=len(entries),
        )
        return entries

    async def get_all_routing_rules(self) -> dict[str, list[DBRoutingEntry]]:
        """Get all routing rules grouped by use_case.

        Returns:
            dict[str, list[DBRoutingEntry]]: Routing entries grouped by use case.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT
                rr.use_case::text,
                rr.tier,
                rr.model_config_id::text,
                mc.model_id,
                pc.provider,
                rr.weight,
                rr.max_retries,
                rr.timeout_ms
            FROM routing_rules rr
            JOIN model_configs mc ON mc.id = rr.model_config_id
            JOIN provider_configs pc ON pc.id = mc.provider_config_id
            WHERE rr.is_enabled = TRUE
              AND mc.is_enabled = TRUE
              AND pc.is_enabled = TRUE
            ORDER BY rr.use_case, rr.tier ASC, rr.weight DESC
            """
        )

        result: dict[str, list[DBRoutingEntry]] = {}
        for row in rows:
            use_case = row["use_case"]
            if use_case not in result:
                result[use_case] = []

            result[use_case].append(
                DBRoutingEntry(
                    tier=row["tier"],
                    model_config_id=row["model_config_id"],
                    model_id=row["model_id"],
                    provider=row["provider"],
                    weight=row["weight"],
                    max_retries=row["max_retries"],
                    timeout_ms=row["timeout_ms"],
                    is_override=False,
                )
            )

        logger.debug(
            "fetched_all_routing_rules",
            use_cases=list(result.keys()),
            total_entries=sum(len(v) for v in result.values()),
        )
        return result

    async def get_provider_status(self) -> dict[str, bool]:
        """Get enabled status for all providers.

        Returns:
            dict[str, bool]: Provider name to enabled status.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT provider, is_enabled
            FROM provider_configs
            WHERE category = 'text'
            """
        )

        return {row["provider"]: row["is_enabled"] for row in rows}

    async def get_provider_configs(self) -> list[dict]:
        """Get full provider configuration including API key presence.

        Returns:
            list[dict]: Provider configurations with:
                - provider: Provider name
                - display_name: Human-readable name
                - is_enabled: Whether provider is enabled
                - has_api_key: Whether an API key is configured
                - priority: Provider priority (lower = higher priority)
        """
        rows = await DatabasePool.fetch(
            """
            SELECT
                provider,
                display_name,
                is_enabled,
                api_key_encrypted IS NOT NULL as has_api_key,
                priority
            FROM provider_configs
            WHERE category = 'text'
            ORDER BY priority ASC
            """
        )

        configs = [dict(row) for row in rows]
        logger.debug("fetched_provider_configs", count=len(configs))
        return configs

    async def get_provider_api_key(
        self,
        provider_name: str,
        encryption_key: str,
    ) -> Optional[str]:
        """Get decrypted API key for a provider.

        Args:
            provider_name: The provider name (e.g., 'openai', 'anthropic').
            encryption_key: The encryption key for decrypting the API key.

        Returns:
            The decrypted API key, or None if not configured.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT pgp_sym_decrypt(api_key_encrypted, $1) AS api_key
            FROM provider_configs
            WHERE provider = $2 AND api_key_encrypted IS NOT NULL
            """,
            encryption_key,
            provider_name,
        )

        if rows and rows[0]["api_key"]:
            logger.debug("fetched_provider_api_key", provider=provider_name)
            return rows[0]["api_key"]
        return None
