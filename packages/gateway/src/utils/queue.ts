/**
 * Queue Utilities
 * Simple BullMQ queue client for enqueueing background jobs.
 */

import { Queue } from 'bullmq';
import { logger } from '../observability/logger.js';
import type { ImageRenditionJobData } from '@campfire/shared';
import { env } from '../env.js';

// Redis configuration
const REDIS_URL = env.REDIS_URL;

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

// Video generation queue
let videoGenerationQueue: Queue<VideoGenerationJobData> | null = null;

// Email queue
let emailQueue: Queue<EmailJobData> | null = null;

// Gift generation queue
let giftGenerationQueue: Queue<GiftGenerationJobData> | null = null;

// Influencer sample generation queue
let influencerSampleGenerationQueue: Queue<InfluencerSampleGenerationJobData> | null = null;

interface SummaryJobData {
  type: 'session' | 'daily' | 'weekly';
  userId: string;
  companionId: string;
  resourceId: string;
}

/**
 * Email job data - matches the schema expected by workers
 */
export interface EmailJobData {
  jobId: string;
  type: 'transactional' | 'notification' | 'marketing';
  templateName: string;
  recipientUserId?: string;
  recipientEmail: string;
  recipientName?: string;
  context: Record<string, unknown>;
  metadata: {
    traceId: string;
    correlationId?: string;
    causationId?: string;
    campaignId?: string;
  };
  scheduledFor?: string;
  priority: 'high' | 'normal' | 'low';
}

/**
 * Video generation job data
 */
