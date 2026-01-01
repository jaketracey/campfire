import { z } from 'zod';

/**
 * Cost information attached to events
 * Tracks tokens, duration, and estimated cost
 */
export const CostInfoSchema = z.object({
  /** Input tokens consumed */
  inputTokens: z.number().int().nonnegative().optional(),
  /** Output tokens generated */
  outputTokens: z.number().int().nonnegative().optional(),
  /** Total tokens (input + output) */
  totalTokens: z.number().int().nonnegative().optional(),
  /** Duration in milliseconds */
  durationMs: z.number().nonnegative().optional(),
  /** Estimated cost in USD */
  estimatedCostUsd: z.number().nonnegative().optional(),
  /** Provider used (e.g., 'openai', 'anthropic', 'elevenlabs') */
  provider: z.string().optional(),
  /** Model or service identifier */
  model: z.string().optional(),
});

export type CostInfo = z.infer<typeof CostInfoSchema>;

/**
 * Base event envelope that wraps all events in the system.
 * All events MUST include these fields per plan.md section 5.1.
 */
export const EventEnvelopeSchema = z.object({
  /** Unique identifier for this event (UUID v4) */
  eventId: z.string().uuid(),
  /** ISO8601 timestamp of when the event occurred */
  timestamp: z.string().datetime({ offset: true }),
  /** User ID this event belongs to */
  userId: z.string().min(1),
  /** Session ID for the current session */
  sessionId: z.string().min(1),
  /** Turn ID within the session (null for background events) */
  turnId: z.string().nullable(),
  /** Trace ID that ties all events in a turn together */
  traceId: z.string().min(1),
  /** Event type identifier (e.g., 'session.started', 'llm.token') */
  type: z.string().min(1),
  /** Event payload - typed per event type */
  payload: z.unknown(),
  /** Event schema version for forward compatibility */
  version: z.string().min(1),
  /** ID of the event that caused this event */
  causationId: z.string().nullable(),
  /** Correlation ID for linking events across services */
  correlationId: z.string().min(1),
  /** Optional cost information for billing/tracking */
  cost: CostInfoSchema.optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Generic typed event that combines envelope with typed payload.
 * Use this to create strongly-typed event instances.
 */
export interface TypedEvent<TType extends string, TPayload> {
  readonly eventId: string;
  readonly timestamp: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly traceId: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly version: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly cost?: CostInfo;
}

/**
 * Helper function to create a typed event schema.
 * Combines the envelope with a specific payload schema.
 */
export function createEventSchema<
  TType extends string,
  TPayloadSchema extends z.ZodTypeAny
>(
  eventType: TType,
  payloadSchema: TPayloadSchema
) {
  return EventEnvelopeSchema.extend({
    type: z.literal(eventType),
    payload: payloadSchema,
  });
}

/**
 * Extracts the event type from a TypedEvent
 */
export type ExtractEventType<T> = T extends TypedEvent<infer TType, unknown> ? TType : never;

/**
 * Extracts the payload type from a TypedEvent
 */
export type EventPayload<T> = T extends TypedEvent<string, infer TPayload> ? TPayload : never;
