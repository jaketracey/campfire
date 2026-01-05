/**
 * LLM Usage Service
 * Business logic for LLM cost tracking, budget management, and usage analytics.
 */

import { z } from 'zod';
import {
  getLLMUsageRepository,
  getProviderSettingsRepository,
  type LLMUsageEventInsert,
  type UserCostSummary,
  type PlatformCostSummary,
  type UserCostBudget,
  type CostAlert,
  type CostTrendPoint,
  type UsageRecordResult,
  type UsageListFilters,
  type LLMUsageEvent,
  type DailyAggregate,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';

// Cache for model pricing from database (TTL: 5 minutes)
interface PricingCacheEntry {
  input: number;
  output: number;
  fetchedAt: number;
}
const pricingCache = new Map<string, PricingCacheEntry>();
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
import type { UUID, Timestamp } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const RecordLLMUsageInputSchema = z.object({
  user_id: z.string().uuid(),
  session_id: z.string().uuid().optional().nullable(),
  companion_id: z.string().uuid().optional().nullable(),
  turn_id: z.string().uuid().optional().nullable(),
  trace_id: z.string().uuid().optional().nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cost_usd: z.number().min(0),
  latency_ms: z.number().int().min(0).optional().nullable(),
  finish_reason: z.string().optional().nullable(),
  request_type: z.enum(['chat', 'embedding', 'completion', 'image', 'audio', 'function']).optional(),
  tool_calls: z.number().int().min(0).optional(),
  stream_mode: z.boolean().optional(),
  request_started_at: z.date(),
  request_completed_at: z.date(),
});

export const UpdateBudgetInputSchema = z.object({
  daily_limit_usd: z.number().min(0).nullable().optional(),
  monthly_limit_usd: z.number().min(0).nullable().optional(),
  alert_threshold_percent: z.number().min(0).max(100).optional(),
});

export const CostQueryInputSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  user_id: z.string().uuid().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type RecordLLMUsageInput = z.infer<typeof RecordLLMUsageInputSchema>;
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetInputSchema>;
export type CostQueryInput = z.infer<typeof CostQueryInputSchema>;

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  daily_usage_usd: number;
  monthly_usage_usd: number;
  daily_limit_usd: number | null;
  monthly_limit_usd: number | null;
  daily_remaining_usd: number | null;
  monthly_remaining_usd: number | null;
}

export interface UsageAnalytics {
  total_cost_usd: number;
  total_requests: number;
  avg_cost_per_request: number;
  avg_latency_ms: number | null;
  cost_trend: CostTrendPoint[];
  top_models: Array<{ model: string; cost: number; requests: number }>;
  top_companions: Array<{ companion_id: UUID; cost: number; requests: number }>;
}

export interface AlertConfig {
  daily_threshold_percent: number;
  monthly_threshold_percent: number;
  notification_channels: string[];
}

// Model pricing data (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic via Bedrock
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 3.0, output: 15.0 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { input: 1.0, output: 5.0 },
  'anthropic.claude-3-haiku-20240307-v1:0': { input: 0.25, output: 1.25 },
  'anthropic.claude-3-sonnet-20240229-v1:0': { input: 3.0, output: 15.0 },
  'anthropic.claude-3-opus-20240229-v1:0': { input: 15.0, output: 75.0 },
  // Meta Llama via Bedrock
  'meta.llama3-1-70b-instruct-v1:0': { input: 0.99, output: 0.99 },
  'meta.llama3-1-8b-instruct-v1:0': { input: 0.22, output: 0.22 },
  'meta.llama3-2-11b-vision-instruct-v1:0': { input: 0.35, output: 0.35 },
  'meta.llama3-2-90b-vision-instruct-v1:0': { input: 2.0, output: 2.0 },
  // Mistral via Bedrock
  'mistral.mistral-large-2407-v1:0': { input: 4.0, output: 12.0 },
  'mistral.mistral-small-2402-v1:0': { input: 0.1, output: 0.3 },
  // Amazon Titan
  'amazon.titan-text-lite-v1': { input: 0.15, output: 0.2 },
  'amazon.titan-text-express-v1': { input: 0.2, output: 0.6 },
  // Direct Anthropic API
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // OpenAI (if using direct API)
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Ollama (free, local)
  'ollama': { input: 0, output: 0 },
};

