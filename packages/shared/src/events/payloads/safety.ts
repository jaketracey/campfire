import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Safety severity level
 */
export const SafetySeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type SafetySeverity = z.infer<typeof SafetySeveritySchema>;

/**
 * Safety category
 */
export const SafetyCategorySchema = z.enum([
  'harassment',
  'hate_speech',
  'violence',
  'sexual_content',
  'self_harm',
  'dangerous_content',
  'illegal_activity',
  'privacy_violation',
  'deception',
  'minors_safety',
  'custom_policy',
]);

export type SafetyCategory = z.infer<typeof SafetyCategorySchema>;

/**
 * Content direction (input from user or output from agent)
 */
export const ContentDirectionSchema = z.enum(['input', 'output']);
export type ContentDirection = z.infer<typeof ContentDirectionSchema>;

// ============================================================================
// safety.flagged
// ============================================================================

export const SafetyFlaggedPayloadSchema = z.object({
  /** Flag ID for correlation */
  flagId: z.string().min(1),
  /** Direction of content */
  direction: ContentDirectionSchema,
  /** Category of concern */
  category: SafetyCategorySchema,
  /** Severity level */
  severity: SafetySeveritySchema,
  /** Confidence score (0-1) */
  confidence: z.number().min(0).max(1),
  /** Policy version used */
  policyVersion: z.string().min(1),
  /** Classifier/model used */
  classifier: z.string().min(1),
  /** Specific reason codes */
  reasonCodes: z.array(z.string()),
  /** Content hash (not the content itself for privacy) */
  contentHash: z.string().min(1),
  /** ISO8601 timestamp of flag */
  flaggedAt: z.string().datetime({ offset: true }),
  /** Whether content was allowed to proceed */
  allowed: z.boolean(),
});

export type SafetyFlaggedPayload = z.infer<typeof SafetyFlaggedPayloadSchema>;

export const SafetyFlaggedEventSchema = createEventSchema(
  EventTypes.SAFETY_FLAGGED,
  SafetyFlaggedPayloadSchema
);

export type SafetyFlaggedEvent = TypedEvent<
  typeof EventTypes.SAFETY_FLAGGED,
  SafetyFlaggedPayload
>;

// ============================================================================
// safety.blocked
// ============================================================================

export const SafetyBlockedPayloadSchema = z.object({
  /** Block ID for correlation */
  blockId: z.string().min(1),
  /** Reference to safety.flagged event */
  flagEventId: z.string().min(1),
  /** Direction of content */
  direction: ContentDirectionSchema,
  /** Category of concern */
  category: SafetyCategorySchema,
  /** Severity level */
  severity: SafetySeveritySchema,
  /** Policy version used */
  policyVersion: z.string().min(1),
  /** Action taken */
  action: z.enum(['block_response', 'redirect', 'terminate_session', 'rate_limit']),
  /** Fallback response provided (if any) */
  fallbackResponseId: z.string().optional(),
  /** ISO8601 timestamp of block */
  blockedAt: z.string().datetime({ offset: true }),
});

export type SafetyBlockedPayload = z.infer<typeof SafetyBlockedPayloadSchema>;

export const SafetyBlockedEventSchema = createEventSchema(
  EventTypes.SAFETY_BLOCKED,
  SafetyBlockedPayloadSchema
);

export type SafetyBlockedEvent = TypedEvent<
  typeof EventTypes.SAFETY_BLOCKED,
  SafetyBlockedPayload
>;

// ============================================================================
// safety.escalated
// ============================================================================

export const SafetyEscalatedPayloadSchema = z.object({
  /** Escalation ID */
  escalationId: z.string().min(1),
  /** Reference to safety.flagged event */
  flagEventId: z.string().min(1),
  /** Reference to safety.blocked event (if blocked) */
  blockEventId: z.string().optional(),
  /** Escalation level */
  escalationLevel: z.enum(['review_queue', 'urgent_review', 'immediate_action', 'legal_compliance']),
  /** Reason for escalation */
  reason: z.string().min(1),
  /** Assigned to (team/role) */
  assignedTo: z.string().optional(),
  /** ISO8601 timestamp of escalation */
  escalatedAt: z.string().datetime({ offset: true }),
  /** Required response time in minutes */
  slaMinutes: z.number().int().positive().optional(),
});

export type SafetyEscalatedPayload = z.infer<typeof SafetyEscalatedPayloadSchema>;

export const SafetyEscalatedEventSchema = createEventSchema(
  EventTypes.SAFETY_ESCALATED,
  SafetyEscalatedPayloadSchema
);

export type SafetyEscalatedEvent = TypedEvent<
  typeof EventTypes.SAFETY_ESCALATED,
  SafetyEscalatedPayload
>;
