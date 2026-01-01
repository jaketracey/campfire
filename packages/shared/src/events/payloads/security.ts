import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

// ============================================================================
// security.mfa.required
// ============================================================================

export const SecurityMfaRequiredPayloadSchema = z.object({
  /** Requirement ID */
  requirementId: z.string().min(1),
  /** Reason MFA is required */
  reason: z.enum(['first_payment', 'premium_access', 'security_policy', 'admin_action', 'suspicious_activity']),
  /** Feature or action that triggered requirement */
  triggeredBy: z.string().min(1),
  /** Deadline to complete MFA setup */
  deadline: z.string().datetime({ offset: true }).optional(),
  /** ISO8601 timestamp of requirement */
  requiredAt: z.string().datetime({ offset: true }),
});

export type SecurityMfaRequiredPayload = z.infer<typeof SecurityMfaRequiredPayloadSchema>;

export const SecurityMfaRequiredEventSchema = createEventSchema(
  EventTypes.SECURITY_MFA_REQUIRED,
  SecurityMfaRequiredPayloadSchema
);

export type SecurityMfaRequiredEvent = TypedEvent<
  typeof EventTypes.SECURITY_MFA_REQUIRED,
  SecurityMfaRequiredPayload
>;

// ============================================================================
// security.mfa.enabled
// ============================================================================

export const SecurityMfaEnabledPayloadSchema = z.object({
  /** MFA method enabled */
  method: z.enum(['totp', 'sms', 'email', 'webauthn', 'passkey']),
  /** Requirement ID that was fulfilled (if any) */
  requirementId: z.string().optional(),
  /** Device info */
  deviceInfo: z.object({
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
    deviceName: z.string().optional(),
  }).optional(),
  /** ISO8601 timestamp of enablement */
  enabledAt: z.string().datetime({ offset: true }),
});

export type SecurityMfaEnabledPayload = z.infer<typeof SecurityMfaEnabledPayloadSchema>;

export const SecurityMfaEnabledEventSchema = createEventSchema(
  EventTypes.SECURITY_MFA_ENABLED,
  SecurityMfaEnabledPayloadSchema
);

export type SecurityMfaEnabledEvent = TypedEvent<
  typeof EventTypes.SECURITY_MFA_ENABLED,
  SecurityMfaEnabledPayload
>;
