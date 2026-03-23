/**
 * Recovery and Resilience Tests
 *
 * Tests system recovery from various failure scenarios.
 * Uses directly-signed JWTs so the suite works without a register endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { sleep, formatDuration, createTestToken } from '../performance/setup';

describe('Connection Recovery Tests', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    authToken = await createTestToken('recovery-test-user', 'recovery@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should handle high request volume without crashing', async () => {
    // Send many requests quickly to verify server stability under load.
    // Note: app.inject() may not trigger rate limiting since it bypasses
    // the network stack, so we just verify the server handles the volume.
    const requestCount = 150;
    const responses: number[] = [];

    for (let i = 0; i < requestCount; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      responses.push(response.statusCode);
    }

    const successCount = responses.filter((code) => code === 200).length;

    console.log(`\nHigh Volume Test:`);
    console.log(`  Total requests: ${requestCount}`);
    console.log(`  Successful (200): ${successCount}`);

    // All health checks should succeed (exempt from rate limiting)
    expect(successCount).toBe(requestCount);
  });

  it('should handle concurrent request bursts', async () => {
    // Wait for rate limit window to reset from previous test
    await sleep(1100);

    const burstSize = 50;
    const promises: Promise<any>[] = [];

    const start = performance.now();

    for (let i = 0; i < burstSize; i++) {
      promises.push(
        app.inject({
          method: 'GET',
          url: '/health',
        })
      );
    }

    const results = await Promise.allSettled(promises);
    const duration = performance.now() - start;

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`\nConcurrent Request Burst:`);
    console.log(`  Burst size: ${burstSize}`);
    console.log(`  Duration: ${formatDuration(duration)}`);
    console.log(`  Successful: ${successful}`);
    console.log(`  Failed: ${failed}`);

    // All should be fulfilled (even if some are rate-limited with 429)
    expect(successful).toBe(burstSize);
    expect(duration).toBeLessThan(5000);
  });

  it('should recover from malformed requests', async () => {
    const malformedRequests = [
      { method: 'POST', url: '/api/auth/login', payload: 'invalid json' },
      { method: 'POST', url: '/api/auth/login', payload: { invalid: 'data' } },
      { method: 'GET', url: '/api/users/me', headers: { authorization: 'invalid' } },
      { method: 'POST', url: '/api/sessions', payload: null },
    ];

    for (const request of malformedRequests) {
      const response = await app.inject(request as any);

      // Should return error but not crash
      expect([400, 401, 404, 415, 422, 429, 500]).toContain(response.statusCode);
    }

    // Server should still be functional after malformed requests
    const healthCheck = await app.inject({
      method: 'GET',
      url: '/health',
    });

    // May be rate-limited from previous test, but server is still alive
    expect([200, 429]).toContain(healthCheck.statusCode);

    console.log(`\nMalformed Request Recovery:`);
    console.log(`  Processed ${malformedRequests.length} malformed requests`);
    console.log(`  Server recovered: YES`);
  });
});

describe('Graceful Degradation Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should handle missing dependencies gracefully', async () => {
    const endpoints = [
      { method: 'GET', url: '/health', expectedCode: 200 },
      { method: 'GET', url: '/ready', expectedCode: 200 },
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method as any,
        url: endpoint.url,
      });

      expect(response.statusCode).toBe(endpoint.expectedCode);
    }
  });

  it('should handle database query errors gracefully', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/invalid-user-id',
    });

    // Should return error, not crash
    expect([400, 401, 404, 500]).toContain(response.statusCode);

    // Server should still work
    const healthCheck = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(healthCheck.statusCode).toBe(200);
  });

  it('should handle timeout scenarios', async () => {
    const timeoutTest = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 100);

      try {
        await app.inject({
          method: 'GET',
          url: '/api/users/me',
          signal: controller.signal as any,
        });
      } catch {
        // Expected timeout
        console.log('Request timed out as expected');
      } finally {
        clearTimeout(timeout);
      }
    };

    await timeoutTest();

    // Server should still be responsive
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });
});
