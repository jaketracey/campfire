/**
 * Admin Ads Routes Tests
 *
 * These tests match the current implementation in `src/routes/admin-ads.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { mockEnv, mockDb, authState, facebookAdsService } = vi.hoisted(() => {
  const mockEnv = {
    WEB_BASE_URL: 'https://app.example.com',
    WEB_URL: 'https://app.example.com',
    API_BASE_URL: 'https://api.example.com',
    GOOGLE_ADS_CLIENT_ID: 'google-client-id',
    GOOGLE_OAUTH_CLIENT_ID: undefined as string | undefined,
  };

  const mockDb = vi.fn().mockResolvedValue([]);

  const authState = {
    role: 'admin' as 'admin' | 'user',
  };

  const facebookAdsService = {
    getAuthUrl: vi.fn<(state: string) => string>(() => 'https://facebook.example.com/oauth'),
    handleCallback: vi.fn<(code: string) => Promise<{ id: string }>>(async () => ({ id: 'fb-account-id' })),
  };

  return { mockEnv, mockDb, authState, facebookAdsService };
});

vi.mock('../../env.js', () => ({ env: mockEnv }));

vi.mock('../../db/pool.js', () => ({
  sql: () => mockDb,
}));

vi.mock('../../services/facebook-ads.js', () => ({
  getFacebookAdsService: () => facebookAdsService,
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAdmin: async (request: any, reply: any) => {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
    }

    request.user = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'admin@example.com',
      role: authState.role,
    };

    if (authState.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
  },
  createToken: vi.fn(),
  createRefreshToken: vi.fn(),
  verifyToken: vi.fn(),
  requireAuth: vi.fn(),
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

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
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
    mockDb.mockReset();
    mockDb.mockResolvedValue([]);
    authState.role = 'admin';
    mockEnv.GOOGLE_ADS_CLIENT_ID = 'google-client-id';
    mockEnv.GOOGLE_OAUTH_CLIENT_ID = undefined;
  });

  describe('Authentication', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects non-admin users', async () => {
      authState.role = 'user';

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/admin/ads/accounts', () => {
    it('returns accounts with safe fields', async () => {
      mockDb.mockResolvedValueOnce([
        {
          id: '550e8400-e29b-41d4-a716-446655440010',
          platform: 'google_ads',
          account_id: 'ACC-123',
          account_name: 'Google Account',
          currency: 'USD',
          timezone: 'UTC',
          status: 'active',
          last_sync_at: new Date('2025-01-01T00:00:00Z'),
          sync_error: null,
          created_at: new Date('2024-12-01T00:00:00Z'),
          updated_at: new Date('2025-01-01T00:00:00Z'),
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/accounts',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.accounts).toHaveLength(1);
      expect(body.data.accounts[0]).toMatchObject({
        id: '550e8400-e29b-41d4-a716-446655440010',
        platform: 'google_ads',
        accountId: 'ACC-123',
        accountName: 'Google Account',
      });
      expect(body.data.accounts[0].access_token_encrypted).toBeUndefined();
      expect(body.data.accounts[0].refresh_token_encrypted).toBeUndefined();
    });
  });

  describe('POST /api/v1/admin/ads/connect/google', () => {
    it('returns a Google OAuth URL when configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/google',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(typeof body.data.authUrl).toBe('string');

      const url = new URL(body.data.authUrl);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.searchParams.get('client_id')).toBe('google-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/api/v1/admin/ads/callback/google');
      expect(url.searchParams.get('scope')).toContain('adwords');
      expect(url.searchParams.get('state')).toBeTruthy();
    });

    it('returns 503 when not configured', async () => {
      mockEnv.GOOGLE_ADS_CLIENT_ID = undefined as unknown as string;
      mockEnv.GOOGLE_OAUTH_CLIENT_ID = undefined;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/google',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('POST /api/v1/admin/ads/connect/facebook', () => {
    it('returns a Facebook OAuth URL', async () => {
      facebookAdsService.getAuthUrl.mockReturnValueOnce('https://facebook.example.com/oauth?state=abc');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/connect/facebook',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.authUrl).toBe('https://facebook.example.com/oauth?state=abc');
      expect(facebookAdsService.getAuthUrl).toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe('GET /api/v1/admin/ads/callback/google', () => {
    it('redirects with oauth_denied on error', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/callback/google?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://app.example.com/admin/ads?error=oauth_denied');
    });

    it('redirects with missing_code when code absent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/callback/google',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://app.example.com/admin/ads?error=missing_code');
    });

    it('redirects with google_connected when code present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/callback/google?code=abc&state=xyz',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://app.example.com/admin/ads?success=google_connected');
    });
  });

  describe('GET /api/v1/admin/ads/callback/facebook', () => {
    it('calls handleCallback and redirects on success', async () => {
      facebookAdsService.handleCallback.mockResolvedValueOnce({ id: 'fb-acc' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/callback/facebook?code=abc',
      });

      expect(facebookAdsService.handleCallback).toHaveBeenCalledWith('abc');
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://app.example.com/admin/ads?success=facebook_connected');
    });
  });

  describe('DELETE /api/v1/admin/ads/accounts/:id', () => {
    it('returns 400 for invalid UUID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/ads/accounts/not-a-uuid',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when account not found', async () => {
      mockDb.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/ads/accounts/550e8400-e29b-41d4-a716-446655440010',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('disconnects an account', async () => {
      mockDb.mockResolvedValueOnce([{ id: '550e8400-e29b-41d4-a716-446655440010', platform: 'google_ads' }]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/ads/accounts/550e8400-e29b-41d4-a716-446655440010',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.disconnected).toBe(true);
    });
  });

  describe('POST /api/v1/admin/ads/accounts/:id/sync', () => {
    it('returns 404 when account not found', async () => {
      mockDb.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/accounts/550e8400-e29b-41d4-a716-446655440010/sync',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects sync for disconnected accounts', async () => {
      mockDb.mockResolvedValueOnce([
        { id: '550e8400-e29b-41d4-a716-446655440010', platform: 'google_ads', status: 'disconnected' },
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/accounts/550e8400-e29b-41d4-a716-446655440010/sync',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('triggers sync for active accounts', async () => {
      mockDb.mockResolvedValueOnce([
        { id: '550e8400-e29b-41d4-a716-446655440010', platform: 'google_ads', status: 'active' },
      ]);
      mockDb.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ads/accounts/550e8400-e29b-41d4-a716-446655440010/sync',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.syncStarted).toBe(true);
    });
  });

  describe('GET /api/v1/admin/ads/overview', () => {
    it('returns computed metrics', async () => {
      mockDb.mockResolvedValueOnce([
        {
          total_spend_cents: 1000,
          total_impressions: 100,
          total_clicks: 10,
          total_signups: 2,
          total_conversions: 1,
          total_revenue_cents: 5000,
          total_ltv_cents: 8000,
          spend_by_platform: { google_ads: 1000 },
          signups_by_platform: { google_ads: 2 },
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/overview?days=7',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.metrics.totalSpendCents).toBe(1000);
      expect(body.data.metrics.ctr).toBeCloseTo(10, 6);
      expect(body.data.metrics.roas).toBeCloseTo(8, 6);
    });
  });

  describe('GET /api/v1/admin/ads/campaigns', () => {
    it('filters by platform and sorts', async () => {
      mockDb.mockResolvedValueOnce([
        {
          campaign_id: 'c1',
          campaign_name: 'Low Spend',
          platform: 'google_ads',
          total_spend_cents: 100,
          total_impressions: 10,
          total_clicks: 1,
          signup_count: 0,
          conversion_count: 0,
          total_revenue_cents: 0,
          total_ltv_cents: 0,
        },
        {
          campaign_id: 'c2',
          campaign_name: 'High Spend',
          platform: 'facebook_ads',
          total_spend_cents: 200,
          total_impressions: 10,
          total_clicks: 1,
          signup_count: 0,
          conversion_count: 0,
          total_revenue_cents: 0,
          total_ltv_cents: 0,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/ads/campaigns?platform=facebook_ads',
        headers: { authorization: 'Bearer token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.campaigns).toHaveLength(1);
      expect(body.data.campaigns[0].campaignName).toBe('High Spend');
    });
  });
});

