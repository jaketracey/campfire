import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Projection type
 */
export const ProjectionTypeSchema = z.enum([
  'transcript',       // Conversation transcript
  'session_summary',  // Session summary
  'vault_note',       // Obsidian-style vault note
  'memory_index',     // Memory vector index
  'kg_update',        // Knowledge graph update
  'daily_note',       // Daily aggregation note
]);

export type ProjectionType = z.infer<typeof ProjectionTypeSchema>;

// ============================================================================
// projection.requested
// ============================================================================

export const ProjectionRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  projectionId: z.string().min(1),
  /** Type of projection */
  projectionType: ProjectionTypeSchema,
  /** Source event IDs that trigger this projection */
  sourceEventIds: z.array(z.string().min(1)).min(1),
  /** Priority (higher = more urgent) */
  priority: z.number().int().min(0).max(100),
  /** Whether this is a rebuild (not incremental) */
  isRebuild: z.boolean(),
});

export type ProjectionRequestedPayload = z.infer<typeof ProjectionRequestedPayloadSchema>;

export const ProjectionRequestedEventSchema = createEventSchema(
  EventTypes.PROJECTION_REQUESTED,
  ProjectionRequestedPayloadSchema
);

export type ProjectionRequestedEvent = TypedEvent<
  typeof EventTypes.PROJECTION_REQUESTED,
  ProjectionRequestedPayload
>;

// ============================================================================
// projection.completed
// ============================================================================

export const ProjectionCompletedPayloadSchema = z.object({
  /** Request ID for correlation */
  projectionId: z.string().min(1),
  /** Type of projection */
  projectionType: ProjectionTypeSchema,
  /** Artifacts produced */
  artifacts: z.array(z.object({
    type: z.string().min(1),
    id: z.string().min(1),
    storageKey: z.string().optional(),
  })),
  /** Processing duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** ISO8601 timestamp of completion */
  completedAt: z.string().datetime({ offset: true }),
});

export type ProjectionCompletedPayload = z.infer<typeof ProjectionCompletedPayloadSchema>;

export const ProjectionCompletedEventSchema = createEventSchema(
  EventTypes.PROJECTION_COMPLETED,
  ProjectionCompletedPayloadSchema
);

export type ProjectionCompletedEvent = TypedEvent<
  typeof EventTypes.PROJECTION_COMPLETED,
  ProjectionCompletedPayload
>;

// ============================================================================
// vault.render.requested
// ============================================================================

export const VaultRenderRequestedPayloadSchema = z.object({
  /** Render request ID */
  renderId: z.string().min(1),
  /** Target vault path */
  vaultPath: z.string().min(1),
  /** Template to use */
  template: z.string().min(1),
  /** Template version */
  templateVersion: z.string().min(1),
  /** Source event IDs */
  sourceEventIds: z.array(z.string().min(1)).min(1),
  /** Whether this is an update to existing note or new note */
  isUpdate: z.boolean(),
  /** Previous note version ID if update */
  previousVersionId: z.string().optional(),
});

export type VaultRenderRequestedPayload = z.infer<typeof VaultRenderRequestedPayloadSchema>;

export const VaultRenderRequestedEventSchema = createEventSchema(
  EventTypes.VAULT_RENDER_REQUESTED,
  VaultRenderRequestedPayloadSchema
);

export type VaultRenderRequestedEvent = TypedEvent<
  typeof EventTypes.VAULT_RENDER_REQUESTED,
  VaultRenderRequestedPayload
>;

// ============================================================================
// vault.render.completed
// ============================================================================

export const VaultRenderCompletedPayloadSchema = z.object({
  /** Render request ID */
  renderId: z.string().min(1),
  /** Note ID */
  noteId: z.string().min(1),
  /** Vault path */
  vaultPath: z.string().min(1),
  /** S3 storage key */
  storageKey: z.string().min(1),
  /** Note size in bytes */
  sizeBytes: z.number().int().nonnegative(),
  /** Wiki links in this note */
  wikiLinks: z.array(z.string()),
  /** Frontmatter extracted */
  frontmatter: z.record(z.unknown()),
  /** Processing duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** ISO8601 timestamp of completion */
  completedAt: z.string().datetime({ offset: true }),
});

export type VaultRenderCompletedPayload = z.infer<typeof VaultRenderCompletedPayloadSchema>;

export const VaultRenderCompletedEventSchema = createEventSchema(
  EventTypes.VAULT_RENDER_COMPLETED,
  VaultRenderCompletedPayloadSchema
);

export type VaultRenderCompletedEvent = TypedEvent<
  typeof EventTypes.VAULT_RENDER_COMPLETED,
  VaultRenderCompletedPayload
>;

// ============================================================================
// vault.render.failed
// ============================================================================

export const VaultRenderFailedPayloadSchema = z.object({
  /** Render request ID */
  renderId: z.string().min(1),
  /** Vault path attempted */
  vaultPath: z.string().min(1),
  /** Error code */
  errorCode: z.string().min(1),
  /** Error message */
  errorMessage: z.string().min(1),
  /** Whether this is retryable */
  retryable: z.boolean(),
  /** Attempt number */
  attemptNumber: z.number().int().nonnegative(),
  /** ISO8601 timestamp of failure */
  failedAt: z.string().datetime({ offset: true }),
});

export type VaultRenderFailedPayload = z.infer<typeof VaultRenderFailedPayloadSchema>;

export const VaultRenderFailedEventSchema = createEventSchema(
  EventTypes.VAULT_RENDER_FAILED,
  VaultRenderFailedPayloadSchema
);

export type VaultRenderFailedEvent = TypedEvent<
  typeof EventTypes.VAULT_RENDER_FAILED,
  VaultRenderFailedPayload
>;
