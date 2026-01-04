/**
 * Admin Ads Routes Integration Tests
 *
 * Tests for ad tracking admin routes including:
 * - GET /api/v1/admin/ads/accounts - List ad accounts
 * - POST /api/v1/admin/ads/connect/google - Google Ads OAuth
 * - POST /api/v1/admin/ads/connect/facebook - Facebook Ads OAuth
 * - GET /api/v1/admin/ads/overview - Overview metrics
 * - GET /api/v1/admin/ads/campaigns - Campaign data
 * - DELETE /api/v1/admin/ads/accounts/:id - Disconnect account
 * - POST /api/v1/admin/ads/accounts/:id/sync - Trigger sync
 *
 * All routes require admin authentication.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type {
  AdAccount,
  AdOverviewMetrics,
  CampaignMetrics,
  AdPlatform,
} from '../../db/types.js';

// Mock repositories
const mockAdsRepository = {
  listAccounts: vi.fn(),
  findAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getOverviewMetrics: vi.fn(),
  getCampaignMetrics: vi.fn(),
  getSpendTrend: vi.fn(),
  getActiveAccountsForSync: vi.fn(),
};

const mockUsersRepository = {
  findById: vi.fn(),
};

// Mock services
const mockAdSyncService = {
  syncAccount: vi.fn(),
  queueAccountSync: vi.fn(),
};

// Mock OAuth services
const mockGoogleAdsOAuth = {
  getAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
};

const mockFacebookAdsOAuth = {
  getAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
};

// Mock auth middleware
const mockVerifyToken = vi.fn();
const mockRequireAdmin = vi.fn();

vi.mock('../../repositories/index.js', () => ({
  getAdsRepository: () => mockAdsRepository,
  getUsersRepository: () => mockUsersRepository,
}));

vi.mock('../../services/ad-sync.js', () => ({
  getAdSyncService: () => mockAdSyncService,
}));

vi.mock('../../services/google-ads-oauth.js', () => ({
  getGoogleAdsOAuth: () => mockGoogleAdsOAuth,
}));

vi.mock('../../services/facebook-ads-oauth.js', () => ({
  getFacebookAdsOAuth: () => mockFacebookAdsOAuth,
}));

vi.mock('../../middleware/auth.js', () => ({
  verifyToken: async (request: any) => {
    const result = mockVerifyToken(request);
    if (result) {
      request.user = result;
    }
  },
  requireAdmin: async (request: any, reply: any) => {
    const result = mockRequireAdmin(request, reply);
    if (result === false) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
  },
  createToken: vi.fn(),
  createRefreshToken: vi.fn(),
}));

// Mock database pool - used by routes that have raw SQL
const mockSql = vi.fn().mockResolvedValue([]);
vi.mock('../../db/pool.js', () => ({
  sql: () => mockSql,
}));

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

// Test fixtures
const mockAdminUser = {
  userId: '550e8400-e29b-41d4-a716-446655440000',
  email: 'admin@example.com',
  role: 'admin' as const,
};

const mockRegularUser = {
  userId: '550e8400-e29b-41d4-a716-446655440001',
  email: 'user@example.com',
  role: 'user' as const,
};

const mockAccountId = '550e8400-e29b-41d4-a716-446655440010';

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

// Helper to create app with routes
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Import the routes dynamically after mocking
  const { adminAdsRoutes } = await import('../admin-ads.js');
  await app.register(adminAdsRoutes, { prefix: '/api/v1/admin/ads' });

  return app;
}

describe('Admin Ads Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticate as admin
    mockVerifyToken.mockReturnValue(mockAdminUser);
    mockRequireAdmin.mockReturnValue(true);
  });

  // ===========================================================================
  // Authentication Tests
  // ===========================================================================

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      mockVerifyToken.mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-admin users', async () => {
      mockVerifyToken.mockReturnValue(mockRegularUser);
      mockRequireAdmin.mockReturnValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin users', async () => {
      mockVerifyToken.mockReturnValue(mockAdminUser);
      mockRequireAdmin.mockReturnValue(true);
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: [],
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: {
          authorization: 'Bearer valid-admin-token',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ===========================================================================
  // GET /api/v1/admin/ads/accounts Tests
  // ===========================================================================

  describe('GET /api/v1/admin/ads/accounts', () => {
    it('should return list of ad accounts', async () => {
      const mockAccounts = [
        createMockAdAccount({ id: 'acc-1', platform: 'google_ads' }),
        createMockAdAccount({ id: 'acc-2', platform: 'facebook_ads' }),
      ];
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: mockAccounts,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.accounts).toHaveLength(2);
    });

    it('should filter by platform', async () => {
      const mockAccounts = [
        createMockAdAccount({ platform: 'google_ads' }),
      ];
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: mockAccounts,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts?platform=google_ads',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.accounts).toHaveLength(1);
      expect(mockAdsRepository.listAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'google_ads' })
      );
    });

    it('should filter by status', async () => {
      const mockAccounts = [
        createMockAdAccount({ status: 'active' }),
      ];
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: mockAccounts,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts?status=active',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockAdsRepository.listAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' })
      );
    });

    it('should support pagination', async () => {
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: [],
        hasMore: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts?limit=10&offset=20',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.hasMore).toBe(true);
    });

    it('should not expose encrypted tokens', async () => {
      const mockAccounts = [
        createMockAdAccount({
          access_token_encrypted: 'secret-token',
          refresh_token_encrypted: 'secret-refresh',
        }),
      ];
      mockAdsRepository.listAccounts.mockResolvedValueOnce({
        data: mockAccounts,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.accounts[0].access_token_encrypted).toBeUndefined();
      expect(body.data.accounts[0].refresh_token_encrypted).toBeUndefined();
    });
  });

  // ===========================================================================
  // POST /api/v1/admin/ads/connect/google Tests
  // ===========================================================================

  describe('POST /api/v1/admin/ads/connect/google', () => {
    it('should return Google Ads OAuth URL', async () => {
      const mockAuthUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=xxx';
      mockGoogleAdsOAuth.getAuthUrl.mockReturnValueOnce(mockAuthUrl);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/google',
        headers: { authorization: 'Bearer token' },
        payload: {
          redirectUri: 'https://app.example.com/oauth/callback',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.authUrl).toBe(mockAuthUrl);
    });

    it('should validate redirect URI', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/google',
        headers: { authorization: 'Bearer token' },
        payload: {
          redirectUri: 'invalid-url',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/v1/admin/ads/connect/facebook Tests
  // ===========================================================================

  describe('POST /api/v1/admin/ads/connect/facebook', () => {
    it('should return Facebook Ads OAuth URL', async () => {
      const mockAuthUrl = 'https://www.facebook.com/v18.0/dialog/oauth?client_id=xxx';
      mockFacebookAdsOAuth.getAuthUrl.mockReturnValueOnce(mockAuthUrl);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/facebook',
        headers: { authorization: 'Bearer token' },
        payload: {
          redirectUri: 'https://app.example.com/oauth/callback',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.authUrl).toBe(mockAuthUrl);
    });

    it('should validate redirect URI', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/facebook',
        headers: { authorization: 'Bearer token' },
        payload: {
          redirectUri: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/v1/admin/ads/callback/google Tests
  // ===========================================================================

  describe('POST /api/v1/admin/ads/callback/google', () => {
    it('should exchange code for tokens and create account', async () => {
      mockGoogleAdsOAuth.exchangeCodeForTokens.mockResolvedValueOnce({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date('2025-01-15'),
        accountId: 'ACC-123456',
        accountName: 'My Google Ads Account',
      });

      mockAdsRepository.createAccount.mockResolvedValueOnce(
        createMockAdAccount({ platform: 'google_ads' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/callback/google',
        headers: { authorization: 'Bearer token' },
        payload: {
          code: 'oauth-authorization-code',
          redirectUri: 'https://app.example.com/oauth/callback',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.account.platform).toBe('google_ads');
    });

    it('should reject invalid authorization code', async () => {
      mockGoogleAdsOAuth.exchangeCodeForTokens.mockRejectedValueOnce(
        new Error('Invalid authorization code')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/callback/google',
        headers: { authorization: 'Bearer token' },
        payload: {
          code: 'invalid-code',
          redirectUri: 'https://app.example.com/oauth/callback',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // GET /api/v1/admin/ads/overview Tests
  // ===========================================================================

  describe('GET /api/v1/admin/ads/overview', () => {
    it('should return overview metrics', async () => {
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
      mockAdsRepository.getOverviewMetrics.mockResolvedValueOnce(mockMetrics);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.metrics.totalSpendCents).toBe(500000);
      expect(body.data.metrics.totalSignups).toBe(500);
    });

    it('should calculate ROAS correctly', async () => {
      const mockMetrics: AdOverviewMetrics = {
        total_spend_cents: 100000, // $1000
        total_impressions: 500000,
        total_clicks: 15000,
        total_signups: 100,
        total_conversions: 25,
        total_revenue_cents: 250000, // $2500
        total_ltv_cents: 400000, // $4000
        spend_by_platform: {},
        signups_by_platform: {},
      };
      mockAdsRepository.getOverviewMetrics.mockResolvedValueOnce(mockMetrics);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      const body = JSON.parse(response.body);
      // ROAS = Revenue / Spend = 2500 / 1000 = 2.5
      expect(body.data.metrics.roas).toBe(2.5);
      // LTV ROAS = LTV / Spend = 4000 / 1000 = 4.0
      expect(body.data.metrics.ltvRoas).toBe(4.0);
    });

    it('should handle zero spend gracefully', async () => {
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
      mockAdsRepository.getOverviewMetrics.mockResolvedValueOnce(mockMetrics);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.metrics.roas).toBe(0);
      expect(body.data.metrics.ctr).toBe(0);
    });

    it('should require date range parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate date format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview?startDate=invalid&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // GET /api/v1/admin/ads/campaigns Tests
  // ===========================================================================

  describe('GET /api/v1/admin/ads/campaigns', () => {
    it('should return campaign metrics', async () => {
      const mockCampaigns: CampaignMetrics[] = [
        {
          campaign_id: 'camp-1',
          campaign_name: 'Brand Awareness',
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
          campaign_name: 'Retargeting',
          platform: 'facebook_ads',
          total_spend_cents: 50000,
          total_impressions: 200000,
          total_clicks: 8000,
          signup_count: 50,
          conversion_count: 15,
          total_revenue_cents: 45000,
          total_ltv_cents: 75000,
        },
      ];
      mockAdsRepository.getCampaignMetrics.mockResolvedValueOnce(mockCampaigns);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/campaigns?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.campaigns).toHaveLength(2);
    });

    it('should calculate per-campaign metrics', async () => {
      const mockCampaigns: CampaignMetrics[] = [
        {
          campaign_id: 'camp-1',
          campaign_name: 'Test Campaign',
          platform: 'google_ads',
          total_spend_cents: 100000, // $1000
          total_impressions: 500000,
          total_clicks: 10000,
          signup_count: 100,
          conversion_count: 25,
          total_revenue_cents: 200000, // $2000
          total_ltv_cents: 300000, // $3000
        },
      ];
      mockAdsRepository.getCampaignMetrics.mockResolvedValueOnce(mockCampaigns);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/campaigns?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      const body = JSON.parse(response.body);
      const campaign = body.data.campaigns[0];

      // CTR = clicks / impressions * 100
      expect(campaign.ctr).toBe(2.0);
      // CPA = spend / signups (in cents)
      expect(campaign.cpaCents).toBe(1000);
      // ROAS = revenue / spend
      expect(campaign.roas).toBe(2.0);
    });

    it('should filter by platform', async () => {
      mockAdsRepository.getCampaignMetrics.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/campaigns?startDate=2025-01-01&endDate=2025-01-31&platform=google_ads',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockAdsRepository.getCampaignMetrics).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'google_ads'
      );
    });

    it('should sort by spend descending by default', async () => {
      const mockCampaigns: CampaignMetrics[] = [
        {
          campaign_id: 'camp-1',
          campaign_name: 'Low Spend',
          platform: 'google_ads',
          total_spend_cents: 10000,
          total_impressions: 50000,
          total_clicks: 1000,
          signup_count: 10,
          conversion_count: 2,
          total_revenue_cents: 5000,
          total_ltv_cents: 8000,
        },
        {
          campaign_id: 'camp-2',
          campaign_name: 'High Spend',
          platform: 'google_ads',
          total_spend_cents: 100000,
          total_impressions: 500000,
          total_clicks: 10000,
          signup_count: 100,
          conversion_count: 25,
          total_revenue_cents: 75000,
          total_ltv_cents: 125000,
        },
      ];
      mockAdsRepository.getCampaignMetrics.mockResolvedValueOnce(mockCampaigns);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/campaigns?startDate=2025-01-01&endDate=2025-01-31',
        headers: { authorization: 'Bearer token' },
      });

      const body = JSON.parse(response.body);
      // Should be sorted by spend descending
      expect(body.data.campaigns[0].campaignName).toBe('High Spend');
    });
  });

  // ===========================================================================
  // DELETE /api/v1/admin/ads/accounts/:id Tests
  // ===========================================================================

  describe('DELETE /api/v1/admin/ads/accounts/:id', () => {
    it('should disconnect ad account', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(createMockAdAccount());
      mockAdsRepository.deleteAccount.mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/ads/accounts/${mockAccountId}`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(204);
      expect(mockAdsRepository.deleteAccount).toHaveBeenCalledWith(mockAccountId);
    });

    it('should return 404 for non-existent account', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/ads/accounts/nonexistent-id',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should validate account ID format', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/ads/accounts/invalid-uuid',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/v1/admin/ads/accounts/:id/sync Tests
  // ===========================================================================

  describe('POST /api/v1/admin/ads/accounts/:id/sync', () => {
    it('should trigger account sync', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(
        createMockAdAccount({ status: 'active' })
      );
      mockAdSyncService.queueAccountSync.mockResolvedValueOnce({ jobId: 'job-123' });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/ads/accounts/${mockAccountId}/sync`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.jobId).toBe('job-123');
    });

    it('should return 404 for non-existent account', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/accounts/nonexistent-id/sync',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject sync for disconnected accounts', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(
        createMockAdAccount({ status: 'disconnected' })
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/ads/accounts/${mockAccountId}/sync`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('disconnected');
    });

    it('should allow sync with date range', async () => {
      mockAdsRepository.findAccountById.mockResolvedValueOnce(
        createMockAdAccount({ status: 'active' })
      );
      mockAdSyncService.queueAccountSync.mockResolvedValueOnce({ jobId: 'job-456' });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/ads/accounts/${mockAccountId}/sync`,
        headers: { authorization: 'Bearer token' },
        payload: {
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(mockAdSyncService.queueAccountSync).toHaveBeenCalledWith(
        mockAccountId,
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        })
      );
    });
  });

  // ===========================================================================
  // GET /api/v1/admin/ads/spend-trend Tests
  // ===========================================================================

  describe('GET /api/v1/admin/ads/spend-trend', () => {
    it('should return daily spend trend data', async () => {
      // The route uses raw SQL via mockSql, not the repository
      const mockTrend = [
        {
          date: new Date('2025-01-01'),
          total_spend_cents: 10000,
          google_spend_cents: 6000,
          facebook_spend_cents: 4000,
          signups: 50,
          conversions: 10,
        },
        {
          date: new Date('2025-01-02'),
          total_spend_cents: 12000,
          google_spend_cents: 7000,
          facebook_spend_cents: 5000,
          signups: 55,
          conversions: 12,
        },
      ];
      mockSql.mockResolvedValueOnce(mockTrend);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/spend-trend?days=30',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.trend).toHaveLength(2);
    });

    it('should use default days when not specified', async () => {
      mockSql.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/spend-trend',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.trend).toEqual([]);
    });
  });
});
