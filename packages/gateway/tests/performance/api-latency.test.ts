/**
 * API Endpoint Latency Tests
 * 
 * Measures latency for critical API endpoints with p50, p95, p99 percentiles
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import {
  runBenchmark,
  calculateMetrics,
  assertPerformance,
  formatDuration,
  type PerformanceMetrics,
} from './setup';

// Performance thresholds in milliseconds
const THRESHOLDS = {
  health: { p50: 10, p95: 20, p99: 50 },
  auth: { p50: 100, p95: 200, p99: 300 },
  userProfile: { p50: 50, p95: 100, p99: 150 },
  companionList: { p50: 100, p95: 200, p99: 300 },
  sessionCreate: { p50: 150, p95: 300, p99: 500 },
} as const;

const BENCHMARK_ITERATIONS = 100;

describe('API Latency Benchmarks', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Build test app instance
    app = await buildApp({ logger: false });
    await app.ready();

    // Create test user and get auth token
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `perf-test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Performance Test User',
      },
    });

    const authData = JSON.parse(authResponse.payload);
    authToken = authData.token;
    testUserId = authData.user.id;
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
        expect(response.statusCode).toBe(200);
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
        expect(response.statusCode).toBe(200);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Ready Endpoint', metrics);
    assertPerformance(metrics, { p50: 20, p95: 50, p99: 100 });
  });

  it('should measure authentication endpoint latency', async () => {
    const testEmail = `auth-perf-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    // First create the user
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: testEmail,
        password: testPassword,
        displayName: 'Auth Test User',
      },
    });

    // Measure login performance
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: {
            email: testEmail,
            password: testPassword,
          },
        });
        expect(response.statusCode).toBe(200);
        return response;
      },
      50 // Fewer iterations due to bcrypt overhead
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Authentication (Login)', metrics);
    assertPerformance(metrics, THRESHOLDS.auth);
  });

  it('should measure user profile endpoint latency', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/users/me',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });
        expect(response.statusCode).toBe(200);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('User Profile (GET /api/users/me)', metrics);
    assertPerformance(metrics, THRESHOLDS.userProfile);
  });

  it('should measure companion list endpoint latency', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/companions',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });
        expect([200, 404]).toContain(response.statusCode);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Companion List (GET /api/companions)', metrics);
    assertPerformance(metrics, THRESHOLDS.companionList);
  });

  it('should measure session creation endpoint latency', async () => {
    // First create a companion
    const companionResponse = await app.inject({
      method: 'POST',
      url: '/api/companions',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        name: 'Test Companion',
        personality: 'friendly',
      },
    });

    const companion = JSON.parse(companionResponse.payload);

    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            companionId: companion.id,
          },
        });
        expect(response.statusCode).toBe(201);
        return response;
      },
      50 // Fewer iterations for expensive operation
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Session Creation (POST /api/sessions)', metrics);
    assertPerformance(metrics, THRESHOLDS.sessionCreate);
  });

  it('should measure complex query endpoint latency', async () => {
    const { durations } = await runBenchmark(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/sessions?limit=20&sort=createdAt:desc',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });
        expect(response.statusCode).toBe(200);
        return response;
      },
      BENCHMARK_ITERATIONS
    );

    const metrics = calculateMetrics(durations);
    logMetrics('Session List with Pagination', metrics);
    assertPerformance(metrics, { p50: 100, p95: 200, p99: 350 });
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
