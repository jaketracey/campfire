/**
 * Sentry Error Monitoring
 * Provides error capture and performance monitoring for production environments.
 */

import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { logger, getRequestContext } from './logger.js';

/**
 * Sentry configuration from environment
 */
interface SentryConfig {
  dsn: string | undefined;
  environment: string;
  release: string;
  enabled: boolean;
  sampleRate: number;
  tracesSampleRate: number;
}

function getSentryConfig(): SentryConfig {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SERVICE_VERSION,
    enabled: !!env.SENTRY_DSN && env.NODE_ENV === 'production',
    sampleRate: 1.0, // Capture all errors
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0, // 10% of transactions in prod
  };
}

/**
 * Initialize Sentry SDK
 * Should be called early in application startup
 */
export function initSentry(): void {
  const config = getSentryConfig();

  if (!config.enabled) {
    logger.info({ hasdsn: !!config.dsn, environment: config.environment }, 'Sentry is disabled');
    return;
  }

  logger.info({ environment: config.environment, release: config.release }, 'Initializing Sentry');

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sampleRate: config.sampleRate,
    tracesSampleRate: config.tracesSampleRate,

    // Filter sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }

      // Remove sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data) {
            const filtered = { ...breadcrumb.data };
            delete filtered['password'];
            delete filtered['token'];
            delete filtered['secret'];
            breadcrumb.data = filtered;
          }
          return breadcrumb;
        });
      }

      return event;
    },

    // Include request data when available
    integrations: [
      Sentry.httpIntegration(),
      Sentry.postgresIntegration(),
    ],
  });

  logger.info('Sentry initialized successfully');
}

/**
 * Capture an exception to Sentry
 * Automatically includes request context when available
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
): string {
  const requestCtx = getRequestContext();

  return Sentry.captureException(error, {
    extra: context,
    tags: {
      traceId: requestCtx?.traceId,
      userId: requestCtx?.userId,
      sessionId: requestCtx?.sessionId,
    },
  });
}

/**
 * Capture a message to Sentry
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: Record<string, unknown>
): string {
  const requestCtx = getRequestContext();

  return Sentry.captureMessage(message, {
    level,
    extra: context,
    tags: {
      traceId: requestCtx?.traceId,
      userId: requestCtx?.userId,
      sessionId: requestCtx?.sessionId,
    },
  });
}

/**
 * Set user context for Sentry events
 */
export function setUser(user: { id: string; email?: string; username?: string }): void {
  Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Create a Sentry transaction for performance monitoring
 */
export function startTransaction(
  name: string,
  op: string
): ReturnType<typeof Sentry.startSpan> | null {
  if (!getSentryConfig().enabled) {
    return null;
  }

  return Sentry.startSpan({ name, op }, () => {
    return Sentry.getActiveSpan();
  });
}

/**
 * Flush any pending Sentry events
 * Call before shutting down the application
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  return Sentry.flush(timeout);
}

/**
 * Close Sentry SDK
 */
export async function closeSentry(): Promise<void> {
  await Sentry.close();
  logger.info('Sentry closed');
}

/**
 * Sentry error handler middleware for Fastify
 */
export function createSentryErrorHandler() {
  return function sentryErrorHandler(
    error: Error,
    request: { url: string; method: string; headers: Record<string, unknown> },
    _reply: unknown
  ): void {
    const eventId = captureException(error, {
      url: request.url,
      method: request.method,
      headers: {
        'user-agent': request.headers['user-agent'],
        'content-type': request.headers['content-type'],
      },
    });

    logger.error({ err: error, sentryEventId: eventId }, 'Error captured by Sentry');
  };
}

// Re-export Sentry for advanced usage
export { Sentry };
