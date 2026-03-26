/**
 * Migration: Create messaging_channels table for multi-platform messaging integrations
 * Created: 2026-03-26
 *
 * Stores linked messaging channels (Telegram, Discord, WhatsApp, SMS) between
 * Campfire users/companions and external messaging platforms.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create messaging_channels table
  await sql`
    CREATE TABLE IF NOT EXISTS messaging_channels (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      platform_channel_id VARCHAR(255) NOT NULL,
      platform_user_id VARCHAR(255) NOT NULL,
      platform_bot_id VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      config JSONB NOT NULL DEFAULT '{}',
      last_message_at TIMESTAMPTZ,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, companion_id, platform)
    )
  `;

  // Indexes for common query patterns
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_platform ON messaging_channels(platform)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_user_id ON messaging_channels(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_companion_id ON messaging_channels(companion_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_is_active ON messaging_channels(is_active) WHERE is_active = true`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_platform_user ON messaging_channels(platform_user_id, platform_bot_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_channels_platform_channel ON messaging_channels(platform_channel_id, platform_bot_id)`;

  // Create messaging_link_codes table for temporary verification codes
  await sql`
    CREATE TABLE IF NOT EXISTS messaging_link_codes (
      code VARCHAR(20) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      platform_bot_id VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_messaging_link_codes_expires_at ON messaging_link_codes(expires_at)`;

  // Create telegram_bot_configs table for per-companion Telegram bot settings
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_bot_configs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE UNIQUE,
      bot_token_encrypted VARCHAR(512) NOT NULL,
      bot_username VARCHAR(255),
      webhook_url VARCHAR(512),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_telegram_bot_configs_companion_id ON telegram_bot_configs(companion_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_telegram_bot_configs_is_active ON telegram_bot_configs(is_active) WHERE is_active = true`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS telegram_bot_configs`;
  await sql`DROP TABLE IF EXISTS messaging_link_codes`;
  await sql`DROP TABLE IF EXISTS messaging_channels`;
}
