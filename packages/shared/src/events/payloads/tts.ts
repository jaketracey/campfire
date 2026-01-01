import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// tts.requested
// ============================================================================

export const TtsRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Text to synthesize */
  text: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Voice profile ID */
  voiceProfileId: z.string().min(1),
  /** Provider to use */
  provider: z.string().min(1),
  /** Provider voice ID */
  providerVoiceId: z.string().min(1),
  /** Voice tuning parameters */
  voiceTuning: z.object({
    /** Speaking rate (0.5-2.0, 1.0 is normal) */
    rate: z.number().min(0.5).max(2.0).optional(),
    /** Pitch adjustment (-1.0 to 1.0, 0 is normal) */
    pitch: z.number().min(-1).max(1).optional(),
    /** Volume adjustment (0-1, 1 is max) */
    volume: z.number().min(0).max(1).optional(),
    /** Stability (provider-specific) */
    stability: z.number().min(0).max(1).optional(),
    /** Similarity boost (provider-specific) */
    similarityBoost: z.number().min(0).max(1).optional(),
  }).optional(),
  /** Output format */
  outputFormat: z.enum(['mp3', 'opus', 'pcm16', 'wav']),
  /** Sample rate */
  sampleRate: z.number().int().positive(),
  /** Whether to stream chunks */
  streaming: z.boolean(),
});

export type TtsRequestedPayload = z.infer<typeof TtsRequestedPayloadSchema>;

export const TtsRequestedEventSchema = createEventSchema(
  EventTypes.TTS_REQUESTED,
  TtsRequestedPayloadSchema
);

export type TtsRequestedEvent = TypedEvent<
  typeof EventTypes.TTS_REQUESTED,
  TtsRequestedPayload
>;

// ============================================================================
// tts.chunk.ready
// ============================================================================

export const TtsChunkReadyPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Chunk sequence number */
  sequenceNumber: z.number().int().nonnegative(),
  /** S3 storage key for this chunk */
  storageKey: z.string().min(1),
  /** Duration of this chunk in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Size in bytes */
  sizeBytes: z.number().int().nonnegative(),
  /** Whether this is the final chunk */
  isFinal: z.boolean(),
  /** Cumulative duration so far in milliseconds */
  cumulativeDurationMs: z.number().int().nonnegative(),
});

export type TtsChunkReadyPayload = z.infer<typeof TtsChunkReadyPayloadSchema>;

export const TtsChunkReadyEventSchema = createEventSchema(
  EventTypes.TTS_CHUNK_READY,
  TtsChunkReadyPayloadSchema
);

export type TtsChunkReadyEvent = TypedEvent<
  typeof EventTypes.TTS_CHUNK_READY,
  TtsChunkReadyPayload
>;

// ============================================================================
// tts.completed
// ============================================================================

export const TtsCompletedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** S3 storage key for complete audio */
  storageKey: z.string().min(1),
  /** Public URL for playback */
  url: z.string().url(),
  /** Total duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Total size in bytes */
  sizeBytes: z.number().int().nonnegative(),
  /** Number of chunks generated */
  chunkCount: z.number().int().nonnegative(),
  /** Character count synthesized */
  characterCount: z.number().int().nonnegative(),
  /** Processing latency in milliseconds */
  latencyMs: z.number().int().nonnegative(),
  /** Time to first chunk in milliseconds (if streaming) */
  timeToFirstChunkMs: z.number().int().nonnegative().optional(),
  /** Provider used */
  provider: z.string().min(1),
  /** Model used */
  model: z.string().min(1),
});

export type TtsCompletedPayload = z.infer<typeof TtsCompletedPayloadSchema>;

export const TtsCompletedEventSchema = createEventSchema(
  EventTypes.TTS_COMPLETED,
  TtsCompletedPayloadSchema
);

export type TtsCompletedEvent = TypedEvent<
  typeof EventTypes.TTS_COMPLETED,
  TtsCompletedPayload
>;
