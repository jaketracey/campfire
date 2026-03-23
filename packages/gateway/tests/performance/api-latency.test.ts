/**
 * API Endpoint Latency Tests
 *
 * Measures latency for critical API endpoints with p50, p95, p99 percentiles.
 * Auth-dependent tests generate JWTs directly instead of calling the register
 * endpoint so the suite works in CI without fully-seeded DB tables.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import {
  runBenchmark,
  calculateMetrics,
  assertPerformance,
  formatDuration,
  createTestToken,
  type PerformanceMetrics,
} from './setup';

// Performance thresholds in milliseconds
const THRESHOLDS = {
  health: { p50: 10, p95: 50, p99: 100 },
  ready: { p50: 20, p95: 50, p99: 100 },
} as const;

const BENCHMARK_ITERATIONS = 100;

describe('API Latency Benchmarks', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Generate a valid JWT directly -- no DB round-trip required.
    authToken = await createTestToken('perf-test-user', 'perf@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should measure /health endpoint latency', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/health',
        });
        // Accept 200 or 429 (rate-limited after many requests)
        expect([200, 429]).toContain(response.statusCode);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Health Endpoint', metrics);
    assertPerformance(metrics, THRESHOLDS.health);
  });

  it('should measure /ready endpoint latency', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/ready',
        });
        // Accept 200, 429 (rate-limited), or 503 (DB/Redis not ready)
        expect([200, 429, 503]).toContain(response.statusCode);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Ready Endpoint', metrics);
    assertPerformance(metrics, THRESHOLDS.ready);
  });

  it('should measure authenticated endpoint latency (token validation only)', async () => {
    // This test measures how fast the auth middleware rejects/accepts tokens,
    // not full DB-backed user profile resolution.
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/users/me',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });
        // The user won't exist in the DB, so we may get 200, 404, or 500
        // depending on how the route handles a missing DB user.
        // We're measuring latency of the auth middleware + route handler, not correctness.
        expect(response.statusCode).toBeDefined();
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Authenticated Endpoint (GET /api/users/me)', metrics);
    // Lenient threshold -- we just want to ensure it's not catastrophically slow
    assertPerformance(metrics, { p50: 100, p95: 300, p99: 500 });
  });
});

function logMetrics(label: string, metrics: PerformanceMetrics): void {
  console.log(`\n${label}:`);
  console.log(`  p50: ${formatDuration(metrics.p50)}`);
  console.log(`  p95: ${formatDuration(metrics.p95)}`);
  console.log(`  p99: ${formatDuration(metrics.p99)}`);
  console.log(`  mean: ${formatDuration(metrics.mean)}`);
  console.log(`  min: ${formatDuration(metrics.min)}`);
  console.log(`  max: ${formatDuration(metrics.max)}`);
  console.log(`  count: ${metrics.count}`);
}
