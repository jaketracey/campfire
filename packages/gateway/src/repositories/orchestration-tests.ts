/**
 * Orchestration Tests Repository
 * Data access for orchestration test runs, results, and provider health
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type { JSONObject, UUID, Timestamp } from '../db/types.js';
import type { TransactionContext, PaginatedResult } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export type TestRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TestRunType = 'routing' | 'memory' | 'integration' | 'performance' | 'all';
export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface OrchestrationTestRun {
  id: UUID;
  run_type: TestRunType;
  status: TestRunStatus;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number | null;
  summary: JSONObject | null;
  error_message: string | null;
  triggered_by: UUID | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  created_at: Timestamp;
}

export interface OrchestrationTestRunInsert {
  run_type: TestRunType;
  triggered_by?: UUID | null;
}

export interface OrchestrationTestRunUpdate {
  status?: TestRunStatus;
  total_tests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration_ms?: number;
  summary?: JSONObject;
  error_message?: string;
  started_at?: Timestamp;
  completed_at?: Timestamp;
}

export interface OrchestrationTestResult {
  id: UUID;
  test_run_id: UUID;
  test_name: string;
  test_category: string;
  status: TestResultStatus;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  metrics: JSONObject | null;
  created_at: Timestamp;
}

export interface OrchestrationTestResultInsert {
  test_run_id: UUID;
  test_name: string;
  test_category: string;
  status: TestResultStatus;
  duration_ms?: number;
  error_message?: string;
  error_stack?: string;
  metrics?: JSONObject;
}

export interface ProviderHealth {
  provider: string;
  is_available: boolean;
  last_check_at: Timestamp;
  last_success_at: Timestamp | null;
  last_error_at: Timestamp | null;
  last_error_message: string | null;
  error_count: number;
  avg_latency_ms: number | null;
  success_rate: number | null;
  updated_at: Timestamp;
}

export interface TestRunListFilters {
  status?: TestRunStatus;
  run_type?: TestRunType;
  triggered_by?: UUID;
  limit?: number;
  offset?: number;
}

export interface TestResultListFilters {
  test_run_id: UUID;
  status?: TestResultStatus;
  test_category?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Repository
// ============================================================================

export class OrchestrationTestsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Test Runs
  // ===========================================================================

  /**
   * Create a new test run
   */
  async createRun(
    input: OrchestrationTestRunInsert,
    tx?: TransactionContext
  ): Promise<OrchestrationTestRun> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO orchestration_test_runs (run_type, triggered_by)
        VALUES (${input.run_type}, ${input.triggered_by ?? null})
        RETURNING *
      `;

      const run = this.mapTestRun(result[0]!);
      logger.debug({ runId: run.id, runType: run.run_type }, 'Test run created');
      return run;
    } catch (error) {
      throw wrapDatabaseError(error, 'orchestrationTests.createRun');
    }
  }

  /**
   * Get a test run by ID
   */
  async getRunById(id: UUID, tx?: TransactionContext): Promise<OrchestrationTestRun | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM orchestration_test_runs WHERE id = ${id}
    `;

    return result[0] ? this.mapTestRun(result[0]) : null;
  }

  /**
   * Update a test run
   */
  async updateRun(
    id: UUID,
    update: OrchestrationTestRunUpdate,
    tx?: TransactionContext
  ): Promise<OrchestrationTestRun> {
    const db = this.getSql(tx);

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (update.status !== undefined) {
      setClauses.push('status');
      values.push(update.status);
    }
    if (update.total_tests !== undefined) {
      setClauses.push('total_tests');
      values.push(update.total_tests);
    }
    if (update.passed !== undefined) {
      setClauses.push('passed');
      values.push(update.passed);
    }
    if (update.failed !== undefined) {
      setClauses.push('failed');
      values.push(update.failed);
    }
    if (update.skipped !== undefined) {
      setClauses.push('skipped');
      values.push(update.skipped);
    }
    if (update.duration_ms !== undefined) {
      setClauses.push('duration_ms');
      values.push(update.duration_ms);
    }
    if (update.summary !== undefined) {
      setClauses.push('summary');
      values.push(update.summary);
    }
    if (update.error_message !== undefined) {
      setClauses.push('error_message');
      values.push(update.error_message);
    }
    if (update.started_at !== undefined) {
      setClauses.push('started_at');
      values.push(update.started_at);
    }
    if (update.completed_at !== undefined) {
      setClauses.push('completed_at');
      values.push(update.completed_at);
    }

    const result = await db`
      UPDATE orchestration_test_runs
      SET
        status = COALESCE(${update.status ?? null}, status),
        total_tests = COALESCE(${update.total_tests ?? null}, total_tests),
        passed = COALESCE(${update.passed ?? null}, passed),
        failed = COALESCE(${update.failed ?? null}, failed),
        skipped = COALESCE(${update.skipped ?? null}, skipped),
        duration_ms = COALESCE(${update.duration_ms ?? null}, duration_ms),
        summary = COALESCE(${update.summary ? db.json(update.summary as postgres.JSONValue) : null}, summary),
        error_message = COALESCE(${update.error_message ?? null}, error_message),
        started_at = COALESCE(${update.started_at ?? null}, started_at),
        completed_at = COALESCE(${update.completed_at ?? null}, completed_at)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('OrchestrationTestRun', id);
    }

    return this.mapTestRun(result[0]);
  }

  /**
   * List test runs with filters
   */
  async listRuns(
    filters: TestRunListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<OrchestrationTestRun>> {
    const db = this.getSql(tx);
    const { status, run_type, triggered_by, limit = 20, offset = 0 } = filters;

    const result = await db`
      SELECT * FROM orchestration_test_runs
      WHERE
        (${status ?? null}::varchar IS NULL OR status = ${status ?? null})
        AND (${run_type ?? null}::varchar IS NULL OR run_type = ${run_type ?? null})
        AND (${triggered_by ?? null}::uuid IS NULL OR triggered_by = ${triggered_by ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapTestRun(row));

    return { data, hasMore };
  }

  /**
   * Get latest run by type
   */
  async getLatestRunByType(
    runType: TestRunType,
    tx?: TransactionContext
  ): Promise<OrchestrationTestRun | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM orchestration_test_runs
      WHERE run_type = ${runType} AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `;

    return result[0] ? this.mapTestRun(result[0]) : null;
  }

  /**
   * Get run statistics
   */
  async getRunStats(
    days: number = 30,
    tx?: TransactionContext
  ): Promise<{
    total_runs: number;
    passed_runs: number;
    failed_runs: number;
    avg_duration_ms: number;
    by_type: Record<string, { total: number; passed: number; failed: number }>;
  }> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        COUNT(*)::int AS total_runs,
        COUNT(*) FILTER (WHERE failed = 0 AND status = 'completed')::int AS passed_runs,
        COUNT(*) FILTER (WHERE failed > 0 OR status = 'failed')::int AS failed_runs,
        COALESCE(AVG(duration_ms)::int, 0) AS avg_duration_ms
      FROM orchestration_test_runs
      WHERE created_at > NOW() - INTERVAL '${db.unsafe(String(days))} days'
    `;

    const byTypeResult = await db`
      SELECT
        run_type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE failed = 0 AND status = 'completed')::int AS passed,
        COUNT(*) FILTER (WHERE failed > 0 OR status = 'failed')::int AS failed
      FROM orchestration_test_runs
      WHERE created_at > NOW() - INTERVAL '${db.unsafe(String(days))} days'
      GROUP BY run_type
    `;

    const by_type: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const row of byTypeResult) {
      by_type[row.run_type as string] = {
        total: row.total as number,
        passed: row.passed as number,
        failed: row.failed as number,
      };
    }

    return {
      total_runs: result[0]?.total_runs ?? 0,
      passed_runs: result[0]?.passed_runs ?? 0,
      failed_runs: result[0]?.failed_runs ?? 0,
      avg_duration_ms: result[0]?.avg_duration_ms ?? 0,
      by_type,
    };
  }

  // ===========================================================================
  // Test Results
  // ===========================================================================

  /**
   * Create a test result
   */
  async createResult(
    input: OrchestrationTestResultInsert,
    tx?: TransactionContext
  ): Promise<OrchestrationTestResult> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO orchestration_test_results (
          test_run_id, test_name, test_category, status,
          duration_ms, error_message, error_stack, metrics
        )
        VALUES (
          ${input.test_run_id},
          ${input.test_name},
          ${input.test_category},
          ${input.status},
          ${input.duration_ms ?? null},
          ${input.error_message ?? null},
          ${input.error_stack ?? null},
          ${input.metrics ? db.json(input.metrics as postgres.JSONValue) : null}
        )
        RETURNING *
      `;

      return this.mapTestResult(result[0]!);
    } catch (error) {
      throw wrapDatabaseError(error, 'orchestrationTests.createResult');
    }
  }

  /**
   * Bulk create test results
   */
  async createResultsBatch(
    results: OrchestrationTestResultInsert[],
    tx?: TransactionContext
  ): Promise<number> {
    if (results.length === 0) return 0;

    const db = this.getSql(tx);

    // Insert results one by one to handle JSONB properly
    let count = 0;
    for (const r of results) {
      await db`
        INSERT INTO orchestration_test_results (
          test_run_id, test_name, test_category, status,
          duration_ms, error_message, error_stack, metrics
        )
        VALUES (
          ${r.test_run_id},
          ${r.test_name},
          ${r.test_category},
          ${r.status},
          ${r.duration_ms ?? null},
          ${r.error_message ?? null},
          ${r.error_stack ?? null},
          ${r.metrics ? db.json(r.metrics as postgres.JSONValue) : null}
        )
      `;
      count++;
    }

    return count;
  }

  /**
   * List results for a test run
   */
  async listResults(
    filters: TestResultListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<OrchestrationTestResult>> {
    const db = this.getSql(tx);
    const { test_run_id, status, test_category, limit = 50, offset = 0 } = filters;

    const result = await db`
      SELECT * FROM orchestration_test_results
      WHERE
        test_run_id = ${test_run_id}
        AND (${status ?? null}::varchar IS NULL OR status = ${status ?? null})
        AND (${test_category ?? null}::varchar IS NULL OR test_category = ${test_category ?? null})
      ORDER BY created_at ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapTestResult(row));

    return { data, hasMore };
  }

  /**
   * Get result summary by category
   */
  async getResultSummaryByCategory(
    testRunId: UUID,
    tx?: TransactionContext
  ): Promise<Array<{ category: string; passed: number; failed: number; skipped: number }>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        test_category AS category,
        COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
      FROM orchestration_test_results
      WHERE test_run_id = ${testRunId}
      GROUP BY test_category
      ORDER BY test_category
    `;

    return result.map(row => ({
      category: row.category as string,
      passed: row.passed as number,
      failed: row.failed as number,
      skipped: row.skipped as number,
    }));
  }

  // ===========================================================================
  // Provider Health
  // ===========================================================================

  /**
   * Get all provider health statuses
   */
  async getProviderHealth(tx?: TransactionContext): Promise<ProviderHealth[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM orchestration_provider_health
      ORDER BY provider
    `;

    return result.map(row => this.mapProviderHealth(row));
  }

  /**
   * Update provider health status
   */
  async updateProviderHealth(
    provider: string,
    update: Partial<Omit<ProviderHealth, 'provider' | 'updated_at'>>,
    tx?: TransactionContext
  ): Promise<ProviderHealth> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO orchestration_provider_health (
        provider, is_available, last_check_at, last_success_at,
        last_error_at, last_error_message, error_count, avg_latency_ms, success_rate
      )
      VALUES (
        ${provider},
        ${update.is_available ?? true},
        NOW(),
        ${update.last_success_at ?? null},
        ${update.last_error_at ?? null},
        ${update.last_error_message ?? null},
        ${update.error_count ?? 0},
        ${update.avg_latency_ms ?? null},
        ${update.success_rate ?? null}
      )
      ON CONFLICT (provider) DO UPDATE SET
        is_available = COALESCE(${update.is_available ?? null}, orchestration_provider_health.is_available),
        last_check_at = NOW(),
        last_success_at = COALESCE(${update.last_success_at ?? null}, orchestration_provider_health.last_success_at),
        last_error_at = COALESCE(${update.last_error_at ?? null}, orchestration_provider_health.last_error_at),
        last_error_message = COALESCE(${update.last_error_message ?? null}, orchestration_provider_health.last_error_message),
        error_count = COALESCE(${update.error_count ?? null}, orchestration_provider_health.error_count),
        avg_latency_ms = COALESCE(${update.avg_latency_ms ?? null}, orchestration_provider_health.avg_latency_ms),
        success_rate = COALESCE(${update.success_rate ?? null}, orchestration_provider_health.success_rate)
      RETURNING *
    `;

    return this.mapProviderHealth(result[0]!);
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapTestRun(row: Record<string, unknown>): OrchestrationTestRun {
    return {
      id: row['id'] as UUID,
      run_type: row['run_type'] as TestRunType,
      status: row['status'] as TestRunStatus,
      total_tests: row['total_tests'] as number,
      passed: row['passed'] as number,
      failed: row['failed'] as number,
      skipped: row['skipped'] as number,
      duration_ms: row['duration_ms'] as number | null,
      summary: row['summary'] as JSONObject | null,
      error_message: row['error_message'] as string | null,
      triggered_by: row['triggered_by'] as UUID | null,
      started_at: row['started_at'] as Date | null,
      completed_at: row['completed_at'] as Date | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapTestResult(row: Record<string, unknown>): OrchestrationTestResult {
    return {
      id: row['id'] as UUID,
      test_run_id: row['test_run_id'] as UUID,
      test_name: row['test_name'] as string,
      test_category: row['test_category'] as string,
      status: row['status'] as TestResultStatus,
      duration_ms: row['duration_ms'] as number | null,
      error_message: row['error_message'] as string | null,
      error_stack: row['error_stack'] as string | null,
      metrics: row['metrics'] as JSONObject | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapProviderHealth(row: Record<string, unknown>): ProviderHealth {
    return {
      provider: row['provider'] as string,
      is_available: row['is_available'] as boolean,
      last_check_at: row['last_check_at'] as Date,
      last_success_at: row['last_success_at'] as Date | null,
      last_error_at: row['last_error_at'] as Date | null,
      last_error_message: row['last_error_message'] as string | null,
      error_count: row['error_count'] as number,
      avg_latency_ms: row['avg_latency_ms'] as number | null,
      success_rate: row['success_rate'] as number | null,
      updated_at: row['updated_at'] as Date,
    };
  }
}

// Singleton instance
let orchestrationTestsRepositoryInstance: OrchestrationTestsRepository | null = null;

export function getOrchestrationTestsRepository(): OrchestrationTestsRepository {
  if (!orchestrationTestsRepositoryInstance) {
    orchestrationTestsRepositoryInstance = new OrchestrationTestsRepository();
  }
  return orchestrationTestsRepositoryInstance;
}
