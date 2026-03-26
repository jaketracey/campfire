/**
 * Analytics Internal Routes
 * Internal service-to-service endpoints for relationship analytics,
 * consumed by the orchestrator's relationship_analytics tool.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { getMemoriesRepository } from '../repositories/memories.js';
import { sql } from '../db/pool.js';

// ============================================================================
// Request Schemas
// ============================================================================

const AnalyticsQuerySchema = z.object({
  type: z.enum(['summary', 'emotional_trajectory', 'topic_history', 'interaction_stats']),
  userId: z.string().uuid(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function analyticsInternalRoutes(app: FastifyInstance): Promise<void> {
  const sessionsRepo = getSessionsRepository();
  const memoriesRepo = getMemoriesRepository();

  /**
   * GET /analytics/internal/relationship/:companionId
   * Fetch relationship analytics for a user-companion pair.
   */
  app.get(
    '/internal/relationship/:companionId',
    { preHandler: requireInternalService },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return withSpan('analytics.internal.relationship', async (span) => {
        const { companionId } = request.params as { companionId: string };
        const queryResult = AnalyticsQuerySchema.safeParse(request.query);

        if (!queryResult.success) {
          return reply.status(400).send({
            error: 'Invalid query parameters',
            details: queryResult.error.format(),
          });
        }

        const { type, userId } = queryResult.data;
        span?.setAttribute?.('analytics.type', type);
        span?.setAttribute?.('analytics.companionId', companionId);

        try {
          let data: Record<string, unknown>;

          switch (type) {
            case 'summary':
              data = await getSummary(userId, companionId);
              break;
            case 'emotional_trajectory':
              data = await getEmotionalTrajectory(userId, companionId);
              break;
            case 'topic_history':
              data = await getTopicHistory(userId, companionId);
              break;
            case 'interaction_stats':
              data = await getInteractionStats(userId, companionId);
              break;
          }

          logger.debug(
            { userId, companionId, type },
            'Relationship analytics fetched'
          );

          return reply.send({ data });
        } catch (error) {
          logger.error({ error, userId, companionId, type }, 'Relationship analytics failed');
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });
    }
  );
}

// ============================================================================
// Analytics Query Functions
// ============================================================================

async function getSummary(
  userId: string,
  companionId: string
): Promise<Record<string, unknown>> {
  const db = sql();

  const sessionStats = await db`
    SELECT
      COUNT(*)::int AS total_sessions,
      COALESCE(SUM(turn_count), 0)::int AS total_turns,
      MIN(started_at) AS first_session_at,
      MAX(started_at) AS last_session_at,
      COALESCE(SUM(total_duration_ms), 0)::bigint AS total_duration_ms
    FROM sessions
    WHERE user_id = ${userId} AND companion_id = ${companionId}
  `;

  const memoryStats = await db`
    SELECT COUNT(*)::int AS memory_count
    FROM memories
    WHERE user_id = ${userId}
      AND companion_id = ${companionId}
      AND status = 'active'
  `;

  const stats = sessionStats[0];
  const totalDurationMs = Number(stats?.total_duration_ms ?? 0);

  return {
    totalSessions: stats?.total_sessions ?? 0,
    totalTurns: stats?.total_turns ?? 0,
    firstSessionAt: stats?.first_session_at
      ? new Date(stats.first_session_at).toISOString()
      : null,
    lastSessionAt: stats?.last_session_at
      ? new Date(stats.last_session_at).toISOString()
      : null,
    memoryCount: memoryStats[0]?.memory_count ?? 0,
    totalDurationHours: totalDurationMs / (1000 * 60 * 60),
  };
}

