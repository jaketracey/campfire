/**
 * Messaging Queue Utilities
 * BullMQ queue client for enqueueing messaging inbound/outbound jobs.
 */

import { Queue } from 'bullmq';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import type { MessagingInboundJobData } from '@campfire/shared';

// Redis configuration
const REDIS_URL = env.REDIS_URL;

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
}

// Messaging inbound queue
let messagingInboundQueue: Queue<MessagingInboundJobData> | null = null;

/**
 * Get or create the messaging inbound queue
 */
function getMessagingInboundQueue(): Queue<MessagingInboundJobData> | null {
  if (messagingInboundQueue) {
    return messagingInboundQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    messagingInboundQueue = new Queue<MessagingInboundJobData>('messaging-inbound', {
      connection: redisConfig,
    });
    logger.info('Messaging inbound queue initialized');
    return messagingInboundQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize messaging inbound queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue a messaging inbound job
 * Called when a message is received from an external platform (Telegram, etc.)
 */
export async function enqueueMessagingInboundJob(
  jobData: MessagingInboundJobData
): Promise<boolean> {
  const queue = getMessagingInboundQueue();
  if (!queue) {
    logger.debug('Messaging inbound queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('process-inbound', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
        count: 5000,
      },
      removeOnFail: {
        age: 86400,
      },
    });
    logger.debug(
      { channelId: jobData.channelId, platform: jobData.platform },
      'Messaging inbound job enqueued'
    );
    return true;
  } catch (error) {
    logger.error(
      { error, channelId: jobData.channelId, platform: jobData.platform },
      'Failed to enqueue messaging inbound job'
    );
    return false;
  }
}

/**
 * Close the messaging queue connections (for graceful shutdown)
 */
export async function closeMessagingQueues(): Promise<void> {
  if (messagingInboundQueue) {
    await messagingInboundQueue.close();
    messagingInboundQueue = null;
  }
}
