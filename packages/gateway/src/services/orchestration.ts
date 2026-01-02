/**
 * Orchestration Service
 * Handles orchestration test runs, metrics collection, and provider health monitoring.
 */

import { z } from 'zod';
import {
  getOrchestrationTestsRepository,
  getOrchestrationMetricsRepository,
  type OrchestrationTestRun,
  type OrchestrationTestResult,
  type ProviderHealth,
  type OrchestrationMetricsSnapshot,
  type TestRunType,
  type TestRunStatus,
  type TestResultStatus,
} from '../repositories/index.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';
import type { UUID } from '../db/types.js';

// ============================================================================
// Configuration
// ============================================================================

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';

// ============================================================================
// Validation Schemas
// ============================================================================

export const TriggerTestRunSchema = z.object({
  runType: z.enum(['routing', 'memory', 'integration', 'performance', 'all']),
});

export const TestRunListQuerySchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  runType: z.enum(['routing', 'memory', 'integration', 'performance', 'all']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const TestResultListQuerySchema = z.object({
  status: z.enum(['passed', 'failed', 'skipped', 'error']).optional(),
  category: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const MetricsQuerySchema = z.object({
  period: z.enum(['hourly', 'daily', 'weekly', 'monthly']).default('daily'),
  days: z.coerce.number().min(1).max(90).default(30),
});

// ============================================================================
// Types
// ============================================================================

export type TriggerTestRunInput = z.infer<typeof TriggerTestRunSchema>;
export type TestRunListQuery = z.infer<typeof TestRunListQuerySchema>;
export type TestResultListQuery = z.infer<typeof TestResultListQuerySchema>;
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export interface OrchestratorTestResponse {
  run_id: string;
  status: string;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  results: Array<{
    test_name: string;
    test_category: string;
    status: string;
    duration_ms: number;
    error_message?: string;
    error_stack?: string;
    metrics?: Record<string, unknown>;
  }>;
  summary?: Record<string, unknown>;
}

export interface MetricsSummary {
  totalRequests: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  safetyPassRate: number;
  providerBreakdown: Record<string, {
    requests: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    totalTokens: number;
  }>;
}

export interface TestRunWithResults extends OrchestrationTestRun {
  results?: OrchestrationTestResult[];
  categoryBreakdown?: Array<{ category: string; passed: number; failed: number; skipped: number }>;
}

// ============================================================================
// Service
// ============================================================================

export class OrchestrationService {
  private testsRepo = getOrchestrationTestsRepository();
  private metricsRepo = getOrchestrationMetricsRepository();

  /**
   * Trigger a new test run
   */
  async triggerTestRun(
    input: TriggerTestRunInput,
    triggeredBy: UUID,
    tx?: TransactionContext
  ): Promise<OrchestrationTestRun> {
    const validated = TriggerTestRunSchema.parse(input);

    // Create the test run record
    const run = await this.testsRepo.createRun({
      run_type: validated.runType,
      triggered_by: triggeredBy,
    }, tx);

    // Start the test run asynchronously
    this.executeTestRun(run.id, validated.runType).catch(error => {
      logger.error({ runId: run.id, error }, 'Failed to execute test run');
    });

    logger.info({ runId: run.id, runType: validated.runType, triggeredBy }, 'Test run triggered');

    return run;
  }

  /**
   * Execute a test run against the orchestrator
   */
  private async executeTestRun(runId: UUID, runType: TestRunType): Promise<void> {
    try {
      // Update status to running
      await this.testsRepo.updateRun(runId, {
        status: 'running',
        started_at: new Date(),
      });

      // Call orchestrator test endpoint
      const response = await fetch(`${ORCHESTRATOR_URL}/tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_type: runType, run_id: runId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Orchestrator returned ${response.status}: ${errorText}`);
      }

      const result = (await response.json()) as OrchestratorTestResponse;

      // Store results
      if (result.results && result.results.length > 0) {
        await this.testsRepo.createResultsBatch(
          result.results.map(r => ({
            test_run_id: runId,
            test_name: r.test_name,
            test_category: r.test_category,
            status: r.status as TestResultStatus,
            duration_ms: r.duration_ms,
            error_message: r.error_message,
            error_stack: r.error_stack,
            metrics: r.metrics,
          }))
        );
      }

      // Update run with final stats
      await this.testsRepo.updateRun(runId, {
        status: 'completed',
        total_tests: result.total_tests,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        duration_ms: result.duration_ms,
        summary: result.summary,
        completed_at: new Date(),
      });

      logger.info({ runId, passed: result.passed, failed: result.failed }, 'Test run completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.testsRepo.updateRun(runId, {
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date(),
      });

      logger.error({ runId, error: errorMessage }, 'Test run failed');
    }
  }

  /**
   * Get a test run by ID with optional results
   */
  async getTestRun(
    runId: UUID,
    includeResults: boolean = false,
    tx?: TransactionContext
  ): Promise<TestRunWithResults | null> {
    const run = await this.testsRepo.getRunById(runId, tx);
    if (!run) return null;

    const result: TestRunWithResults = { ...run };

    if (includeResults) {
      const { data: results } = await this.testsRepo.listResults({ test_run_id: runId, limit: 500 }, tx);
      result.results = results;
      result.categoryBreakdown = await this.testsRepo.getResultSummaryByCategory(runId, tx);
    }

    return result;
  }

  /**
   * List test runs
   */
  async listTestRuns(
    query: TestRunListQuery,
    tx?: TransactionContext
  ): Promise<PaginatedResult<OrchestrationTestRun>> {
    const validated = TestRunListQuerySchema.parse(query);
    return this.testsRepo.listRuns({
      status: validated.status as TestRunStatus,
      run_type: validated.runType as TestRunType,
      limit: validated.limit,
      offset: validated.offset,
    }, tx);
  }

  /**
   * List test results for a run
   */
  async listTestResults(
    runId: UUID,
    query: TestResultListQuery,
    tx?: TransactionContext
  ): Promise<PaginatedResult<OrchestrationTestResult>> {
    const validated = TestResultListQuerySchema.parse(query);
    return this.testsRepo.listResults({
      test_run_id: runId,
      status: validated.status as TestResultStatus,
      test_category: validated.category,
      limit: validated.limit,
      offset: validated.offset,
    }, tx);
  }

  /**
   * Get test run statistics
   */
  async getTestRunStats(days: number = 30, tx?: TransactionContext) {
    return this.testsRepo.getRunStats(days, tx);
  }

  /**
   * Get provider health statuses
   */
  async getProviderHealth(tx?: TransactionContext): Promise<ProviderHealth[]> {
    return this.testsRepo.getProviderHealth(tx);
  }

  /**
   * Refresh provider health from orchestrator
   */
  async refreshProviderHealth(): Promise<ProviderHealth[]> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/health/providers`);

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Failed to fetch provider health from orchestrator');
        return this.testsRepo.getProviderHealth();
      }

      const healthData = (await response.json()) as {
        providers?: Record<string, {
          is_available: boolean;
          avg_latency_ms?: number;
          error_count?: number;
          success_rate?: number;
          last_error?: string;
        }>;
      };

      // Update each provider's health
      const updates: ProviderHealth[] = [];
      for (const [provider, status] of Object.entries(healthData.providers || {})) {
        const providerStatus = status as {
          is_available: boolean;
          avg_latency_ms?: number;
          error_count?: number;
          success_rate?: number;
          last_error?: string;
        };

        const updated = await this.testsRepo.updateProviderHealth(provider, {
          is_available: providerStatus.is_available,
          avg_latency_ms: providerStatus.avg_latency_ms,
          error_count: providerStatus.error_count,
          success_rate: providerStatus.success_rate,
          last_error_message: providerStatus.last_error,
          last_success_at: providerStatus.is_available ? new Date() : undefined,
          last_error_at: !providerStatus.is_available ? new Date() : undefined,
        });
        updates.push(updated);
      }

      return updates;
    } catch (error) {
      logger.error({ error }, 'Failed to refresh provider health');
      return this.testsRepo.getProviderHealth();
    }
  }

  /**
   * Get metrics summary for dashboard
   */
  async getMetricsSummary(query: MetricsQuery, tx?: TransactionContext): Promise<MetricsSummary> {
    const validated = MetricsQuerySchema.parse(query);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - validated.days);

    const metrics = await this.metricsRepo.getAggregatedMetrics(startDate, endDate, tx);

    return {
      totalRequests: metrics.total_requests,
      totalCostUsd: metrics.total_cost_usd,
      avgLatencyMs: metrics.avg_latency_ms,
      safetyPassRate: metrics.safety_pass_rate,
      providerBreakdown: Object.fromEntries(
        Object.entries(metrics.provider_breakdown).map(([k, v]) => [k, {
          requests: v.requests,
          successes: v.successes,
          failures: v.failures,
          avgLatencyMs: v.avg_latency_ms,
          totalTokens: v.total_tokens,
        }])
      ),
    };
  }

  /**
   * Get cost trend data
   */
  async getCostTrend(
    period: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily',
    limit: number = 30,
    tx?: TransactionContext
  ) {
    return this.metricsRepo.getCostTrend(period, limit, tx);
  }

  /**
   * Get routing distribution
   */
  async getRoutingDistribution(days: number = 30, tx?: TransactionContext) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.metricsRepo.getRoutingDistribution(startDate, endDate, tx);
  }

  /**
   * Get latest metrics snapshot
   */
  async getLatestMetrics(
    period: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily',
    tx?: TransactionContext
  ): Promise<OrchestrationMetricsSnapshot | null> {
    return this.metricsRepo.getLatestSnapshot(period, tx);
  }

  /**
   * Check orchestrator health
   */
  async checkOrchestratorHealth(): Promise<{
    healthy: boolean;
    status: string;
    version?: string;
    uptime?: number;
  }> {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { healthy: false, status: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as { version?: string; uptime?: number };
      return {
        healthy: true,
        status: 'healthy',
        version: data.version,
        uptime: data.uptime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { healthy: false, status: message };
    }
  }
}

// Singleton
let orchestrationService: OrchestrationService | null = null;

export function getOrchestrationService(): OrchestrationService {
  if (!orchestrationService) {
    orchestrationService = new OrchestrationService();
  }
  return orchestrationService;
}
