/**
 * Proactive Outreach Worker
 *
 * BullMQ worker that evaluates user-companion pairs for proactive outreach.
 * For eligible pairs, calls the orchestrator to generate a message and
 * stores it for delivery.
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import {
  PROACTIVE_OUTREACH_QUEUE,
  type ProactiveOutreachJob,
} from './queues.js';

interface ProactiveWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  orchestratorUrl: string;
  internalServiceKey: string;
  gatewayUrl: string;
  concurrency?: number;
}

interface OutreachDecision {
  should_reach_out: boolean;
  trigger: string;
  message?: string;
  confidence: number;
  reasoning: string;
}

/**
 * Process proactive outreach evaluation.
 *
 * If specific user/companion are provided, evaluates just that pair.
 * Otherwise, queries all active pairs that are eligible.
 */
export async function processProactiveOutreach(
  config: ProactiveWorkerConfig,
  data: ProactiveOutreachJob
): Promise<{ evaluated: number; sent: number }> {
  let evaluated = 0;
  let sent = 0;

  if (data.userId && data.companionId) {
    // Evaluate a specific pair
    const result = await evaluatePair(
      config,
      data.userId,
      data.companionId
    );
    evaluated = 1;
    sent = result ? 1 : 0;
  } else {
    // Get all active user-companion pairs with interactions
    const pairs = await getActiveUserCompanionPairs(config.db);

    config.logger.info(
      { totalPairs: pairs.length },
      'Evaluating active pairs for proactive outreach'
    );

    for (const pair of pairs) {
      try {
        const result = await evaluatePair(config, pair.user_id, pair.companion_id);
        evaluated++;
        if (result) sent++;
      } catch (err) {
        config.logger.warn(
          { userId: pair.user_id, companionId: pair.companion_id, error: err },
          'Failed to evaluate outreach for pair'
        );
      }
    }
  }

  config.logger.info(
    { evaluated, sent },
    'Proactive outreach evaluation completed'
  );

  return { evaluated, sent };
}

/**
 * Evaluate a single user-companion pair and store the outreach if approved.
 */
async function evaluatePair(
  config: ProactiveWorkerConfig,
  userId: string,
  companionId: string
): Promise<boolean> {
  try {
    // Call orchestrator to evaluate
    const response = await fetch(`${config.orchestratorUrl}/proactive/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        companion_id: companionId,
      }),
    });

    if (!response.ok) {
      config.logger.warn(
        { userId, companionId, status: response.status },
        'Orchestrator evaluation returned non-OK'
      );
      return false;
    }

    const data = await response.json() as { decision: OutreachDecision };
    const decision = data.decision;

    if (!decision.should_reach_out || !decision.message) {
      config.logger.debug(
        { userId, companionId, reasoning: decision.reasoning },
        'Outreach declined'
      );
      return false;
    }

    // Store the outreach record via gateway
    const storeResponse = await fetch(`${config.gatewayUrl}/api/v1/outreach/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': config.internalServiceKey,
      },
      body: JSON.stringify({
        user_id: userId,
        companion_id: companionId,
        trigger: decision.trigger,
        message: decision.message,
        delivered_via: 'stored',
        metadata: {
          confidence: decision.confidence,
          reasoning: decision.reasoning,
        },
      }),
    });

    if (!storeResponse.ok) {
      config.logger.error(
        { userId, companionId, status: storeResponse.status },
        'Failed to store outreach record'
      );
      return false;
    }

    config.logger.info(
      { userId, companionId, trigger: decision.trigger },
      'Proactive outreach stored for delivery'
    );

    return true;
  } catch (err) {
    config.logger.error(
      { userId, companionId, error: err },
      'Error evaluating outreach pair'
    );
    return false;
  }
}

/**
 * Get all distinct user-companion pairs with active sessions.
 */
async function getActiveUserCompanionPairs(
  db: DbClient
): Promise<Array<{ user_id: string; companion_id: string }>> {
  const result = await db.sql`
    SELECT DISTINCT s.user_id, s.companion_id
    FROM sessions s
    WHERE s.user_id != '00000000-0000-0000-0000-000000000000'
  `;

  return result as unknown as Array<{ user_id: string; companion_id: string }>;
}

/**
 * Proactive Outreach Worker
 */
export class ProactiveOutreachWorker {
  private worker: Worker<ProactiveOutreachJob> | null = null;
  private config: ProactiveWorkerConfig;

  constructor(config: ProactiveWorkerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.worker = new Worker<ProactiveOutreachJob>(
      PROACTIVE_OUTREACH_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 1,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info(
        { jobId: job.id },
        'Proactive outreach job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Proactive outreach job failed'
      );
    });

    this.config.logger.info('Proactive outreach worker started');
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Proactive outreach worker stopped');
    }
  }

  private async process(
    job: Job<ProactiveOutreachJob>
  ): Promise<{ evaluated: number; sent: number }> {
    return processProactiveOutreach(this.config, job.data);
  }
}
