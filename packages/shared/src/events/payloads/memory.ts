import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Memory type classification
 */
export const MemoryTypeSchema = z.enum([
  'fact',           // Concrete facts about the user
  'preference',     // User preferences
  'experience',     // Shared experiences
  'relationship',   // Relationship context
  'goal',           // User goals and aspirations
  'routine',        // Regular patterns/habits
  'emotional',      // Emotional states/patterns
]);

export type MemoryType = z.infer<typeof MemoryTypeSchema>;

/**
 * Memory importance level
 */
export const MemoryImportanceSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type MemoryImportance = z.infer<typeof MemoryImportanceSchema>;

// ============================================================================
// memory.proposed
// ============================================================================

export const MemoryProposedPayloadSchema = z.object({
  /** Proposed memory ID */
  memoryId: z.string().min(1),
  /** Memory content */
  content: z.string().min(1),
  /** Memory type */
  memoryType: MemoryTypeSchema,
  /** Importance level */
  importance: MemoryImportanceSchema,
  /** Confidence in this memory (0-1) */
  confidence: z.number().min(0).max(1),
  /** Source event IDs for provenance */
  sourceEventIds: z.array(z.string().min(1)).min(1),
  /** Keywords for retrieval */
  keywords: z.array(z.string()),
  /** Whether this updates an existing memory */
  updatesMemoryId: z.string().optional(),
});

export type MemoryProposedPayload = z.infer<typeof MemoryProposedPayloadSchema>;

export const MemoryProposedEventSchema = createEventSchema(
  EventTypes.MEMORY_PROPOSED,
  MemoryProposedPayloadSchema
);

export type MemoryProposedEvent = TypedEvent<
  typeof EventTypes.MEMORY_PROPOSED,
  MemoryProposedPayload
>;

// ============================================================================
// memory.written
// ============================================================================

export const MemoryWrittenPayloadSchema = z.object({
  /** Memory ID */
  memoryId: z.string().min(1),
  /** Memory content */
  content: z.string().min(1),
  /** Memory type */
  memoryType: MemoryTypeSchema,
  /** Importance level */
  importance: MemoryImportanceSchema,
  /** Confidence in this memory (0-1) */
  confidence: z.number().min(0).max(1),
  /** Source event IDs for provenance */
  sourceEventIds: z.array(z.string().min(1)).min(1),
  /** Keywords for retrieval */
  keywords: z.array(z.string()),
  /** Embedding vector ID */
  embeddingId: z.string().min(1),
  /** ISO8601 timestamp of write */
  writtenAt: z.string().datetime({ offset: true }),
  /** Previous memory ID if this is an update */
  previousMemoryId: z.string().optional(),
});

export type MemoryWrittenPayload = z.infer<typeof MemoryWrittenPayloadSchema>;

export const MemoryWrittenEventSchema = createEventSchema(
  EventTypes.MEMORY_WRITTEN,
  MemoryWrittenPayloadSchema
);

export type MemoryWrittenEvent = TypedEvent<
  typeof EventTypes.MEMORY_WRITTEN,
  MemoryWrittenPayload
>;

// ============================================================================
// memory.deleted
// ============================================================================

export const MemoryDeletedPayloadSchema = z.object({
  /** Memory ID being deleted */
  memoryId: z.string().min(1),
  /** Reason for deletion */
  reason: z.enum(['user_request', 'memory_update', 'policy_violation', 'data_export']),
  /** ISO8601 timestamp of deletion */
  deletedAt: z.string().datetime({ offset: true }),
  /** Downstream artifacts that need rebuilding */
  affectedArtifacts: z.array(z.object({
    type: z.enum(['vault_note', 'kg_edge', 'embedding', 'summary']),
    id: z.string().min(1),
  })),
});

export type MemoryDeletedPayload = z.infer<typeof MemoryDeletedPayloadSchema>;

export const MemoryDeletedEventSchema = createEventSchema(
  EventTypes.MEMORY_DELETED,
  MemoryDeletedPayloadSchema
);

export type MemoryDeletedEvent = TypedEvent<
  typeof EventTypes.MEMORY_DELETED,
  MemoryDeletedPayload
>;

// ============================================================================
// memory.retrieval.requested
// ============================================================================

export const MemoryRetrievalRequestedPayloadSchema = z.object({
  /** Request ID for correlation */
  retrievalId: z.string().min(1),
  /** Query text for retrieval */
  query: z.string().min(1),
  /** Maximum number of memories to retrieve */
  maxResults: z.number().int().positive(),
  /** Minimum similarity threshold (0-1) */
  minSimilarity: z.number().min(0).max(1).optional(),
  /** Filter by memory types */
  memoryTypes: z.array(MemoryTypeSchema).optional(),
  /** Filter by minimum importance */
  minImportance: MemoryImportanceSchema.optional(),
});

export type MemoryRetrievalRequestedPayload = z.infer<typeof MemoryRetrievalRequestedPayloadSchema>;

export const MemoryRetrievalRequestedEventSchema = createEventSchema(
  EventTypes.MEMORY_RETRIEVAL_REQUESTED,
  MemoryRetrievalRequestedPayloadSchema
);

export type MemoryRetrievalRequestedEvent = TypedEvent<
  typeof EventTypes.MEMORY_RETRIEVAL_REQUESTED,
  MemoryRetrievalRequestedPayload
>;

// ============================================================================
// memory.retrieval.completed
// ============================================================================

export const RetrievedMemorySchema = z.object({
  memoryId: z.string().min(1),
  content: z.string().min(1),
  memoryType: MemoryTypeSchema,
  importance: MemoryImportanceSchema,
  similarity: z.number().min(0).max(1),
  createdAt: z.string().datetime({ offset: true }),
});

export type RetrievedMemory = z.infer<typeof RetrievedMemorySchema>;

export const MemoryRetrievalCompletedPayloadSchema = z.object({
  /** Request ID for correlation */
  retrievalId: z.string().min(1),
  /** Retrieved memories */
  memories: z.array(RetrievedMemorySchema),
  /** Total memories searched */
  totalSearched: z.number().int().nonnegative(),
  /** Retrieval latency in milliseconds */
  latencyMs: z.number().int().nonnegative(),
});

export type MemoryRetrievalCompletedPayload = z.infer<typeof MemoryRetrievalCompletedPayloadSchema>;

export const MemoryRetrievalCompletedEventSchema = createEventSchema(
  EventTypes.MEMORY_RETRIEVAL_COMPLETED,
  MemoryRetrievalCompletedPayloadSchema
);

export type MemoryRetrievalCompletedEvent = TypedEvent<
  typeof EventTypes.MEMORY_RETRIEVAL_COMPLETED,
  MemoryRetrievalCompletedPayload
>;
