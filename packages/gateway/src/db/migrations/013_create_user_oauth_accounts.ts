/**
 * Migration: Create User OAuth Accounts Table
 * Created: 2026-01-01
 *
 * Stores OAuth provider connections for users (Google, etc.)
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // OAuth provider enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE oauth_provider AS ENUM ('google', 'github', 'apple');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // User OAuth Accounts Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_oauth_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider oauth_provider NOT NULL,
      provider_user_id VARCHAR(255) NOT NULL,
      provider_email VARCHAR(255),
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      profile_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_oauth_accounts_provider_unique UNIQUE (provider, provider_user_id),
      CONSTRAINT user_oauth_accounts_user_provider_unique UNIQUE (user_id, provider)
    )
  `;

  // Index for user lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_oauth_accounts_user_id
    ON user_oauth_accounts (user_id)
  `;

  // Index for provider + provider_user_id lookups (for login)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_oauth_accounts_provider_lookup
    ON user_oauth_accounts (provider, provider_user_id)
  `;

  await sql`
    CREATE TRIGGER user_oauth_accounts_updated_at
    BEFORE UPDATE ON user_oauth_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE user_oauth_accounts IS 'OAuth provider connections for users'
  `;
  await sql`
    COMMENT ON COLUMN user_oauth_accounts.provider_user_id IS 'Unique user ID from the OAuth provider'
  `;
  await sql`
    COMMENT ON COLUMN user_oauth_accounts.profile_data IS 'Additional profile data from the OAuth provider'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_oauth_accounts CASCADE`;
  await sql`DROP TYPE IF EXISTS oauth_provider`;
}