async function getEmotionalTrajectory(
  userId: string,
  companionId: string
): Promise<Record<string, unknown>> {
  const db = sql();

  // Get recent sessions with their metadata (which may contain sentiment data)
  const sessions = await db`
    SELECT
      id, started_at, metadata, turn_count
    FROM sessions
    WHERE user_id = ${userId} AND companion_id = ${companionId}
    ORDER BY started_at DESC
    LIMIT 20
  `;

  const sessionData = sessions.map((s) => {
    const metadata = (s.metadata ?? {}) as Record<string, unknown>;
    return {
      date: s.started_at ? new Date(s.started_at as string).toISOString().split('T')[0] : 'unknown',
      averageSentiment: metadata.averageSentiment ?? metadata.sentiment ?? 'neutral',
      dominantEmotion: metadata.dominantEmotion ?? metadata.emotion ?? 'neutral',
      turnCount: s.turn_count ?? 0,
    };
  });

  // Determine overall trend (simple heuristic)
  let overallTrend = 'stable';
  if (sessionData.length >= 3) {
    const recent = sessionData.slice(0, 3);
    const positiveCount = recent.filter(
      (s) => s.averageSentiment === 'positive' || s.dominantEmotion === 'joy'
    ).length;
    const negativeCount = recent.filter(
      (s) => s.averageSentiment === 'negative' || s.dominantEmotion === 'sadness'
    ).length;
    if (positiveCount >= 2) overallTrend = 'positive';
    else if (negativeCount >= 2) overallTrend = 'declining';
  }

  return {
    sessions: sessionData,
    overallTrend,
  };
}

async function getTopicHistory(
  userId: string,
  companionId: string
): Promise<Record<string, unknown>> {
  const db = sql();

  // Aggregate topics from memory tags
  const topicRows = await db`
    SELECT
      UNNEST(tags) AS tag,
      COUNT(*)::int AS mention_count,
      MAX(created_at) AS last_mentioned
    FROM memories
    WHERE user_id = ${userId}
      AND companion_id = ${companionId}
      AND status = 'active'
      AND tags IS NOT NULL
      AND ARRAY_LENGTH(tags, 1) > 0
    GROUP BY tag
    ORDER BY mention_count DESC
    LIMIT 20
  `;

  const topics = topicRows.map((row) => ({
    name: row.tag,
    mentionCount: row.mention_count,
    lastMentioned: row.last_mentioned
      ? new Date(row.last_mentioned as string).toISOString().split('T')[0]
      : 'unknown',
  }));

  return { topics };
}

async function getInteractionStats(
  userId: string,
  companionId: string
): Promise<Record<string, unknown>> {
  const db = sql();

  const stats = await db`
    SELECT
      COALESCE(AVG(total_duration_ms), 0) AS avg_duration_ms,
      COALESCE(AVG(turn_count), 0) AS avg_turns,
      COALESCE(MAX(total_duration_ms), 0) AS max_duration_ms,
      COUNT(*)::int AS total_sessions,
      MIN(started_at) AS first_session_at,
      MAX(started_at) AS last_session_at
    FROM sessions
    WHERE user_id = ${userId} AND companion_id = ${companionId}
  `;

  const row = stats[0];
  const avgDurationMs = Number(row?.avg_duration_ms ?? 0);
  const maxDurationMs = Number(row?.max_duration_ms ?? 0);
  const totalSessions = row?.total_sessions ?? 0;
  const firstSession = row?.first_session_at ? new Date(row.first_session_at as string) : null;
  const lastSession = row?.last_session_at ? new Date(row.last_session_at as string) : null;

  // Calculate sessions per week
  let sessionsPerWeek = 0;
  if (firstSession && lastSession && totalSessions > 0) {
    const daySpan = Math.max(
      1,
      (lastSession.getTime() - firstSession.getTime()) / (1000 * 60 * 60 * 24)
    );
    sessionsPerWeek = (totalSessions / daySpan) * 7;
  }

  // Get most active hour and day
  const hourStats = await db`
    SELECT
      EXTRACT(HOUR FROM started_at)::int AS hour,
      COUNT(*)::int AS session_count
    FROM sessions
    WHERE user_id = ${userId} AND companion_id = ${companionId}
    GROUP BY hour
    ORDER BY session_count DESC
    LIMIT 1
  `;

  const dayStats = await db`
    SELECT
      TO_CHAR(started_at, 'Day') AS day_name,
      COUNT(*)::int AS session_count
    FROM sessions
    WHERE user_id = ${userId} AND companion_id = ${companionId}
    GROUP BY day_name
    ORDER BY session_count DESC
    LIMIT 1
  `;

  const mostActiveHour = hourStats[0]
    ? `${hourStats[0].hour}:00`
    : 'unknown';
  const mostActiveDay = dayStats[0]
    ? (dayStats[0].day_name as string).trim()
    : 'unknown';

  return {
    avgSessionLengthMinutes: avgDurationMs / (1000 * 60),
    sessionsPerWeek,
    avgTurnsPerSession: Number(row?.avg_turns ?? 0),
    longestSessionMinutes: maxDurationMs / (1000 * 60),
    mostActiveHour,
    mostActiveDay,
  };
}
