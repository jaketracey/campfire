/**
 * Messaging Inbound Worker
 *
 * Processes inbound messages from external platforms (Telegram, Discord, etc.).
 * Calls the orchestrator to generate AI responses, then sends them back
 * via the appropriate platform API.
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { MESSAGING_INBOUND_QUEUE, type MessagingInboundJobData } from './queues.js';
import { env } from '../env.js';

// ============================================================================
// Types
// ============================================================================

interface MessagingWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
}

interface OrchestratorResponse {
  response: string;
  tool_calls?: unknown[];
  tool_results?: unknown[];
}

// ============================================================================
// Processing Logic
// ============================================================================

/**
 * Process an inbound messaging job:
 * 1. Look up companion spec
 * 2. Call orchestrator with the user's message
 * 3. Send the response back via platform API
 */
export async function processInboundMessage(
  db: DbClient,
  log: Logger,
  data: MessagingInboundJobData
): Promise<{ responded: boolean; responseLength: number }> {
  const { channelId, userId, companionId, platform, text, platformChannelId } = data;

  log.info(
    { channelId, userId, companionId, platform, textLength: text.length },
    'Processing inbound messaging job'
  );

  // 1. Look up companion spec from DB
  const companionResult = await db.sql`
    SELECT id, name, spec, status FROM companions WHERE id = ${companionId}
  `;
  const companion = companionResult[0] as { id: string; name: string; spec: Record<string, unknown>; status: string } | undefined;

  if (!companion || companion.status !== 'active') {
    log.warn({ companionId }, 'Companion not found or inactive');
    return { responded: false, responseLength: 0 };
  }

  // 2. Get or create a session for this messaging channel
  const sessionResult = await db.sql`
    SELECT id FROM sessions
    WHERE user_id = ${userId}
      AND companion_id = ${companionId}
      AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1
  `;
  let sessionId: string;

  if (sessionResult.length > 0) {
    sessionId = (sessionResult[0] as { id: string }).id;
  } else {
    // Create a new session for this messaging channel
    const newSession = await db.sql`
      INSERT INTO sessions (user_id, companion_id, metadata)
      VALUES (${userId}, ${companionId}, '{"source": "messaging", "platform": "${platform}"}'::jsonb)
      RETURNING id
    `;
    sessionId = (newSession[0] as { id: string }).id;
    log.info({ sessionId, userId, companionId, platform }, 'Created new session for messaging channel');
  }

  // 3. Get recent turns for context
  const turnsResult = await db.sql`
    SELECT user_message, agent_message FROM session_turns
    WHERE session_id = ${sessionId}
    ORDER BY turn_number DESC
    LIMIT 10
  `;
  const recentTurns = (turnsResult as unknown as Array<{ user_message: string; agent_message: string }>)
    .reverse()
    .map((t) => ({
      user: t.user_message,
      assistant: t.agent_message,
    }));

  // 4. Call orchestrator (non-streaming)
  const orchestratorUrl = `${env.ORCHESTRATOR_URL}/message`;
  let responseText = '';

  try {
    const orchestratorRequest = {
      session_id: sessionId,
      user_id: userId,
      companion_spec: companion.spec,
      user_message: text,
      recent_turns: recentTurns,
      session_summary: null,
      long_term_memories: null,
      companion_self_knowledge: null,
      source: `messaging:${platform}`,
    };

    const response = await fetch(orchestratorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orchestratorRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText }, 'Orchestrator request failed');
      return { responded: false, responseLength: 0 };
    }

    const result = await response.json() as OrchestratorResponse;
    responseText = result.response || '';
  } catch (error) {
    log.error({ error, channelId }, 'Failed to call orchestrator');
    return { responded: false, responseLength: 0 };
  }

  if (!responseText) {
    log.warn({ channelId }, 'Empty response from orchestrator');
    return { responded: false, responseLength: 0 };
  }

  // 5. Save the turn
  const turnCountResult = await db.sql`
    SELECT COALESCE(MAX(turn_number), 0) + 1 as next_turn FROM session_turns
    WHERE session_id = ${sessionId}
  `;
  const nextTurn = (turnCountResult[0] as { next_turn: number }).next_turn;

  await db.sql`
    INSERT INTO session_turns (session_id, turn_number, user_message, user_message_type, agent_message, agent_message_type)
    VALUES (${sessionId}, ${nextTurn}, ${text}, 'text', ${responseText}, 'text')
  `;

  // 6. Send response back via platform API
  const sent = await sendPlatformResponse(platform, companionId, platformChannelId, responseText, log);

  // 7. Update message count on channel
  await db.sql`
    UPDATE messaging_channels
    SET message_count = message_count + 1, last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${channelId}
  `;

  log.info(
    { channelId, companionId, platform, responseLength: responseText.length, sent },
    'Inbound message processed'
  );

  return { responded: sent, responseLength: responseText.length };
}

