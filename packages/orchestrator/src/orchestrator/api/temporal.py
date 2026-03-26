"""Temporal context API endpoints for debugging and admin."""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query

from orchestrator.services.temporal_context import TemporalContextService

logger = structlog.get_logger()

router = APIRouter(prefix="/temporal", tags=["temporal"])

_service = TemporalContextService()


@router.get("/context/{companion_id}/{user_id}")
async def get_temporal_context(
    companion_id: UUID,
    user_id: UUID,
    timezone: str = Query(default="UTC", description="IANA timezone for the user"),
) -> dict[str, Any]:
    """Get temporal context for a user-companion pair.

    Useful for debugging and admin inspection of what temporal context
    the companion receives during conversation.
    """
    try:
        ctx = await _service.build_temporal_context(
            user_id=user_id,
            companion_id=companion_id,
            user_timezone=timezone,
        )

        return {
            "current_time_utc": ctx.current_time_utc.isoformat(),
            "user_local_time": ctx.user_local_time.isoformat(),
            "user_timezone": ctx.user_timezone,
            "time_of_day": ctx.time_of_day.value,
            "day_of_week": ctx.day_of_week,
            "is_weekend": ctx.is_weekend,
            "time_since_last_interaction": str(ctx.time_since_last_interaction) if ctx.time_since_last_interaction else None,
            "time_since_last_interaction_human": ctx.time_since_last_interaction_human,
            "last_session_ended_at": ctx.last_session_ended_at.isoformat() if ctx.last_session_ended_at else None,
            "total_sessions": ctx.total_sessions,
            "avg_session_duration_minutes": round(ctx.avg_session_duration_minutes, 1),
            "typical_active_hours": ctx.typical_active_hours,
            "is_unusual_time": ctx.is_unusual_time,
            "streak_days": ctx.streak_days,
            "longest_absence_days": ctx.longest_absence_days,
            "days_since_first_interaction": ctx.days_since_first_interaction,
            "is_anniversary": ctx.is_anniversary,
            "is_milestone": ctx.is_milestone,
            "milestone_description": ctx.milestone_description,
        }

    except Exception as e:
        logger.exception(
            "temporal_context_error",
            user_id=str(user_id),
            companion_id=str(companion_id),
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=f"Failed to build temporal context: {str(e)}")
