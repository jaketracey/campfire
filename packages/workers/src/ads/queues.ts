/**
 * Ad Queue Definitions
 *
 * BullMQ queues for ad spend sync and LTV calculation workers.
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Queue names
export const AD_SPEND_SYNC_QUEUE = 'ad-spend-sync';
export const LTV_CALCULATION_QUEUE = 'ltv-calculation';

// Job interfaces
export interface AdSpendSyncJob {
  /** Optional - if not provided, sync all active accounts */
  accountId?: string;
  /** ISO date string - start of date range to sync */
  startDate?: string;
  /** ISO date string - end of date range to sync */
  endDate?: string;
}

export interface LtvCalculationJob {
  /** Optional - if not provided, calculate for all users with payments */
  userId?: string;
}

/**
 * Create the ad spend sync queue
 */
export function createAdSpendSyncQueue(connection: Redis): Queue<AdSpendSyncJob> {
  return new Queue<AdSpendSyncJob>(AD_SPEND_SYNC_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000, // Start with 1 minute delay
      },
      removeOnComplete: {
        count: 100, // Keep last 100 completed jobs
        age: 86400, // Keep for 24 hours
      },
      removeOnFail: {
        count: 500, // Keep more failed jobs for debugging
        age: 604800, // Keep for 7 days
      },
    },
  });
}

/**
 * Create the LTV calculation queue
 */
export function createLtvCalculationQueue(connection: Redis): Queue<LtvCalculationJob> {
  return new Queue<LtvCalculationJob>(LTV_CALCULATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000, // Start with 30 second delay
      },
      removeOnComplete: {
        count: 100,
        age: 86400,
      },
      removeOnFail: {
        count: 200,
        age: 604800,
      },
    },
  });
}
