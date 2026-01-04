/**
 * Migration: Fix Ad Overview Metrics Function
 * Created: 2026-01-05
 *
 * Fixes the get_ad_overview_metrics function to always return a row
 * even when ad_spend_daily is empty.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Replace the function with a version that always returns 1 row
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
        -- Spend metrics from ad_spend_daily
        (SELECT COALESCE(SUM(s.spend_cents), 0)::BIGINT
         FROM ad_spend_daily s
         JOIN ad_accounts a ON s.ad_account_id = a.id
         WHERE s.date BETWEEN p_start_date AND p_end_date
           AND a.status = 'active') as total_spend_cents,
        (SELECT COALESCE(SUM(s.impressions), 0)::BIGINT
         FROM ad_spend_daily s
         JOIN ad_accounts a ON s.ad_account_id = a.id
         WHERE s.date BETWEEN p_start_date AND p_end_date
           AND a.status = 'active') as total_impressions,
        (SELECT COALESCE(SUM(s.clicks), 0)::BIGINT
         FROM ad_spend_daily s
         JOIN ad_accounts a ON s.ad_account_id = a.id
         WHERE s.date BETWEEN p_start_date AND p_end_date
           AND a.status = 'active') as total_clicks,
        -- Conversion metrics
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
        -- Platform breakdowns
        (SELECT COALESCE(jsonb_object_agg(platform, spend), '{}'::jsonb)
         FROM (
           SELECT a.platform::TEXT as platform, COALESCE(SUM(s.spend_cents), 0) as spend
           FROM ad_spend_daily s
           JOIN ad_accounts a ON s.ad_account_id = a.id
           WHERE s.date BETWEEN p_start_date AND p_end_date
             AND a.status = 'active'
           GROUP BY a.platform
         ) t) as spend_by_platform,
        (SELECT COALESCE(jsonb_object_agg(platform, cnt), '{}'::jsonb)
         FROM (
           SELECT platform::TEXT as platform, COUNT(DISTINCT user_id) as cnt
           FROM ad_conversions
           WHERE conversion_type = 'signup'
             AND conversion_date BETWEEN p_start_date AND p_end_date
             AND platform IS NOT NULL
           GROUP BY platform
         ) t) as signups_by_platform;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(_sql: postgres.Sql): Promise<void> {
  // No-op: function still works, just less robust
}
