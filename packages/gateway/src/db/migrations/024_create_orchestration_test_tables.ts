/**
 * Migration: Create Orchestration Test Tables
 * Created: 2026-01-02
 *
 * Tables for tracking orchestration test runs, results, and metrics:
 * - orchestration_test_runs: Test run metadata and summary
 * - orchestration_test_results: Individual test case results
 * - orchestration_metrics_snapshots: Periodic metrics aggregations
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Orchestration Test Runs Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS orchestration_test_runs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      run_type VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      summary JSONB,
      error_message TEXT,
      triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT orchestration_test_runs_status_check
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      CONSTRAINT orchestration_test_runs_type_check
        CHECK (run_type IN ('routing', 'memory', 'integration', 'performance', 'all'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_test_runs_status
    ON orchestration_test_runs (status, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_test_runs_type
    ON orchestration_test_runs (run_type, created_at DESC)
  `;

  await sql`
    COMMENT ON TABLE orchestration_test_runs IS 'Tracks orchestration test run metadata and aggregated results'
  `;

  // =========================================================================
  // Orchestration Test Results Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS orchestration_test_results (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      test_run_id UUID NOT NULL REFERENCES orchestration_test_runs(id) ON DELETE CASCADE,
      test_name VARCHAR(255) NOT NULL,
      test_category VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL,
      duration_ms INTEGER,
      error_message TEXT,
      error_stack TEXT,
      metrics JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT orchestration_test_results_status_check
        CHECK (status IN ('passed', 'failed', 'skipped', 'error'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_test_results_run
    ON orchestration_test_results (test_run_id, status)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_test_results_category
    ON orchestration_test_results (test_category, status)
  `;

  await sql`
    COMMENT ON TABLE orchestration_test_results IS 'Individual test case results within a test run'
  `;

  // =========================================================================
  // Orchestration Metrics Snapshots Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS orchestration_metrics_snapshots (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      period VARCHAR(20) NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      provider_stats JSONB NOT NULL DEFAULT '{}',
      routing_stats JSONB NOT NULL DEFAULT '{}',
      cost_stats JSONB NOT NULL DEFAULT '{}',
      safety_stats JSONB NOT NULL DEFAULT '{}',
      performance_stats JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT orchestration_metrics_snapshots_period_check
        CHECK (period IN ('hourly', 'daily', 'weekly', 'monthly'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_metrics_period
    ON orchestration_metrics_snapshots (period, period_start DESC)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestration_metrics_unique
    ON orchestration_metrics_snapshots (period, period_start)
  `;

  await sql`
    COMMENT ON TABLE orchestration_metrics_snapshots IS 'Periodic aggregations of orchestration metrics for reporting'
  `;

  // =========================================================================
  // Provider Health Status Table (for real-time monitoring)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS orchestration_provider_health (
      provider VARCHAR(50) PRIMARY KEY,
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      last_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_success_at TIMESTAMPTZ,
      last_error_at TIMESTAMPTZ,
      last_error_message TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms INTEGER,
      success_rate NUMERIC(5,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TRIGGER orchestration_provider_health_updated_at
    BEFORE UPDATE ON orchestration_provider_health
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE orchestration_provider_health IS 'Real-time health status for AI providers'
  `;

  // =========================================================================
  // Initialize default provider health records
  // =========================================================================
  await sql`
    INSERT INTO orchestration_provider_health (provider, is_available)
    VALUES
      ('anthropic', TRUE),
      ('openai', TRUE),
      ('ollama', TRUE),
      ('together', TRUE),
      ('groq', TRUE)
    ON CONFLICT (provider) DO NOTHING
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Drop provider health table
  await sql`DROP TRIGGER IF EXISTS orchestration_provider_health_updated_at ON orchestration_provider_health`;
  await sql`DROP TABLE IF EXISTS orchestration_provider_health CASCADE`;

  // Drop metrics snapshots table
  await sql`DROP INDEX IF EXISTS idx_orchestration_metrics_unique`;
  await sql`DROP INDEX IF EXISTS idx_orchestration_metrics_period`;
  await sql`DROP TABLE IF EXISTS orchestration_metrics_snapshots CASCADE`;

  // Drop test results table
  await sql`DROP INDEX IF EXISTS idx_orchestration_test_results_category`;
  await sql`DROP INDEX IF EXISTS idx_orchestration_test_results_run`;
  await sql`DROP TABLE IF EXISTS orchestration_test_results CASCADE`;

  // Drop test runs table
  await sql`DROP INDEX IF EXISTS idx_orchestration_test_runs_type`;
  await sql`DROP INDEX IF EXISTS idx_orchestration_test_runs_status`;
  await sql`DROP TABLE IF EXISTS orchestration_test_runs CASCADE`;
}
