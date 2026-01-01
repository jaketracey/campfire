/**
 * Migration: Create Billing Tables
 * Created: 2026-01-01
 *
 * Stripe billing integration:
 * - subscriptions: User subscription state
 * - billing_events: Stripe webhook event log for idempotency
 * - usage_records: Tracked usage for metered billing
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Subscription status enum (matches Stripe statuses)
  await sql`
    DO $$ BEGIN
      CREATE TYPE subscription_status AS ENUM (
        'trialing',
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired',
        'paused'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Subscription plan enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE subscription_plan AS ENUM ('free', 'starter', 'pro', 'enterprise');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Subscriptions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Stripe identifiers
      stripe_customer_id VARCHAR(255) NOT NULL,
      stripe_subscription_id VARCHAR(255),
      stripe_price_id VARCHAR(255),

      -- Subscription state
      status subscription_status NOT NULL DEFAULT 'incomplete',
      plan subscription_plan NOT NULL DEFAULT 'free',

      -- Billing period
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,

      -- Cancellation
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      canceled_at TIMESTAMPTZ,
      cancel_reason TEXT,

      -- Trial
      trial_start TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,

      -- Usage limits (denormalized for fast access)
      voice_minutes_limit INTEGER,
      voice_minutes_used INTEGER NOT NULL DEFAULT 0,
      message_limit INTEGER,
      messages_used INTEGER NOT NULL DEFAULT 0,
      companion_limit INTEGER NOT NULL DEFAULT 1,

      -- Metadata
      metadata JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- One subscription per user (for now)
      CONSTRAINT subscriptions_user_unique UNIQUE (user_id),
      CONSTRAINT subscriptions_stripe_unique UNIQUE (stripe_subscription_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
    ON subscriptions (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
    ON subscriptions (stripe_customer_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON subscriptions (status)
    WHERE status IN ('active', 'trialing', 'past_due')
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
    ON subscriptions (current_period_end)
    WHERE status = 'active'
  `;

  await sql`
    CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE subscriptions IS 'User subscription state synchronized with Stripe'
  `;

  // Function to check if user has active subscription
  await sql`
    CREATE OR REPLACE FUNCTION has_active_subscription(p_user_id UUID)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM subscriptions
        WHERE user_id = p_user_id
          AND status IN ('active', 'trialing')
          AND (current_period_end IS NULL OR current_period_end > NOW())
      );
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to get user's plan
  await sql`
    CREATE OR REPLACE FUNCTION get_user_plan(p_user_id UUID)
    RETURNS subscription_plan AS $$
    DECLARE
      v_plan subscription_plan;
    BEGIN
      SELECT plan INTO v_plan
      FROM subscriptions
      WHERE user_id = p_user_id
        AND status IN ('active', 'trialing');

      RETURN COALESCE(v_plan, 'free');
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // =========================================================================
  // Billing Events Table (Webhook Log)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS billing_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      -- Stripe event data
      stripe_event_id VARCHAR(255) NOT NULL,
      stripe_event_type VARCHAR(255) NOT NULL,
      stripe_api_version VARCHAR(50),

      -- Event payload
      payload JSONB NOT NULL,

      -- Processing state
      processed BOOLEAN NOT NULL DEFAULT FALSE,
      processed_at TIMESTAMPTZ,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,

      -- Idempotency
      idempotency_key VARCHAR(255),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Ensure we don't process the same event twice
      CONSTRAINT billing_events_stripe_unique UNIQUE (stripe_event_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_user_id
    ON billing_events (user_id)
    WHERE user_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_type
    ON billing_events (stripe_event_type, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_unprocessed
    ON billing_events (created_at)
    WHERE processed = FALSE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_errors
    ON billing_events (created_at)
    WHERE error IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE billing_events IS 'Stripe webhook events log for idempotent processing'
  `;

  // =========================================================================
  // Usage Records Table (for metered billing)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS usage_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,

      -- Usage type
      usage_type VARCHAR(50) NOT NULL,

      -- Quantity
      quantity INTEGER NOT NULL DEFAULT 0,
      unit VARCHAR(20) NOT NULL DEFAULT 'count',

      -- Period
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,

      -- Stripe sync
      stripe_usage_record_id VARCHAR(255),
      synced_to_stripe BOOLEAN NOT NULL DEFAULT FALSE,
      synced_at TIMESTAMPTZ,

      -- Source tracking
      source_session_id UUID,
      source_event_ids UUID[] NOT NULL DEFAULT '{}',

      metadata JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_user_type
    ON usage_records (user_id, usage_type, period_start DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_period
    ON usage_records (period_start, period_end)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_unsynced
    ON usage_records (created_at)
    WHERE synced_to_stripe = FALSE
  `;

  await sql`
    COMMENT ON TABLE usage_records IS 'Usage tracking for metered billing (voice minutes, messages, etc.)'
  `;

  // Function to record usage
  await sql`
    CREATE OR REPLACE FUNCTION record_usage(
      p_user_id UUID,
      p_usage_type VARCHAR,
      p_quantity INTEGER,
      p_source_event_id UUID DEFAULT NULL
    )
    RETURNS UUID AS $$
    DECLARE
      v_period_start TIMESTAMPTZ;
      v_period_end TIMESTAMPTZ;
      v_record_id UUID;
      v_subscription_id UUID;
    BEGIN
      -- Get current billing period
      SELECT id, current_period_start, current_period_end
      INTO v_subscription_id, v_period_start, v_period_end
      FROM subscriptions
      WHERE user_id = p_user_id AND status IN ('active', 'trialing');

      -- Default to current month if no subscription
      IF v_period_start IS NULL THEN
        v_period_start := DATE_TRUNC('month', NOW());
        v_period_end := DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
      END IF;

      -- Insert usage record
      INSERT INTO usage_records (
        user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, source_event_ids
      )
      VALUES (
        p_user_id, v_subscription_id, p_usage_type, p_quantity, 'count',
        v_period_start, v_period_end,
        CASE WHEN p_source_event_id IS NOT NULL THEN ARRAY[p_source_event_id] ELSE '{}' END
      )
      RETURNING id INTO v_record_id;

      -- Update subscription usage counters
      IF p_usage_type = 'voice_minutes' THEN
        UPDATE subscriptions
        SET voice_minutes_used = voice_minutes_used + p_quantity
        WHERE id = v_subscription_id;
      ELSIF p_usage_type = 'messages' THEN
        UPDATE subscriptions
        SET messages_used = messages_used + p_quantity
        WHERE id = v_subscription_id;
      END IF;

      RETURN v_record_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to check usage limits
  await sql`
    CREATE OR REPLACE FUNCTION check_usage_limit(
      p_user_id UUID,
      p_usage_type VARCHAR
    )
    RETURNS TABLE (
      allowed BOOLEAN,
      current_usage INTEGER,
      limit_amount INTEGER,
      remaining INTEGER
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        CASE
          WHEN p_usage_type = 'voice_minutes' THEN
            s.voice_minutes_limit IS NULL OR s.voice_minutes_used < s.voice_minutes_limit
          WHEN p_usage_type = 'messages' THEN
            s.message_limit IS NULL OR s.messages_used < s.message_limit
          WHEN p_usage_type = 'companions' THEN
            (SELECT COUNT(*) FROM companions c WHERE c.user_id = p_user_id AND c.status != 'archived') < s.companion_limit
          ELSE TRUE
        END AS allowed,
        CASE
          WHEN p_usage_type = 'voice_minutes' THEN s.voice_minutes_used
          WHEN p_usage_type = 'messages' THEN s.messages_used
          WHEN p_usage_type = 'companions' THEN (SELECT COUNT(*)::INTEGER FROM companions c WHERE c.user_id = p_user_id AND c.status != 'archived')
          ELSE 0
        END AS current_usage,
        CASE
          WHEN p_usage_type = 'voice_minutes' THEN s.voice_minutes_limit
          WHEN p_usage_type = 'messages' THEN s.message_limit
          WHEN p_usage_type = 'companions' THEN s.companion_limit
          ELSE NULL
        END AS limit_amount,
        CASE
          WHEN p_usage_type = 'voice_minutes' THEN
            COALESCE(s.voice_minutes_limit - s.voice_minutes_used, 999999)
          WHEN p_usage_type = 'messages' THEN
            COALESCE(s.message_limit - s.messages_used, 999999)
          WHEN p_usage_type = 'companions' THEN
            s.companion_limit - (SELECT COUNT(*)::INTEGER FROM companions c WHERE c.user_id = p_user_id AND c.status != 'archived')
          ELSE 999999
        END AS remaining
      FROM subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('active', 'trialing');
    END;
    $$ LANGUAGE plpgsql STABLE
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS check_usage_limit(UUID, VARCHAR)`;
  await sql`DROP FUNCTION IF EXISTS record_usage(UUID, VARCHAR, INTEGER, UUID)`;
  await sql`DROP TABLE IF EXISTS usage_records CASCADE`;
  await sql`DROP TABLE IF EXISTS billing_events CASCADE`;
  await sql`DROP FUNCTION IF EXISTS get_user_plan(UUID)`;
  await sql`DROP FUNCTION IF EXISTS has_active_subscription(UUID)`;
  await sql`DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions`;
  await sql`DROP TABLE IF EXISTS subscriptions CASCADE`;
  await sql`DROP TYPE IF EXISTS subscription_plan`;
  await sql`DROP TYPE IF EXISTS subscription_status`;
}
