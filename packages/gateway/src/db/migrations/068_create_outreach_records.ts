/**
 * Migration: Create outreach_records table for proactive companion outreach
 * Created: 2026-03-26
 *
 * Stores records of proactive outreach messages sent by companions,
 * tracking delivery, engagement, and whether outreach led to conversations.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create outreach trigger enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE outreach_trigger AS ENUM (
        'scheduled_checkin',
        'followup',
        'time_based',
        'emotional_support',
        'milestone'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Create delivery channel enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE outreach_delivery_channel AS ENUM (
        'websocket',
        'push',
        'telegram',
        'discord',
        'stored'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Create outreach_records table
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      trigger outreach_trigger NOT NULL,
      message TEXT NOT NULL,
      delivered_via outreach_delivery_channel NOT NULL DEFAULT 'stored',
      delivered_at TIMESTAMPTZ,
      was_opened BOOLEAN NOT NULL DEFAULT FALSE,
      led_to_conversation BOOLEAN NOT NULL DEFAULT FALSE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Index for looking up outreach by user+companion pair (most common query)
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_records_user_companion
    ON outreach_records(user_id, companion_id)`;

  // Index for time-based queries (frequency checks, analytics)
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_records_delivered_at
    ON outreach_records(delivered_at)`;

  // Index for filtering by trigger type (analytics)
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_records_trigger
    ON outreach_records(trigger)`;

  // Index for pending (undelivered) outreach lookup
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_records_pending
    ON outreach_records(user_id, delivered_at)
    WHERE delivered_at IS NULL`;

  // Create outreach_config table for per-companion outreach settings
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_config (
      companion_id UUID PRIMARY KEY REFERENCES companions(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      min_interval_hours INTEGER NOT NULL DEFAULT 24,
      max_daily INTEGER NOT NULL DEFAULT 1,
      quiet_hours_start INTEGER NOT NULL DEFAULT 22,
      quiet_hours_end INTEGER NOT NULL DEFAULT 8,
      triggers_enabled JSONB NOT NULL DEFAULT '["scheduled_checkin", "followup", "time_based"]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS outreach_config`;
  await sql`DROP TABLE IF EXISTS outreach_records`;
  await sql`DROP TYPE IF EXISTS outreach_delivery_channel`;
  await sql`DROP TYPE IF EXISTS outreach_trigger`;
}
