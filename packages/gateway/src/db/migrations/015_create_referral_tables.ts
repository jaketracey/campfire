/**
 * Migration: Create Referral/Invite Code Tables
 * Created: 2026-01-01
 *
 * Referral system tables:
 * - invite_codes: User-owned unique referral codes
 * - user_referrals: Tracks signups via referral codes
 * - pending_invites: Admin-initiated email invitations
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Invite status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Invite Codes Table (User Referral Codes)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Unique invite code (e.g., "JAKE2024", "FRIEND123")
      code VARCHAR(20) NOT NULL,

      -- Stats
      uses_count INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER, -- NULL = unlimited

      -- Status
      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,

      CONSTRAINT invite_codes_code_unique UNIQUE (code),
      CONSTRAINT invite_codes_user_unique UNIQUE (user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_invite_codes_code
    ON invite_codes (UPPER(code))
    WHERE is_active = TRUE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_invite_codes_user
    ON invite_codes (user_id)
  `;

  await sql`
    CREATE TRIGGER invite_codes_updated_at
    BEFORE UPDATE ON invite_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE invite_codes IS 'User-owned referral codes for tracking signups'
  `;

  // =========================================================================
  // User Referrals Table (Tracks who signed up via which code)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_referrals (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- The user who signed up
      referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- The user who referred them (owner of the invite code)
      referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- The code used
      invite_code_id UUID NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
      code_used VARCHAR(20) NOT NULL,

      -- Conversion tracking
      converted_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_referrals_referred_unique UNIQUE (referred_user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_referrals_referrer
    ON user_referrals (referrer_user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_referrals_code
    ON user_referrals (invite_code_id)
  `;

  await sql`
    COMMENT ON TABLE user_referrals IS 'Tracks which users signed up via which referral codes'
  `;

  // =========================================================================
  // Pending Invites Table (Admin-initiated email invitations)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS pending_invites (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Invite details
      email VARCHAR(255) NOT NULL,
      email_normalized VARCHAR(255) NOT NULL,
      token VARCHAR(64) NOT NULL,

      -- Who sent the invite
      invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      -- Status
      status invite_status NOT NULL DEFAULT 'pending',

      -- Metadata
      message TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
      accepted_at TIMESTAMPTZ,
      accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      CONSTRAINT pending_invites_token_unique UNIQUE (token)
    )
  `;

  // Trigger to normalize email on insert
  await sql`
    CREATE TRIGGER pending_invites_normalize_email
    BEFORE INSERT OR UPDATE OF email ON pending_invites
    FOR EACH ROW
    EXECUTE FUNCTION set_normalized_email()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pending_invites_token
    ON pending_invites (token)
    WHERE status = 'pending'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pending_invites_email
    ON pending_invites (email_normalized)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pending_invites_status
    ON pending_invites (status, expires_at)
    WHERE status = 'pending'
  `;

  await sql`
    COMMENT ON TABLE pending_invites IS 'Admin-initiated email invitations with tokens'
  `;

  // =========================================================================
  // Trigger: Increment uses_count when a referral is recorded
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION increment_invite_uses()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE invite_codes
      SET uses_count = uses_count + 1
      WHERE id = NEW.invite_code_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER user_referrals_increment_uses
    AFTER INSERT ON user_referrals
    FOR EACH ROW
    EXECUTE FUNCTION increment_invite_uses()
  `;

  // =========================================================================
  // Function: Generate unique invite code
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION generate_invite_code()
    RETURNS VARCHAR(8) AS $$
    DECLARE
      v_code VARCHAR(8);
      v_exists BOOLEAN;
      v_chars VARCHAR(36) := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      v_i INTEGER;
    BEGIN
      -- Try to generate a unique code (up to 10 attempts)
      FOR attempt IN 1..10 LOOP
        -- Generate 8 character code from allowed chars (no O/0/I/1 confusion)
        v_code := '';
        FOR v_i IN 1..8 LOOP
          v_code := v_code || SUBSTR(v_chars, FLOOR(RANDOM() * LENGTH(v_chars) + 1)::INTEGER, 1);
        END LOOP;

        SELECT EXISTS(SELECT 1 FROM invite_codes WHERE code = v_code) INTO v_exists;

        IF NOT v_exists THEN
          RETURN v_code;
        END IF;
      END LOOP;

      -- Fallback: timestamp-based
      RETURN UPPER(SUBSTRING(MD5(NOW()::TEXT || RANDOM()::TEXT) FROM 1 FOR 8));
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS generate_invite_code()`;
  await sql`DROP TRIGGER IF EXISTS user_referrals_increment_uses ON user_referrals`;
  await sql`DROP FUNCTION IF EXISTS increment_invite_uses()`;

  await sql`DROP INDEX IF EXISTS idx_pending_invites_status`;
  await sql`DROP INDEX IF EXISTS idx_pending_invites_email`;
  await sql`DROP INDEX IF EXISTS idx_pending_invites_token`;
  await sql`DROP TRIGGER IF EXISTS pending_invites_normalize_email ON pending_invites`;
  await sql`DROP TABLE IF EXISTS pending_invites CASCADE`;

  await sql`DROP INDEX IF EXISTS idx_user_referrals_code`;
  await sql`DROP INDEX IF EXISTS idx_user_referrals_referrer`;
  await sql`DROP TABLE IF EXISTS user_referrals CASCADE`;

  await sql`DROP TRIGGER IF EXISTS invite_codes_updated_at ON invite_codes`;
  await sql`DROP INDEX IF EXISTS idx_invite_codes_user`;
  await sql`DROP INDEX IF EXISTS idx_invite_codes_code`;
  await sql`DROP TABLE IF EXISTS invite_codes CASCADE`;

  await sql`DROP TYPE IF EXISTS invite_status`;
}
