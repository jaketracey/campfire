/**
 * Migration: Create Email Tables
 * Created: 2026-01-01
 *
 * Email system tables:
 * - email_templates: Versioned email templates
 * - email_preferences: User email preferences
 * - email_suppressions: Global suppression list
 * - email_logs: Sent email history
 * - email_bounces: Bounce tracking
 * - email_complaints: Complaint tracking
 * - email_campaigns: Marketing campaign management
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Email type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE email_type AS ENUM ('transactional', 'notification', 'marketing');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Email status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE email_status AS ENUM (
        'queued',
        'sending',
        'sent',
        'delivered',
        'failed',
        'bounced',
        'complained'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Digest frequency enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE digest_frequency AS ENUM ('daily', 'weekly', 'never');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Template status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE template_status AS ENUM ('draft', 'published', 'archived');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Campaign status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'canceled');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Email Templates Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Template identity
      name VARCHAR(100) NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,

      -- Template content
      subject VARCHAR(500) NOT NULL,
      mjml_content TEXT NOT NULL,
      html_content TEXT,
      text_content TEXT,

      -- Template metadata
      description TEXT,
      category email_type NOT NULL DEFAULT 'transactional',
      variables JSONB NOT NULL DEFAULT '[]',

      -- Status
      status template_status NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,

      -- Audit
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Each template name can have multiple versions
      CONSTRAINT email_templates_name_version_unique UNIQUE (name, version)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_templates_name
    ON email_templates (name, version DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_templates_category
    ON email_templates (category)
    WHERE status = 'published'
  `;

  await sql`
    CREATE TRIGGER email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE email_templates IS 'Versioned email templates with MJML source'
  `;

  // =========================================================================
  // Email Preferences Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_preferences (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255),

      -- Preference flags
      transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,

      -- Digest preferences
      digest_frequency digest_frequency NOT NULL DEFAULT 'never',
      digest_day_of_week INTEGER,
      digest_hour INTEGER DEFAULT 9,

      -- Timezone for scheduling
      timezone VARCHAR(50) DEFAULT 'UTC',

      -- Audit
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Either user_id or email must be set
      CONSTRAINT email_preferences_user_unique UNIQUE (user_id),
      CONSTRAINT email_preferences_email_unique UNIQUE (email),
      CONSTRAINT email_preferences_has_identifier CHECK (user_id IS NOT NULL OR email IS NOT NULL)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_preferences_user_id
    ON email_preferences (user_id)
    WHERE user_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_preferences_email
    ON email_preferences (email)
    WHERE email IS NOT NULL
  `;

  await sql`
    CREATE TRIGGER email_preferences_updated_at
    BEFORE UPDATE ON email_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE email_preferences IS 'User email preferences for subscription management'
  `;

  // =========================================================================
  // Email Suppressions Table (Global)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL,

      -- Suppression reason
      reason VARCHAR(50) NOT NULL,

      -- Source information
      source_message_id VARCHAR(255),

      -- Timestamps
      suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,

      CONSTRAINT email_suppressions_email_unique UNIQUE (email)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
    ON email_suppressions (email)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_suppressions_expires
    ON email_suppressions (expires_at)
    WHERE expires_at IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE email_suppressions IS 'Global email suppression list for bounces and complaints'
  `;

  // =========================================================================
  // Email Logs Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      job_id VARCHAR(100) NOT NULL,

      -- Recipient info
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      recipient_email VARCHAR(255) NOT NULL,

      -- Email info
      template_name VARCHAR(100) NOT NULL,
      email_type email_type NOT NULL,
      subject VARCHAR(500),

      -- Status tracking
      status email_status NOT NULL DEFAULT 'queued',

      -- SES info
      ses_message_id VARCHAR(255),

      -- Campaign tracking
      campaign_id VARCHAR(100),

      -- Tracing
      trace_id VARCHAR(100),

      -- Error info
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,

      -- Timestamps
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      bounced_at TIMESTAMPTZ,
      complained_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT email_logs_job_unique UNIQUE (job_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_user_id
    ON email_logs (user_id, created_at DESC)
    WHERE user_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_recipient
    ON email_logs (recipient_email, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_ses_message
    ON email_logs (ses_message_id)
    WHERE ses_message_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_campaign
    ON email_logs (campaign_id, created_at DESC)
    WHERE campaign_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_status
    ON email_logs (status, created_at)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_logs_trace
    ON email_logs (trace_id)
    WHERE trace_id IS NOT NULL
  `;

  await sql`
    CREATE TRIGGER email_logs_updated_at
    BEFORE UPDATE ON email_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE email_logs IS 'Email send history and delivery tracking'
  `;

  // =========================================================================
  // Email Bounces Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_bounces (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      message_id VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,

      -- Bounce details
      bounce_type VARCHAR(50) NOT NULL,
      bounce_subtype VARCHAR(100),
      action VARCHAR(50),
      status VARCHAR(50),
      diagnostic_code TEXT,

      bounced_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_bounces_email
    ON email_bounces (email, bounced_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_bounces_message
    ON email_bounces (message_id)
  `;

  await sql`
    COMMENT ON TABLE email_bounces IS 'Email bounce records from SES'
  `;

  // =========================================================================
  // Email Complaints Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_complaints (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      message_id VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,

      -- Complaint details
      feedback_type VARCHAR(100),
      user_agent VARCHAR(500),

      complained_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_complaints_email
    ON email_complaints (email, complained_at DESC)
  `;

  await sql`
    COMMENT ON TABLE email_complaints IS 'Email complaint records from SES'
  `;

  // =========================================================================
  // Email Campaigns Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Campaign identity
      name VARCHAR(255) NOT NULL,
      description TEXT,

      -- Template reference
      template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
      template_name VARCHAR(100),

      -- Targeting
      segment_query JSONB,
      recipient_count INTEGER,

      -- Content customization
      subject_override VARCHAR(500),
      context_data JSONB NOT NULL DEFAULT '{}',

      -- Status
      status campaign_status NOT NULL DEFAULT 'draft',

      -- Scheduling
      scheduled_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,

      -- Stats
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      opened_count INTEGER NOT NULL DEFAULT 0,
      clicked_count INTEGER NOT NULL DEFAULT 0,
      bounced_count INTEGER NOT NULL DEFAULT 0,
      complained_count INTEGER NOT NULL DEFAULT 0,
      unsubscribed_count INTEGER NOT NULL DEFAULT 0,

      -- Audit
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_campaigns_status
    ON email_campaigns (status, scheduled_at)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_campaigns_created
    ON email_campaigns (created_at DESC)
  `;

  await sql`
    CREATE TRIGGER email_campaigns_updated_at
    BEFORE UPDATE ON email_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE email_campaigns IS 'Marketing email campaigns with tracking stats'
  `;

  // =========================================================================
  // Helper Functions
  // =========================================================================

  // Function to check if email is suppressed
  await sql`
    CREATE OR REPLACE FUNCTION is_email_suppressed(p_email VARCHAR)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM email_suppressions
        WHERE email = p_email
          AND (expires_at IS NULL OR expires_at > NOW())
      );
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to get effective email preferences
  await sql`
    CREATE OR REPLACE FUNCTION get_email_preferences(p_user_id UUID)
    RETURNS TABLE (
      transactional_enabled BOOLEAN,
      notification_enabled BOOLEAN,
      marketing_enabled BOOLEAN,
      digest_freq digest_frequency
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        COALESCE(ep.transactional_enabled, TRUE),
        COALESCE(ep.notification_enabled, TRUE),
        COALESCE(ep.marketing_enabled, FALSE),
        COALESCE(ep.digest_frequency, 'never'::digest_frequency)
      FROM users u
      LEFT JOIN email_preferences ep ON ep.user_id = u.id
      WHERE u.id = p_user_id;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to update campaign stats
  await sql`
    CREATE OR REPLACE FUNCTION update_campaign_stats(p_campaign_id UUID)
    RETURNS VOID AS $$
    BEGIN
      UPDATE email_campaigns
      SET
        sent_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND status != 'queued'),
        delivered_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND delivered_at IS NOT NULL),
        opened_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND opened_at IS NOT NULL),
        clicked_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND clicked_at IS NOT NULL),
        bounced_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND bounced_at IS NOT NULL),
        complained_count = (SELECT COUNT(*) FROM email_logs WHERE campaign_id = p_campaign_id::VARCHAR AND complained_at IS NOT NULL),
        updated_at = NOW()
      WHERE id = p_campaign_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Data retention function
  await sql`
    CREATE OR REPLACE FUNCTION cleanup_old_email_logs(p_retention_days INTEGER DEFAULT 90)
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM email_logs
      WHERE created_at < NOW() - (p_retention_days || ' days')::INTERVAL
        AND status IN ('sent', 'delivered', 'failed');

      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS cleanup_old_email_logs(INTEGER)`;
  await sql`DROP FUNCTION IF EXISTS update_campaign_stats(UUID)`;
  await sql`DROP FUNCTION IF EXISTS get_email_preferences(UUID)`;
  await sql`DROP FUNCTION IF EXISTS is_email_suppressed(VARCHAR)`;

  await sql`DROP TRIGGER IF EXISTS email_campaigns_updated_at ON email_campaigns`;
  await sql`DROP TABLE IF EXISTS email_campaigns CASCADE`;

  await sql`DROP TABLE IF EXISTS email_complaints CASCADE`;
  await sql`DROP TABLE IF EXISTS email_bounces CASCADE`;

  await sql`DROP TRIGGER IF EXISTS email_logs_updated_at ON email_logs`;
  await sql`DROP TABLE IF EXISTS email_logs CASCADE`;

  await sql`DROP TABLE IF EXISTS email_suppressions CASCADE`;

  await sql`DROP TRIGGER IF EXISTS email_preferences_updated_at ON email_preferences`;
  await sql`DROP TABLE IF EXISTS email_preferences CASCADE`;

  await sql`DROP TRIGGER IF EXISTS email_templates_updated_at ON email_templates`;
  await sql`DROP TABLE IF EXISTS email_templates CASCADE`;

  await sql`DROP TYPE IF EXISTS campaign_status`;
  await sql`DROP TYPE IF EXISTS template_status`;
  await sql`DROP TYPE IF EXISTS digest_frequency`;
  await sql`DROP TYPE IF EXISTS email_status`;
  await sql`DROP TYPE IF EXISTS email_type`;
}
