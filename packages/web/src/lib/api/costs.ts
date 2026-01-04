/**
 * Costs API
 * Administrative operations for LLM cost tracking and budget management.
 */

import { get, post, put } from './client';

// ============================================================================
// Types
// ============================================================================

export interface CostSummary {
  period: {
    days: number;
    start: string;
    end: string;
  };
  totals: {
    costUsd: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    uniqueUsers: number;
    avgCostPerUser: number;
  };
  breakdown: {
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
  };
}

export interface CostTrendPoint {
  date: string;
  costUsd: number;
  requestCount: number;
  tokens?: number;
}

export interface CostTrendResponse {
  success: boolean;
  data: {
    period: { days: number };
    trend: CostTrendPoint[];
  };
}

export interface ProviderCost {
  provider: string;
  costUsd: number;
  requests: number;
  tokens: number;
}

export interface ModelCost {
  model: string;
  provider: string;
  costUsd: number;
  requests: number;
}

export interface TopUser {
  userId: string;
  totalCostUsd: number;
  requestCount: number;
}

export interface UserCostDetail {
  userId: string;
  period: { days: number };
  summary: {
    totalCostUsd: number;
    totalRequests: number;
    inputTokens: number;
    outputTokens: number;
    avgCostPerRequest: number;
    topModel: string | null;
    topCompanionId: string | null;
  };
  budget: {
    dailyLimitUsd: number | null;
    monthlyLimitUsd: number | null;
    dailyUsageUsd: number;
    monthlyUsageUsd: number;
    alertThresholdPercent: number;
    isBlocked: boolean;
    blockedReason: string | null;
  } | null;
  trend: Array<{ date: string; costUsd: number; requests: number }>;
}

export interface UsageEvent {
  id: string;
  userId: string;
  sessionId: string | null;
  companionId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number | null;
  finishReason: string | null;
  requestType: string;
  streamMode: boolean;
  createdAt: string;
}

export interface DailyAggregate {
  date: string;
  userId: string | null;
  provider: string | null;
  model: string | null;
  companionId: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyAvgMs: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
}

export interface ModelPricing {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
}

export interface CostEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  pricingUsed: {
    inputPer1M: number;
    outputPer1M: number;
  } | null;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get platform-wide cost summary
 */
export async function getCostSummary(days = 30): Promise<{ success: boolean; data: CostSummary }> {
  return get(`/admin/costs/summary?days=${days}`);
}

/**
 * Get cost trend over time
 */
export async function getCostTrend(days = 30, userId?: string): Promise<CostTrendResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  return get(`/admin/costs/trend?${params}`);
}

/**
 * Get cost breakdown by provider
 */
export async function getCostByProvider(
  days = 30
): Promise<{ success: boolean; data: { period: { days: number }; providers: ProviderCost[] } }> {
  return get(`/admin/costs/by-provider?days=${days}`);
}

/**
 * Get cost breakdown by model
 */
export async function getCostByModel(
  days = 30,
  limit = 10
): Promise<{ success: boolean; data: { period: { days: number }; models: ModelCost[] } }> {
  return get(`/admin/costs/by-model?days=${days}&limit=${limit}`);
}

/**
 * Get top users by cost
 */
export async function getTopUsersByCost(
  days = 30,
  limit = 10
): Promise<{ success: boolean; data: { period: { days: number }; users: TopUser[] } }> {
  return get(`/admin/costs/top-users?days=${days}&limit=${limit}`);
}

/**
 * Get detailed cost info for a specific user
 */
export async function getUserCostDetail(
  userId: string,
  days = 30
): Promise<{ success: boolean; data: UserCostDetail }> {
  return get(`/admin/costs/users/${userId}?days=${days}`);
}

/**
 * Update user's budget limits
 */
export async function updateUserBudget(
  userId: string,
  budget: {
    daily_limit_usd?: number | null;
    monthly_limit_usd?: number | null;
    alert_threshold_percent?: number;
  }
): Promise<{ success: boolean; data: { userId: string } & typeof budget }> {
  return put(`/admin/costs/users/${userId}/budget`, budget);
}

/**
 * Block a user from LLM usage
 */
export async function blockUser(
  userId: string,
  reason: string
): Promise<{ success: boolean; data: { userId: string; blocked: boolean; reason: string } }> {
  return post(`/admin/costs/users/${userId}/block`, { reason });
}

/**
 * Unblock a user for LLM usage
 */
export async function unblockUser(
  userId: string
): Promise<{ success: boolean; data: { userId: string; blocked: boolean } }> {
  return post(`/admin/costs/users/${userId}/unblock`, {});
}

/**
 * List usage events with filters
 */
export async function listUsageEvents(params: {
  userId?: string;
  sessionId?: string;
  companionId?: string;
  provider?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; data: { events: UsageEvent[]; hasMore: boolean; limit: number; offset: number } }> {
  const urlParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) urlParams.set(key, String(value));
  });
  return get(`/admin/costs/usage?${urlParams}`);
}

/**
 * Get daily aggregated costs
 */
export async function getDailyAggregates(params: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  provider?: string;
  limit?: number;
}): Promise<{ success: boolean; data: { aggregates: DailyAggregate[] } }> {
  const urlParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) urlParams.set(key, String(value));
  });
  return get(`/admin/costs/daily-aggregates?${urlParams}`);
}

/**
 * Trigger manual daily aggregation
 */
export async function triggerAggregation(
  date: string
): Promise<{ success: boolean; data: { date: string; aggregatedRows: number } }> {
  return post('/admin/costs/aggregate', { date });
}

/**
 * Get model pricing information
 */
export async function getModelPricing(): Promise<{
  success: boolean;
  data: { pricing: ModelPricing[]; note: string };
}> {
  return get('/admin/costs/pricing');
}

/**
 * Estimate cost for a request
 */
export async function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<{ success: boolean; data: CostEstimate }> {
  return post('/admin/costs/estimate', { model, inputTokens, outputTokens });
}
