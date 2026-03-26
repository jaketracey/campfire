/**
 * Telegram & Messaging Routes
 * Webhook endpoints for Telegram bots and messaging channel management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { getMessagingChannelsRepository } from '../repositories/messaging-channels.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import {
  getTelegramBotManager,
  encryptBotToken,
  deriveBotId,
  decryptBotToken,
} from '../services/telegram.js';
import { logger } from '../observability/logger.js';

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateChannelSchema = z.object({
  companionId: z.string().uuid(),
  platform: z.enum(['telegram', 'discord', 'whatsapp', 'sms']),
});

const VerifyLinkCodeSchema = z.object({
  code: z.string().min(4).max(20),
  platformUserId: z.string().min(1).max(255),
  platformChannelId: z.string().min(1).max(255),
  platformBotId: z.string().min(1).max(255),
});

const ConfigureTelegramSchema = z.object({
  botToken: z.string().min(10).max(255),
});

// ============================================================================
// Telegram Webhook Routes
// ============================================================================

/**
 * Register Telegram webhook routes (at root level, not under /api/v1)
 */
export async function telegramWebhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/telegram/:botId - Telegram webhook endpoint
   * Called by Telegram servers when a message is received.
   * No authentication required (Telegram uses webhook secrets internally).
   */
  app.post('/:botId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { botId } = request.params as { botId: string };

    const botManager = getTelegramBotManager();

    try {
      // Pass the raw Telegram update to Grammy's bot.handleUpdate()
      const handled = await botManager.handleUpdate(botId, request.body as import('grammy/types').Update);
      if (!handled) {
        logger.warn({ botId }, 'Telegram webhook received for unknown bot');
      }
      // Always return 200 to Telegram to acknowledge receipt
      return reply.status(200).send({ ok: true });
    } catch (error) {
      logger.error({ botId, error }, 'Error processing Telegram webhook');
      // Return 200 to avoid Telegram retrying on our errors
      return reply.status(200).send({ ok: true });
    }
  });
}

// ============================================================================
// Messaging Channel Management Routes
// ============================================================================

/**
 * Register messaging channel management routes (under /api/v1/messaging)
 */
export async function messagingRoutes(app: FastifyInstance): Promise<void> {
  const channelRepo = getMessagingChannelsRepository();
  const companionRepo = getCompanionsRepository();

  /**
   * POST /messaging/channels - Generate a link code to connect a companion to Telegram
   */
  app.post('/channels', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateChannelSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { companionId, platform } = parseResult.data;
    const userId = request.user!.userId;

    // Verify companion exists and user has access
    const companion = await companionRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    if (companion.user_id !== userId && !companion.is_public) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this companion',
      });
    }

    // Check if there's a Telegram bot configured for this companion
    if (platform === 'telegram') {
      const botConfig = await channelRepo.findTelegramBotConfig(companionId);
      if (!botConfig || !botConfig.is_active) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Telegram is not configured for this companion. An admin must set up the bot first.',
        });
      }

      // Generate link code
      const code = nanoid(8).toUpperCase();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      const botId = deriveBotId(decryptBotToken(botConfig.bot_token_encrypted));

      await channelRepo.createLinkCode({
        code,
        user_id: userId,
        companion_id: companionId,
        platform,
        platform_bot_id: botId,
        expires_at: expiresAt,
      });

      logger.info(
        { userId, companionId, platform, code },
        'Messaging link code generated'
      );

      return reply.status(201).send({
        code,
        platform,
        companionId,
        botUsername: botConfig.bot_username,
        expiresAt: expiresAt.toISOString(),
        instructions: `Send /link ${code} to @${botConfig.bot_username || 'the bot'} on Telegram`,
      });
    }

    // Other platforms not yet supported
    return reply.status(400).send({
      error: 'Bad Request',
      message: `Platform "${platform}" is not yet supported`,
    });
  });

  /**
   * POST /messaging/channels/verify - Verify a link code (internal/service use)
   */
  app.post('/channels/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = VerifyLinkCodeSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { code, platformUserId, platformChannelId, platformBotId } = parseResult.data;

    const linkCode = await channelRepo.consumeLinkCode(code.toUpperCase());
    if (!linkCode) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid or expired link code',
      });
    }

    if (linkCode.platform_bot_id !== platformBotId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Link code does not match this bot',
      });
    }

    // Create or reactivate channel
    const existing = await channelRepo.findByUserCompanionPlatform(
      linkCode.user_id,
      linkCode.companion_id,
      linkCode.platform
    );

    let channel;
    if (existing) {
      channel = await channelRepo.update(existing.id, {
        is_active: true,
        platform_channel_id: platformChannelId,
      });
    } else {
      channel = await channelRepo.create({
        user_id: linkCode.user_id,
        companion_id: linkCode.companion_id,
        platform: linkCode.platform,
        platform_channel_id: platformChannelId,
        platform_user_id: platformUserId,
        platform_bot_id: platformBotId,
      });
    }

    return reply.status(201).send({
      id: channel.id,
      userId: channel.user_id,
      companionId: channel.companion_id,
      platform: channel.platform,
      isActive: channel.is_active,
      createdAt: channel.created_at,
    });
  });

  /**
   * GET /messaging/channels - List user's messaging channels
   */
  app.get('/channels', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      platform,
      companionId,
      limit = '50',
      offset = '0',
    } = request.query as {
      platform?: string;
      companionId?: string;
      limit?: string;
      offset?: string;
    };

    const result = await channelRepo.listByUser({
      userId: request.user!.userId,
      platform,
      companionId,
      isActive: true,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      channels: result.data.map((c) => ({
        id: c.id,
        companionId: c.companion_id,
        platform: c.platform,
        platformChannelId: c.platform_channel_id,
        isActive: c.is_active,
        lastMessageAt: c.last_message_at,
        messageCount: c.message_count,
        createdAt: c.created_at,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  /**
   * DELETE /messaging/channels/:id - Unlink a messaging channel
   */
  app.delete('/channels/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const channel = await channelRepo.findById(id);
    if (!channel) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Messaging channel not found',
      });
    }

    // Verify ownership
    if (channel.user_id !== request.user!.userId && request.user!.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this channel',
      });
    }

    await channelRepo.deactivate(id);

    logger.info(
      { channelId: id, userId: request.user!.userId, platform: channel.platform },
      'Messaging channel deactivated'
    );

    return reply.status(204).send();
  });
}

