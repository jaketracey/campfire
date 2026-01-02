/**
 * Migration: Create LLM Usage Tracking Tables
 * Created: 2026-01-02
 *
 * Cost tracking and traceability for LLM inference:
 * - llm_usage_events: Granular per-request tracking
 * - user_cost_budgets: Per-user cost limits and usage
 * - llm_cost_daily_aggregates: Aggregated daily reports
 * - cost_alerts: Alert history
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // LLM Usage Events Table (granular per-request tracking)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS llm_usage_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Context identifiers
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      companion_id UUID REFERENCES companions(id) ON DELETE SET NULL,
      turn_id UUID,
      trace_id UUID,

      -- Provider/Model info
      provider VARCHAR(50) NOT NULL,
      model VARCHAR(255) NOT NULL,

      -- Token tracking
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

      -- Cost (in USD, 8 decimal precision for accuracy)
      cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,

      -- Performance
      latency_ms INTEGER,
      finish_reason VARCHAR(50),

      -- Request metadata
      request_type VARCHAR(50) NOT NULL DEFAULT 'chat',
      tool_calls INTEGER DEFAULT 0,
      stream_mode BOOLEAN DEFAULT FALSE,

      -- Timestamps
      request_started_at TIMESTAMPTZ NOT NULL,
      request_completed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Billing period for efficient aggregation (YYYY-MM format)
      billing_period CHAR(7) NOT NULL
    )
  `;

  // Indexes for common query patterns
  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_user_period
    ON llm_usage_events(user_id, billing_period, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_session
    ON llm_usage_events(session_id, created_at DESC)
    WHERE session_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_companion
    ON llm_usage_events(companion_id, created_at DESC)
    WHERE companion_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_provider_model
    ON llm_usage_events(provider, model, billing_period)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_period
    ON llm_usage_events(billing_period, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_trace
    ON llm_usage_events(trace_id)
    WHERE trace_id IS NOT NULL
  `;

  // BRIN index for time-range queries (efficient for append-only tables)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_created_brin
    ON llm_usage_events USING BRIN(created_at) WITH (pages_per_range = 32)
  `;

  await sql`
    COMMENT ON TABLE llm_usage_events IS 'Granular LLM usage tracking for cost analysis and billing'
  `;

  // =========================================================================
  // User Cost Budgets Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_cost_budgets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Budget configuration (NULL means unlimited)
      daily_limit_usd NUMERIC(10, 4),
      monthly_limit_usd NUMERIC(10, 4),

      -- Current usage (denormalized for fast access, reset on period change)
      daily_usage_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
      monthly_usage_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,

      -- Last reset timestamps
      daily_reset_at TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('day', NOW()),
      monthly_reset_at TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('month', NOW()),

      -- Alert thresholds
      alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
      last_alert_sent_at TIMESTAMPTZ,

      -- Status
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      blocked_reason TEXT,

      metadata JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_cost_budgets_user_unique UNIQUE(user_id)
    )
  `;

  await sql`
    CREATE TRIGGER user_cost_budgets_updated_at
    BEFORE UPDATE ON user_cost_budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE user_cost_budgets IS 'Per-user LLM cost budgets and usage tracking'
  `;

  // =========================================================================
  // Daily Cost Aggregates Table (for reporting)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS llm_cost_daily_aggregates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Aggregation dimensions
      date DATE NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(50),
      model VARCHAR(255),
      companion_id UUID REFERENCES companions(id) ON DELETE SET NULL,

      -- Aggregated metrics
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens_total BIGINT NOT NULL DEFAULT 0,
      output_tokens_total BIGINT NOT NULL DEFAULT 0,
      total_tokens BIGINT GENERATED ALWAYS AS (input_tokens_total + output_tokens_total) STORED,
      cost_usd_total NUMERIC(12, 4) NOT NULL DEFAULT 0,

      -- Performance metrics (latency percentiles)
      latency_avg_ms NUMERIC(10, 2),
      latency_p50_ms NUMERIC(10, 2),
      latency_p95_ms NUMERIC(10, 2),
      latency_p99_ms NUMERIC(10, 2),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Unique constraint for upsert operations
      CONSTRAINT llm_cost_daily_unique UNIQUE(date, user_id, provider, model, companion_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_cost_daily_date
    ON llm_cost_daily_aggregates(date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_cost_daily_user
    ON llm_cost_daily_aggregates(user_id, date DESC)
    WHERE user_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_llm_cost_daily_provider
    ON llm_cost_daily_aggregates(provider, date DESC)
    WHERE provider IS NOT NULL
  `;

  await sql`
    CREATE TRIGGER llm_cost_daily_updated_at
    BEFORE UPDATE ON llm_cost_daily_aggregates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE llm_cost_daily_aggregates IS 'Daily aggregated LLM cost metrics for dashboards and reports'
  `;

  // =========================================================================
  // Cost Alerts Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS cost_alerts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Alert details
      alert_type VARCHAR(50) NOT NULL,
      threshold_percent INTEGER,
      current_usage_usd NUMERIC(10, 4) NOT NULL,
      limit_usd NUMERIC(10, 4),
      period VARCHAR(20) NOT NULL,

      -- Notification status
      notified_via JSONB NOT NULL DEFAULT '[]',
      acknowledged_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_cost_alerts_user
    ON cost_alerts(user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_cost_alerts_unacked
    ON cost_alerts(created_at DESC)
    WHERE acknowledged_at IS NULL
  `;

  await sql`
    COMMENT ON TABLE cost_alerts IS 'Cost threshold alert history and notification tracking'
  `;

  // =========================================================================
  // Functions
  // =========================================================================

  // Function to record LLM usage and update budgets atomically
  await sql`
    CREATE OR REPLACE FUNCTION record_llm_usage(
      p_user_id UUID,
      p_session_id UUID,
      p_companion_id UUID,
      p_turn_id UUID,
      p_trace_id UUID,
      p_provider VARCHAR,
      p_model VARCHAR,
      p_input_tokens INTEGER,
      p_output_tokens INTEGER,
      p_cost_usd NUMERIC,
      p_latency_ms INTEGER,
      p_finish_reason VARCHAR,
      p_request_type VARCHAR,
      p_tool_calls INTEGER,
      p_stream_mode BOOLEAN,
      p_started_at TIMESTAMPTZ,
      p_completed_at TIMESTAMPTZ
    ) RETURNS TABLE (
      usage_id UUID,
      daily_usage NUMERIC,
      monthly_usage NUMERIC,
      daily_limit NUMERIC,
      monthly_limit NUMERIC,
      is_over_limit BOOLEAN
    ) AS $$
    DECLARE
      v_usage_id UUID;
      v_billing_period CHAR(7);
      v_budget RECORD;
    BEGIN
      v_billing_period := TO_CHAR(p_completed_at, 'YYYY-MM');

      -- Insert usage event
      INSERT INTO llm_usage_events (
        user_id, session_id, companion_id, turn_id, trace_id,
        provider, model, input_tokens, output_tokens, cost_usd,
        latency_ms, finish_reason, request_type, tool_calls, stream_mode,
        request_started_at, request_completed_at, billing_period
      ) VALUES (
        p_user_id, p_session_id, p_companion_id, p_turn_id, p_trace_id,
        p_provider, p_model, p_input_tokens, p_output_tokens, p_cost_usd,
        p_latency_ms, p_finish_reason, p_request_type, p_tool_calls, p_stream_mode,
        p_started_at, p_completed_at, v_billing_period
      ) RETURNING id INTO v_usage_id;

      -- Upsert and update user budget with period reset logic
      INSERT INTO user_cost_budgets (user_id, daily_usage_usd, monthly_usage_usd)
      VALUES (p_user_id, p_cost_usd, p_cost_usd)
      ON CONFLICT (user_id) DO UPDATE SET
        daily_usage_usd = CASE
          WHEN user_cost_budgets.daily_reset_at < DATE_TRUNC('day', NOW())
          THEN p_cost_usd
          ELSE user_cost_budgets.daily_usage_usd + p_cost_usd
        END,
        monthly_usage_usd = CASE
          WHEN user_cost_budgets.monthly_reset_at < DATE_TRUNC('month', NOW())
          THEN p_cost_usd
          ELSE user_cost_budgets.monthly_usage_usd + p_cost_usd
        END,
        daily_reset_at = CASE
          WHEN user_cost_budgets.daily_reset_at < DATE_TRUNC('day', NOW())
          THEN DATE_TRUNC('day', NOW())
          ELSE user_cost_budgets.daily_reset_at
        END,
        monthly_reset_at = CASE
          WHEN user_cost_budgets.monthly_reset_at < DATE_TRUNC('month', NOW())
          THEN DATE_TRUNC('month', NOW())
          ELSE user_cost_budgets.monthly_reset_at
        END,
        updated_at = NOW();

      -- Get updated budget
      SELECT * INTO v_budget FROM user_cost_budgets WHERE user_id = p_user_id;

      RETURN QUERY SELECT
        v_usage_id,
        v_budget.daily_usage_usd,
        v_budget.monthly_usage_usd,
        v_budget.daily_limit_usd,
        v_budget.monthly_limit_usd,
        (v_budget.daily_limit_usd IS NOT NULL AND v_budget.daily_usage_usd > v_budget.daily_limit_usd)
        OR (v_budget.monthly_limit_usd IS NOT NULL AND v_budget.monthly_usage_usd > v_budget.monthly_limit_usd);
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to get user cost summary
  await sql`
    CREATE OR REPLACE FUNCTION get_user_cost_summary(
      p_user_id UUID,
      p_days INTEGER DEFAULT 30
    ) RETURNS TABLE (
      total_cost_usd NUMERIC,
      total_requests BIGINT,
      total_input_tokens BIGINT,
      total_output_tokens BIGINT,
      avg_cost_per_request NUMERIC,
      top_model VARCHAR,
      top_companion_id UUID
    ) AS $$
    BEGIN
      RETURN QUERY
      WITH usage_stats AS (
        SELECT
          SUM(cost_usd) as total_cost,
          COUNT(*) as total_reqs,
          SUM(input_tokens) as total_input,
          SUM(output_tokens) as total_output
        FROM llm_usage_events
        WHERE user_id = p_user_id
          AND created_at >= NOW() - (p_days || ' days')::INTERVAL
      ),
      top_model_cte AS (
        SELECT model
        FROM llm_usage_events
        WHERE user_id = p_user_id
          AND created_at >= NOW() - (p_days || ' days')::INTERVAL
        GROUP BY model
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ),
      top_companion_cte AS (
        SELECT companion_id
        FROM llm_usage_events
        WHERE user_id = p_user_id
          AND companion_id IS NOT NULL
          AND created_at >= NOW() - (p_days || ' days')::INTERVAL
        GROUP BY companion_id
        ORDER BY COUNT(*) DESC
        LIMIT 1
      )
      SELECT
        COALESCE(us.total_cost, 0)::NUMERIC,
        COALESCE(us.total_reqs, 0),
        COALESCE(us.total_input, 0),
        COALESCE(us.total_output, 0),
        CASE WHEN us.total_reqs > 0 THEN us.total_cost / us.total_reqs ELSE 0 END,
        tm.model,
        tc.companion_id
      FROM usage_stats us
      LEFT JOIN top_model_cte tm ON TRUE
      LEFT JOIN top_companion_cte tc ON TRUE;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to get platform-wide cost summary (for admin dashboard)
  await sql`
    CREATE OR REPLACE FUNCTION get_platform_cost_summary(
      p_days INTEGER DEFAULT 30
    ) RETURNS TABLE (
      total_cost_usd NUMERIC,
      total_requests BIGINT,
      total_input_tokens BIGINT,
      total_output_tokens BIGINT,
      unique_users BIGINT,
      avg_cost_per_user NUMERIC,
      cost_by_provider JSONB,
      cost_by_model JSONB
    ) AS $$
    BEGIN
      RETURN QUERY
      WITH base_stats AS (
        SELECT
          SUM(cost_usd) as total_cost,
          COUNT(*) as total_reqs,
          SUM(input_tokens) as total_input,
          SUM(output_tokens) as total_output,
          COUNT(DISTINCT user_id) as unique_users
        FROM llm_usage_events
        WHERE created_at >= NOW() - (p_days || ' days')::INTERVAL
      ),
      provider_costs AS (
        SELECT jsonb_object_agg(provider, cost) as by_provider
        FROM (
          SELECT provider, SUM(cost_usd) as cost
          FROM llm_usage_events
          WHERE created_at >= NOW() - (p_days || ' days')::INTERVAL
          GROUP BY provider
        ) pc
      ),
      model_costs AS (
        SELECT jsonb_object_agg(model, cost) as by_model
        FROM (
          SELECT model, SUM(cost_usd) as cost
          FROM llm_usage_events
          WHERE created_at >= NOW() - (p_days || ' days')::INTERVAL
          GROUP BY model
          ORDER BY cost DESC
          LIMIT 10
        ) mc
      )
      SELECT
        COALESCE(bs.total_cost, 0)::NUMERIC,
        COALESCE(bs.total_reqs, 0),
        COALESCE(bs.total_input, 0),
        COALESCE(bs.total_output, 0),
        COALESCE(bs.unique_users, 0),
        CASE WHEN bs.unique_users > 0 THEN bs.total_cost / bs.unique_users ELSE 0 END,
        COALESCE(pc.by_provider, '{}'::jsonb),
        COALESCE(mc.by_model, '{}'::jsonb)
      FROM base_stats bs
      CROSS JOIN provider_costs pc
      CROSS JOIN model_costs mc;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to aggregate daily costs (call from background job)
  await sql`
    CREATE OR REPLACE FUNCTION aggregate_daily_llm_costs(
      p_date DATE DEFAULT CURRENT_DATE - 1
    ) RETURNS INTEGER AS $$
    DECLARE
      v_count INTEGER;
    BEGIN
      -- Aggregate by user/provider/model/companion for the given date
      INSERT INTO llm_cost_daily_aggregates (
        date, user_id, provider, model, companion_id,
        request_count, input_tokens_total, output_tokens_total, cost_usd_total,
        latency_avg_ms, latency_p50_ms, latency_p95_ms, latency_p99_ms
      )
      SELECT
        p_date,
        user_id,
        provider,
        model,
        companion_id,
        COUNT(*),
        SUM(input_tokens),
        SUM(output_tokens),
        SUM(cost_usd),
        AVG(latency_ms),
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms),
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)
      FROM llm_usage_events
      WHERE created_at >= p_date AND created_at < p_date + 1
      GROUP BY user_id, provider, model, companion_id
      ON CONFLICT (date, user_id, provider, model, companion_id)
      DO UPDATE SET
        request_count = EXCLUDED.request_count,
        input_tokens_total = EXCLUDED.input_tokens_total,
        output_tokens_total = EXCLUDED.output_tokens_total,
        cost_usd_total = EXCLUDED.cost_usd_total,
        latency_avg_ms = EXCLUDED.latency_avg_ms,
        latency_p50_ms = EXCLUDED.latency_p50_ms,
        latency_p95_ms = EXCLUDED.latency_p95_ms,
        latency_p99_ms = EXCLUDED.latency_p99_ms,
        updated_at = NOW();

      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN v_count;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS aggregate_daily_llm_costs(DATE)`;
  await sql`DROP FUNCTION IF EXISTS get_platform_cost_summary(INTEGER)`;
  await sql`DROP FUNCTION IF EXISTS get_user_cost_summary(UUID, INTEGER)`;
  await sql`DROP FUNCTION IF EXISTS record_llm_usage(UUID, UUID, UUID, UUID, UUID, VARCHAR, VARCHAR, INTEGER, INTEGER, NUMERIC, INTEGER, VARCHAR, VARCHAR, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ)`;
  await sql`DROP TABLE IF EXISTS cost_alerts CASCADE`;
  await sql`DROP TRIGGER IF EXISTS llm_cost_daily_updated_at ON llm_cost_daily_aggregates`;
  await sql`DROP TABLE IF EXISTS llm_cost_daily_aggregates CASCADE`;
  await sql`DROP TRIGGER IF EXISTS user_cost_budgets_updated_at ON user_cost_budgets`;
  await sql`DROP TABLE IF EXISTS user_cost_budgets CASCADE`;
  await sql`DROP TABLE IF EXISTS llm_usage_events CASCADE`;
}
