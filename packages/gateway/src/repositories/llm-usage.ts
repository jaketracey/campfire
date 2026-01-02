/**
 * LLM Usage Repository
 * Data access for LLM usage tracking, cost management, and budget enforcement
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { UUID, Timestamp } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from './types.js';
import { wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface LLMUsageEvent {
  id: UUID;
  user_id: UUID;
  session_id: UUID | null;
  companion_id: UUID | null;
  turn_id: UUID | null;
  trace_id: UUID | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  finish_reason: string | null;
  request_type: string;
  tool_calls: number;
  stream_mode: boolean;
  request_started_at: Timestamp;
  request_completed_at: Timestamp;
  billing_period: string;
  created_at: Timestamp;
}

export interface LLMUsageEventInsert {
  user_id: UUID;
  session_id?: UUID | null;
  companion_id?: UUID | null;
  turn_id?: UUID | null;
  trace_id?: UUID | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms?: number | null;
  finish_reason?: string | null;
  request_type?: string;
  tool_calls?: number;
  stream_mode?: boolean;
  request_started_at: Timestamp;
  request_completed_at: Timestamp;
}

export interface UserCostBudget {
  id: UUID;
  user_id: UUID;
  daily_limit_usd: number | null;
  monthly_limit_usd: number | null;
  daily_usage_usd: number;
  monthly_usage_usd: number;
  daily_reset_at: Timestamp;
  monthly_reset_at: Timestamp;
  alert_threshold_percent: number;
  last_alert_sent_at: Timestamp | null;
  is_blocked: boolean;
  blocked_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserCostSummary {
  total_cost_usd: number;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_cost_per_request: number;
  top_model: string | null;
  top_companion_id: UUID | null;
}

export interface PlatformCostSummary {
  total_cost_usd: number;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  unique_users: number;
  avg_cost_per_user: number;
  cost_by_provider: Record<string, number>;
  cost_by_model: Record<string, number>;
}

export interface DailyAggregate {
  id: UUID;
  date: string;
  user_id: UUID | null;
  provider: string | null;
  model: string | null;
  companion_id: UUID | null;
  request_count: number;
  input_tokens_total: number;
  output_tokens_total: number;
  total_tokens: number;
  cost_usd_total: number;
  latency_avg_ms: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
}

export interface CostAlert {
  id: UUID;
  user_id: UUID;
  alert_type: 'threshold' | 'limit_reached' | 'anomaly';
  threshold_percent: number | null;
  current_usage_usd: number;
  limit_usd: number | null;
  period: 'daily' | 'monthly';
  notified_via: string[];
  acknowledged_at: Timestamp | null;
  created_at: Timestamp;
}

export interface UsageRecordResult {
  usage_id: UUID;
  daily_usage: number;
  monthly_usage: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  is_over_limit: boolean;
}

export interface UsageListFilters {
  user_id?: UUID;
  session_id?: UUID;
  companion_id?: UUID;
  provider?: string;
  model?: string;
  billing_period?: string;
  start_date?: Timestamp;
  end_date?: Timestamp;
  limit?: number;
  offset?: number;
}

export interface CostTrendPoint {
  date: string;
  cost_usd: number;
  request_count: number;
  tokens: number;
}

// ============================================================================
// Repository
// ============================================================================

export class LLMUsageRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Usage Recording
  // ===========================================================================

  /**
   * Record LLM usage and update user budget atomically
   * Uses the database function for atomic operation
   */
  async recordUsage(
    input: LLMUsageEventInsert,
    tx?: TransactionContext
  ): Promise<UsageRecordResult> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        SELECT * FROM record_llm_usage(
          ${input.user_id},
          ${input.session_id ?? null},
          ${input.companion_id ?? null},
          ${input.turn_id ?? null},
          ${input.trace_id ?? null},
          ${input.provider},
          ${input.model},
          ${input.input_tokens},
          ${input.output_tokens},
          ${input.cost_usd},
          ${input.latency_ms ?? null},
          ${input.finish_reason ?? null},
          ${input.request_type ?? 'chat'},
          ${input.tool_calls ?? 0},
          ${input.stream_mode ?? false},
          ${input.request_started_at},
          ${input.request_completed_at}
        )
      `;

      const row = result[0]!;
      logger.debug({
        usageId: row.usage_id,
        userId: input.user_id,
        costUsd: input.cost_usd,
      }, 'LLM usage recorded');

      return {
        usage_id: row.usage_id as UUID,
        daily_usage: Number(row.daily_usage) || 0,
        monthly_usage: Number(row.monthly_usage) || 0,
        daily_limit: row.daily_limit ? Number(row.daily_limit) : null,
        monthly_limit: row.monthly_limit ? Number(row.monthly_limit) : null,
        is_over_limit: Boolean(row.is_over_limit),
      };
    } catch (error) {
      throw wrapDatabaseError(error, 'llmUsage.recordUsage');
    }
  }

  /**
   * List usage events with filters
   */
  async listUsageEvents(
    filters: UsageListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<LLMUsageEvent>> {
    const db = this.getSql(tx);
    const { limit = 50, offset = 0 } = filters;

    const result = await db`
      SELECT * FROM llm_usage_events
      WHERE
        (${filters.user_id ?? null}::uuid IS NULL OR user_id = ${filters.user_id ?? null})
        AND (${filters.session_id ?? null}::uuid IS NULL OR session_id = ${filters.session_id ?? null})
        AND (${filters.companion_id ?? null}::uuid IS NULL OR companion_id = ${filters.companion_id ?? null})
        AND (${filters.provider ?? null}::varchar IS NULL OR provider = ${filters.provider ?? null})
        AND (${filters.model ?? null}::varchar IS NULL OR model = ${filters.model ?? null})
        AND (${filters.billing_period ?? null}::varchar IS NULL OR billing_period = ${filters.billing_period ?? null})
        AND (${filters.start_date ?? null}::timestamptz IS NULL OR created_at >= ${filters.start_date ?? null})
        AND (${filters.end_date ?? null}::timestamptz IS NULL OR created_at <= ${filters.end_date ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapUsageEvent(row));

    return { data, hasMore };
  }

  // ===========================================================================
  // Cost Summaries
  // ===========================================================================

  /**
   * Get user cost summary using database function
   */
  async getUserCostSummary(
    userId: UUID,
    days: number = 30,
    tx?: TransactionContext
  ): Promise<UserCostSummary> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM get_user_cost_summary(${userId}, ${days})
    `;

    const row = result[0];
    return {
      total_cost_usd: Number(row?.total_cost_usd) || 0,
      total_requests: Number(row?.total_requests) || 0,
      total_input_tokens: Number(row?.total_input_tokens) || 0,
      total_output_tokens: Number(row?.total_output_tokens) || 0,
      avg_cost_per_request: Number(row?.avg_cost_per_request) || 0,
      top_model: row?.top_model as string | null,
      top_companion_id: row?.top_companion_id as UUID | null,
    };
  }

  /**
   * Get platform-wide cost summary (admin dashboard)
   */
  async getPlatformCostSummary(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<PlatformCostSummary> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM get_platform_cost_summary(${days})
    `;

    const row = result[0];
    return {
      total_cost_usd: Number(row?.total_cost_usd) || 0,
      total_requests: Number(row?.total_requests) || 0,
      total_input_tokens: Number(row?.total_input_tokens) || 0,
      total_output_tokens: Number(row?.total_output_tokens) || 0,
      unique_users: Number(row?.unique_users) || 0,
      avg_cost_per_user: Number(row?.avg_cost_per_user) || 0,
      cost_by_provider: (row?.cost_by_provider as Record<string, number>) || {},
      cost_by_model: (row?.cost_by_model as Record<string, number>) || {},
    };
  }

  /**
   * Get cost trend over time
   */
  async getCostTrend(
    days: number = 30,
    userId?: UUID,
    tx?: TransactionContext
  ): Promise<CostTrendPoint[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        created_at::date::text AS date,
        SUM(cost_usd) AS cost_usd,
        COUNT(*) AS request_count,
        SUM(input_tokens + output_tokens) AS tokens
      FROM llm_usage_events
      WHERE
        created_at >= NOW() - (${days} || ' days')::interval
        AND (${userId ?? null}::uuid IS NULL OR user_id = ${userId ?? null})
      GROUP BY created_at::date
      ORDER BY date ASC
    `;

    return result.map(row => ({
      date: row.date as string,
      cost_usd: Number(row.cost_usd) || 0,
      request_count: Number(row.request_count) || 0,
      tokens: Number(row.tokens) || 0,
    }));
  }

  /**
   * Get top users by cost
   */
  async getTopUsersByCost(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ user_id: UUID; total_cost: number; request_count: number }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        user_id,
        SUM(cost_usd) AS total_cost,
        COUNT(*) AS request_count
      FROM llm_usage_events
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY user_id
      ORDER BY total_cost DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      user_id: row.user_id as UUID,
      total_cost: Number(row.total_cost) || 0,
      request_count: Number(row.request_count) || 0,
    }));
  }

  /**
   * Get cost breakdown by provider
   */
  async getCostByProvider(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<Array<{ provider: string; cost: number; requests: number; tokens: number }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        provider,
        SUM(cost_usd) AS cost,
        COUNT(*) AS requests,
        SUM(input_tokens + output_tokens) AS tokens
      FROM llm_usage_events
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY provider
      ORDER BY cost DESC
    `;

    return result.map(row => ({
      provider: row.provider as string,
      cost: Number(row.cost) || 0,
      requests: Number(row.requests) || 0,
      tokens: Number(row.tokens) || 0,
    }));
  }

  /**
   * Get cost breakdown by model
   */
  async getCostByModel(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ model: string; provider: string; cost: number; requests: number }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        model,
        provider,
        SUM(cost_usd) AS cost,
        COUNT(*) AS requests
      FROM llm_usage_events
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY model, provider
      ORDER BY cost DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      model: row.model as string,
      provider: row.provider as string,
      cost: Number(row.cost) || 0,
      requests: Number(row.requests) || 0,
    }));
  }

  // ===========================================================================
  // Budget Management
  // ===========================================================================

  /**
   * Get user's cost budget
   */
  async getUserBudget(
    userId: UUID,
    tx?: TransactionContext
  ): Promise<UserCostBudget | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM user_cost_budgets WHERE user_id = ${userId}
    `;

    return result[0] ? this.mapBudget(result[0]) : null;
  }

  /**
   * Update user's cost budget limits
   */
  async updateUserBudget(
    userId: UUID,
    updates: {
      daily_limit_usd?: number | null;
      monthly_limit_usd?: number | null;
      alert_threshold_percent?: number;
    },
    tx?: TransactionContext
  ): Promise<UserCostBudget> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO user_cost_budgets (user_id, daily_limit_usd, monthly_limit_usd, alert_threshold_percent)
      VALUES (
        ${userId},
        ${updates.daily_limit_usd ?? null},
        ${updates.monthly_limit_usd ?? null},
        ${updates.alert_threshold_percent ?? 80}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        daily_limit_usd = COALESCE(${updates.daily_limit_usd ?? null}, user_cost_budgets.daily_limit_usd),
        monthly_limit_usd = COALESCE(${updates.monthly_limit_usd ?? null}, user_cost_budgets.monthly_limit_usd),
        alert_threshold_percent = COALESCE(${updates.alert_threshold_percent ?? null}, user_cost_budgets.alert_threshold_percent),
        updated_at = NOW()
      RETURNING *
    `;

    return this.mapBudget(result[0]!);
  }

  /**
   * Block or unblock a user from LLM usage
   */
  async setUserBlocked(
    userId: UUID,
    blocked: boolean,
    reason?: string,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE user_cost_budgets
      SET
        is_blocked = ${blocked},
        blocked_reason = ${blocked ? (reason ?? 'Budget limit exceeded') : null},
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  }

  /**
   * Check if user is blocked
   */
  async isUserBlocked(userId: UUID, tx?: TransactionContext): Promise<boolean> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT is_blocked FROM user_cost_budgets WHERE user_id = ${userId}
    `;

    return result[0]?.is_blocked === true;
  }

  // ===========================================================================
  // Alerts
  // ===========================================================================

  /**
   * Create a cost alert
   */
  async createAlert(
    alert: {
      user_id: UUID;
      alert_type: 'threshold' | 'limit_reached' | 'anomaly';
      threshold_percent?: number;
      current_usage_usd: number;
      limit_usd?: number;
      period: 'daily' | 'monthly';
      notified_via?: string[];
    },
    tx?: TransactionContext
  ): Promise<CostAlert> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO cost_alerts (
        user_id, alert_type, threshold_percent, current_usage_usd, limit_usd, period, notified_via
      )
      VALUES (
        ${alert.user_id},
        ${alert.alert_type},
        ${alert.threshold_percent ?? null},
        ${alert.current_usage_usd},
        ${alert.limit_usd ?? null},
        ${alert.period},
        ${db.json(alert.notified_via ?? [])}
      )
      RETURNING *
    `;

    return this.mapAlert(result[0]!);
  }

  /**
   * Get unacknowledged alerts for a user
   */
  async getUnacknowledgedAlerts(
    userId: UUID,
    tx?: TransactionContext
  ): Promise<CostAlert[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM cost_alerts
      WHERE user_id = ${userId} AND acknowledged_at IS NULL
      ORDER BY created_at DESC
    `;

    return result.map(row => this.mapAlert(row));
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: UUID, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE cost_alerts SET acknowledged_at = NOW() WHERE id = ${alertId}
    `;
  }

  // ===========================================================================
  // Daily Aggregation
  // ===========================================================================

  /**
   * Trigger daily aggregation for a specific date
   */
  async aggregateDailyCosts(
    date: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`SELECT aggregate_daily_llm_costs(${date}::date)`;
    return Number(result[0]?.aggregate_daily_llm_costs) || 0;
  }

  /**
   * Get daily aggregates
   */
  async getDailyAggregates(
    filters: {
      start_date?: string;
      end_date?: string;
      user_id?: UUID;
      provider?: string;
      limit?: number;
    } = {},
    tx?: TransactionContext
  ): Promise<DailyAggregate[]> {
    const db = this.getSql(tx);
    const { limit = 30 } = filters;

    const result = await db`
      SELECT * FROM llm_cost_daily_aggregates
      WHERE
        (${filters.start_date ?? null}::date IS NULL OR date >= ${filters.start_date ?? null}::date)
        AND (${filters.end_date ?? null}::date IS NULL OR date <= ${filters.end_date ?? null}::date)
        AND (${filters.user_id ?? null}::uuid IS NULL OR user_id = ${filters.user_id ?? null})
        AND (${filters.provider ?? null}::varchar IS NULL OR provider = ${filters.provider ?? null})
      ORDER BY date DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapDailyAggregate(row));
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapUsageEvent(row: Record<string, unknown>): LLMUsageEvent {
    return {
      id: row['id'] as UUID,
      user_id: row['user_id'] as UUID,
      session_id: row['session_id'] as UUID | null,
      companion_id: row['companion_id'] as UUID | null,
      turn_id: row['turn_id'] as UUID | null,
      trace_id: row['trace_id'] as UUID | null,
      provider: row['provider'] as string,
      model: row['model'] as string,
      input_tokens: Number(row['input_tokens']) || 0,
      output_tokens: Number(row['output_tokens']) || 0,
      total_tokens: Number(row['total_tokens']) || 0,
      cost_usd: Number(row['cost_usd']) || 0,
      latency_ms: row['latency_ms'] ? Number(row['latency_ms']) : null,
      finish_reason: row['finish_reason'] as string | null,
      request_type: row['request_type'] as string,
      tool_calls: Number(row['tool_calls']) || 0,
      stream_mode: Boolean(row['stream_mode']),
      request_started_at: row['request_started_at'] as Date,
      request_completed_at: row['request_completed_at'] as Date,
      billing_period: row['billing_period'] as string,
      created_at: row['created_at'] as Date,
    };
  }

  private mapBudget(row: Record<string, unknown>): UserCostBudget {
    return {
      id: row['id'] as UUID,
      user_id: row['user_id'] as UUID,
      daily_limit_usd: row['daily_limit_usd'] ? Number(row['daily_limit_usd']) : null,
      monthly_limit_usd: row['monthly_limit_usd'] ? Number(row['monthly_limit_usd']) : null,
      daily_usage_usd: Number(row['daily_usage_usd']) || 0,
      monthly_usage_usd: Number(row['monthly_usage_usd']) || 0,
      daily_reset_at: row['daily_reset_at'] as Date,
      monthly_reset_at: row['monthly_reset_at'] as Date,
      alert_threshold_percent: Number(row['alert_threshold_percent']) || 80,
      last_alert_sent_at: row['last_alert_sent_at'] as Date | null,
      is_blocked: Boolean(row['is_blocked']),
      blocked_reason: row['blocked_reason'] as string | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapAlert(row: Record<string, unknown>): CostAlert {
    return {
      id: row['id'] as UUID,
      user_id: row['user_id'] as UUID,
      alert_type: row['alert_type'] as 'threshold' | 'limit_reached' | 'anomaly',
      threshold_percent: row['threshold_percent'] ? Number(row['threshold_percent']) : null,
      current_usage_usd: Number(row['current_usage_usd']) || 0,
      limit_usd: row['limit_usd'] ? Number(row['limit_usd']) : null,
      period: row['period'] as 'daily' | 'monthly',
      notified_via: (row['notified_via'] as string[]) || [],
      acknowledged_at: row['acknowledged_at'] as Date | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapDailyAggregate(row: Record<string, unknown>): DailyAggregate {
    return {
      id: row['id'] as UUID,
      date: (row['date'] as Date).toISOString().split('T')[0]!,
      user_id: row['user_id'] as UUID | null,
      provider: row['provider'] as string | null,
      model: row['model'] as string | null,
      companion_id: row['companion_id'] as UUID | null,
      request_count: Number(row['request_count']) || 0,
      input_tokens_total: Number(row['input_tokens_total']) || 0,
      output_tokens_total: Number(row['output_tokens_total']) || 0,
      total_tokens: Number(row['total_tokens']) || 0,
      cost_usd_total: Number(row['cost_usd_total']) || 0,
      latency_avg_ms: row['latency_avg_ms'] ? Number(row['latency_avg_ms']) : null,
      latency_p50_ms: row['latency_p50_ms'] ? Number(row['latency_p50_ms']) : null,
      latency_p95_ms: row['latency_p95_ms'] ? Number(row['latency_p95_ms']) : null,
      latency_p99_ms: row['latency_p99_ms'] ? Number(row['latency_p99_ms']) : null,
    };
  }
}

// Singleton instance
let llmUsageRepositoryInstance: LLMUsageRepository | null = null;

export function getLLMUsageRepository(): LLMUsageRepository {
  if (!llmUsageRepositoryInstance) {
    llmUsageRepositoryInstance = new LLMUsageRepository();
  }
  return llmUsageRepositoryInstance;
}
