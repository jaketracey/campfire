/**
 * Admin Cost Routes
 * LLM cost tracking, budget management, and usage analytics for administrators.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { getLLMUsageService } from '../services/llm-usage.js';
import { logger } from '../observability/logger.js';
import type { UUID } from '../db/types.js';

// ===========================================================================
// Request Schemas
// ===========================================================================

const CostSummaryQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

const CostTrendQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
  userId: z.string().uuid().optional(),
});

const TopUsersQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 10),
});

const CostByProviderQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

const CostByModelQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 10),
});

const UserIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

const UpdateBudgetBodySchema = z.object({
  daily_limit_usd: z.number().min(0).nullable().optional(),
  monthly_limit_usd: z.number().min(0).nullable().optional(),
  alert_threshold_percent: z.number().min(0).max(100).optional(),
});

const UsageListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  companionId: z.string().uuid().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
  offset: z.string().optional().transform(v => v ? parseInt(v, 10) : 0),
});

const DailyAggregatesQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  userId: z.string().uuid().optional(),
  provider: z.string().optional(),
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

const AlertIdParamsSchema = z.object({
  alertId: z.string().uuid(),
});

const BlockUserBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

// ===========================================================================
// Admin Routes
// ===========================================================================

/**
 * Register admin cost routes
 */
