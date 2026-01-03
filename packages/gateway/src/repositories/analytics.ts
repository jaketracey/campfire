/**
 * Analytics Repository
 * Data access for engagement and revenue analytics
 */

import { sql } from '../db/pool.js';
import type { UUID, Timestamp } from '../db/types.js';
import type { TransactionContext } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface DailyEngagementMetrics {
  date: string;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  newUsers: number;
  returningUsers: number;
  totalSessions: number;
  avgSessionDurationMs: number | null;
  avgTurnsPerSession: number | null;
  totalTurns: number;
  companionsCreated: number;
  activeCompanions: number;
  tokensPurchased: number;
  tokensSpent: number;
  giftsCreated: number;
  imagesGenerated: number;
}

export interface DailyRevenueMetrics {
  date: string;
  mrrCents: number;
  arpuCents: number | null;
  newSubscriptions: number;
  churnedSubscriptions: number;
  upgradedSubscriptions: number;
  downgradedSubscriptions: number;
  freeUsers: number;
  starterUsers: number;
  proUsers: number;
  enterpriseUsers: number;
  tokenPurchaseCount: number;
  tokenPurchaseRevenueCents: number;
  tokensPurchasedTotal: number;
}

export interface RetentionCohort {
  cohortDate: string;
  cohortPeriod: 'weekly' | 'monthly';
  cohortSize: number;
  retentionData: Record<string, number>;
}

export interface CompanionStats {
  companionId: UUID;
  companionName: string;
  sessionCount: number;
  uniqueUsers: number;
  totalTurns: number;
  avgSessionDurationMs: number | null;
}

export interface UserActivityBucket {
  bucket: string;
  userCount: number;
  percentage: number;
}

export interface ActiveUserMetrics {
  dau: number;
  wau: number;
  mau: number;
  dauWauRatio: number;
}

export interface SessionMetrics {
  avgDurationMs: number;
  avgTurnsPerSession: number;
  sessionsPerUser: number;
  totalSessions: number;
}

export interface MRRMetrics {
  mrrCents: number;
  subscriberCount: number;
  arpuCents: number;
}

export interface SubscriptionTierDistribution {
  free: number;
  starter: number;
  pro: number;
  enterprise: number;
  total: number;
}

export interface TokenMetrics {
  totalPurchased: number;
  totalSpent: number;
  purchaseCount: number;
  avgPurchaseSize: number;
  purchaseRevenueCents: number;
}

export interface ConversionFunnel {
  anonymousVisitors: number;
  signedUp: number;
  firstSession: number;
  activated: number;
  converted: number;
  signupRate: number;
  activationRate: number;
  conversionRate: number;
}

// ============================================================================
// Repository
// ============================================================================

