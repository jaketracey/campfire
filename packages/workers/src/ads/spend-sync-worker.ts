/**
 * Ad Spend Sync Worker
 *
 * BullMQ worker that syncs ad spend data from Google Ads and Facebook Ads.
 * Runs daily to fetch spend metrics and update the ad_spend_daily table.
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { AD_SPEND_SYNC_QUEUE, type AdSpendSyncJob } from './queues.js';

interface AdAccount {
  id: string;
  platform: 'google_ads' | 'facebook_ads';
  account_id: string;
  account_name: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | null;
  currency: string;
  timezone: string | null;
  status: 'active' | 'disconnected' | 'error' | 'pending';
}

interface SpendData {
  platformCampaignId: string;
  campaignName: string;
  date: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

interface AdSpendSyncWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
  googleAdsApiUrl?: string;
  facebookAdsApiUrl?: string;
}

export class AdSpendSyncWorker {
  private worker: Worker<AdSpendSyncJob> | null = null;
  private config: AdSpendSyncWorkerConfig;
  private googleAdsApiUrl: string;
  private facebookAdsApiUrl: string;

  constructor(config: AdSpendSyncWorkerConfig) {
    this.config = config;
    this.googleAdsApiUrl =
      config.googleAdsApiUrl || process.env.GOOGLE_ADS_API_URL || 'https://googleads.googleapis.com';
    this.facebookAdsApiUrl =
      config.facebookAdsApiUrl || process.env.FACEBOOK_ADS_API_URL || 'https://graph.facebook.com/v18.0';
  }

  async start(): Promise<void> {
    this.worker = new Worker<AdSpendSyncJob>(
      AD_SPEND_SYNC_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 2,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info(
        { jobId: job.id, accountId: job.data.accountId },
        'Ad spend sync job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, accountId: job?.data.accountId, error: err.message },
        'Ad spend sync job failed'
      );
    });

    this.worker.on('stalled', (jobId) => {
      this.config.logger.warn({ jobId }, 'Ad spend sync job stalled');
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 2 },
      'Ad spend sync worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Ad spend sync worker stopped');
    }
  }

  private async process(job: Job<AdSpendSyncJob>): Promise<void> {
    const { accountId, startDate, endDate } = job.data;

    // Calculate date range (default to yesterday if not specified)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 24 * 60 * 60 * 1000);

    this.config.logger.info(
      { accountId, startDate: start.toISOString(), endDate: end.toISOString() },
      'Processing ad spend sync job'
    );

    // Get accounts to sync
    const accounts = await this.getAccounts(accountId);

    if (accounts.length === 0) {
      this.config.logger.warn(
        { accountId },
        'No active ad accounts found to sync'
      );
      return;
    }

    // Process each account
    for (const account of accounts) {
      try {
        await this.syncAccount(account, start, end);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.config.logger.error(
          { accountId: account.id, platform: account.platform, error: errorMessage },
          'Failed to sync ad account'
        );

        // Update account status to error
        await this.updateAccountStatus(account.id, 'error', errorMessage);
      }
    }
  }

  private async getAccounts(accountId?: string): Promise<AdAccount[]> {
    if (accountId) {
      const rows = await this.config.db.sql`
        SELECT * FROM ad_accounts
        WHERE id = ${accountId}
          AND status = 'active'
      `;
      return rows as unknown as AdAccount[];
    }

    const rows = await this.config.db.sql`
      SELECT * FROM ad_accounts
      WHERE status = 'active'
      ORDER BY last_sync_at NULLS FIRST
    `;
    return rows as unknown as AdAccount[];
  }

  private async syncAccount(
    account: AdAccount,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    this.config.logger.info(
      { accountId: account.id, platform: account.platform },
      'Syncing ad account'
    );

    // Check and refresh token if needed
    const accessToken = await this.getValidAccessToken(account);
    if (!accessToken) {
      throw new Error('Unable to obtain valid access token');
    }

    // Fetch spend data based on platform
    let spendData: SpendData[];
    if (account.platform === 'google_ads') {
      spendData = await this.fetchGoogleAdsSpend(account, accessToken, startDate, endDate);
    } else {
      spendData = await this.fetchFacebookAdsSpend(account, accessToken, startDate, endDate);
    }

    this.config.logger.info(
      { accountId: account.id, recordCount: spendData.length },
      'Fetched ad spend data'
    );

    // Upsert spend data
    for (const data of spendData) {
      await this.upsertSpendData(account.id, data);
    }

    // Sync campaigns (create any new campaigns we saw)
    await this.syncCampaigns(account.id, spendData);

    // Update last_sync_at
    await this.config.db.sql`
      UPDATE ad_accounts
      SET last_sync_at = NOW(), sync_error = NULL
      WHERE id = ${account.id}
    `;

    this.config.logger.info(
      { accountId: account.id, recordsUpserted: spendData.length },
      'Ad account sync completed'
    );
  }

  private async getValidAccessToken(account: AdAccount): Promise<string | null> {
    if (!account.access_token_encrypted) {
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    const now = new Date();
    const expiresAt = account.token_expires_at;

    if (expiresAt && expiresAt.getTime() - 5 * 60 * 1000 <= now.getTime()) {
      // Token is expired or about to expire, refresh it
      return await this.refreshAccessToken(account);
    }

    // Decrypt the token (in production, use a proper encryption service)
    // For now, we assume tokens are stored encrypted and need decryption
    return this.decryptToken(account.access_token_encrypted);
  }

  private async refreshAccessToken(account: AdAccount): Promise<string | null> {
    if (!account.refresh_token_encrypted) {
      this.config.logger.warn(
        { accountId: account.id },
        'No refresh token available'
      );
      await this.updateAccountStatus(account.id, 'disconnected', 'Refresh token missing');
      return null;
    }

    const refreshToken = this.decryptToken(account.refresh_token_encrypted);
    if (!refreshToken) {
      return null;
    }

    try {
      let newAccessToken: string;
      let expiresIn: number;

      if (account.platform === 'google_ads') {
        const result = await this.refreshGoogleToken(refreshToken);
        newAccessToken = result.accessToken;
        expiresIn = result.expiresIn;
      } else {
        const result = await this.refreshFacebookToken(refreshToken);
        newAccessToken = result.accessToken;
        expiresIn = result.expiresIn;
      }

      // Update the stored token
      const encryptedToken = this.encryptToken(newAccessToken);
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      await this.config.db.sql`
        UPDATE ad_accounts
        SET
          access_token_encrypted = ${encryptedToken},
          token_expires_at = ${expiresAt.toISOString()}
        WHERE id = ${account.id}
      `;

      return newAccessToken;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.config.logger.error(
        { accountId: account.id, error: errorMessage },
        'Failed to refresh access token'
      );
      await this.updateAccountStatus(account.id, 'disconnected', `Token refresh failed: ${errorMessage}`);
      return null;
    }
  }

  private async refreshGoogleToken(
    refreshToken: string
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Google Ads OAuth credentials not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  private async refreshFacebookToken(
    refreshToken: string
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const clientId = process.env.FACEBOOK_ADS_APP_ID;
    const clientSecret = process.env.FACEBOOK_ADS_APP_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Facebook Ads OAuth credentials not configured');
    }

    const response = await fetch(
      `${this.facebookAdsApiUrl}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: refreshToken,
        }),
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in || 5184000, // Default to 60 days for Facebook
    };
  }

  private async fetchGoogleAdsSpend(
    account: AdAccount,
    accessToken: string,
    startDate: Date,
    endDate: Date
  ): Promise<SpendData[]> {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) {
      throw new Error('Google Ads developer token not configured');
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Google Ads API query
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    const response = await fetch(
      `${this.googleAdsApiUrl}/v14/customers/${account.account_id}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Ads API error: ${response.status} - ${errorText}`);
    }

    const results = (await response.json()) as Array<{
      results: Array<{
        campaign: { id: string; name: string };
        segments: { date: string };
        metrics: {
          costMicros: string;
          impressions: string;
          clicks: string;
          conversions: number;
        };
      }>;
    }>;

    const spendData: SpendData[] = [];

    for (const batch of results) {
      for (const row of batch.results || []) {
        // Google Ads returns cost in micros (1/1,000,000 of currency)
        const costMicros = parseInt(row.metrics.costMicros || '0', 10);
        const spendCents = Math.round(costMicros / 10000); // Convert micros to cents

        spendData.push({
          platformCampaignId: row.campaign.id,
          campaignName: row.campaign.name,
          date: row.segments.date,
          spendCents,
          impressions: parseInt(row.metrics.impressions || '0', 10),
          clicks: parseInt(row.metrics.clicks || '0', 10),
          conversions: Math.round(row.metrics.conversions || 0),
          currency: account.currency,
        });
      }
    }

    return spendData;
  }

  private async fetchFacebookAdsSpend(
    account: AdAccount,
    accessToken: string,
    startDate: Date,
    endDate: Date
  ): Promise<SpendData[]> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Facebook Marketing API - fetch campaign insights
    const response = await fetch(
      `${this.facebookAdsApiUrl}/act_${account.account_id}/insights?` +
        new URLSearchParams({
          access_token: accessToken,
          level: 'campaign',
          fields: 'campaign_id,campaign_name,spend,impressions,clicks,conversions',
          time_range: JSON.stringify({ since: startStr, until: endStr }),
          time_increment: '1', // Daily breakdown
        }),
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook Ads API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      data: Array<{
        campaign_id: string;
        campaign_name: string;
        spend: string;
        impressions: string;
        clicks: string;
        conversions?: Array<{ value: string }>;
        date_start: string;
      }>;
    };

    const spendData: SpendData[] = [];

    for (const row of data.data || []) {
      // Facebook returns spend as a decimal string
      const spendDollars = parseFloat(row.spend || '0');
      const spendCents = Math.round(spendDollars * 100);

      // Sum conversions if available
      let conversions = 0;
      if (row.conversions) {
        for (const conv of row.conversions) {
          conversions += parseInt(conv.value || '0', 10);
        }
      }

      spendData.push({
        platformCampaignId: row.campaign_id,
        campaignName: row.campaign_name,
        date: row.date_start,
        spendCents,
        impressions: parseInt(row.impressions || '0', 10),
        clicks: parseInt(row.clicks || '0', 10),
        conversions,
        currency: account.currency,
      });
    }

    return spendData;
  }

  private async upsertSpendData(accountId: string, data: SpendData): Promise<void> {
    await this.config.db.sql`
      INSERT INTO ad_spend_daily (
        ad_account_id, platform_campaign_id, date,
        spend_cents, impressions, clicks, conversions, currency
      ) VALUES (
        ${accountId}, ${data.platformCampaignId}, ${data.date},
        ${data.spendCents}, ${data.impressions}, ${data.clicks}, ${data.conversions}, ${data.currency}
      )
      ON CONFLICT (ad_account_id, platform_campaign_id, date) DO UPDATE SET
        spend_cents = ${data.spendCents},
        impressions = ${data.impressions},
        clicks = ${data.clicks},
        conversions = ${data.conversions},
        synced_at = NOW()
    `;
  }

  private async syncCampaigns(accountId: string, spendData: SpendData[]): Promise<void> {
    // Get unique campaigns from spend data
    const campaigns = new Map<string, string>();
    for (const data of spendData) {
      campaigns.set(data.platformCampaignId, data.campaignName);
    }

    // Upsert each campaign
    for (const [platformCampaignId, name] of campaigns) {
      await this.config.db.sql`
        INSERT INTO ad_campaigns (ad_account_id, platform_campaign_id, name)
        VALUES (${accountId}, ${platformCampaignId}, ${name})
        ON CONFLICT (ad_account_id, platform_campaign_id) DO UPDATE SET
          name = ${name},
          updated_at = NOW()
      `;
    }

    // Link spend records to campaigns
    await this.config.db.sql`
      UPDATE ad_spend_daily s
      SET campaign_id = c.id
      FROM ad_campaigns c
      WHERE s.ad_account_id = c.ad_account_id
        AND s.platform_campaign_id = c.platform_campaign_id
        AND s.campaign_id IS NULL
    `;
  }

  private async updateAccountStatus(
    accountId: string,
    status: 'active' | 'disconnected' | 'error' | 'pending',
    errorMessage?: string
  ): Promise<void> {
    if (errorMessage) {
      await this.config.db.sql`
        UPDATE ad_accounts
        SET status = ${status}, sync_error = ${errorMessage}
        WHERE id = ${accountId}
      `;
    } else {
      await this.config.db.sql`
        UPDATE ad_accounts
        SET status = ${status}, sync_error = NULL
        WHERE id = ${accountId}
      `;
    }
  }

  // Token encryption/decryption helpers
  // In production, use a proper encryption service (AWS KMS, Vault, etc.)
  private decryptToken(encryptedToken: string): string {
    // TODO: Implement proper decryption using AWS KMS or similar
    // For now, we assume tokens are base64 encoded (not secure for production!)
    try {
      return Buffer.from(encryptedToken, 'base64').toString('utf-8');
    } catch {
      return encryptedToken;
    }
  }

  private encryptToken(token: string): string {
    // TODO: Implement proper encryption using AWS KMS or similar
    // For now, we just base64 encode (not secure for production!)
    return Buffer.from(token).toString('base64');
  }
}
