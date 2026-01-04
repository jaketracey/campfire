/**
 * Analytics API
 * Administrative operations for engagement and revenue analytics.
 */

import { get, post } from './client';

// ============================================================================
// Types
// ============================================================================

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

export interface EngagementSummary {
  period: { days: number };
  current: ActiveUserMetrics;
  trends: DailyEngagementMetrics[];
  sessions: SessionMetrics;
}

export interface RetentionCohort {
  cohortDate: string;
  cohortPeriod: 'weekly' | 'monthly';
  cohortSize: number;
  retentionData: Record<string, number>;
}

export interface CompanionStats {
  companionId: string;
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

export interface MRRMetrics {
  mrrCents: number;
  mrrDollars: number;
  subscriberCount: number;
  arpuCents: number;
  arpuDollars: number;
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

export interface RevenueSummary {
  period: { days: number };
  current: MRRMetrics;
  trends: DailyRevenueMetrics[];
  tierDistribution: SubscriptionTierDistribution;
  tokens: TokenMetrics;
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
// API Functions
// ============================================================================

/**
 * Get engagement summary (DAU/WAU/MAU, session metrics, trends)
 */
export async function getEngagementSummary(
  days = 30
): Promise<{ success: boolean; data: EngagementSummary }> {
  return get(`/admin/analytics/engagement?days=${days}`);
}

/**
 * Get retention cohort data
 */
export async function getRetentionCohorts(
  period: 'weekly' | 'monthly' = 'weekly',
  limit = 12
): Promise<{ success: boolean; data: { period: string; cohorts: RetentionCohort[] } }> {
  return get(`/admin/analytics/retention?period=${period}&limit=${limit}`);
}

/**
 * Get companion popularity/analytics
 */
export async function getCompanionAnalytics(
  days = 30,
  limit = 10
): Promise<{ success: boolean; data: { period: { days: number }; companions: CompanionStats[] } }> {
  return get(`/admin/analytics/companions?days=${days}&limit=${limit}`);
}

/**
 * Get user activity distribution (session count buckets)
 */
export async function getUserDistribution(
  days = 30
): Promise<{ success: boolean; data: { period: { days: number }; distribution: UserActivityBucket[] } }> {
  return get(`/admin/analytics/user-distribution?days=${days}`);
}

/**
 * Get revenue summary (MRR, ARPU, tiers, tokens)
 */
export async function getRevenueSummary(
  days = 30
): Promise<{ success: boolean; data: RevenueSummary }> {
  return get(`/admin/analytics/revenue?days=${days}`);
}

/**
 * Get conversion funnel metrics
 */
export async function getConversionFunnel(): Promise<{ success: boolean; data: ConversionFunnel }> {
  return get('/admin/analytics/funnel');
}

/**
 * Trigger aggregation for a specific date
 */
export async function triggerAggregation(
  date: string
): Promise<{ success: boolean; data: { date: string; aggregated: boolean } }> {
  return post('/admin/analytics/aggregate', { date });
}

/**
 * Backfill aggregations for a date range
 */
export async function backfillAggregations(
  startDate: string,
  endDate: string
): Promise<{ success: boolean; data: { startDate: string; endDate: string; processed: number; errors: number } }> {
  return post('/admin/analytics/backfill', { startDate, endDate });
}
