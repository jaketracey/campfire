/**
 * Worker Job Processing Performance Tests
 * 
 * Measures worker job processing speed and queue throughput
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

// Performance thresholds
const THRESHOLDS = {
  jobProcessing: { p50: 100, p95: 300, p99: 500 },
  queueThroughput: {
    minJobsPerSecond: 100,
  },
  jobLatency: { p50: 50, p95: 150, p99: 300 },
} as const;

interface TestJobData {
  id: string;
  timestamp: number;
  payload: string;
}

// Helper functions
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, index)];
}

function calculateMetrics(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((acc, val) => acc + val, 0);

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / durations.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: durations.length,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

describe('Worker Job Processing Performance', () => {
  let redis: Redis;
  let queue: Queue<TestJobData>;
  let worker: Worker<TestJobData>;

  const queueName = 'test-performance-queue';
  const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
  };

  beforeAll(async () => {
    redis = new Redis(redisConnection);
    
    // Clean up any existing queue data
    await redis.del(`bull:${queueName}:id`);
    await redis.del(`bull:${queueName}:wait`);
    await redis.del(`bull:${queueName}:active`);
    await redis.del(`bull:${queueName}:completed`);
    await redis.del(`bull:${queueName}:failed`);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should measure single job processing time', async () => {
    const processingTimes: number[] = [];
    const jobCount = 100;

    queue = new Queue<TestJobData>(queueName, { connection: redisConnection });

    worker = new Worker<TestJobData>(
      queueName,
      async (job: Job<TestJobData>) => {
        const start = performance.now();
        
        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 10));
        
        const duration = performance.now() - start;
        processingTimes.push(duration);
        
        return { processed: true };
      },
      { connection: redisConnection, concurrency: 1 }
    );

    // Add jobs
    for (let i = 0; i < jobCount; i++) {
      await queue.add('test-job', {
        id: `job-${i}`,
        timestamp: Date.now(),
        payload: 'test data',
      });
    }

    // Wait for all jobs to complete
    await worker.waitUntilReady();
    
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        if (completed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    const metrics = calculateMetrics(processingTimes);
    
    console.log('\nSingle Job Processing Time:');
    console.log(`  p50: ${formatDuration(metrics.p50)}`);
    console.log(`  p95: ${formatDuration(metrics.p95)}`);
    console.log(`  p99: ${formatDuration(metrics.p99)}`);
    console.log(`  mean: ${formatDuration(metrics.mean)}`);

    await worker.close();
    await queue.close();

    expect(metrics.p95).toBeLessThan(THRESHOLDS.jobProcessing.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.jobProcessing.p99);
  });

  it('should measure concurrent job processing', async () => {
    const processingTimes: number[] = [];
    const jobCount = 200;
    const concurrency = 10;

    queue = new Queue<TestJobData>(queueName + '-concurrent', { connection: redisConnection });

    worker = new Worker<TestJobData>(
      queueName + '-concurrent',
      async (job: Job<TestJobData>) => {
        const start = performance.now();
        
        // Simulate varying work load
        const workTime = Math.random() * 20 + 10; // 10-30ms
        await new Promise((resolve) => setTimeout(resolve, workTime));
        
        const duration = performance.now() - start;
        processingTimes.push(duration);
        
        return { processed: true };
      },
      { connection: redisConnection, concurrency }
    );

    const startTime = performance.now();

    // Add jobs
    const addPromises = [];
    for (let i = 0; i < jobCount; i++) {
      addPromises.push(
        queue.add('test-job', {
          id: `job-${i}`,
          timestamp: Date.now(),
          payload: 'test data',
        })
      );
    }
    await Promise.all(addPromises);

    // Wait for all jobs to complete
    await worker.waitUntilReady();
    
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        if (completed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    const totalTime = performance.now() - startTime;
    const metrics = calculateMetrics(processingTimes);
    const throughput = (jobCount / totalTime) * 1000; // jobs per second

    console.log('\nConcurrent Job Processing:');
    console.log(`  Concurrency: ${concurrency}`);
    console.log(`  Total Jobs: ${jobCount}`);
    console.log(`  Total Time: ${formatDuration(totalTime)}`);
    console.log(`  Throughput: ${throughput.toFixed(2)} jobs/s`);
    console.log(`  p50: ${formatDuration(metrics.p50)}`);
    console.log(`  p95: ${formatDuration(metrics.p95)}`);

    await worker.close();
    await queue.close();

    expect(throughput).toBeGreaterThan(THRESHOLDS.queueThroughput.minJobsPerSecond);
  });

  it('should measure job latency (time from add to start)', async () => {
    const latencies: number[] = [];
    const jobCount = 50;

    queue = new Queue<TestJobData>(queueName + '-latency', { connection: redisConnection });

    worker = new Worker<TestJobData>(
      queueName + '-latency',
      async (job: Job<TestJobData>) => {
        const latency = Date.now() - job.data.timestamp;
        latencies.push(latency);
        
        // Quick processing
        await new Promise((resolve) => setTimeout(resolve, 5));
        
        return { processed: true };
      },
      { connection: redisConnection, concurrency: 5 }
    );

    await worker.waitUntilReady();

    // Add jobs
    for (let i = 0; i < jobCount; i++) {
      await queue.add('test-job', {
        id: `job-${i}`,
        timestamp: Date.now(),
        payload: 'test data',
      });
      
      // Small delay between adds
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Wait for all jobs to complete
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        if (completed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    const metrics = calculateMetrics(latencies);

    console.log('\nJob Latency (Add to Process Start):');
    console.log(`  p50: ${formatDuration(metrics.p50)}`);
    console.log(`  p95: ${formatDuration(metrics.p95)}`);
    console.log(`  p99: ${formatDuration(metrics.p99)}`);
    console.log(`  mean: ${formatDuration(metrics.mean)}`);

    await worker.close();
    await queue.close();

    expect(metrics.p95).toBeLessThan(THRESHOLDS.jobLatency.p95);
    expect(metrics.p99).toBeLessThan(THRESHOLDS.jobLatency.p99);
  });

  it('should measure queue backlog handling', async () => {
    const processingTimes: number[] = [];
    const jobCount = 500;
    const concurrency = 5;

    queue = new Queue<TestJobData>(queueName + '-backlog', { connection: redisConnection });

    // Add all jobs first to create backlog
    const startAdd = performance.now();
    for (let i = 0; i < jobCount; i++) {
      await queue.add('test-job', {
        id: `job-${i}`,
        timestamp: Date.now(),
        payload: 'x'.repeat(1000), // 1KB payload
      });
    }
    const addTime = performance.now() - startAdd;

    console.log(`\nAdded ${jobCount} jobs in ${formatDuration(addTime)}`);

    // Now start worker to process backlog
    const startProcess = performance.now();

    worker = new Worker<TestJobData>(
      queueName + '-backlog',
      async (job: Job<TestJobData>) => {
        const start = performance.now();
        
        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 5));
        
        const duration = performance.now() - start;
        processingTimes.push(duration);
        
        return { processed: true };
      },
      { connection: redisConnection, concurrency }
    );

    await worker.waitUntilReady();

    // Wait for all jobs to complete
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        if (completed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    const processTime = performance.now() - startProcess;
    const metrics = calculateMetrics(processingTimes);
    const throughput = (jobCount / processTime) * 1000;

    console.log('\nBacklog Processing:');
    console.log(`  Jobs: ${jobCount}`);
    console.log(`  Concurrency: ${concurrency}`);
    console.log(`  Process Time: ${formatDuration(processTime)}`);
    console.log(`  Throughput: ${throughput.toFixed(2)} jobs/s`);
    console.log(`  Avg Processing: ${formatDuration(metrics.mean)}`);

    await worker.close();
    await queue.close();

    expect(throughput).toBeGreaterThan(50); // At least 50 jobs/s
  });

  it('should measure job priority handling', async () => {
    const processOrder: string[] = [];
    const jobCount = 30;

    queue = new Queue<TestJobData>(queueName + '-priority', { connection: redisConnection });

    worker = new Worker<TestJobData>(
      queueName + '-priority',
      async (job: Job<TestJobData>) => {
        processOrder.push(job.data.id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { processed: true };
      },
      { connection: redisConnection, concurrency: 1 }
    );

    await worker.waitUntilReady();

    // Add jobs with varying priorities
    for (let i = 0; i < jobCount; i++) {
      const priority = i % 3 === 0 ? 1 : i % 3 === 1 ? 5 : 10; // High, medium, low
      await queue.add(
        'test-job',
        {
          id: `job-${i}-priority-${priority}`,
          timestamp: Date.now(),
          payload: 'test data',
        },
        { priority }
      );
    }

    // Wait for all jobs to complete
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        if (completed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    console.log('\nJob Priority Handling:');
    console.log(`  Total Jobs: ${jobCount}`);
    console.log(`  First 5 Processed: ${processOrder.slice(0, 5).join(', ')}`);

    // High priority jobs should be processed first
    const firstFive = processOrder.slice(0, 5);
    const highPriorityCount = firstFive.filter((id) => id.includes('priority-1')).length;

    console.log(`  High Priority in First 5: ${highPriorityCount}`);

    await worker.close();
    await queue.close();

    expect(highPriorityCount).toBeGreaterThan(0); // At least some high priority jobs processed first
  });

  it('should measure failed job retry performance', async () => {
    const retryAttempts = new Map<string, number>();
    const successfulRetries: string[] = [];
    const jobCount = 20;

    queue = new Queue<TestJobData>(queueName + '-retry', { connection: redisConnection });

    worker = new Worker<TestJobData>(
      queueName + '-retry',
      async (job: Job<TestJobData>) => {
        const attempts = retryAttempts.get(job.data.id) || 0;
        retryAttempts.set(job.data.id, attempts + 1);

        // Fail on first attempt, succeed on retry
        if (attempts === 0) {
          throw new Error('Simulated failure');
        }

        successfulRetries.push(job.data.id);
        return { processed: true };
      },
      { connection: redisConnection, concurrency: 2 }
    );

    await worker.waitUntilReady();

    // Add jobs with retry configuration
    for (let i = 0; i < jobCount; i++) {
      await queue.add(
        'test-job',
        {
          id: `job-${i}`,
          timestamp: Date.now(),
          payload: 'test data',
        },
        {
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 100,
          },
        }
      );
    }

    // Wait for all jobs to either complete or fail permanently
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const completed = await queue.getCompletedCount();
        const failed = await queue.getFailedCount();
        if (completed + failed >= jobCount) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    console.log('\nFailed Job Retry:');
    console.log(`  Total Jobs: ${jobCount}`);
    console.log(`  Successful Retries: ${successfulRetries.length}`);
    console.log(`  Jobs with 2+ Attempts: ${Array.from(retryAttempts.values()).filter((a) => a >= 2).length}`);

    await worker.close();
    await queue.close();

    // All jobs should eventually succeed after retry
    expect(successfulRetries.length).toBe(jobCount);
  });
});
