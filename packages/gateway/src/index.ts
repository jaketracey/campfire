/**
 * Gateway Server Entry Point
 * Fastify-based HTTP/WebSocket server for Campfire API.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { logger, withContext, type RequestContext } from './observability/logger.js';
import { initTracing, shutdownTracing } from './observability/tracing.js';
import { initSentry, captureException, flushSentry, closeSentry, setUser } from './observability/sentry.js';
import { getDatabase, closeDatabase, checkDatabaseHealth } from './db/client.js';
import { registerRoutes } from './routes/index.js';
import { registerWebSocketHandler } from './ws/handler.js';
import { nanoid } from 'nanoid';
import { env } from './env.js';

// Initialize Sentry early for error capture (production only)
if (env.NODE_ENV === 'production') {
  initSentry();
}

// Initialize tracing before anything else
if (env.NODE_ENV === 'production') {
  initTracing();
}

// Create Fastify instance
const app = Fastify({
  logger: false, // We use our own logger
  trustProxy: true,
  requestIdHeader: 'x-request-id',
  genReqId: () => nanoid(),
});

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

// Register plugins
async function registerPlugins() {
  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  // CORS
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.headers['x-forwarded-for'] as string ?? request.ip;
    },
  });

  // WebSocket support
  await app.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
      clientTracking: true,
    },
  });
}

// Request hooks for logging and context
app.addHook('onRequest', async (request, reply) => {
  const traceId = (request.headers['x-trace-id'] as string) ?? crypto.randomUUID();
  const requestId = request.id;

  const ctx: RequestContext = {
    traceId,
    requestId,
  };

  // Store context for this request
  reply.header('x-trace-id', traceId);
  reply.header('x-request-id', requestId);

  // Run in context
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

// Error handler
app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  // Capture error to Sentry for 5xx errors
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

  // Don't expose internal errors in production
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

// Health check endpoint
app.get('/health', async (request, reply) => {
  const dbHealthy = await checkDatabaseHealth();

  if (!dbHealthy) {
    return reply.status(503).send({
      status: 'unhealthy',
      database: 'disconnected',
    });
  }

  return reply.send({
    status: 'healthy',
    version: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
  });
});

// Ready check endpoint (for k8s)
app.get('/ready', async (request, reply) => {
  const dbHealthy = await checkDatabaseHealth();

  if (!dbHealthy) {
    return reply.status(503).send({ ready: false });
  }

  return reply.send({ ready: true });
});

// Startup function
async function start() {
  try {
    // Initialize database
    getDatabase();
    logger.info('Database connection pool initialized');

    // Register plugins
    await registerPlugins();

    // Register routes
    await registerRoutes(app);

    // Register WebSocket handler
    await registerWebSocketHandler(app);

    // Start server
    await app.listen({ port: env.PORT, host: env.HOST });

    logger.info(
      { port: env.PORT, host: env.HOST, environment: env.NODE_ENV },
      'Gateway server started'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

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

export { app };
