import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// companion.created
// ============================================================================

export const CompanionCreatedPayloadSchema = z.object({
  /** Companion ID */
  companionId: z.string().min(1),
  /** Display name */
  name: z.string().min(1),
  /** Companion spec version */
  specVersion: z.string().min(1),
  /** Creation method */
  creationMethod: z.enum(['onboarding_flow', 'preset', 'import', 'api']),
  /** Preset used (if any) */
  presetId: z.string().optional(),
  /** ISO8601 timestamp of creation */
  createdAt: z.string().datetime({ offset: true }),
});

export type CompanionCreatedPayload = z.infer<typeof CompanionCreatedPayloadSchema>;

export const CompanionCreatedEventSchema = createEventSchema(
  EventTypes.COMPANION_CREATED,
  CompanionCreatedPayloadSchema
);

export type CompanionCreatedEvent = TypedEvent<
  typeof EventTypes.COMPANION_CREATED,
  CompanionCreatedPayload
>;

// ============================================================================
// companion.spec.updated
// ============================================================================

export const CompanionSpecUpdatedPayloadSchema = z.object({
  /** Companion ID */
  companionId: z.string().min(1),
  /** Previous spec version */
  previousSpecVersion: z.string().min(1),
  /** New spec version */
  newSpecVersion: z.string().min(1),
  /** Fields that changed */
  changedFields: z.array(z.string().min(1)).min(1),
  /** Update reason */
  reason: z.enum(['user_edit', 'onboarding_step', 'system_upgrade', 'import']),
  /** ISO8601 timestamp of update */
  updatedAt: z.string().datetime({ offset: true }),
});

export type CompanionSpecUpdatedPayload = z.infer<typeof CompanionSpecUpdatedPayloadSchema>;

export const CompanionSpecUpdatedEventSchema = createEventSchema(
  EventTypes.COMPANION_SPEC_UPDATED,
  CompanionSpecUpdatedPayloadSchema
);

export type CompanionSpecUpdatedEvent = TypedEvent<
  typeof EventTypes.COMPANION_SPEC_UPDATED,
  CompanionSpecUpdatedPayload
>;

// ============================================================================
// voice.selected
// ============================================================================

export const VoiceSelectedPayloadSchema = z.object({
  /** Companion ID */
  companionId: z.string().min(1),
  /** Voice profile ID */
  voiceProfileId: z.string().min(1),
  /** Provider */
  provider: z.string().min(1),
  /** Provider voice ID */
  providerVoiceId: z.string().min(1),
  /** Voice name (human-readable) */
  voiceName: z.string().min(1),
  /** Previous voice profile ID (if changing) */
  previousVoiceProfileId: z.string().optional(),
  /** Selection method */
  selectionMethod: z.enum(['user_choice', 'preset', 'recommendation', 'random']),
  /** ISO8601 timestamp of selection */
  selectedAt: z.string().datetime({ offset: true }),
});

export type VoiceSelectedPayload = z.infer<typeof VoiceSelectedPayloadSchema>;

export const VoiceSelectedEventSchema = createEventSchema(
  EventTypes.VOICE_SELECTED,
  VoiceSelectedPayloadSchema
);

export type VoiceSelectedEvent = TypedEvent<
  typeof EventTypes.VOICE_SELECTED,
  VoiceSelectedPayload
>;

// ============================================================================
// policy.accepted
// ============================================================================

export const PolicyAcceptedPayloadSchema = z.object({
  /** Policy type */
  policyType: z.enum(['terms_of_service', 'privacy_policy', 'acceptable_use', 'companion_guidelines']),
  /** Policy version accepted */
  policyVersion: z.string().min(1),
  /** Policy document URL */
  policyUrl: z.string().url(),
  /** IP address at time of acceptance */
  ipAddress: z.string().optional(),
  /** User agent at time of acceptance */
  userAgent: z.string().optional(),
  /** ISO8601 timestamp of acceptance */
  acceptedAt: z.string().datetime({ offset: true }),
});

export type PolicyAcceptedPayload = z.infer<typeof PolicyAcceptedPayloadSchema>;

export const PolicyAcceptedEventSchema = createEventSchema(
  EventTypes.POLICY_ACCEPTED,
  PolicyAcceptedPayloadSchema
);

export type PolicyAcceptedEvent = TypedEvent<
  typeof EventTypes.POLICY_ACCEPTED,
  PolicyAcceptedPayload
>;

// ============================================================================
// memory.consent.updated
// ============================================================================

export const MemoryConsentUpdatedPayloadSchema = z.object({
  /** Companion ID */
  companionId: z.string().min(1),
  /** Previous consent settings */
  previousConsent: z.object({
    allowLongTermMemory: z.boolean(),
    allowKnowledgeGraph: z.boolean(),
    allowVaultExport: z.boolean(),
    retentionDays: z.number().int().positive().nullable(),
  }),
  /** New consent settings */
  newConsent: z.object({
    allowLongTermMemory: z.boolean(),
    allowKnowledgeGraph: z.boolean(),
    allowVaultExport: z.boolean(),
    retentionDays: z.number().int().positive().nullable(),
  }),
  /** ISO8601 timestamp of update */
  updatedAt: z.string().datetime({ offset: true }),
});

export type MemoryConsentUpdatedPayload = z.infer<typeof MemoryConsentUpdatedPayloadSchema>;

export const MemoryConsentUpdatedEventSchema = createEventSchema(
  EventTypes.MEMORY_CONSENT_UPDATED,
  MemoryConsentUpdatedPayloadSchema
);

export type MemoryConsentUpdatedEvent = TypedEvent<
  typeof EventTypes.MEMORY_CONSENT_UPDATED,
  MemoryConsentUpdatedPayload
>;
