/**
 * Messaging Queue Definitions
 *
 * BullMQ queues for processing inbound messages from external platforms.
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { MessagingInboundJobData } from '@campfire/shared';

// Queue name
export const MESSAGING_INBOUND_QUEUE = 'messaging-inbound';

// Re-export the job type for convenience
export type { MessagingInboundJobData };

/**
 * Create the messaging inbound queue
 */
export function createMessagingInboundQueue(connection: Redis): Queue<MessagingInboundJobData> {
  return new Queue<MessagingInboundJobData>(MESSAGING_INBOUND_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        count: 5000,
        age: 3600, // 1 hour
      },
      removeOnFail: {
        count: 2000,
        age: 86400, // 24 hours
      },
    },
  });
}
