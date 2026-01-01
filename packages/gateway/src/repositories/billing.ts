/**
 * Billing Repository
 * Data access for subscriptions, billing_events, and usage_records tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  Subscription,
  SubscriptionInsert,
  SubscriptionStatus,
  SubscriptionPlan,
  BillingEvent,
  BillingEventInsert,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult, DateRangeFilter } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Subscription with usage limits (matches DB schema)
 */
export interface SubscriptionWithUsage extends Subscription {
  voiceMinutesLimit: number | null;
  voiceMinutesUsed: number;
  messageLimit: number | null;
  messagesUsed: number;
  companionLimit: number;
  stripePriceId: string | null;
  cancelReason: string | null;
}

/**
 * Usage record entity
 */
export interface UsageRecord {
  id: string;
  userId: string;
  subscriptionId: string | null;
  usageType: string;
  quantity: number;
  unit: string;
  periodStart: Date;
  periodEnd: Date;
  stripeUsageRecordId: string | null;
  syncedToStripe: boolean;
  syncedAt: Date | null;
  sourceSessionId: string | null;
  sourceEventIds: string[];
  metadata: JSONObject;
  createdAt: Date;
}

/**
 * Usage record insert
 */
export interface UsageRecordInsert {
  userId: string;
  subscriptionId?: string | null;
  usageType: string;
  quantity: number;
  unit?: string;
  periodStart: Date;
  periodEnd: Date;
  sourceSessionId?: string | null;
  sourceEventIds?: string[];
  metadata?: JSONObject;
}

/**
 * Usage limit check result
 */
export interface UsageLimitResult {
  allowed: boolean;
  currentUsage: number;
  limitAmount: number | null;
  remaining: number;
}

/**
 * Subscription list filters
 */
export interface SubscriptionListFilters extends PaginationOptions {
  status?: SubscriptionStatus | SubscriptionStatus[];
  plan?: SubscriptionPlan;
  stripeCustomerId?: string;
}

/**
 * Billing events list filters
 */
export interface BillingEventListFilters extends PaginationOptions {
  userId?: string;
  eventType?: string;
  processed?: boolean;
  hasError?: boolean;
  dateRange?: DateRangeFilter;
}

/**
 * Usage records list filters
 */
export interface UsageRecordListFilters extends PaginationOptions {
  usageType?: string;
  periodStart?: Date;
  periodEnd?: Date;
  syncedToStripe?: boolean;
}

/**
 * Usage aggregation
 */
export interface UsageAggregation {
  usageType: string;
  totalQuantity: number;
  recordCount: number;
}

// ============================================================================
// Repository
// ============================================================================

