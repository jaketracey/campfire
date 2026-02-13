"""Repository for image routing configuration from the database."""

from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

import structlog

from orchestrator.db.pool import DatabasePool

logger = structlog.get_logger()


@dataclass
class DBImageModelConfig:
    """Image model configuration from the database."""

    id: str
    model_id: str
    provider: str
    display_name: str
    is_enabled: bool
    max_resolution_width: int
    max_resolution_height: int
    supports_ip_adapter: bool
    supports_inpainting: bool
    supports_controlnet: bool
    nsfw_capable: bool
    cost_per_image: float
    avg_generation_time: float
    metadata: dict = field(default_factory=dict)


@dataclass
class DBImageRoutingEntry:
    """Image routing entry from the database."""

    tier: int
    model_config_id: str
    model_id: str
    provider: str
    weight: int
    max_retries: int
    timeout_ms: int
    is_override: bool


class ImageRoutingConfigRepository:
    """Repository for querying image routing configuration from the database."""

    async def get_all_enabled_image_models(self) -> list[DBImageModelConfig]:
        """Fetch all enabled image models with their provider information.

        Returns:
            list[DBImageModelConfig]: List of enabled image model configurations.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT
                mc.id::text,
                mc.model_id,
                pc.provider,
                mc.display_name,
                mc.is_enabled,
                COALESCE(
                    (mc.metadata->>'max_resolution_width')::int,
                    (mc.metadata->'maxResolution'->>0)::int,
                    1024
                ) as max_resolution_width,
                COALESCE(
                    (mc.metadata->>'max_resolution_height')::int,
                    (mc.metadata->'maxResolution'->>1)::int,
                    1024
                ) as max_resolution_height,
                COALESCE(
                    (mc.metadata->>'supports_ip_adapter')::boolean,
                    (mc.metadata->>'supportsIpAdapter')::boolean,
                    (mc.capabilities ? 'ip_adapter'),
                    false
                ) as supports_ip_adapter,
                COALESCE(
                    (mc.metadata->>'supports_inpainting')::boolean,
                    (mc.metadata->>'supportsInpainting')::boolean,
                    (mc.capabilities ? 'inpainting'),
                    false
                ) as supports_inpainting,
                COALESCE(
                    (mc.metadata->>'supports_controlnet')::boolean,
                    (mc.metadata->>'supportsControlnet')::boolean,
                    (mc.capabilities ? 'controlnet'),
                    false
                ) as supports_controlnet,
                COALESCE(
                    (mc.metadata->>'nsfw_capable')::boolean,
                    (mc.metadata->>'nsfwCapable')::boolean,
                    (mc.capabilities ? 'nsfw'),
                    false
                ) as nsfw_capable,
                COALESCE(
                    (mc.metadata->>'cost_per_image')::float,
                    (mc.metadata->>'costPerImage')::float,
                    0.0
                ) as cost_per_image,
                COALESCE(
                    (mc.metadata->>'avg_generation_time')::float,
                    (mc.metadata->>'avgGenerationTime')::float,
                    10.0
                ) as avg_generation_time,
                mc.metadata
            FROM model_configs mc
            JOIN provider_configs pc ON pc.id = mc.provider_config_id
            WHERE mc.is_enabled = TRUE
              AND pc.is_enabled = TRUE
              AND pc.category = 'image'
            ORDER BY pc.priority ASC, mc.model_id ASC
            """
        )

        models = []
        for row in rows:
            models.append(
                DBImageModelConfig(
                    id=row["id"],
                    model_id=row["model_id"],
                    provider=row["provider"],
                    display_name=row["display_name"],
                    is_enabled=row["is_enabled"],
                    max_resolution_width=row["max_resolution_width"],
                    max_resolution_height=row["max_resolution_height"],
                    supports_ip_adapter=row["supports_ip_adapter"],
                    supports_inpainting=row["supports_inpainting"],
                    supports_controlnet=row["supports_controlnet"],
                    nsfw_capable=row["nsfw_capable"],
                    cost_per_image=row["cost_per_image"],
                    avg_generation_time=row["avg_generation_time"],
                    metadata=row["metadata"] or {},
                )
            )

        logger.debug("fetched_image_models_from_db", count=len(models))
        return models

    async def get_effective_image_routing(
        self,
        companion_id: Optional[UUID],
        use_case: str,
    ) -> list[DBImageRoutingEntry]:
        """Get effective image routing for a companion and use case.

        Uses the database function get_effective_routing which handles
        companion overrides vs platform defaults, filtered to image category.

        Args:
            companion_id: Optional companion ID for overrides.
            use_case: The image use case type (e.g., 'image_generation', 'image_anchor').

        Returns:
            list[DBImageRoutingEntry]: Ordered list of routing entries by tier and weight.
        """
        # First try the dedicated image routing function if it exists
        try:
            rows = await DatabasePool.fetch(
                """
                SELECT r.*, pc.category
                FROM get_effective_routing($1, $2::use_case_type) r
                JOIN model_configs mc ON mc.model_id = r.model_id
                JOIN provider_configs pc ON pc.id = mc.provider_config_id
                WHERE pc.category = 'image'
                """,
                companion_id,
                use_case,
            )
        except Exception:
            # Fall back to querying routing_rules directly
            rows = await DatabasePool.fetch(
                """
                SELECT
                    rr.tier,
                    rr.model_config_id::text,
                    mc.model_id,
                    pc.provider,
                    rr.weight,
                    rr.max_retries,
                    rr.timeout_ms,
                    false as is_override
                FROM routing_rules rr
                JOIN model_configs mc ON mc.id = rr.model_config_id
                JOIN provider_configs pc ON pc.id = mc.provider_config_id
                WHERE rr.use_case = $1::use_case_type
                  AND rr.is_enabled = TRUE
                  AND mc.is_enabled = TRUE
                  AND pc.is_enabled = TRUE
                  AND pc.category = 'image'
                ORDER BY rr.tier ASC, rr.weight DESC
                """,
                use_case,
            )

        entries = []
        for row in rows:
            entries.append(
                DBImageRoutingEntry(
                    tier=row["tier"],
                    model_config_id=str(row["model_config_id"]),
                    model_id=row["model_id"],
                    provider=row["provider"],
                    weight=row["weight"],
                    max_retries=row["max_retries"],
                    timeout_ms=row["timeout_ms"],
                    is_override=row.get("is_override", False),
                )
            )

        logger.debug(
            "fetched_effective_image_routing",
            companion_id=str(companion_id) if companion_id else None,
            use_case=use_case,
            entries=len(entries),
        )
        return entries

    async def get_all_image_routing_rules(self) -> dict[str, list[DBImageRoutingEntry]]:
        """Get all image routing rules grouped by use_case.

        Returns:
            dict[str, list[DBImageRoutingEntry]]: Routing entries grouped by use case.
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
              AND pc.category = 'image'
            ORDER BY rr.use_case, rr.tier ASC, rr.weight DESC
            """
        )

        result: dict[str, list[DBImageRoutingEntry]] = {}
        for row in rows:
            use_case = row["use_case"]
            if use_case not in result:
                result[use_case] = []

            result[use_case].append(
                DBImageRoutingEntry(
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
            "fetched_all_image_routing_rules",
            use_cases=list(result.keys()),
            total_entries=sum(len(v) for v in result.values()),
        )
        return result

    async def get_image_provider_status(self) -> dict[str, bool]:
        """Get enabled status for all image providers.

        Returns:
            dict[str, bool]: Provider name to enabled status.
        """
        rows = await DatabasePool.fetch(
            """
            SELECT provider, is_enabled
            FROM provider_configs
            WHERE category = 'image'
            """
        )

        return {row["provider"]: row["is_enabled"] for row in rows}

    async def get_image_provider_configs(self) -> list[dict]:
        """Get full image provider configuration including API key presence.

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
                priority,
                api_base_url
            FROM provider_configs
            WHERE category = 'image'
            ORDER BY priority ASC
            """
        )

        configs = [dict(row) for row in rows]
        logger.debug("fetched_image_provider_configs", count=len(configs))
        return configs
