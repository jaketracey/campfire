import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Knowledge graph edge status
 */
export const KgEdgeStatusSchema = z.enum(['proposed', 'active', 'deprecated']);
export type KgEdgeStatus = z.infer<typeof KgEdgeStatusSchema>;

/**
 * Entity in the knowledge graph
 */
export const KgEntitySchema = z.object({
  /** Entity ID */
  id: z.string().min(1),
  /** Entity type (e.g., 'person', 'place', 'organization', 'concept') */
  type: z.string().min(1),
  /** Entity name/label */
  name: z.string().min(1),
  /** Alternative names/aliases */
  aliases: z.array(z.string()).optional(),
  /** Entity attributes */
  attributes: z.record(z.unknown()).optional(),
});

export type KgEntity = z.infer<typeof KgEntitySchema>;

/**
 * Edge/relationship in the knowledge graph
 */
export const KgEdgeSchema = z.object({
  /** Edge ID */
  id: z.string().min(1),
  /** Source entity ID */
  sourceEntityId: z.string().min(1),
  /** Target entity ID */
  targetEntityId: z.string().min(1),
  /** Relationship type (e.g., 'works_at', 'friend_of', 'located_in') */
  relationshipType: z.string().min(1),
  /** Edge status */
  status: KgEdgeStatusSchema,
  /** Confidence in this edge (0-1) */
  confidence: z.number().min(0).max(1),
  /** Source event ID for provenance */
  sourceEventId: z.string().min(1),
  /** ISO8601 timestamp when first seen */
  firstSeen: z.string().datetime({ offset: true }),
  /** ISO8601 timestamp when last seen */
  lastSeen: z.string().datetime({ offset: true }),
  /** ISO8601 timestamp when last confirmed */
  lastConfirmed: z.string().datetime({ offset: true }).optional(),
  /** Additional edge properties */
  properties: z.record(z.unknown()).optional(),
});

export type KgEdge = z.infer<typeof KgEdgeSchema>;

// ============================================================================
// kg.edge.proposed
// ============================================================================

export const KgEdgeProposedPayloadSchema = z.object({
  /** Proposed edge */
  edge: KgEdgeSchema,
  /** Source entity (may be new) */
  sourceEntity: KgEntitySchema,
  /** Target entity (may be new) */
  targetEntity: KgEntitySchema,
  /** Extraction method used */
  extractionMethod: z.string().min(1),
  /** Raw text that led to this extraction */
  sourceText: z.string().min(1),
});

export type KgEdgeProposedPayload = z.infer<typeof KgEdgeProposedPayloadSchema>;

export const KgEdgeProposedEventSchema = createEventSchema(
  EventTypes.KG_EDGE_PROPOSED,
  KgEdgeProposedPayloadSchema
);

export type KgEdgeProposedEvent = TypedEvent<
  typeof EventTypes.KG_EDGE_PROPOSED,
  KgEdgeProposedPayload
>;

// ============================================================================
// kg.edge.added
// ============================================================================

export const KgEdgeAddedPayloadSchema = z.object({
  /** Edge that was added */
  edge: KgEdgeSchema,
  /** Source entity */
  sourceEntity: KgEntitySchema,
  /** Target entity */
  targetEntity: KgEntitySchema,
  /** Whether this merged with an existing edge */
  mergedWithEdgeId: z.string().optional(),
  /** Whether source entity was created or existing */
  sourceEntityCreated: z.boolean(),
  /** Whether target entity was created or existing */
  targetEntityCreated: z.boolean(),
});

export type KgEdgeAddedPayload = z.infer<typeof KgEdgeAddedPayloadSchema>;

export const KgEdgeAddedEventSchema = createEventSchema(
  EventTypes.KG_EDGE_ADDED,
  KgEdgeAddedPayloadSchema
);

export type KgEdgeAddedEvent = TypedEvent<
  typeof EventTypes.KG_EDGE_ADDED,
  KgEdgeAddedPayload
>;

// ============================================================================
// kg.edge.removed
// ============================================================================

export const KgEdgeRemovedPayloadSchema = z.object({
  /** Edge ID that was removed */
  edgeId: z.string().min(1),
  /** Reason for removal */
  reason: z.enum(['user_request', 'contradiction', 'memory_deleted', 'expired', 'policy_violation']),
  /** ISO8601 timestamp of removal */
  removedAt: z.string().datetime({ offset: true }),
  /** Associated memory ID if removed due to memory deletion */
  associatedMemoryId: z.string().optional(),
});

export type KgEdgeRemovedPayload = z.infer<typeof KgEdgeRemovedPayloadSchema>;

export const KgEdgeRemovedEventSchema = createEventSchema(
  EventTypes.KG_EDGE_REMOVED,
  KgEdgeRemovedPayloadSchema
);

export type KgEdgeRemovedEvent = TypedEvent<
  typeof EventTypes.KG_EDGE_REMOVED,
  KgEdgeRemovedPayload
>;
