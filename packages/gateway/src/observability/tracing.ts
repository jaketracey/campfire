/**
 * OpenTelemetry tracing setup
 * Provides distributed tracing capabilities for the gateway service.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

// Deployment environment attribute (not exported in all versions)
const DEPLOYMENT_ENVIRONMENT_KEY = 'deployment.environment';
import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { logger } from './logger.js';
import { env } from '../env.js';

/**
 * Tracing configuration from environment
 */
interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  enabled: boolean;
}

function getTracingConfig(): TracingConfig {
  return {
    serviceName: env.OTEL_SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    enabled: env.OTEL_ENABLED,
  };
}

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK
 * Should be called before any other imports in the application
 */
export async function initTracing(): Promise<void> {
  const config = getTracingConfig();

  if (!config.enabled) {
    logger.info('OpenTelemetry tracing is disabled');
    return;
  }

  logger.info({ config }, 'Initializing OpenTelemetry tracing');

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    [DEPLOYMENT_ENVIRONMENT_KEY]: config.environment,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${config.otlpEndpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable some instrumentations that may be noisy
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-dns': {
          enabled: false,
        },
      }),
      new FastifyInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  try {
    sdk.start();
    logger.info('OpenTelemetry tracing initialized successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize OpenTelemetry tracing');
    throw error;
  }
}

/**
 * Shutdown the OpenTelemetry SDK gracefully
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('OpenTelemetry tracing shut down successfully');
    } catch (error) {
      logger.error({ err: error }, 'Error shutting down OpenTelemetry tracing');
    }
  }
}

/**
 * Get the main tracer for creating spans
 */
export function getTracer(name = 'campfire-gateway'): Tracer {
  return trace.getTracer(name);
}

/**
 * Get the current active span
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Get the current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  const span = getCurrentSpan();
  if (span) {
    return span.spanContext().traceId;
  }
  return undefined;
}

/**
 * Get the current span ID
 */
export function getCurrentSpanId(): string | undefined {
  const span = getCurrentSpan();
  if (span) {
    return span.spanContext().spanId;
  }
  return undefined;
}

/**
 * Run a function within a new span
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        span.setAttributes(attributes);
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Run a synchronous function within a new span
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Record<string, string | number | boolean>
): T {
  const tracer = getTracer();
  const span = tracer.startSpan(name);

  try {
    if (attributes) {
      span.setAttributes(attributes);
    }
    const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add attributes to the current span
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Record an error on the current span
 */
export function recordSpanError(error: Error): void {
  const span = getCurrentSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}