// ============================================================================
// Service
// ============================================================================

export class LLMUsageService {
  private repo = getLLMUsageRepository();
  private providerRepo = getProviderSettingsRepository();
  private events = getEventsService();

  // ===========================================================================
  // Usage Recording
  // ===========================================================================

  /**
   * Record LLM usage and check budget limits
   * Returns budget status after recording
   */
  async recordUsage(
    input: RecordLLMUsageInput,
    tx?: TransactionContext
  ): Promise<UsageRecordResult & { budget_status: BudgetCheckResult }> {
    const validated = RecordLLMUsageInputSchema.parse(input);

    // Calculate cost if not provided or verify it
    let calculatedCost = validated.cost_usd;
    if (calculatedCost === 0) {
      calculatedCost = this.calculateCost(
        validated.model,
        validated.input_tokens,
        validated.output_tokens
      );
    }

    // Record the usage
    const result = await this.repo.recordUsage({
      ...validated,
      cost_usd: calculatedCost,
      request_started_at: validated.request_started_at as unknown as Timestamp,
      request_completed_at: validated.request_completed_at as unknown as Timestamp,
    }, tx);

    // Build budget status
    const budget_status: BudgetCheckResult = {
      allowed: !result.is_over_limit,
      daily_usage_usd: result.daily_usage,
      monthly_usage_usd: result.monthly_usage,
      daily_limit_usd: result.daily_limit,
      monthly_limit_usd: result.monthly_limit,
      daily_remaining_usd: result.daily_limit
        ? Math.max(0, result.daily_limit - result.daily_usage)
        : null,
      monthly_remaining_usd: result.monthly_limit
        ? Math.max(0, result.monthly_limit - result.monthly_usage)
        : null,
    };

    if (result.is_over_limit) {
      budget_status.reason = result.daily_limit && result.daily_usage > result.daily_limit
        ? 'Daily budget limit exceeded'
        : 'Monthly budget limit exceeded';
    }

    // Check for threshold alerts
    await this.checkAndCreateAlerts(
      validated.user_id as UUID,
      result.daily_usage,
      result.monthly_usage,
      result.daily_limit,
      result.monthly_limit,
      tx
    );

    // Emit usage event
    const context: EventContext = {
      userId: validated.user_id,
      sessionId: validated.session_id ?? null,
      turnId: validated.turn_id ?? null,
      traceId: validated.trace_id ?? crypto.randomUUID(),
    };

    await this.events.emit({
      type: 'llm.usage.recorded',
      payload: {
        usageId: result.usage_id,
        provider: validated.provider,
        model: validated.model,
        inputTokens: validated.input_tokens,
        outputTokens: validated.output_tokens,
        costUsd: calculatedCost,
        latencyMs: validated.latency_ms,
        isOverLimit: result.is_over_limit,
      },
      context,
    });

    logger.info({
      userId: validated.user_id,
      usageId: result.usage_id,
      provider: validated.provider,
      model: validated.model,
      cost: calculatedCost,
      dailyUsage: result.daily_usage,
      monthlyUsage: result.monthly_usage,
    }, 'LLM usage recorded');

    return { ...result, budget_status };
  }

