/**
 * Admin Ads Routes
 * Ad platform integration and analytics for administrators.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';

// ===========================================================================
// Request Schemas
// ===========================================================================

const DaysQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
});

const CampaignsQuerySchema = z.object({
  days: z.string().optional().transform(v => v ? parseInt(v, 10) : 30),
  platform: z.enum(['google_ads', 'facebook_ads']).optional(),
  sortBy: z.enum(['spend', 'impressions', 'clicks', 'signups', 'conversions', 'revenue', 'ltv', 'roas']).optional().default('spend'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

const AccountIdParamSchema = z.object({
  id: z.string().uuid('Invalid account ID'),
});

// ===========================================================================
// Types
// ===========================================================================

type AdPlatform = 'google_ads' | 'facebook_ads';
type AdAccountStatus = 'active' | 'disconnected' | 'error' | 'pending';

interface AdAccount {
  id: string;
  platform: AdPlatform;
  accountId: string;
  accountName: string | null;
  currency: string;
  timezone: string;
  status: AdAccountStatus;
  lastSyncAt: Date | null;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  platform: AdPlatform;
  totalSpendCents: number;
  totalImpressions: number;
  totalClicks: number;
  signupCount: number;
  conversionCount: number;
  totalRevenueCents: number;
  totalLtvCents: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
}

interface OverviewMetrics {
  totalSpendCents: number;
  totalImpressions: number;
  totalClicks: number;
  totalSignups: number;
  totalConversions: number;
  totalRevenueCents: number;
  totalLtvCents: number;
  spendByPlatform: Record<string, number>;
  signupsByPlatform: Record<string, number>;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
}

interface UtmStats {
  source: string;
  medium: string | null;
  campaign: string | null;
  signupCount: number;
  conversionCount: number;
  revenueCents: number;
  ltvCents: number;
}

interface SpendTrendDay {
  date: string;
  totalSpendCents: number;
  googleSpendCents: number;
  facebookSpendCents: number;
  signups: number;
  conversions: number;
}

// ===========================================================================
// Routes
// ===========================================================================

/**
 * Register admin ads routes
 */
