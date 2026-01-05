/**
 * Admin Logs Routes
 * REST and WebSocket endpoints for viewing Docker container logs.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getDockerLogsService, VALID_SERVICES } from '../services/docker-logs.js';
import type { ServiceName, LogLevel, NormalizedLogEntry } from '../utils/log-parser.js';
import { logger } from '../observability/logger.js';

// Request schemas
const GetLogsQuerySchema = z.object({
  services: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(val => {
      if (!val) return VALID_SERVICES;
      const arr = Array.isArray(val) ? val : [val];
      return arr.filter(s => VALID_SERVICES.includes(s as ServiceName)) as ServiceName[];
    }),
  level: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .optional()
    .default('info'),
  search: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform(val => {
      const num = parseInt(val ?? '500', 10);
      return Math.min(Math.max(num, 1), 1000);
    }),
  since: z
    .string()
    .optional()
    .transform(val => (val ? new Date(val) : undefined)),
});

// WebSocket message schemas
const WSSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  services: z.array(z.enum(['gateway', 'web', 'orchestrator', 'workers'])).optional(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  search: z.string().optional(),
});

const WSUnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
});

const WSPingSchema = z.object({
  type: z.literal('ping'),
});

const WSMessageSchema = z.discriminatedUnion('type', [
  WSSubscribeSchema,
  WSUnsubscribeSchema,
  WSPingSchema,
]);

type WSSubscribeMessage = z.infer<typeof WSSubscribeSchema>;

/**
 * Register admin logs routes
 */
export async function adminLogsRoutes(app: FastifyInstance): Promise<void> {
  const dockerLogsService = getDockerLogsService();

  logger.info('Registering admin logs routes');

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/logs - Fetch historical logs
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = GetLogsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { services, level, search, limit, since } = queryResult.data;

    try {
      const result = await dockerLogsService.getHistoricalLogs({
        services,
        level: level as LogLevel,
        search,
        limit,
        since,
      });

      return reply.send({
        success: true,
        data: {
          logs: result.logs.map(formatLogEntry),
          meta: result.meta,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch logs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch logs',
      });
    }
  });

  /**
   * GET /admin/logs/stream - WebSocket endpoint for live log streaming
   */
  app.get('/stream', { websocket: true }, async (socket, request) => {
    logger.info({ userId: request.user?.userId }, 'Admin log stream connected');

    let abortController: AbortController | null = null;
    let isSubscribed = false;

    // Handle incoming messages
    socket.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        const parsed = WSMessageSchema.safeParse(message);

        if (!parsed.success) {
          socket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            details: parsed.error.issues,
          }));
          return;
        }

        const msg = parsed.data;

        switch (msg.type) {
          case 'subscribe':
            await handleSubscribe(msg);
            break;
          case 'unsubscribe':
            handleUnsubscribe();
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to parse WebSocket message');
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Failed to parse message',
        }));
      }
    });

    // Handle subscription
    async function handleSubscribe(msg: WSSubscribeMessage) {
      // Clean up existing subscription
      if (abortController) {
        abortController.abort();
      }

      abortController = new AbortController();
      isSubscribed = true;

      const services = msg.services ?? VALID_SERVICES;
      const level = msg.level ?? 'info';
      const search = msg.search;

      // Confirm subscription
      socket.send(JSON.stringify({
        type: 'subscribed',
        services,
        level,
        search: search ?? null,
      }));

      // Start streaming
      await dockerLogsService.streamLogs({
        services,
        level: level as LogLevel,
        search,
        signal: abortController.signal,
        onLog: (entry: NormalizedLogEntry) => {
          if (socket.readyState === 1) { // OPEN
            socket.send(JSON.stringify({
              type: 'log',
              entry: formatLogEntry(entry),
            }));
          }
        },
        onError: (service: ServiceName, error: Error) => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'error',
              service,
              message: error.message,
            }));
          }
        },
      });
    }

    // Handle unsubscription
    function handleUnsubscribe() {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      isSubscribed = false;

      socket.send(JSON.stringify({
        type: 'unsubscribed',
      }));
    }

    // Clean up on close
    socket.on('close', () => {
      logger.info({ userId: request.user?.userId }, 'Admin log stream disconnected');
      if (abortController) {
        abortController.abort();
      }
    });

    socket.on('error', (error) => {
      logger.warn({ error, userId: request.user?.userId }, 'Admin log stream error');
      if (abortController) {
        abortController.abort();
      }
    });
  });

  /**
   * GET /admin/logs/status - Check Docker availability
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const isAvailable = await dockerLogsService.checkAvailability();

    return reply.send({
      success: true,
      data: {
        dockerAvailable: isAvailable,
        services: VALID_SERVICES,
      },
    });
  });
}

/**
 * Format log entry for API response
 */
function formatLogEntry(entry: NormalizedLogEntry) {
  return {
    id: entry.id,
    timestamp: entry.timestamp.toISOString(),
    service: entry.service,
    level: entry.level,
    message: entry.message,
    context: entry.context,
  };
}