  /**
   * Calculate cost for a model based on token usage
   * Uses database pricing first, falls back to hardcoded pricing
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Check cache first
    const cached = pricingCache.get(model);
    if (cached && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) {
      const inputCost = (inputTokens / 1_000_000) * cached.input;
      const outputCost = (outputTokens / 1_000_000) * cached.output;
      return Number((inputCost + outputCost).toFixed(6));
    }

    // Check for exact match in hardcoded pricing
    let pricing = MODEL_PRICING[model];

    // Try partial match for model families
    if (!pricing) {
      for (const [key, value] of Object.entries(MODEL_PRICING)) {
        if (model.includes(key) || key.includes(model)) {
          pricing = value;
          break;
        }
      }
    }

    // Default to zero if unknown (e.g., Ollama local)
    if (!pricing) {
      logger.warn({ model }, 'Unknown model pricing, defaulting to zero');
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Calculate cost asynchronously using database pricing with fallback
   * This method should be used when database lookup is acceptable
   */
  async calculateCostAsync(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    // Check cache first
    const cached = pricingCache.get(model);
    if (cached && Date.now() - cached.fetchedAt < PRICING_CACHE_TTL_MS) {
      const inputCost = (inputTokens / 1_000_000) * cached.input;
      const outputCost = (outputTokens / 1_000_000) * cached.output;
      return Number((inputCost + outputCost).toFixed(6));
    }

    // Try to get pricing from database
    try {
      const { data: models } = await this.providerRepo.listModels({ is_enabled: true });

      // Find exact match first
      let modelConfig = models.find(m => m.model_id === model);

      // Try partial match
      if (!modelConfig) {
        modelConfig = models.find(m =>
          model.includes(m.model_id) || m.model_id.includes(model)
        );
      }

      if (modelConfig && modelConfig.input_cost_per_million != null && modelConfig.output_cost_per_million != null) {
        // Cache the result
        pricingCache.set(model, {
          input: modelConfig.input_cost_per_million,
          output: modelConfig.output_cost_per_million,
          fetchedAt: Date.now(),
        });

        const inputCost = (inputTokens / 1_000_000) * modelConfig.input_cost_per_million;
        const outputCost = (outputTokens / 1_000_000) * modelConfig.output_cost_per_million;
        return Number((inputCost + outputCost).toFixed(6));
      }
    } catch (error) {
      logger.warn({ error, model }, 'Failed to fetch model pricing from database, using fallback');
    }

    // Fall back to synchronous calculation with hardcoded pricing
    return this.calculateCost(model, inputTokens, outputTokens);
  }

  /**
   * Preload model pricing from database into cache
   * Call this at startup or periodically to keep cache warm
   */
  async preloadPricingCache(): Promise<void> {
    try {
      const { data: models } = await this.providerRepo.listModels({ is_enabled: true });

      for (const model of models) {
        if (model.input_cost_per_million != null && model.output_cost_per_million != null) {
          pricingCache.set(model.model_id, {
            input: model.input_cost_per_million,
            output: model.output_cost_per_million,
            fetchedAt: Date.now(),
          });
        }
      }

      logger.info({ count: pricingCache.size }, 'Model pricing cache preloaded');
    } catch (error) {
      logger.warn({ error }, 'Failed to preload model pricing cache');
    }
  }

  /**
   * Clear the pricing cache (useful after admin updates pricing)
   */
  clearPricingCache(): void {
    pricingCache.clear();
    logger.info('Model pricing cache cleared');
  }

  // ===========================================================================
  // Image Usage Recording
  // ===========================================================================

  /**
   * Get image model cost from model_configs metadata
   * Falls back to provider-based defaults if not found
   */
  async getImageModelCost(modelId: string): Promise<number> {
    try {
      // Look up model in database
      const { data: models } = await this.providerRepo.listModels({
        is_enabled: true,
        category: 'image',
      });

      // Find matching model
      const model = models.find(m => m.model_id === modelId);
      if (model?.metadata && typeof model.metadata === 'object') {
        // Check both camelCase (costPerImage) and snake_case (cost_per_image) for compatibility
        const metadata = model.metadata as { costPerImage?: number; cost_per_image?: number };
        const cost = metadata.costPerImage ?? metadata.cost_per_image;
        if (typeof cost === 'number') {
          return cost;
        }
      }
    } catch (error) {
      logger.warn({ error, modelId }, 'Failed to fetch image model pricing from database');
    }

    // Fallback pricing based on known providers
    if (modelId.startsWith('comfyui')) {
      return 0; // Local, no cost
    }
    if (modelId.includes('flux-schnell')) {
      return 0.003;
    }
    if (modelId.includes('flux-dev')) {
      return 0.025;
    }
    if (modelId.includes('flux-pro') || modelId.includes('flux-1.1-pro')) {
      return 0.04;
    }

    logger.warn({ modelId }, 'Unknown image model pricing, defaulting to zero');
    return 0;
  }

