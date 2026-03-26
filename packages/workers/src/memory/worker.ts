/**
 * Memory Maintenance Workers
 *
 * BullMQ workers that handle memory decay and expiration:
 * - MemoryDecayWorker: Reduces importance of stale memories (not accessed in 7+ days)
 * - MemoryExpirationWorker: Soft-deletes memories past their expires_at date
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import {
  MEMORY_DECAY_QUEUE,
  MEMORY_EXPIRATION_QUEUE,
  type MemoryDecayJob,
  type MemoryExpirationJob,
} from './queues.js';

// Default decay rate: 0.01 per cycle
const DEFAULT_DECAY_RATE = 0.01;
// Minimum importance floor
const IMPORTANCE_FLOOR = 0.1;
// Days since last access before decay kicks in
const STALE_THRESHOLD_DAYS = 7;

interface MemoryWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
}

/**
 * Applies memory decay for all active user-companion pairs.
 * Memories not accessed in 7+ days have their importance reduced by decay_rate,
 * with a floor at 0.1.
 */
export async function processMemoryDecay(
  db: DbClient,
  logger: Logger,
  data: MemoryDecayJob
): Promise<{ pairsProcessed: number; totalDecayed: number }> {
  const decayRate = data.decayRate ?? DEFAULT_DECAY_RATE;
  let pairsProcessed = 0;
  let totalDecayed = 0;

  if (data.userId && data.companionId) {
    // Decay for a specific user-companion pair
    const decayed = await applyDecayForPair(db, data.userId, data.companionId, decayRate);
    pairsProcessed = 1;
    totalDecayed = decayed;

    logger.info(
      { userId: data.userId, companionId: data.companionId, decayed },
      'Memory decay applied for specific pair'
    );
  } else {
    // Decay for all active user-companion pairs
    const pairs = await getActiveUserCompanionPairs(db);

    for (const pair of pairs) {
      const decayed = await applyDecayForPair(db, pair.user_id, pair.companion_id, decayRate);
      pairsProcessed++;
      totalDecayed += decayed;
    }

    logger.info(
      { pairsProcessed, totalDecayed, decayRate },
      'Memory decay completed for all pairs'
    );
  }

  return { pairsProcessed, totalDecayed };
}

/**
 * Soft-deletes all memories past their expires_at date.
 */
export async function processMemoryExpiration(
  db: DbClient,
  logger: Logger
): Promise<{ expiredCount: number }> {
  const result = await db.sql`
    UPDATE memories
    SET status = 'deleted'
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id
  `;

  const expiredCount = result.length;

  if (expiredCount > 0) {
    logger.info({ expiredCount }, 'Expired memories soft-deleted');
  } else {
    logger.debug('No expired memories found');
  }

  return { expiredCount };
}

/**
 * Get all distinct user-companion pairs with active memories.
 */
async function getActiveUserCompanionPairs(
  db: DbClient
): Promise<Array<{ user_id: string; companion_id: string }>> {
  const result = await db.sql`
    SELECT DISTINCT user_id, companion_id
    FROM memories
    WHERE status = 'active'
  `;

  return result as unknown as Array<{ user_id: string; companion_id: string }>;
}

/**
 * Apply decay to memories for a specific user-companion pair.
 * Only decays memories not accessed in the last 7 days, with a floor at 0.1.
 */
async function applyDecayForPair(
  db: DbClient,
  userId: string,
  companionId: string,
  decayRate: number
): Promise<number> {
  const staleThresholdMs = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - staleThresholdMs);

  const result = await db.sql`
    UPDATE memories
    SET
      importance = GREATEST(${IMPORTANCE_FLOOR}, importance - ${decayRate}),
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND companion_id = ${companionId}
      AND status = 'active'
      AND importance > ${IMPORTANCE_FLOOR}
      AND (
        (last_accessed_at IS NULL AND created_at < ${cutoffDate.toISOString()})
        OR (last_accessed_at IS NOT NULL AND last_accessed_at < ${cutoffDate.toISOString()})
      )
    RETURNING id
  `;

  return result.length;
}

/**
 * Memory Decay Worker
 */
export class MemoryDecayWorker {
  private worker: Worker<MemoryDecayJob> | null = null;
  private config: MemoryWorkerConfig;

  constructor(config: MemoryWorkerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.worker = new Worker<MemoryDecayJob>(
      MEMORY_DECAY_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 1,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info(
        { jobId: job.id },
        'Memory decay job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Memory decay job failed'
      );
    });

    this.config.logger.info('Memory decay worker started');
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Memory decay worker stopped');
    }
  }

  private async process(job: Job<MemoryDecayJob>): Promise<{ pairsProcessed: number; totalDecayed: number }> {
    return processMemoryDecay(this.config.db, this.config.logger, job.data);
  }
}

/**
 * Memory Expiration Worker
 */
export class MemoryExpirationWorker {
  private worker: Worker<MemoryExpirationJob> | null = null;
  private config: MemoryWorkerConfig;

  constructor(config: MemoryWorkerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.worker = new Worker<MemoryExpirationJob>(
      MEMORY_EXPIRATION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 1,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info(
        { jobId: job.id },
        'Memory expiration job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Memory expiration job failed'
      );
    });

    this.config.logger.info('Memory expiration worker started');
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Memory expiration worker stopped');
    }
  }

  private async process(_job: Job<MemoryExpirationJob>): Promise<{ expiredCount: number }> {
    return processMemoryExpiration(this.config.db, this.config.logger);
  }
}
