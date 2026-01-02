/**
 * Orchestration Metrics Repository
 * Data access for orchestration metrics snapshots and aggregations
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type { JSONObject, UUID, Timestamp } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from './types.js';
import { wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export type MetricsPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface OrchestrationMetricsSnapshot {
  id: UUID;
  period: MetricsPeriod;
  period_start: Timestamp;
  period_end: Timestamp;
  provider_stats: ProviderStats;
  routing_stats: RoutingStats;
  cost_stats: CostStats;
  safety_stats: SafetyStats;
  performance_stats: PerformanceStats;
  created_at: Timestamp;
}

export interface ProviderStats {
  [provider: string]: {
    requests: number;
    successes: number;
    failures: number;
    avg_latency_ms: number;
    total_tokens: number;
  };
}

export interface RoutingStats {
  by_intent: {
    [intent: string]: {
      count: number;
      avg_confidence: number;
    };
  };
  by_model: {
    [model: string]: {
      count: number;
      avg_latency_ms: number;
    };
  };
  blocked_count: number;
  fallback_count: number;
}

export interface CostStats {
  total_cost_usd: number;
  by_provider: {
    [provider: string]: number;
  };
  by_model: {
    [model: string]: number;
  };
  prompt_tokens: number;
  completion_tokens: number;
}

export interface SafetyStats {
  checks_passed: number;
  checks_failed: number;
  content_flagged: number;
  policy_violations: number;
  by_flag_type: {
    [flagType: string]: number;
  };
}

export interface PerformanceStats {
  total_requests: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  avg_tokens_per_request: number;
}

export interface MetricsSnapshotInsert {
  period: MetricsPeriod;
  period_start: Timestamp;
  period_end: Timestamp;
  provider_stats: ProviderStats;
  routing_stats: RoutingStats;
  cost_stats: CostStats;
  safety_stats: SafetyStats;
  performance_stats: PerformanceStats;
}

export interface MetricsListFilters {
  period?: MetricsPeriod;
  start_date?: Timestamp;
  end_date?: Timestamp;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Repository
// ============================================================================

export class OrchestrationMetricsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Create or update a metrics snapshot
   */
  async upsertSnapshot(
    input: MetricsSnapshotInsert,
    tx?: TransactionContext
  ): Promise<OrchestrationMetricsSnapshot> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO orchestration_metrics_snapshots (
          period, period_start, period_end,
          provider_stats, routing_stats, cost_stats, safety_stats, performance_stats
        )
        VALUES (
          ${input.period},
          ${input.period_start},
          ${input.period_end},
          ${db.json(input.provider_stats as unknown as postgres.JSONValue)},
          ${db.json(input.routing_stats as unknown as postgres.JSONValue)},
          ${db.json(input.cost_stats as unknown as postgres.JSONValue)},
          ${db.json(input.safety_stats as unknown as postgres.JSONValue)},
          ${db.json(input.performance_stats as unknown as postgres.JSONValue)}
        )
        ON CONFLICT (period, period_start) DO UPDATE SET
          period_end = EXCLUDED.period_end,
          provider_stats = EXCLUDED.provider_stats,
          routing_stats = EXCLUDED.routing_stats,
          cost_stats = EXCLUDED.cost_stats,
          safety_stats = EXCLUDED.safety_stats,
          performance_stats = EXCLUDED.performance_stats
        RETURNING *
      `;

      const snapshot = this.mapSnapshot(result[0]!);
      logger.debug({ snapshotId: snapshot.id, period: snapshot.period }, 'Metrics snapshot saved');
      return snapshot;
    } catch (error) {
      throw wrapDatabaseError(error, 'orchestrationMetrics.upsertSnapshot');
    }
  }

  /**
   * Get the latest snapshot for a period
   */
  async getLatestSnapshot(
    period: MetricsPeriod,
    tx?: TransactionContext
  ): Promise<OrchestrationMetricsSnapshot | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM orchestration_metrics_snapshots
      WHERE period = ${period}
      ORDER BY period_start DESC
      LIMIT 1
    `;

    return result[0] ? this.mapSnapshot(result[0]) : null;
  }

  /**
   * List metrics snapshots
   */
  async listSnapshots(
    filters: MetricsListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<OrchestrationMetricsSnapshot>> {
    const db = this.getSql(tx);
    const { period, start_date, end_date, limit = 30, offset = 0 } = filters;

    const result = await db`
      SELECT * FROM orchestration_metrics_snapshots
      WHERE
        (${period ?? null}::varchar IS NULL OR period = ${period ?? null})
        AND (${start_date ?? null}::timestamptz IS NULL OR period_start >= ${start_date ?? null})
        AND (${end_date ?? null}::timestamptz IS NULL OR period_end <= ${end_date ?? null})
      ORDER BY period_start DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapSnapshot(row));

    return { data, hasMore };
  }

  /**
   * Get aggregated metrics for a date range
   */
  async getAggregatedMetrics(
    startDate: Timestamp,
    endDate: Timestamp,
    tx?: TransactionContext
  ): Promise<{
    total_requests: number;
    total_cost_usd: number;
    avg_latency_ms: number;
    safety_pass_rate: number;
    provider_breakdown: ProviderStats;
  }> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        SUM((performance_stats->>'total_requests')::int) AS total_requests,
        SUM((cost_stats->>'total_cost_usd')::numeric) AS total_cost_usd,
        AVG((performance_stats->>'avg_latency_ms')::numeric) AS avg_latency_ms,
        CASE
          WHEN SUM((safety_stats->>'checks_passed')::int + (safety_stats->>'checks_failed')::int) > 0
          THEN SUM((safety_stats->>'checks_passed')::int)::numeric /
               SUM((safety_stats->>'checks_passed')::int + (safety_stats->>'checks_failed')::int)::numeric * 100
          ELSE 100
        END AS safety_pass_rate
      FROM orchestration_metrics_snapshots
      WHERE period_start >= ${startDate} AND period_end <= ${endDate}
    `;

    // Aggregate provider stats
    const providerResult = await db`
      SELECT
        key AS provider,
        SUM((value->>'requests')::int) AS requests,
        SUM((value->>'successes')::int) AS successes,
        SUM((value->>'failures')::int) AS failures,
        AVG((value->>'avg_latency_ms')::numeric) AS avg_latency_ms,
        SUM((value->>'total_tokens')::int) AS total_tokens
      FROM orchestration_metrics_snapshots,
           jsonb_each(provider_stats) AS t(key, value)
      WHERE period_start >= ${startDate} AND period_end <= ${endDate}
      GROUP BY key
    `;

    const provider_breakdown: ProviderStats = {};
    for (const row of providerResult) {
      provider_breakdown[row.provider as string] = {
        requests: Number(row.requests) || 0,
        successes: Number(row.successes) || 0,
        failures: Number(row.failures) || 0,
        avg_latency_ms: Number(row.avg_latency_ms) || 0,
        total_tokens: Number(row.total_tokens) || 0,
      };
    }

    return {
      total_requests: Number(result[0]?.total_requests) || 0,
      total_cost_usd: Number(result[0]?.total_cost_usd) || 0,
      avg_latency_ms: Number(result[0]?.avg_latency_ms) || 0,
      safety_pass_rate: Number(result[0]?.safety_pass_rate) || 100,
      provider_breakdown,
    };
  }

  /**
   * Get cost trend data
   */
  async getCostTrend(
    period: MetricsPeriod,
    limit: number = 30,
    tx?: TransactionContext
  ): Promise<Array<{ date: string; cost: number; tokens: number }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        period_start::date::text AS date,
        (cost_stats->>'total_cost_usd')::numeric AS cost,
        ((cost_stats->>'prompt_tokens')::int + (cost_stats->>'completion_tokens')::int) AS tokens
      FROM orchestration_metrics_snapshots
      WHERE period = ${period}
      ORDER BY period_start DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      date: row.date as string,
      cost: Number(row.cost) || 0,
      tokens: Number(row.tokens) || 0,
    })).reverse();
  }

  /**
   * Get routing distribution data
   */
  async getRoutingDistribution(
    startDate: Timestamp,
    endDate: Timestamp,
    tx?: TransactionContext
  ): Promise<{
    by_intent: Array<{ intent: string; count: number; percentage: number }>;
    by_model: Array<{ model: string; count: number; percentage: number }>;
  }> {
    const db = this.getSql(tx);

    // Get intent distribution
    const intentResult = await db`
      SELECT
        key AS intent,
        SUM((value->>'count')::int) AS count
      FROM orchestration_metrics_snapshots,
           jsonb_each(routing_stats->'by_intent') AS t(key, value)
      WHERE period_start >= ${startDate} AND period_end <= ${endDate}
      GROUP BY key
      ORDER BY count DESC
    `;

    const totalIntents = intentResult.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const by_intent = intentResult.map(row => ({
      intent: row.intent as string,
      count: Number(row.count) || 0,
      percentage: totalIntents > 0 ? ((Number(row.count) || 0) / totalIntents) * 100 : 0,
    }));

    // Get model distribution
    const modelResult = await db`
      SELECT
        key AS model,
        SUM((value->>'count')::int) AS count
      FROM orchestration_metrics_snapshots,
           jsonb_each(routing_stats->'by_model') AS t(key, value)
      WHERE period_start >= ${startDate} AND period_end <= ${endDate}
      GROUP BY key
      ORDER BY count DESC
    `;

    const totalModels = modelResult.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const by_model = modelResult.map(row => ({
      model: row.model as string,
      count: Number(row.count) || 0,
      percentage: totalModels > 0 ? ((Number(row.count) || 0) / totalModels) * 100 : 0,
    }));

    return { by_intent, by_model };
  }

  // ===========================================================================
  // Row Mapper
  // ===========================================================================

  private mapSnapshot(row: Record<string, unknown>): OrchestrationMetricsSnapshot {
    return {
      id: row['id'] as UUID,
      period: row['period'] as MetricsPeriod,
      period_start: row['period_start'] as Date,
      period_end: row['period_end'] as Date,
      provider_stats: row['provider_stats'] as ProviderStats,
      routing_stats: row['routing_stats'] as RoutingStats,
      cost_stats: row['cost_stats'] as CostStats,
      safety_stats: row['safety_stats'] as SafetyStats,
      performance_stats: row['performance_stats'] as PerformanceStats,
      created_at: row['created_at'] as Date,
    };
  }
}

// Singleton instance
let orchestrationMetricsRepositoryInstance: OrchestrationMetricsRepository | null = null;

export function getOrchestrationMetricsRepository(): OrchestrationMetricsRepository {
  if (!orchestrationMetricsRepositoryInstance) {
    orchestrationMetricsRepositoryInstance = new OrchestrationMetricsRepository();
  }
  return orchestrationMetricsRepositoryInstance;
}
