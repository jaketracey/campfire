/**
 * Orchestration API
 * Administrative operations for orchestration testing and metrics.
 */

import { get, post } from './client';

// ============================================================================
// Types
// ============================================================================

export type TestRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TestRunType = 'routing' | 'memory' | 'integration' | 'performance' | 'all';
export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface TestRun {
  id: string;
  runType: TestRunType;
  status: TestRunStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  triggeredBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TestResult {
  id: string;
  testName: string;
  testCategory: string;
  status: TestResultStatus;
  durationMs: number | null;
  errorMessage: string | null;
  errorStack?: string | null;
  metrics: Record<string, unknown> | null;
  createdAt: string;
}

export interface TestRunWithResults extends TestRun {
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  results?: TestResult[];
  categoryBreakdown?: Array<{
    category: string;
    passed: number;
    failed: number;
    skipped: number;
  }>;
}

export interface TestRunListResponse {
  success: boolean;
  data: {
    runs: TestRun[];
    hasMore: boolean;
  };
}

export interface TestRunDetailResponse {
  success: boolean;
  data: TestRunWithResults;
}

export interface TestResultListResponse {
  success: boolean;
  data: {
    results: TestResult[];
    hasMore: boolean;
  };
}

export interface TestRunStatsResponse {
  success: boolean;
  data: {
    total_runs: number;
    passed_runs: number;
    failed_runs: number;
    avg_duration_ms: number;
    by_type: Record<string, { total: number; passed: number; failed: number }>;
  };
}

export interface TriggerTestRunResponse {
  success: boolean;
  data: {
    id: string;
    runType: TestRunType;
    status: TestRunStatus;
    createdAt: string;
  };
}

// Metrics types
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

export interface MetricsSummaryResponse {
  success: boolean;
  data: MetricsSummary;
}

export interface CostTrendItem {
  date: string;
  cost: number;
  tokens: number;
}

export interface CostTrendResponse {
  success: boolean;
  data: {
    trend: CostTrendItem[];
  };
}

export interface RoutingDistribution {
  by_intent: Array<{ intent: string; count: number; percentage: number }>;
  by_model: Array<{ model: string; count: number; percentage: number }>;
}

export interface RoutingDistributionResponse {
  success: boolean;
  data: RoutingDistribution;
}

export type ProviderRole = 'primary' | 'fallback' | 'available' | 'not_configured';

export interface ProviderHealth {
  provider: string;
  isAvailable: boolean;
  isConfigured: boolean;
  role: ProviderRole;
  model: string | null;
  lastCheckAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  errorCount: number;
  avgLatencyMs: number | null;
  successRate: number | null;
}

export interface ProviderHealthResponse {
  success: boolean;
  data: {
    providers: ProviderHealth[];
    primaryProvider: string;
    fallbackProvider: string;
    contentRoutingEnabled: boolean;
  };
}

export interface OrchestratorHealthResponse {
  success: boolean;
  data: {
    healthy: boolean;
    status: string;
    version?: string;
    uptime?: number;
  };
}

export interface MetricsSnapshot {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  providerStats: Record<string, unknown>;
  routingStats: Record<string, unknown>;
  costStats: Record<string, unknown>;
  safetyStats: Record<string, unknown>;
  performanceStats: Record<string, unknown>;
  createdAt: string;
}

export interface MetricsLatestResponse {
  success: boolean;
  data: MetricsSnapshot | null;
}

// ============================================================================
// Test Runs API
// ============================================================================

/**
 * Trigger a new test run
 */
export function triggerTestRun(runType: TestRunType): Promise<TriggerTestRunResponse> {
  return post<TriggerTestRunResponse>('/admin/orchestration/tests/runs', { runType });
}

/**
 * List test runs
 */
export function listTestRuns(options?: {
  status?: TestRunStatus;
  runType?: TestRunType;
  limit?: number;
  offset?: number;
}): Promise<TestRunListResponse> {
  return get<TestRunListResponse>('/admin/orchestration/tests/runs', options);
}

/**
 * Get test run details
 */
export function getTestRun(
  runId: string,
  includeResults = false
): Promise<TestRunDetailResponse> {
  return get<TestRunDetailResponse>(
    `/admin/orchestration/tests/runs/${runId}`,
    { includeResults: includeResults.toString() }
  );
}

/**
 * Get test results for a run
 */
export function getTestResults(
  runId: string,
  options?: {
    status?: TestResultStatus;
    category?: string;
    limit?: number;
    offset?: number;
  }
): Promise<TestResultListResponse> {
  return get<TestResultListResponse>(
    `/admin/orchestration/tests/runs/${runId}/results`,
    options
  );
}

/**
 * Get test run statistics
 */
export function getTestRunStats(days = 30): Promise<TestRunStatsResponse> {
  return get<TestRunStatsResponse>('/admin/orchestration/tests/stats', { days });
}

// ============================================================================
// Metrics API
// ============================================================================

/**
 * Get metrics summary
 */
export function getMetricsSummary(options?: {
  period?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  days?: number;
}): Promise<MetricsSummaryResponse> {
  return get<MetricsSummaryResponse>('/admin/orchestration/metrics/summary', options);
}

/**
 * Get cost trend data
 */
export function getCostTrend(options?: {
  period?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  limit?: number;
}): Promise<CostTrendResponse> {
  return get<CostTrendResponse>('/admin/orchestration/metrics/cost-trend', options);
}

/**
 * Get routing distribution
 */
export function getRoutingDistribution(days = 30): Promise<RoutingDistributionResponse> {
  return get<RoutingDistributionResponse>('/admin/orchestration/metrics/routing', { days });
}

/**
 * Get latest metrics snapshot
 */
export function getLatestMetrics(
  period: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<MetricsLatestResponse> {
  return get<MetricsLatestResponse>('/admin/orchestration/metrics/latest', { period });
}

// ============================================================================
// Provider Health API
// ============================================================================

/**
 * Get provider health statuses
 */
export function getProviderHealth(): Promise<ProviderHealthResponse> {
  return get<ProviderHealthResponse>('/admin/orchestration/providers');
}

/**
 * Refresh provider health (polls orchestrator)
 */
export function refreshProviderHealth(): Promise<ProviderHealthResponse> {
  return post<ProviderHealthResponse>('/admin/orchestration/providers/refresh');
}

/**
 * Check orchestrator health
 */
export function checkOrchestratorHealth(): Promise<OrchestratorHealthResponse> {
  return get<OrchestratorHealthResponse>('/admin/orchestration/health');
}
