import { Worker, Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { EmailJobDataSchema, type EmailJobData, getEmailService } from './service.js';
import type { DbClient } from '../db/client.js';

interface EmailWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
  rateLimitPerSecond?: number;
}

export class EmailProjectionWorker {
  private worker: Worker<EmailJobData> | null = null;
  private config: EmailWorkerConfig;
  private rateLimitPerSecond: number;

  constructor(config: EmailWorkerConfig) {
    this.config = config;
    this.rateLimitPerSecond =
      config.rateLimitPerSecond || parseInt(process.env.SES_MAX_SEND_RATE || '14');
  }

  async start(): Promise<void> {
    const emailService = getEmailService({
      connection: this.config.connection,
      db: this.config.db,
      logger: this.config.logger,
    });

    this.worker = new Worker<EmailJobData>(
      'email',
      async (job) => this.process(job, emailService),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 5,
        limiter: {
          max: this.rateLimitPerSecond,
          duration: 1000,
        },
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.debug({ jobId: job.id }, 'Email job completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error({ jobId: job?.id, error: err.message }, 'Email job failed');
    });

    this.worker.on('stalled', (jobId) => {
      this.config.logger.warn({ jobId }, 'Email job stalled');
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 5, rateLimit: this.rateLimitPerSecond },
      'Email worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Email worker stopped');
    }
  }

  private async process(
    job: Job<EmailJobData>,
    emailService: ReturnType<typeof getEmailService>
  ): Promise<{ messageId: string }> {
    const { data } = job;

    // Validate job data
    const parseResult = EmailJobDataSchema.safeParse(data);
    if (!parseResult.success) {
      this.config.logger.error(
        { jobId: job.id, errors: parseResult.error.flatten() },
        'Invalid email job data'
      );
      throw new Error('Invalid email job data');
    }

    try {
      const result = await emailService.processEmail(parseResult.data);
      return result;
    } catch (error) {
      // Log failure and potentially requeue
      await emailService.handleFailure(parseResult.data, error as Error);
      throw error;
    }
  }
}