export async function adminAdsRoutes(app: FastifyInstance): Promise<void> {
  const db = sql();

  // All routes require admin role
  app.addHook('preHandler', requireAdmin);

  // ===========================================================================
  // OAuth Endpoints
  // ===========================================================================

  /**
   * POST /connect/google - Initiate Google Ads OAuth flow
   */
  app.post('/connect/google', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: Implement Google Ads OAuth flow
      // For now, return a placeholder URL
      const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
      if (!clientId) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Google Ads integration is not configured',
        });
      }

      const redirectUri = `${process.env.API_BASE_URL}/api/v1/admin/ads/callback/google`;
      const scope = 'https://www.googleapis.com/auth/adwords';
      const state = crypto.randomUUID();

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', state);

      return reply.send({
        success: true,
        data: {
          authUrl: authUrl.toString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate Google Ads auth URL');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to initiate Google Ads connection',
      });
    }
  });

  /**
   * POST /connect/facebook - Initiate Facebook Ads OAuth flow
   */
  app.post('/connect/facebook', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const appId = process.env.FACEBOOK_ADS_APP_ID;
      if (!appId) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Facebook Ads integration is not configured',
        });
      }

      const redirectUri = `${process.env.API_BASE_URL}/api/v1/admin/ads/callback/facebook`;
      const scope = 'ads_read,ads_management';
      const state = crypto.randomUUID();

      const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
      authUrl.searchParams.set('client_id', appId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('state', state);

      return reply.send({
        success: true,
        data: {
          authUrl: authUrl.toString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate Facebook Ads auth URL');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to initiate Facebook Ads connection',
      });
    }
  });

  /**
   * GET /callback/google - Handle Google Ads OAuth callback
   */
  app.get('/callback/google', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { code?: string; error?: string; state?: string };

    if (query.error) {
      logger.warn({ error: query.error }, 'Google Ads OAuth error');
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=oauth_denied`);
    }

    if (!query.code) {
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=missing_code`);
    }

    try {
      // TODO: Exchange code for tokens and create ad account
      // For now, log and redirect with success
      logger.info({ state: query.state }, 'Google Ads OAuth callback received');

      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?success=google_connected`);
    } catch (error) {
      logger.error({ error }, 'Failed to complete Google Ads OAuth');
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=oauth_failed`);
    }
  });

  /**
   * GET /callback/facebook - Handle Facebook Ads OAuth callback
   */
  app.get('/callback/facebook', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { code?: string; error?: string; state?: string };

    if (query.error) {
      logger.warn({ error: query.error }, 'Facebook Ads OAuth error');
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=oauth_denied`);
    }

    if (!query.code) {
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=missing_code`);
    }

    try {
      // TODO: Exchange code for tokens and create ad account
      logger.info({ state: query.state }, 'Facebook Ads OAuth callback received');

      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?success=facebook_connected`);
    } catch (error) {
      logger.error({ error }, 'Failed to complete Facebook Ads OAuth');
      return reply.redirect(`${process.env.WEB_BASE_URL}/admin/ads?error=oauth_failed`);
    }
  });

  // ===========================================================================
  // Account Management Endpoints
  // ===========================================================================

  /**
   * GET /accounts - List connected ad accounts
   */
  app.get('/accounts', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db`
        SELECT
          id,
          platform,
          account_id,
          account_name,
          currency,
          timezone,
          status,
          last_sync_at,
          sync_error,
          created_at,
          updated_at
        FROM ad_accounts
        ORDER BY created_at DESC
      `;

      const accounts: AdAccount[] = result.map(row => ({
        id: row['id'] as string,
        platform: row['platform'] as AdPlatform,
        accountId: row['account_id'] as string,
        accountName: row['account_name'] as string | null,
        currency: row['currency'] as string,
        timezone: row['timezone'] as string,
        status: row['status'] as AdAccountStatus,
        lastSyncAt: row['last_sync_at'] as Date | null,
        syncError: row['sync_error'] as string | null,
        createdAt: row['created_at'] as Date,
        updatedAt: row['updated_at'] as Date,
      }));

      return reply.send({
        success: true,
        data: { accounts },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list ad accounts');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve ad accounts',
      });
    }
  });

  /**
   * DELETE /accounts/:id - Disconnect an ad account
   */
  app.delete('/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramResult = AccountIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid account ID',
        details: paramResult.error.issues,
      });
    }

    const { id } = paramResult.data;
    const adminUserId = request.user?.userId;

    try {
      const result = await db`
        UPDATE ad_accounts
        SET status = 'disconnected'
        WHERE id = ${id}
        RETURNING id, platform
      `;

      if (!result[0]) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Ad account not found',
        });
      }

      logger.info({ accountId: id, platform: result[0]['platform'], adminUserId }, 'Ad account disconnected');

      return reply.send({
        success: true,
        data: {
          id,
          disconnected: true,
        },
      });
    } catch (error) {
      logger.error({ error, accountId: id }, 'Failed to disconnect ad account');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to disconnect ad account',
      });
    }
  });

  /**
   * POST /accounts/:id/sync - Trigger manual sync for an account
   */
  app.post('/accounts/:id/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramResult = AccountIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid account ID',
        details: paramResult.error.issues,
      });
    }

    const { id } = paramResult.data;
    const adminUserId = request.user?.userId;

    try {
      // Check account exists and is active
      const account = await db`
        SELECT id, platform, status
        FROM ad_accounts
        WHERE id = ${id}
      `;

      if (!account[0]) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Ad account not found',
        });
      }

      if (account[0]['status'] === 'disconnected') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot sync a disconnected account',
        });
      }

      // TODO: Queue sync job for the account
      // For now, just update the last_sync_at timestamp
      await db`
        UPDATE ad_accounts
        SET last_sync_at = NOW()
        WHERE id = ${id}
      `;

      logger.info({ accountId: id, platform: account[0]['platform'], adminUserId }, 'Ad account sync triggered');

      return reply.send({
        success: true,
        data: {
          id,
          syncStarted: true,
        },
      });
    } catch (error) {
      logger.error({ error, accountId: id }, 'Failed to trigger ad account sync');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to trigger sync',
      });
    }
  });

  // ===========================================================================
  // Analytics Endpoints
  // ===========================================================================

  /**
   * GET /overview - Get overview metrics for all ad platforms
   */
  app.get('/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const result = await db`
        SELECT * FROM get_ad_overview_metrics(
          ${startDateStr}::DATE,
          ${endDateStr}::DATE
        )
      `;

      const row = result[0];
      const totalSpendCents = Number(row?.['total_spend_cents'] ?? 0);
      const totalImpressions = Number(row?.['total_impressions'] ?? 0);
      const totalClicks = Number(row?.['total_clicks'] ?? 0);
      const totalSignups = Number(row?.['total_signups'] ?? 0);
      const totalConversions = Number(row?.['total_conversions'] ?? 0);
      const totalRevenueCents = Number(row?.['total_revenue_cents'] ?? 0);
      const totalLtvCents = Number(row?.['total_ltv_cents'] ?? 0);

      const metrics: OverviewMetrics = {
        totalSpendCents,
        totalImpressions,
        totalClicks,
        totalSignups,
        totalConversions,
        totalRevenueCents,
        totalLtvCents,
        spendByPlatform: (row?.['spend_by_platform'] as Record<string, number>) ?? {},
        signupsByPlatform: (row?.['signups_by_platform'] as Record<string, number>) ?? {},
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        cpc: totalClicks > 0 ? totalSpendCents / totalClicks : 0,
        cpa: totalConversions > 0 ? totalSpendCents / totalConversions : 0,
        roas: totalSpendCents > 0 ? totalLtvCents / totalSpendCents : 0,
      };

      return reply.send({
        success: true,
        data: {
          period: { days, startDate: startDateStr, endDate: endDateStr },
          metrics,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get ad overview metrics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve overview metrics',
      });
    }
  });

  /**
   * GET /campaigns - Get campaign-level metrics
   */
  app.get('/campaigns', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = CampaignsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days, platform, sortBy, sortOrder } = queryResult.data;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const result = await db`
        SELECT * FROM get_campaign_metrics(
          ${startDateStr}::DATE,
          ${endDateStr}::DATE
        )
        ${platform ? db`WHERE platform = ${platform}` : db``}
      `;

      let campaigns: CampaignMetrics[] = result.map(row => {
        const totalSpendCents = Number(row['total_spend_cents'] ?? 0);
        const totalImpressions = Number(row['total_impressions'] ?? 0);
        const totalClicks = Number(row['total_clicks'] ?? 0);
        const signupCount = Number(row['signup_count'] ?? 0);
        const conversionCount = Number(row['conversion_count'] ?? 0);
        const totalRevenueCents = Number(row['total_revenue_cents'] ?? 0);
        const totalLtvCents = Number(row['total_ltv_cents'] ?? 0);

        return {
          campaignId: row['campaign_id'] as string,
          campaignName: row['campaign_name'] as string,
          platform: row['platform'] as AdPlatform,
          totalSpendCents,
          totalImpressions,
          totalClicks,
          signupCount,
          conversionCount,
          totalRevenueCents,
          totalLtvCents,
          ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
          cpc: totalClicks > 0 ? totalSpendCents / totalClicks : 0,
          cpa: conversionCount > 0 ? totalSpendCents / conversionCount : 0,
          roas: totalSpendCents > 0 ? totalLtvCents / totalSpendCents : 0,
        };
      });

      // Sort campaigns based on sortBy parameter
      const sortKeyMap: Record<string, keyof CampaignMetrics> = {
        spend: 'totalSpendCents',
        impressions: 'totalImpressions',
        clicks: 'totalClicks',
        signups: 'signupCount',
        conversions: 'conversionCount',
        revenue: 'totalRevenueCents',
        ltv: 'totalLtvCents',
        roas: 'roas',
      };

      const sortKey = sortKeyMap[sortBy] ?? 'totalSpendCents';
      campaigns.sort((a, b) => {
        const aVal = a[sortKey] as number;
        const bVal = b[sortKey] as number;
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      });

      return reply.send({
        success: true,
        data: {
          period: { days, startDate: startDateStr, endDate: endDateStr },
          campaigns,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get campaign metrics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve campaign metrics',
      });
    }
  });

  /**
   * GET /utm-stats - Get UTM attribution breakdown
   */
  app.get('/utm-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const result = await db`
        SELECT
          COALESCE(utm_source, 'direct') as source,
          utm_medium as medium,
          utm_campaign as campaign,
          COUNT(DISTINCT CASE WHEN conversion_type = 'signup' THEN user_id END)::int as signup_count,
          COUNT(DISTINCT CASE WHEN conversion_type = 'first_payment' THEN user_id END)::int as conversion_count,
          COALESCE(SUM(CASE WHEN conversion_type = 'first_payment' THEN revenue_cents ELSE 0 END), 0)::int as revenue_cents,
          COALESCE(SUM(ltv_cents), 0)::int as ltv_cents
        FROM ad_conversions
        WHERE conversion_date BETWEEN ${startDateStr}::DATE AND ${endDateStr}::DATE
        GROUP BY utm_source, utm_medium, utm_campaign
        ORDER BY signup_count DESC
      `;

      const utmStats: UtmStats[] = result.map(row => ({
        source: row['source'] as string,
        medium: row['medium'] as string | null,
        campaign: row['campaign'] as string | null,
        signupCount: row['signup_count'] as number,
        conversionCount: row['conversion_count'] as number,
        revenueCents: row['revenue_cents'] as number,
        ltvCents: row['ltv_cents'] as number,
      }));

      return reply.send({
        success: true,
        data: {
          period: { days, startDate: startDateStr, endDate: endDateStr },
          utmStats,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get UTM stats');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve UTM statistics',
      });
    }
  });

  /**
   * GET /spend-trend - Get daily spend trend
   */
  app.get('/spend-trend', async (request: FastifyRequest, reply: FastifyReply) => {
    const queryResult = DaysQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: queryResult.error.issues,
      });
    }

    const { days } = queryResult.data;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const result = await db`
        WITH date_series AS (
          SELECT generate_series(
            ${startDateStr}::DATE,
            ${endDateStr}::DATE,
            '1 day'::interval
          )::DATE as date
        ),
        spend_data AS (
          SELECT
            s.date,
            COALESCE(SUM(s.spend_cents), 0)::int as total_spend_cents,
            COALESCE(SUM(CASE WHEN a.platform = 'google_ads' THEN s.spend_cents ELSE 0 END), 0)::int as google_spend_cents,
            COALESCE(SUM(CASE WHEN a.platform = 'facebook_ads' THEN s.spend_cents ELSE 0 END), 0)::int as facebook_spend_cents
          FROM ad_spend_daily s
          JOIN ad_accounts a ON s.ad_account_id = a.id
          WHERE s.date BETWEEN ${startDateStr}::DATE AND ${endDateStr}::DATE
          GROUP BY s.date
        ),
        conversion_data AS (
          SELECT
            conversion_date as date,
            COUNT(DISTINCT CASE WHEN conversion_type = 'signup' THEN user_id END)::int as signups,
            COUNT(DISTINCT CASE WHEN conversion_type = 'first_payment' THEN user_id END)::int as conversions
          FROM ad_conversions
          WHERE conversion_date BETWEEN ${startDateStr}::DATE AND ${endDateStr}::DATE
          GROUP BY conversion_date
        )
        SELECT
          d.date,
          COALESCE(s.total_spend_cents, 0) as total_spend_cents,
          COALESCE(s.google_spend_cents, 0) as google_spend_cents,
          COALESCE(s.facebook_spend_cents, 0) as facebook_spend_cents,
          COALESCE(c.signups, 0) as signups,
          COALESCE(c.conversions, 0) as conversions
        FROM date_series d
        LEFT JOIN spend_data s ON d.date = s.date
        LEFT JOIN conversion_data c ON d.date = c.date
        ORDER BY d.date ASC
      `;

      const trend: SpendTrendDay[] = result.map(row => ({
        date: (row['date'] as Date).toISOString().split('T')[0],
        totalSpendCents: row['total_spend_cents'] as number,
        googleSpendCents: row['google_spend_cents'] as number,
        facebookSpendCents: row['facebook_spend_cents'] as number,
        signups: row['signups'] as number,
        conversions: row['conversions'] as number,
      }));

      return reply.send({
        success: true,
        data: {
          period: { days, startDate: startDateStr, endDate: endDateStr },
          trend,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get spend trend');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve spend trend',
      });
    }
  });
}
