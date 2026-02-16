/**
 * Lightweight HTTP health server for worker processes.
 * Exposes /health and /ready endpoints for load balancers and orchestrators.
 */

import { createServer, type Server } from 'node:http';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from './db/client.js';

interface HealthServerDeps {
  redis: Redis;
  db: DbClient;
  logger: Logger;
  port: number;
  workerNames: string[];
}

interface WorkerStatus {
  name: string;
  running: boolean;
}

let workerStatuses: WorkerStatus[] = [];

export function registerWorkerStatus(name: string, running: boolean): void {
  const existing = workerStatuses.find((w) => w.name === name);
  if (existing) {
    existing.running = running;
  } else {
    workerStatuses.push({ name, running });
  }
}

export function createHealthServer(deps: HealthServerDeps): Server {
  const { redis, db, logger, port } = deps;

  // Initialize worker status tracking
  workerStatuses = deps.workerNames.map((name) => ({ name, running: true }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/health') {
      await handleHealth(res);
    } else if (url.pathname === '/ready') {
      await handleReady(res);
    } else if (url.pathname === '/health/detailed') {
      await handleDetailed(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  async function checkRedis(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await redis.ping();
      return { ok: true, latency_ms: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async function checkDb(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await db.sql`SELECT 1`;
      return { ok: true, latency_ms: Date.now() - start };
    } catch (error) {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  function json(res: import('node:http').ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  async function handleHealth(res: import('node:http').ServerResponse): Promise<void> {
    const [redisHealth, dbHealth] = await Promise.all([checkRedis(), checkDb()]);

    const status = redisHealth.ok && dbHealth.ok ? 'healthy' : 'unhealthy';
    const statusCode = status === 'healthy' ? 200 : 503;

    json(res, statusCode, {
      status,
      service: 'workers',
      checks: {
        database: dbHealth.ok ? 'connected' : 'disconnected',
        redis: redisHealth.ok ? 'connected' : 'disconnected',
      },
    });
  }

  async function handleReady(res: import('node:http').ServerResponse): Promise<void> {
    const [redisHealth, dbHealth] = await Promise.all([checkRedis(), checkDb()]);
    const activeWorkers = workerStatuses.filter((w) => w.running);

    const ready = redisHealth.ok && dbHealth.ok && activeWorkers.length > 0;

    if (!ready) {
      json(res, 503, {
        ready: false,
        checks: {
          database: dbHealth.ok,
          redis: redisHealth.ok,
          active_workers: activeWorkers.length,
          total_workers: workerStatuses.length,
        },
      });
      return;
    }

    json(res, 200, { ready: true });
  }

  async function handleDetailed(res: import('node:http').ServerResponse): Promise<void> {
    const start = Date.now();
    const [redisHealth, dbHealth] = await Promise.all([checkRedis(), checkDb()]);

    const status = redisHealth.ok && dbHealth.ok ? 'healthy' : 'degraded';

    json(res, 200, {
      status,
      service: 'workers',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          ok: dbHealth.ok,
          latency_ms: dbHealth.latency_ms,
          ...(dbHealth.error && { error: dbHealth.error }),
        },
        redis: {
          ok: redisHealth.ok,
          latency_ms: redisHealth.latency_ms,
          ...(redisHealth.error && { error: redisHealth.error }),
        },
      },
      workers: workerStatuses,
      response_time_ms: Date.now() - start,
    });
  }

  server.listen(port, () => {
    logger.info({ port }, 'Health server started');
  });

  return server;
}
