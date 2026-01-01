import { Worker, Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import Anthropic from '@anthropic-ai/sdk';
import type { DbClient } from '../db/client.js';

interface SummaryJobData {
  type: 'session' | 'daily' | 'weekly';
  userId: string;
  companionId: string;
  resourceId: string;
}

interface WorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
}

export class SummaryProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;
  private anthropic: Anthropic;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async start() {
    this.worker = new Worker<SummaryJobData>(
      'summary-projection',
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: 3,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info({ jobId: job.id }, 'Summary projection completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Summary projection failed'
      );
    });

    this.config.logger.info('Summary projection worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<SummaryJobData>): Promise<void> {
    const { type, userId, companionId, resourceId } = job.data;

    switch (type) {
      case 'session':
        await this.summarizeSession(userId, companionId, resourceId);
        break;
      case 'daily':
        await this.summarizeDaily(userId, companionId, resourceId);
        break;
      case 'weekly':
        await this.summarizeWeekly(userId, companionId, resourceId);
        break;
    }
  }

  private async summarizeSession(
    userId: string,
    companionId: string,
    sessionId: string
  ): Promise<void> {
    const session = await this.config.db.getSession(sessionId);
    if (!session) return;

    const turns = await this.config.db.getTurnsBySession(sessionId);
    if (turns.length === 0) return;

    // Build conversation transcript
    const transcript = turns
      .map(
        (t) =>
          `User: ${t.user_message || '[no message]'}\nAssistant: ${t.agent_message || '[no response]'}`
      )
      .join('\n\n');

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Summarize this conversation in 2-3 sentences, capturing the key topics discussed and any important information learned about the user:\n\n${transcript}`,
        },
      ],
    });

    const summary =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Store session summary
    await this.config.db.sql`
      UPDATE sessions
      SET summary = ${summary}
      WHERE id = ${sessionId}
    `;

    this.config.logger.info(
      { userId, sessionId },
      'Session summary generated'
    );
  }

  private async summarizeDaily(
    userId: string,
    companionId: string,
    dateStr: string
  ): Promise<void> {
    // Get all sessions for the day
    const sessions = await this.config.db.sql`
      SELECT id, summary FROM sessions
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND DATE(started_at) = ${dateStr}
        AND summary IS NOT NULL
    `;

    if (sessions.length === 0) return;

    const summaries = sessions.map((s) => s.summary).join('\n\n');

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Create a brief daily summary from these conversation summaries:\n\n${summaries}`,
        },
      ],
    });

    const dailySummary =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Store daily summary (could be in a separate table or vault file)
    this.config.logger.info(
      { userId, dateStr, summary: dailySummary },
      'Daily summary generated'
    );
  }

  private async summarizeWeekly(
    userId: string,
    companionId: string,
    weekStartDate: string
  ): Promise<void> {
    // Similar to daily but aggregates a week's worth of summaries
    this.config.logger.info(
      { userId, weekStartDate },
      'Weekly summary generation triggered'
    );
  }
}
