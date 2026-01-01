/**
 * Structured JSON logging with Pino
 * Provides consistent logging across the gateway service.
 */

import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request context for logging
 */
export interface RequestContext {
  traceId: string;
  spanId?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
}

/**
 * Async local storage for request context propagation
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current trace ID from context
 */
export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Run a function with a request context
 */
export function withContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

/**
 * Logger configuration
 */
const logLevel = process.env['LOG_LEVEL'] ?? 'info';
const isPretty = process.env['NODE_ENV'] !== 'production';

/**
 * Create the base logger with custom serializers
 */
const baseLogger = pino({
  level: logLevel,
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        host: bindings.hostname,
        service: 'gateway',
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.routerPath,
      headers: {
        host: req.headers?.['host'],
        'user-agent': req.headers?.['user-agent'],
        'content-type': req.headers?.['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  // Redact sensitive information
  redact: {
    paths: [
      'password',
      'secret',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
      '*.password',
      '*.secret',
      '*.token',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  transport: isPretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,service',
        },
      }
    : undefined,
});

/**
 * Create a child logger that automatically includes request context
 */
function createContextualLogger() {
  return new Proxy(baseLogger, {
    get(target, prop) {
      const value = target[prop as keyof typeof target];

      // Intercept logging methods to add context
      if (typeof value === 'function' && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(prop as string)) {
        return function (this: unknown, ...args: unknown[]) {
          const ctx = requestContext.getStore();

          // If we have context, add it to the log
          if (ctx) {
            const contextObj = {
              traceId: ctx.traceId,
              spanId: ctx.spanId,
              requestId: ctx.requestId,
              userId: ctx.userId,
              sessionId: ctx.sessionId,
            };

            // If first arg is an object, merge context into it
            if (typeof args[0] === 'object' && args[0] !== null) {
              args[0] = { ...contextObj, ...args[0] };
            } else {
              // Insert context object as first argument
              args.unshift(contextObj);
            }
          }

          return (value as (...args: unknown[]) => unknown).apply(target, args);
        };
      }

      return value;
    },
  });
}

/**
 * Main logger instance
 * Automatically includes trace context when available
 */
export const logger = createContextualLogger();

/**
 * Create a child logger with additional context
 */
export function createLogger(bindings: Record<string, unknown>): pino.Logger {
  return baseLogger.child(bindings);
}

/**
 * Log an error with stack trace
 */
export function logError(error: Error, message?: string, extra?: Record<string, unknown>): void {
  logger.error(
    {
      err: error,
      ...extra,
    },
    message ?? error.message
  );
}

/**
 * Performance logging helper
 */
export function logPerformance(operation: string, durationMs: number, extra?: Record<string, unknown>): void {
  logger.info(
    {
      operation,
      durationMs,
      ...extra,
    },
    `${operation} completed in ${durationMs}ms`
  );
}
