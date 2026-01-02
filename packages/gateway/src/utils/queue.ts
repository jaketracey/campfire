/**
 * Queue Utilities
 * Simple BullMQ queue client for enqueueing background jobs.
 */

import { Queue } from 'bullmq';
import { logger } from '../observability/logger.js';
import type { ImageRenditionJobData } from '@campfire/shared';

// Redis configuration
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

// Parse Redis URL
function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
}

// Summary projection queue
let summaryQueue: Queue | null = null;

// Image rendition queue
let imageRenditionQueue: Queue<ImageRenditionJobData> | null = null;

interface SummaryJobData {
  type: 'session' | 'daily' | 'weekly';
  userId: string;
  companionId: string;
  resourceId: string;
}

/**
 * Get or create the summary projection queue
 */
function getSummaryQueue(): Queue<SummaryJobData> | null {
  if (summaryQueue) {
    return summaryQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    summaryQueue = new Queue<SummaryJobData>('summary-projection', {
      connection: redisConfig,
    });
    logger.info('Summary queue initialized');
    return summaryQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize summary queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue a session summary generation job
 */
export async function enqueueSummaryJob(
  userId: string,
  companionId: string,
  sessionId: string
): Promise<boolean> {
  const queue = getSummaryQueue();
  if (!queue) {
    logger.debug('Summary queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('session-summary', {
      type: 'session',
      userId,
      companionId,
      resourceId: sessionId,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
    logger.debug({ userId, sessionId }, 'Session summary job enqueued');
    return true;
  } catch (error) {
    logger.error({ error, userId, sessionId }, 'Failed to enqueue summary job');
    return false;
  }
}

/**
 * Get or create the image rendition queue
 */
function getImageRenditionQueue(): Queue<ImageRenditionJobData> | null {
  if (imageRenditionQueue) {
    return imageRenditionQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    imageRenditionQueue = new Queue<ImageRenditionJobData>('image-renditions', {
      connection: redisConfig,
    });
    logger.info('Image rendition queue initialized');
    return imageRenditionQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize image rendition queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue an image rendition processing job
 * Call this after uploading the original image to S3
 */
export async function enqueueImageRenditionJob(
  jobData: ImageRenditionJobData
): Promise<boolean> {
  const queue = getImageRenditionQueue();
  if (!queue) {
    logger.debug('Image rendition queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('process-renditions', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 1000,
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    });
    logger.debug({ imageId: jobData.imageId, s3Key: jobData.originalS3Key }, 'Image rendition job enqueued');
    return true;
  } catch (error) {
    logger.error({ error, imageId: jobData.imageId }, 'Failed to enqueue image rendition job');
    return false;
  }
}

/**
 * Close queue connections (for graceful shutdown)
 */
export async function closeQueues(): Promise<void> {
  if (summaryQueue) {
    await summaryQueue.close();
    summaryQueue = null;
  }
  if (imageRenditionQueue) {
    await imageRenditionQueue.close();
    imageRenditionQueue = null;
  }
}