export async function adminCostsRoutes(app: FastifyInstance): Promise<void> {
  const llmUsage = getLLMUsageService();

  // All admin cost routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Platform-Wide Analytics
  // ===========================================================================

  /**
   * GET /admin/costs/summary - Platform-wide cost summary
   */
  app.get('/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostSummaryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;
    const summary = await llmUsage.getPlatformCostSummary(days);

    return reply.send({
      success: true,
      data: {
        period: {
          days,
          start: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
        totals: {
          costUsd: summary.total_cost_usd,
          requests: summary.total_requests,
          inputTokens: summary.total_input_tokens,
          outputTokens: summary.total_output_tokens,
          uniqueUsers: summary.unique_users,
          avgCostPerUser: summary.avg_cost_per_user,
        },
        breakdown: {
          byProvider: summary.cost_by_provider,
          byModel: summary.cost_by_model,
        },
      },
    });
  });

  /**
   * GET /admin/costs/trend - Cost trend over time
   */
  app.get('/trend', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostTrendQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days, userId } = queryResult.data;
    const trend = await llmUsage.getCostTrend(days, userId as UUID | undefined);

    return reply.send({
      success: true,
      data: {
        period: { days },
        trend: trend.map(point => ({
          date: point.date,
          costUsd: point.cost_usd,
          requestCount: point.request_count,
          tokens: point.tokens,
        })),
      },
    });
  });

  /**
   * GET /admin/costs/by-provider - Cost breakdown by provider
   */
  app.get('/by-provider', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostByProviderQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;
    const breakdown = await llmUsage.getCostByProvider(days);

    return reply.send({
      success: true,
      data: {
        period: { days },
        providers: breakdown.map(p => ({
          provider: p.provider,
          costUsd: p.cost,
          requests: p.requests,
          tokens: p.tokens,
        })),
      },
    });
  });

  /**
   * GET /admin/costs/by-model - Cost breakdown by model
   */
  app.get('/by-model', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostByModelQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days, limit } = queryResult.data;
    const breakdown = await llmUsage.getCostByModel(days, limit);

    return reply.send({
      success: true,
      data: {
        period: { days },
        models: breakdown.map(m => ({
          model: m.model,
          provider: m.provider,
          costUsd: m.cost,
          requests: m.requests,
        })),
      },
    });
  });

  /**
   * GET /admin/costs/top-users - Top users by cost
   */
  app.get('/top-users', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = TopUsersQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days, limit } = queryResult.data;
    const topUsers = await llmUsage.getTopUsersByCost(days, limit);

    return reply.send({
      success: true,
      data: {
        period: { days },
        users: topUsers.map(u => ({
          userId: u.user_id,
          totalCostUsd: u.total_cost,
          requestCount: u.request_count,
          revenueUsd: u.revenue_cents / 100,
        })),
      },
    });
  });

  // ===========================================================================
  // User-Specific Management
  // ===========================================================================

  /**
   * GET /admin/costs/users/:userId - User cost details
   */
  app.get('/users/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const queryResult = CostSummaryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const { days } = queryResult.data;

    const [summary, budget, trend] = await Promise.all([
      llmUsage.getUserCostSummary(userId as UUID, days),
      llmUsage.getUserBudget(userId as UUID),
      llmUsage.getCostTrend(days, userId as UUID),
    ]);

    return reply.send({
      success: true,
      data: {
        userId,
        period: { days },
        summary: {
          totalCostUsd: summary.total_cost_usd,
          totalRequests: summary.total_requests,
          inputTokens: summary.total_input_tokens,
          outputTokens: summary.total_output_tokens,
          avgCostPerRequest: summary.avg_cost_per_request,
          topModel: summary.top_model,
          topCompanionId: summary.top_companion_id,
        },
        budget: budget ? {
          dailyLimitUsd: budget.daily_limit_usd,
          monthlyLimitUsd: budget.monthly_limit_usd,
          dailyUsageUsd: budget.daily_usage_usd,
          monthlyUsageUsd: budget.monthly_usage_usd,
          alertThresholdPercent: budget.alert_threshold_percent,
          isBlocked: budget.is_blocked,
          blockedReason: budget.blocked_reason,
        } : null,
        trend: trend.map(point => ({
          date: point.date,
          costUsd: point.cost_usd,
          requests: point.request_count,
        })),
      },
    });
  });

  /**
   * PUT /admin/costs/users/:userId/budget - Update user budget
   */
  app.put('/users/:userId/budget', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = UpdateBudgetBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const adminUserId = request.user!.userId;

    const budget = await llmUsage.updateUserBudget(userId as UUID, bodyResult.data);

    logger.info({ userId, adminUserId, ...bodyResult.data }, 'Admin updated user budget');

    return reply.send({
      success: true,
      data: {
        userId,
        dailyLimitUsd: budget.daily_limit_usd,
        monthlyLimitUsd: budget.monthly_limit_usd,
        alertThresholdPercent: budget.alert_threshold_percent,
        dailyUsageUsd: budget.daily_usage_usd,
        monthlyUsageUsd: budget.monthly_usage_usd,
      },
    });
  });

  /**
   * POST /admin/costs/users/:userId/block - Block user from LLM usage
   */
  app.post('/users/:userId/block', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const bodyResult = BlockUserBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const { reason } = bodyResult.data;
    const adminUserId = request.user!.userId;

    await llmUsage.blockUser(userId as UUID, reason);

    logger.warn({ userId, reason, adminUserId }, 'Admin blocked user from LLM usage');

    return reply.send({
      success: true,
      data: { userId, blocked: true, reason },
    });
  });

  /**
   * POST /admin/costs/users/:userId/unblock - Unblock user for LLM usage
   */
  app.post('/users/:userId/unblock', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = UserIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid user ID',
        details: paramsResult.error.issues,
      });
    }

    const { userId } = paramsResult.data;
    const adminUserId = request.user!.userId;

    await llmUsage.unblockUser(userId as UUID);

    logger.info({ userId, adminUserId }, 'Admin unblocked user for LLM usage');

    return reply.send({
      success: true,
      data: { userId, blocked: false },
    });
  });

  // ===========================================================================
  // Usage History
  // ===========================================================================

  /**
   * GET /admin/costs/usage - List usage events
   */
  app.get('/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = UsageListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;
    const result = await llmUsage.listUsageEvents({
      user_id: query.userId as UUID | undefined,
      session_id: query.sessionId as UUID | undefined,
      companion_id: query.companionId as UUID | undefined,
      provider: query.provider,
      model: query.model,
      start_date: query.startDate ? new Date(query.startDate) : undefined,
      end_date: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send({
      success: true,
      data: {
        events: result.data.map(e => ({
          id: e.id,
          userId: e.user_id,
          sessionId: e.session_id,
          companionId: e.companion_id,
          provider: e.provider,
          model: e.model,
          inputTokens: e.input_tokens,
          outputTokens: e.output_tokens,
          totalTokens: e.total_tokens,
          costUsd: e.cost_usd,
          latencyMs: e.latency_ms,
          finishReason: e.finish_reason,
          requestType: e.request_type,
          streamMode: e.stream_mode,
          createdAt: e.created_at,
        })),
        hasMore: result.hasMore,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  /**
   * GET /admin/costs/daily-aggregates - Get daily aggregated costs
   */
  app.get('/daily-aggregates', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DailyAggregatesQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const query = queryResult.data;
    const aggregates = await llmUsage.getDailyAggregates({
      start_date: query.startDate,
      end_date: query.endDate,
      user_id: query.userId as UUID | undefined,
      provider: query.provider,
      limit: query.limit,
    });

    return reply.send({
      success: true,
      data: {
        aggregates: aggregates.map(a => ({
          date: a.date,
          userId: a.user_id,
          provider: a.provider,
          model: a.model,
          companionId: a.companion_id,
          requestCount: a.request_count,
          inputTokens: a.input_tokens_total,
          outputTokens: a.output_tokens_total,
          totalTokens: a.total_tokens,
          costUsd: a.cost_usd_total,
          latencyAvgMs: a.latency_avg_ms,
          latencyP50Ms: a.latency_p50_ms,
          latencyP95Ms: a.latency_p95_ms,
          latencyP99Ms: a.latency_p99_ms,
        })),
      },
    });
  });

  /**
   * POST /admin/costs/aggregate - Trigger daily aggregation (for manual runs)
   */
  app.post('/aggregate', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodySchema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    });

    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { date } = bodyResult.data;
    const count = await llmUsage.aggregateDailyCosts(date);

    logger.info({ date, aggregatedRows: count, adminUserId: request.user!.userId }, 'Manual cost aggregation triggered');

    return reply.send({
      success: true,
      data: { date, aggregatedRows: count },
    });
  });

  // ===========================================================================
  // Model Pricing
  // ===========================================================================

  /**
   * GET /admin/costs/pricing - Get model pricing info
   */
  app.get('/pricing', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pricing = llmUsage.listModelPricing();

    const models = Object.entries(pricing).map(([model, prices]) => ({
      model,
      inputPer1M: prices.input,
      outputPer1M: prices.output,
    }));

    return reply.send({
      success: true,
      data: {
        pricing: models,
        note: 'Prices are in USD per 1 million tokens',
      },
    });
  });

  /**
   * POST /admin/costs/estimate - Estimate cost for a request
   */
  app.post('/estimate', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodySchema = z.object({
      model: z.string().min(1),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
    });

    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const { model, inputTokens, outputTokens } = bodyResult.data;
    const estimatedCost = llmUsage.estimateCost(model, inputTokens, outputTokens);
    const pricing = llmUsage.getModelPricing(model);

    return reply.send({
      success: true,
      data: {
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimatedCost,
        pricingUsed: pricing ? {
          inputPer1M: pricing.input,
          outputPer1M: pricing.output,
        } : null,
      },
    });
  });
}

