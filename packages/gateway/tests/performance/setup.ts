/**
 * Performance Test Setup
 * 
 * Shared utilities and helpers for performance testing
 */

import type { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';

export interface PerformanceMetrics {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  count: number;
}

export interface LoadTestMetrics extends PerformanceMetrics {
  throughput: number; // requests per second
  errorRate: number; // percentage
  successCount: number;
  errorCount: number;
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Calculate performance metrics from array of durations (in ms)
 */
export function calculateMetrics(durations: number[]): PerformanceMetrics {
  if (durations.length === 0) {
    throw new Error('Cannot calculate metrics from empty array');
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((acc, val) => acc + val, 0);

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / durations.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: durations.length,
  };
}

/**
 * Calculate load test metrics
 */
export function calculateLoadMetrics(
  durations: number[],
  errors: number,
  totalDurationMs: number
): LoadTestMetrics {
  const baseMetrics = calculateMetrics(durations);
  const totalRequests = durations.length + errors;
  const throughput = (totalRequests / totalDurationMs) * 1000; // requests per second
  const errorRate = (errors / totalRequests) * 100;

  return {
    ...baseMetrics,
    throughput,
    errorRate,
    successCount: durations.length,
    errorCount: errors,
  };
}

/**
 * Measure async function execution time
 */
export async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Run a function multiple times and collect durations
 */
export async function runBenchmark<T>(
  fn: () => Promise<T>,
  iterations: number
): Promise<{ results: T[]; durations: number[] }> {
  const results: T[] = [];
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { result, duration } = await measure(fn);
    results.push(result);
    durations.push(duration);
  }

  return { results, durations };
}

/**
 * Run concurrent requests and measure performance
 */
export async function runConcurrent<T>(
  fn: () => Promise<T>,
  concurrency: number,
  totalRequests: number
): Promise<{ results: (T | Error)[]; durations: number[]; errors: number }> {
  const results: (T | Error)[] = [];
  const durations: number[] = [];
  let errors = 0;

  const batches = Math.ceil(totalRequests / concurrency);

  for (let batch = 0; batch < batches; batch++) {
    const batchSize = Math.min(concurrency, totalRequests - batch * concurrency);
    const promises = Array.from({ length: batchSize }, async () => {
      const start = performance.now();
      try {
        const result = await fn();
        const duration = performance.now() - start;
        durations.push(duration);
        return result;
      } catch (error) {
        errors++;
        return error instanceof Error ? error : new Error(String(error));
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return { results, durations, errors };
}

/**
 * Memory usage snapshot
 */
export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

/**
 * Take a memory snapshot
 */
export function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
    timestamp: Date.now(),
  };
}

/**
 * Calculate memory growth between snapshots
 */
export function calculateMemoryGrowth(
  initial: MemorySnapshot,
  final: MemorySnapshot
): {
  heapUsedGrowth: number;
  heapTotalGrowth: number;
  externalGrowth: number;
  rssGrowth: number;
  durationMs: number;
} {
  return {
    heapUsedGrowth: final.heapUsed - initial.heapUsed,
    heapTotalGrowth: final.heapTotal - initial.heapTotal,
    externalGrowth: final.external - initial.external,
    rssGrowth: final.rss - initial.rss,
    durationMs: final.timestamp - initial.timestamp,
  };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format duration to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Assert performance threshold
 */
export function assertPerformance(
  metrics: PerformanceMetrics,
  thresholds: {
    p50?: number;
    p95?: number;
    p99?: number;
    mean?: number;
  }
): void {
  const violations: string[] = [];

  if (thresholds.p50 !== undefined && metrics.p50 > thresholds.p50) {
    violations.push(`p50 (${formatDuration(metrics.p50)}) exceeds threshold (${formatDuration(thresholds.p50)})`);
  }
  if (thresholds.p95 !== undefined && metrics.p95 > thresholds.p95) {
    violations.push(`p95 (${formatDuration(metrics.p95)}) exceeds threshold (${formatDuration(thresholds.p95)})`);
  }
  if (thresholds.p99 !== undefined && metrics.p99 > thresholds.p99) {
    violations.push(`p99 (${formatDuration(metrics.p99)}) exceeds threshold (${formatDuration(thresholds.p99)})`);
  }
  if (thresholds.mean !== undefined && metrics.mean > thresholds.mean) {
    violations.push(`mean (${formatDuration(metrics.mean)}) exceeds threshold (${formatDuration(thresholds.mean)})`);
  }

  if (violations.length > 0) {
    throw new Error(`Performance threshold violations:\n${violations.join('\n')}`);
  }
}

/**
 * Wait for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a valid test JWT token for authenticated requests.
 * Uses the same jose SignJWT flow as the real auth middleware,
 * signing with the JWT_SECRET set in tests/setup.ts.
 */
export async function createTestToken(
  userId: string = 'test-user-123',
  email: string = 'test@example.com',
  role: 'user' | 'admin' = 'user',
): Promise<string> {
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode(
    process.env['JWT_SECRET'] || 'test-jwt-secret-for-testing-only-min-32-chars',
  );
  const issuer = process.env['JWT_ISSUER'] || 'campfire-test';
  const audience = process.env['JWT_AUDIENCE'] || 'campfire-api-test';

  return new SignJWT({ userId, email, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('1h')
    .sign(secret);
}
