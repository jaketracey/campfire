/**
 * Migration: Create User Tables
 * Created: 2026-01-01
 *
 * User authentication and profile tables:
 * - users: Core authentication data
 * - user_profiles: Extended profile information
 * - user_mfa: Multi-factor authentication settings
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // User status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // MFA method enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE mfa_method AS ENUM ('totp', 'sms', 'email');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Users Table (Core Authentication)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL,
      email_normalized VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      status user_status NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      login_count INTEGER NOT NULL DEFAULT 0,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT users_email_unique UNIQUE (email_normalized)
    )
  `;

  // Index for email lookups (case-insensitive via normalized email)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_email
    ON users (email_normalized)
  `;

  // Index for status filtering
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_status
    ON users (status)
    WHERE status != 'deleted'
  `;

  // Trigger to auto-update updated_at
  await sql`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  // Function to normalize email
  await sql`
    CREATE OR REPLACE FUNCTION normalize_email(email VARCHAR)
    RETURNS VARCHAR AS $$
    BEGIN
      RETURN LOWER(TRIM(email));
    END;
    $$ LANGUAGE plpgsql IMMUTABLE
  `;

  // Trigger to auto-normalize email
  await sql`
    CREATE OR REPLACE FUNCTION set_normalized_email()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.email_normalized = normalize_email(NEW.email);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER users_normalize_email
    BEFORE INSERT OR UPDATE OF email ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_normalized_email()
  `;

  await sql`
    COMMENT ON TABLE users IS 'Core user authentication data'
  `;

  // =========================================================================
  // User Profiles Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name VARCHAR(100),
      avatar_url VARCHAR(2048),
      bio TEXT,
      timezone VARCHAR(50) DEFAULT 'UTC',
      locale VARCHAR(10) DEFAULT 'en-US',
      preferences JSONB NOT NULL DEFAULT '{}',
      onboarding_completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_profiles_user_unique UNIQUE (user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
    ON user_profiles (user_id)
  `;

  await sql`
    CREATE TRIGGER user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE user_profiles IS 'Extended user profile information'
  `;

  // GIN index for preferences JSONB queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_profiles_preferences
    ON user_profiles USING GIN (preferences jsonb_path_ops)
  `;

  // =========================================================================
  // User MFA Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_mfa (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method mfa_method NOT NULL,
      secret_encrypted TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMPTZ,
      backup_codes_hash TEXT[],
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_mfa_user_method_unique UNIQUE (user_id, method)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_mfa_user_id
    ON user_mfa (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled
    ON user_mfa (user_id)
    WHERE enabled = TRUE
  `;

  await sql`
    CREATE TRIGGER user_mfa_updated_at
    BEFORE UPDATE ON user_mfa
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE user_mfa IS 'Multi-factor authentication settings per user'
  `;
  await sql`
    COMMENT ON COLUMN user_mfa.secret_encrypted IS 'Encrypted TOTP secret or phone number (for SMS)'
  `;
  await sql`
    COMMENT ON COLUMN user_mfa.backup_codes_hash IS 'Array of hashed backup codes'
  `;

  // =========================================================================
  // User Sessions Table (for JWT invalidation)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL,
      device_info JSONB,
      ip_address INET,
      user_agent TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_sessions_token_unique UNIQUE (token_hash)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
    ON user_sessions (user_id)
    WHERE revoked_at IS NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at)
    WHERE revoked_at IS NULL
  `;

  await sql`
    COMMENT ON TABLE user_sessions IS 'Active user sessions for token validation and revocation'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_sessions CASCADE`;
  await sql`DROP TABLE IF EXISTS user_mfa CASCADE`;
  await sql`DROP TABLE IF EXISTS user_profiles CASCADE`;
  await sql`DROP TRIGGER IF EXISTS users_updated_at ON users`;
  await sql`DROP TRIGGER IF EXISTS users_normalize_email ON users`;
  await sql`DROP TABLE IF EXISTS users CASCADE`;
  await sql`DROP FUNCTION IF EXISTS set_normalized_email()`;
  await sql`DROP FUNCTION IF EXISTS normalize_email(VARCHAR)`;
  await sql`DROP FUNCTION IF EXISTS update_updated_at()`;
  await sql`DROP TYPE IF EXISTS mfa_method`;
  await sql`DROP TYPE IF EXISTS user_status`;
}
