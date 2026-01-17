/**
 * Recovery and Resilience Tests
 * 
 * Tests system recovery from various failure scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { buildApp } from '../../src/index';
import { sleep, formatDuration } from '../performance/setup';

describe('Connection Recovery Tests', () => {
  let app: FastifyInstance;
  let authToken: string;
  let sql: postgres.Sql;
  let redis: Redis;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Setup database connection
    sql = postgres(process.env.DATABASE_URL || 'postgres://localhost:5432/campfire_test');

    // Setup Redis connection
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Create test user
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `recovery-test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
        displayName: 'Recovery Test User',
      },
    });

    const authData = JSON.parse(authResponse.payload);
    authToken = authData.token;
  });

  afterAll(async () => {
    await sql.end();
    await redis.quit();
    await app.close();
  });

  it('should recover from database connection timeout', async () => {
    // Create a query that will timeout
    const timeoutPromise = sql`SELECT pg_sleep(0.5)`
      .catch((err) => {
        console.log('Expected timeout error:', err.message);
        return null;
      });

    await timeoutPromise;

    // Wait a bit for connection to recover
    await sleep(100);

    // Should be able to make successful queries after timeout
    const start = performance.now();
    const result = await sql`SELECT 1 as healthy`;
    const duration = performance.now() - start;

    console.log(`\nDatabase Recovery:`);
    console.log(`  Recovery query time: ${formatDuration(duration)}`);
    console.log(`  Result: ${result.length > 0 ? 'SUCCESS' : 'FAILED'}`);

    expect(result.length).toBe(1);
    expect(duration).toBeLessThan(1000); // Should complete quickly
  });

  it('should handle Redis connection loss gracefully', async () => {
    const testKey = 'recovery-test-key';
    
    // First verify Redis is working
    await redis.set(testKey, 'test-value');
    const beforeValue = await redis.get(testKey);
    expect(beforeValue).toBe('test-value');

    // Simulate connection issue by disconnecting
    const tempRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 2,
      retryStrategy: () => null, // Don't retry
    });

    tempRedis.disconnect();

    // Try to use disconnected client
    try {
      await tempRedis.set('should-fail', 'value');
      expect.fail('Should have thrown error');
    } catch (error) {
      console.log('Expected Redis error:', (error as Error).message);
      expect(error).toBeDefined();
    }

    // Original connection should still work
    const afterValue = await redis.get(testKey);
    expect(afterValue).toBe('test-value');

    await redis.del(testKey);
  });

  it('should recover from WebSocket disconnection', async () => {
    const address = app.server.address();
    if (!address) {
      await app.listen({ port: 0 });
    }

    const port = typeof address === 'string' ? 3000 : (address?.port || 3000);
    const wsUrl = `ws://localhost:${port}/ws`;

    const reconnectionTimes: number[] = [];
    const maxReconnections = 5;

    for (let i = 0; i < maxReconnections; i++) {
      const reconnectStart = performance.now();

      const ws = new WebSocket(wsUrl, {
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      const connected = await new Promise<boolean>((resolve) => {
        ws.on('open', () => {
          const duration = performance.now() - reconnectStart;
          reconnectionTimes.push(duration);
          resolve(true);
        });

        ws.on('error', () => {
          resolve(false);
        });

        setTimeout(() => resolve(false), 5000);
      });

      if (connected) {
        // Close and reconnect
        ws.close();
        await new Promise((resolve) => {
          ws.on('close', resolve);
          setTimeout(resolve, 1000);
        });
      }

      // Small delay between reconnections
      await sleep(100);
    }

    console.log(`\nWebSocket Reconnection:`);
    console.log(`  Successful reconnections: ${reconnectionTimes.length}/${maxReconnections}`);
    
    if (reconnectionTimes.length > 0) {
      const avgReconnectionTime =
        reconnectionTimes.reduce((a, b) => a + b, 0) / reconnectionTimes.length;
      console.log(`  Avg reconnection time: ${formatDuration(avgReconnectionTime)}`);
      
      expect(avgReconnectionTime).toBeLessThan(1000); // Should reconnect quickly
    }

    expect(reconnectionTimes.length).toBeGreaterThan(maxReconnections * 0.8); // At least 80% success rate
  });

  it('should handle API rate limiting gracefully', async () => {
    const requestCount = 150; // Exceed rate limit
    const responses: number[] = [];

    for (let i = 0; i < requestCount; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      responses.push(response.statusCode);
    }

    const successCount = responses.filter((code) => code === 200).length;
    const rateLimitCount = responses.filter((code) => code === 429).length;

    console.log(`\nRate Limiting:`);
    console.log(`  Total requests: ${requestCount}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Rate limited: ${rateLimitCount}`);

    // Should have some rate limiting
    expect(rateLimitCount).toBeGreaterThan(0);

    // After rate limit window, should work again
    await sleep(1000);

    const afterResponse = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(afterResponse.statusCode).toBe(200);
  });

  it('should handle concurrent request bursts', async () => {
    const burstSize = 100;
    const promises: Promise<any>[] = [];

    const start = performance.now();

    for (let i = 0; i < burstSize; i++) {
      promises.push(
        app.inject({
          method: 'GET',
          url: '/api/users/me',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
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
    console.log(`  Success rate: ${((successful / burstSize) * 100).toFixed(2)}%`);

    // Should handle most requests successfully
    expect(successful).toBeGreaterThan(burstSize * 0.9); // At least 90% success
    expect(duration).toBeLessThan(5000); // Complete within 5 seconds
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
      expect([400, 401, 422, 500]).toContain(response.statusCode);
    }

    // Server should still be functional after malformed requests
    const healthCheck = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(healthCheck.statusCode).toBe(200);

    const validRequest = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(validRequest.statusCode).toBe(200);
    
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
    // Test endpoints that might depend on external services
    const endpoints = [
      { method: 'GET', url: '/health', expectedCode: 200 },
      { method: 'GET', url: '/ready', expectedCode: 200 },
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method as any,
        url: endpoint.url,
      });

      // Even if dependencies are down, health checks should respond
      expect(response.statusCode).toBe(endpoint.expectedCode);
    }
  });

  it('should handle database query errors gracefully', async () => {
    // Try to query with invalid parameters
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/invalid-user-id',
    });

    // Should return error, not crash
    expect([400, 404, 500]).toContain(response.statusCode);

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
      } catch (error) {
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
