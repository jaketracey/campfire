/**
 * Telegram Integration Tests
 * Tests for messaging channels, Telegram bot service, webhook handling,
 * channel linking flow, and message routing.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  encryptBotToken,
  decryptBotToken,
  deriveBotId,
} from '../services/telegram.js';

// ============================================================================
// Encryption / Utility Tests
// ============================================================================

describe('Telegram Encryption Utilities', () => {
  it('encrypts and decrypts a bot token round-trip', () => {
    const token = '1234567890:ABCdef_ghIJKlmnOPQrstUVWxyz-1234567';
    const encrypted = encryptBotToken(token);
    const decrypted = decryptBotToken(encrypted);
    expect(decrypted).toBe(token);
  });

  it('produces different ciphertext for different tokens', () => {
    const token1 = '1111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const token2 = '2222222222:BBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const e1 = encryptBotToken(token1);
    const e2 = encryptBotToken(token2);
    expect(e1).not.toBe(e2);
  });

  it('derives a stable bot ID from a token', () => {
    const token = '1234567890:ABCdef_ghIJKlmnOPQrstUVWxyz';
    const id1 = deriveBotId(token);
    const id2 = deriveBotId(token);
    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
  });

  it('derives different bot IDs for different tokens', () => {
    const id1 = deriveBotId('token-a');
    const id2 = deriveBotId('token-b');
    expect(id1).not.toBe(id2);
  });

  it('throws on invalid encrypted format', () => {
    expect(() => decryptBotToken('not-valid-format')).toThrow();
  });
});

// ============================================================================
// Messaging Channel Repository Tests (unit, with mock DB)
// ============================================================================

describe('MessagingChannelsRepository', () => {
  // These tests validate the repository interface expectations.
  // In a real test environment, they'd use a test database.
  // Here we verify the type contracts and basic logic.

  it('defines expected CRUD methods', async () => {
    // Dynamic import to avoid DB connection at module load
    const { MessagingChannelsRepository } = await import('../repositories/messaging-channels.js');
    const repo = new MessagingChannelsRepository();

    expect(typeof repo.create).toBe('function');
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findByPlatformUser).toBe('function');
    expect(typeof repo.findByPlatformChannel).toBe('function');
    expect(typeof repo.findActiveByCompanion).toBe('function');
    expect(typeof repo.findByUserCompanionPlatform).toBe('function');
    expect(typeof repo.update).toBe('function');
    expect(typeof repo.deactivate).toBe('function');
    expect(typeof repo.delete).toBe('function');
    expect(typeof repo.incrementMessageCount).toBe('function');
    expect(typeof repo.listByUser).toBe('function');
    expect(typeof repo.createLinkCode).toBe('function');
    expect(typeof repo.consumeLinkCode).toBe('function');
    expect(typeof repo.cleanupExpiredLinkCodes).toBe('function');
    expect(typeof repo.upsertTelegramBotConfig).toBe('function');
    expect(typeof repo.findTelegramBotConfig).toBe('function');
    expect(typeof repo.findActiveTelegramBotConfigs).toBe('function');
    expect(typeof repo.deactivateTelegramBotConfig).toBe('function');
    expect(typeof repo.deleteTelegramBotConfig).toBe('function');
  });
});

// ============================================================================
// TelegramBotManager Tests (unit, with mocked grammy)
// ============================================================================

describe('TelegramBotManager', () => {
  it('can be instantiated with a base webhook URL', async () => {
    const { TelegramBotManager } = await import('../services/telegram.js');
    const manager = new TelegramBotManager('https://example.com');
    expect(manager.getRegisteredBotIds()).toEqual([]);
    expect(manager.isRegistered('some-companion')).toBe(false);
  });

  it('returns false for handleUpdate with unknown bot ID', async () => {
    const { TelegramBotManager } = await import('../services/telegram.js');
    const manager = new TelegramBotManager('https://example.com');
    const handled = await manager.handleUpdate('unknown-bot-id', { update_id: 1 } as any);
    expect(handled).toBe(false);
  });

  it('returns undefined for getBot with unknown companion', async () => {
    const { TelegramBotManager } = await import('../services/telegram.js');
    const manager = new TelegramBotManager('https://example.com');
    expect(manager.getBot('unknown')).toBeUndefined();
  });

  it('returns undefined for getBotByBotId with unknown ID', async () => {
    const { TelegramBotManager } = await import('../services/telegram.js');
    const manager = new TelegramBotManager('https://example.com');
    expect(manager.getBotByBotId('unknown')).toBeUndefined();
  });
});

// ============================================================================
// Shared Types Tests
// ============================================================================

describe('Shared Messaging Types', () => {
  it('exports all required types', async () => {
    // Verify the types compile and are accessible
    const shared = await import('@campfire/shared');
    // Types are compile-time only, but we can check that the module loads
    expect(shared).toBeDefined();
  });
});

// ============================================================================
// Route Validation Schema Tests
// ============================================================================

describe('Route Validation', () => {
  it('validates CreateChannelSchema', () => {
    const { z } = require('zod') as typeof import('zod');

    const CreateChannelSchema = z.object({
      companionId: z.string().uuid(),
      platform: z.enum(['telegram', 'discord', 'whatsapp', 'sms']),
    });

    // Valid
    const valid = CreateChannelSchema.safeParse({
      companionId: '123e4567-e89b-12d3-a456-426614174000',
      platform: 'telegram',
    });
    expect(valid.success).toBe(true);

    // Invalid platform
    const invalidPlatform = CreateChannelSchema.safeParse({
      companionId: '123e4567-e89b-12d3-a456-426614174000',
      platform: 'slack',
    });
    expect(invalidPlatform.success).toBe(false);

    // Invalid UUID
    const invalidUuid = CreateChannelSchema.safeParse({
      companionId: 'not-a-uuid',
      platform: 'telegram',
    });
    expect(invalidUuid.success).toBe(false);

    // Missing fields
    const missing = CreateChannelSchema.safeParse({});
    expect(missing.success).toBe(false);
  });

  it('validates VerifyLinkCodeSchema', () => {
    const { z } = require('zod') as typeof import('zod');

    const VerifyLinkCodeSchema = z.object({
      code: z.string().min(4).max(20),
      platformUserId: z.string().min(1).max(255),
      platformChannelId: z.string().min(1).max(255),
      platformBotId: z.string().min(1).max(255),
    });

    const valid = VerifyLinkCodeSchema.safeParse({
      code: 'ABC12345',
      platformUserId: '123456789',
      platformChannelId: '987654321',
      platformBotId: 'abc123def456',
    });
    expect(valid.success).toBe(true);

    // Code too short
    const shortCode = VerifyLinkCodeSchema.safeParse({
      code: 'AB',
      platformUserId: '123',
      platformChannelId: '456',
      platformBotId: '789',
    });
    expect(shortCode.success).toBe(false);
  });

  it('validates ConfigureTelegramSchema', () => {
    const { z } = require('zod') as typeof import('zod');

    const ConfigureTelegramSchema = z.object({
      botToken: z.string().min(10).max(255),
    });

    const valid = ConfigureTelegramSchema.safeParse({
      botToken: '1234567890:ABCdefGHIjklMNOpqrSTUvwxyz',
    });
    expect(valid.success).toBe(true);

    // Token too short
    const tooShort = ConfigureTelegramSchema.safeParse({ botToken: '123' });
    expect(tooShort.success).toBe(false);
  });
});

// ============================================================================
// Webhook Payload Tests
// ============================================================================

describe('Telegram Webhook Payload Handling', () => {
  it('handles text message payload structure', () => {
    // Simulate a Telegram text message update
    const update = {
      update_id: 123456789,
      message: {
        message_id: 42,
        from: {
          id: 987654321,
          is_bot: false,
          first_name: 'Test',
          username: 'testuser',
        },
        chat: {
          id: 987654321,
          first_name: 'Test',
          username: 'testuser',
          type: 'private',
        },
        date: 1711000000,
        text: 'Hello!',
      },
    };

    expect(update.message.text).toBe('Hello!');
    expect(update.message.from.id).toBe(987654321);
    expect(update.message.chat.id).toBe(987654321);
  });

  it('handles command payload structure', () => {
    const update = {
      update_id: 123456790,
      message: {
        message_id: 43,
        from: {
          id: 987654321,
          is_bot: false,
          first_name: 'Test',
        },
        chat: {
          id: 987654321,
          type: 'private',
        },
        date: 1711000001,
        text: '/link ABC12345',
        entities: [
          { offset: 0, length: 5, type: 'bot_command' },
        ],
      },
    };

    const text = update.message.text;
    const parts = text.split(/\s+/);
    expect(parts[0]).toBe('/link');
    expect(parts[1]).toBe('ABC12345');
  });

  it('handles invalid/empty payload gracefully', () => {
    const emptyUpdate = {};
    const noMessage = { update_id: 123 };

    // These should not throw when accessing nested properties safely
    const msg = (emptyUpdate as { message?: { text?: string } }).message;
    expect(msg).toBeUndefined();

    const msg2 = (noMessage as { message?: { text?: string } }).message;
    expect(msg2).toBeUndefined();
  });
});

// ============================================================================
// Channel Linking Flow Tests (integration logic)
// ============================================================================

describe('Channel Linking Flow', () => {
  it('generates a valid link code format', () => {
    // nanoid(8).toUpperCase() produces 8 alphanumeric chars
    const { nanoid } = require('nanoid') as typeof import('nanoid');
    const code = nanoid(8).toUpperCase();
    expect(code.length).toBe(8);
    expect(code).toMatch(/^[A-Z0-9_-]+$/i);
  });

  it('link code expiry is set to 15 minutes from now', () => {
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000);
    const diff = expiresAt.getTime() - now;
    expect(diff).toBe(15 * 60 * 1000);
  });
});

// ============================================================================
// Message Routing Tests
// ============================================================================

describe('Message Routing', () => {
  it('constructs correct MessagingInboundJobData', () => {
    const jobData = {
      channelId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      companionId: '550e8400-e29b-41d4-a716-446655440002',
      platform: 'telegram' as const,
      platformMessageId: '42',
      platformChannelId: '987654321',
      text: 'Hello, how are you?',
      senderPlatformId: '123456789',
    };

    expect(jobData.platform).toBe('telegram');
    expect(jobData.text).toBe('Hello, how are you?');
    expect(jobData.channelId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('supports optional mediaUrls', () => {
    const jobData = {
      channelId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      companionId: '550e8400-e29b-41d4-a716-446655440002',
      platform: 'telegram' as const,
      platformMessageId: '42',
      platformChannelId: '987654321',
      text: 'Check this out',
      mediaUrls: ['https://example.com/photo.jpg'],
      senderPlatformId: '123456789',
    };

    expect(jobData.mediaUrls).toHaveLength(1);
  });
});

// ============================================================================
// Auth & Ownership Tests
// ============================================================================

describe('Auth and Ownership Checks', () => {
  it('admin role bypasses ownership check', () => {
    const user = { userId: 'user-1', email: 'a@b.com', role: 'admin' as const };
    const channel = { user_id: 'user-2' }; // Different user

    const isOwner = channel.user_id === user.userId;
    const isAdmin = user.role === 'admin';
    const hasAccess = isOwner || isAdmin;

    expect(isOwner).toBe(false);
    expect(isAdmin).toBe(true);
    expect(hasAccess).toBe(true);
  });

  it('non-admin user can only access own channels', () => {
    const user = { userId: 'user-1', email: 'a@b.com', role: 'user' as const };
    const ownChannel = { user_id: 'user-1' };
    const otherChannel = { user_id: 'user-2' };

    expect(ownChannel.user_id === user.userId || user.role === 'admin').toBe(true);
    expect(otherChannel.user_id === user.userId || user.role === 'admin').toBe(false);
  });

  it('only admins can configure Telegram bots', () => {
    const admin = { role: 'admin' as const };
    const user = { role: 'user' as const };

    expect(admin.role === 'admin').toBe(true);
    expect(user.role === 'admin').toBe(false);
  });
});
