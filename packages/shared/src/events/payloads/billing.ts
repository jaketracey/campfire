import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Subscription tier
 */
export const SubscriptionTierSchema = z.enum(['free', 'starter', 'pro', 'enterprise']);
export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;

/**
 * Subscription status
 */
export const SubscriptionStatusSchema = z.enum([
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'trialing',
  'incomplete',
  'incomplete_expired',
  'paused',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

// ============================================================================
// billing.webhook.received
// ============================================================================

export const BillingWebhookReceivedPayloadSchema = z.object({
  /** Webhook ID from Stripe */
  webhookId: z.string().min(1),
  /** Stripe event type */
  stripeEventType: z.string().min(1),
  /** Stripe event ID */
  stripeEventId: z.string().min(1),
  /** Whether this is a duplicate (already processed) */
  isDuplicate: z.boolean(),
  /** ISO8601 timestamp of receipt */
  receivedAt: z.string().datetime({ offset: true }),
});

export type BillingWebhookReceivedPayload = z.infer<typeof BillingWebhookReceivedPayloadSchema>;

export const BillingWebhookReceivedEventSchema = createEventSchema(
  EventTypes.BILLING_WEBHOOK_RECEIVED,
  BillingWebhookReceivedPayloadSchema
);

export type BillingWebhookReceivedEvent = TypedEvent<
  typeof EventTypes.BILLING_WEBHOOK_RECEIVED,
  BillingWebhookReceivedPayload
>;

// ============================================================================
// billing.checkout.completed
// ============================================================================

export const BillingCheckoutCompletedPayloadSchema = z.object({
  /** Checkout session ID from Stripe */
  checkoutSessionId: z.string().min(1),
  /** Stripe customer ID */
  stripeCustomerId: z.string().min(1),
  /** Stripe subscription ID */
  stripeSubscriptionId: z.string().min(1),
  /** Tier purchased */
  tier: SubscriptionTierSchema,
  /** Amount in cents */
  amountCents: z.number().int().nonnegative(),
  /** Currency */
  currency: z.string().length(3),
  /** Billing interval */
  interval: z.enum(['month', 'year']),
  /** ISO8601 timestamp of completion */
  completedAt: z.string().datetime({ offset: true }),
});

export type BillingCheckoutCompletedPayload = z.infer<typeof BillingCheckoutCompletedPayloadSchema>;

export const BillingCheckoutCompletedEventSchema = createEventSchema(
  EventTypes.BILLING_CHECKOUT_COMPLETED,
  BillingCheckoutCompletedPayloadSchema
);

export type BillingCheckoutCompletedEvent = TypedEvent<
  typeof EventTypes.BILLING_CHECKOUT_COMPLETED,
  BillingCheckoutCompletedPayload
>;

// ============================================================================
// billing.invoice.paid
// ============================================================================

export const BillingInvoicePaidPayloadSchema = z.object({
  /** Stripe invoice ID */
  stripeInvoiceId: z.string().min(1),
  /** Stripe subscription ID */
  stripeSubscriptionId: z.string().min(1),
  /** Amount paid in cents */
  amountCents: z.number().int().nonnegative(),
  /** Currency */
  currency: z.string().length(3),
  /** Invoice period start */
  periodStart: z.string().datetime({ offset: true }),
  /** Invoice period end */
  periodEnd: z.string().datetime({ offset: true }),
  /** Invoice PDF URL */
  invoicePdfUrl: z.string().url().optional(),
  /** ISO8601 timestamp of payment */
  paidAt: z.string().datetime({ offset: true }),
});

export type BillingInvoicePaidPayload = z.infer<typeof BillingInvoicePaidPayloadSchema>;

export const BillingInvoicePaidEventSchema = createEventSchema(
  EventTypes.BILLING_INVOICE_PAID,
  BillingInvoicePaidPayloadSchema
);

export type BillingInvoicePaidEvent = TypedEvent<
  typeof EventTypes.BILLING_INVOICE_PAID,
  BillingInvoicePaidPayload
>;

// ============================================================================
// billing.payment_failed
// ============================================================================

export const BillingPaymentFailedPayloadSchema = z.object({
  /** Stripe invoice ID */
  stripeInvoiceId: z.string().min(1),
  /** Stripe subscription ID */
  stripeSubscriptionId: z.string().min(1),
  /** Amount attempted in cents */
  amountCents: z.number().int().nonnegative(),
  /** Currency */
  currency: z.string().length(3),
  /** Failure reason */
  failureReason: z.string().min(1),
  /** Failure code */
  failureCode: z.string().optional(),
  /** Attempt number */
  attemptNumber: z.number().int().positive(),
  /** Next retry date (if applicable) */
  nextRetryAt: z.string().datetime({ offset: true }).optional(),
  /** ISO8601 timestamp of failure */
  failedAt: z.string().datetime({ offset: true }),
});

export type BillingPaymentFailedPayload = z.infer<typeof BillingPaymentFailedPayloadSchema>;

export const BillingPaymentFailedEventSchema = createEventSchema(
  EventTypes.BILLING_PAYMENT_FAILED,
  BillingPaymentFailedPayloadSchema
);

export type BillingPaymentFailedEvent = TypedEvent<
  typeof EventTypes.BILLING_PAYMENT_FAILED,
  BillingPaymentFailedPayload
>;

// ============================================================================
// billing.subscription.updated
// ============================================================================

export const BillingSubscriptionUpdatedPayloadSchema = z.object({
  /** Stripe subscription ID */
  stripeSubscriptionId: z.string().min(1),
  /** Previous tier */
  previousTier: SubscriptionTierSchema.optional(),
  /** New tier */
  newTier: SubscriptionTierSchema,
  /** Previous status */
  previousStatus: SubscriptionStatusSchema.optional(),
  /** New status */
  newStatus: SubscriptionStatusSchema,
  /** Update reason */
  reason: z.enum(['upgrade', 'downgrade', 'renewal', 'trial_end', 'payment_success', 'admin_action']),
  /** Current period end */
  currentPeriodEnd: z.string().datetime({ offset: true }),
  /** ISO8601 timestamp of update */
  updatedAt: z.string().datetime({ offset: true }),
});

export type BillingSubscriptionUpdatedPayload = z.infer<typeof BillingSubscriptionUpdatedPayloadSchema>;

export const BillingSubscriptionUpdatedEventSchema = createEventSchema(
  EventTypes.BILLING_SUBSCRIPTION_UPDATED,
  BillingSubscriptionUpdatedPayloadSchema
);

export type BillingSubscriptionUpdatedEvent = TypedEvent<
  typeof EventTypes.BILLING_SUBSCRIPTION_UPDATED,
  BillingSubscriptionUpdatedPayload
>;

// ============================================================================
// billing.subscription.canceled
// ============================================================================

export const BillingSubscriptionCanceledPayloadSchema = z.object({
  /** Stripe subscription ID */
  stripeSubscriptionId: z.string().min(1),
  /** Previous tier */
  previousTier: SubscriptionTierSchema,
  /** Cancellation reason (if provided) */
  cancellationReason: z.string().optional(),
  /** Cancellation feedback (if provided) */
  cancellationFeedback: z.string().optional(),
  /** Whether canceled immediately or at period end */
  canceledImmediately: z.boolean(),
  /** When access ends */
  accessEndsAt: z.string().datetime({ offset: true }),
  /** ISO8601 timestamp of cancellation */
  canceledAt: z.string().datetime({ offset: true }),
});

export type BillingSubscriptionCanceledPayload = z.infer<typeof BillingSubscriptionCanceledPayloadSchema>;

export const BillingSubscriptionCanceledEventSchema = createEventSchema(
  EventTypes.BILLING_SUBSCRIPTION_CANCELED,
  BillingSubscriptionCanceledPayloadSchema
);

export type BillingSubscriptionCanceledEvent = TypedEvent<
  typeof EventTypes.BILLING_SUBSCRIPTION_CANCELED,
  BillingSubscriptionCanceledPayload
>;
