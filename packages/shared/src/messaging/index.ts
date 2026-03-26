/**
 * Messaging Integration Types
 * Shared types for multi-platform messaging (Telegram, Discord, WhatsApp, SMS).
 */

// ============================================================================
// Platform Enum
// ============================================================================

/** Supported messaging platforms */
export type MessagingPlatform = 'telegram' | 'discord' | 'whatsapp' | 'sms';

// ============================================================================
// Messaging Channel
// ============================================================================

/** A linked messaging channel between a user+companion and an external platform */
export interface MessagingChannel {
  id: string;
  userId: string;
  companionId: string;
  platform: MessagingPlatform;
  /** Platform-specific channel/chat identifier (e.g. Telegram chat_id) */
  platformChannelId: string;
  /** User's ID on the platform (e.g. Telegram user ID) */
  platformUserId: string;
  /** Bot or integration identifier (e.g. bot token hash) */
  platformBotId: string;
  isActive: boolean;
  /** Platform-specific configuration (e.g. notification preferences) */
  config: Record<string, unknown>;
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Inbound Message (platform -> system)
// ============================================================================

/** A message received from an external messaging platform */
export interface InboundMessage {
  channelId: string;
  platform: MessagingPlatform;
  platformMessageId: string;
  text: string;
  mediaUrls?: string[];
  senderPlatformId: string;
}

// ============================================================================
// Outbound Message (system -> platform)
// ============================================================================

/** A message to send to an external messaging platform */
export interface OutboundMessage {
  channelId: string;
  platform: MessagingPlatform;
  text: string;
  mediaUrls?: string[];
  replyToMessageId?: string;
}

// ============================================================================
// Link Code (for connecting platform accounts)
// ============================================================================

/** A temporary code for linking a platform account to a Campfire user */
export interface MessagingLinkCode {
  code: string;
  userId: string;
  companionId: string;
  platform: MessagingPlatform;
  platformBotId: string;
  expiresAt: string;
}

// ============================================================================
// Inbound Job Data (for BullMQ worker)
// ============================================================================

/** Job data for the messaging-inbound BullMQ queue */
export interface MessagingInboundJobData {
  channelId: string;
  userId: string;
  companionId: string;
  platform: MessagingPlatform;
  platformMessageId: string;
  platformChannelId: string;
  text: string;
  mediaUrls?: string[];
  senderPlatformId: string;
}

// ============================================================================
// Telegram-specific Config
// ============================================================================

/** Telegram bot configuration stored per companion */
export interface TelegramBotConfig {
  botToken: string;
  botUsername?: string;
  webhookUrl?: string;
  isActive: boolean;
}
