import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// video_call.started
// ============================================================================

export const VideoCallStartedPayloadSchema = z.object({
  /** Video call record ID */
  videoCallId: z.string().uuid(),
  /** Companion in the video call */
  companionId: z.string().uuid(),
  /** LiveKit room name */
  roomName: z.string().min(1),
  /** Avatar provider used (e.g., 'simli') */
  avatarProvider: z.string().min(1),
  /** ISO8601 timestamp when call started */
  startedAt: z.string().datetime({ offset: true }),
});

export type VideoCallStartedPayload = z.infer<typeof VideoCallStartedPayloadSchema>;

export const VideoCallStartedEventSchema = createEventSchema(
  EventTypes.VIDEO_CALL_STARTED,
  VideoCallStartedPayloadSchema
);

export type VideoCallStartedEvent = TypedEvent<
  typeof EventTypes.VIDEO_CALL_STARTED,
  VideoCallStartedPayload
>;

// ============================================================================
// video_call.ended
// ============================================================================

export const VideoCallEndedPayloadSchema = z.object({
  /** Video call record ID */
  videoCallId: z.string().uuid(),
  /** Companion in the video call */
  companionId: z.string().uuid(),
  /** LiveKit room name */
  roomName: z.string().min(1),
  /** Duration in seconds */
  durationSeconds: z.number().int().nonnegative(),
  /** Total tokens deducted */
  tokensDeducted: z.number().int().nonnegative(),
  /** Estimated cost in USD */
  costUsd: z.number().nonnegative().optional(),
  /** Reason the call ended */
  reason: z.enum(['user_ended', 'tokens_depleted', 'error', 'timeout']),
  /** ISO8601 timestamp when call ended */
  endedAt: z.string().datetime({ offset: true }),
});

export type VideoCallEndedPayload = z.infer<typeof VideoCallEndedPayloadSchema>;

export const VideoCallEndedEventSchema = createEventSchema(
  EventTypes.VIDEO_CALL_ENDED,
  VideoCallEndedPayloadSchema
);

export type VideoCallEndedEvent = TypedEvent<
  typeof EventTypes.VIDEO_CALL_ENDED,
  VideoCallEndedPayload
>;

// ============================================================================
// video_call.failed
// ============================================================================

export const VideoCallFailedPayloadSchema = z.object({
  /** Video call record ID (may be null if failure was before record creation) */
  videoCallId: z.string().uuid().optional(),
  /** Companion in the video call */
  companionId: z.string().uuid(),
  /** Error message */
  errorMessage: z.string().min(1),
  /** Error code */
  errorCode: z.string().optional(),
  /** ISO8601 timestamp when failure occurred */
  failedAt: z.string().datetime({ offset: true }),
});

export type VideoCallFailedPayload = z.infer<typeof VideoCallFailedPayloadSchema>;

export const VideoCallFailedEventSchema = createEventSchema(
  EventTypes.VIDEO_CALL_FAILED,
  VideoCallFailedPayloadSchema
);

export type VideoCallFailedEvent = TypedEvent<
  typeof EventTypes.VIDEO_CALL_FAILED,
  VideoCallFailedPayload
>;
