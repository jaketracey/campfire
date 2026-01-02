/**
 * Migration: Create Affiliate Program Tables
 * Created: 2026-01-02
 *
 * Affiliate program tables:
 * - affiliates: Partner accounts with commission rates
 * - affiliate_clicks: Click tracking for attribution
 * - affiliate_conversions: Conversion tracking with payout status
 * - affiliate_sessions: JWT session management for affiliates
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Enums
  // =========================================================================
  await sql`
    DO $$ BEGIN
      CREATE TYPE affiliate_status AS ENUM ('active', 'suspended', 'inactive');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    DO $$ BEGIN
      CREATE TYPE conversion_status AS ENUM ('pending', 'approved', 'paid', 'rejected');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    DO $$ BEGIN
      CREATE TYPE plan_tier AS ENUM ('standard', 'premium');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Affiliates Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS affiliates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Identity
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      email_normalized VARCHAR(255) NOT NULL,
      code VARCHAR(50) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,

      -- Commission rates (in cents)
      commission_standard INTEGER NOT NULL DEFAULT 500,  -- $5 default for Standard tier
      commission_premium INTEGER NOT NULL DEFAULT 2500,  -- $25 default for Premium tier

      -- Status
      status affiliate_status NOT NULL DEFAULT 'active',

      -- Payout information (PayPal email, bank details, etc.)
      payout_info JSONB NOT NULL DEFAULT '{}',

      -- Admin notes
      notes TEXT,

      -- Aggregate stats (updated by triggers)
      total_clicks INTEGER NOT NULL DEFAULT 0,
      total_conversions INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,  -- cents
      total_paid INTEGER NOT NULL DEFAULT 0,    -- cents

      -- Timestamps
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT affiliates_email_unique UNIQUE (email_normalized),
      CONSTRAINT affiliates_code_unique UNIQUE (code)
    )
  `;

  // Trigger for email normalization
  await sql`
    CREATE TRIGGER affiliates_normalize_email
    BEFORE INSERT OR UPDATE OF email ON affiliates
    FOR EACH ROW
    EXECUTE FUNCTION set_normalized_email()
  `;

  await sql`
    CREATE TRIGGER affiliates_updated_at
    BEFORE UPDATE ON affiliates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliates_code
    ON affiliates (UPPER(code))
    WHERE status = 'active'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliates_status
    ON affiliates (status)
  `;

  await sql`
    COMMENT ON TABLE affiliates IS 'Affiliate partners with commission rates and payout info'
  `;

  // =========================================================================
  // Affiliate Clicks Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,

      -- Tracking data (IP hashed for privacy)
      ip_hash VARCHAR(64),
      user_agent TEXT,
      referrer_url TEXT,
      landing_page TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate_date
    ON affiliate_clicks (affiliate_id, created_at DESC)
  `;

  await sql`
    COMMENT ON TABLE affiliate_clicks IS 'Tracks clicks on affiliate referral links'
  `;

  // =========================================================================
  // Affiliate Conversions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_conversions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      click_id UUID REFERENCES affiliate_clicks(id) ON DELETE SET NULL,

      -- Conversion details
      plan_tier plan_tier NOT NULL,
      commission_amount INTEGER NOT NULL,  -- cents, locked at time of conversion
      status conversion_status NOT NULL DEFAULT 'pending',

      -- Rejection reason (if rejected)
      rejection_reason TEXT,

      -- Payment tracking
      paid_at TIMESTAMPTZ,
      stripe_invoice_id VARCHAR(255),

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TRIGGER affiliate_conversions_updated_at
    BEFORE UPDATE ON affiliate_conversions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate_status
    ON affiliate_conversions (affiliate_id, status)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_status_date
    ON affiliate_conversions (status, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_user
    ON affiliate_conversions (user_id)
  `;

  await sql`
    COMMENT ON TABLE affiliate_conversions IS 'Tracks successful conversions from affiliate referrals'
  `;

  // =========================================================================
  // Affiliate Sessions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS affiliate_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,

      -- Token (hashed)
      token_hash VARCHAR(64) NOT NULL,

      -- Device info
      ip_address INET,
      user_agent TEXT,

      -- Expiration
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_sessions_token
    ON affiliate_sessions (token_hash)
    WHERE revoked_at IS NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_affiliate_sessions_affiliate
    ON affiliate_sessions (affiliate_id, expires_at DESC)
    WHERE revoked_at IS NULL
  `;

  await sql`
    COMMENT ON TABLE affiliate_sessions IS 'JWT session tracking for affiliate authentication'
  `;

  // =========================================================================
  // Add affiliate tracking columns to users table
  // =========================================================================
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS affiliate_click_id UUID REFERENCES affiliate_clicks(id) ON DELETE SET NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_affiliate
    ON users (affiliate_id)
    WHERE affiliate_id IS NOT NULL
  `;

  // =========================================================================
  // Trigger: Update affiliate stats on conversion changes
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION update_affiliate_stats()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Handle INSERT
      IF TG_OP = 'INSERT' THEN
        UPDATE affiliates
        SET
          total_conversions = total_conversions + 1,
          total_earned = total_earned + NEW.commission_amount
        WHERE id = NEW.affiliate_id;
        RETURN NEW;
      END IF;

      -- Handle UPDATE (status changes)
      IF TG_OP = 'UPDATE' THEN
        -- If marked as paid
        IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
          UPDATE affiliates
          SET total_paid = total_paid + NEW.commission_amount
          WHERE id = NEW.affiliate_id;
        END IF;

        -- If rejected after being counted
        IF NEW.status = 'rejected' AND OLD.status IN ('pending', 'approved') THEN
          UPDATE affiliates
          SET
            total_conversions = total_conversions - 1,
            total_earned = total_earned - NEW.commission_amount
          WHERE id = NEW.affiliate_id;
        END IF;

        RETURN NEW;
      END IF;

      -- Handle DELETE
      IF TG_OP = 'DELETE' THEN
        IF OLD.status != 'rejected' THEN
          UPDATE affiliates
          SET
            total_conversions = total_conversions - 1,
            total_earned = total_earned - OLD.commission_amount
          WHERE id = OLD.affiliate_id;
        END IF;
        RETURN OLD;
      END IF;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER affiliate_conversions_update_stats
    AFTER INSERT OR UPDATE OR DELETE ON affiliate_conversions
    FOR EACH ROW
    EXECUTE FUNCTION update_affiliate_stats()
  `;

  // =========================================================================
  // Trigger: Update click count on affiliate
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION increment_affiliate_clicks()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE affiliates
      SET total_clicks = total_clicks + 1
      WHERE id = NEW.affiliate_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER affiliate_clicks_increment
    AFTER INSERT ON affiliate_clicks
    FOR EACH ROW
    EXECUTE FUNCTION increment_affiliate_clicks()
  `;

  // =========================================================================
  // Function: Generate unique affiliate code
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION generate_affiliate_code()
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

        SELECT EXISTS(SELECT 1 FROM affiliates WHERE code = v_code) INTO v_exists;

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
  // Drop functions and triggers
  await sql`DROP FUNCTION IF EXISTS generate_affiliate_code()`;
  await sql`DROP TRIGGER IF EXISTS affiliate_clicks_increment ON affiliate_clicks`;
  await sql`DROP FUNCTION IF EXISTS increment_affiliate_clicks()`;
  await sql`DROP TRIGGER IF EXISTS affiliate_conversions_update_stats ON affiliate_conversions`;
  await sql`DROP FUNCTION IF EXISTS update_affiliate_stats()`;

  // Remove columns from users
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS affiliate_click_id`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS affiliate_id`;

  // Drop tables
  await sql`DROP TABLE IF EXISTS affiliate_sessions CASCADE`;
  await sql`DROP TABLE IF EXISTS affiliate_conversions CASCADE`;
  await sql`DROP TABLE IF EXISTS affiliate_clicks CASCADE`;
  await sql`DROP TRIGGER IF EXISTS affiliates_updated_at ON affiliates`;
  await sql`DROP TRIGGER IF EXISTS affiliates_normalize_email ON affiliates`;
  await sql`DROP TABLE IF EXISTS affiliates CASCADE`;

  // Drop enums
  await sql`DROP TYPE IF EXISTS plan_tier`;
  await sql`DROP TYPE IF EXISTS conversion_status`;
  await sql`DROP TYPE IF EXISTS affiliate_status`;
}
