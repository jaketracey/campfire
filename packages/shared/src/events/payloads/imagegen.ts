import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';
import { ImageGenParamsSchema } from './avatar.js';

/**
 * Image generation purpose
 */
export const ImageGenPurposeSchema = z.enum([
  'scene',          // Scene/activity image
  'reaction',       // Emotional reaction image
  'illustration',   // Illustrative content
  'gift',           // Gift/greeting image for user
  'memory',         // Memory visualization
]);

export type ImageGenPurpose = z.infer<typeof ImageGenPurposeSchema>;

// ============================================================================
// imagegen.requested
// ============================================================================

export const ImagegenRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Purpose of the image */
  purpose: ImageGenPurposeSchema,
  /** User prompt or context that triggered the request */
  userContext: z.string().min(1),
  /** Generation parameters */
  genParams: ImageGenParamsSchema,
  /** Whether this was explicitly requested by user */
  userRequested: z.boolean(),
});

export type ImagegenRequestedPayload = z.infer<typeof ImagegenRequestedPayloadSchema>;

export const ImagegenRequestedEventSchema = createEventSchema(
  EventTypes.IMAGEGEN_REQUESTED,
  ImagegenRequestedPayloadSchema
);

export type ImagegenRequestedEvent = TypedEvent<
  typeof EventTypes.IMAGEGEN_REQUESTED,
  ImagegenRequestedPayload
>;

// ============================================================================
// imagegen.generated
// ============================================================================

export const ImagegenGeneratedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Generated image ID */
  imageId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Purpose of the image */
  purpose: ImageGenPurposeSchema,
  /** S3 storage key */
  storageKey: z.string().min(1),
  /** Public URL */
  url: z.string().url(),
  /** Thumbnail URL */
  thumbnailUrl: z.string().url().optional(),
  /** Image format */
  format: z.enum(['png', 'jpg', 'webp']),
  /** Image dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** File size in bytes */
  sizeBytes: z.number().int().positive(),
  /** Generation parameters used */
  genParams: ImageGenParamsSchema,
  /** Provider used */
  provider: z.string().min(1),
  /** Model used */
  model: z.string().min(1),
  /** Generation latency in milliseconds */
  latencyMs: z.number().int().nonnegative(),
  /** ISO8601 timestamp of generation */
  generatedAt: z.string().datetime({ offset: true }),
});

export type ImagegenGeneratedPayload = z.infer<typeof ImagegenGeneratedPayloadSchema>;

export const ImagegenGeneratedEventSchema = createEventSchema(
  EventTypes.IMAGEGEN_GENERATED,
  ImagegenGeneratedPayloadSchema
);

export type ImagegenGeneratedEvent = TypedEvent<
  typeof EventTypes.IMAGEGEN_GENERATED,
  ImagegenGeneratedPayload
>;

// ============================================================================
// imagegen.blocked
// ============================================================================

export const ImagegenBlockedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Reason for blocking */
  reason: z.enum(['content_policy', 'rate_limit', 'provider_error', 'safety_filter']),
  /** Policy version that blocked this */
  policyVersion: z.string().min(1),
  /** Specific violation codes */
  violationCodes: z.array(z.string()).optional(),
  /** Human-readable explanation */
  explanation: z.string().min(1),
  /** ISO8601 timestamp of block */
  blockedAt: z.string().datetime({ offset: true }),
});

export type ImagegenBlockedPayload = z.infer<typeof ImagegenBlockedPayloadSchema>;

export const ImagegenBlockedEventSchema = createEventSchema(
  EventTypes.IMAGEGEN_BLOCKED,
  ImagegenBlockedPayloadSchema
);

export type ImagegenBlockedEvent = TypedEvent<
  typeof EventTypes.IMAGEGEN_BLOCKED,
  ImagegenBlockedPayload
>;
