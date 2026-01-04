/**
 * AdConversionsService Unit Tests
 *
 * Tests for ad conversion tracking service including:
 * - Recording signup conversions with UTM data
 * - Recording payment conversions with revenue
 * - Calculating user LTV
 * - Updating user LTV in database
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AdConversion,
  UserLtv,
} from '../../db/types.js';

// Create mock sql function
const mockSqlQuery = vi.fn();

// Create mock repository
const mockAdsRepository = {
  createConversion: vi.fn(),
  findConversionByUserAndType: vi.fn(),
  getConversionsByUser: vi.fn(),
  getConversionsByCampaign: vi.fn(),
  updateConversionLtv: vi.fn(),
  findCampaignByPlatformId: vi.fn(),
  upsertUserLtv: vi.fn(),
  getUserLtv: vi.fn(),
};

// Create mock users repository
const mockUsersRepository = {
  findById: vi.fn(),
};

// Create mock billing repository
const mockBillingRepository = {
  findSubscriptionByUserId: vi.fn(),
  listBillingEvents: vi.fn(),
};

// Mock the repositories
vi.mock('../../repositories/ads.js', () => ({
  getAdsRepository: () => mockAdsRepository,
}));

vi.mock('../../repositories/users.js', () => ({
  getUsersRepository: () => mockUsersRepository,
}));

vi.mock('../../repositories/billing.js', () => ({
  getBillingRepository: () => mockBillingRepository,
}));

// Mock the database pool
vi.mock('../../db/pool.js', () => ({
  sql: () => mockSqlQuery,
}));

// Mock the logger
vi.mock('../../observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    })),
  },
}));

// Import after mocking
import { AdConversionsService, getAdConversionsService } from '../ad-conversions.js';

// Test fixtures
const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
const mockCampaignId = '550e8400-e29b-41d4-a716-446655440001';
const mockConversionId = '550e8400-e29b-41d4-a716-446655440002';

const createMockConversion = (overrides: Partial<AdConversion> = {}): AdConversion => ({
  id: mockConversionId,
  user_id: mockUserId,
  conversion_type: 'signup',
  campaign_id: mockCampaignId,
  platform_campaign_id: 'CAMP-789',
  platform: 'google_ads',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'brand_awareness',
  revenue_cents: 0,
  ltv_cents: 0,
  conversion_date: new Date('2025-01-01'),
  created_at: new Date('2025-01-01T10:00:00Z'),
  ...overrides,
});

const createMockUserLtv = (overrides: Partial<UserLtv> = {}): UserLtv => ({
  user_id: mockUserId,
  total_payments_cents: 5000,
  subscription_revenue_cents: 3000,
  token_revenue_cents: 2000,
  ltv_cents: 5000,
  first_payment_at: new Date('2025-01-05T00:00:00Z'),
  last_payment_at: new Date('2025-01-10T00:00:00Z'),
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-10T00:00:00Z'),
  ...overrides,
});

describe('AdConversionsService', () => {
  let service: AdConversionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdConversionsService();
  });

  // ===========================================================================
  // recordSignupConversion Tests
  // ===========================================================================

  describe('recordSignupConversion', () => {
    it('should create new signup conversion when none exists', async () => {
      const mockConversion = createMockConversion({
        conversion_type: 'signup',
      });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(null);
      mockUsersRepository.findById.mockResolvedValueOnce({ id: mockUserId });
      mockSqlQuery.mockResolvedValueOnce([{
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
        ad_click_platform: 'google',
      }]);
      mockAdsRepository.createConversion.mockResolvedValueOnce(mockConversion);

      const result = await service.recordSignupConversion(mockUserId);

      expect(result.conversion).toEqual(mockConversion);
      expect(result.isNew).toBe(true);
      expect(mockAdsRepository.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUserId,
          conversion_type: 'signup',
        }),
        undefined
      );
    });

    it('should return existing conversion if already recorded', async () => {
      const existingConversion = createMockConversion({
        conversion_type: 'signup',
      });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(existingConversion);

      const result = await service.recordSignupConversion(mockUserId);

      expect(result.conversion).toEqual(existingConversion);
      expect(result.isNew).toBe(false);
      expect(mockAdsRepository.createConversion).not.toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(null);
      mockUsersRepository.findById.mockResolvedValueOnce(null);

      await expect(service.recordSignupConversion(mockUserId)).rejects.toThrow(
        'User not found'
      );
    });

    it('should infer google_ads platform from UTM source', async () => {
      const mockConversion = createMockConversion({ platform: 'google_ads' });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(null);
      mockUsersRepository.findById.mockResolvedValueOnce({ id: mockUserId });
      mockSqlQuery.mockResolvedValueOnce([{
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
        ad_click_platform: null,
      }]);
      mockAdsRepository.createConversion.mockResolvedValueOnce(mockConversion);

      await service.recordSignupConversion(mockUserId);

      expect(mockAdsRepository.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'google_ads',
        }),
        undefined
      );
    });

    it('should infer facebook_ads platform from UTM source', async () => {
      const mockConversion = createMockConversion({ platform: 'facebook_ads' });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(null);
      mockUsersRepository.findById.mockResolvedValueOnce({ id: mockUserId });
      mockSqlQuery.mockResolvedValueOnce([{
        utm_source: 'facebook',
        utm_medium: 'paid_social',
        utm_campaign: 'retarget',
        ad_click_platform: null,
      }]);
      mockAdsRepository.createConversion.mockResolvedValueOnce(mockConversion);

      await service.recordSignupConversion(mockUserId);

      expect(mockAdsRepository.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'facebook_ads',
        }),
        undefined
      );
    });
  });

  // ===========================================================================
  // recordPaymentConversion Tests
  // ===========================================================================

  describe('recordPaymentConversion', () => {
    it('should create conversion with revenue amount', async () => {
      const revenueCents = 2999;

      const mockConversion = createMockConversion({
        conversion_type: 'first_payment',
        revenue_cents: revenueCents,
      });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(null);
      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(
        createMockConversion({ conversion_type: 'signup' })
      );
      mockAdsRepository.createConversion.mockResolvedValueOnce(mockConversion);
      mockSqlQuery.mockResolvedValue([]);
      mockAdsRepository.upsertUserLtv.mockResolvedValueOnce(createMockUserLtv());
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(createMockUserLtv());
      mockAdsRepository.updateConversionLtv.mockResolvedValue(undefined);

      const result = await service.recordPaymentConversion(
        mockUserId,
        revenueCents,
        'first_payment'
      );

      expect(result.conversion.revenue_cents).toBe(2999);
      expect(result.conversion.conversion_type).toBe('first_payment');
      expect(result.isNew).toBe(true);
    });

    it('should return existing conversion if already recorded', async () => {
      const existingConversion = createMockConversion({
        conversion_type: 'first_payment',
        revenue_cents: 2999,
      });

      mockAdsRepository.findConversionByUserAndType.mockResolvedValueOnce(existingConversion);

      const result = await service.recordPaymentConversion(
        mockUserId,
        2999,
        'first_payment'
      );

      expect(result.conversion).toEqual(existingConversion);
      expect(result.isNew).toBe(false);
    });

    it('should inherit UTM data from signup conversion', async () => {
      const signupConversion = createMockConversion({
        conversion_type: 'signup',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
        platform: 'google_ads',
      });

      mockAdsRepository.findConversionByUserAndType
        .mockResolvedValueOnce(null) // first_payment doesn't exist
        .mockResolvedValueOnce(signupConversion); // signup exists

      const paymentConversion = createMockConversion({
        conversion_type: 'first_payment',
        revenue_cents: 2999,
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
        platform: 'google_ads',
      });
      mockAdsRepository.createConversion.mockResolvedValueOnce(paymentConversion);
      mockSqlQuery.mockResolvedValue([]);
      mockAdsRepository.upsertUserLtv.mockResolvedValueOnce(createMockUserLtv());
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(createMockUserLtv());
      mockAdsRepository.updateConversionLtv.mockResolvedValue(undefined);

      await service.recordPaymentConversion(mockUserId, 2999, 'first_payment');

      expect(mockAdsRepository.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'brand',
          platform: 'google_ads',
        }),
        undefined
      );
    });
  });

  // ===========================================================================
  // calculateUserLtv Tests
  // ===========================================================================

  describe('calculateUserLtv', () => {
    it('should calculate LTV from subscription and token revenue', async () => {
      mockSqlQuery
        .mockResolvedValueOnce([{ total: 3000 }]) // subscription revenue
        .mockResolvedValueOnce([{ total: 500 }]); // token purchases (in tokens)

      const result = await service.calculateUserLtv(mockUserId);

      expect(result.subscriptionRevenueCents).toBe(3000);
      expect(result.ltvCents).toBeGreaterThanOrEqual(3000);
    });

    it('should return zero when user has no payments', async () => {
      mockSqlQuery
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.calculateUserLtv(mockUserId);

      expect(result.totalPaymentsCents).toBe(0);
      expect(result.subscriptionRevenueCents).toBe(0);
      expect(result.tokenRevenueCents).toBe(0);
      expect(result.ltvCents).toBe(0);
    });
  });

  // ===========================================================================
  // updateUserLtv Tests
  // ===========================================================================

  describe('updateUserLtv', () => {
    it('should persist calculated LTV to database', async () => {
      mockSqlQuery
        .mockResolvedValueOnce([{ total: 3000 }])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ first_payment: null, last_payment: null }]);

      const mockLtv = createMockUserLtv({
        total_payments_cents: 3000,
        ltv_cents: 3000,
      });
      mockAdsRepository.upsertUserLtv.mockResolvedValueOnce(mockLtv);

      const result = await service.updateUserLtv(mockUserId);

      expect(result).toEqual(mockLtv);
      expect(mockAdsRepository.upsertUserLtv).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUserId,
        }),
        undefined
      );
    });
  });

  // ===========================================================================
  // updateConversionLtv Tests
  // ===========================================================================

  describe('updateConversionLtv', () => {
    it('should update LTV on conversion records', async () => {
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(
        createMockUserLtv({ ltv_cents: 5000 })
      );
      mockAdsRepository.updateConversionLtv.mockResolvedValue(undefined);

      await service.updateConversionLtv(mockUserId);

      expect(mockAdsRepository.updateConversionLtv).toHaveBeenCalledWith(
        mockUserId,
        5000,
        undefined
      );
    });

    it('should skip if no LTV record exists', async () => {
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(null);

      await service.updateConversionLtv(mockUserId);

      expect(mockAdsRepository.updateConversionLtv).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getUserConversions Tests
  // ===========================================================================

  describe('getUserConversions', () => {
    it('should return all conversions for a user', async () => {
      const mockConversions = [
        createMockConversion({ id: 'conv-1', conversion_type: 'signup' }),
        createMockConversion({
          id: 'conv-2',
          conversion_type: 'first_payment',
        }),
      ];
      mockAdsRepository.getConversionsByUser.mockResolvedValueOnce(mockConversions);

      const result = await service.getUserConversions(mockUserId);

      expect(result).toHaveLength(2);
    });
  });

  // ===========================================================================
  // getUserLtv Tests
  // ===========================================================================

  describe('getUserLtv', () => {
    it('should return user LTV when exists', async () => {
      const mockLtv = createMockUserLtv();
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(mockLtv);

      const result = await service.getUserLtv(mockUserId);

      expect(result).toEqual(mockLtv);
    });

    it('should return null when no LTV exists', async () => {
      mockAdsRepository.getUserLtv.mockResolvedValueOnce(null);

      const result = await service.getUserLtv(mockUserId);

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // batchUpdateLtv Tests
  // ===========================================================================

  describe('batchUpdateLtv', () => {
    it('should update LTV for users with conversions', async () => {
      // Mock finding users with conversions that need updating
      mockSqlQuery.mockResolvedValueOnce([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);

      // Mock LTV calculations for each user
      mockSqlQuery
        .mockResolvedValueOnce([{ total: 1000 }])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ first_payment: null, last_payment: null }])
        .mockResolvedValueOnce([{ total: 2000 }])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ first_payment: null, last_payment: null }]);

      mockAdsRepository.upsertUserLtv.mockResolvedValue(createMockUserLtv());
      mockAdsRepository.getUserLtv.mockResolvedValue(createMockUserLtv());
      mockAdsRepository.updateConversionLtv.mockResolvedValue(undefined);

      const count = await service.batchUpdateLtv(100);

      expect(count).toBe(2);
    });

    it('should return 0 when no users need updating', async () => {
      mockSqlQuery.mockResolvedValueOnce([]);

      const count = await service.batchUpdateLtv(100);

      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe('getAdConversionsService', () => {
    it('should return singleton instance', () => {
      const instance1 = getAdConversionsService();
      const instance2 = getAdConversionsService();

      expect(instance1).toBe(instance2);
    });
  });
});
