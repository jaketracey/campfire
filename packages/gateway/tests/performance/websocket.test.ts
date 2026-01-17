/**
 * WebSocket Performance Tests
 * 
 * Measures WebSocket connection handling and message throughput
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../../src/index';
import {
  runConcurrent,
  calculateMetrics,
  takeMemorySnapshot,
  calculateMemoryGrowth,
  formatBytes,
  formatDuration,
  sleep,
  type PerformanceMetrics,
} from './setup';

// Performance thresholds
const THRESHOLDS = {
  connectionTime: { p50: 100, p95: 200, p99: 300 },
  messageRoundTrip: { p50: 20, p95: 50, p99: 100 },
  throughput: {
    minMessagesPerSecond: 1000,
    maxConnectionTime: 500, // ms
  },
} as const;

describe('WebSocket Performance Tests', () => {
  let app: FastifyInstance;
  let authToken: string;
  let wsUrl: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.listen({ port: 0 }); // Random available port

    const address = app.server.address();
    const port = typeof address === 'string' ? 3000 : address?.port || 3000;
    wsUrl = `ws://localhost:${port}`;

    // Create test user and get auth token
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `ws-test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'WebSocket Test User',
      },
    });

    const authData = JSON.parse(authResponse.payload);
    authToken = authData.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should measure single WebSocket connection time', async () => {
    const durations: number[] = [];

    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      
      const ws = new WebSocket(`${wsUrl}/ws`, {
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          const duration = performance.now() - start;
          durations.push(duration);
          ws.close();
          resolve();
        });

        ws.on('error', reject);
        
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    }

    const metrics = calculateMetrics(durations);
    logMetrics('WebSocket Connection Time', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.connectionTime.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.connectionTime.p99);
  });

  it('should measure concurrent WebSocket connections', async () => {
    const concurrentConnections = 50;
    const durations: number[] = [];
    const connections: WebSocket[] = [];

    const initialMemory = takeMemorySnapshot();

    try {
      for (let i = 0; i < concurrentConnections; i++) {
        const start = performance.now();
        
        const ws = new WebSocket(`${wsUrl}/ws`, {
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => {
            const duration = performance.now() - start;
            durations.push(duration);
            resolve();
          });

          ws.on('error', reject);
          
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });

        connections.push(ws);
      }

      const metrics = calculateMetrics(durations);
      logMetrics('Concurrent WebSocket Connections', metrics);

      const finalMemory = takeMemorySnapshot();
      const memoryGrowth = calculateMemoryGrowth(initialMemory, finalMemory);

      console.log(`\nMemory per connection: ${formatBytes(memoryGrowth.heapUsedGrowth / concurrentConnections)}`);

      expect(metrics.p95).toBeLessThan(THRESHOLDS.connectionTime.p95);
      expect(connections.length).toBe(concurrentConnections);

    } finally {
      // Clean up connections
      connections.forEach((ws) => ws.close());
    }
  });

  it('should measure message round-trip time', async () => {
    const ws = new WebSocket(`${wsUrl}/ws`, {
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const durations: number[] = [];
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const messageId = `test-${i}`;

      const messagePromise = new Promise<void>((resolve) => {
        const handler = (data: WebSocket.Data) => {
          const message = JSON.parse(data.toString());
          if (message.id === messageId) {
            const duration = performance.now() - start;
            durations.push(duration);
            ws.off('message', handler);
            resolve();
          }
        };
        ws.on('message', handler);
      });

      ws.send(JSON.stringify({
        id: messageId,
        type: 'ping',
        timestamp: Date.now(),
      }));

      await messagePromise;
    }

    ws.close();

    const metrics = calculateMetrics(durations);
    logMetrics('Message Round-Trip Time', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.messageRoundTrip.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.messageRoundTrip.p99);
  });

  it('should measure message throughput', async () => {
    const ws = new WebSocket(`${wsUrl}/ws`, {
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const messageCount = 1000;
    const testDurationMs = 5000; // 5 seconds
    let receivedCount = 0;
    const startTime = performance.now();

    const receivePromise = new Promise<void>((resolve) => {
      ws.on('message', () => {
        receivedCount++;
        if (receivedCount >= messageCount) {
          resolve();
        }
      });
    });

    // Send messages as fast as possible
    for (let i = 0; i < messageCount; i++) {
      ws.send(JSON.stringify({
        id: `throughput-${i}`,
        type: 'test',
        payload: 'x'.repeat(100), // 100 byte payload
      }));
    }

    await receivePromise;
    const duration = performance.now() - startTime;
    
    ws.close();

    const messagesPerSecond = (messageCount / duration) * 1000;
    const avgLatency = duration / messageCount;

    console.log('\nMessage Throughput:');
    console.log(`  Messages: ${messageCount}`);
    console.log(`  Duration: ${formatDuration(duration)}`);
    console.log(`  Throughput: ${messagesPerSecond.toFixed(2)} msg/s`);
    console.log(`  Avg Latency: ${formatDuration(avgLatency)}`);

    expect(messagesPerSecond).toBeGreaterThan(THRESHOLDS.throughput.minMessagesPerSecond);
  });

  it('should handle connection stress test', async () => {
    const totalConnections = 100;
    const batchSize = 20;
    const connections: WebSocket[] = [];
    const errors: Error[] = [];

    const initialMemory = takeMemorySnapshot();

    try {
      // Connect in batches to avoid overwhelming the server
      for (let batch = 0; batch < totalConnections / batchSize; batch++) {
        const batchPromises = Array.from({ length: batchSize }, () => {
          return new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`${wsUrl}/ws`, {
              headers: {
                authorization: `Bearer ${authToken}`,
              },
            });

            ws.on('open', () => resolve(ws));
            ws.on('error', (err) => {
              errors.push(err as Error);
              reject(err);
            });

            setTimeout(() => reject(new Error('Connection timeout')), 5000);
          }).catch((err) => {
            return null; // Continue on error
          });
        });

        const batchResults = await Promise.all(batchPromises);
        connections.push(...batchResults.filter((ws): ws is WebSocket => ws !== null));

        // Small delay between batches
        await sleep(100);
      }

      const finalMemory = takeMemorySnapshot();
      const memoryGrowth = calculateMemoryGrowth(initialMemory, finalMemory);

      console.log('\nConnection Stress Test:');
      console.log(`  Successful: ${connections.length}`);
      console.log(`  Failed: ${errors.length}`);
      console.log(`  Total Memory: ${formatBytes(memoryGrowth.heapUsedGrowth)}`);
      console.log(`  Memory/Connection: ${formatBytes(memoryGrowth.heapUsedGrowth / connections.length)}`);

      // Should successfully create most connections
      expect(connections.length).toBeGreaterThan(totalConnections * 0.9);
      expect(errors.length).toBeLessThan(totalConnections * 0.1);

    } finally {
      // Clean up
      connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    }
  });

  it('should measure reconnection performance', async () => {
    const reconnectionAttempts = 20;
    const durations: number[] = [];

    for (let i = 0; i < reconnectionAttempts; i++) {
      const start = performance.now();

      const ws = new WebSocket(`${wsUrl}/ws`, {
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          const duration = performance.now() - start;
          durations.push(duration);
          
          // Immediately close and reconnect
          ws.close();
          
          ws.on('close', () => resolve());
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // Small delay between reconnections
      await sleep(50);
    }

    const metrics = calculateMetrics(durations);
    logMetrics('WebSocket Reconnection Time', metrics);

    expect(metrics.p95).toBeLessThan(THRESHOLDS.connectionTime.p95);
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
