/**
 * Analytics Service
 * Business logic for engagement and revenue analytics
 */

import { z } from 'zod';
import {
  getAnalyticsRepository,
  type DailyEngagementMetrics,
  type DailyRevenueMetrics,
  type RetentionCohort,
  type CompanionStats,
  type UserActivityBucket,
  type ActiveUserMetrics,
  type SessionMetrics,
  type MRRMetrics,
  type SubscriptionTierDistribution,
  type TokenMetrics,
  type ConversionFunnel,
} from '../repositories/analytics.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const AnalyticsQuerySchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
});

export const RetentionQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly']).default('weekly'),
  limit: z.number().int().min(1).max(52).default(12),
});

export const CompanionQuerySchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(50).default(10),
});

export const AggregateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// ============================================================================
// Types
// ============================================================================

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
export type RetentionQuery = z.infer<typeof RetentionQuerySchema>;
export type CompanionQuery = z.infer<typeof CompanionQuerySchema>;
export type AggregateQuery = z.infer<typeof AggregateQuerySchema>;

export interface EngagementSummary {
  current: ActiveUserMetrics;
  trends: DailyEngagementMetrics[];
  sessions: SessionMetrics;
}

export interface RevenueSummary {
  current: MRRMetrics & {
    mrrDollars: number;
    arpuDollars: number;
  };
  trends: DailyRevenueMetrics[];
  tierDistribution: SubscriptionTierDistribution;
  tokens: TokenMetrics;
}

// ============================================================================
// Service
// ============================================================================

export class AnalyticsService {
  private repo = getAnalyticsRepository();

  // ===========================================================================
  // Engagement Analytics
  // ===========================================================================

  /**
   * Get comprehensive engagement summary
   */
  async getEngagementSummary(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<EngagementSummary> {
    const validated = AnalyticsQuerySchema.parse({ days });

    const [current, trends, sessions] = await Promise.all([
      this.repo.getCurrentDAUWAUMAU(tx),
      this.repo.getEngagementMetrics(validated.days, tx),
      this.repo.getSessionMetrics(validated.days, tx),
    ]);

    logger.debug({ days: validated.days }, 'Engagement summary retrieved');

    return { current, trends, sessions };
  }

  /**
   * Get retention cohort data
   */
  async getRetentionData(
    period: 'weekly' | 'monthly' = 'weekly',
    limit: number = 12,
    tx?: TransactionContext
  ): Promise<RetentionCohort[]> {
    const validated = RetentionQuerySchema.parse({ period, limit });
    return this.repo.getRetentionCohorts(validated.period, validated.limit, tx);
  }

  /**
   * Get companion usage analytics
   */
  async getCompanionAnalytics(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<CompanionStats[]> {
    const validated = CompanionQuerySchema.parse({ days, limit });
    return this.repo.getTopCompanions(validated.days, validated.limit, tx);
  }

  /**
   * Get user activity distribution
   */
  async getUserDistribution(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<UserActivityBucket[]> {
    const validated = AnalyticsQuerySchema.parse({ days });
    return this.repo.getUserActivityDistribution(validated.days, tx);
  }

  // ===========================================================================
  // Revenue Analytics
  // ===========================================================================

  /**
   * Get comprehensive revenue summary
   */
  async getRevenueSummary(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<RevenueSummary> {
    const validated = AnalyticsQuerySchema.parse({ days });

    const [currentMRR, trends, tierDistribution, tokens] = await Promise.all([
      this.repo.getCurrentMRR(tx),
      this.repo.getRevenueMetrics(validated.days, tx),
      this.repo.getSubscriptionTierDistribution(tx),
      this.repo.getTokenMetrics(validated.days, tx),
    ]);

    logger.debug({ days: validated.days }, 'Revenue summary retrieved');

    return {
      current: {
        ...currentMRR,
        mrrDollars: currentMRR.mrrCents / 100,
        arpuDollars: currentMRR.arpuCents / 100,
      },
      trends,
      tierDistribution,
      tokens,
    };
  }

  /**
   * Get conversion funnel metrics
   */
  async getConversionFunnel(tx?: TransactionContext): Promise<ConversionFunnel> {
    return this.repo.getConversionFunnel(tx);
  }

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  /**
   * Run daily aggregation for all metrics
   */
  async aggregateDailyMetrics(
    date: string,
    tx?: TransactionContext
  ): Promise<void> {
    const validated = AggregateQuerySchema.parse({ date });

    await Promise.all([
      this.repo.aggregateEngagementForDate(validated.date, tx),
      this.repo.aggregateRevenueForDate(validated.date, tx),
    ]);

    // Also calculate retention for cohorts that need updating
    // For the cohort that started 1, 7, 14, or 30 days ago
    const dateObj = new Date(validated.date);
    const cohortDates = [1, 7, 14, 30].map(d => {
      const cohort = new Date(dateObj);
      cohort.setDate(cohort.getDate() - d);
      return cohort.toISOString().split('T')[0]!;
    });

    for (const cohortDate of cohortDates) {
      try {
        await this.repo.calculateRetentionCohort(cohortDate, 'weekly', tx);
      } catch (error) {
        // Log but don't fail if cohort calculation fails
        logger.warn({ cohortDate, error }, 'Failed to calculate retention cohort');
      }
    }

    logger.info({ date: validated.date }, 'Daily analytics aggregated');
  }

  /**
   * Backfill aggregations for a date range
   */
  async backfillAggregations(
    startDate: string,
    endDate: string,
    tx?: TransactionContext
  ): Promise<{ processed: number; errors: number }> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let processed = 0;
    let errors = 0;

    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0]!;
      try {
        await this.aggregateDailyMetrics(dateStr, tx);
        processed++;
      } catch (error) {
        logger.error({ date: dateStr, error }, 'Failed to aggregate date');
        errors++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    logger.info({ startDate, endDate, processed, errors }, 'Backfill completed');
    return { processed, errors };
  }
}

// Singleton instance
let analyticsServiceInstance: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!analyticsServiceInstance) {
    analyticsServiceInstance = new AnalyticsService();
  }
  return analyticsServiceInstance;
}
