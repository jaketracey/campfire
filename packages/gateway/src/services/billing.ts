/**
 * Billing Service
 * Business logic for subscriptions, usage tracking, and Stripe integration.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  getBillingRepository,
  type SubscriptionWithUsage,
  type UsageRecord,
  type UsageLimitResult,
  type UsageAggregation,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { EventTypes } from '@campfire/shared';
import { logger } from '../observability/logger.js';
import type {
  SubscriptionStatus,
  SubscriptionPlan,
  BillingEvent,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateSubscriptionInputSchema = z.object({
  stripeCustomerId: z.string().min(1),
  stripeSubscriptionId: z.string().optional(),
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']).optional(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
  trialEnd: z.date().optional(),
});

export const UpdateSubscriptionInputSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']).optional(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const RecordUsageInputSchema = z.object({
  usageType: z.enum(['voice_minutes', 'messages', 'storage_mb', 'api_calls']),
  quantity: z.number().int().positive(),
  sourceSessionId: z.string().uuid().optional(),
  sourceEventId: z.string().uuid().optional(),
});

// ============================================================================
// Types
// ============================================================================

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInputSchema>;
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionInputSchema>;
export type RecordUsageInput = z.infer<typeof RecordUsageInputSchema>;

export interface PlanLimits {
  voiceMinutes: number | null; // null = unlimited
  messages: number | null;
  companions: number;
  storageMb: number;
  apiCallsPerMinute: number;
}

export interface SubscriptionInfo {
  subscription: SubscriptionWithUsage | null;
  plan: SubscriptionPlan;
  limits: PlanLimits;
  usage: {
    voiceMinutes: { used: number; limit: number | null; remaining: number };
    messages: { used: number; limit: number | null; remaining: number };
    companions: { used: number; limit: number; remaining: number };
  };
  isActive: boolean;
  daysUntilRenewal: number | null;
}

export interface InvoiceSummary {
  id: string;
  amount: number;
  currency: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
}

// ============================================================================
// Plan Configurations
// ============================================================================

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    voiceMinutes: 30,
    messages: 100,
    companions: 1,
    storageMb: 100,
    apiCallsPerMinute: 10,
  },
  starter: {
    voiceMinutes: 300,
    messages: 1000,
    companions: 3,
    storageMb: 1000,
    apiCallsPerMinute: 30,
  },
  pro: {
    voiceMinutes: 1000,
    messages: 5000,
    companions: 10,
    storageMb: 10000,
    apiCallsPerMinute: 100,
  },
  enterprise: {
    voiceMinutes: null, // Unlimited
    messages: null,
    companions: 100,
    storageMb: 100000,
    apiCallsPerMinute: 1000,
  },
};

// ============================================================================
// Service
// ============================================================================

export class BillingService {
  private billing = getBillingRepository();
  private events = getEventsService();

  /**
   * Get subscription info for a user
   */
  async getSubscriptionInfo(userId: string, tx?: TransactionContext): Promise<SubscriptionInfo> {
    const subscription = await this.billing.findSubscriptionByUserId(userId, tx);
    const plan = subscription?.plan ?? 'free';
    const limits = PLAN_LIMITS[plan];

    const isActive = subscription
      ? ['active', 'trialing'].includes(subscription.status)
      : false;

    let daysUntilRenewal: number | null = null;
    if (subscription?.current_period_end) {
      const now = new Date();
      const periodEnd = new Date(subscription.current_period_end);
      daysUntilRenewal = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Calculate usage
    const voiceMinutesUsed = subscription?.voiceMinutesUsed ?? 0;
    const messagesUsed = subscription?.messagesUsed ?? 0;

    // Get companion count (would need companion repository)
    const companionsUsed = 0; // Placeholder

    return {
      subscription,
      plan,
      limits,
      usage: {
        voiceMinutes: {
          used: voiceMinutesUsed,
          limit: limits.voiceMinutes,
          remaining: limits.voiceMinutes ? limits.voiceMinutes - voiceMinutesUsed : Infinity,
        },
        messages: {
          used: messagesUsed,
          limit: limits.messages,
          remaining: limits.messages ? limits.messages - messagesUsed : Infinity,
        },
        companions: {
          used: companionsUsed,
          limit: limits.companions,
          remaining: limits.companions - companionsUsed,
        },
      },
      isActive,
      daysUntilRenewal,
    };
  }

  /**
   * Check if user can perform an action based on usage limits
   */
  async checkUsageLimit(
    userId: string,
    usageType: 'voice_minutes' | 'messages' | 'companions',
    tx?: TransactionContext
  ): Promise<UsageLimitResult> {
    return this.billing.checkUsageLimit(userId, usageType, tx);
  }

  /**
   * Get user's current plan
   */
  async getUserPlan(userId: string, tx?: TransactionContext): Promise<SubscriptionPlan> {
    return this.billing.getUserPlan(userId, tx);
  }

  /**
   * Check if user has active subscription
   */
  async hasActiveSubscription(userId: string, tx?: TransactionContext): Promise<boolean> {
    return this.billing.hasActiveSubscription(userId, tx);
  }

  /**
   * Create or update subscription from Stripe webhook
   */
  async syncSubscription(
    userId: string,
    input: CreateSubscriptionInput,
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage> {
    const validated = CreateSubscriptionInputSchema.parse(input);

    // Check for existing subscription
    let subscription = await this.billing.findSubscriptionByUserId(userId, tx);

    const limits = PLAN_LIMITS[validated.plan];

    if (subscription) {
      // Update existing
      subscription = await this.billing.updateSubscription(subscription.id, {
        stripe_subscription_id: validated.stripeSubscriptionId,
        plan: validated.plan,
        status: validated.status,
        current_period_start: validated.periodStart,
        current_period_end: validated.periodEnd,
        trial_end: validated.trialEnd,
      }, tx);
    } else {
      // Create new
      subscription = await this.billing.createSubscription({
        user_id: userId,
        stripe_customer_id: validated.stripeCustomerId,
        stripe_subscription_id: validated.stripeSubscriptionId ?? '',
        plan: validated.plan,
        status: validated.status ?? 'active',
        current_period_start: validated.periodStart ?? new Date(),
        current_period_end: validated.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        trial_end: validated.trialEnd,
      }, tx);
    }

    // Update usage limits
    await this.billing.updateUsageLimits(subscription.id, {
      voiceMinutesLimit: limits.voiceMinutes,
      messageLimit: limits.messages,
      companionLimit: limits.companions,
    }, tx);

    logger.info({ userId, plan: validated.plan }, 'Subscription synced');
    return subscription;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    userId: string,
    options: { cancelAtPeriodEnd?: boolean; reason?: string } = {},
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage> {
    const subscription = await this.billing.findSubscriptionByUserId(userId, tx);
    if (!subscription) {
      throw new Error('No subscription found');
    }

    const updated = await this.billing.cancelSubscription(
      subscription.id,
      options,
      tx
    );

    // Emit billing event
    const context: EventContext = {
      userId,
      sessionId: 'billing',
      traceId: crypto.randomUUID(),
    };

    await this.events.emitBillingEvent(context, EventTypes.BILLING_SUBSCRIPTION_CANCELED, {
      subscriptionId: subscription.id,
      cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? true,
      reason: options.reason,
    });

    logger.info(
      { userId, subscriptionId: subscription.id, cancelAtPeriodEnd: options.cancelAtPeriodEnd },
      'Subscription canceled'
    );

    return updated;
  }

  /**
   * Record usage
   */
  async recordUsage(
    userId: string,
    input: RecordUsageInput,
    tx?: TransactionContext
  ): Promise<string> {
    const validated = RecordUsageInputSchema.parse(input);

    // Use the database function for atomic usage recording
    const recordId = await this.billing.recordUsageUsingFunction(
      userId,
      validated.usageType,
      validated.quantity,
      validated.sourceEventId,
      tx
    );

    logger.debug(
      { userId, usageType: validated.usageType, quantity: validated.quantity },
      'Usage recorded'
    );

    return recordId;
  }

  /**
   * Get usage aggregation for current period
   */
  async getCurrentPeriodUsage(
    userId: string,
    tx?: TransactionContext
  ): Promise<UsageAggregation[]> {
    const subscription = await this.billing.findSubscriptionByUserId(userId, tx);

    const periodStart = subscription?.current_period_start ?? new Date(new Date().setDate(1));
    const periodEnd = subscription?.current_period_end ?? new Date(new Date().setMonth(new Date().getMonth() + 1, 0));

    return this.billing.aggregateUsage(userId, periodStart, periodEnd, tx);
  }

  /**
   * Get usage history
   */
  async getUsageHistory(
    userId: string,
    options: { usageType?: string; limit?: number } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<UsageRecord>> {
    return this.billing.listUsageRecords(userId, options, tx);
  }

  /**
   * Process a Stripe webhook event
   */
  async processWebhookEvent(
    stripeEventId: string,
    eventType: string,
    payload: JSONObject,
    tx?: TransactionContext
  ): Promise<BillingEvent> {
    // Check if event already processed (idempotency)
    const existing = await this.billing.findBillingEventByStripeId(stripeEventId, tx);
    if (existing) {
      logger.debug({ stripeEventId }, 'Webhook event already processed');
      return existing;
    }

    // Create billing event record
    const billingEvent = await this.billing.createBillingEvent({
      stripe_event_id: stripeEventId,
      stripe_event_type: eventType,
      payload,
    }, tx);

    try {
      // Process based on event type
      await this.handleWebhookEvent(eventType, payload, tx);

      // Mark as processed
      await this.billing.markBillingEventProcessed(billingEvent.id, null, tx);

      logger.info({ stripeEventId, eventType }, 'Webhook event processed');
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.billing.markBillingEventProcessed(billingEvent.id, errorMessage, tx);

      logger.error({ stripeEventId, eventType, error: errorMessage }, 'Webhook event processing failed');
      throw error;
    }

    return billingEvent;
  }

  /**
   * Handle specific webhook event types
   */
  private async handleWebhookEvent(
    eventType: string,
    payload: JSONObject,
    tx?: TransactionContext
  ): Promise<void> {
    const data = payload.data as Record<string, unknown> | undefined;
    const object = data?.object as Record<string, unknown> | undefined;

    switch (eventType) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        // Extract subscription data and sync
        const customerId = object?.customer as string;
        const subscriptionId = object?.id as string;
        const status = object?.status as SubscriptionStatus;
        const planId = (object?.items as Record<string, unknown>)?.data as Array<Record<string, unknown>>;
        // ... additional processing
        break;
      }

      case 'customer.subscription.deleted': {
        // Handle subscription deletion
        break;
      }

      case 'invoice.paid': {
        // Reset usage counters for new period
        const customerId = object?.customer as string;
        // Find subscription by stripe customer and reset usage
        break;
      }

      case 'invoice.payment_failed': {
        // Handle payment failure
        const customerId = object?.customer as string;
        // Update subscription status
        break;
      }

      case 'checkout.session.completed': {
        // Handle successful checkout
        break;
      }

      default:
        logger.debug({ eventType }, 'Unhandled webhook event type');
    }
  }

  /**
   * Retry failed webhook events (background job)
   */
  async retryFailedEvents(tx?: TransactionContext): Promise<number> {
    const failedEvents = await this.billing.getFailedBillingEvents(10, tx);
    let successCount = 0;

    for (const event of failedEvents) {
      try {
        await this.handleWebhookEvent(event.stripe_event_type, event.payload, tx);
        await this.billing.markBillingEventProcessed(event.id, null, tx);
        successCount++;
      } catch (error) {
        // Update retry count
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.billing.markBillingEventProcessed(event.id, errorMessage, tx);
      }
    }

    if (successCount > 0) {
      logger.info({ successCount, totalAttempted: failedEvents.length }, 'Retried failed webhook events');
    }

    return successCount;
  }

  /**
   * Sync unsynced usage records to Stripe (background job)
   */
  async syncUsageToStripe(tx?: TransactionContext): Promise<number> {
    const unsyncedRecords = await this.billing.getUnsyncedUsageRecords(100, tx);
    let syncedCount = 0;

    for (const record of unsyncedRecords) {
      try {
        // In production, this would call Stripe's usage record API
        // const stripeUsageRecordId = await stripe.subscriptionItems.createUsageRecord(...)
        const stripeUsageRecordId = `sur_${nanoid()}`; // Placeholder

        await this.billing.markUsageSynced(record.id, stripeUsageRecordId, tx);
        syncedCount++;
      } catch (error) {
        logger.error(
          { recordId: record.id, error: error instanceof Error ? error.message : 'Unknown' },
          'Failed to sync usage to Stripe'
        );
      }
    }

    if (syncedCount > 0) {
      logger.info({ syncedCount }, 'Synced usage records to Stripe');
    }

    return syncedCount;
  }

  /**
   * Get plan limits for a specific plan
   */
  getPlanLimits(plan: SubscriptionPlan): PlanLimits {
    return PLAN_LIMITS[plan];
  }

  /**
   * Get all available plans
   */
  getAvailablePlans(): Array<{ plan: SubscriptionPlan; limits: PlanLimits }> {
    return Object.entries(PLAN_LIMITS).map(([plan, limits]) => ({
      plan: plan as SubscriptionPlan,
      limits,
    }));
  }

  /**
   * Get event context for billing operations
   */
  getEventContext(userId: string): EventContext {
    return this.events.createContextFromRequest(userId, 'billing');
  }
}

// Singleton instance
let billingService: BillingService | null = null;

export function getBillingService(): BillingService {
  if (!billingService) {
    billingService = new BillingService();
  }
  return billingService;
}