export interface VideoGenerationJobData {
  videoRequestId: string;
  userId: string;
  companionId: string;
  prompt: string;
  referenceImageUrl?: string;
  referenceImageS3Bucket?: string;
  referenceImageS3Key?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

/**
 * Gift generation job data
 */
export interface GiftGenerationJobData {
  giftId: string;
  userId: string;
  companionId: string;
  companionName: string;
  companionBackstory?: string;
  companionPersonality?: Record<string, number>;
  tokenCost: number;
  tier: 'low' | 'medium' | 'high';
}

/**
 * Influencer sample generation job data
 */
export interface InfluencerSampleGenerationJobData {
  sampleId: string;
  modelId: string;
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
 * Get or create the video generation queue
 */
function getVideoGenerationQueue(): Queue<VideoGenerationJobData> | null {
  if (videoGenerationQueue) {
    return videoGenerationQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    videoGenerationQueue = new Queue<VideoGenerationJobData>('video-generation', {
      connection: redisConfig,
    });
    logger.info('Video generation queue initialized');
    return videoGenerationQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize video generation queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue a video generation job
 * Call this after creating the video request in the database
 */
export async function enqueueVideoGenerationJob(
  jobData: VideoGenerationJobData
): Promise<boolean> {
  const queue = getVideoGenerationQueue();
  if (!queue) {
    logger.debug('Video generation queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('generate-video', jobData, {
      attempts: 2, // Expensive operation, fewer retries
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 100,
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    });
    logger.debug({ videoRequestId: jobData.videoRequestId }, 'Video generation job enqueued');
    return true;
  } catch (error) {
    logger.error({ error, videoRequestId: jobData.videoRequestId }, 'Failed to enqueue video generation job');
    return false;
  }
}

/**
 * Get or create the email queue
 */
function getEmailQueue(): Queue<EmailJobData> | null {
  if (emailQueue) {
    return emailQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    emailQueue = new Queue<EmailJobData>('email', {
      connection: redisConfig,
    });
    logger.info('Email queue initialized');
    return emailQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize email queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue an email job
 * This adds a job to the same queue that the workers email service processes
 */
export async function enqueueEmailJob(
  jobData: Omit<EmailJobData, 'jobId'> & { jobId?: string }
): Promise<string | null> {
  const queue = getEmailQueue();
  if (!queue) {
    logger.debug('Email queue not available, skipping job');
    return null;
  }

  const { nanoid } = await import('nanoid');
  const jobId = jobData.jobId || nanoid();
  const fullJobData: EmailJobData = { ...jobData, jobId };

  try {
    await queue.add('send', fullJobData, {
      priority: jobData.priority === 'high' ? 1 : jobData.priority === 'low' ? 3 : 2,
      jobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    logger.debug({ jobId, template: jobData.templateName }, 'Email job enqueued');
    return jobId;
  } catch (error) {
    logger.error({ error, template: jobData.templateName }, 'Failed to enqueue email job');
    return null;
  }
}

/**
 * Get or create the gift generation queue
 */
function getGiftGenerationQueue(): Queue<GiftGenerationJobData> | null {
  if (giftGenerationQueue) {
    return giftGenerationQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    giftGenerationQueue = new Queue<GiftGenerationJobData>('gift-generation', {
      connection: redisConfig,
    });
    logger.info('Gift generation queue initialized');
    return giftGenerationQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize gift generation queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue a gift generation job
 * Call this after creating the gift record in the database
 */
export async function enqueueGiftGenerationJob(
  jobData: GiftGenerationJobData
): Promise<boolean> {
  const queue = getGiftGenerationQueue();
  if (!queue) {
    logger.debug('Gift generation queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('generate-gift', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 500,
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    });
    logger.debug({ giftId: jobData.giftId }, 'Gift generation job enqueued');
    return true;
  } catch (error) {
    logger.error({ error, giftId: jobData.giftId }, 'Failed to enqueue gift generation job');
    return false;
  }
}

/**
 * Get or create the influencer sample generation queue
 */
function getInfluencerSampleGenerationQueue(): Queue<InfluencerSampleGenerationJobData> | null {
  if (influencerSampleGenerationQueue) {
    return influencerSampleGenerationQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    influencerSampleGenerationQueue = new Queue<InfluencerSampleGenerationJobData>('influencer-sample-generation', {
      connection: redisConfig,
    });
    logger.info('Influencer sample generation queue initialized');
    return influencerSampleGenerationQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize influencer sample generation queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue an influencer sample generation job
 */
export async function enqueueInfluencerSampleGenerationJob(
  jobData: InfluencerSampleGenerationJobData
): Promise<boolean> {
  const queue = getInfluencerSampleGenerationQueue();
  if (!queue) {
    logger.debug('Influencer sample generation queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('generate-sample', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
      },
      jobId: jobData.sampleId,
    });
    logger.debug({ sampleId: jobData.sampleId, modelId: jobData.modelId }, 'Influencer sample generation job enqueued');
    return true;
  } catch (error) {
    logger.error({ error, sampleId: jobData.sampleId }, 'Failed to enqueue influencer sample generation job');
    return false;
  }
}

// Memory decay queue
let memoryDecayQueue: Queue<MemoryDecayJobData> | null = null;

// Memory expiration queue
let memoryExpirationQueue: Queue<MemoryExpirationJobData> | null = null;

/**
 * Memory decay job data
 */
export interface MemoryDecayJobData {
  userId?: string;
  companionId?: string;
  decayRate?: number;
}

/**
 * Memory expiration job data
 */
export interface MemoryExpirationJobData {
  // No data needed
}

/**
 * Get or create the memory decay queue
 */
function getMemoryDecayQueue(): Queue<MemoryDecayJobData> | null {
  if (memoryDecayQueue) {
    return memoryDecayQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    memoryDecayQueue = new Queue<MemoryDecayJobData>('memory-decay', {
      connection: redisConfig,
    });
    logger.info('Memory decay queue initialized');
    return memoryDecayQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize memory decay queue - Redis may not be available');
    return null;
  }
}

/**
 * Get or create the memory expiration queue
 */
function getMemoryExpirationQueue(): Queue<MemoryExpirationJobData> | null {
  if (memoryExpirationQueue) {
    return memoryExpirationQueue;
  }

  try {
    const redisConfig = parseRedisUrl(REDIS_URL);
    memoryExpirationQueue = new Queue<MemoryExpirationJobData>('memory-expiration', {
      connection: redisConfig,
    });
    logger.info('Memory expiration queue initialized');
    return memoryExpirationQueue;
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize memory expiration queue - Redis may not be available');
    return null;
  }
}

/**
 * Enqueue a memory decay job (manual trigger)
 */
export async function enqueueMemoryDecayJob(
  jobData: MemoryDecayJobData = {}
): Promise<boolean> {
  const queue = getMemoryDecayQueue();
  if (!queue) {
    logger.debug('Memory decay queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('manual-memory-decay', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
    logger.info({ userId: jobData.userId, companionId: jobData.companionId }, 'Memory decay job enqueued');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue memory decay job');
    return false;
  }
}

/**
 * Enqueue a memory expiration job (manual trigger)
 */
export async function enqueueMemoryExpirationJob(): Promise<boolean> {
  const queue = getMemoryExpirationQueue();
  if (!queue) {
    logger.debug('Memory expiration queue not available, skipping job');
    return false;
  }

  try {
    await queue.add('manual-memory-expiration', {}, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
    logger.info('Memory expiration job enqueued');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to enqueue memory expiration job');
    return false;
  }
}

// Reusable probe queue for Redis health checks (lazy-initialized, long-lived)
let healthProbeQueue: Queue | null = null;

/**
 * Check Redis connectivity by pinging the connection used by queues
 */
export async function checkRedisHealth(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    if (!healthProbeQueue) {
      const redisConfig = parseRedisUrl(REDIS_URL);
      healthProbeQueue = new Queue('health-probe', { connection: redisConfig });
    }
    const client = await healthProbeQueue.client;
    await client.ping();
    return { ok: true, latency_ms: Date.now() - start };
  } catch (error) {
    // Reset probe on failure so next call retries fresh
    if (healthProbeQueue) {
      healthProbeQueue.close().catch(() => {});
      healthProbeQueue = null;
    }
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get queue depth stats for all initialized queues
 */
export async function getQueueStats(): Promise<Record<string, { waiting: number; active: number; delayed: number; failed: number }>> {
  const stats: Record<string, { waiting: number; active: number; delayed: number; failed: number }> = {};

  const queues: [string, Queue | null][] = [
    ['summary-projection', summaryQueue],
    ['image-renditions', imageRenditionQueue],
    ['video-generation', videoGenerationQueue],
    ['email', emailQueue],
    ['gift-generation', giftGenerationQueue],
    ['influencer-sample-generation', influencerSampleGenerationQueue],
    ['memory-decay', memoryDecayQueue],
    ['memory-expiration', memoryExpirationQueue],
  ];

  for (const [name, queue] of queues) {
    if (queue) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        stats[name] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        };
      } catch {
        stats[name] = { waiting: -1, active: -1, delayed: -1, failed: -1 };
      }
    }
  }

  return stats;
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
  if (videoGenerationQueue) {
    await videoGenerationQueue.close();
    videoGenerationQueue = null;
  }
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
  if (giftGenerationQueue) {
    await giftGenerationQueue.close();
    giftGenerationQueue = null;
  }
  if (influencerSampleGenerationQueue) {
    await influencerSampleGenerationQueue.close();
    influencerSampleGenerationQueue = null;
  }
  if (memoryDecayQueue) {
    await memoryDecayQueue.close();
    memoryDecayQueue = null;
  }
  if (memoryExpirationQueue) {
    await memoryExpirationQueue.close();
    memoryExpirationQueue = null;
  }
  if (healthProbeQueue) {
    await healthProbeQueue.close();
    healthProbeQueue = null;
  }
}