  /**
   * Record image generation usage
   * Uses request_type='image' and looks up cost from model_configs
   */
  async recordImageUsage(
    input: {
      user_id: string;
      session_id?: string | null;
      companion_id?: string | null;
      provider: string;
      model: string;
      latency_ms?: number | null;
      request_started_at: Date;
      request_completed_at: Date;
      trace_id?: string | null;
    },
    tx?: TransactionContext
  ): Promise<UsageRecordResult & { budget_status: BudgetCheckResult }> {
    // Look up image model cost
    const costPerImage = await this.getImageModelCost(input.model);

    logger.info({
      userId: input.user_id,
      provider: input.provider,
      model: input.model,
      costPerImage,
    }, 'Recording image usage');

    // Record using existing infrastructure with image-specific defaults
    return this.recordUsage({
      user_id: input.user_id,
      session_id: input.session_id,
      companion_id: input.companion_id,
      provider: input.provider,
      model: input.model,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: costPerImage,
      latency_ms: input.latency_ms,
      request_type: 'image',
      request_started_at: input.request_started_at,
      request_completed_at: input.request_completed_at,
      trace_id: input.trace_id,
    }, tx);
  }

  /**
   * Check budget and create alerts if thresholds are exceeded
   */
  private async checkAndCreateAlerts(
    userId: UUID,
    dailyUsage: number,
    monthlyUsage: number,
    dailyLimit: number | null,
    monthlyLimit: number | null,
    tx?: TransactionContext
  ): Promise<void> {
    const budget = await this.repo.getUserBudget(userId, tx);
    const alertThreshold = budget?.alert_threshold_percent ?? 80;

    // Check daily threshold
    if (dailyLimit) {
      const dailyPercent = (dailyUsage / dailyLimit) * 100;

      if (dailyPercent >= 100) {
        await this.createAlertIfNew(userId, 'limit_reached', dailyUsage, dailyLimit, 'daily', tx);
      } else if (dailyPercent >= alertThreshold) {
        await this.createAlertIfNew(userId, 'threshold', dailyUsage, dailyLimit, 'daily', tx, alertThreshold);
      }
    }

    // Check monthly threshold
    if (monthlyLimit) {
      const monthlyPercent = (monthlyUsage / monthlyLimit) * 100;

      if (monthlyPercent >= 100) {
        await this.createAlertIfNew(userId, 'limit_reached', monthlyUsage, monthlyLimit, 'monthly', tx);
      } else if (monthlyPercent >= alertThreshold) {
        await this.createAlertIfNew(userId, 'threshold', monthlyUsage, monthlyLimit, 'monthly', tx, alertThreshold);
      }
    }
  }

