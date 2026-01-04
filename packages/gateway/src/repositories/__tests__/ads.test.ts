/**
 * AdsRepository Unit Tests
 *
 * Tests for ad tracking data access layer including:
 * - Ad account CRUD operations
 * - Campaign operations
 * - Daily spend operations
 * - Conversion tracking
 * - User LTV operations
 * - Overview and campaign metrics
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type {
  AdAccount,
  AdAccountInsert,
  AdAccountUpdate,
  AdCampaign,
  AdCampaignInsert,
  AdSpendDaily,
  AdSpendDailyUpsert,
  AdConversion,
  AdConversionInsert,
  UserLtv,
  UserLtvInsert,
  CampaignMetrics,
  AdOverviewMetrics,
  SpendTrendPoint,
  UtmAttributionStats,
} from '../../db/types.js';

// Mock the database pool
const mockSql = vi.fn();
vi.mock('../../db/pool.js', () => ({
  sql: () => mockSql,
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
import { AdsRepository, getAdsRepository } from '../ads.js';

// Test fixtures
const mockAccountId = '550e8400-e29b-41d4-a716-446655440000';
const mockCampaignId = '550e8400-e29b-41d4-a716-446655440001';
const mockUserId = '550e8400-e29b-41d4-a716-446655440002';

const createMockAdAccount = (overrides: Partial<AdAccount> = {}): AdAccount => ({
  id: mockAccountId,
  platform: 'google_ads',
  account_id: 'ACC-123456',
  account_name: 'Test Account',
  access_token_encrypted: 'encrypted_token',
  refresh_token_encrypted: 'encrypted_refresh',
  token_expires_at: new Date('2025-01-15T00:00:00Z'),
  currency: 'USD',
  timezone: 'America/New_York',
  status: 'active',
  last_sync_at: new Date('2025-01-01T00:00:00Z'),
  sync_error: null,
  created_at: new Date('2024-12-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createMockCampaign = (overrides: Partial<AdCampaign> = {}): AdCampaign => ({
  id: mockCampaignId,
  ad_account_id: mockAccountId,
  platform_campaign_id: 'CAMP-789',
  name: 'Test Campaign',
  status: 'ENABLED',
  objective: 'CONVERSIONS',
  created_at: new Date('2024-12-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

const createMockDailySpend = (overrides: Partial<AdSpendDaily> = {}): AdSpendDaily => ({
  id: '550e8400-e29b-41d4-a716-446655440003',
  ad_account_id: mockAccountId,
  campaign_id: mockCampaignId,
  platform_campaign_id: 'CAMP-789',
  date: new Date('2025-01-01'),
  spend_cents: 10000,
  impressions: 50000,
  clicks: 1500,
  conversions: 75,
  currency: 'USD',
  synced_at: new Date('2025-01-01T12:00:00Z'),
  ...overrides,
});

const createMockConversion = (overrides: Partial<AdConversion> = {}): AdConversion => ({
  id: '550e8400-e29b-41d4-a716-446655440004',
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

describe('AdsRepository', () => {
  let repository: AdsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create fresh repository instance for each test
    repository = new AdsRepository();
  });

  // ===========================================================================
  // Ad Account Tests
  // ===========================================================================

  describe('Ad Account CRUD', () => {
    describe('createAdAccount', () => {
      it('should create a new ad account and return it', async () => {
        const input: AdAccountInsert = {
          platform: 'google_ads',
          account_id: 'ACC-123456',
          account_name: 'Test Account',
          currency: 'USD',
          status: 'pending',
        };

        const mockResult = createMockAdAccount({ status: 'pending' });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.createAdAccount(input);

        expect(result).toEqual(mockResult);
        expect(mockSql).toHaveBeenCalled();
      });

      it('should handle duplicate account gracefully', async () => {
        const input: AdAccountInsert = {
          platform: 'google_ads',
          account_id: 'ACC-123456',
        };

        const error = new Error('duplicate key value violates unique constraint');
        (error as any).code = '23505';
        mockSql.mockRejectedValueOnce(error);

        await expect(repository.createAdAccount(input)).rejects.toThrow();
      });
    });

    describe('findAdAccountById', () => {
      it('should return account when found', async () => {
        const mockAccount = createMockAdAccount();
        mockSql.mockResolvedValueOnce([mockAccount]);

        const result = await repository.findAdAccountById(mockAccountId);

        expect(result).toEqual(mockAccount);
      });

      it('should return null when account not found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.findAdAccountById('nonexistent-id');

        expect(result).toBeNull();
      });
    });

    describe('findAdAccountByPlatformId', () => {
      it('should return account matching platform and account_id', async () => {
        const mockAccount = createMockAdAccount();
        mockSql.mockResolvedValueOnce([mockAccount]);

        const result = await repository.findAdAccountByPlatformId(
          'google_ads',
          'ACC-123456'
        );

        expect(result).toEqual(mockAccount);
      });

      it('should return null when no match found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.findAdAccountByPlatformId(
          'facebook_ads',
          'nonexistent'
        );

        expect(result).toBeNull();
      });
    });

    describe('updateAdAccount', () => {
      it('should update account fields and return updated account', async () => {
        const update: AdAccountUpdate = {
          account_name: 'Updated Account Name',
          status: 'active',
          last_sync_at: new Date(),
        };

        const mockResult = createMockAdAccount({
          account_name: 'Updated Account Name',
          status: 'active',
        });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.updateAdAccount(mockAccountId, update);

        expect(result).toEqual(mockResult);
        expect(result.account_name).toBe('Updated Account Name');
        expect(result.status).toBe('active');
      });

      it('should throw NotFoundError when account does not exist', async () => {
        mockSql.mockResolvedValueOnce([]);

        await expect(
          repository.updateAdAccount('nonexistent-id', { status: 'active' })
        ).rejects.toThrow();
      });
    });

    describe('listAdAccounts', () => {
      it('should return all accounts with pagination', async () => {
        const mockAccounts = [
          createMockAdAccount({ id: 'acc-1', platform: 'google_ads' }),
          createMockAdAccount({ id: 'acc-2', platform: 'facebook_ads' }),
        ];
        mockSql.mockResolvedValueOnce(mockAccounts);

        const result = await repository.listAdAccounts();

        expect(result.data).toHaveLength(2);
        expect(result.hasMore).toBe(false);
      });

      it('should filter by platform', async () => {
        const mockAccounts = [
          createMockAdAccount({ platform: 'google_ads' }),
        ];
        mockSql.mockResolvedValueOnce(mockAccounts);

        const result = await repository.listAdAccounts({ platform: 'google_ads' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].platform).toBe('google_ads');
      });

      it('should filter by status', async () => {
        const mockAccounts = [
          createMockAdAccount({ status: 'active' }),
        ];
        mockSql.mockResolvedValueOnce(mockAccounts);

        const result = await repository.listAdAccounts({ status: 'active' });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].status).toBe('active');
      });

      it('should respect pagination parameters', async () => {
        const mockAccounts = Array.from({ length: 11 }, (_, i) =>
          createMockAdAccount({ id: `acc-${i}` })
        );
        mockSql.mockResolvedValueOnce(mockAccounts);

        const result = await repository.listAdAccounts({ limit: 10, offset: 0 });

        expect(result.data).toHaveLength(10);
        expect(result.hasMore).toBe(true);
      });
    });

    describe('deleteAdAccount', () => {
      it('should delete account successfully', async () => {
        mockSql.mockResolvedValueOnce([{ id: mockAccountId }]);

        await expect(repository.deleteAdAccount(mockAccountId)).resolves.not.toThrow();
      });

      it('should throw NotFoundError when account does not exist', async () => {
        mockSql.mockResolvedValueOnce([]);

        await expect(repository.deleteAdAccount('nonexistent-id')).rejects.toThrow();
      });
    });
  });

  // ===========================================================================
  // Campaign Tests
  // ===========================================================================

  describe('Campaign Operations', () => {
    describe('upsertCampaign', () => {
      it('should create new campaign if not exists', async () => {
        const input: AdCampaignInsert = {
          ad_account_id: mockAccountId,
          platform_campaign_id: 'CAMP-789',
          name: 'New Campaign',
          status: 'ENABLED',
          objective: 'CONVERSIONS',
        };

        const mockResult = createMockCampaign();
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertCampaign(input);

        expect(result).toEqual(mockResult);
      });

      it('should update existing campaign', async () => {
        const input: AdCampaignInsert = {
          ad_account_id: mockAccountId,
          platform_campaign_id: 'CAMP-789',
          name: 'Updated Campaign Name',
          status: 'PAUSED',
        };

        const mockResult = createMockCampaign({
          name: 'Updated Campaign Name',
          status: 'PAUSED',
        });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertCampaign(input);

        expect(result.name).toBe('Updated Campaign Name');
        expect(result.status).toBe('PAUSED');
      });
    });

    describe('findCampaignById', () => {
      it('should return campaign when found', async () => {
        const mockCampaign = createMockCampaign();
        mockSql.mockResolvedValueOnce([mockCampaign]);

        const result = await repository.findCampaignById(mockCampaignId);

        expect(result).toEqual(mockCampaign);
      });

      it('should return null when not found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.findCampaignById('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('findCampaignByPlatformId', () => {
      it('should return campaign matching platform campaign ID', async () => {
        const mockCampaign = createMockCampaign();
        mockSql.mockResolvedValueOnce([mockCampaign]);

        const result = await repository.findCampaignByPlatformId(
          mockAccountId,
          'CAMP-789'
        );

        expect(result).toEqual(mockCampaign);
      });
    });

    describe('listCampaigns', () => {
      it('should return campaigns for given account', async () => {
        const mockCampaigns = [
          createMockCampaign({ name: 'Campaign 1' }),
          createMockCampaign({ id: 'camp-2', name: 'Campaign 2' }),
        ];
        mockSql.mockResolvedValueOnce(mockCampaigns);

        const result = await repository.listCampaigns({ adAccountId: mockAccountId });

        expect(result.data).toHaveLength(2);
      });

      it('should support pagination', async () => {
        const mockCampaigns = Array.from({ length: 51 }, (_, i) =>
          createMockCampaign({ id: `camp-${i}`, name: `Campaign ${i}` })
        );
        mockSql.mockResolvedValueOnce(mockCampaigns);

        const result = await repository.listCampaigns({
          adAccountId: mockAccountId,
          limit: 50,
        });

        expect(result.data).toHaveLength(50);
        expect(result.hasMore).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Daily Spend Tests
  // ===========================================================================

  describe('Daily Spend Operations', () => {
    describe('upsertDailySpend', () => {
      it('should create new daily spend record', async () => {
        const input: AdSpendDailyUpsert = {
          ad_account_id: mockAccountId,
          platform_campaign_id: 'CAMP-789',
          date: new Date('2025-01-01'),
          spend_cents: 10000,
          impressions: 50000,
          clicks: 1500,
          conversions: 75,
          currency: 'USD',
        };

        const mockResult = createMockDailySpend();
        // First call: find campaign ID (no match)
        mockSql.mockResolvedValueOnce([]);
        // Second call: insert spend data
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertDailySpend(input);

        expect(result).toEqual(mockResult);
      });

      it('should update existing record for same date/campaign', async () => {
        const input: AdSpendDailyUpsert = {
          ad_account_id: mockAccountId,
          platform_campaign_id: 'CAMP-789',
          date: new Date('2025-01-01'),
          spend_cents: 15000, // Updated spend
          impressions: 60000,
          clicks: 2000,
          conversions: 100,
        };

        const mockResult = createMockDailySpend({
          spend_cents: 15000,
          impressions: 60000,
          clicks: 2000,
          conversions: 100,
        });
        // First call: find campaign ID
        mockSql.mockResolvedValueOnce([{ id: mockCampaignId }]);
        // Second call: upsert spend data
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertDailySpend(input);

        expect(result.spend_cents).toBe(15000);
        expect(result.conversions).toBe(100);
      });
    });

    describe('getSpendByDateRange', () => {
      it('should return spend records within date range', async () => {
        const mockSpendRecords = [
          createMockDailySpend({ date: new Date('2025-01-01') }),
          createMockDailySpend({ id: 'spend-2', date: new Date('2025-01-02') }),
          createMockDailySpend({ id: 'spend-3', date: new Date('2025-01-03') }),
        ];
        mockSql.mockResolvedValueOnce(mockSpendRecords);

        const result = await repository.getSpendByDateRange({
          adAccountId: mockAccountId,
          dateRange: {
            from: new Date('2025-01-01'),
            to: new Date('2025-01-03'),
          },
        });

        expect(result).toHaveLength(3);
      });

      it('should filter by campaign if provided', async () => {
        const mockSpendRecords = [
          createMockDailySpend({ campaign_id: mockCampaignId }),
        ];
        mockSql.mockResolvedValueOnce(mockSpendRecords);

        const result = await repository.getSpendByDateRange({
          adAccountId: mockAccountId,
          dateRange: {
            from: new Date('2025-01-01'),
            to: new Date('2025-01-31'),
          },
          campaignId: mockCampaignId,
        });

        expect(result).toHaveLength(1);
        expect(result[0].campaign_id).toBe(mockCampaignId);
      });

      it('should return empty array when no records found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.getSpendByDateRange({
          adAccountId: mockAccountId,
          dateRange: {
            from: new Date('2030-01-01'),
            to: new Date('2030-01-31'),
          },
        });

        expect(result).toHaveLength(0);
      });
    });

    describe('getSpendTrend', () => {
      it('should return aggregated daily spend trend', async () => {
        const mockTrend: SpendTrendPoint[] = [
          {
            date: new Date('2025-01-01'),
            spend_cents: 10000,
            impressions: 50000,
            clicks: 1500,
            conversions: 75,
          },
          {
            date: new Date('2025-01-02'),
            spend_cents: 12000,
            impressions: 55000,
            clicks: 1800,
            conversions: 90,
          },
        ];
        mockSql.mockResolvedValueOnce(mockTrend);

        const result = await repository.getSpendTrend(
          new Date('2025-01-01'),
          new Date('2025-01-02')
        );

        expect(result).toHaveLength(2);
        expect(result[0].spend_cents).toBe(10000);
      });

      it('should return aggregated trend for date range', async () => {
        const mockTrend: SpendTrendPoint[] = [
          {
            date: new Date('2025-01-01'),
            spend_cents: 10000,
            impressions: 50000,
            clicks: 1500,
            conversions: 75,
          },
        ];
        mockSql.mockResolvedValueOnce(mockTrend);

        const result = await repository.getSpendTrend(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(result).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // Conversion Tests
  // ===========================================================================

  describe('Conversion Operations', () => {
    describe('createConversion', () => {
      it('should create new conversion record', async () => {
        const input: AdConversionInsert = {
          user_id: mockUserId,
          conversion_type: 'signup',
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'brand',
        };

        const mockResult = createMockConversion();
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.createConversion(input);

        expect(result).toEqual(mockResult);
        expect(result.conversion_type).toBe('signup');
      });

      it('should create payment conversion with revenue', async () => {
        const input: AdConversionInsert = {
          user_id: mockUserId,
          conversion_type: 'first_payment',
          revenue_cents: 2999,
          utm_source: 'google',
        };

        const mockResult = createMockConversion({
          conversion_type: 'first_payment',
          revenue_cents: 2999,
        });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.createConversion(input);

        expect(result.conversion_type).toBe('first_payment');
        expect(result.revenue_cents).toBe(2999);
      });
    });

    describe('getConversionsByUser', () => {
      it('should return all conversions for a user', async () => {
        const mockConversions = [
          createMockConversion({ conversion_type: 'signup' }),
          createMockConversion({
            id: 'conv-2',
            conversion_type: 'first_payment',
            revenue_cents: 2999,
          }),
        ];
        mockSql.mockResolvedValueOnce(mockConversions);

        const result = await repository.getConversionsByUser(mockUserId);

        expect(result).toHaveLength(2);
      });

      it('should return empty array when no conversions', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.getConversionsByUser('user-no-conversions');

        expect(result).toHaveLength(0);
      });
    });

    describe('getConversionsByCampaign', () => {
      it('should return conversions for a specific campaign', async () => {
        const mockConversions = [
          createMockConversion({ campaign_id: mockCampaignId }),
          createMockConversion({ id: 'conv-2', campaign_id: mockCampaignId }),
        ];
        mockSql.mockResolvedValueOnce(mockConversions);

        const result = await repository.getConversionsByCampaign(mockCampaignId);

        expect(result.data).toHaveLength(2);
        expect(result.data[0].campaign_id).toBe(mockCampaignId);
      });
    });

    describe('findConversionByUserAndType', () => {
      it('should return conversion for user and type', async () => {
        const mockConversion = createMockConversion({ conversion_type: 'signup' });
        mockSql.mockResolvedValueOnce([mockConversion]);

        const result = await repository.findConversionByUserAndType(mockUserId, 'signup');

        expect(result).toEqual(mockConversion);
        expect(result?.conversion_type).toBe('signup');
      });

      it('should return null when no conversion found', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.findConversionByUserAndType(mockUserId, 'first_payment');

        expect(result).toBeNull();
      });
    });

    describe('updateConversionLtv', () => {
      it('should update LTV on all conversion records for a user', async () => {
        mockSql.mockResolvedValueOnce([]);

        await expect(
          repository.updateConversionLtv(mockUserId, 5000)
        ).resolves.not.toThrow();

        expect(mockSql).toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // User LTV Tests
  // ===========================================================================

  describe('User LTV Operations', () => {
    describe('upsertUserLtv', () => {
      it('should create new user LTV record', async () => {
        const input: UserLtvInsert = {
          user_id: mockUserId,
          total_payments_cents: 2999,
          subscription_revenue_cents: 2999,
          token_revenue_cents: 0,
          ltv_cents: 2999,
          first_payment_at: new Date(),
          last_payment_at: new Date(),
        };

        const mockResult = createMockUserLtv({
          total_payments_cents: 2999,
          ltv_cents: 2999,
        });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertUserLtv(input);

        expect(result.ltv_cents).toBe(2999);
      });

      it('should update existing user LTV', async () => {
        const input: UserLtvInsert = {
          user_id: mockUserId,
          total_payments_cents: 6000,
          ltv_cents: 6000,
        };

        const mockResult = createMockUserLtv({
          total_payments_cents: 6000,
          ltv_cents: 6000,
        });
        mockSql.mockResolvedValueOnce([mockResult]);

        const result = await repository.upsertUserLtv(input);

        expect(result.total_payments_cents).toBe(6000);
      });
    });

    describe('getUserLtv', () => {
      it('should return user LTV when exists', async () => {
        const mockLtv = createMockUserLtv();
        mockSql.mockResolvedValueOnce([mockLtv]);

        const result = await repository.getUserLtv(mockUserId);

        expect(result).toEqual(mockLtv);
      });

      it('should return null when user has no LTV record', async () => {
        mockSql.mockResolvedValueOnce([]);

        const result = await repository.getUserLtv('user-no-ltv');

        expect(result).toBeNull();
      });
    });

  });

  // ===========================================================================
  // Overview Metrics Tests
  // ===========================================================================

  describe('Overview Metrics', () => {
    describe('getOverviewMetrics', () => {
      it('should return aggregated overview metrics', async () => {
        const mockMetrics: AdOverviewMetrics = {
          total_spend_cents: 500000,
          total_impressions: 2500000,
          total_clicks: 75000,
          total_signups: 500,
          total_conversions: 100,
          total_revenue_cents: 250000,
          total_ltv_cents: 500000,
          spend_by_platform: {
            google_ads: 300000,
            facebook_ads: 200000,
          },
          signups_by_platform: {
            google_ads: 300,
            facebook_ads: 200,
          },
        };
        mockSql.mockResolvedValueOnce([mockMetrics]);

        const result = await repository.getOverviewMetrics(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(result.total_spend_cents).toBe(500000);
        expect(result.total_signups).toBe(500);
        expect(result.spend_by_platform.google_ads).toBe(300000);
      });

      it('should return zero values when no data', async () => {
        const mockMetrics: AdOverviewMetrics = {
          total_spend_cents: 0,
          total_impressions: 0,
          total_clicks: 0,
          total_signups: 0,
          total_conversions: 0,
          total_revenue_cents: 0,
          total_ltv_cents: 0,
          spend_by_platform: {},
          signups_by_platform: {},
        };
        mockSql.mockResolvedValueOnce([mockMetrics]);

        const result = await repository.getOverviewMetrics(
          new Date('2030-01-01'),
          new Date('2030-01-31')
        );

        expect(result.total_spend_cents).toBe(0);
        expect(result.total_signups).toBe(0);
      });
    });

    describe('getCampaignMetrics', () => {
      it('should return metrics for all campaigns', async () => {
        const mockCampaignMetrics: CampaignMetrics[] = [
          {
            campaign_id: mockCampaignId,
            campaign_name: 'Test Campaign',
            platform: 'google_ads',
            total_spend_cents: 100000,
            total_impressions: 500000,
            total_clicks: 15000,
            signup_count: 100,
            conversion_count: 25,
            total_revenue_cents: 75000,
            total_ltv_cents: 125000,
          },
          {
            campaign_id: 'camp-2',
            campaign_name: 'Facebook Campaign',
            platform: 'facebook_ads',
            total_spend_cents: 80000,
            total_impressions: 400000,
            total_clicks: 12000,
            signup_count: 80,
            conversion_count: 20,
            total_revenue_cents: 60000,
            total_ltv_cents: 100000,
          },
        ];
        mockSql.mockResolvedValueOnce(mockCampaignMetrics);

        const result = await repository.getCampaignMetrics(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(result).toHaveLength(2);
        expect(result[0].campaign_name).toBe('Test Campaign');
      });

      it('should return only campaigns from connected accounts', async () => {
        const mockCampaignMetrics: CampaignMetrics[] = [
          {
            campaign_id: mockCampaignId,
            campaign_name: 'Google Campaign',
            platform: 'google_ads',
            total_spend_cents: 100000,
            total_impressions: 500000,
            total_clicks: 15000,
            signup_count: 100,
            conversion_count: 25,
            total_revenue_cents: 75000,
            total_ltv_cents: 125000,
          },
        ];
        mockSql.mockResolvedValueOnce(mockCampaignMetrics);

        const result = await repository.getCampaignMetrics(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(result).toHaveLength(1);
        expect(result[0].platform).toBe('google_ads');
      });
    });

    describe('getUtmAttributionStats', () => {
      it('should return UTM attribution statistics', async () => {
        const mockStats: UtmAttributionStats[] = [
          {
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: 'brand',
            signup_count: 100,
            conversion_count: 25,
            total_revenue_cents: 75000,
            total_ltv_cents: 125000,
          },
          {
            utm_source: 'facebook',
            utm_medium: 'social',
            utm_campaign: 'retargeting',
            signup_count: 50,
            conversion_count: 15,
            total_revenue_cents: 45000,
            total_ltv_cents: 75000,
          },
        ];
        mockSql.mockResolvedValueOnce(mockStats);

        const result = await repository.getUtmAttributionStats(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(result).toHaveLength(2);
        expect(result[0].utm_source).toBe('google');
        expect(result[0].signup_count).toBe(100);
      });
    });
  });

  // ===========================================================================
  // Singleton Pattern Test
  // ===========================================================================

  describe('getAdsRepository', () => {
    it('should return singleton instance', () => {
      const instance1 = getAdsRepository();
      const instance2 = getAdsRepository();

      expect(instance1).toBe(instance2);
    });
  });
});
