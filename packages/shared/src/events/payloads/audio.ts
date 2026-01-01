import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// audio.chunk.received
// ============================================================================

export const AudioChunkReceivedPayloadSchema = z.object({
  /** Sequence number of this chunk within the turn */
  sequenceNumber: z.number().int().nonnegative(),
  /** Audio format (e.g., 'pcm16', 'opus', 'mp3') */
  format: z.string().min(1),
  /** Sample rate in Hz */
  sampleRate: z.number().int().positive(),
  /** Number of channels */
  channels: z.number().int().positive().max(2),
  /** Duration of this chunk in milliseconds */
  durationMs: z.number().nonnegative(),
  /** Size in bytes */
  sizeBytes: z.number().int().nonnegative(),
  /** S3 key or URL for the audio chunk */
  storageKey: z.string().min(1),
  /** Whether this is the final chunk in the utterance */
  isFinal: z.boolean(),
});

export type AudioChunkReceivedPayload = z.infer<typeof AudioChunkReceivedPayloadSchema>;

export const AudioChunkReceivedEventSchema = createEventSchema(
  EventTypes.AUDIO_CHUNK_RECEIVED,
  AudioChunkReceivedPayloadSchema
);

export type AudioChunkReceivedEvent = TypedEvent<
  typeof EventTypes.AUDIO_CHUNK_RECEIVED,
  AudioChunkReceivedPayload
>;

// ============================================================================
// stt.partial
// ============================================================================

export const SttPartialPayloadSchema = z.object({
  /** Partial transcript text */
  text: z.string(),
  /** Confidence score (0-1) */
  confidence: z.number().min(0).max(1).optional(),
  /** STT provider used */
  provider: z.string().min(1),
  /** Is this a stable partial (unlikely to change) */
  isStable: z.boolean(),
  /** Start time offset in milliseconds from turn start */
  startOffsetMs: z.number().int().nonnegative().optional(),
  /** End time offset in milliseconds from turn start */
  endOffsetMs: z.number().int().nonnegative().optional(),
});

export type SttPartialPayload = z.infer<typeof SttPartialPayloadSchema>;

export const SttPartialEventSchema = createEventSchema(
  EventTypes.STT_PARTIAL,
  SttPartialPayloadSchema
);

export type SttPartialEvent = TypedEvent<
  typeof EventTypes.STT_PARTIAL,
  SttPartialPayload
>;

// ============================================================================
// stt.final
// ============================================================================

export const SttFinalPayloadSchema = z.object({
  /** Final transcript text */
  text: z.string().min(1),
  /** Confidence score (0-1) */
  confidence: z.number().min(0).max(1),
  /** STT provider used */
  provider: z.string().min(1),
  /** Model used for transcription */
  model: z.string().min(1),
  /** Total audio duration in milliseconds */
  audioDurationMs: z.number().int().nonnegative(),
  /** Processing latency in milliseconds */
  processingLatencyMs: z.number().int().nonnegative(),
  /** Detected language code (ISO 639-1) */
  detectedLanguage: z.string().length(2).optional(),
  /** Word-level timestamps if available */
  words: z.array(z.object({
    word: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).optional(),
  })).optional(),
});

export type SttFinalPayload = z.infer<typeof SttFinalPayloadSchema>;

export const SttFinalEventSchema = createEventSchema(
  EventTypes.STT_FINAL,
  SttFinalPayloadSchema
);

export type SttFinalEvent = TypedEvent<
  typeof EventTypes.STT_FINAL,
  SttFinalPayload
>;
