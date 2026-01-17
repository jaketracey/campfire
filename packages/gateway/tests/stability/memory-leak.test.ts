/**
 * Memory Leak Detection Tests
 * 
 * Long-running tests to detect memory leaks and ensure stability over time
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index';
import {
  takeMemorySnapshot,
  calculateMemoryGrowth,
  formatBytes,
  sleep,
  type MemorySnapshot,
} from '../performance/setup';

// Memory leak thresholds
const THRESHOLDS = {
  // Maximum acceptable heap growth per 1000 operations
  heapGrowthPerKOps: 10 * 1024 * 1024, // 10MB
  // Maximum acceptable RSS growth per 1000 operations
  rssGrowthPerKOps: 20 * 1024 * 1024, // 20MB
  // Heap should stabilize (not grow linearly)
  maxLinearGrowthRate: 0.8, // R² < 0.8 means not linear
};

describe('Memory Leak Detection', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `memory-test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Memory Test User',
      },
    });

    const authData = JSON.parse(authResponse.payload);
    authToken = authData.token;

    // Force garbage collection before starting tests (if available)
    if (global.gc) {
      global.gc();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should not leak memory with repeated API requests', async () => {
    const iterations = 5000;
    const samplingInterval = 500; // Take snapshot every 500 requests
    const snapshots: MemorySnapshot[] = [];

    // Initial baseline
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

      // Take periodic snapshots
      if (i > 0 && i % samplingInterval === 0) {
        if (global.gc) global.gc();
        await sleep(50); // Allow GC to complete
        snapshots.push(takeMemorySnapshot());
      }
    }

    // Final snapshot
    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    analyzeMemorySnapshots(snapshots, iterations, 'API Requests');

    const initialSnapshot = snapshots[0];
    const finalSnapshot = snapshots[snapshots.length - 1];
    const growth = calculateMemoryGrowth(initialSnapshot, finalSnapshot);

    // Calculate growth per 1000 operations
    const heapGrowthPerKOps = (growth.heapUsedGrowth / iterations) * 1000;
    const rssGrowthPerKOps = (growth.rssGrowth / iterations) * 1000;

    console.log(`\nMemory Growth Analysis (${iterations} requests):`);
    console.log(`  Heap Growth: ${formatBytes(growth.heapUsedGrowth)}`);
    console.log(`  Heap Growth per 1K ops: ${formatBytes(heapGrowthPerKOps)}`);
    console.log(`  RSS Growth: ${formatBytes(growth.rssGrowth)}`);
    console.log(`  RSS Growth per 1K ops: ${formatBytes(rssGrowthPerKOps)}`);

    // Assert thresholds
    expect(heapGrowthPerKOps).toBeLessThan(THRESHOLDS.heapGrowthPerKOps);
    expect(rssGrowthPerKOps).toBeLessThan(THRESHOLDS.rssGrowthPerKOps);
  }, 120000); // 2 minute timeout

  it('should not leak memory with WebSocket connections', async () => {
    const WebSocket = (await import('ws')).default;
    const iterations = 100;
    const snapshots: MemorySnapshot[] = [];

    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    // Start server if not already listening
    const address = app.server.address();
    if (!address) {
      await app.listen({ port: 0 });
    }

    const port = typeof address === 'string' ? 3000 : (address?.port || 3000);
    const wsUrl = `ws://localhost:${port}/ws`;

    for (let i = 0; i < iterations; i++) {
      const ws = new WebSocket(wsUrl, {
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Send a message
          ws.send(JSON.stringify({ type: 'ping', id: i }));
        });

        ws.on('message', () => {
          // Close after receiving response
          ws.close();
        });

        ws.on('close', () => {
          resolve();
        });

        ws.on('error', (err) => {
          ws.close();
          resolve(); // Don't fail test on individual connection errors
        });

        setTimeout(() => {
          ws.close();
          resolve();
        }, 5000);
      });

      // Take periodic snapshots
      if (i > 0 && i % 20 === 0) {
        if (global.gc) global.gc();
        await sleep(100);
        snapshots.push(takeMemorySnapshot());
      }
    }

    if (global.gc) global.gc();
    await sleep(100);
    snapshots.push(takeMemorySnapshot());

    analyzeMemorySnapshots(snapshots, iterations, 'WebSocket Connections');

    const initialSnapshot = snapshots[0];
    const finalSnapshot = snapshots[snapshots.length - 1];
    const growth = calculateMemoryGrowth(initialSnapshot, finalSnapshot);

    const heapGrowthPerKOps = (growth.heapUsedGrowth / iterations) * 1000;

    console.log(`\nWebSocket Memory Growth (${iterations} connections):`);
    console.log(`  Heap Growth: ${formatBytes(growth.heapUsedGrowth)}`);
    console.log(`  Heap Growth per 1K ops: ${formatBytes(heapGrowthPerKOps)}`);

    expect(heapGrowthPerKOps).toBeLessThan(THRESHOLDS.heapGrowthPerKOps);
  }, 120000);

  it('should stabilize memory usage over time', async () => {
    const duration = 30000; // 30 seconds
    const snapshotInterval = 2000; // Every 2 seconds
    const snapshots: MemorySnapshot[] = [];
    const startTime = Date.now();

    let requestCount = 0;

    while (Date.now() - startTime < duration) {
      // Make various requests
      await app.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: { authorization: `Bearer ${authToken}` },
      });

      requestCount++;

      // Take snapshot at intervals
      if (requestCount % 10 === 0) {
        if (global.gc) global.gc();
        snapshots.push(takeMemorySnapshot());
      }

      await sleep(10);
    }

    console.log(`\nMemory Stability Test (${duration}ms, ${requestCount} requests):`);
    console.log(`  Snapshots taken: ${snapshots.length}`);

    // Check if memory is growing linearly (bad) or stabilizing (good)
    const heapUsedValues = snapshots.map((s) => s.heapUsed);
    const r2 = calculateLinearRegression(heapUsedValues);

    console.log(`  Linear growth R²: ${r2.toFixed(4)}`);
    console.log(`  Interpretation: ${r2 > THRESHOLDS.maxLinearGrowthRate ? 'UNSTABLE - Linear growth detected' : 'STABLE - Memory usage stabilized'}`);

    // Memory should NOT be growing linearly (R² should be low)
    expect(r2).toBeLessThan(THRESHOLDS.maxLinearGrowthRate);
  }, 60000);
});

/**
 * Analyze memory snapshots for trends
 */
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
  const rssValues = snapshots.map((s) => s.rss);

  const heapMin = Math.min(...heapValues);
  const heapMax = Math.max(...heapValues);
  const heapAvg = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;

  console.log(`  Heap - Min: ${formatBytes(heapMin)}, Max: ${formatBytes(heapMax)}, Avg: ${formatBytes(heapAvg)}`);
  console.log(`  Heap Range: ${formatBytes(heapMax - heapMin)}`);

  const rssMin = Math.min(...rssValues);
  const rssMax = Math.max(...rssValues);
  const rssAvg = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;

  console.log(`  RSS - Min: ${formatBytes(rssMin)}, Max: ${formatBytes(rssMax)}, Avg: ${formatBytes(rssAvg)}`);
}

/**
 * Calculate R² (coefficient of determination) for linear regression
 * Higher R² means better linear fit (bad for memory - means it's growing)
 * Lower R² means memory is stabilizing (good)
 */
function calculateLinearRegression(values: number[]): number {
  const n = values.length;
  const xValues = Array.from({ length: n }, (_, i) => i);

  const sumX = xValues.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xValues.reduce((sum, x, i) => sum + x * values[i], 0);
  const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
  const sumY2 = values.reduce((sum, y) => sum + y * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R²
  const yMean = sumY / n;
  const ssTotal = values.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
  const ssResidual = values.reduce((sum, y, i) => {
    const yPred = slope * i + intercept;
    return sum + Math.pow(y - yPred, 2);
  }, 0);

  const r2 = 1 - ssResidual / ssTotal;
  return r2;
}