// ===========================================================================
// User-Facing Routes (for /users/me/costs)
// ===========================================================================

/**
 * Register user cost routes (for authenticated users viewing their own costs)
 */
export async function userCostsRoutes(app: FastifyInstance): Promise<void> {
  const llmUsage = getLLMUsageService();

  // All user cost routes require authentication
  app.addHook('preHandler', requireAuth);

  /**
   * GET /users/me/costs - Get current user's cost summary
   */
  app.get('/costs', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostSummaryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const userId = request.user!.userId as UUID;
    const { days } = queryResult.data;

    const [summary, budget, trend] = await Promise.all([
      llmUsage.getUserCostSummary(userId, days),
      llmUsage.getUserBudget(userId),
      llmUsage.getCostTrend(days, userId),
    ]);

    return reply.send({
      success: true,
      data: {
        period: { days },
        summary: {
          totalCostUsd: summary.total_cost_usd,
          totalRequests: summary.total_requests,
          avgCostPerRequest: summary.avg_cost_per_request,
          topModel: summary.top_model,
        },
        budget: budget ? {
          dailyLimitUsd: budget.daily_limit_usd,
          monthlyLimitUsd: budget.monthly_limit_usd,
          dailyUsageUsd: budget.daily_usage_usd,
          monthlyUsageUsd: budget.monthly_usage_usd,
          dailyRemainingUsd: budget.daily_limit_usd
            ? Math.max(0, budget.daily_limit_usd - budget.daily_usage_usd)
            : null,
          monthlyRemainingUsd: budget.monthly_limit_usd
            ? Math.max(0, budget.monthly_limit_usd - budget.monthly_usage_usd)
            : null,
        } : null,
        trend: trend.map(point => ({
          date: point.date,
          costUsd: point.cost_usd,
        })),
      },
    });
  });

  /**
   * GET /users/me/costs/usage - Get current user's usage history
   */
  app.get('/costs/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = z.object({
      limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 20),
      offset: z.string().optional().transform(v => v ? parseInt(v, 10) : 0),
    }).safeParse(request.query);

    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const userId = request.user!.userId as UUID;
    const { limit, offset } = queryResult.data;

    const result = await llmUsage.listUsageEvents({
      user_id: userId,
      limit,
      offset,
    });

    return reply.send({
      success: true,
      data: {
        usage: result.data.map(e => ({
          model: e.model,
          inputTokens: e.input_tokens,
          outputTokens: e.output_tokens,
          costUsd: e.cost_usd,
          companionId: e.companion_id,
          createdAt: e.created_at,
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * GET /users/me/costs/alerts - Get current user's cost alerts
   */
  app.get('/costs/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId as UUID;
    const alerts = await llmUsage.getUnacknowledgedAlerts(userId);

    return reply.send({
      success: true,
      data: {
        alerts: alerts.map(a => ({
          id: a.id,
          alertType: a.alert_type,
          period: a.period,
          currentUsageUsd: a.current_usage_usd,
          limitUsd: a.limit_usd,
          thresholdPercent: a.threshold_percent,
          createdAt: a.created_at,
        })),
      },
    });
  });

  /**
   * POST /users/me/costs/alerts/:alertId/acknowledge - Acknowledge an alert
   */
  app.post('/costs/alerts/:alertId/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = AlertIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid alert ID',
        details: paramsResult.error.issues,
      });
    }

    const { alertId } = paramsResult.data;
    await llmUsage.acknowledgeAlert(alertId as UUID);

    return reply.send({
      success: true,
      data: { alertId, acknowledged: true },
    });
  });
}
