/**
 * Migration: Create Engagement Tracking Tables
 * Created: 2026-01-02
 *
 * Engagement-based conversion system:
 * - engagement_signals: Per-message engagement metrics
 * - anonymous_usage: Extended with engagement scores
 * - admin_settings: Engagement thresholds configuration
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Engagement Signals Table (per-message granularity)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS engagement_signals (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      anonymous_usage_id UUID NOT NULL REFERENCES anonymous_usage(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      message_number INTEGER NOT NULL,

      -- Emotional depth signals (0-100 each)
      sentiment_score INTEGER NOT NULL DEFAULT 0,
      personal_pronoun_density INTEGER NOT NULL DEFAULT 0,
      vulnerability_score INTEGER NOT NULL DEFAULT 0,
      emotional_language_score INTEGER NOT NULL DEFAULT 0,

      -- Investment signals (0-100 each)
      message_length_score INTEGER NOT NULL DEFAULT 0,
      question_engagement_score INTEGER NOT NULL DEFAULT 0,
      topic_depth_score INTEGER NOT NULL DEFAULT 0,
      response_time_score INTEGER NOT NULL DEFAULT 0,

      -- Computed scores (0-100 each)
      emotional_depth_score INTEGER NOT NULL DEFAULT 0,
      investment_score INTEGER NOT NULL DEFAULT 0,
      combined_score INTEGER NOT NULL DEFAULT 0,

      -- Raw metrics for analysis
      message_length INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      question_count INTEGER NOT NULL DEFAULT 0,
      response_time_ms INTEGER,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_engagement_signals_usage
    ON engagement_signals (anonymous_usage_id, message_number)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_engagement_signals_session
    ON engagement_signals (session_id)
    WHERE session_id IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE engagement_signals IS 'Per-message engagement metrics for conversion optimization'
  `;

  // =========================================================================
  // Extend anonymous_usage with engagement scores
  // =========================================================================
  await sql`
    ALTER TABLE anonymous_usage
    ADD COLUMN IF NOT EXISTS engagement_score INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE anonymous_usage
    ADD COLUMN IF NOT EXISTS peak_engagement_score INTEGER NOT NULL DEFAULT 0
  `;

  await sql`
    ALTER TABLE anonymous_usage
    ADD COLUMN IF NOT EXISTS conversion_triggered_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE anonymous_usage
    ADD COLUMN IF NOT EXISTS conversion_trigger_message INTEGER
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_anonymous_usage_engagement
    ON anonymous_usage (engagement_score DESC)
  `;

  // =========================================================================
  // Admin Settings: Engagement Conversion Thresholds
  // =========================================================================
  await sql`
    INSERT INTO admin_settings (key, value, description)
    VALUES (
      'engagement_conversion_threshold',
      '{"value": 70}'::jsonb,
      'Engagement score (0-100) required to trigger conversion'
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description
  `;

  await sql`
    INSERT INTO admin_settings (key, value, description)
    VALUES (
      'engagement_min_messages',
      '{"value": 3}'::jsonb,
      'Minimum messages before checking engagement for conversion'
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description
  `;

  await sql`
    INSERT INTO admin_settings (key, value, description)
    VALUES (
      'engagement_max_messages',
      '{"value": 10}'::jsonb,
      'Maximum messages before forced conversion regardless of engagement'
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove admin settings
  await sql`DELETE FROM admin_settings WHERE key = 'engagement_conversion_threshold'`;
  await sql`DELETE FROM admin_settings WHERE key = 'engagement_min_messages'`;
  await sql`DELETE FROM admin_settings WHERE key = 'engagement_max_messages'`;

  // Remove index on anonymous_usage
  await sql`DROP INDEX IF EXISTS idx_anonymous_usage_engagement`;

  // Remove columns from anonymous_usage
  await sql`ALTER TABLE anonymous_usage DROP COLUMN IF EXISTS conversion_trigger_message`;
  await sql`ALTER TABLE anonymous_usage DROP COLUMN IF EXISTS conversion_triggered_at`;
  await sql`ALTER TABLE anonymous_usage DROP COLUMN IF EXISTS peak_engagement_score`;
  await sql`ALTER TABLE anonymous_usage DROP COLUMN IF EXISTS engagement_score`;

  // Drop engagement_signals table
  await sql`DROP INDEX IF EXISTS idx_engagement_signals_session`;
  await sql`DROP INDEX IF EXISTS idx_engagement_signals_usage`;
  await sql`DROP TABLE IF EXISTS engagement_signals CASCADE`;
}
