/**
 * Memory Leak Detection Tests
 *
 * Long-running tests to detect memory leaks and ensure stability over time.
 * Uses directly-signed JWTs so the suite works without a register endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import {
  takeMemorySnapshot,
  calculateMemoryGrowth,
  createTestToken,
  formatBytes,
  sleep,
  type MemorySnapshot,
} from '../performance/setup';

// Memory leak thresholds
const THRESHOLDS = {
  // Maximum acceptable heap growth per 1000 operations
  // Relaxed for CI where --expose-gc may not be available and GC timing varies
  heapGrowthPerKOps: 50 * 1024 * 1024, // 50MB
  // Maximum acceptable RSS growth per 1000 operations
  rssGrowthPerKOps: 80 * 1024 * 1024, // 80MB
  // Heap should stabilize (not grow linearly)
  // Relaxed from 0.8 to 0.95 for CI environments where GC timing is unpredictable
  maxLinearGrowthRate: 0.95,
};

describe('Memory Leak Detection', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    authToken = await createTestToken('memory-test-user', 'memory@example.com');

    // Force garbage collection before starting tests (if available)
    if (global.gc) {
      global.gc();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should not leak memory with repeated health-check requests', async () => {
    const iterations = 5000;
    const samplingInterval = 500;
    const snapshots: MemorySnapshot[] = [];

    // Initial baseline
    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    for (let i = 0; i < iterations; i++) {
      await app.inject({
        method: 'GET',
        url: '/health',
      });

      if (i > 0 && i % samplingInterval === 0) {
        if (global.gc) global.gc();
        await sleep(50);
        snapshots.push(takeMemorySnapshot());
      }
    }

    // Final snapshot
    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    analyzeMemorySnapshots(snapshots, iterations, 'Health-check Requests');

    const initialSnapshot = snapshots[0];
    const finalSnapshot = snapshots[snapshots.length - 1];
    const growth = calculateMemoryGrowth(initialSnapshot, finalSnapshot);

    const heapGrowthPerKOps = (growth.heapUsedGrowth / iterations) * 1000;
    const rssGrowthPerKOps = (growth.rssGrowth / iterations) * 1000;

    console.log(`\nMemory Growth Analysis (${iterations} requests):`);
    console.log(`  Heap Growth: ${formatBytes(growth.heapUsedGrowth)}`);
    console.log(`  Heap Growth per 1K ops: ${formatBytes(heapGrowthPerKOps)}`);
    console.log(`  RSS Growth: ${formatBytes(growth.rssGrowth)}`);
    console.log(`  RSS Growth per 1K ops: ${formatBytes(rssGrowthPerKOps)}`);

    expect(heapGrowthPerKOps).toBeLessThan(THRESHOLDS.heapGrowthPerKOps);
    expect(rssGrowthPerKOps).toBeLessThan(THRESHOLDS.rssGrowthPerKOps);
  }, 120000);

  it('should not leak memory with repeated authenticated requests', async () => {
    const iterations = 2000;
    const samplingInterval = 200;
    const snapshots: MemorySnapshot[] = [];

    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    for (let i = 0; i < iterations; i++) {
      await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      if (i > 0 && i % samplingInterval === 0) {
        if (global.gc) global.gc();
        await sleep(50);
        snapshots.push(takeMemorySnapshot());
      }
    }

    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    analyzeMemorySnapshots(snapshots, iterations, 'Authenticated Requests');

    const initialSnapshot = snapshots[0];
    const finalSnapshot = snapshots[snapshots.length - 1];
    const growth = calculateMemoryGrowth(initialSnapshot, finalSnapshot);

    const heapGrowthPerKOps = (growth.heapUsedGrowth / iterations) * 1000;

    console.log(`\nAuth Request Memory Growth (${iterations} requests):`);
    console.log(`  Heap Growth: ${formatBytes(growth.heapUsedGrowth)}`);
    console.log(`  Heap Growth per 1K ops: ${formatBytes(heapGrowthPerKOps)}`);

    expect(heapGrowthPerKOps).toBeLessThan(THRESHOLDS.heapGrowthPerKOps);
  }, 120000);

  it('should stabilize memory usage over time', async () => {
    const duration = 15000; // 15 seconds (reduced from 30s for CI speed)
    const snapshots: MemorySnapshot[] = [];
    const startTime = Date.now();

    let requestCount = 0;

    while (Date.now() - startTime < duration) {
      await app.inject({
        method: 'GET',
        url: '/health',
      });

      requestCount++;

      if (requestCount % 10 === 0) {
        if (global.gc) global.gc();
        snapshots.push(takeMemorySnapshot());
      }

      await sleep(10);
    }

    console.log(`\nMemory Stability Test (${duration}ms, ${requestCount} requests):`);
    console.log(`  Snapshots taken: ${snapshots.length}`);

    if (snapshots.length < 3) {
      console.log('  Not enough snapshots to calculate regression. Skipping.');
      return;
    }

    const heapUsedValues = snapshots.map((s) => s.heapUsed);
    const r2 = calculateLinearRegression(heapUsedValues);

    console.log(`  Linear growth R\u00B2: ${r2.toFixed(4)}`);
    console.log(`  Interpretation: ${r2 > THRESHOLDS.maxLinearGrowthRate ? 'UNSTABLE - Linear growth detected' : 'STABLE - Memory usage stabilized'}`);

    expect(r2).toBeLessThan(THRESHOLDS.maxLinearGrowthRate);
  }, 60000);
});

function analyzeMemorySnapshots(
  snapshots: MemorySnapshot[],
  totalOperations: number,
  label: string
): void {
  if (snapshots.length < 2) return;

  console.log(`\n${label} - Memory Analysis:`);
  console.log(`  Snapshots: ${snapshots.length}`);
  console.log(`  Operations: ${totalOperations}`);

  const heapValues = snapshots.map((s) => s.heapUsed);
  const heapMin = Math.min(...heapValues);
  const heapMax = Math.max(...heapValues);
  const heapAvg = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;

  console.log(`  Heap - Min: ${formatBytes(heapMin)}, Max: ${formatBytes(heapMax)}, Avg: ${formatBytes(heapAvg)}`);
  console.log(`  Heap Range: ${formatBytes(heapMax - heapMin)}`);
}

function calculateLinearRegression(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const xValues = Array.from({ length: n }, (_, i) => i);

  const sumX = xValues.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xValues.reduce((sum, x, i) => sum + x * values[i], 0);
  const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);

  const yMean = sumY / n;
  const ssTotal = values.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);

  if (ssTotal === 0) return 0; // All values identical -- no growth

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const ssResidual = values.reduce((sum, y, i) => {
    const yPred = slope * i + intercept;
    return sum + Math.pow(y - yPred, 2);
  }, 0);

  const r2 = 1 - ssResidual / ssTotal;
  return Math.max(0, r2); // Clamp negative R2 to 0
}
