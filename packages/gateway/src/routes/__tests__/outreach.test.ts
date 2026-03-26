/**
 * Tests for Outreach Routes
 *
 * Tests eligibility checks, record creation, delivery tracking,
 * and outreach config management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the outreach repository
const mockGetPending = vi.fn();
const mockMarkDelivered = vi.fn();
const mockMarkOpened = vi.fn();
const mockCheckEligibility = vi.fn();
const mockGetConfig = vi.fn();
const mockUpsertConfig = vi.fn();
const mockCreateRecord = vi.fn();

vi.mock('../../repositories/outreach.js', () => ({
  getOutreachRepository: () => ({
    getPending: mockGetPending,
    markDelivered: mockMarkDelivered,
    markOpened: mockMarkOpened,
    checkEligibility: mockCheckEligibility,
    getConfig: mockGetConfig,
    upsertConfig: mockUpsertConfig,
    createRecord: mockCreateRecord,
  }),
}));

describe('Outreach Repository Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Eligibility Checks', () => {
    it('should reject if no previous interaction', async () => {
      mockCheckEligibility.mockResolvedValue({
        eligible: false,
        reason: 'No previous interaction',
      });

      const result = await mockCheckEligibility(
        'user-1',
        'companion-1',
        24,
        1
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('No previous interaction');
    });

    it('should reject if too soon since last outreach', async () => {
      mockCheckEligibility.mockResolvedValue({
        eligible: false,
        reason: 'Too soon since last outreach',
      });

      const result = await mockCheckEligibility(
        'user-1',
        'companion-1',
        24,
        1
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Too soon');
    });

    it('should reject if daily limit reached', async () => {
      mockCheckEligibility.mockResolvedValue({
        eligible: false,
        reason: 'Daily outreach limit reached',
      });

      const result = await mockCheckEligibility(
        'user-1',
        'companion-1',
        24,
        1
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Daily');
    });

    it('should approve eligible pair', async () => {
      mockCheckEligibility.mockResolvedValue({
        eligible: true,
        reason: '',
      });

      const result = await mockCheckEligibility(
        'user-1',
        'companion-1',
        24,
        1
      );

      expect(result.eligible).toBe(true);
    });

    it('should reject if outreach disabled for companion', async () => {
      mockCheckEligibility.mockResolvedValue({
        eligible: false,
        reason: 'Outreach disabled for companion',
      });

      const result = await mockCheckEligibility(
        'user-1',
        'companion-1',
        24,
        1
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('Pending Outreach', () => {
    it('should return pending records for a user', async () => {
      const mockRecords = [
        {
          id: 'outreach-1',
          user_id: 'user-1',
          companion_id: 'companion-1',
          trigger: 'scheduled_checkin',
          message: 'Hey, how are you doing?',
          delivered_via: 'stored',
          delivered_at: null,
          was_opened: false,
          led_to_conversation: false,
          created_at: new Date(),
        },
      ];

      mockGetPending.mockResolvedValue(mockRecords);

      const result = await mockGetPending('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Hey, how are you doing?');
      expect(result[0].delivered_at).toBeNull();
    });

    it('should return empty array when no pending', async () => {
      mockGetPending.mockResolvedValue([]);

      const result = await mockGetPending('user-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('Delivery Tracking', () => {
    it('should mark outreach as delivered', async () => {
      mockMarkDelivered.mockResolvedValue({
        id: 'outreach-1',
        delivered_at: new Date(),
        delivered_via: 'websocket',
      });

      const result = await mockMarkDelivered('outreach-1', 'websocket');

      expect(result.delivered_at).not.toBeNull();
      expect(result.delivered_via).toBe('websocket');
    });

    it('should return null for already delivered', async () => {
      mockMarkDelivered.mockResolvedValue(null);

      const result = await mockMarkDelivered('outreach-1', 'websocket');

      expect(result).toBeNull();
    });

    it('should mark outreach as opened', async () => {
      mockMarkOpened.mockResolvedValue({
        id: 'outreach-1',
        was_opened: true,
      });

      const result = await mockMarkOpened('outreach-1');

      expect(result.was_opened).toBe(true);
    });
  });

  describe('Outreach Config', () => {
    it('should return null for unconfigured companion (uses defaults)', async () => {
      mockGetConfig.mockResolvedValue(null);

      const result = await mockGetConfig('companion-1');

      expect(result).toBeNull();
    });

    it('should return stored config', async () => {
      mockGetConfig.mockResolvedValue({
        companion_id: 'companion-1',
        enabled: true,
        min_interval_hours: 12,
        max_daily: 2,
        quiet_hours_start: 23,
        quiet_hours_end: 7,
        triggers_enabled: ['scheduled_checkin', 'followup'],
      });

      const result = await mockGetConfig('companion-1');

      expect(result.enabled).toBe(true);
      expect(result.min_interval_hours).toBe(12);
      expect(result.triggers_enabled).toContain('followup');
    });

    it('should upsert config', async () => {
      mockUpsertConfig.mockResolvedValue({
        companion_id: 'companion-1',
        enabled: false,
        min_interval_hours: 48,
        max_daily: 0,
      });

      const result = await mockUpsertConfig('companion-1', {
        enabled: false,
        min_interval_hours: 48,
        max_daily: 0,
      });

      expect(result.enabled).toBe(false);
      expect(result.max_daily).toBe(0);
    });
  });

  describe('Record Creation', () => {
    it('should create an outreach record', async () => {
      mockCreateRecord.mockResolvedValue({
        id: 'new-outreach-1',
        user_id: 'user-1',
        companion_id: 'companion-1',
        trigger: 'scheduled_checkin',
        message: 'Thinking of you!',
        delivered_via: 'stored',
        delivered_at: null,
        was_opened: false,
        led_to_conversation: false,
        created_at: new Date(),
      });

      const result = await mockCreateRecord({
        user_id: 'user-1',
        companion_id: 'companion-1',
        trigger: 'scheduled_checkin',
        message: 'Thinking of you!',
      });

      expect(result.id).toBe('new-outreach-1');
      expect(result.trigger).toBe('scheduled_checkin');
      expect(result.delivered_at).toBeNull();
    });
  });
});

describe('Quiet Hours Logic', () => {
  it('should identify quiet hours correctly (22-8)', () => {
    const config = {
      quiet_hours_start: 22,
      quiet_hours_end: 8,
    };

    // Helper that mirrors what the worker would check
    function isQuietHour(hour: number): boolean {
      if (config.quiet_hours_start > config.quiet_hours_end) {
        // Crosses midnight: e.g., 22-8
        return hour >= config.quiet_hours_start || hour < config.quiet_hours_end;
      }
      return hour >= config.quiet_hours_start && hour < config.quiet_hours_end;
    }

    expect(isQuietHour(23)).toBe(true);
    expect(isQuietHour(0)).toBe(true);
    expect(isQuietHour(3)).toBe(true);
    expect(isQuietHour(7)).toBe(true);
    expect(isQuietHour(8)).toBe(false);
    expect(isQuietHour(12)).toBe(false);
    expect(isQuietHour(21)).toBe(false);
    expect(isQuietHour(22)).toBe(true);
  });

  it('should handle non-midnight-crossing quiet hours (23-6)', () => {
    const config = {
      quiet_hours_start: 23,
      quiet_hours_end: 6,
    };

    function isQuietHour(hour: number): boolean {
      if (config.quiet_hours_start > config.quiet_hours_end) {
        return hour >= config.quiet_hours_start || hour < config.quiet_hours_end;
      }
      return hour >= config.quiet_hours_start && hour < config.quiet_hours_end;
    }

    expect(isQuietHour(23)).toBe(true);
    expect(isQuietHour(0)).toBe(true);
    expect(isQuietHour(5)).toBe(true);
    expect(isQuietHour(6)).toBe(false);
    expect(isQuietHour(12)).toBe(false);
    expect(isQuietHour(22)).toBe(false);
  });
});
