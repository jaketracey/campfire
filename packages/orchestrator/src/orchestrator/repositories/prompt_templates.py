"""Repository for prompt templates and settings from the database."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import structlog

from orchestrator.db.pool import DatabasePool

logger = structlog.get_logger()


@dataclass(frozen=True)
class DBPromptTemplate:
    prompt_key: str
    version: str
    companion_id: UUID | None
    template: str
    variables: list[str]
    description: str


class PromptTemplatesRepository:
    """Repository for querying prompt templates."""

    async def get_default_version(self) -> str:
        rows = await DatabasePool.fetch(
            """
            SELECT default_version
            FROM prompt_settings
            WHERE id = 1
            """
        )
        if not rows:
            return "1.0.0"
        return str(rows[0]["default_version"])

    async def list_versions(self) -> list[str]:
        rows = await DatabasePool.fetch(
            """
            SELECT DISTINCT version
            FROM prompt_templates
            WHERE companion_id IS NULL
            ORDER BY version DESC
            """
        )
        return [str(r["version"]) for r in rows]

    async def get_all_templates(self) -> list[DBPromptTemplate]:
        rows = await DatabasePool.fetch(
            """
            SELECT
              pt.prompt_key,
              pt.version,
              pt.companion_id,
              pt.template,
              pt.variables,
              COALESCE(pd.description, '') AS description
            FROM prompt_templates pt
            JOIN prompt_definitions pd ON pd.key = pt.prompt_key
            ORDER BY pt.version ASC, pt.prompt_key ASC
            """
        )

        templates: list[DBPromptTemplate] = []
        for row in rows:
            templates.append(
                DBPromptTemplate(
                    prompt_key=str(row["prompt_key"]),
                    version=str(row["version"]),
                    companion_id=row["companion_id"],
                    template=str(row["template"]),
                    variables=list(row["variables"] or []),
                    description=str(row["description"] or ""),
                )
            )

        logger.debug("fetched_prompt_templates_from_db", count=len(templates))
        return templates

    async def get_effective_template(
        self,
        prompt_key: str,
        version: str,
        companion_id: UUID | None,
    ) -> DBPromptTemplate | None:
        """Get effective template for a prompt key and version, with companion override."""
        rows = await DatabasePool.fetch(
            """
            SELECT
              pt.prompt_key,
              pt.version,
              pt.companion_id,
              pt.template,
              pt.variables,
              COALESCE(pd.description, '') AS description
            FROM prompt_templates pt
            JOIN prompt_definitions pd ON pd.key = pt.prompt_key
            WHERE pt.prompt_key = $1
              AND pt.version = $2
              AND (
                (pt.companion_id = $3)
                OR (pt.companion_id IS NULL)
              )
            ORDER BY
              CASE WHEN pt.companion_id IS NULL THEN 1 ELSE 0 END
            LIMIT 1
            """,
            prompt_key,
            version,
            companion_id,
        )
        if not rows:
            return None
        row: dict[str, Any] = rows[0]
        return DBPromptTemplate(
            prompt_key=str(row["prompt_key"]),
            version=str(row["version"]),
            companion_id=row["companion_id"],
            template=str(row["template"]),
            variables=list(row["variables"] or []),
            description=str(row["description"] or ""),
        )

