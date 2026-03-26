/**
 * Proactive Outreach Queue Definitions
 *
 * BullMQ queue for scheduling and processing proactive companion outreach.
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Queue name
export const PROACTIVE_OUTREACH_QUEUE = 'proactive-outreach';

// Job interfaces
export interface ProactiveOutreachJob {
  /** If provided, evaluate only this specific pair */
  userId?: string;
  companionId?: string;
}

/**
 * Create the proactive outreach queue
 */
export function createProactiveOutreachQueue(connection: Redis): Queue<ProactiveOutreachJob> {
  return new Queue<ProactiveOutreachJob>(PROACTIVE_OUTREACH_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
      removeOnComplete: {
        count: 100,
        age: 86400, // 24 hours
      },
      removeOnFail: {
        count: 200,
        age: 604800, // 7 days
      },
    },
  });
}
