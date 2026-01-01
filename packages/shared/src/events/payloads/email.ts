import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Email type category
 */
export const EmailTypeSchema = z.enum(['transactional', 'notification', 'marketing']);
export type EmailType = z.infer<typeof EmailTypeSchema>;

/**
 * Email priority
 */
export const EmailPrioritySchema = z.enum(['high', 'normal', 'low']);
export type EmailPriority = z.infer<typeof EmailPrioritySchema>;

/**
 * Bounce type from SES
 */
export const BounceTypeSchema = z.enum(['Permanent', 'Transient', 'Undetermined']);
export type BounceType = z.infer<typeof BounceTypeSchema>;

/**
 * Unsubscribe type
 */
export const UnsubscribeTypeSchema = z.enum(['transactional', 'notification', 'marketing', 'all']);
export type UnsubscribeType = z.infer<typeof UnsubscribeTypeSchema>;

/**
 * Unsubscribe source
 */
export const UnsubscribeSourceSchema = z.enum(['link', 'preferences', 'complaint', 'admin']);
export type UnsubscribeSource = z.infer<typeof UnsubscribeSourceSchema>;

/**
 * Digest frequency
 */
export const DigestFrequencySchema = z.enum(['daily', 'weekly', 'never']);
export type DigestFrequency = z.infer<typeof DigestFrequencySchema>;

// ============================================================================
// email.queued
// ============================================================================

export const EmailQueuedPayloadSchema = z.object({
  /** Unique job ID for this email */
  jobId: z.string().min(1),
  /** Email type category */
  emailType: EmailTypeSchema,
  /** Template name used */
  templateName: z.string().min(1),
  /** Recipient email address */
  recipientEmail: z.string().email(),
  /** Recipient user ID (if known) */
  recipientUserId: z.string().optional(),
  /** Campaign ID for marketing emails */
  campaignId: z.string().optional(),
  /** Priority level */
  priority: EmailPrioritySchema,
  /** When email was queued */
  queuedAt: z.string().datetime({ offset: true }),
});

export type EmailQueuedPayload = z.infer<typeof EmailQueuedPayloadSchema>;

export const EmailQueuedEventSchema = createEventSchema(
  EventTypes.EMAIL_QUEUED,
  EmailQueuedPayloadSchema
);

export type EmailQueuedEvent = TypedEvent<typeof EventTypes.EMAIL_QUEUED, EmailQueuedPayload>;

// ============================================================================
// email.sent
// ============================================================================

export const EmailSentPayloadSchema = z.object({
  /** Job ID from queue */
  jobId: z.string().min(1),
  /** SES message ID */
  sesMessageId: z.string().min(1),
  /** Template name used */
  templateName: z.string().min(1),
  /** Recipient email address */
  recipientEmail: z.string().email(),
  /** Recipient user ID (if known) */
  recipientUserId: z.string().optional(),
  /** When email was sent */
  sentAt: z.string().datetime({ offset: true }),
  /** Time from queue to send in ms */
  deliveryTimeMs: z.number().int().nonnegative(),
});

export type EmailSentPayload = z.infer<typeof EmailSentPayloadSchema>;

export const EmailSentEventSchema = createEventSchema(
  EventTypes.EMAIL_SENT,
  EmailSentPayloadSchema
);

export type EmailSentEvent = TypedEvent<typeof EventTypes.EMAIL_SENT, EmailSentPayload>;

// ============================================================================
// email.failed
// ============================================================================

export const EmailFailedPayloadSchema = z.object({
  /** Job ID from queue */
  jobId: z.string().min(1),
  /** Template name used */
  templateName: z.string().min(1),
  /** Recipient email address */
  recipientEmail: z.string().email(),
  /** Error message */
  error: z.string().min(1),
  /** Error code if available */
  errorCode: z.string().optional(),
  /** Attempt number */
  attemptNumber: z.number().int().positive(),
  /** Whether retry is scheduled */
  willRetry: z.boolean(),
  /** When failure occurred */
  failedAt: z.string().datetime({ offset: true }),
});

export type EmailFailedPayload = z.infer<typeof EmailFailedPayloadSchema>;

export const EmailFailedEventSchema = createEventSchema(
  EventTypes.EMAIL_FAILED,
  EmailFailedPayloadSchema
);

export type EmailFailedEvent = TypedEvent<typeof EventTypes.EMAIL_FAILED, EmailFailedPayload>;

// ============================================================================
// email.bounced
// ============================================================================

export const EmailBouncedPayloadSchema = z.object({
  /** SES message ID */
  sesMessageId: z.string().min(1),
  /** Bounce type */
  bounceType: BounceTypeSchema,
  /** Bounce sub-type */
  bounceSubType: z.string().min(1),
  /** Bounced recipient email */
  recipientEmail: z.string().email(),
  /** Diagnostic code if available */
  diagnosticCode: z.string().optional(),
  /** Whether email was suppressed */
  suppressed: z.boolean(),
  /** When bounce occurred */
  bouncedAt: z.string().datetime({ offset: true }),
});

export type EmailBouncedPayload = z.infer<typeof EmailBouncedPayloadSchema>;

