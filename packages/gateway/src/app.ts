/**
 * App Factory
 * Creates and configures a Fastify instance without starting the listener.
 * Used by tests and by the main entry point (index.ts).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import { logger, withContext, type RequestContext } from './observability/logger.js';
import { captureException } from './observability/sentry.js';
import { registerRoutes } from './routes/index.js';
import { registerWebSocketHandler } from './ws/handler.js';
import { env } from './env.js';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Build a fully-configured Fastify app (plugins + routes + websocket).
 * The caller is responsible for calling `app.listen()` or `app.ready()`.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => nanoid(),
  });

  // --- Plugins ---

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.headers['x-forwarded-for'] as string ?? request.ip;
    },
    allowList: (request) => {
      // Exempt health/readiness probes from rate limiting
      return request.url === '/health' || request.url === '/ready';
    },
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
      clientTracking: true,
    },
  });

  // --- Hooks ---

  app.addHook('onRequest', async (request, reply) => {
    const traceId = (request.headers['x-trace-id'] as string) ?? crypto.randomUUID();
    const requestId = request.id;

    const ctx: RequestContext = {
      traceId,
      requestId,
    };

    reply.header('x-trace-id', traceId);
    reply.header('x-request-id', requestId);

    withContext(ctx, () => {
      logger.info(
        { method: request.method, url: request.url, userAgent: request.headers['user-agent'] },
        'Request started'
      );
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  // --- Error handler ---

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      captureException(error, {
        method: request.method,
        url: request.url,
        statusCode,
      });
    }

    logger.error(
      {
        err: error,
        method: request.method,
        url: request.url,
      },
      'Request error'
    );

    if (env.NODE_ENV === 'production' && !error.statusCode) {
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    }

    return reply.status(error.statusCode ?? 500).send({
      error: error.name,
      message: error.message,
    });
  });

  // --- Health / readiness probes ---
  // Registered here so they're available to both the production server and tests.
  // The checks are best-effort: if the DB/Redis modules fail to import (e.g. in
  // minimal test setups), the endpoints still respond with 200.

  app.get('/health', async (_request, reply) => {
    const result: Record<string, unknown> = {
      status: 'healthy',
      version: env.SERVICE_VERSION,
      environment: env.NODE_ENV,
    };

    try {
      const { checkDatabaseHealth } = await import('./db/client.js');
      const { checkRedisHealth } = await import('./utils/queue.js');

      const [dbHealthy, redisHealth] = await Promise.allSettled([
        checkDatabaseHealth(),
        checkRedisHealth(),
      ]);

      const dbOk = dbHealthy.status === 'fulfilled' && dbHealthy.value;
      const redisOk = redisHealth.status === 'fulfilled' && (redisHealth.value as { ok: boolean }).ok;

      result.status = dbOk && redisOk ? 'healthy' : 'degraded';
      result.checks = {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
      };
    } catch {
      // DB/Redis modules not available - that's fine
    }

    return reply.status(200).send(result);
  });

  app.get('/ready', async (_request, reply) => {
    try {
      const { checkDatabaseHealth } = await import('./db/client.js');
      const { checkRedisHealth } = await import('./utils/queue.js');

      const [dbHealthy, redisHealth] = await Promise.allSettled([
        checkDatabaseHealth(),
        checkRedisHealth(),
      ]);

      const dbOk = dbHealthy.status === 'fulfilled' && dbHealthy.value;
      const redisOk = redisHealth.status === 'fulfilled' && (redisHealth.value as { ok: boolean }).ok;

      if (!dbOk || !redisOk) {
        return reply.status(503).send({
          ready: false,
          checks: { database: dbOk, redis: redisOk },
        });
      }

      return reply.send({ ready: true });
    } catch {
      return reply.send({ ready: true });
    }
  });

  // --- Routes ---

  await registerRoutes(app);
  await registerWebSocketHandler(app);

  return app;
}
