/**
 * Telegram Bot Service
 * Manages Telegram bot instances for AI companion messaging.
 *
 * Each companion with Telegram enabled gets its own Bot instance.
 * Messages are processed asynchronously via the messaging-inbound BullMQ queue.
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { Update } from 'grammy/types';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../observability/logger.js';
import { getMessagingChannelsRepository } from '../repositories/messaging-channels.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { enqueueMessagingInboundJob } from '../utils/queue-messaging.js';
import type { MessagingInboundJobData } from '@campfire/shared';

// ============================================================================
// Types
// ============================================================================

interface ManagedBot {
  bot: Bot;
  companionId: string;
  botId: string; // Hash of bot token for identification
}

// ============================================================================
// Encryption helpers (simple AES-256 for bot token storage)
// ============================================================================

const ENCRYPTION_KEY_ENV = 'TELEGRAM_BOT_TOKEN_KEY';

function getEncryptionKey(): Buffer {
  const key = process.env[ENCRYPTION_KEY_ENV];
  if (!key) {
    // In development, derive from a default; in production this must be set
    return createHash('sha256').update('campfire-dev-telegram-key').digest();
  }
  return createHash('sha256').update(key).digest();
}

export function encryptBotToken(token: string): string {
  const { createCipheriv } = require('crypto') as typeof import('crypto');
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptBotToken(encrypted: string): string {
  const { createDecipheriv } = require('crypto') as typeof import('crypto');
  const key = getEncryptionKey();
  const [ivHex, data] = encrypted.split(':');
  if (!ivHex || !data) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Derive a stable bot ID from a bot token (hash it for safe storage/indexing)
 */
export function deriveBotId(botToken: string): string {
  return createHash('sha256').update(botToken).digest('hex').slice(0, 16);
}

// ============================================================================
// TelegramBotManager
// ============================================================================

export class TelegramBotManager {
  private bots = new Map<string, ManagedBot>();
  private baseWebhookUrl: string;

  constructor(baseWebhookUrl: string) {
    this.baseWebhookUrl = baseWebhookUrl;
  }

