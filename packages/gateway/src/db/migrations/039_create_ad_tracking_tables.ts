/**
 * Migration: Create Ad Tracking Tables
 * Created: 2026-01-04
 *
 * Ad tracking tables for Google Ads and Facebook Ads integration:
 * - ad_accounts: Connected ad platform accounts with OAuth credentials
 * - ad_campaigns: Cached campaign data from platforms
 * - ad_spend_daily: Daily spend data synced from platforms
 * - ad_conversions: User conversions linked to campaigns for ROAS
 * - user_ltv: Pre-calculated lifetime value per user
 *
 * Also adds UTM tracking columns to users table.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Enums
  // =========================================================================
  await sql`
    DO $$ BEGIN
      CREATE TYPE ad_platform AS ENUM ('google_ads', 'facebook_ads');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    DO $$ BEGIN
      CREATE TYPE ad_account_status AS ENUM ('active', 'disconnected', 'error', 'pending');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    DO $$ BEGIN
      CREATE TYPE ad_conversion_type AS ENUM ('signup', 'first_payment', 'subscription', 'purchase');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Ad Accounts Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Platform info
      platform ad_platform NOT NULL,
      account_id VARCHAR(100) NOT NULL,
      account_name VARCHAR(255),

      -- OAuth credentials (encrypted)
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      token_expires_at TIMESTAMPTZ,

      -- Account settings
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      timezone VARCHAR(50) DEFAULT 'UTC',

      -- Status and sync
      status ad_account_status NOT NULL DEFAULT 'pending',
      last_sync_at TIMESTAMPTZ,
      sync_error TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT ad_accounts_platform_account_unique UNIQUE (platform, account_id)
    )
  `;

  await sql`
    CREATE TRIGGER ad_accounts_updated_at
    BEFORE UPDATE ON ad_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform
    ON ad_accounts (platform)
    WHERE status = 'active'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_accounts_status
    ON ad_accounts (status)
  `;

  await sql`
    COMMENT ON TABLE ad_accounts IS 'Connected Google Ads and Facebook Ads accounts with OAuth tokens'
  `;

  // =========================================================================
  // Ad Campaigns Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,

      -- Platform identifiers
      platform_campaign_id VARCHAR(100) NOT NULL,
      name VARCHAR(500) NOT NULL,

      -- Campaign details
      status VARCHAR(50) DEFAULT 'unknown',
      objective VARCHAR(100),

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT ad_campaigns_account_platform_id_unique UNIQUE (ad_account_id, platform_campaign_id)
    )
  `;

  await sql`
    CREATE TRIGGER ad_campaigns_updated_at
    BEFORE UPDATE ON ad_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_account
    ON ad_campaigns (ad_account_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_platform_id
    ON ad_campaigns (platform_campaign_id)
  `;

  await sql`
    COMMENT ON TABLE ad_campaigns IS 'Cached campaign data from ad platforms'
  `;

  // =========================================================================
  // Ad Spend Daily Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS ad_spend_daily (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
      campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,

      -- Platform identifiers (for matching before campaign is synced)
      platform_campaign_id VARCHAR(100),

      -- Date (UTC)
      date DATE NOT NULL,

      -- Metrics (spend in cents for precision)
      spend_cents INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,

      -- Currency of original spend
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',

      -- Sync tracking
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT ad_spend_daily_unique UNIQUE (ad_account_id, platform_campaign_id, date)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_spend_daily_date
    ON ad_spend_daily (date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_spend_daily_account_date
    ON ad_spend_daily (ad_account_id, date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_spend_daily_campaign
    ON ad_spend_daily (campaign_id)
    WHERE campaign_id IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE ad_spend_daily IS 'Daily ad spend data synced from Google Ads and Facebook Ads'
  `;

  // =========================================================================
  // Add UTM tracking columns to users table
  // =========================================================================
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS utm_term VARCHAR(255)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS utm_content VARCHAR(255)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ad_landing_page TEXT
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ad_click_id VARCHAR(255)
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ad_click_platform VARCHAR(50)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_utm_source
    ON users (utm_source)
    WHERE utm_source IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_utm_campaign
    ON users (utm_campaign)
    WHERE utm_campaign IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_ad_click_platform
    ON users (ad_click_platform)
    WHERE ad_click_platform IS NOT NULL
  `;

  // =========================================================================
  // Ad Conversions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS ad_conversions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Conversion type
      conversion_type ad_conversion_type NOT NULL,

      -- Campaign attribution (nullable if campaign not synced)
      campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
      platform_campaign_id VARCHAR(100),
      platform ad_platform,

      -- UTM data (denormalized for analytics)
      utm_source VARCHAR(100),
      utm_medium VARCHAR(100),
      utm_campaign VARCHAR(255),

      -- Revenue (in cents, 0 for signups)
      revenue_cents INTEGER NOT NULL DEFAULT 0,

      -- Lifetime value (updated by LTV worker)
      ltv_cents INTEGER NOT NULL DEFAULT 0,

      -- Conversion date
      conversion_date DATE NOT NULL,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Prevent duplicate conversions of same type per user
      CONSTRAINT ad_conversions_user_type_unique UNIQUE (user_id, conversion_type)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_conversions_campaign
    ON ad_conversions (campaign_id)
    WHERE campaign_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_conversions_date
    ON ad_conversions (conversion_date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_conversions_user
    ON ad_conversions (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_conversions_utm_source
    ON ad_conversions (utm_source)
    WHERE utm_source IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ad_conversions_platform
    ON ad_conversions (platform)
    WHERE platform IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE ad_conversions IS 'Tracks user conversions (signup, payment) linked to ad campaigns for ROAS calculation'
  `;

  // =========================================================================
  // User LTV Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_ltv (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

      -- Revenue breakdown (in cents)
      total_payments_cents INTEGER NOT NULL DEFAULT 0,
      subscription_revenue_cents INTEGER NOT NULL DEFAULT 0,
      token_revenue_cents INTEGER NOT NULL DEFAULT 0,

      -- Calculated LTV
      ltv_cents INTEGER NOT NULL DEFAULT 0,

      -- Payment timestamps
      first_payment_at TIMESTAMPTZ,
      last_payment_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TRIGGER user_ltv_updated_at
    BEFORE UPDATE ON user_ltv
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_ltv_ltv
    ON user_ltv (ltv_cents DESC)
    WHERE ltv_cents > 0
  `;

  await sql`
    COMMENT ON TABLE user_ltv IS 'Pre-calculated lifetime value per user for ROAS analytics'
  `;

  // =========================================================================
  // Function: Get campaign metrics for a date range
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION get_campaign_metrics(
      p_start_date DATE,
      p_end_date DATE
    )
    RETURNS TABLE (
      campaign_id UUID,
      campaign_name VARCHAR(500),
      platform ad_platform,
      total_spend_cents BIGINT,
      total_impressions BIGINT,
      total_clicks BIGINT,
      signup_count BIGINT,
      conversion_count BIGINT,
      total_revenue_cents BIGINT,
      total_ltv_cents BIGINT
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        a.platform,
        COALESCE(SUM(s.spend_cents), 0)::BIGINT as total_spend_cents,
        COALESCE(SUM(s.impressions), 0)::BIGINT as total_impressions,
        COALESCE(SUM(s.clicks), 0)::BIGINT as total_clicks,
        COALESCE(COUNT(DISTINCT CASE WHEN cv.conversion_type = 'signup' THEN cv.user_id END), 0)::BIGINT as signup_count,
        COALESCE(COUNT(DISTINCT CASE WHEN cv.conversion_type = 'first_payment' THEN cv.user_id END), 0)::BIGINT as conversion_count,
        COALESCE(SUM(cv.revenue_cents), 0)::BIGINT as total_revenue_cents,
        COALESCE(SUM(cv.ltv_cents), 0)::BIGINT as total_ltv_cents
      FROM ad_campaigns c
      JOIN ad_accounts a ON c.ad_account_id = a.id
      LEFT JOIN ad_spend_daily s ON c.id = s.campaign_id
        AND s.date BETWEEN p_start_date AND p_end_date
      LEFT JOIN ad_conversions cv ON c.id = cv.campaign_id
        AND cv.conversion_date BETWEEN p_start_date AND p_end_date
      WHERE a.status = 'active'
      GROUP BY c.id, c.name, a.platform
      ORDER BY total_spend_cents DESC;
    END;
    $$ LANGUAGE plpgsql
  `;

  // =========================================================================
  // Function: Get overall ad metrics for a date range
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION get_ad_overview_metrics(
      p_start_date DATE,
      p_end_date DATE
    )
    RETURNS TABLE (
      total_spend_cents BIGINT,
      total_impressions BIGINT,
      total_clicks BIGINT,
      total_signups BIGINT,
      total_conversions BIGINT,
      total_revenue_cents BIGINT,
      total_ltv_cents BIGINT,
      spend_by_platform JSONB,
      signups_by_platform JSONB
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        COALESCE(SUM(s.spend_cents), 0)::BIGINT as total_spend_cents,
        COALESCE(SUM(s.impressions), 0)::BIGINT as total_impressions,
        COALESCE(SUM(s.clicks), 0)::BIGINT as total_clicks,
        (SELECT COUNT(DISTINCT user_id)::BIGINT
         FROM ad_conversions
         WHERE conversion_type = 'signup'
           AND conversion_date BETWEEN p_start_date AND p_end_date) as total_signups,
        (SELECT COUNT(DISTINCT user_id)::BIGINT
         FROM ad_conversions
         WHERE conversion_type = 'first_payment'
           AND conversion_date BETWEEN p_start_date AND p_end_date) as total_conversions,
        (SELECT COALESCE(SUM(revenue_cents), 0)::BIGINT
         FROM ad_conversions
         WHERE conversion_date BETWEEN p_start_date AND p_end_date) as total_revenue_cents,
        (SELECT COALESCE(SUM(ltv_cents), 0)::BIGINT
         FROM ad_conversions
         WHERE conversion_date BETWEEN p_start_date AND p_end_date) as total_ltv_cents,
        (SELECT COALESCE(jsonb_object_agg(a.platform, spend), '{}'::jsonb)
         FROM (
           SELECT a2.platform, SUM(s2.spend_cents) as spend
           FROM ad_spend_daily s2
           JOIN ad_accounts a2 ON s2.ad_account_id = a2.id
           WHERE s2.date BETWEEN p_start_date AND p_end_date
           GROUP BY a2.platform
         ) a) as spend_by_platform,
        (SELECT COALESCE(jsonb_object_agg(platform, cnt), '{}'::jsonb)
         FROM (
           SELECT platform, COUNT(DISTINCT user_id) as cnt
           FROM ad_conversions
           WHERE conversion_type = 'signup'
             AND conversion_date BETWEEN p_start_date AND p_end_date
             AND platform IS NOT NULL
           GROUP BY platform
         ) p) as signups_by_platform
      FROM ad_spend_daily s
      JOIN ad_accounts a ON s.ad_account_id = a.id
      WHERE s.date BETWEEN p_start_date AND p_end_date
        AND a.status = 'active';
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Drop functions
  await sql`DROP FUNCTION IF EXISTS get_ad_overview_metrics(DATE, DATE)`;
  await sql`DROP FUNCTION IF EXISTS get_campaign_metrics(DATE, DATE)`;

  // Drop tables
  await sql`DROP TABLE IF EXISTS user_ltv CASCADE`;
  await sql`DROP TABLE IF EXISTS ad_conversions CASCADE`;
  await sql`DROP TABLE IF EXISTS ad_spend_daily CASCADE`;
  await sql`DROP TABLE IF EXISTS ad_campaigns CASCADE`;
  await sql`DROP TRIGGER IF EXISTS ad_accounts_updated_at ON ad_accounts`;
  await sql`DROP TABLE IF EXISTS ad_accounts CASCADE`;

  // Remove columns from users
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS ad_click_platform`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS ad_click_id`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS ad_landing_page`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS utm_content`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS utm_term`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS utm_campaign`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS utm_medium`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS utm_source`;

  // Drop enums
  await sql`DROP TYPE IF EXISTS ad_conversion_type`;
  await sql`DROP TYPE IF EXISTS ad_account_status`;
  await sql`DROP TYPE IF EXISTS ad_platform`;
}
