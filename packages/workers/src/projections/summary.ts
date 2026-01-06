import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { renderPromptFromDb } from '../lib/prompt-runtime.js';
import { env } from '../env.js';

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

interface OllamaResponse {
  message: { content: string };
  model: string;
  done: boolean;
}

export class SummaryProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;
  private ollamaBaseUrl: string;
  private ollamaModel: string;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.ollamaBaseUrl = env.OLLAMA_BASE_URL.replace(/\/$/, '');
    this.ollamaModel = env.OLLAMA_MODEL;
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

  private async generateWithOllama(prompt: string, maxTokens: number = 500): Promise<string> {
    const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          num_predict: maxTokens,
          temperature: 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaResponse;
    return data.message?.content || '';
  }

  private async summarizeSession(
    userId: string,
    _companionId: string,
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

    const { rendered: prompt } = await renderPromptFromDb(this.config.db.sql, {
      key: 'workers.session_summary_prompt',
      variables: { transcript },
    });

    const summary = await this.generateWithOllama(prompt, 500);

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

    const { rendered: prompt } = await renderPromptFromDb(this.config.db.sql, {
      key: 'workers.daily_summary_prompt',
      companionId,
      variables: { summaries },
    });

    const dailySummary = await this.generateWithOllama(prompt, 300);

    // Store daily summary (could be in a separate table or vault file)
    this.config.logger.info(
      { userId, dateStr, summary: dailySummary },
      'Daily summary generated'
    );
  }

  private async summarizeWeekly(
    userId: string,
    _companionId: string,
    weekStartDate: string
  ): Promise<void> {
    // Similar to daily but aggregates a week's worth of summaries
    this.config.logger.info(
      { userId, weekStartDate },
      'Weekly summary generation triggered'
    );
  }
}