  /**
   * Create alert if one doesn't already exist for this period
   */
  private async createAlertIfNew(
    userId: UUID,
    alertType: 'threshold' | 'limit_reached',
    currentUsage: number,
    limit: number,
    period: 'daily' | 'monthly',
    tx?: TransactionContext,
    thresholdPercent?: number
  ): Promise<void> {
    // Check for existing unacknowledged alert of same type/period
    const existingAlerts = await this.repo.getUnacknowledgedAlerts(userId, tx);
    const hasExisting = existingAlerts.some(
      a => a.alert_type === alertType && a.period === period
    );

    if (!hasExisting) {
      const alert = await this.repo.createAlert({
        user_id: userId,
        alert_type: alertType,
        threshold_percent: thresholdPercent,
        current_usage_usd: currentUsage,
        limit_usd: limit,
        period,
        notified_via: ['in_app'],
      }, tx);

      // Emit alert event
      const context: EventContext = {
        userId,
        sessionId: null,
        traceId: crypto.randomUUID(),
      };

      await this.events.emit({
        type: 'cost.alert.created',
        payload: {
          alertId: alert.id,
          alertType,
          period,
          currentUsageUsd: currentUsage,
          limitUsd: limit,
          thresholdPercent,
        },
        context,
      });

      logger.warn({
        userId,
        alertId: alert.id,
        alertType,
        period,
        currentUsage,
        limit,
      }, 'Cost alert created');
    }
  }

  // ===========================================================================
  // Budget Management
  // ===========================================================================

  /**
   * Check if user can make LLM request based on budget
   */
  async checkBudget(userId: UUID, tx?: TransactionContext): Promise<BudgetCheckResult> {
    const budget = await this.repo.getUserBudget(userId, tx);

    if (!budget) {
      // No budget set = unlimited
      return {
        allowed: true,
        daily_usage_usd: 0,
        monthly_usage_usd: 0,
        daily_limit_usd: null,
        monthly_limit_usd: null,
        daily_remaining_usd: null,
        monthly_remaining_usd: null,
      };
    }

    if (budget.is_blocked) {
      return {
        allowed: false,
        reason: budget.blocked_reason ?? 'Account blocked',
        daily_usage_usd: budget.daily_usage_usd,
        monthly_usage_usd: budget.monthly_usage_usd,
        daily_limit_usd: budget.daily_limit_usd,
        monthly_limit_usd: budget.monthly_limit_usd,
        daily_remaining_usd: null,
        monthly_remaining_usd: null,
      };
    }

    const dailyExceeded = budget.daily_limit_usd && budget.daily_usage_usd >= budget.daily_limit_usd;
    const monthlyExceeded = budget.monthly_limit_usd && budget.monthly_usage_usd >= budget.monthly_limit_usd;

    return {
      allowed: !dailyExceeded && !monthlyExceeded,
      reason: dailyExceeded
        ? 'Daily budget limit exceeded'
        : monthlyExceeded
          ? 'Monthly budget limit exceeded'
          : undefined,
      daily_usage_usd: budget.daily_usage_usd,
      monthly_usage_usd: budget.monthly_usage_usd,
      daily_limit_usd: budget.daily_limit_usd,
      monthly_limit_usd: budget.monthly_limit_usd,
      daily_remaining_usd: budget.daily_limit_usd
        ? Math.max(0, budget.daily_limit_usd - budget.daily_usage_usd)
        : null,
      monthly_remaining_usd: budget.monthly_limit_usd
        ? Math.max(0, budget.monthly_limit_usd - budget.monthly_usage_usd)
        : null,
    };
  }

  /**
   * Get user's current budget
   */
  async getUserBudget(userId: UUID, tx?: TransactionContext): Promise<UserCostBudget | null> {
    return this.repo.getUserBudget(userId, tx);
  }

  /**
   * Update user's budget limits
   */
  async updateUserBudget(
    userId: UUID,
    input: UpdateBudgetInput,
    tx?: TransactionContext
  ): Promise<UserCostBudget> {
    const validated = UpdateBudgetInputSchema.parse(input);

    const budget = await this.repo.updateUserBudget(userId, validated, tx);

    logger.info({ userId, ...validated }, 'User budget updated');

    return budget;
  }

  /**
   * Block user from LLM usage
   */
  async blockUser(userId: UUID, reason: string, tx?: TransactionContext): Promise<void> {
    await this.repo.setUserBlocked(userId, true, reason, tx);
    logger.warn({ userId, reason }, 'User blocked from LLM usage');
  }

