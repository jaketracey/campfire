/**
 * Messaging Channels Repository
 * Data access for messaging channel records (Telegram, Discord, WhatsApp, SMS).
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type { TransactionContext, PaginatedResult } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

/** Database row shape for messaging_channels table */
export interface MessagingChannelRow {
  id: string;
  user_id: string;
  companion_id: string;
  platform: string;
  platform_channel_id: string;
  platform_user_id: string;
  platform_bot_id: string;
  is_active: boolean;
  config: Record<string, unknown>;
  last_message_at: Date | null;
  message_count: number;
  created_at: Date;
  updated_at: Date;
}

/** Insert shape for creating a new messaging channel */
export interface MessagingChannelInsert {
  user_id: string;
  companion_id: string;
  platform: string;
  platform_channel_id: string;
  platform_user_id: string;
  platform_bot_id: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
}

/** Update shape for modifying a messaging channel */
export interface MessagingChannelUpdate {
  is_active?: boolean;
  config?: Record<string, unknown>;
  platform_channel_id?: string;
}

/** List filters */
export interface MessagingChannelListFilters {
  userId: string;
  platform?: string;
  companionId?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

/** Database row shape for messaging_link_codes table */
export interface MessagingLinkCodeRow {
  code: string;
  user_id: string;
  companion_id: string;
  platform: string;
  platform_bot_id: string;
  expires_at: Date;
  created_at: Date;
}

/** Database row shape for telegram_bot_configs table */
export interface TelegramBotConfigRow {
  id: string;
  companion_id: string;
  bot_token_encrypted: string;
  bot_username: string | null;
  webhook_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Repository
// ============================================================================

export class MessagingChannelsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // --------------------------------------------------------------------------
  // Messaging Channels CRUD
  // --------------------------------------------------------------------------