export class AnalyticsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Engagement Metrics
  // ===========================================================================

  /**
   * Get pre-computed daily engagement metrics
   */
  async getEngagementMetrics(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<DailyEngagementMetrics[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM analytics_daily_aggregates
      WHERE date >= CURRENT_DATE - INTERVAL '1 day' * ${days}
      ORDER BY date DESC
    `;

    return result.map(row => this.mapEngagementMetrics(row));
  }

  /**
   * Get real-time DAU/WAU/MAU metrics
   */
  async getCurrentDAUWAUMAU(tx?: TransactionContext): Promise<ActiveUserMetrics> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE started_at >= CURRENT_DATE) as dau,
        (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE started_at >= CURRENT_DATE - INTERVAL '6 days') as wau,
        (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE started_at >= CURRENT_DATE - INTERVAL '29 days') as mau
    `;

    const row = result[0];
    const dau = Number(row?.dau) || 0;
    const wau = Number(row?.wau) || 0;

    return {
      dau,
      wau,
      mau: Number(row?.mau) || 0,
      dauWauRatio: wau > 0 ? dau / wau : 0,
    };
  }

  /**
   * Get session metrics for a period
   */
  async getSessionMetrics(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<SessionMetrics> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        AVG(total_duration_ms)::integer as avg_duration,
        AVG(turn_count) as avg_turns,
        COUNT(*)::integer as total_sessions,
        COUNT(DISTINCT user_id) as unique_users
      FROM sessions
      WHERE started_at >= CURRENT_TIMESTAMP - INTERVAL '1 day' * ${days}
    `;

    const row = result[0];
    const totalSessions = Number(row?.total_sessions) || 0;
    const uniqueUsers = Number(row?.unique_users) || 1;

    return {
      avgDurationMs: Number(row?.avg_duration) || 0,
      avgTurnsPerSession: Number(row?.avg_turns) || 0,
      sessionsPerUser: totalSessions / Math.max(uniqueUsers, 1),
      totalSessions,
    };
  }

  // ===========================================================================
  // Retention
  // ===========================================================================

  /**
   * Get retention cohort data
   */
  async getRetentionCohorts(
    period: 'weekly' | 'monthly' = 'weekly',
    limit: number = 12,
    tx?: TransactionContext
  ): Promise<RetentionCohort[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM retention_cohorts
      WHERE cohort_period = ${period}
      ORDER BY cohort_date DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      cohortDate: (row.cohort_date as Date).toISOString().split('T')[0]!,
      cohortPeriod: row.cohort_period as 'weekly' | 'monthly',
      cohortSize: Number(row.cohort_size),
      retentionData: (row.retention_data as Record<string, number>) || {},
    }));
  }

  /**
   * Calculate retention for a specific cohort date
   */
  async calculateRetention(
    cohortStartDate: Date,
    retentionDay: number,
    tx?: TransactionContext
  ): Promise<{ retained: number; total: number; rate: number }> {
    const db = this.getSql(tx);

    // Get users who signed up on cohort date
    const cohortResult = await db`
      SELECT id FROM users
      WHERE created_at::date = ${cohortStartDate}::date
        AND status = 'active'
    `;

    const cohortUserIds = cohortResult.map(r => r.id as string);
    if (cohortUserIds.length === 0) {
      return { retained: 0, total: 0, rate: 0 };
    }

    // Get users who were active on retention day
    const retentionDate = new Date(cohortStartDate);
    retentionDate.setDate(retentionDate.getDate() + retentionDay);

    const retainedResult = await db`
      SELECT COUNT(DISTINCT user_id) as retained
      FROM sessions
      WHERE user_id = ANY(${cohortUserIds}::uuid[])
        AND started_at::date = ${retentionDate}::date
    `;

    const retained = Number(retainedResult[0]?.retained) || 0;

    return {
      retained,
      total: cohortUserIds.length,
      rate: cohortUserIds.length > 0 ? retained / cohortUserIds.length : 0,
    };
  }

  // ===========================================================================
  // Companion Analytics
  // ===========================================================================

  /**
   * Get top companions by usage
   */
  async getTopCompanions(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<CompanionStats[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        c.id as companion_id,
        c.name as companion_name,
        COUNT(DISTINCT s.id) as session_count,
        COUNT(DISTINCT s.user_id) as unique_users,
        COALESCE(SUM(s.turn_count), 0) as total_turns,
        AVG(s.total_duration_ms)::integer as avg_duration
      FROM companions c
      JOIN sessions s ON s.companion_id = c.id
      WHERE s.started_at >= CURRENT_TIMESTAMP - INTERVAL '1 day' * ${days}
      GROUP BY c.id, c.name
      ORDER BY session_count DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      companionId: row.companion_id as UUID,
      companionName: row.companion_name as string,
      sessionCount: Number(row.session_count),
      uniqueUsers: Number(row.unique_users),
      totalTurns: Number(row.total_turns) || 0,
      avgSessionDurationMs: row.avg_duration as number | null,
    }));
  }

  // ===========================================================================
  // User Distribution
  // ===========================================================================

  /**
   * Get user activity distribution (buckets)
   */
  async getUserActivityDistribution(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<UserActivityBucket[]> {
    const db = this.getSql(tx);

    const result = await db`
      WITH user_sessions AS (
        SELECT user_id, COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= CURRENT_TIMESTAMP - INTERVAL '1 day' * ${days}
        GROUP BY user_id
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN session_count = 1 THEN '1'
            WHEN session_count BETWEEN 2 AND 5 THEN '2-5'
            WHEN session_count BETWEEN 6 AND 10 THEN '6-10'
            WHEN session_count BETWEEN 11 AND 20 THEN '11-20'
            ELSE '21+'
          END as bucket,
          COUNT(*) as user_count
        FROM user_sessions
        GROUP BY bucket
      ),
      total AS (
        SELECT SUM(user_count) as total_users FROM bucketed
      )
      SELECT
        b.bucket,
        b.user_count,
        CASE WHEN t.total_users > 0 THEN (b.user_count * 100.0 / t.total_users) ELSE 0 END as percentage
      FROM bucketed b
      CROSS JOIN total t
      ORDER BY
        CASE b.bucket
          WHEN '1' THEN 1
          WHEN '2-5' THEN 2
          WHEN '6-10' THEN 3
          WHEN '11-20' THEN 4
          ELSE 5
        END
    `;

    return result.map(row => ({
      bucket: row.bucket as string,
      userCount: Number(row.user_count),
      percentage: Number(row.percentage),
    }));
  }

  // ===========================================================================
  // Revenue Metrics
  // ===========================================================================

  /**
   * Get pre-computed daily revenue metrics
   */
  async getRevenueMetrics(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<DailyRevenueMetrics[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM revenue_daily_aggregates
      WHERE date >= CURRENT_DATE - INTERVAL '1 day' * ${days}
      ORDER BY date DESC
    `;

    return result.map(row => this.mapRevenueMetrics(row));
  }

  /**
   * Get real-time MRR metrics
   */
  async getCurrentMRR(tx?: TransactionContext): Promise<MRRMetrics> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        SUM(CASE plan
          WHEN 'starter' THEN 999
          WHEN 'pro' THEN 2999
          WHEN 'enterprise' THEN 9999
          ELSE 0
        END) as mrr_cents,
        COUNT(*) FILTER (WHERE plan != 'free') as paying_subscribers
      FROM subscriptions
      WHERE status IN ('active', 'trialing')
    `;

    const row = result[0];
    const mrrCents = Number(row?.mrr_cents) || 0;
    const subscriberCount = Number(row?.paying_subscribers) || 0;

    return {
      mrrCents,
      subscriberCount,
      arpuCents: subscriberCount > 0 ? Math.round(mrrCents / subscriberCount) : 0,
    };
  }

  /**
   * Get subscription tier distribution
   */
  async getSubscriptionTierDistribution(
    tx?: TransactionContext
  ): Promise<SubscriptionTierDistribution> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        plan,
        COUNT(*) as count
      FROM subscriptions
      WHERE status IN ('active', 'trialing')
      GROUP BY plan
    `;

    const distribution: SubscriptionTierDistribution = {
      free: 0,
      starter: 0,
      pro: 0,
      enterprise: 0,
      total: 0,
    };

    for (const row of result) {
      const plan = row.plan as string;
      const count = Number(row.count);
      if (plan === 'free') distribution.free = count;
      else if (plan === 'starter') distribution.starter = count;
      else if (plan === 'pro') distribution.pro = count;
      else if (plan === 'enterprise') distribution.enterprise = count;
      distribution.total += count;
    }

    return distribution;
  }

  /**
   * Get token purchase and spend metrics
   */
  async getTokenMetrics(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<TokenMetrics> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'purchase'), 0) as purchased,
        COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0) as spent,
        COUNT(*) FILTER (WHERE transaction_type = 'purchase') as purchase_count,
        COALESCE(SUM((metadata->>'price_cents')::integer) FILTER (WHERE transaction_type = 'purchase'), 0) as revenue
      FROM token_transactions
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day' * ${days}
    `;

    const row = result[0];
    const purchased = Number(row?.purchased) || 0;
    const purchaseCount = Number(row?.purchase_count) || 0;

    return {
      totalPurchased: purchased,
      totalSpent: Number(row?.spent) || 0,
      purchaseCount,
      avgPurchaseSize: purchaseCount > 0 ? Math.round(purchased / purchaseCount) : 0,
      purchaseRevenueCents: Number(row?.revenue) || 0,
    };
  }

  // ===========================================================================
  // Conversion Funnel
  // ===========================================================================

  /**
   * Get conversion funnel metrics
   */
  async getConversionFunnel(tx?: TransactionContext): Promise<ConversionFunnel> {
    const db = this.getSql(tx);

    // Get anonymous usage stats
    const anonResult = await db`
      SELECT COUNT(*) as total, COUNT(converted_user_id) as converted
      FROM anonymous_usage
    `;

    // Get user funnel metrics
    const userResult = await db`
      SELECT
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE login_count >= 1) as logged_in,
        (SELECT COUNT(DISTINCT user_id) FROM sessions) as has_session
      FROM users
      WHERE status = 'active'
        AND id != '00000000-0000-0000-0000-000000000000'
    `;

    // Count activated users separately
    const activatedResult = await db`
      SELECT COUNT(*) as activated
      FROM (
        SELECT user_id
        FROM sessions
        GROUP BY user_id
        HAVING COUNT(*) >= 3
      ) active_users
    `;

    // Count paid users
    const paidResult = await db`
      SELECT COUNT(DISTINCT user_id) as paid
      FROM subscriptions
      WHERE plan != 'free' AND status = 'active'
    `;

    const anon = anonResult[0];
    const user = userResult[0];

    const anonymousVisitors = Number(anon?.total) || 0;
    const signedUp = Number(user?.total_users) || 0;
    const firstSession = Number(user?.has_session) || 0;
    const activated = Number(activatedResult[0]?.activated) || 0;
    const converted = Number(paidResult[0]?.paid) || 0;

    return {
      anonymousVisitors,
      signedUp,
      firstSession,
      activated,
      converted,
      signupRate: anonymousVisitors > 0 ? signedUp / anonymousVisitors : 0,
      activationRate: signedUp > 0 ? activated / signedUp : 0,
      conversionRate: activated > 0 ? converted / activated : 0,
    };
  }

  // ===========================================================================
  // Aggregation Triggers
  // ===========================================================================

  /**
   * Trigger engagement aggregation for a date
   */
  async aggregateEngagementForDate(
    date: string,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT aggregate_daily_analytics(${date}::date)`;
  }

  /**
   * Trigger revenue aggregation for a date
   */
  async aggregateRevenueForDate(
    date: string,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT aggregate_daily_revenue(${date}::date)`;
  }

  /**
   * Calculate and store retention cohort
   */
  async calculateRetentionCohort(
    cohortDate: string,
    period: 'weekly' | 'monthly' = 'weekly',
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT calculate_retention_cohort(${cohortDate}::date, ${period})`;
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapEngagementMetrics(row: Record<string, unknown>): DailyEngagementMetrics {
    return {
      date: (row.date as Date).toISOString().split('T')[0]!,
      dailyActiveUsers: Number(row.daily_active_users) || 0,
      weeklyActiveUsers: Number(row.weekly_active_users) || 0,
      monthlyActiveUsers: Number(row.monthly_active_users) || 0,
      newUsers: Number(row.new_users) || 0,
      returningUsers: Number(row.returning_users) || 0,
      totalSessions: Number(row.total_sessions) || 0,
      avgSessionDurationMs: row.avg_session_duration_ms != null ? Number(row.avg_session_duration_ms) : null,
      avgTurnsPerSession: row.avg_turns_per_session != null ? Number(row.avg_turns_per_session) : null,
      totalTurns: Number(row.total_turns) || 0,
      companionsCreated: Number(row.companions_created) || 0,
      activeCompanions: Number(row.active_companions) || 0,
      tokensPurchased: Number(row.tokens_purchased) || 0,
      tokensSpent: Number(row.tokens_spent) || 0,
      giftsCreated: Number(row.gifts_created) || 0,
      imagesGenerated: Number(row.images_generated) || 0,
    };
  }

  private mapRevenueMetrics(row: Record<string, unknown>): DailyRevenueMetrics {
    return {
      date: (row.date as Date).toISOString().split('T')[0]!,
      mrrCents: Number(row.mrr_cents) || 0,
      arpuCents: row.arpu_cents != null ? Number(row.arpu_cents) : null,
      newSubscriptions: Number(row.new_subscriptions) || 0,
      churnedSubscriptions: Number(row.churned_subscriptions) || 0,
      upgradedSubscriptions: Number(row.upgraded_subscriptions) || 0,
      downgradedSubscriptions: Number(row.downgraded_subscriptions) || 0,
      freeUsers: Number(row.free_users) || 0,
      starterUsers: Number(row.starter_users) || 0,
      proUsers: Number(row.pro_users) || 0,
      enterpriseUsers: Number(row.enterprise_users) || 0,
      tokenPurchaseCount: Number(row.token_purchase_count) || 0,
      tokenPurchaseRevenueCents: Number(row.token_purchase_revenue_cents) || 0,
      tokensPurchasedTotal: Number(row.tokens_purchased_total) || 0,
    };
  }
}

// Singleton instance
let analyticsRepositoryInstance: AnalyticsRepository | null = null;

export function getAnalyticsRepository(): AnalyticsRepository {
  if (!analyticsRepositoryInstance) {
    analyticsRepositoryInstance = new AnalyticsRepository();
  }
  return analyticsRepositoryInstance;
}
