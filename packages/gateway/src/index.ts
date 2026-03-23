/**
 * Gateway Server Entry Point
 * Fastify-based HTTP/WebSocket server for Campfire API.
 */

import { logger } from './observability/logger.js';
import { initTracing, shutdownTracing } from './observability/tracing.js';
import { initSentry, captureException, flushSentry, closeSentry } from './observability/sentry.js';
import { getDatabase, closeDatabase, checkDatabaseHealth } from './db/client.js';
import { checkRedisHealth, getQueueStats } from './utils/queue.js';
import { buildApp } from './app.js';
import { env } from './env.js';

// Initialize Sentry early for error capture (production only)
if (env.NODE_ENV === 'production') {
  initSentry();
}

// Initialize tracing before anything else
if (env.NODE_ENV === 'production') {
  initTracing();
}

// Startup function
async function start() {
  try {
    // Initialize database
    getDatabase();
    logger.info('Database connection pool initialized');

    // Build the app (registers plugins, routes, websocket)
    const app = await buildApp({ logger: false });

    // Add raw body parser for postback signature verification
    // This stores the raw body on the request for routes that need it (e.g., Flowguard postbacks)
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      // Store raw body for webhook verification
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        const json = JSON.parse(body as string);
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    // Health check endpoint - checks all critical dependencies
    app.get('/health', async (request, reply) => {
      const [dbHealthy, redisHealth] = await Promise.all([
        checkDatabaseHealth(),
        checkRedisHealth(),
      ]);

      const status = dbHealthy && redisHealth.ok ? 'healthy' : 'unhealthy';
      const statusCode = status === 'healthy' ? 200 : 503;

      return reply.status(statusCode).send({
        status,
        version: env.SERVICE_VERSION,
        environment: env.NODE_ENV,
        checks: {
          database: dbHealthy ? 'connected' : 'disconnected',
          redis: redisHealth.ok ? 'connected' : 'disconnected',
        },
      });
    });

    // Ready check endpoint (for k8s) - checks if service can accept traffic
    app.get('/ready', async (request, reply) => {
      const [dbHealthy, redisHealth] = await Promise.all([
        checkDatabaseHealth(),
        checkRedisHealth(),
      ]);

      const ready = dbHealthy && redisHealth.ok;

      if (!ready) {
        return reply.status(503).send({
          ready: false,
          checks: {
            database: dbHealthy,
            redis: redisHealth.ok,
          },
        });
      }

      return reply.send({ ready: true });
    });

    // Detailed health endpoint - returns latency and queue stats for monitoring
    app.get('/health/detailed', async (request, reply) => {
      const start = Date.now();
      const [dbHealthy, redisHealth, queueStats] = await Promise.all([
        checkDatabaseHealth(),
        checkRedisHealth(),
        getQueueStats(),
      ]);

      const status = dbHealthy && redisHealth.ok ? 'healthy' : 'degraded';

      return reply.send({
        status,
        version: env.SERVICE_VERSION,
        environment: env.NODE_ENV,
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            ok: dbHealthy,
          },
          redis: {
            ok: redisHealth.ok,
            latency_ms: redisHealth.latency_ms,
            ...(redisHealth.error && { error: redisHealth.error }),
          },
        },
        queues: queueStats,
        response_time_ms: Date.now() - start,
      });
    });

    // Start server
    await app.listen({ port: env.PORT, host: env.HOST });

    logger.info(
      { port: env.PORT, host: env.HOST, environment: env.NODE_ENV },
      'Gateway server started'
    );

    // Graceful shutdown
    async function shutdown(signal: string) {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        // Close server (stops accepting new connections)
        await app.close();
        logger.info('HTTP server closed');

        // Close database connections
        await closeDatabase();
        logger.info('Database connections closed');

        // Shutdown tracing
        if (env.NODE_ENV === 'production') {
          await shutdownTracing();
        }

        // Flush and close Sentry
        if (env.NODE_ENV === 'production') {
          await flushSentry(2000);
          await closeSentry();
        }

        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    }

    // Signal handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Uncaught exception handler
process.on('uncaughtException', async (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  captureException(error, { type: 'uncaughtException' });
  await flushSentry(2000);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.fatal({ err: reason }, 'Unhandled rejection');
  if (reason instanceof Error) {
    captureException(reason, { type: 'unhandledRejection' });
  }
  await flushSentry(2000);
  process.exit(1);
});

// Start the server
start();