  /**
   * Register and start a bot for a companion
   */
  async registerBot(companionId: string, botToken: string): Promise<{ botId: string; botUsername: string }> {
    const botId = deriveBotId(botToken);

    // Stop existing bot if any
    if (this.bots.has(companionId)) {
      await this.unregisterBot(companionId);
    }

    const bot = new Bot(botToken);
    const channelRepo = getMessagingChannelsRepository();

    // Set up message handler
    bot.on('message:text', async (ctx: Context) => {
      await this.handleTextMessage(ctx, companionId, botId);
    });

    // Handle /start command (onboarding)
    bot.command('start', async (ctx: Context) => {
      await this.handleStartCommand(ctx, companionId, botId);
    });

    // Handle /link command (link verification)
    bot.command('link', async (ctx: Context) => {
      await this.handleLinkCommand(ctx, companionId, botId);
    });

    // Set up error handler
    bot.catch((err) => {
      logger.error(
        { companionId, botId, error: err.message },
        'Telegram bot error'
      );
    });

    // Get bot info
    const botInfo = await bot.api.getMe();

    // Initialize the bot (sets up internal middleware chain)
    await bot.init();

    // Set webhook URL with Telegram
    const webhookUrl = `${this.baseWebhookUrl}/webhooks/telegram/${botId}`;
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });

    this.bots.set(companionId, {
      bot,
      companionId,
      botId,
    });

    // Update DB config with bot username
    await channelRepo.upsertTelegramBotConfig(
      companionId,
      encryptBotToken(botToken),
      botInfo.username,
      webhookUrl
    );

    logger.info(
      { companionId, botId, botUsername: botInfo.username, webhookUrl },
      'Telegram bot registered'
    );

    return { botId, botUsername: botInfo.username };
  }

  /**
   * Unregister and stop a bot for a companion
   */
  async unregisterBot(companionId: string): Promise<void> {
    const managed = this.bots.get(companionId);
    if (!managed) {
      return;
    }

    try {
      await managed.bot.api.deleteWebhook();
    } catch (error) {
      logger.warn({ companionId, error }, 'Failed to delete Telegram webhook');
    }

    this.bots.delete(companionId);
    logger.info({ companionId }, 'Telegram bot unregistered');
  }

  /**
   * Handle a Telegram update for a specific bot ID
   * Called by the webhook route with the raw Telegram update object.
   */
  async handleUpdate(botId: string, update: Update): Promise<boolean> {
    const managed = this.getBotByBotId(botId);
    if (!managed) {
      return false;
    }
    await managed.bot.handleUpdate(update);
    return true;
  }

  /**
   * Get a managed bot by companion ID
   */
  getBot(companionId: string): ManagedBot | undefined {
    return this.bots.get(companionId);
  }

  /**
   * Get a managed bot by bot ID
   */
  getBotByBotId(botId: string): ManagedBot | undefined {
    for (const managed of this.bots.values()) {
      if (managed.botId === botId) {
        return managed;
      }
    }
    return undefined;
  }

  /**
   * Get all registered bot IDs
   */
  getRegisteredBotIds(): string[] {
    return Array.from(this.bots.values()).map((b) => b.botId);
  }

  /**
   * Check if a companion has a registered bot
   */
  isRegistered(companionId: string): boolean {
    return this.bots.has(companionId);
  }

  /**
   * Load and register all active bots from the database
   */
  async loadBotsFromDb(): Promise<number> {
    const channelRepo = getMessagingChannelsRepository();
    const configs = await channelRepo.findActiveTelegramBotConfigs();
    let count = 0;

    for (const config of configs) {
      try {
        const botToken = decryptBotToken(config.bot_token_encrypted);
        await this.registerBot(config.companion_id, botToken);
        count++;
      } catch (error) {
        logger.error(
          { companionId: config.companion_id, error },
          'Failed to load Telegram bot from database'
        );
      }
    }

    logger.info({ count, total: configs.length }, 'Loaded Telegram bots from database');
    return count;
  }

  /**
   * Stop all bots (for graceful shutdown)
   */
  async stopAll(): Promise<void> {
    const companionIds = Array.from(this.bots.keys());
    for (const companionId of companionIds) {
      await this.unregisterBot(companionId);
    }
    logger.info({ count: companionIds.length }, 'All Telegram bots stopped');
  }

  // --------------------------------------------------------------------------
  // Message Handlers
  // --------------------------------------------------------------------------

  private async handleTextMessage(ctx: Context, companionId: string, botId: string): Promise<void> {
    const message = ctx.message;
    if (!message || !message.text || !message.from) {
      return;
    }

    const platformUserId = String(message.from.id);
    const platformChannelId = String(message.chat.id);
    const channelRepo = getMessagingChannelsRepository();

    // Look up existing channel
    const channel = await channelRepo.findByPlatformUser(platformUserId, botId);

    if (!channel) {
      // User hasn't linked their account yet
      await ctx.reply(
        'Hello! To chat with me, you need to link your Campfire account first.\n\n' +
        '1. Open Campfire and go to your companion\'s settings\n' +
        '2. Click "Connect Telegram"\n' +
        '3. Copy the link code and send it here with /link YOUR_CODE\n\n' +
        'Example: /link ABC123'
      );
      return;
    }

    // Enqueue the message for async processing
    const jobData: MessagingInboundJobData = {
      channelId: channel.id,
      userId: channel.user_id,
      companionId: channel.companion_id,
      platform: 'telegram',
      platformMessageId: String(message.message_id),
      platformChannelId,
      text: message.text,
      senderPlatformId: platformUserId,
    };

    const enqueued = await enqueueMessagingInboundJob(jobData);
    if (!enqueued) {
      logger.error({ channelId: channel.id, companionId }, 'Failed to enqueue inbound message');
      await ctx.reply('Sorry, I\'m having trouble processing your message right now. Please try again later.');
      return;
    }

    // Increment message count
    await channelRepo.incrementMessageCount(channel.id);

    // Send a typing indicator while the message is being processed
    await ctx.replyWithChatAction('typing');
  }

  private async handleStartCommand(ctx: Context, companionId: string, botId: string): Promise<void> {
    const companionRepo = getCompanionsRepository();
    const companion = await companionRepo.findById(companionId);
    const companionName = companion?.name || 'your AI companion';

    await ctx.reply(
      `Welcome! I'm ${companionName} from Campfire.\n\n` +
      'To start chatting, link your Campfire account:\n' +
      '1. Open Campfire and go to companion settings\n' +
      '2. Click "Connect Telegram"\n' +
      '3. Send the code here with /link YOUR_CODE'
    );
  }

  private async handleLinkCommand(ctx: Context, companionId: string, botId: string): Promise<void> {
    const message = ctx.message;
    if (!message || !message.from) {
      return;
    }

    const text = message.text || '';
    const parts = text.split(/\s+/);
    const code = parts[1];

    if (!code) {
      await ctx.reply('Please provide your link code. Example: /link ABC123');
      return;
    }

    const channelRepo = getMessagingChannelsRepository();
    const linkCode = await channelRepo.consumeLinkCode(code.toUpperCase());

    if (!linkCode) {
      await ctx.reply('Invalid or expired link code. Please generate a new one from Campfire.');
      return;
    }

    // Verify the bot ID matches
    if (linkCode.platform_bot_id !== botId) {
      await ctx.reply('This code is for a different bot. Please check your link code.');
      return;
    }

    const platformUserId = String(message.from.id);
    const platformChannelId = String(message.chat.id);

    // Create or reactivate the messaging channel
    const existing = await channelRepo.findByUserCompanionPlatform(
      linkCode.user_id,
      linkCode.companion_id,
      'telegram'
    );

    if (existing) {
      // Reactivate existing channel
      await channelRepo.update(existing.id, {
        is_active: true,
        platform_channel_id: platformChannelId,
      });
      await ctx.reply('Your account has been re-linked! You can start chatting now.');
    } else {
      // Create new channel
      await channelRepo.create({
        user_id: linkCode.user_id,
        companion_id: linkCode.companion_id,
        platform: 'telegram',
        platform_channel_id: platformChannelId,
        platform_user_id: platformUserId,
        platform_bot_id: botId,
      });
      await ctx.reply('Account linked successfully! You can start chatting now. Just type a message!');
    }

    const companionRepo = getCompanionsRepository();
    const companion = await companionRepo.findById(linkCode.companion_id);

    logger.info(
      {
        userId: linkCode.user_id,
        companionId: linkCode.companion_id,
        companionName: companion?.name,
        platformUserId,
      },
      'Telegram account linked successfully'
    );
  }

  /**
   * Send a message to a Telegram chat
   */
  async sendMessage(
    companionId: string,
    chatId: string,
    text: string,
    replyToMessageId?: number
  ): Promise<boolean> {
    const managed = this.bots.get(companionId);
    if (!managed) {
      logger.warn({ companionId }, 'Cannot send message: bot not registered');
      return false;
    }

    try {
      await managed.bot.api.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
      });
      return true;
    } catch (error) {
      logger.error({ companionId, chatId, error }, 'Failed to send Telegram message');
      return false;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: TelegramBotManager | null = null;

export function getTelegramBotManager(baseWebhookUrl?: string): TelegramBotManager {
  if (!instance) {
    const url = baseWebhookUrl || process.env['TELEGRAM_WEBHOOK_BASE_URL'] || 'https://api.campfire.example.com';
    instance = new TelegramBotManager(url);
    logger.debug('TelegramBotManager initialized');
  }
  return instance;
}
