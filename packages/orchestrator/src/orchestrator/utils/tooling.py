"""Shared tooling utilities for canonicalization and tool metadata normalization."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import json
import structlog

logger = structlog.get_logger()

ToolAliases = dict[str, str]
ToolArtifact = dict[str, Any]


def _find_tooling_registry_path() -> Path | None:
    marker = Path("packages/shared/src/tooling/tooling-registry.json")
    current = Path(__file__).resolve()
    for parent in [current.parent, *current.parents]:
        candidate = parent / marker
        if candidate.exists():
            return candidate
    return None


def _load_tooling_registry() -> dict[str, Any]:
    path = _find_tooling_registry_path()
    if path is None:
        logger.warning("tooling_registry_not_found", fallback="identity_canonicalization")
        return {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return {}
        return {
            "tool_name_aliases": {},
            "tool_context_version": 1,
            **payload,
        }
    except Exception as err:  # pragma: no cover - defensive parsing fallback
        logger.warning(
            "tooling_registry_load_failed",
            path=str(path),
            error=str(err),
            fallback="identity_canonicalization",
        )
        return {}


TOOLING_REGISTRY = _load_tooling_registry()
TOOL_NAME_ALIASES: ToolAliases = TOOLING_REGISTRY.get("tool_name_aliases", {}) if isinstance(TOOLING_REGISTRY, dict) else {}
TOOL_CONTEXT_SCHEMA_VERSION = int(TOOLING_REGISTRY.get("tool_context_version", 1) or 1)
KNOWN_STATUSES = {"requested", "running", "succeeded", "failed", "cancelled"}
KNOWN_STATUSES_SET = set(KNOWN_STATUSES)


def _to_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _to_string_or_none(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _to_iso_string(value: Any) -> str:
    normalized = _to_string_or_none(value)
    if normalized:
        return normalized

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()

    if isinstance(value, (int, float)):
        if not isinstance(value, bool):
            if value > 10_000_000_000:
                value /= 1000
            try:
                return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
            except (OverflowError, OSError, ValueError):
                pass

    return datetime.now(timezone.utc).isoformat()


def _normalize_status(value: Any) -> str:
    normalized = _to_string_or_none(value)
    if normalized and normalized.lower() in KNOWN_STATUSES_SET:
        return normalized.lower()
    return "requested"


def _coerce_bool(value: Any, fallback: bool) -> bool:
    return value if isinstance(value, bool) else fallback


def _coerce_non_negative_int(value: Any, fallback: int) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return fallback
    value_int = int(value)
    if value_int < 1:
        return 1
    return value_int


def _coerce_non_negative_float(value: Any, fallback: float) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return fallback
    float_value = float(value)
    return float_value if float_value >= 0 else 0.0


def normalize_tool_name(value: str) -> str:
    if not isinstance(value, str):
        return ""
    return TOOL_NAME_ALIASES.get(value.strip().lower(), value.strip().lower())


def normalize_tool_names(values: Iterable[Any] | None) -> list[str]:
    if not values:
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        normalized_name = normalize_tool_name(raw)
        if not normalized_name or normalized_name in seen:
            continue
        seen.add(normalized_name)
        normalized.append(normalized_name)
    return normalized


def normalize_tool_call_artifact(value: Any) -> ToolArtifact | None:
    data = _to_record(value)
    tool_call_id = _to_string_or_none(data.get("tool_call_id")) or _to_string_or_none(data.get("id"))
    if not tool_call_id:
        return None

    name = _to_string_or_none(data.get("name"))
    if not name:
        return None

    status = _normalize_status(data.get("status"))
    return {
        "tool_call_id": tool_call_id,
        "id": tool_call_id,
        "name": normalize_tool_name(name),
        "status": status,
        "arguments": _to_record(data.get("arguments")),
        "attempt_count": _coerce_non_negative_int(data.get("attempt_count"), 1),
        "created_at": _to_iso_string(data.get("created_at")),
        "started_at": _to_string_or_none(data.get("started_at")),
        "ended_at": _to_string_or_none(data.get("ended_at")),
        "error": _to_string_or_none(data.get("error")),
        "metadata": _to_record(data.get("metadata")),
    }


def normalize_tool_result_artifact(value: Any) -> ToolArtifact | None:
    data = _to_record(value)
    tool_call_id = _to_string_or_none(data.get("tool_call_id")) or _to_string_or_none(data.get("id"))
    if not tool_call_id:
        return None

    name = _to_string_or_none(data.get("name"))
    if not name:
        return None

    status = _normalize_status(data.get("status"))
    success = _coerce_bool(data.get("success"), status == "succeeded")

    artifact: ToolArtifact = {
        "tool_call_id": tool_call_id,
        "name": normalize_tool_name(name),
        "status": "succeeded" if success else status,
        "success": success,
        "output": data.get("output"),
        "error": _to_string_or_none(data.get("error")),
        "duration_ms": _coerce_non_negative_float(data.get("duration_ms"), 0.0),
        "cost_usd": _coerce_non_negative_float(data.get("cost_usd"), 0.0),
        "attempt_count": _coerce_non_negative_int(data.get("attempt_count"), 1),
        "created_at": _to_iso_string(data.get("created_at")),
        "started_at": _to_string_or_none(data.get("started_at")),
        "ended_at": _to_string_or_none(data.get("ended_at")),
        "metadata": _to_record(data.get("metadata")),
    }

    return artifact


def normalize_tool_context_metadata(value: Any) -> ToolArtifactDict:
    if not isinstance(value, dict):
        return {
            "tool_context_version": TOOL_CONTEXT_SCHEMA_VERSION,
            "tool_calls": [],
            "tool_results": [],
            "tools_invoked": [],
        }

    raw_calls = value.get("tool_calls")
    raw_results = value.get("tool_results")

    tool_calls = [
        artifact
        for artifact in (
            normalize_tool_call_artifact(item)
            for item in raw_calls
            if isinstance(raw_calls, list)
        )
        if artifact is not None
    ]
    tool_results = [
        artifact
        for artifact in (
            normalize_tool_result_artifact(item)
            for item in raw_results
            if isinstance(raw_results, list)
        )
        if artifact is not None
    ]

    tools_invoked = normalize_tool_names(value.get("tools_invoked"))
    if not tools_invoked:
        tools_invoked = normalize_tool_names(
            call.get("name")
            for call in tool_calls
            if isinstance(call.get("name"), str)
        )

    return {
        "tool_context_version": max(_coerce_non_negative_int(value.get("tool_context_version"), TOOL_CONTEXT_SCHEMA_VERSION), 0) or TOOL_CONTEXT_SCHEMA_VERSION,
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "tooling_unavailable_reason": _to_string_or_none(value.get("tooling_unavailable_reason")),
        "tools_invoked": tools_invoked,
    }


def build_tool_context_metadata(
    tool_calls: list[ToolArtifact] | None = None,
    tool_results: list[ToolArtifact] | None = None,
    tooling_unavailable_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "tool_context_version": TOOL_CONTEXT_SCHEMA_VERSION,
        "tool_calls": tool_calls or [],
        "tool_results": tool_results or [],
        "tooling_unavailable_reason": tooling_unavailable_reason,
        "tools_invoked": normalize_tool_names(
            normalize_tool_name(item["name"]) for item in (tool_calls or []) if isinstance(item, dict) and isinstance(item.get("name"), str)
        ),
    }


class ToolArtifactDict(dict[str, Any]):
    """Typed dict-compatible container for tool metadata."""

    pass
