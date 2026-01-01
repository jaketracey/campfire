import { z } from 'zod';

/**
 * Relationship stage
 */
export const RelationshipStageSchema = z.enum([
  'introduction',     // Just met, formal
  'acquaintance',     // Getting to know each other
  'friendly',         // Comfortable, casual
  'close',            // Close friends, intimate conversations ok
  'devoted',          // Deep connection, high trust
]);

export type RelationshipStage = z.infer<typeof RelationshipStageSchema>;

/**
 * Topic sensitivity level
 */
export const TopicSensitivitySchema = z.enum([
  'open',             // Can discuss freely
  'cautious',         // Approach with care
  'restricted',       // Only with explicit consent
  'blocked',          // Never discuss
]);

export type TopicSensitivity = z.infer<typeof TopicSensitivitySchema>;

/**
 * Topic boundary configuration
 */
export const TopicBoundarySchema = z.object({
  /** Topic category */
  topic: z.string().min(1),
  /** Sensitivity level */
  sensitivity: TopicSensitivitySchema,
  /** Minimum relationship stage to discuss */
  minRelationshipStage: RelationshipStageSchema.optional(),
  /** Custom handling notes */
  handlingNotes: z.string().max(500).optional(),
});

export type TopicBoundary = z.infer<typeof TopicBoundarySchema>;

/**
 * Relationship pacing configuration
 */
export const RelationshipPacingSchema = z.object({
  /** Current relationship stage */
  currentStage: RelationshipStageSchema,
  /** Minimum interactions before stage advancement */
  interactionsPerStage: z.number().int().positive().default(10),
  /** Whether user can manually advance stages */
  allowManualAdvancement: z.boolean().default(false),
  /** Maximum stage reachable */
  maxStage: RelationshipStageSchema.default('devoted'),
  /** Whether relationship can regress */
  allowRegression: z.boolean().default(false),
});

export type RelationshipPacing = z.infer<typeof RelationshipPacingSchema>;

/**
 * Emotional support boundaries
 */
export const EmotionalSupportBoundarySchema = z.object({
  /** Allow crisis support conversations */
  allowCrisisSupport: z.boolean(),
  /** Crisis resource messaging */
  crisisResourceMessage: z.string().optional(),
  /** Depth of emotional support */
  supportDepth: z.enum(['surface', 'moderate', 'deep']),
  /** Whether to encourage professional help */
  encourageProfessionalHelp: z.boolean().default(true),
});

export type EmotionalSupportBoundary = z.infer<typeof EmotionalSupportBoundarySchema>;

/**
 * Complete boundaries and relationship pacing configuration
 * Section 7.1 of plan.md: boundaries + relationship pacing
 */
export const CompanionBoundariesSchema = z.object({
  /** Relationship pacing settings */
  relationshipPacing: RelationshipPacingSchema,
  /** Topic-specific boundaries */
  topicBoundaries: z.array(TopicBoundarySchema).max(50),
  /** Emotional support boundaries */
  emotionalSupport: EmotionalSupportBoundarySchema,
  /** Hard limits (never cross) */
  hardLimits: z.array(z.string().min(1)).max(20),
  /** Soft limits (approach with care) */
  softLimits: z.array(z.string().min(1)).max(20),
  /** User-defined custom boundaries */
  customBoundaries: z.array(z.object({
    description: z.string().min(1).max(200),
    enforcement: z.enum(['hard', 'soft', 'advisory']),
  })).max(10).optional(),
});

export type CompanionBoundaries = z.infer<typeof CompanionBoundariesSchema>;
