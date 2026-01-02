/**
 * Admin Orchestration Routes
 * Endpoints for orchestration testing, metrics, and health monitoring.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import {
  getOrchestrationService,
  TriggerTestRunSchema,
  TestRunListQuerySchema,
  TestResultListQuerySchema,
  MetricsQuerySchema,
} from '../services/orchestration.js';
import { logger } from '../observability/logger.js';

// Request schemas
const RunIdParamsSchema = z.object({
  runId: z.string().uuid(),
});

const CostTrendQuerySchema = z.object({
  period: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily'),
  limit: z.coerce.number().min(1).max(90).default(30),
});

const RoutingDistributionQuerySchema = z.object({
  days: z.coerce.number().min(1).max(90).default(30),
});

/**
 * Register admin orchestration routes
 */
export async function adminOrchestrationRoutes(app: FastifyInstance): Promise<void> {
  const service = getOrchestrationService();

  // All orchestration routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // Test Runs
  // ===========================================================================

  /**
   * POST /admin/orchestration/tests/runs - Trigger a new test run
   */
  app.post('/tests/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const bodyResult = TriggerTestRunSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    const adminUserId = request.user!.userId;

    try {
      const run = await service.triggerTestRun(bodyResult.data, adminUserId);

      logger.info({ runId: run.id, runType: run.run_type, adminUserId }, 'Test run triggered via admin');

      return reply.status(202).send({
        success: true,
        data: {
          id: run.id,
          runType: run.run_type,
          status: run.status,
          createdAt: run.created_at.toISOString(),
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to trigger test run');
      return reply.status(500).send({
        error: 'Internal Error',
        message: 'Failed to trigger test run',
      });
    }
  });

  /**
   * GET /admin/orchestration/tests/runs - List test runs
   */
  app.get('/tests/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = TestRunListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const result = await service.listTestRuns(queryResult.data);

    return reply.send({
      success: true,
      data: {
        runs: result.data.map(run => ({
          id: run.id,
          runType: run.run_type,
          status: run.status,
          totalTests: run.total_tests,
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
          durationMs: run.duration_ms,
          triggeredBy: run.triggered_by,
          startedAt: run.started_at?.toISOString() ?? null,
          completedAt: run.completed_at?.toISOString() ?? null,
          createdAt: run.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * GET /admin/orchestration/tests/runs/:runId - Get test run details
   */
  app.get('/tests/runs/:runId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = RunIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid run ID',
        details: paramsResult.error.issues,
      });
    }

    const { runId } = paramsResult.data;
    const includeResults = (request.query as { includeResults?: string }).includeResults === 'true';

    const run = await service.getTestRun(runId, includeResults);

    if (!run) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Test run not found',
      });
    }

    return reply.send({
      success: true,
      data: {
        id: run.id,
        runType: run.run_type,
        status: run.status,
        totalTests: run.total_tests,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        durationMs: run.duration_ms,
        summary: run.summary,
        errorMessage: run.error_message,
        triggeredBy: run.triggered_by,
        startedAt: run.started_at?.toISOString() ?? null,
        completedAt: run.completed_at?.toISOString() ?? null,
        createdAt: run.created_at.toISOString(),
        results: run.results?.map(r => ({
          id: r.id,
          testName: r.test_name,
          testCategory: r.test_category,
          status: r.status,
          durationMs: r.duration_ms,
          errorMessage: r.error_message,
          metrics: r.metrics,
        })),
        categoryBreakdown: run.categoryBreakdown,
      },
    });
  });

  /**
   * GET /admin/orchestration/tests/runs/:runId/results - List test results for a run
   */
  app.get('/tests/runs/:runId/results', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = RunIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid run ID',
        details: paramsResult.error.issues,
      });
    }

    const queryResult = TestResultListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { runId } = paramsResult.data;

    // Verify run exists
    const run = await service.getTestRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Test run not found',
      });
    }

    const result = await service.listTestResults(runId, queryResult.data);

    return reply.send({
      success: true,
      data: {
        results: result.data.map(r => ({
          id: r.id,
          testName: r.test_name,
          testCategory: r.test_category,
          status: r.status,
          durationMs: r.duration_ms,
          errorMessage: r.error_message,
          errorStack: r.error_stack,
          metrics: r.metrics,
          createdAt: r.created_at.toISOString(),
        })),
        hasMore: result.hasMore,
      },
    });
  });

  /**
   * GET /admin/orchestration/tests/stats - Get test run statistics
   */
  app.get('/tests/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const days = parseInt((request.query as { days?: string }).days || '30', 10);
    const stats = await service.getTestRunStats(days);

    return reply.send({
      success: true,
      data: stats,
    });
  });

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * GET /admin/orchestration/metrics/summary - Get metrics summary
   */
  app.get('/metrics/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = MetricsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const summary = await service.getMetricsSummary(queryResult.data);

    return reply.send({
      success: true,
      data: summary,
    });
  });

  /**
   * GET /admin/orchestration/metrics/cost-trend - Get cost trend data
   */
  app.get('/metrics/cost-trend', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CostTrendQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { period, limit } = queryResult.data;
    const trend = await service.getCostTrend(period, limit);

    return reply.send({
      success: true,
      data: { trend },
    });
  });

  /**
   * GET /admin/orchestration/metrics/routing - Get routing distribution
   */
  app.get('/metrics/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = RoutingDistributionQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const distribution = await service.getRoutingDistribution(queryResult.data.days);

    return reply.send({
      success: true,
      data: distribution,
    });
  });

  /**
   * GET /admin/orchestration/metrics/latest - Get latest metrics snapshot
   */
  app.get('/metrics/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    const period = ((request.query as { period?: string }).period || 'daily') as 'hourly' | 'daily' | 'weekly' | 'monthly';
    const snapshot = await service.getLatestMetrics(period);

    if (!snapshot) {
      return reply.send({
        success: true,
        data: null,
      });
    }

    return reply.send({
      success: true,
      data: {
        id: snapshot.id,
        period: snapshot.period,
        periodStart: snapshot.period_start.toISOString(),
        periodEnd: snapshot.period_end.toISOString(),
        providerStats: snapshot.provider_stats,
        routingStats: snapshot.routing_stats,
        costStats: snapshot.cost_stats,
        safetyStats: snapshot.safety_stats,
        performanceStats: snapshot.performance_stats,
        createdAt: snapshot.created_at.toISOString(),
      },
    });
  });

  // ===========================================================================
  // Provider Health
  // ===========================================================================

  /**
   * GET /admin/orchestration/providers - Get provider health statuses
   */
  app.get('/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    const providers = await service.getProviderHealth();

    return reply.send({
      success: true,
      data: {
        providers: providers.map(p => ({
          provider: p.provider,
          isAvailable: p.is_available,
          lastCheckAt: p.last_check_at.toISOString(),
          lastSuccessAt: p.last_success_at?.toISOString() ?? null,
          lastErrorAt: p.last_error_at?.toISOString() ?? null,
          lastErrorMessage: p.last_error_message,
          errorCount: p.error_count,
          avgLatencyMs: p.avg_latency_ms,
          successRate: p.success_rate,
        })),
      },
    });
  });

  /**
   * POST /admin/orchestration/providers/refresh - Refresh provider health
   */
  app.post('/providers/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const providers = await service.refreshProviderHealth();

    logger.info({ adminUserId: request.user!.userId }, 'Provider health refreshed via admin');

    return reply.send({
      success: true,
      data: {
        providers: providers.map(p => ({
          provider: p.provider,
          isAvailable: p.is_available,
          lastCheckAt: p.last_check_at.toISOString(),
          avgLatencyMs: p.avg_latency_ms,
          successRate: p.success_rate,
        })),
      },
    });
  });

  // ===========================================================================
  // Health
  // ===========================================================================

  /**
   * GET /admin/orchestration/health - Check orchestrator health
   */
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const health = await service.checkOrchestratorHealth();

    return reply.send({
      success: true,
      data: health,
    });
  });
}
