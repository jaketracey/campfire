import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Session client information
 */
export const SessionClientInfoSchema = z.object({
  /** Client platform (web, ios, android) */
  platform: z.enum(['web', 'ios', 'android']),
  /** Client version string */
  version: z.string().min(1),
  /** User agent string */
  userAgent: z.string().optional(),
  /** Device type */
  deviceType: z.enum(['desktop', 'tablet', 'mobile']).optional(),
});

export type SessionClientInfo = z.infer<typeof SessionClientInfoSchema>;

// ============================================================================
// session.started
// ============================================================================

export const SessionStartedPayloadSchema = z.object({
  /** Companion ID for this session */
  companionId: z.string().min(1),
  /** Session mode (voice, text, multimodal) */
  mode: z.enum(['voice', 'text', 'multimodal']),
  /** Client information */
  clientInfo: SessionClientInfoSchema,
  /** ISO8601 timestamp when session started */
  startedAt: z.string().datetime({ offset: true }),
  /** Optional room ID for multi-participant sessions */
  roomId: z.string().optional(),
});

export type SessionStartedPayload = z.infer<typeof SessionStartedPayloadSchema>;

export const SessionStartedEventSchema = createEventSchema(
  EventTypes.SESSION_STARTED,
  SessionStartedPayloadSchema
);

export type SessionStartedEvent = TypedEvent<
  typeof EventTypes.SESSION_STARTED,
  SessionStartedPayload
>;

// ============================================================================
// session.ended
// ============================================================================

export const SessionEndedPayloadSchema = z.object({
  /** Reason for session end */
  reason: z.enum(['user_ended', 'timeout', 'error', 'system_shutdown', 'companion_deleted']),
  /** ISO8601 timestamp when session ended */
  endedAt: z.string().datetime({ offset: true }),
  /** Total duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Number of turns in this session */
  turnCount: z.number().int().nonnegative(),
  /** Error message if reason is 'error' */
  errorMessage: z.string().optional(),
  /** Error code if reason is 'error' */
  errorCode: z.string().optional(),
});

export type SessionEndedPayload = z.infer<typeof SessionEndedPayloadSchema>;

export const SessionEndedEventSchema = createEventSchema(
  EventTypes.SESSION_ENDED,
  SessionEndedPayloadSchema
);

export type SessionEndedEvent = TypedEvent<
  typeof EventTypes.SESSION_ENDED,
  SessionEndedPayload
>;