  /**
   * Unblock user for LLM usage
   */
  async unblockUser(userId: UUID, tx?: TransactionContext): Promise<void> {
    await this.repo.setUserBlocked(userId, false, undefined, tx);
    logger.info({ userId }, 'User unblocked for LLM usage');
  }

  // ===========================================================================
  // Cost Analytics
  // ===========================================================================

  /**
   * Get user's cost summary
   */
  async getUserCostSummary(
    userId: UUID,
    days: number = 30,
    tx?: TransactionContext
  ): Promise<UserCostSummary> {
    return this.repo.getUserCostSummary(userId, days, tx);
  }

  /**
   * Get platform-wide cost summary (admin only)
   */
  async getPlatformCostSummary(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<PlatformCostSummary> {
    return this.repo.getPlatformCostSummary(days, tx);
  }

  /**
   * Get cost trend over time
   */
  async getCostTrend(
    days: number = 30,
    userId?: UUID,
    tx?: TransactionContext
  ): Promise<CostTrendPoint[]> {
    return this.repo.getCostTrend(days, userId, tx);
  }

  /**
   * Get top users by cost (admin only)
   */
  async getTopUsersByCost(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ user_id: UUID; total_cost: number; request_count: number; revenue_cents: number }>> {
    return this.repo.getTopUsersByCost(days, limit, tx);
  }

  /**
   * Get cost breakdown by provider
   */
  async getCostByProvider(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<Array<{ provider: string; cost: number; requests: number; tokens: number }>> {
    return this.repo.getCostByProvider(days, tx);
  }

  /**
   * Get cost breakdown by model
   */
  async getCostByModel(
    days: number = 30,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ model: string; provider: string; cost: number; requests: number }>> {
    return this.repo.getCostByModel(days, limit, tx);
  }

  // ===========================================================================
  // Usage History
  // ===========================================================================

  /**
   * List usage events with filters
   */
  async listUsageEvents(
    filters: UsageListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<LLMUsageEvent>> {
    return this.repo.listUsageEvents(filters, tx);
  }

  /**
   * Get daily aggregates
   */
  async getDailyAggregates(
    filters: {
      start_date?: string;
      end_date?: string;
      user_id?: UUID;
      provider?: string;
      limit?: number;
    } = {},
    tx?: TransactionContext
  ): Promise<DailyAggregate[]> {
    return this.repo.getDailyAggregates(filters, tx);
  }

  /**
   * Trigger daily aggregation (called by cron job)
   */
  async aggregateDailyCosts(date: string, tx?: TransactionContext): Promise<number> {
    const count = await this.repo.aggregateDailyCosts(date, tx);
    logger.info({ date, aggregatedRows: count }, 'Daily LLM costs aggregated');
    return count;
  }

  // ===========================================================================
  // Alerts
  // ===========================================================================

  /**
   * Get user's unacknowledged alerts
   */
  async getUnacknowledgedAlerts(userId: UUID, tx?: TransactionContext): Promise<CostAlert[]> {
    return this.repo.getUnacknowledgedAlerts(userId, tx);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: UUID, tx?: TransactionContext): Promise<void> {
    await this.repo.acknowledgeAlert(alertId, tx);
    logger.debug({ alertId }, 'Cost alert acknowledged');
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Get model pricing info
   */
  getModelPricing(model: string): { input: number; output: number } | null {
    return MODEL_PRICING[model] ?? null;
  }

  /**
   * List all known model pricing
   */
  listModelPricing(): Record<string, { input: number; output: number }> {
    return { ...MODEL_PRICING };
  }

  /**
   * Estimate cost for a request before making it
   */
  estimateCost(model: string, estimatedInputTokens: number, estimatedOutputTokens: number): number {
    return this.calculateCost(model, estimatedInputTokens, estimatedOutputTokens);
  }
}

// Singleton instance
let llmUsageService: LLMUsageService | null = null;

export function getLLMUsageService(): LLMUsageService {
  if (!llmUsageService) {
    llmUsageService = new LLMUsageService();
  }
  return llmUsageService;
}
