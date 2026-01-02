/**
 * Migration: Create Analytics Aggregate Tables
 * Created: 2026-01-02
 *
 * Pre-computed analytics tables for efficient dashboard queries:
 * - analytics_daily_aggregates: Daily engagement metrics (DAU/WAU/MAU, sessions, etc.)
 * - revenue_daily_aggregates: Daily revenue metrics (MRR, subscriptions, tokens)
 * - retention_cohorts: User retention cohort data
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Analytics Daily Aggregates Table (Engagement Metrics)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_daily_aggregates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      date DATE NOT NULL,

      -- User Metrics
      daily_active_users INTEGER NOT NULL DEFAULT 0,
      weekly_active_users INTEGER NOT NULL DEFAULT 0,
      monthly_active_users INTEGER NOT NULL DEFAULT 0,
      new_users INTEGER NOT NULL DEFAULT 0,
      returning_users INTEGER NOT NULL DEFAULT 0,

      -- Session Metrics
      total_sessions INTEGER NOT NULL DEFAULT 0,
      avg_session_duration_ms INTEGER,
      avg_turns_per_session NUMERIC(8, 2),
      total_turns INTEGER NOT NULL DEFAULT 0,

      -- Companion Metrics
      companions_created INTEGER NOT NULL DEFAULT 0,
      active_companions INTEGER NOT NULL DEFAULT 0,

      -- Token/Gift Metrics
      tokens_purchased INTEGER NOT NULL DEFAULT 0,
      tokens_spent INTEGER NOT NULL DEFAULT 0,
      gifts_created INTEGER NOT NULL DEFAULT 0,
      images_generated INTEGER NOT NULL DEFAULT 0,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT analytics_daily_date_unique UNIQUE(date)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_analytics_daily_date
    ON analytics_daily_aggregates(date DESC)
  `;

  await sql`
    CREATE TRIGGER analytics_daily_updated_at
    BEFORE UPDATE ON analytics_daily_aggregates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE analytics_daily_aggregates IS 'Pre-computed daily engagement metrics for analytics dashboards'
  `;

  // =========================================================================
  // Revenue Daily Aggregates Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS revenue_daily_aggregates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      date DATE NOT NULL,

      -- MRR and ARPU (stored in cents for precision)
      mrr_cents INTEGER NOT NULL DEFAULT 0,
      arpu_cents INTEGER,

      -- Subscription Changes
      new_subscriptions INTEGER NOT NULL DEFAULT 0,
      churned_subscriptions INTEGER NOT NULL DEFAULT 0,
      upgraded_subscriptions INTEGER NOT NULL DEFAULT 0,
      downgraded_subscriptions INTEGER NOT NULL DEFAULT 0,

      -- Subscription Distribution by Tier
      free_users INTEGER NOT NULL DEFAULT 0,
      starter_users INTEGER NOT NULL DEFAULT 0,
      pro_users INTEGER NOT NULL DEFAULT 0,
      enterprise_users INTEGER NOT NULL DEFAULT 0,

      -- Token Revenue
      token_purchase_count INTEGER NOT NULL DEFAULT 0,
      token_purchase_revenue_cents INTEGER NOT NULL DEFAULT 0,
      tokens_purchased_total INTEGER NOT NULL DEFAULT 0,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT revenue_daily_date_unique UNIQUE(date)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_revenue_daily_date
    ON revenue_daily_aggregates(date DESC)
  `;

  await sql`
    CREATE TRIGGER revenue_daily_updated_at
    BEFORE UPDATE ON revenue_daily_aggregates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE revenue_daily_aggregates IS 'Pre-computed daily revenue metrics for analytics dashboards'
  `;

  // =========================================================================
  // Retention Cohorts Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS retention_cohorts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      cohort_date DATE NOT NULL,
      cohort_period VARCHAR(10) NOT NULL,
      cohort_size INTEGER NOT NULL DEFAULT 0,

      -- Retention data as JSONB for flexibility
      -- Format: {"d1": 0.75, "d7": 0.45, "d14": 0.30, "d30": 0.20}
      retention_data JSONB NOT NULL DEFAULT '{}',

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT retention_cohorts_unique UNIQUE(cohort_date, cohort_period)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_retention_cohorts_date
    ON retention_cohorts(cohort_date DESC, cohort_period)
  `;

  await sql`
    CREATE TRIGGER retention_cohorts_updated_at
    BEFORE UPDATE ON retention_cohorts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE retention_cohorts IS 'User retention cohort data for D1/D7/D14/D30 analysis'
  `;

  // =========================================================================
  // Additional Indexes on Existing Tables for Analytics Queries
  // =========================================================================

  // Index on users.created_at for new user counting
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_created_at_date
    ON users(created_at DESC)
    WHERE status = 'active'
  `;

  // Index on sessions.started_at for DAU/WAU/MAU
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at_date
    ON sessions(started_at DESC)
  `;

  // Index on subscriptions for tier distribution
  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_status
    ON subscriptions(plan, status)
    WHERE status IN ('active', 'trialing')
  `;

  // Index on token_transactions for purchase tracking
  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_created_type
    ON token_transactions(created_at DESC, transaction_type)
  `;

  // =========================================================================
  // Aggregation Functions
  // =========================================================================

  // Function to aggregate engagement metrics for a specific date
  await sql`
    CREATE OR REPLACE FUNCTION aggregate_daily_analytics(p_date DATE)
    RETURNS VOID AS $$
    DECLARE
      v_dau INTEGER;
      v_wau INTEGER;
      v_mau INTEGER;
      v_new_users INTEGER;
      v_returning_users INTEGER;
      v_total_sessions INTEGER;
      v_avg_duration INTEGER;
      v_avg_turns NUMERIC;
      v_total_turns INTEGER;
      v_companions_created INTEGER;
      v_active_companions INTEGER;
      v_tokens_purchased INTEGER;
      v_tokens_spent INTEGER;
      v_gifts_created INTEGER;
      v_images_generated INTEGER;
    BEGIN
      -- DAU: Users with activity on this date
      SELECT COUNT(DISTINCT user_id) INTO v_dau
      FROM sessions
      WHERE started_at::date = p_date;

      -- WAU: Users with activity in last 7 days (rolling)
      SELECT COUNT(DISTINCT user_id) INTO v_wau
      FROM sessions
      WHERE started_at >= p_date - INTERVAL '6 days'
        AND started_at < p_date + INTERVAL '1 day';

      -- MAU: Users with activity in last 30 days (rolling)
      SELECT COUNT(DISTINCT user_id) INTO v_mau
      FROM sessions
      WHERE started_at >= p_date - INTERVAL '29 days'
        AND started_at < p_date + INTERVAL '1 day';

      -- New users created on this date
      SELECT COUNT(*) INTO v_new_users
      FROM users
      WHERE created_at::date = p_date
        AND status = 'active';

      -- Returning users (existing users who were active on this date)
      SELECT COUNT(DISTINCT s.user_id) INTO v_returning_users
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.started_at::date = p_date
        AND u.created_at::date < p_date;

      -- Session metrics for this date
      SELECT
        COUNT(*)::INTEGER,
        AVG(total_duration_ms)::INTEGER,
        AVG(turn_count),
        SUM(turn_count)::INTEGER
      INTO v_total_sessions, v_avg_duration, v_avg_turns, v_total_turns
      FROM sessions
      WHERE started_at::date = p_date;

      -- Companions created on this date
      SELECT COUNT(*) INTO v_companions_created
      FROM companions
      WHERE created_at::date = p_date;

      -- Active companions (used in sessions on this date)
      SELECT COUNT(DISTINCT companion_id) INTO v_active_companions
      FROM sessions
      WHERE started_at::date = p_date;

      -- Token transactions for this date
      SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::INTEGER,
        COALESCE(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 0)::INTEGER
      INTO v_tokens_purchased, v_tokens_spent
      FROM token_transactions
      WHERE created_at::date = p_date;

      -- Gifts created on this date
      SELECT COUNT(*) INTO v_gifts_created
      FROM gifts
      WHERE created_at::date = p_date;

      -- Images generated on this date
      SELECT COUNT(*) INTO v_images_generated
      FROM companion_images
      WHERE created_at::date = p_date;

      -- Upsert the aggregate row
      INSERT INTO analytics_daily_aggregates (
        date,
        daily_active_users, weekly_active_users, monthly_active_users,
        new_users, returning_users,
        total_sessions, avg_session_duration_ms, avg_turns_per_session, total_turns,
        companions_created, active_companions,
        tokens_purchased, tokens_spent, gifts_created, images_generated
      )
      VALUES (
        p_date,
        COALESCE(v_dau, 0), COALESCE(v_wau, 0), COALESCE(v_mau, 0),
        COALESCE(v_new_users, 0), COALESCE(v_returning_users, 0),
        COALESCE(v_total_sessions, 0), v_avg_duration, v_avg_turns, COALESCE(v_total_turns, 0),
        COALESCE(v_companions_created, 0), COALESCE(v_active_companions, 0),
        COALESCE(v_tokens_purchased, 0), COALESCE(v_tokens_spent, 0),
        COALESCE(v_gifts_created, 0), COALESCE(v_images_generated, 0)
      )
      ON CONFLICT (date) DO UPDATE SET
        daily_active_users = EXCLUDED.daily_active_users,
        weekly_active_users = EXCLUDED.weekly_active_users,
        monthly_active_users = EXCLUDED.monthly_active_users,
        new_users = EXCLUDED.new_users,
        returning_users = EXCLUDED.returning_users,
        total_sessions = EXCLUDED.total_sessions,
        avg_session_duration_ms = EXCLUDED.avg_session_duration_ms,
        avg_turns_per_session = EXCLUDED.avg_turns_per_session,
        total_turns = EXCLUDED.total_turns,
        companions_created = EXCLUDED.companions_created,
        active_companions = EXCLUDED.active_companions,
        tokens_purchased = EXCLUDED.tokens_purchased,
        tokens_spent = EXCLUDED.tokens_spent,
        gifts_created = EXCLUDED.gifts_created,
        images_generated = EXCLUDED.images_generated,
        updated_at = NOW();
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to aggregate revenue metrics for a specific date
  await sql`
    CREATE OR REPLACE FUNCTION aggregate_daily_revenue(p_date DATE)
    RETURNS VOID AS $$
    DECLARE
      v_mrr_cents INTEGER;
      v_paying_users INTEGER;
      v_arpu_cents INTEGER;
      v_new_subs INTEGER;
      v_churned_subs INTEGER;
      v_free_users INTEGER;
      v_starter_users INTEGER;
      v_pro_users INTEGER;
      v_enterprise_users INTEGER;
      v_token_purchase_count INTEGER;
      v_token_purchase_revenue INTEGER;
      v_tokens_purchased_total INTEGER;
    BEGIN
      -- Calculate MRR from active subscriptions as of this date
      -- Prices: starter=$9.99, pro=$29.99, enterprise=$99.99
      SELECT
        COALESCE(SUM(
          CASE plan
            WHEN 'starter' THEN 999
            WHEN 'pro' THEN 2999
            WHEN 'enterprise' THEN 9999
            ELSE 0
          END
        ), 0)::INTEGER,
        COUNT(*) FILTER (WHERE plan != 'free')
      INTO v_mrr_cents, v_paying_users
      FROM subscriptions
      WHERE status IN ('active', 'trialing')
        AND created_at::date <= p_date;

      -- Calculate ARPU
      v_arpu_cents := CASE
        WHEN v_paying_users > 0 THEN v_mrr_cents / v_paying_users
        ELSE 0
      END;

      -- New subscriptions on this date
      SELECT COUNT(*) INTO v_new_subs
      FROM subscriptions
      WHERE created_at::date = p_date
        AND plan != 'free';

      -- Churned subscriptions on this date
      SELECT COUNT(*) INTO v_churned_subs
      FROM subscriptions
      WHERE canceled_at::date = p_date;

      -- Subscription distribution by tier
      SELECT
        COUNT(*) FILTER (WHERE plan = 'free'),
        COUNT(*) FILTER (WHERE plan = 'starter'),
        COUNT(*) FILTER (WHERE plan = 'pro'),
        COUNT(*) FILTER (WHERE plan = 'enterprise')
      INTO v_free_users, v_starter_users, v_pro_users, v_enterprise_users
      FROM subscriptions
      WHERE status IN ('active', 'trialing');

      -- Token purchases on this date
      SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM((metadata->>'price_cents')::integer), 0)::INTEGER,
        COALESCE(SUM(amount), 0)::INTEGER
      INTO v_token_purchase_count, v_token_purchase_revenue, v_tokens_purchased_total
      FROM token_transactions
      WHERE transaction_type = 'purchase'
        AND created_at::date = p_date;

      -- Upsert the aggregate row
      INSERT INTO revenue_daily_aggregates (
        date,
        mrr_cents, arpu_cents,
        new_subscriptions, churned_subscriptions, upgraded_subscriptions, downgraded_subscriptions,
        free_users, starter_users, pro_users, enterprise_users,
        token_purchase_count, token_purchase_revenue_cents, tokens_purchased_total
      )
      VALUES (
        p_date,
        COALESCE(v_mrr_cents, 0), v_arpu_cents,
        COALESCE(v_new_subs, 0), COALESCE(v_churned_subs, 0), 0, 0,
        COALESCE(v_free_users, 0), COALESCE(v_starter_users, 0),
        COALESCE(v_pro_users, 0), COALESCE(v_enterprise_users, 0),
        COALESCE(v_token_purchase_count, 0), COALESCE(v_token_purchase_revenue, 0),
        COALESCE(v_tokens_purchased_total, 0)
      )
      ON CONFLICT (date) DO UPDATE SET
        mrr_cents = EXCLUDED.mrr_cents,
        arpu_cents = EXCLUDED.arpu_cents,
        new_subscriptions = EXCLUDED.new_subscriptions,
        churned_subscriptions = EXCLUDED.churned_subscriptions,
        free_users = EXCLUDED.free_users,
        starter_users = EXCLUDED.starter_users,
        pro_users = EXCLUDED.pro_users,
        enterprise_users = EXCLUDED.enterprise_users,
        token_purchase_count = EXCLUDED.token_purchase_count,
        token_purchase_revenue_cents = EXCLUDED.token_purchase_revenue_cents,
        tokens_purchased_total = EXCLUDED.tokens_purchased_total,
        updated_at = NOW();
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to calculate retention for a cohort
  await sql`
    CREATE OR REPLACE FUNCTION calculate_retention_cohort(
      p_cohort_date DATE,
      p_period VARCHAR DEFAULT 'weekly'
    )
    RETURNS VOID AS $$
    DECLARE
      v_cohort_size INTEGER;
      v_retention JSONB;
      v_d1 NUMERIC;
      v_d7 NUMERIC;
      v_d14 NUMERIC;
      v_d30 NUMERIC;
      v_cohort_user_ids UUID[];
    BEGIN
      -- Get users who signed up on the cohort date
      SELECT ARRAY_AGG(id), COUNT(*)::INTEGER
      INTO v_cohort_user_ids, v_cohort_size
      FROM users
      WHERE created_at::date = p_cohort_date
        AND status = 'active';

      IF v_cohort_size = 0 OR v_cohort_user_ids IS NULL THEN
        RETURN;
      END IF;

      -- Calculate D1 retention
      SELECT COUNT(DISTINCT user_id)::NUMERIC / v_cohort_size INTO v_d1
      FROM sessions
      WHERE user_id = ANY(v_cohort_user_ids)
        AND started_at::date = p_cohort_date + 1;

      -- Calculate D7 retention
      SELECT COUNT(DISTINCT user_id)::NUMERIC / v_cohort_size INTO v_d7
      FROM sessions
      WHERE user_id = ANY(v_cohort_user_ids)
        AND started_at::date = p_cohort_date + 7;

      -- Calculate D14 retention
      SELECT COUNT(DISTINCT user_id)::NUMERIC / v_cohort_size INTO v_d14
      FROM sessions
      WHERE user_id = ANY(v_cohort_user_ids)
        AND started_at::date = p_cohort_date + 14;

      -- Calculate D30 retention
      SELECT COUNT(DISTINCT user_id)::NUMERIC / v_cohort_size INTO v_d30
      FROM sessions
      WHERE user_id = ANY(v_cohort_user_ids)
        AND started_at::date = p_cohort_date + 30;

      -- Build retention JSON
      v_retention := jsonb_build_object(
        'd1', ROUND(COALESCE(v_d1, 0), 4),
        'd7', ROUND(COALESCE(v_d7, 0), 4),
        'd14', ROUND(COALESCE(v_d14, 0), 4),
        'd30', ROUND(COALESCE(v_d30, 0), 4)
      );

      -- Upsert the cohort row
      INSERT INTO retention_cohorts (cohort_date, cohort_period, cohort_size, retention_data)
      VALUES (p_cohort_date, p_period, v_cohort_size, v_retention)
      ON CONFLICT (cohort_date, cohort_period) DO UPDATE SET
        cohort_size = EXCLUDED.cohort_size,
        retention_data = EXCLUDED.retention_data,
        updated_at = NOW();
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    COMMENT ON FUNCTION aggregate_daily_analytics IS 'Aggregates engagement metrics for a specific date into analytics_daily_aggregates'
  `;

  await sql`
    COMMENT ON FUNCTION aggregate_daily_revenue IS 'Aggregates revenue metrics for a specific date into revenue_daily_aggregates'
  `;

  await sql`
    COMMENT ON FUNCTION calculate_retention_cohort IS 'Calculates D1/D7/D14/D30 retention for a signup cohort'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Drop functions
  await sql`DROP FUNCTION IF EXISTS calculate_retention_cohort(DATE, VARCHAR)`;
  await sql`DROP FUNCTION IF EXISTS aggregate_daily_revenue(DATE)`;
  await sql`DROP FUNCTION IF EXISTS aggregate_daily_analytics(DATE)`;

  // Drop indexes on existing tables
  await sql`DROP INDEX IF EXISTS idx_token_transactions_created_type`;
  await sql`DROP INDEX IF EXISTS idx_subscriptions_plan_status`;
  await sql`DROP INDEX IF EXISTS idx_sessions_started_at_date`;
  await sql`DROP INDEX IF EXISTS idx_users_created_at_date`;

  // Drop retention_cohorts table
  await sql`DROP TRIGGER IF EXISTS retention_cohorts_updated_at ON retention_cohorts`;
  await sql`DROP INDEX IF EXISTS idx_retention_cohorts_date`;
  await sql`DROP TABLE IF EXISTS retention_cohorts CASCADE`;

  // Drop revenue_daily_aggregates table
  await sql`DROP TRIGGER IF EXISTS revenue_daily_updated_at ON revenue_daily_aggregates`;
  await sql`DROP INDEX IF EXISTS idx_revenue_daily_date`;
  await sql`DROP TABLE IF EXISTS revenue_daily_aggregates CASCADE`;

  // Drop analytics_daily_aggregates table
  await sql`DROP TRIGGER IF EXISTS analytics_daily_updated_at ON analytics_daily_aggregates`;
  await sql`DROP INDEX IF EXISTS idx_analytics_daily_date`;
  await sql`DROP TABLE IF EXISTS analytics_daily_aggregates CASCADE`;
}