export const EmailBouncedEventSchema = createEventSchema(
  EventTypes.EMAIL_BOUNCED,
  EmailBouncedPayloadSchema
);

export type EmailBouncedEvent = TypedEvent<typeof EventTypes.EMAIL_BOUNCED, EmailBouncedPayload>;

// ============================================================================
// email.complained
// ============================================================================

export const EmailComplainedPayloadSchema = z.object({
  /** SES message ID */
  sesMessageId: z.string().min(1),
  /** Complainant email */
  recipientEmail: z.string().email(),
  /** Complaint feedback type */
  feedbackType: z.string().optional(),
  /** User was suppressed from future emails */
  suppressed: z.boolean(),
  /** When complaint was received */
  complainedAt: z.string().datetime({ offset: true }),
});

export type EmailComplainedPayload = z.infer<typeof EmailComplainedPayloadSchema>;

export const EmailComplainedEventSchema = createEventSchema(
  EventTypes.EMAIL_COMPLAINED,
  EmailComplainedPayloadSchema
);

export type EmailComplainedEvent = TypedEvent<
  typeof EventTypes.EMAIL_COMPLAINED,
  EmailComplainedPayload
>;

// ============================================================================
// email.opened
// ============================================================================

export const EmailOpenedPayloadSchema = z.object({
  /** SES message ID */
  sesMessageId: z.string().min(1),
  /** Recipient email */
  recipientEmail: z.string().email(),
  /** User agent of opener */
  userAgent: z.string().optional(),
  /** IP address of opener */
  ipAddress: z.string().optional(),
  /** When email was opened */
  openedAt: z.string().datetime({ offset: true }),
});

export type EmailOpenedPayload = z.infer<typeof EmailOpenedPayloadSchema>;

export const EmailOpenedEventSchema = createEventSchema(
  EventTypes.EMAIL_OPENED,
  EmailOpenedPayloadSchema
);

export type EmailOpenedEvent = TypedEvent<typeof EventTypes.EMAIL_OPENED, EmailOpenedPayload>;

// ============================================================================
// email.clicked
// ============================================================================

export const EmailClickedPayloadSchema = z.object({
  /** SES message ID */
  sesMessageId: z.string().min(1),
  /** Recipient email */
  recipientEmail: z.string().email(),
  /** Link that was clicked */
  link: z.string().url(),
  /** Link tag/name if set */
  linkTag: z.string().optional(),
  /** When link was clicked */
  clickedAt: z.string().datetime({ offset: true }),
});

export type EmailClickedPayload = z.infer<typeof EmailClickedPayloadSchema>;

export const EmailClickedEventSchema = createEventSchema(
  EventTypes.EMAIL_CLICKED,
  EmailClickedPayloadSchema
);

export type EmailClickedEvent = TypedEvent<typeof EventTypes.EMAIL_CLICKED, EmailClickedPayload>;

// ============================================================================
// email.unsubscribed
// ============================================================================

export const EmailUnsubscribedPayloadSchema = z.object({
  /** User ID if known */
  userId: z.string().optional(),
  /** Email address */
  email: z.string().email(),
  /** What type of emails were unsubscribed from */
  unsubscribeType: UnsubscribeTypeSchema,
  /** Source of unsubscribe (link, preferences, complaint) */
  source: UnsubscribeSourceSchema,
  /** When unsubscribed */
  unsubscribedAt: z.string().datetime({ offset: true }),
});

export type EmailUnsubscribedPayload = z.infer<typeof EmailUnsubscribedPayloadSchema>;

export const EmailUnsubscribedEventSchema = createEventSchema(
  EventTypes.EMAIL_UNSUBSCRIBED,
  EmailUnsubscribedPayloadSchema
);

export type EmailUnsubscribedEvent = TypedEvent<
  typeof EventTypes.EMAIL_UNSUBSCRIBED,
  EmailUnsubscribedPayload
>;

// ============================================================================
// email.preferences.updated
// ============================================================================

export const EmailPreferencesSchema = z.object({
  transactional: z.boolean(),
  notification: z.boolean(),
  marketing: z.boolean(),
  digest: DigestFrequencySchema,
});

export type EmailPreferences = z.infer<typeof EmailPreferencesSchema>;

export const EmailPreferencesUpdatedPayloadSchema = z.object({
  /** User ID */
  userId: z.string().min(1),
  /** Previous preferences */
  previousPreferences: EmailPreferencesSchema,
  /** New preferences */
  newPreferences: EmailPreferencesSchema,
  /** Source of update */
  source: z.enum(['user', 'admin', 'system']),
  /** When updated */
  updatedAt: z.string().datetime({ offset: true }),
});

export type EmailPreferencesUpdatedPayload = z.infer<typeof EmailPreferencesUpdatedPayloadSchema>;

export const EmailPreferencesUpdatedEventSchema = createEventSchema(
  EventTypes.EMAIL_PREFERENCES_UPDATED,
  EmailPreferencesUpdatedPayloadSchema
);

export type EmailPreferencesUpdatedEvent = TypedEvent<
  typeof EventTypes.EMAIL_PREFERENCES_UPDATED,
  EmailPreferencesUpdatedPayload
>;
