import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHealthServer, registerWorkerStatus } from '../health.js';
import type { Server } from 'node:http';

// Mock Redis
function createMockRedis(healthy = true) {
  return {
    ping: healthy
      ? vi.fn().mockResolvedValue('PONG')
      : vi.fn().mockRejectedValue(new Error('Connection refused')),
  } as unknown as import('ioredis').Redis;
}

// Mock DB client
function createMockDb(healthy = true) {
  const sqlTag = healthy
    ? Object.assign(vi.fn().mockResolvedValue([{ '?column?': 1 }]), {
        end: vi.fn().mockResolvedValue(undefined),
      })
    : Object.assign(vi.fn().mockRejectedValue(new Error('Connection refused')), {
        end: vi.fn().mockResolvedValue(undefined),
      });

  return { sql: sqlTag } as unknown as import('../db/client.js').DbClient;
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as import('pino').Logger;

async function fetchHealth(port: number, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${port}${path}`);
  const body = await res.json();
  return { status: res.status, body: body as Record<string, unknown> };
}

describe('Health Server', () => {
  let server: Server;
  const TEST_PORT = 19876;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  describe('/health', () => {
    it('returns healthy when DB and Redis are up', async () => {
      server = createHealthServer({
        redis: createMockRedis(true),
        db: createMockDb(true),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault', 'email'],
      });

      // Wait for server to start listening
      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/health');
      expect(status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.service).toBe('workers');
      expect((body.checks as Record<string, string>).database).toBe('connected');
      expect((body.checks as Record<string, string>).redis).toBe('connected');
    });

    it('returns 503 when Redis is down', async () => {
      server = createHealthServer({
        redis: createMockRedis(false),
        db: createMockDb(true),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault'],
      });

      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/health');
      expect(status).toBe(503);
      expect(body.status).toBe('unhealthy');
      expect((body.checks as Record<string, string>).redis).toBe('disconnected');
    });

    it('returns 503 when DB is down', async () => {
      server = createHealthServer({
        redis: createMockRedis(true),
        db: createMockDb(false),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault'],
      });

      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/health');
      expect(status).toBe(503);
      expect(body.status).toBe('unhealthy');
      expect((body.checks as Record<string, string>).database).toBe('disconnected');
    });
  });

  describe('/ready', () => {
    it('returns ready when all deps are up and workers running', async () => {
      server = createHealthServer({
        redis: createMockRedis(true),
        db: createMockDb(true),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault', 'email'],
      });

      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/ready');
      expect(status).toBe(200);
      expect(body.ready).toBe(true);
    });

    it('returns 503 when deps are down', async () => {
      server = createHealthServer({
        redis: createMockRedis(false),
        db: createMockDb(false),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault'],
      });

      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/ready');
      expect(status).toBe(503);
      expect(body.ready).toBe(false);
    });
  });

  describe('/health/detailed', () => {
    it('returns detailed health with worker statuses and latency', async () => {
      server = createHealthServer({
        redis: createMockRedis(true),
        db: createMockDb(true),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault', 'email'],
      });

      await new Promise((r) => setTimeout(r, 100));

      const { status, body } = await fetchHealth(TEST_PORT, '/health/detailed');
      expect(status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.service).toBe('workers');
      expect(body.uptime_seconds).toBeTypeOf('number');
      expect(body.timestamp).toBeTruthy();
      expect(body.response_time_ms).toBeTypeOf('number');

      const checks = body.checks as Record<string, { ok: boolean; latency_ms: number }>;
      expect(checks.database.ok).toBe(true);
      expect(checks.database.latency_ms).toBeTypeOf('number');
      expect(checks.redis.ok).toBe(true);
      expect(checks.redis.latency_ms).toBeTypeOf('number');

      const workers = body.workers as Array<{ name: string; running: boolean }>;
      expect(workers).toHaveLength(2);
      expect(workers[0]).toEqual({ name: 'vault', running: true });
      expect(workers[1]).toEqual({ name: 'email', running: true });
    });
  });

  describe('registerWorkerStatus', () => {
    it('updates worker running status', async () => {
      server = createHealthServer({
        redis: createMockRedis(true),
        db: createMockDb(true),
        logger: mockLogger,
        port: TEST_PORT,
        workerNames: ['vault'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // Mark vault as stopped
      registerWorkerStatus('vault', false);

      const { body } = await fetchHealth(TEST_PORT, '/health/detailed');
      const workers = body.workers as Array<{ name: string; running: boolean }>;
      expect(workers[0]).toEqual({ name: 'vault', running: false });
    });
  });

  it('returns 404 for unknown paths', async () => {
    server = createHealthServer({
      redis: createMockRedis(true),
      db: createMockDb(true),
      logger: mockLogger,
      port: TEST_PORT,
      workerNames: [],
    });

    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://localhost:${TEST_PORT}/unknown`);
    expect(res.status).toBe(404);
  });
});