  /**
   * Create a new messaging channel
   */
  async create(data: MessagingChannelInsert, tx?: TransactionContext): Promise<MessagingChannelRow> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO messaging_channels (
          user_id,
          companion_id,
          platform,
          platform_channel_id,
          platform_user_id,
          platform_bot_id,
          is_active,
          config
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.platform},
          ${data.platform_channel_id},
          ${data.platform_user_id},
          ${data.platform_bot_id},
          ${data.is_active ?? true},
          ${data.config ? db.json(data.config as postgres.JSONValue) : db.json({} as postgres.JSONValue)}
        )
        RETURNING *
      `;
      const row = result[0] as MessagingChannelRow | undefined;
      if (!row) {
        throw new Error('Failed to create messaging channel record');
      }
      return row;
    } catch (error) {
      throw wrapDatabaseError(error, 'messaging_channels');
    }
  }

  /**
   * Find a messaging channel by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<MessagingChannelRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM messaging_channels WHERE id = ${id}
    `;
    return (result[0] as MessagingChannelRow | undefined) ?? null;
  }

  /**
   * Find a messaging channel by platform user ID and bot ID
   * Used to look up channels when receiving inbound messages
   */
  async findByPlatformUser(
    platformUserId: string,
    platformBotId: string,
    tx?: TransactionContext
  ): Promise<MessagingChannelRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM messaging_channels
      WHERE platform_user_id = ${platformUserId}
        AND platform_bot_id = ${platformBotId}
        AND is_active = true
      LIMIT 1
    `;
    return (result[0] as MessagingChannelRow | undefined) ?? null;
  }

  /**
   * Find a messaging channel by platform channel ID and bot ID
   */
  async findByPlatformChannel(
    platformChannelId: string,
    platformBotId: string,
    tx?: TransactionContext
  ): Promise<MessagingChannelRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM messaging_channels
      WHERE platform_channel_id = ${platformChannelId}
        AND platform_bot_id = ${platformBotId}
        AND is_active = true
      LIMIT 1
    `;
    return (result[0] as MessagingChannelRow | undefined) ?? null;
  }

  /**
   * Find all active channels for a companion
   */
  async findActiveByCompanion(
    companionId: string,
    platform?: string,
    tx?: TransactionContext
  ): Promise<MessagingChannelRow[]> {
    const db = this.getSql(tx);
    if (platform) {
      const result = await db`
        SELECT * FROM messaging_channels
        WHERE companion_id = ${companionId}
          AND platform = ${platform}
          AND is_active = true
        ORDER BY last_message_at DESC NULLS LAST
      `;
      return result as unknown as MessagingChannelRow[];
    }
    const result = await db`
      SELECT * FROM messaging_channels
      WHERE companion_id = ${companionId}
        AND is_active = true
      ORDER BY last_message_at DESC NULLS LAST
    `;
    return result as unknown as MessagingChannelRow[];
  }

  /**
   * Find channel by user, companion, and platform (unique constraint)
   */
  async findByUserCompanionPlatform(
    userId: string,
    companionId: string,
    platform: string,
    tx?: TransactionContext
  ): Promise<MessagingChannelRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM messaging_channels
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND platform = ${platform}
    `;
    return (result[0] as MessagingChannelRow | undefined) ?? null;
  }

  /**
   * Update a messaging channel
   */
  async update(
    id: string,
    data: MessagingChannelUpdate,
    tx?: TransactionContext
  ): Promise<MessagingChannelRow> {
    const db = this.getSql(tx);
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (data.is_active !== undefined) {
      setClauses.push('is_active');
      values.push(data.is_active);
    }
    if (data.config !== undefined) {
      setClauses.push('config');
      values.push(data.config);
    }
    if (data.platform_channel_id !== undefined) {
      setClauses.push('platform_channel_id');
      values.push(data.platform_channel_id);
    }

    // Use a simple approach since postgres.js tagged templates don't easily support dynamic SET
    const result = await db`
      UPDATE messaging_channels
      SET is_active = COALESCE(${data.is_active ?? null}, is_active),
          platform_channel_id = COALESCE(${data.platform_channel_id ?? null}, platform_channel_id),
          config = COALESCE(${data.config ? db.json(data.config as postgres.JSONValue) : null}, config),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    const row = result[0] as MessagingChannelRow | undefined;
    if (!row) {
      throw new NotFoundError('messaging_channels', id);
    }
    return row;
  }

  /**
   * Soft-delete a messaging channel (set is_active = false)
   */
  async deactivate(id: string, tx?: TransactionContext): Promise<MessagingChannelRow> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE messaging_channels
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    const row = result[0] as MessagingChannelRow | undefined;
    if (!row) {
      throw new NotFoundError('messaging_channels', id);
    }
    return row;
  }

  /**
   * Delete a messaging channel permanently
   */
  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM messaging_channels WHERE id = ${id} RETURNING id
    `;
    if (result.length === 0) {
      throw new NotFoundError('messaging_channels', id);
    }
  }

  /**
   * Increment message count and update last_message_at
   */
  async incrementMessageCount(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE messaging_channels
      SET message_count = message_count + 1,
          last_message_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  /**
   * List messaging channels for a user (paginated)
   */
  async listByUser(filters: MessagingChannelListFilters): Promise<PaginatedResult<MessagingChannelRow>> {
    const db = sql();
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    let rows: MessagingChannelRow[];
    let countResult;

    if (filters.platform && filters.companionId) {
      const r = await db`
        SELECT * FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND platform = ${filters.platform}
          AND companion_id = ${filters.companionId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as MessagingChannelRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND platform = ${filters.platform}
          AND companion_id = ${filters.companionId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
      `;
    } else if (filters.platform) {
      const r = await db`
        SELECT * FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND platform = ${filters.platform}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as MessagingChannelRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND platform = ${filters.platform}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
      `;
    } else if (filters.companionId) {
      const r = await db`
        SELECT * FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND companion_id = ${filters.companionId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as MessagingChannelRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM messaging_channels
        WHERE user_id = ${filters.userId}
          AND companion_id = ${filters.companionId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
      `;
    } else {
      const r = await db`
        SELECT * FROM messaging_channels
        WHERE user_id = ${filters.userId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      rows = r as unknown as MessagingChannelRow[];
      countResult = await db`
        SELECT COUNT(*)::text AS count FROM messaging_channels
        WHERE user_id = ${filters.userId}
          ${filters.isActive !== undefined ? db`AND is_active = ${filters.isActive}` : db``}
      `;
    }

    const total = parseInt((countResult[0] as { count: string } | undefined)?.count ?? '0', 10);

    return {
      data: rows,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
    };
  }

  // --------------------------------------------------------------------------
  // Link Codes
  // --------------------------------------------------------------------------

  /**
   * Create a link code for channel verification
   */
  async createLinkCode(data: {
    code: string;
    user_id: string;
    companion_id: string;
    platform: string;
    platform_bot_id: string;
    expires_at: Date;
  }, tx?: TransactionContext): Promise<MessagingLinkCodeRow> {
    const db = this.getSql(tx);
    // Clean up any existing codes for the same user+companion+platform
    await db`
      DELETE FROM messaging_link_codes
      WHERE user_id = ${data.user_id}
        AND companion_id = ${data.companion_id}
        AND platform = ${data.platform}
    `;
    const result = await db`
      INSERT INTO messaging_link_codes (code, user_id, companion_id, platform, platform_bot_id, expires_at)
      VALUES (${data.code}, ${data.user_id}, ${data.companion_id}, ${data.platform}, ${data.platform_bot_id}, ${data.expires_at})
      RETURNING *
    `;
    return result[0] as MessagingLinkCodeRow;
  }

  /**
   * Find and consume a link code (returns the code then deletes it)
   */
  async consumeLinkCode(code: string, tx?: TransactionContext): Promise<MessagingLinkCodeRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM messaging_link_codes
      WHERE code = ${code} AND expires_at > NOW()
      RETURNING *
    `;
    return (result[0] as MessagingLinkCodeRow | undefined) ?? null;
  }

  /**
   * Clean up expired link codes
   */
  async cleanupExpiredLinkCodes(tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM messaging_link_codes WHERE expires_at <= NOW()
    `;
    return result.count;
  }

  // --------------------------------------------------------------------------
  // Telegram Bot Configs
  // --------------------------------------------------------------------------

  /**
   * Upsert a Telegram bot configuration for a companion
   */
  async upsertTelegramBotConfig(
    companionId: string,
    botTokenEncrypted: string,
    botUsername?: string,
    webhookUrl?: string,
    tx?: TransactionContext
  ): Promise<TelegramBotConfigRow> {
    const db = this.getSql(tx);
    const result = await db`
      INSERT INTO telegram_bot_configs (companion_id, bot_token_encrypted, bot_username, webhook_url)
      VALUES (${companionId}, ${botTokenEncrypted}, ${botUsername ?? null}, ${webhookUrl ?? null})
      ON CONFLICT (companion_id)
      DO UPDATE SET
        bot_token_encrypted = ${botTokenEncrypted},
        bot_username = COALESCE(${botUsername ?? null}, telegram_bot_configs.bot_username),
        webhook_url = COALESCE(${webhookUrl ?? null}, telegram_bot_configs.webhook_url),
        is_active = true,
        updated_at = NOW()
      RETURNING *
    `;
    return result[0] as TelegramBotConfigRow;
  }

  /**
   * Find Telegram bot config by companion ID
   */
  async findTelegramBotConfig(companionId: string, tx?: TransactionContext): Promise<TelegramBotConfigRow | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM telegram_bot_configs WHERE companion_id = ${companionId}
    `;
    return (result[0] as TelegramBotConfigRow | undefined) ?? null;
  }

  /**
   * Find all active Telegram bot configs
   */
  async findActiveTelegramBotConfigs(tx?: TransactionContext): Promise<TelegramBotConfigRow[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM telegram_bot_configs WHERE is_active = true
    `;
    return result as unknown as TelegramBotConfigRow[];
  }

  /**
   * Deactivate a Telegram bot config
   */
  async deactivateTelegramBotConfig(companionId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE telegram_bot_configs
      SET is_active = false, updated_at = NOW()
      WHERE companion_id = ${companionId}
    `;
  }

  /**
   * Delete a Telegram bot config
   */
  async deleteTelegramBotConfig(companionId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      DELETE FROM telegram_bot_configs WHERE companion_id = ${companionId}
    `;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: MessagingChannelsRepository | null = null;

export function getMessagingChannelsRepository(): MessagingChannelsRepository {
  if (!instance) {
    instance = new MessagingChannelsRepository();
    logger.debug('MessagingChannelsRepository initialized');
  }
  return instance;
}
