import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Avatar asset type
 */
export const AvatarAssetTypeSchema = z.enum([
  'identity_anchor',   // Rarely changes, core visual identity
  'stateful_avatar',   // Updates based on mood/context
  'scene_image',       // On-demand scene/activity images
]);

export type AvatarAssetType = z.infer<typeof AvatarAssetTypeSchema>;

/**
 * Image generation parameters for reproducibility
 */
export const ImageGenParamsSchema = z.object({
  /** Prompt template version */
  promptTemplateVersion: z.string().min(1),
  /** Positive prompt used */
  positivePrompt: z.string().min(1),
  /** Negative prompt used */
  negativePrompt: z.string().optional(),
  /** Reference image IDs used */
  referenceImageIds: z.array(z.string()).optional(),
  /** Seed for reproducibility (if supported) */
  seed: z.number().int().optional(),
  /** Style preset used */
  stylePreset: z.string().optional(),
  /** Generation steps */
  steps: z.number().int().positive().optional(),
  /** Guidance scale / CFG */
  guidanceScale: z.number().positive().optional(),
  /** Image dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type ImageGenParams = z.infer<typeof ImageGenParamsSchema>;

// ============================================================================
// avatar.requested
// ============================================================================

export const AvatarRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Asset type being requested */
  assetType: AvatarAssetTypeSchema,
  /** Reason for the request */
  reason: z.enum(['onboarding', 'mood_change', 'context_change', 'user_request', 'scheduled']),
  /** Current mood/emotion tag */
  emotionTag: z.string().optional(),
  /** Context description */
  context: z.string().optional(),
  /** Generation parameters */
  genParams: ImageGenParamsSchema,
});

export type AvatarRequestedPayload = z.infer<typeof AvatarRequestedPayloadSchema>;

export const AvatarRequestedEventSchema = createEventSchema(
  EventTypes.AVATAR_REQUESTED,
  AvatarRequestedPayloadSchema
);

export type AvatarRequestedEvent = TypedEvent<
  typeof EventTypes.AVATAR_REQUESTED,
  AvatarRequestedPayload
>;

// ============================================================================
// avatar.generated
// ============================================================================

export const AvatarGeneratedPayloadSchema = z.object({
  /** Request ID for correlation */
  requestId: z.string().min(1),
  /** Generated asset ID */
  assetId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Asset type */
  assetType: AvatarAssetTypeSchema,
  /** S3 storage key */
  storageKey: z.string().min(1),
  /** Public URL */
  url: z.string().url(),
  /** Image format */
  format: z.enum(['png', 'jpg', 'webp']),
  /** Image dimensions */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** File size in bytes */
  sizeBytes: z.number().int().positive(),
  /** Generation parameters used (for reproducibility) */
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

export type AvatarGeneratedPayload = z.infer<typeof AvatarGeneratedPayloadSchema>;

export const AvatarGeneratedEventSchema = createEventSchema(
  EventTypes.AVATAR_GENERATED,
  AvatarGeneratedPayloadSchema
);

export type AvatarGeneratedEvent = TypedEvent<
  typeof EventTypes.AVATAR_GENERATED,
  AvatarGeneratedPayload
>;

// ============================================================================
// avatar.promoted
// ============================================================================

export const AvatarPromotedPayloadSchema = z.object({
  /** Asset ID being promoted */
  assetId: z.string().min(1),
  /** Companion ID */
  companionId: z.string().min(1),
  /** Previous active asset ID (if any) */
  previousAssetId: z.string().optional(),
  /** Promotion reason */
  reason: z.enum(['automated_check_passed', 'user_selection', 'onboarding_complete']),
  /** ISO8601 timestamp of promotion */
  promotedAt: z.string().datetime({ offset: true }),
});

export type AvatarPromotedPayload = z.infer<typeof AvatarPromotedPayloadSchema>;

export const AvatarPromotedEventSchema = createEventSchema(
  EventTypes.AVATAR_PROMOTED,
  AvatarPromotedPayloadSchema
);

export type AvatarPromotedEvent = TypedEvent<
  typeof EventTypes.AVATAR_PROMOTED,
  AvatarPromotedPayload
>;
