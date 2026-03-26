/**
 * Memory Maintenance Queue Definitions
 *
 * BullMQ queues for memory decay and expiration jobs.
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Queue names
export const MEMORY_DECAY_QUEUE = 'memory-decay';
export const MEMORY_EXPIRATION_QUEUE = 'memory-expiration';

// Job interfaces
export interface MemoryDecayJob {
  /** Optional - if provided, only decay memories for this user-companion pair */
  userId?: string;
  companionId?: string;
  /** Decay rate per cycle (default 0.01) */
  decayRate?: number;
}

export interface MemoryExpirationJob {
  /** No data needed - always processes all expired memories */
}

/**
 * Create the memory decay queue
 */
export function createMemoryDecayQueue(connection: Redis): Queue<MemoryDecayJob> {
  return new Queue<MemoryDecayJob>(MEMORY_DECAY_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000,
      },
      removeOnComplete: {
        count: 50,
        age: 86400, // 24 hours
      },
      removeOnFail: {
        count: 200,
        age: 604800, // 7 days
      },
    },
  });
}

/**
 * Create the memory expiration queue
 */
export function createMemoryExpirationQueue(connection: Redis): Queue<MemoryExpirationJob> {
  return new Queue<MemoryExpirationJob>(MEMORY_EXPIRATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 15000,
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
