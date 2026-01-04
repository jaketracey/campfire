/**
 * Ads Repository
 * Data access for ad_accounts, ad_campaigns, ad_spend_daily, ad_conversions, and user_ltv tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  AdAccount,
  AdAccountInsert,
  AdAccountUpdate,
  AdAccountStatus,
  AdPlatform,
  AdCampaign,
  AdCampaignInsert,
  AdCampaignUpdate,
  AdSpendDaily,
  AdSpendDailyUpsert,
  AdConversion,
  AdConversionInsert,
  AdConversionUpdate,
  AdConversionType,
  UserLtv,
  UserLtvInsert,
  UserLtvUpdate,
  CampaignMetrics,
  AdOverviewMetrics,
  SpendTrendPoint,
  UtmAttributionStats,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult, DateRangeFilter } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Filter Types
// ============================================================================

export interface AdAccountListFilters extends PaginationOptions {
  platform?: AdPlatform;
  status?: AdAccountStatus | AdAccountStatus[];
}

export interface CampaignListFilters extends PaginationOptions {
  adAccountId?: string;
  status?: string;
}

export interface SpendListFilters {
  adAccountId?: string;
  campaignId?: string;
  dateRange?: DateRangeFilter;
}

export interface ConversionListFilters extends PaginationOptions {
  userId?: string;
  campaignId?: string;
  platform?: AdPlatform;
  conversionType?: AdConversionType;
  dateRange?: DateRangeFilter;
}

// ============================================================================
// Repository
// ============================================================================

export class AdsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Ad Accounts
  // ===========================================================================

  async createAdAccount(data: AdAccountInsert, tx?: TransactionContext): Promise<AdAccount> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO ad_accounts (
          platform, account_id, account_name,
          access_token_encrypted, refresh_token_encrypted, token_expires_at,
          currency, timezone, status
        ) VALUES (
          ${data.platform},
          ${data.account_id},
          ${data.account_name ?? null},
          ${data.access_token_encrypted ?? null},
          ${data.refresh_token_encrypted ?? null},
          ${data.token_expires_at ?? null},
          ${data.currency ?? 'USD'},
          ${data.timezone ?? 'UTC'},
          ${data.status ?? 'pending'}
        )
        RETURNING *
      `;

      const account = this.mapAdAccount(result[0]!);
      logger.info({ accountId: account.id, platform: account.platform }, 'Ad account created');
      return account;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('AdAccount', 'platform_account_id', `${data.platform}:${data.account_id}`);
      }
      throw wrapDatabaseError(error, 'ads.createAdAccount');
    }
  }

  async updateAdAccount(id: string, data: AdAccountUpdate, tx?: TransactionContext): Promise<AdAccount> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE ad_accounts
      SET
        account_name = COALESCE(${data.account_name ?? null}, account_name),
        access_token_encrypted = COALESCE(${data.access_token_encrypted ?? null}, access_token_encrypted),
        refresh_token_encrypted = COALESCE(${data.refresh_token_encrypted ?? null}, refresh_token_encrypted),
        token_expires_at = COALESCE(${data.token_expires_at ?? null}, token_expires_at),
        currency = COALESCE(${data.currency ?? null}, currency),
        timezone = COALESCE(${data.timezone ?? null}, timezone),
        status = COALESCE(${data.status ?? null}, status),
        last_sync_at = COALESCE(${data.last_sync_at ?? null}, last_sync_at),
        sync_error = ${data.sync_error === undefined ? null : data.sync_error}
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('AdAccount', id);
    }

    logger.debug({ accountId: id }, 'Ad account updated');
    return this.mapAdAccount(result[0]);
  }

  async listAdAccounts(filters: AdAccountListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<AdAccount>> {
    const db = this.getSql(tx);
    const { limit = 20, offset = 0, platform, status } = filters;

    let result;
    if (platform && status) {
      const statusArray = Array.isArray(status) ? status : [status];
      result = await db`
        SELECT * FROM ad_accounts
        WHERE platform = ${platform}
          AND status = ANY(${statusArray})
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (platform) {
      result = await db`
        SELECT * FROM ad_accounts
        WHERE platform = ${platform}
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      result = await db`
        SELECT * FROM ad_accounts
        WHERE status = ANY(${statusArray})
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else {
      result = await db`
        SELECT * FROM ad_accounts
        ORDER BY created_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    }

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapAdAccount(row));

    return { data, hasMore };
  }

  async deleteAdAccount(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM ad_accounts
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('AdAccount', id);
    }

    logger.info({ accountId: id }, 'Ad account deleted');
  }

  async findAdAccountById(id: string, tx?: TransactionContext): Promise<AdAccount | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_accounts
      WHERE id = ${id}
    `;
    return result[0] ? this.mapAdAccount(result[0]) : null;
  }

  async findAdAccountByPlatformId(platform: AdPlatform, accountId: string, tx?: TransactionContext): Promise<AdAccount | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_accounts
      WHERE platform = ${platform}
        AND account_id = ${accountId}
    `;
    return result[0] ? this.mapAdAccount(result[0]) : null;
  }

  // ===========================================================================
  // Ad Campaigns
  // ===========================================================================

  async upsertCampaign(data: AdCampaignInsert, tx?: TransactionContext): Promise<AdCampaign> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO ad_campaigns (
        ad_account_id, platform_campaign_id, name, status, objective
      ) VALUES (
        ${data.ad_account_id},
        ${data.platform_campaign_id},
        ${data.name},
        ${data.status ?? 'unknown'},
        ${data.objective ?? null}
      )
      ON CONFLICT (ad_account_id, platform_campaign_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        objective = EXCLUDED.objective
      RETURNING *
    `;

    logger.debug({ campaignId: result[0]!.id }, 'Campaign upserted');
    return this.mapAdCampaign(result[0]!);
  }

  async listCampaigns(filters: CampaignListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<AdCampaign>> {
    const db = this.getSql(tx);
    const { limit = 50, offset = 0, adAccountId, status } = filters;

    let result;
    if (adAccountId && status) {
      result = await db`
        SELECT * FROM ad_campaigns
        WHERE ad_account_id = ${adAccountId}
          AND status = ${status}
        ORDER BY name ASC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (adAccountId) {
      result = await db`
        SELECT * FROM ad_campaigns
        WHERE ad_account_id = ${adAccountId}
        ORDER BY name ASC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else {
      result = await db`
        SELECT * FROM ad_campaigns
        ORDER BY name ASC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    }

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapAdCampaign(row));

    return { data, hasMore };
  }

  async findCampaignById(id: string, tx?: TransactionContext): Promise<AdCampaign | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_campaigns
      WHERE id = ${id}
    `;
    return result[0] ? this.mapAdCampaign(result[0]) : null;
  }

  async findCampaignByPlatformId(adAccountId: string, platformCampaignId: string, tx?: TransactionContext): Promise<AdCampaign | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_campaigns
      WHERE ad_account_id = ${adAccountId}
        AND platform_campaign_id = ${platformCampaignId}
    `;
    return result[0] ? this.mapAdCampaign(result[0]) : null;
  }

  // ===========================================================================
  // Ad Spend Daily
  // ===========================================================================

  async upsertDailySpend(data: AdSpendDailyUpsert, tx?: TransactionContext): Promise<AdSpendDaily> {
    const db = this.getSql(tx);

    // Try to find the campaign ID if we have a platform campaign ID
    let campaignId: string | null = null;
    if (data.platform_campaign_id) {
      const campaign = await db`
        SELECT id FROM ad_campaigns
        WHERE ad_account_id = ${data.ad_account_id}
          AND platform_campaign_id = ${data.platform_campaign_id}
      `;
      campaignId = campaign[0]?.id as string | null;
    }

    const result = await db`
      INSERT INTO ad_spend_daily (
        ad_account_id, campaign_id, platform_campaign_id, date,
        spend_cents, impressions, clicks, conversions, currency
      ) VALUES (
        ${data.ad_account_id},
        ${campaignId},
        ${data.platform_campaign_id},
        ${data.date},
        ${data.spend_cents},
        ${data.impressions},
        ${data.clicks},
        ${data.conversions},
        ${data.currency ?? 'USD'}
      )
      ON CONFLICT (ad_account_id, platform_campaign_id, date)
      DO UPDATE SET
        campaign_id = COALESCE(EXCLUDED.campaign_id, ad_spend_daily.campaign_id),
        spend_cents = EXCLUDED.spend_cents,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        synced_at = NOW()
      RETURNING *
    `;

    return this.mapAdSpendDaily(result[0]!);
  }

  async getSpendByDateRange(filters: SpendListFilters, tx?: TransactionContext): Promise<AdSpendDaily[]> {
    const db = this.getSql(tx);
    const { adAccountId, campaignId, dateRange } = filters;

    let result;
    if (adAccountId && campaignId && dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_spend_daily
        WHERE ad_account_id = ${adAccountId}
          AND campaign_id = ${campaignId}
          AND date >= ${dateRange.from}
          AND date <= ${dateRange.to}
        ORDER BY date DESC
      `;
    } else if (adAccountId && dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_spend_daily
        WHERE ad_account_id = ${adAccountId}
          AND date >= ${dateRange.from}
          AND date <= ${dateRange.to}
        ORDER BY date DESC
      `;
    } else if (campaignId && dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_spend_daily
        WHERE campaign_id = ${campaignId}
          AND date >= ${dateRange.from}
          AND date <= ${dateRange.to}
        ORDER BY date DESC
      `;
    } else if (dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_spend_daily
        WHERE date >= ${dateRange.from}
          AND date <= ${dateRange.to}
        ORDER BY date DESC
      `;
    } else {
      result = await db`
        SELECT * FROM ad_spend_daily
        ORDER BY date DESC
        LIMIT 100
      `;
    }

    return result.map((row) => this.mapAdSpendDaily(row));
  }

  async getSpendTrend(startDate: Date, endDate: Date, tx?: TransactionContext): Promise<SpendTrendPoint[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        date,
        SUM(spend_cents)::INTEGER as spend_cents,
        SUM(impressions)::INTEGER as impressions,
        SUM(clicks)::INTEGER as clicks,
        SUM(conversions)::INTEGER as conversions
      FROM ad_spend_daily s
      JOIN ad_accounts a ON s.ad_account_id = a.id
      WHERE s.date >= ${startDate}
        AND s.date <= ${endDate}
        AND a.status = 'active'
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((row) => ({
      date: new Date(row.date as string),
      spend_cents: row.spend_cents as number,
      impressions: row.impressions as number,
      clicks: row.clicks as number,
      conversions: row.conversions as number,
    }));
  }

  // ===========================================================================
  // Ad Conversions
  // ===========================================================================

  async createConversion(data: AdConversionInsert, tx?: TransactionContext): Promise<AdConversion> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO ad_conversions (
          user_id, conversion_type, campaign_id, platform_campaign_id,
          platform, utm_source, utm_medium, utm_campaign,
          revenue_cents, ltv_cents, conversion_date
        ) VALUES (
          ${data.user_id},
          ${data.conversion_type},
          ${data.campaign_id ?? null},
          ${data.platform_campaign_id ?? null},
          ${data.platform ?? null},
          ${data.utm_source ?? null},
          ${data.utm_medium ?? null},
          ${data.utm_campaign ?? null},
          ${data.revenue_cents ?? 0},
          ${data.ltv_cents ?? 0},
          ${data.conversion_date ?? new Date()}
        )
        RETURNING *
      `;

      const conversion = this.mapAdConversion(result[0]!);
      logger.info(
        { conversionId: conversion.id, userId: data.user_id, type: data.conversion_type },
        'Ad conversion created'
      );
      return conversion;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('AdConversion', 'user_type', `${data.user_id}:${data.conversion_type}`);
      }
      throw wrapDatabaseError(error, 'ads.createConversion');
    }
  }

  async updateConversion(id: string, data: AdConversionUpdate, tx?: TransactionContext): Promise<AdConversion> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE ad_conversions
      SET
        campaign_id = COALESCE(${data.campaign_id ?? null}, campaign_id),
        ltv_cents = COALESCE(${data.ltv_cents ?? null}, ltv_cents)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('AdConversion', id);
    }

    return this.mapAdConversion(result[0]);
  }

  async getConversionsByUser(userId: string, tx?: TransactionContext): Promise<AdConversion[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_conversions
      WHERE user_id = ${userId}
      ORDER BY conversion_date DESC
    `;
    return result.map((row) => this.mapAdConversion(row));
  }

  async getConversionsByCampaign(campaignId: string, filters: ConversionListFilters = {}, tx?: TransactionContext): Promise<PaginatedResult<AdConversion>> {
    const db = this.getSql(tx);
    const { limit = 50, offset = 0, conversionType, dateRange } = filters;

    let result;
    if (conversionType && dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_conversions
        WHERE campaign_id = ${campaignId}
          AND conversion_type = ${conversionType}
          AND conversion_date >= ${dateRange.from}
          AND conversion_date <= ${dateRange.to}
        ORDER BY conversion_date DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (conversionType) {
      result = await db`
        SELECT * FROM ad_conversions
        WHERE campaign_id = ${campaignId}
          AND conversion_type = ${conversionType}
        ORDER BY conversion_date DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else if (dateRange?.from && dateRange?.to) {
      result = await db`
        SELECT * FROM ad_conversions
        WHERE campaign_id = ${campaignId}
          AND conversion_date >= ${dateRange.from}
          AND conversion_date <= ${dateRange.to}
        ORDER BY conversion_date DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    } else {
      result = await db`
        SELECT * FROM ad_conversions
        WHERE campaign_id = ${campaignId}
        ORDER BY conversion_date DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
    }

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map((row) => this.mapAdConversion(row));

    return { data, hasMore };
  }

  async findConversionByUserAndType(userId: string, conversionType: AdConversionType, tx?: TransactionContext): Promise<AdConversion | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM ad_conversions
      WHERE user_id = ${userId}
        AND conversion_type = ${conversionType}
    `;
    return result[0] ? this.mapAdConversion(result[0]) : null;
  }

  async updateConversionLtv(userId: string, ltvCents: number, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE ad_conversions
      SET ltv_cents = ${ltvCents}
      WHERE user_id = ${userId}
    `;
  }

  // ===========================================================================
  // User LTV
  // ===========================================================================

  async upsertUserLtv(data: UserLtvInsert, tx?: TransactionContext): Promise<UserLtv> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO user_ltv (
        user_id, total_payments_cents, subscription_revenue_cents,
        token_revenue_cents, ltv_cents, first_payment_at, last_payment_at
      ) VALUES (
        ${data.user_id},
        ${data.total_payments_cents ?? 0},
        ${data.subscription_revenue_cents ?? 0},
        ${data.token_revenue_cents ?? 0},
        ${data.ltv_cents ?? 0},
        ${data.first_payment_at ?? null},
        ${data.last_payment_at ?? null}
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        total_payments_cents = EXCLUDED.total_payments_cents,
        subscription_revenue_cents = EXCLUDED.subscription_revenue_cents,
        token_revenue_cents = EXCLUDED.token_revenue_cents,
        ltv_cents = EXCLUDED.ltv_cents,
        first_payment_at = COALESCE(user_ltv.first_payment_at, EXCLUDED.first_payment_at),
        last_payment_at = EXCLUDED.last_payment_at
      RETURNING *
    `;

    return this.mapUserLtv(result[0]!);
  }

  async getUserLtv(userId: string, tx?: TransactionContext): Promise<UserLtv | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM user_ltv
      WHERE user_id = ${userId}
    `;
    return result[0] ? this.mapUserLtv(result[0]) : null;
  }

  // ===========================================================================
  // Analytics / Metrics
  // ===========================================================================

  async getOverviewMetrics(startDate: Date, endDate: Date, tx?: TransactionContext): Promise<AdOverviewMetrics> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM get_ad_overview_metrics(${startDate}::date, ${endDate}::date)
    `;

    const row = result[0];
    if (!row) {
      return {
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
    }

    return {
      total_spend_cents: Number(row.total_spend_cents) || 0,
      total_impressions: Number(row.total_impressions) || 0,
      total_clicks: Number(row.total_clicks) || 0,
      total_signups: Number(row.total_signups) || 0,
      total_conversions: Number(row.total_conversions) || 0,
      total_revenue_cents: Number(row.total_revenue_cents) || 0,
      total_ltv_cents: Number(row.total_ltv_cents) || 0,
      spend_by_platform: (row.spend_by_platform as Record<string, number>) || {},
      signups_by_platform: (row.signups_by_platform as Record<string, number>) || {},
    };
  }

  async getCampaignMetrics(startDate: Date, endDate: Date, tx?: TransactionContext): Promise<CampaignMetrics[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM get_campaign_metrics(${startDate}::date, ${endDate}::date)
    `;

    return result.map((row) => ({
      campaign_id: row.campaign_id as string,
      campaign_name: row.campaign_name as string,
      platform: row.platform as AdPlatform,
      total_spend_cents: Number(row.total_spend_cents) || 0,
      total_impressions: Number(row.total_impressions) || 0,
      total_clicks: Number(row.total_clicks) || 0,
      signup_count: Number(row.signup_count) || 0,
      conversion_count: Number(row.conversion_count) || 0,
      total_revenue_cents: Number(row.total_revenue_cents) || 0,
      total_ltv_cents: Number(row.total_ltv_cents) || 0,
    }));
  }

  async getUtmAttributionStats(startDate: Date, endDate: Date, tx?: TransactionContext): Promise<UtmAttributionStats[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        utm_source,
        utm_medium,
        utm_campaign,
        COUNT(DISTINCT CASE WHEN conversion_type = 'signup' THEN user_id END)::INTEGER as signup_count,
        COUNT(DISTINCT CASE WHEN conversion_type = 'first_payment' THEN user_id END)::INTEGER as conversion_count,
        COALESCE(SUM(revenue_cents), 0)::INTEGER as total_revenue_cents,
        COALESCE(SUM(ltv_cents), 0)::INTEGER as total_ltv_cents
      FROM ad_conversions
      WHERE conversion_date >= ${startDate}
        AND conversion_date <= ${endDate}
      GROUP BY utm_source, utm_medium, utm_campaign
      ORDER BY total_ltv_cents DESC
    `;

    return result.map((row) => ({
      utm_source: row.utm_source as string | null,
      utm_medium: row.utm_medium as string | null,
      utm_campaign: row.utm_campaign as string | null,
      signup_count: row.signup_count as number,
      conversion_count: row.conversion_count as number,
      total_revenue_cents: row.total_revenue_cents as number,
      total_ltv_cents: row.total_ltv_cents as number,
    }));
  }

  // ===========================================================================
  // Mapping Functions
  // ===========================================================================

  private mapAdAccount(row: Record<string, unknown>): AdAccount {
    return {
      id: row.id as string,
      platform: row.platform as AdPlatform,
      account_id: row.account_id as string,
      account_name: row.account_name as string | null,
      access_token_encrypted: row.access_token_encrypted as string | null,
      refresh_token_encrypted: row.refresh_token_encrypted as string | null,
      token_expires_at: row.token_expires_at ? new Date(row.token_expires_at as string) : null,
      currency: row.currency as string,
      timezone: row.timezone as string | null,
      status: row.status as AdAccountStatus,
      last_sync_at: row.last_sync_at ? new Date(row.last_sync_at as string) : null,
      sync_error: row.sync_error as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapAdCampaign(row: Record<string, unknown>): AdCampaign {
    return {
      id: row.id as string,
      ad_account_id: row.ad_account_id as string,
      platform_campaign_id: row.platform_campaign_id as string,
      name: row.name as string,
      status: row.status as string | null,
      objective: row.objective as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapAdSpendDaily(row: Record<string, unknown>): AdSpendDaily {
    return {
      id: row.id as string,
      ad_account_id: row.ad_account_id as string,
      campaign_id: row.campaign_id as string | null,
      platform_campaign_id: row.platform_campaign_id as string | null,
      date: new Date(row.date as string),
      spend_cents: row.spend_cents as number,
      impressions: row.impressions as number,
      clicks: row.clicks as number,
      conversions: row.conversions as number,
      currency: row.currency as string,
      synced_at: new Date(row.synced_at as string),
    };
  }

  private mapAdConversion(row: Record<string, unknown>): AdConversion {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      conversion_type: row.conversion_type as AdConversionType,
      campaign_id: row.campaign_id as string | null,
      platform_campaign_id: row.platform_campaign_id as string | null,
      platform: row.platform as AdPlatform | null,
      utm_source: row.utm_source as string | null,
      utm_medium: row.utm_medium as string | null,
      utm_campaign: row.utm_campaign as string | null,
      revenue_cents: row.revenue_cents as number,
      ltv_cents: row.ltv_cents as number,
      conversion_date: new Date(row.conversion_date as string),
      created_at: new Date(row.created_at as string),
    };
  }

  private mapUserLtv(row: Record<string, unknown>): UserLtv {
    return {
      user_id: row.user_id as string,
      total_payments_cents: row.total_payments_cents as number,
      subscription_revenue_cents: row.subscription_revenue_cents as number,
      token_revenue_cents: row.token_revenue_cents as number,
      ltv_cents: row.ltv_cents as number,
      first_payment_at: row.first_payment_at ? new Date(row.first_payment_at as string) : null,
      last_payment_at: row.last_payment_at ? new Date(row.last_payment_at as string) : null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let adsRepository: AdsRepository | null = null;

export function getAdsRepository(): AdsRepository {
  if (!adsRepository) {
    adsRepository = new AdsRepository();
  }
  return adsRepository;
}