/**
 * Send a response message back to the user via their messaging platform
 */
async function sendPlatformResponse(
  platform: string,
  companionId: string,
  platformChannelId: string,
  text: string,
  log: Logger
): Promise<boolean> {
  // For Telegram, we need to call the Telegram Bot API directly from the worker
  // since the TelegramBotManager lives in the gateway process.
  // We use the gateway's internal API or call Telegram directly.

  if (platform === 'telegram') {
    return await sendTelegramResponse(companionId, platformChannelId, text, log);
  }

  log.warn({ platform }, 'Unsupported messaging platform for response');
  return false;
}

/**
 * Send a Telegram message by looking up the bot token from the DB
 * and calling the Telegram Bot API directly.
 */
async function sendTelegramResponse(
  companionId: string,
  chatId: string,
  text: string,
  log: Logger
): Promise<boolean> {
  try {
    // We need to look up the bot token from environment or DB
    // For workers, we can call the Telegram API directly
    // The bot token is stored encrypted in telegram_bot_configs
    // For simplicity in the worker, we use an HTTP call to Telegram
    // In production, you'd decrypt the token from DB

    // Use the gateway's internal endpoint to send the message
    const gatewayUrl = process.env['GATEWAY_INTERNAL_URL'] || 'http://localhost:3001';
    const response = await fetch(`${gatewayUrl}/api/v1/messaging/internal/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env['INTERNAL_SERVICE_KEY'] || '',
      },
      body: JSON.stringify({
        companionId,
        platform: 'telegram',
        platformChannelId: chatId,
        text,
      }),
    });

    if (!response.ok) {
      log.error({ status: response.status, companionId, chatId }, 'Failed to send via gateway');
      return false;
    }

    return true;
  } catch (error) {
    log.error({ error, companionId, chatId }, 'Failed to send Telegram response');
    return false;
  }
}

// ============================================================================
// Worker Class
// ============================================================================

export class MessagingInboundWorker {
  private worker: Worker<MessagingInboundJobData>;
  private logger: Logger;

  constructor(config: MessagingWorkerConfig) {
    this.logger = config.logger;

    this.worker = new Worker<MessagingInboundJobData>(
      MESSAGING_INBOUND_QUEUE,
      async (job: Job<MessagingInboundJobData>) => {
        return processInboundMessage(config.db, this.logger, job.data);
      },
      {
        connection: config.connection,
        concurrency: config.concurrency ?? 5,
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(
        { jobId: job.id, channelId: job.data.channelId },
        'Messaging inbound job completed'
      );
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { jobId: job?.id, channelId: job?.data.channelId, error: error.message },
        'Messaging inbound job failed'
      );
    });
  }

  async start(): Promise<void> {
    this.logger.info('MessagingInboundWorker started');
  }

  async stop(): Promise<void> {
    await this.worker.close();
    this.logger.info('MessagingInboundWorker stopped');
  }
}