export class BillingRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  async findSubscriptionById(id: string, tx?: TransactionContext): Promise<SubscriptionWithUsage | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
      FROM subscriptions
      WHERE id = ${id}
    `;

    return result[0] ? this.mapSubscription(result[0]) : null;
  }

  async findSubscriptionByUserId(userId: string, tx?: TransactionContext): Promise<SubscriptionWithUsage | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
      FROM subscriptions
      WHERE user_id = ${userId}
    `;

    return result[0] ? this.mapSubscription(result[0]) : null;
  }

  async findSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
      FROM subscriptions
      WHERE stripe_customer_id = ${stripeCustomerId}
    `;

    return result[0] ? this.mapSubscription(result[0]) : null;
  }

  async findSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
      FROM subscriptions
      WHERE stripe_subscription_id = ${stripeSubscriptionId}
    `;

    return result[0] ? this.mapSubscription(result[0]) : null;
  }

  async createSubscription(data: SubscriptionInsert, tx?: TransactionContext): Promise<SubscriptionWithUsage> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO subscriptions (
          user_id, stripe_customer_id, stripe_subscription_id,
          status, plan, current_period_start, current_period_end,
          cancel_at_period_end, trial_start, trial_end, metadata
        ) VALUES (
          ${data.user_id},
          ${data.stripe_customer_id},
          ${data.stripe_subscription_id},
          ${data.status},
          ${data.plan},
          ${data.current_period_start},
          ${data.current_period_end},
          ${data.cancel_at_period_end ?? false},
          ${data.trial_start ?? null},
          ${data.trial_end ?? null},
          ${db.json((data.metadata ?? {}) as postgres.JSONValue)}
        )
        RETURNING
          id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
          status, plan, current_period_start, current_period_end,
          cancel_at_period_end, canceled_at, cancel_reason,
          trial_start, trial_end,
          voice_minutes_limit, voice_minutes_used,
          message_limit, messages_used, companion_limit,
          metadata, created_at, updated_at
      `;

      const subscription = this.mapSubscription(result[0]!);
      logger.debug({ subscriptionId: subscription.id, userId: data.user_id }, 'Subscription created');
      return subscription;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('Subscription', 'user_id', data.user_id);
      }
      throw wrapDatabaseError(error, 'billing.createSubscription');
    }
  }

  async updateSubscription(
    id: string,
    data: Partial<Omit<SubscriptionInsert, 'user_id' | 'stripe_customer_id'>>,
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE subscriptions
      SET
        stripe_subscription_id = COALESCE(${data.stripe_subscription_id ?? null}, stripe_subscription_id),
        status = COALESCE(${data.status ?? null}, status),
        plan = COALESCE(${data.plan ?? null}, plan),
        current_period_start = COALESCE(${data.current_period_start ?? null}, current_period_start),
        current_period_end = COALESCE(${data.current_period_end ?? null}, current_period_end),
        cancel_at_period_end = COALESCE(${data.cancel_at_period_end ?? null}, cancel_at_period_end),
        trial_start = COALESCE(${data.trial_start ?? null}, trial_start),
        trial_end = COALESCE(${data.trial_end ?? null}, trial_end),
        metadata = COALESCE(${data.metadata ? db.json(data.metadata as postgres.JSONValue) : null}, metadata)
      WHERE id = ${id}
      RETURNING
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Subscription', id);
    }

    logger.debug({ subscriptionId: id }, 'Subscription updated');
    return this.mapSubscription(result[0]);
  }

  async cancelSubscription(
    id: string,
    options: { cancelAtPeriodEnd?: boolean; cancelReason?: string },
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE subscriptions
      SET
        status = CASE
          WHEN ${options.cancelAtPeriodEnd ?? true} THEN status
          ELSE 'canceled'
        END,
        cancel_at_period_end = ${options.cancelAtPeriodEnd ?? true},
        canceled_at = NOW(),
        cancel_reason = ${options.cancelReason ?? null}
      WHERE id = ${id}
      RETURNING
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Subscription', id);
    }

    logger.info({ subscriptionId: id, cancelAtPeriodEnd: options.cancelAtPeriodEnd }, 'Subscription canceled');
    return this.mapSubscription(result[0]);
  }

  async updateUsageLimits(
    id: string,
    limits: {
      voiceMinutesLimit?: number | null;
      messageLimit?: number | null;
      companionLimit?: number;
    },
    tx?: TransactionContext
  ): Promise<SubscriptionWithUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE subscriptions
      SET
        voice_minutes_limit = COALESCE(${limits.voiceMinutesLimit ?? null}, voice_minutes_limit),
        message_limit = COALESCE(${limits.messageLimit ?? null}, message_limit),
        companion_limit = COALESCE(${limits.companionLimit ?? null}, companion_limit)
      WHERE id = ${id}
      RETURNING
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Subscription', id);
    }

    return this.mapSubscription(result[0]);
  }

  async resetUsageCounters(id: string, tx?: TransactionContext): Promise<SubscriptionWithUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE subscriptions
      SET
        voice_minutes_used = 0,
        messages_used = 0
      WHERE id = ${id}
      RETURNING
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Subscription', id);
    }

    logger.debug({ subscriptionId: id }, 'Usage counters reset');
    return this.mapSubscription(result[0]);
  }

  async incrementUsage(
    userId: string,
    usageType: 'voice_minutes' | 'messages',
    amount: number,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);

    if (usageType === 'voice_minutes') {
      await db`
        UPDATE subscriptions
        SET voice_minutes_used = voice_minutes_used + ${amount}
        WHERE user_id = ${userId}
      `;
    } else {
      await db`
        UPDATE subscriptions
        SET messages_used = messages_used + ${amount}
        WHERE user_id = ${userId}
      `;
    }
  }

  async listSubscriptions(
    filters: SubscriptionListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<SubscriptionWithUsage>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const statusArray = Array.isArray(filters.status)
      ? filters.status
      : filters.status
        ? [filters.status]
        : null;

    const result = await db`
      SELECT
        id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        status, plan, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancel_reason,
        trial_start, trial_end,
        voice_minutes_limit, voice_minutes_used,
        message_limit, messages_used, companion_limit,
        metadata, created_at, updated_at
      FROM subscriptions
      WHERE 1=1
        ${statusArray ? db`AND status = ANY(${statusArray}::subscription_status[])` : db``}
        ${filters.plan ? db`AND plan = ${filters.plan}` : db``}
        ${filters.stripeCustomerId ? db`AND stripe_customer_id = ${filters.stripeCustomerId}` : db``}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapSubscription(row));

    return { data, hasMore };
  }

  async hasActiveSubscription(userId: string, tx?: TransactionContext): Promise<boolean> {
    const db = this.getSql(tx);
    const result = await db`SELECT has_active_subscription(${userId}) as has_active`;
    return result[0]?.has_active ?? false;
  }

  async getUserPlan(userId: string, tx?: TransactionContext): Promise<SubscriptionPlan> {
    const db = this.getSql(tx);
    const result = await db`SELECT get_user_plan(${userId}) as plan`;
    return (result[0]?.plan as SubscriptionPlan) ?? 'free';
  }

  async checkUsageLimit(
    userId: string,
    usageType: 'voice_minutes' | 'messages' | 'companions',
    tx?: TransactionContext
  ): Promise<UsageLimitResult> {
    const db = this.getSql(tx);
    const result = await db`SELECT * FROM check_usage_limit(${userId}, ${usageType})`;

    if (!result[0]) {
      return {
        allowed: true,
        currentUsage: 0,
        limitAmount: null,
        remaining: 999999,
      };
    }

    return {
      allowed: result[0].allowed,
      currentUsage: result[0].current_usage,
      limitAmount: result[0].limit_amount,
      remaining: result[0].remaining,
    };
  }

  // ===========================================================================
  // Billing Events
  // ===========================================================================

  async findBillingEventById(id: string, tx?: TransactionContext): Promise<BillingEvent | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
      FROM billing_events
      WHERE id = ${id}
    `;

    return result[0] ? this.mapBillingEvent(result[0]) : null;
  }

  async findBillingEventByStripeId(stripeEventId: string, tx?: TransactionContext): Promise<BillingEvent | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
      FROM billing_events
      WHERE stripe_event_id = ${stripeEventId}
    `;

    return result[0] ? this.mapBillingEvent(result[0]) : null;
  }

  async createBillingEvent(data: BillingEventInsert, tx?: TransactionContext): Promise<BillingEvent> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO billing_events (
          user_id, stripe_event_id, stripe_event_type, payload, processed, error
        ) VALUES (
          ${data.user_id ?? null},
          ${data.stripe_event_id},
          ${data.stripe_event_type},
          ${db.json(data.payload as postgres.JSONValue)},
          ${data.processed ?? false},
          ${data.error ?? null}
        )
        RETURNING
          id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
          payload, processed, processed_at, error, retry_count,
          idempotency_key, created_at
      `;

      const event = this.mapBillingEvent(result[0]!);
      logger.debug({ eventId: event.id, stripeEventId: data.stripe_event_id }, 'Billing event created');
      return event;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('BillingEvent', 'stripe_event_id', data.stripe_event_id);
      }
      throw wrapDatabaseError(error, 'billing.createBillingEvent');
    }
  }

  async markBillingEventProcessed(
    id: string,
    error?: string | null,
    tx?: TransactionContext
  ): Promise<BillingEvent> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE billing_events
      SET
        processed = ${error == null},
        processed_at = NOW(),
        error = ${error ?? null},
        retry_count = retry_count + 1
      WHERE id = ${id}
      RETURNING
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
    `;

    if (!result[0]) {
      throw new NotFoundError('BillingEvent', id);
    }

    return this.mapBillingEvent(result[0]);
  }

  async listBillingEvents(
    filters: BillingEventListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<BillingEvent>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
      FROM billing_events
      WHERE 1=1
        ${filters.userId ? db`AND user_id = ${filters.userId}` : db``}
        ${filters.eventType ? db`AND stripe_event_type = ${filters.eventType}` : db``}
        ${filters.processed !== undefined ? db`AND processed = ${filters.processed}` : db``}
        ${filters.hasError !== undefined
          ? filters.hasError
            ? db`AND error IS NOT NULL`
            : db`AND error IS NULL`
          : db``
        }
        ${filters.dateRange?.from ? db`AND created_at >= ${filters.dateRange.from}` : db``}
        ${filters.dateRange?.to ? db`AND created_at < ${filters.dateRange.to}` : db``}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapBillingEvent(row));

    return { data, hasMore };
  }

  async getUnprocessedBillingEvents(
    limit: number = 100,
    tx?: TransactionContext
  ): Promise<BillingEvent[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
      FROM billing_events
      WHERE processed = FALSE
        AND retry_count < 5
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapBillingEvent(row));
  }

  async getFailedBillingEvents(
    limit: number = 100,
    tx?: TransactionContext
  ): Promise<BillingEvent[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, stripe_event_id, stripe_event_type, stripe_api_version,
        payload, processed, processed_at, error, retry_count,
        idempotency_key, created_at
      FROM billing_events
      WHERE error IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapBillingEvent(row));
  }

  // ===========================================================================
  // Usage Records
  // ===========================================================================

  async findUsageRecordById(id: string, tx?: TransactionContext): Promise<UsageRecord | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, stripe_usage_record_id,
        synced_to_stripe, synced_at, source_session_id,
        source_event_ids, metadata, created_at
      FROM usage_records
      WHERE id = ${id}
    `;

    return result[0] ? this.mapUsageRecord(result[0]) : null;
  }

  async createUsageRecord(data: UsageRecordInsert, tx?: TransactionContext): Promise<UsageRecord> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO usage_records (
        user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, source_session_id, source_event_ids, metadata
      ) VALUES (
        ${data.userId},
        ${data.subscriptionId ?? null},
        ${data.usageType},
        ${data.quantity},
        ${data.unit ?? 'count'},
        ${data.periodStart},
        ${data.periodEnd},
        ${data.sourceSessionId ?? null},
        ${data.sourceEventIds ?? []},
        ${db.json((data.metadata ?? {}) as postgres.JSONValue)}
      )
      RETURNING
        id, user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, stripe_usage_record_id,
        synced_to_stripe, synced_at, source_session_id,
        source_event_ids, metadata, created_at
    `;

    const record = this.mapUsageRecord(result[0]!);
    logger.debug({ recordId: record.id, usageType: data.usageType }, 'Usage record created');
    return record;
  }

  async recordUsageUsingFunction(
    userId: string,
    usageType: string,
    quantity: number,
    sourceEventId?: string,
    tx?: TransactionContext
  ): Promise<string> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT record_usage(${userId}, ${usageType}, ${quantity}, ${sourceEventId ?? null}) as record_id
    `;
    return result[0]!.record_id;
  }

  async markUsageSynced(
    id: string,
    stripeUsageRecordId: string,
    tx?: TransactionContext
  ): Promise<UsageRecord> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE usage_records
      SET
        stripe_usage_record_id = ${stripeUsageRecordId},
        synced_to_stripe = TRUE,
        synced_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, stripe_usage_record_id,
        synced_to_stripe, synced_at, source_session_id,
        source_event_ids, metadata, created_at
    `;

    if (!result[0]) {
      throw new NotFoundError('UsageRecord', id);
    }

    return this.mapUsageRecord(result[0]);
  }

  async listUsageRecords(
    userId: string,
    filters: UsageRecordListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<UsageRecord>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, stripe_usage_record_id,
        synced_to_stripe, synced_at, source_session_id,
        source_event_ids, metadata, created_at
      FROM usage_records
      WHERE user_id = ${userId}
        ${filters.usageType ? db`AND usage_type = ${filters.usageType}` : db``}
        ${filters.periodStart ? db`AND period_start >= ${filters.periodStart}` : db``}
        ${filters.periodEnd ? db`AND period_end <= ${filters.periodEnd}` : db``}
        ${filters.syncedToStripe !== undefined ? db`AND synced_to_stripe = ${filters.syncedToStripe}` : db``}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapUsageRecord(row));

    return { data, hasMore };
  }

  async getUnsyncedUsageRecords(limit: number = 100, tx?: TransactionContext): Promise<UsageRecord[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, subscription_id, usage_type, quantity, unit,
        period_start, period_end, stripe_usage_record_id,
        synced_to_stripe, synced_at, source_session_id,
        source_event_ids, metadata, created_at
      FROM usage_records
      WHERE synced_to_stripe = FALSE
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapUsageRecord(row));
  }

  async aggregateUsage(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    tx?: TransactionContext
  ): Promise<UsageAggregation[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        usage_type,
        SUM(quantity) as total_quantity,
        COUNT(*) as record_count
      FROM usage_records
      WHERE user_id = ${userId}
        AND period_start >= ${periodStart}
        AND period_end <= ${periodEnd}
      GROUP BY usage_type
    `;

    return result.map(row => ({
      usageType: row.usage_type,
      totalQuantity: Number(row.total_quantity),
      recordCount: Number(row.record_count),
    }));
  }

  async getCurrentPeriodUsage(
    userId: string,
    usageType: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COALESCE(SUM(quantity), 0) as total
      FROM usage_records
      WHERE user_id = ${userId}
        AND usage_type = ${usageType}
        AND period_start <= NOW()
        AND period_end >= NOW()
    `;

    return Number(result[0]?.total ?? 0);
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapSubscription(row: Record<string, unknown>): SubscriptionWithUsage {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      stripe_customer_id: row.stripe_customer_id as string,
      stripe_subscription_id: row.stripe_subscription_id as string,
      stripePriceId: row.stripe_price_id as string | null,
      status: row.status as SubscriptionStatus,
      plan: row.plan as SubscriptionPlan,
      current_period_start: row.current_period_start as Date,
      current_period_end: row.current_period_end as Date,
      cancel_at_period_end: row.cancel_at_period_end as boolean,
      canceled_at: row.canceled_at as Date | null,
      cancelReason: row.cancel_reason as string | null,
      trial_start: row.trial_start as Date | null,
      trial_end: row.trial_end as Date | null,
      voiceMinutesLimit: row.voice_minutes_limit as number | null,
      voiceMinutesUsed: row.voice_minutes_used as number,
      messageLimit: row.message_limit as number | null,
      messagesUsed: row.messages_used as number,
      companionLimit: row.companion_limit as number,
      metadata: row.metadata as JSONObject,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapBillingEvent(row: Record<string, unknown>): BillingEvent {
    return {
      id: row.id as string,
      user_id: (row.user_id as string) ?? null,
      stripe_event_id: row.stripe_event_id as string,
      stripe_event_type: row.stripe_event_type as string,
      payload: row.payload as JSONObject,
      processed: row.processed as boolean,
      processed_at: row.processed_at as Date | null,
      error: row.error as string | null,
      created_at: row.created_at as Date,
    };
  }

  private mapUsageRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      subscriptionId: row.subscription_id as string | null,
      usageType: row.usage_type as string,
      quantity: row.quantity as number,
      unit: row.unit as string,
      periodStart: row.period_start as Date,
      periodEnd: row.period_end as Date,
      stripeUsageRecordId: row.stripe_usage_record_id as string | null,
      syncedToStripe: row.synced_to_stripe as boolean,
      syncedAt: row.synced_at as Date | null,
      sourceSessionId: row.source_session_id as string | null,
      sourceEventIds: row.source_event_ids as string[],
      metadata: row.metadata as JSONObject,
      createdAt: row.created_at as Date,
    };
  }
}

// Singleton instance
let billingRepository: BillingRepository | null = null;

export function getBillingRepository(): BillingRepository {
  if (!billingRepository) {
    billingRepository = new BillingRepository();
  }
  return billingRepository;
}
