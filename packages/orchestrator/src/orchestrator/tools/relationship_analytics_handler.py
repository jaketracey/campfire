"""Relationship analytics tool handler."""

import time
from typing import Any

import httpx
import structlog

from orchestrator.config import Settings
from orchestrator.events.emitter import EventEmitter
from orchestrator.models.tools import ToolCall, ToolResult
from orchestrator.tools.base import ToolHandler

logger = structlog.get_logger()

VALID_ANALYSIS_TYPES = {"summary", "emotional_trajectory", "topic_history", "interaction_stats"}


class RelationshipAnalyticsHandler(ToolHandler):
    """Handler for querying relationship analytics between a companion and user."""

    def __init__(
        self,
        settings: Settings,
        event_emitter: EventEmitter,
        http_client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.event_emitter = event_emitter
        self.http_client = http_client

    @property
    def name(self) -> str:
        return "relationship_analytics"

    def validate_arguments(self, arguments: dict[str, Any]) -> tuple[bool, str | None]:
        """Validate analytics arguments."""
        companion_id = arguments.get("companion_id")
        if not companion_id or not isinstance(companion_id, str):
            return False, "companion_id must be a non-empty string"

        analysis_type = arguments.get("analysis_type")
        if analysis_type not in VALID_ANALYSIS_TYPES:
            return False, (
                f"analysis_type must be one of: {', '.join(sorted(VALID_ANALYSIS_TYPES))}"
            )

        return True, None

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute relationship analytics query."""
        start_time = time.time()

        try:
            companion_id = tool_call.arguments["companion_id"]
            analysis_type = tool_call.arguments["analysis_type"]
            user_id = str(tool_call.user_id)

            data = await self._fetch_analytics(user_id, companion_id, analysis_type)
            duration_ms = (time.time() - start_time) * 1000

            if data is None:
                output = (
                    f"No relationship data found for companion {companion_id}. "
                    "This might mean there haven't been any conversations yet."
                )
            else:
                output = self._format_output(analysis_type, data)

            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=True,
                output=output,
                duration_ms=duration_ms,
                metadata={
                    "analysis_type": analysis_type,
                    "companion_id": companion_id,
                },
            )

        except Exception as e:
            logger.exception("relationship_analytics_failed", error=str(e))
            duration_ms = (time.time() - start_time) * 1000
            return ToolResult(
                tool_call_id=tool_call.id,
                name=self.name,
                success=False,
                error=f"Relationship analytics failed: {str(e)}",
                duration_ms=duration_ms,
            )

    async def _fetch_analytics(
        self,
        user_id: str,
        companion_id: str,
        analysis_type: str,
    ) -> dict[str, Any] | None:
        """Fetch analytics data from the gateway internal endpoint."""
        try:
            response = await self.http_client.get(
                f"{self.settings.gateway_internal_url}/api/v1/analytics/internal/relationship/{companion_id}",
                params={"type": analysis_type, "userId": user_id},
                headers={
                    "X-Internal-Service-Key": self.settings.internal_service_key,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            data: dict[str, Any] | None = result.get("data")
            return data

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise
        except Exception as e:
            logger.warning("analytics_fetch_failed", error=str(e))
            raise

    def _format_output(self, analysis_type: str, data: dict[str, Any]) -> str:
        """Format analytics data as natural language for the LLM."""
        if analysis_type == "summary":
            return self._format_summary(data)
        elif analysis_type == "emotional_trajectory":
            return self._format_emotional_trajectory(data)
        elif analysis_type == "topic_history":
            return self._format_topic_history(data)
        elif analysis_type == "interaction_stats":
            return self._format_interaction_stats(data)
        return str(data)

    def _format_summary(self, data: dict[str, Any]) -> str:
        """Format relationship summary."""
        total_sessions = data.get("totalSessions", 0)
        total_turns = data.get("totalTurns", 0)
        first_session = data.get("firstSessionAt", "unknown")
        last_session = data.get("lastSessionAt", "unknown")
        memory_count = data.get("memoryCount", 0)
        total_duration_hours = data.get("totalDurationHours", 0)

        lines = [
            "Relationship Summary:",
            f"- Total conversations: {total_sessions}",
            f"- Total message exchanges: {total_turns}",
            f"- First conversation: {first_session}",
            f"- Most recent conversation: {last_session}",
            f"- Memories stored: {memory_count}",
            f"- Total time spent together: {total_duration_hours:.1f} hours",
        ]
        return "\n".join(lines)

    def _format_emotional_trajectory(self, data: dict[str, Any]) -> str:
        """Format emotional trajectory data."""
        sessions = data.get("sessions", [])
        if not sessions:
            return "No emotional trajectory data available yet."

        lines = ["Emotional Trajectory (recent sessions):"]
        for session in sessions:
            date = session.get("date", "unknown")
            sentiment = session.get("averageSentiment", "neutral")
            dominant_emotion = session.get("dominantEmotion", "neutral")
            lines.append(f"- {date}: sentiment={sentiment}, emotion={dominant_emotion}")

        overall_trend = data.get("overallTrend", "stable")
        lines.append(f"\nOverall emotional trend: {overall_trend}")
        return "\n".join(lines)

    def _format_topic_history(self, data: dict[str, Any]) -> str:
        """Format topic history data."""
        topics = data.get("topics", [])
        if not topics:
            return "No topic history data available yet."

        lines = ["Most Discussed Topics:"]
        for topic in topics:
            name = topic.get("name", "unknown")
            count = topic.get("mentionCount", 0)
            last_mentioned = topic.get("lastMentioned", "")
            lines.append(f"- {name}: mentioned {count} times (last: {last_mentioned})")

        return "\n".join(lines)

    def _format_interaction_stats(self, data: dict[str, Any]) -> str:
        """Format interaction statistics."""
        avg_session_length = data.get("avgSessionLengthMinutes", 0)
        sessions_per_week = data.get("sessionsPerWeek", 0)
        most_active_hour = data.get("mostActiveHour", "unknown")
        most_active_day = data.get("mostActiveDay", "unknown")
        avg_turns_per_session = data.get("avgTurnsPerSession", 0)
        longest_session_minutes = data.get("longestSessionMinutes", 0)

        lines = [
            "Interaction Statistics:",
            f"- Average session length: {avg_session_length:.1f} minutes",
            f"- Sessions per week: {sessions_per_week:.1f}",
            f"- Average messages per session: {avg_turns_per_session:.0f}",
            f"- Longest session: {longest_session_minutes:.0f} minutes",
            f"- Most active time: {most_active_hour}",
            f"- Most active day: {most_active_day}",
        ]
        return "\n".join(lines)