// ============================================================================
// Companion Telegram Config Routes
// ============================================================================

/**
 * Register companion Telegram configuration routes (under /api/v1/companions)
 */
export async function companionTelegramRoutes(app: FastifyInstance): Promise<void> {
  const channelRepo = getMessagingChannelsRepository();
  const companionRepo = getCompanionsRepository();

  /**
   * POST /companions/:id/telegram - Configure Telegram bot for a companion
   */
  app.post('/:id/telegram', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: companionId } = request.params as { id: string };

    // Only admins can configure Telegram bots (they hold bot tokens)
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins can configure Telegram bot tokens',
      });
    }

    const parseResult = ConfigureTelegramSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const companion = await companionRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    const { botToken } = parseResult.data;

    try {
      // Register the bot (this validates the token with Telegram API)
      const botManager = getTelegramBotManager();
      const { botId, botUsername } = await botManager.registerBot(companionId, botToken);

      logger.info(
        { companionId, botUsername, userId: request.user!.userId },
        'Telegram bot configured for companion'
      );

      return reply.status(201).send({
        companionId,
        botId,
        botUsername,
        isActive: true,
        message: `Bot @${botUsername} is now active for ${companion.name}`,
      });
    } catch (error) {
      logger.error({ companionId, error }, 'Failed to configure Telegram bot');
      return reply.status(400).send({
        error: 'Bad Request',
        message: error instanceof Error ? error.message : 'Failed to configure Telegram bot. Check the bot token.',
      });
    }
  });

  /**
   * GET /companions/:id/telegram - Get Telegram bot config for a companion
   */
  app.get('/:id/telegram', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: companionId } = request.params as { id: string };

    const companion = await companionRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Check access
    if (companion.user_id !== request.user!.userId && request.user!.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this companion',
      });
    }

    const config = await channelRepo.findTelegramBotConfig(companionId);
    if (!config) {
      return reply.send({
        configured: false,
        companionId,
      });
    }

    return reply.send({
      configured: true,
      companionId,
      botUsername: config.bot_username,
      webhookUrl: config.webhook_url,
      isActive: config.is_active,
      createdAt: config.created_at,
    });
  });

  /**
   * DELETE /companions/:id/telegram - Remove Telegram integration
   */
  app.delete('/:id/telegram', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: companionId } = request.params as { id: string };

    if (request.user!.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins can remove Telegram bot configuration',
      });
    }

    const companion = await companionRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    // Unregister the bot
    const botManager = getTelegramBotManager();
    await botManager.unregisterBot(companionId);

    // Remove from DB
    await channelRepo.deactivateTelegramBotConfig(companionId);

    logger.info(
      { companionId, userId: request.user!.userId },
      'Telegram bot removed from companion'
    );

    return reply.status(204).send();
  });
}
