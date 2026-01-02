/**
 * Migration: Create Freemium Feature Tables
 * Created: 2026-01-02
 *
 * Freemium system tables:
 * - admin_settings: Key-value store for system configuration
 * - demo_companions: Companions available for anonymous trial
 * - anonymous_usage: Tracks anonymous user trial usage
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Admin Settings Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TRIGGER admin_settings_updated_at
    BEFORE UPDATE ON admin_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE admin_settings IS 'System-wide configuration key-value store'
  `;

  // =========================================================================
  // Demo Companions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS demo_companions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT demo_companions_companion_unique UNIQUE (companion_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_demo_companions_active
    ON demo_companions (display_order)
    WHERE is_active = TRUE
  `;

  await sql`
    COMMENT ON TABLE demo_companions IS 'Companions available for anonymous user trials'
  `;

  // =========================================================================
  // Anonymous Usage Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS anonymous_usage (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      device_fingerprint VARCHAR(64) NOT NULL,
      ip_address INET,
      messages_used INTEGER NOT NULL DEFAULT 0,
      last_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      converted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      CONSTRAINT anonymous_usage_fingerprint_unique UNIQUE (device_fingerprint)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_anonymous_usage_fingerprint
    ON anonymous_usage (device_fingerprint)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_anonymous_usage_converted
    ON anonymous_usage (converted_user_id)
    WHERE converted_user_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_anonymous_usage_last_seen
    ON anonymous_usage (last_seen_at DESC)
  `;

  await sql`
    COMMENT ON TABLE anonymous_usage IS 'Tracks anonymous user trial sessions and message limits'
  `;

  // =========================================================================
  // System Anonymous User
  // =========================================================================
  await sql`
    INSERT INTO users (id, email, password_hash, status, role, email_verified)
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      'anonymous@system.campfire.local',
      'SYSTEM_NO_LOGIN',
      'active',
      'user',
      TRUE
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // =========================================================================
  // Initial Admin Setting: Free Trial Message Limit
  // =========================================================================
  await sql`
    INSERT INTO admin_settings (key, value, description)
    VALUES (
      'free_trial_message_limit',
      '{"value": 4}'::jsonb,
      'Max messages for anonymous users'
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove initial admin setting
  await sql`DELETE FROM admin_settings WHERE key = 'free_trial_message_limit'`;

  // Remove system anonymous user
  await sql`DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000000'`;

  // Drop anonymous_usage table
  await sql`DROP INDEX IF EXISTS idx_anonymous_usage_last_seen`;
  await sql`DROP INDEX IF EXISTS idx_anonymous_usage_converted`;
  await sql`DROP INDEX IF EXISTS idx_anonymous_usage_fingerprint`;
  await sql`DROP TABLE IF EXISTS anonymous_usage CASCADE`;

  // Drop demo_companions table
  await sql`DROP INDEX IF EXISTS idx_demo_companions_active`;
  await sql`DROP TABLE IF EXISTS demo_companions CASCADE`;

  // Drop admin_settings table
  await sql`DROP TRIGGER IF EXISTS admin_settings_updated_at ON admin_settings`;
  await sql`DROP TABLE IF EXISTS admin_settings CASCADE`;
}
