/**
 * LTV Calculation Worker
 *
 * BullMQ worker that calculates user lifetime value (LTV) from payment data.
 * Aggregates subscription revenue and token purchases to compute total LTV.
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { LTV_CALCULATION_QUEUE, type LtvCalculationJob } from './queues.js';

interface UserPaymentData {
  user_id: string;
  subscription_revenue_cents: number;
  token_revenue_cents: number;
  first_payment_at: Date | null;
  last_payment_at: Date | null;
}

interface LtvCalculationWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
  batchSize?: number;
}

export class LtvCalculationWorker {
  private worker: Worker<LtvCalculationJob> | null = null;
  private config: LtvCalculationWorkerConfig;
  private batchSize: number;

  constructor(config: LtvCalculationWorkerConfig) {
    this.config = config;
    this.batchSize = config.batchSize || 100;
  }

  async start(): Promise<void> {
    this.worker = new Worker<LtvCalculationJob>(
      LTV_CALCULATION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 3,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info(
        { jobId: job.id, userId: job.data.userId },
        'LTV calculation job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, userId: job?.data.userId, error: err.message },
        'LTV calculation job failed'
      );
    });

    this.worker.on('stalled', (jobId) => {
      this.config.logger.warn({ jobId }, 'LTV calculation job stalled');
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 3, batchSize: this.batchSize },
      'LTV calculation worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('LTV calculation worker stopped');
    }
  }

  private async process(job: Job<LtvCalculationJob>): Promise<void> {
    const { userId } = job.data;

    if (userId) {
      // Calculate LTV for a specific user
      await this.calculateUserLtv(userId);
    } else {
      // Calculate LTV for all users with payments
      await this.calculateAllUserLtv(job);
    }
  }

  private async calculateUserLtv(userId: string): Promise<void> {
    this.config.logger.debug({ userId }, 'Calculating LTV for user');

    const paymentData = await this.getUserPaymentData(userId);
    if (!paymentData) {
      this.config.logger.debug({ userId }, 'No payment data found for user');
      return;
    }

    await this.upsertUserLtv(paymentData);
    await this.updateAdConversionsLtv(userId, paymentData.subscription_revenue_cents + paymentData.token_revenue_cents);

    this.config.logger.info(
      {
        userId,
        ltvCents: paymentData.subscription_revenue_cents + paymentData.token_revenue_cents,
      },
      'User LTV calculated'
    );
  }

  private async calculateAllUserLtv(job: Job<LtvCalculationJob>): Promise<void> {
    this.config.logger.info('Calculating LTV for all users with payments');

    let offset = 0;
    let totalProcessed = 0;

    while (true) {
      // Get users with payments in batches
      const users = await this.getUsersWithPayments(offset, this.batchSize);

      if (users.length === 0) {
        break;
      }

      for (const userData of users) {
        await this.upsertUserLtv(userData);
        await this.updateAdConversionsLtv(
          userData.user_id,
          userData.subscription_revenue_cents + userData.token_revenue_cents
        );
        totalProcessed++;
      }

      // Update job progress
      const progress = Math.min(100, Math.round((offset / (offset + users.length + this.batchSize)) * 100));
      await job.updateProgress(progress);

      offset += this.batchSize;

      this.config.logger.debug(
        { processed: totalProcessed, batchSize: users.length },
        'Processed LTV batch'
      );

      // Small delay to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.config.logger.info({ totalProcessed }, 'All user LTV calculations completed');
  }

  private async getUserPaymentData(userId: string): Promise<UserPaymentData | null> {
    // Calculate subscription revenue from billing_events (invoice.paid events)
    const subscriptionRevenue = await this.config.db.sql`
      SELECT
        COALESCE(SUM((payload->'data'->'object'->>'amount_paid')::integer), 0) as total_cents,
        MIN((payload->'data'->'object'->>'created')::bigint) as first_payment_ts,
        MAX((payload->'data'->'object'->>'created')::bigint) as last_payment_ts
      FROM billing_events
      WHERE user_id = ${userId}
        AND stripe_event_type = 'invoice.paid'
        AND processed = true
    `;

    // Calculate token revenue from token_transactions
    const tokenRevenue = await this.config.db.sql`
      SELECT
        COALESCE(SUM((metadata->>'price_cents')::integer), 0) as total_cents,
        MIN(created_at) as first_purchase,
        MAX(created_at) as last_purchase
      FROM token_transactions
      WHERE user_id = ${userId}
        AND transaction_type = 'purchase'
    `;

    const subRev = subscriptionRevenue[0] as {
      total_cents: number;
      first_payment_ts: number | null;
      last_payment_ts: number | null;
    };
    const tokenRev = tokenRevenue[0] as {
      total_cents: number;
      first_purchase: Date | null;
      last_purchase: Date | null;
    };

    const subscriptionCents = subRev.total_cents || 0;
    const tokenCents = tokenRev.total_cents || 0;

    // If no revenue, return null
    if (subscriptionCents === 0 && tokenCents === 0) {
      return null;
    }

    // Calculate first and last payment dates
    let firstPaymentAt: Date | null = null;
    let lastPaymentAt: Date | null = null;

    if (subRev.first_payment_ts) {
      firstPaymentAt = new Date(subRev.first_payment_ts * 1000);
    }
    if (tokenRev.first_purchase && (!firstPaymentAt || tokenRev.first_purchase < firstPaymentAt)) {
      firstPaymentAt = tokenRev.first_purchase;
    }

    if (subRev.last_payment_ts) {
      lastPaymentAt = new Date(subRev.last_payment_ts * 1000);
    }
    if (tokenRev.last_purchase && (!lastPaymentAt || tokenRev.last_purchase > lastPaymentAt)) {
      lastPaymentAt = tokenRev.last_purchase;
    }

    return {
      user_id: userId,
      subscription_revenue_cents: subscriptionCents,
      token_revenue_cents: tokenCents,
      first_payment_at: firstPaymentAt,
      last_payment_at: lastPaymentAt,
    };
  }

  private async getUsersWithPayments(
    offset: number,
    limit: number
  ): Promise<UserPaymentData[]> {
    // Get users with either subscription payments or token purchases
    const result = await this.config.db.sql`
      WITH subscription_revenue AS (
        SELECT
          user_id,
          COALESCE(SUM((payload->'data'->'object'->>'amount_paid')::integer), 0) as sub_cents,
          MIN((payload->'data'->'object'->>'created')::bigint) as sub_first_ts,
          MAX((payload->'data'->'object'->>'created')::bigint) as sub_last_ts
        FROM billing_events
        WHERE stripe_event_type = 'invoice.paid'
          AND processed = true
          AND user_id IS NOT NULL
        GROUP BY user_id
      ),
      token_revenue AS (
        SELECT
          user_id,
          COALESCE(SUM((metadata->>'price_cents')::integer), 0) as token_cents,
          MIN(created_at) as token_first,
          MAX(created_at) as token_last
        FROM token_transactions
        WHERE transaction_type = 'purchase'
        GROUP BY user_id
      )
      SELECT
        COALESCE(s.user_id, t.user_id) as user_id,
        COALESCE(s.sub_cents, 0) as subscription_revenue_cents,
        COALESCE(t.token_cents, 0) as token_revenue_cents,
        CASE
          WHEN s.sub_first_ts IS NOT NULL AND t.token_first IS NOT NULL THEN
            LEAST(to_timestamp(s.sub_first_ts), t.token_first)
          WHEN s.sub_first_ts IS NOT NULL THEN to_timestamp(s.sub_first_ts)
          ELSE t.token_first
        END as first_payment_at,
        CASE
          WHEN s.sub_last_ts IS NOT NULL AND t.token_last IS NOT NULL THEN
            GREATEST(to_timestamp(s.sub_last_ts), t.token_last)
          WHEN s.sub_last_ts IS NOT NULL THEN to_timestamp(s.sub_last_ts)
          ELSE t.token_last
        END as last_payment_at
      FROM subscription_revenue s
      FULL OUTER JOIN token_revenue t ON s.user_id = t.user_id
      WHERE COALESCE(s.sub_cents, 0) + COALESCE(t.token_cents, 0) > 0
      ORDER BY user_id
      OFFSET ${offset}
      LIMIT ${limit}
    `;

    return result as unknown as UserPaymentData[];
  }

  private async upsertUserLtv(data: UserPaymentData): Promise<void> {
    const totalLtv = data.subscription_revenue_cents + data.token_revenue_cents;

    await this.config.db.sql`
      INSERT INTO user_ltv (
        user_id,
        total_payments_cents,
        subscription_revenue_cents,
        token_revenue_cents,
        ltv_cents,
        first_payment_at,
        last_payment_at
      ) VALUES (
        ${data.user_id},
        ${totalLtv},
        ${data.subscription_revenue_cents},
        ${data.token_revenue_cents},
        ${totalLtv},
        ${data.first_payment_at?.toISOString() || null},
        ${data.last_payment_at?.toISOString() || null}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        total_payments_cents = ${totalLtv},
        subscription_revenue_cents = ${data.subscription_revenue_cents},
        token_revenue_cents = ${data.token_revenue_cents},
        ltv_cents = ${totalLtv},
        first_payment_at = COALESCE(${data.first_payment_at?.toISOString() || null}, user_ltv.first_payment_at),
        last_payment_at = ${data.last_payment_at?.toISOString() || null},
        updated_at = NOW()
    `;
  }

  private async updateAdConversionsLtv(userId: string, ltvCents: number): Promise<void> {
    // Update ltv_cents in ad_conversions for this user
    await this.config.db.sql`
      UPDATE ad_conversions
      SET ltv_cents = ${ltvCents}
      WHERE user_id = ${userId}
    `;
  }
}
