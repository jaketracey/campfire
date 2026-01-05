/**
 * Google Ads Service
 * OAuth integration and data sync with Google Ads API.
 */

import { getAdsRepository } from '../repositories/ads.js';
import { logger } from '../observability/logger.js';
import type { AdAccount, AdCampaign, AdSpendDaily } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Configuration
// ============================================================================

interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  redirectUri: string;
}

function getConfig(): GoogleAdsConfig {
  const clientId = process.env['GOOGLE_ADS_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_ADS_CLIENT_SECRET'];
  const developerToken = process.env['GOOGLE_ADS_DEVELOPER_TOKEN'];
  const redirectUri = process.env['GOOGLE_ADS_REDIRECT_URI'] || 'http://localhost:3000/api/v1/admin/ads/callback/google';

  if (!clientId || !clientSecret || !developerToken) {
    throw new Error('Missing Google Ads configuration. Set GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_DEVELOPER_TOKEN');
  }

  return {
    clientId,
    clientSecret,
    developerToken,
    redirectUri,
  };
}

// ============================================================================
// Types
// ============================================================================

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleCustomer {
  id: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

interface GoogleCampaign {
  id: string;
  name: string;
  status: string;
  advertisingChannelType?: string;
}

interface GoogleSpendData {
  date: string;
  campaignId: string;
  costMicros: string;
  impressions: string;
  clicks: string;
  conversions: string;
}

export interface SyncResult {
  success: boolean;
  accountId: string;
  campaignsSynced?: number;
  spendRecordsSynced?: number;
  error?: string;
}

// ============================================================================
// Service
// ============================================================================

export class GoogleAdsService {
  private ads = getAdsRepository();
  private config: GoogleAdsConfig | null = null;

  private getConfig(): GoogleAdsConfig {
    if (!this.config) {
      this.config = getConfig();
    }
    return this.config;
  }

  /**
   * Get the OAuth authorization URL for Google Ads
   */
  getAuthUrl(state?: string): string {
    const config = this.getConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent',
    });

    if (state) {
      params.set('state', state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens and create ad account
   */
  async handleCallback(code: string, tx?: TransactionContext): Promise<AdAccount> {
    const config = this.getConfig();

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      logger.error({ error }, 'Failed to exchange Google OAuth code');
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

    // Get the customer (account) info
    const customers = await this.getCustomers(tokens.access_token, config.developerToken);
    if (customers.length === 0) {
      throw new Error('No Google Ads accounts found');
    }

    // Use the first accessible customer account
    const customer = customers[0]!;

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if account already exists
    const existing = await this.ads.findAdAccountByPlatformId('google_ads', customer.id, tx);
    if (existing) {
      // Update existing account with new tokens
      return this.ads.updateAdAccount(existing.id, {
        account_name: customer.descriptiveName,
        access_token_encrypted: tokens.access_token, // Should encrypt in production
        refresh_token_encrypted: tokens.refresh_token, // Should encrypt in production
        token_expires_at: expiresAt,
        currency: customer.currencyCode,
        timezone: customer.timeZone,
        status: 'active',
        sync_error: null,
      }, tx);
    }

    // Create new account
    const account = await this.ads.createAdAccount({
      platform: 'google_ads',
      account_id: customer.id,
      account_name: customer.descriptiveName,
      access_token_encrypted: tokens.access_token, // Should encrypt in production
      refresh_token_encrypted: tokens.refresh_token, // Should encrypt in production
      token_expires_at: expiresAt,
      currency: customer.currencyCode,
      timezone: customer.timeZone,
      status: 'active',
    }, tx);

    logger.info({ accountId: account.id, googleId: customer.id }, 'Google Ads account connected');
    return account;
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(accountId: string, tx?: TransactionContext): Promise<AdAccount> {
    const config = this.getConfig();
    const account = await this.ads.findAdAccountById(accountId, tx);

    if (!account) {
      throw new Error(`Ad account not found: ${accountId}`);
    }

    if (!account.refresh_token_encrypted) {
      throw new Error('No refresh token available');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: account.refresh_token_encrypted, // Should decrypt in production
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      logger.error({ accountId, error }, 'Failed to refresh Google OAuth token');

      // Mark account as disconnected
      await this.ads.updateAdAccount(accountId, {
        status: 'disconnected',
        sync_error: `Token refresh failed: ${error}`,
      }, tx);

      throw new Error(`Failed to refresh token: ${error}`);
    }

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const updated = await this.ads.updateAdAccount(accountId, {
      access_token_encrypted: tokens.access_token, // Should encrypt in production
      token_expires_at: expiresAt,
      sync_error: null,
    }, tx);

    logger.debug({ accountId }, 'Google Ads access token refreshed');
    return updated;
  }

  /**
   * Sync campaigns from Google Ads
   */
  async syncCampaigns(accountId: string, tx?: TransactionContext): Promise<SyncResult> {
    const account = await this.ensureValidToken(accountId, tx);
    const config = this.getConfig();

    try {
      const campaigns = await this.fetchCampaigns(
        account.access_token_encrypted!,
        config.developerToken,
        account.account_id
      );

      let syncedCount = 0;
      for (const campaign of campaigns) {
        await this.ads.upsertCampaign({
          ad_account_id: accountId,
          platform_campaign_id: campaign.id,
          name: campaign.name,
          status: campaign.status.toLowerCase(),
          objective: campaign.advertisingChannelType || null,
        }, tx);
        syncedCount++;
      }

      // Update last sync time
      await this.ads.updateAdAccount(accountId, {
        last_sync_at: new Date(),
        sync_error: null,
      }, tx);

      logger.info({ accountId, campaignCount: syncedCount }, 'Google Ads campaigns synced');
      return { success: true, accountId, campaignsSynced: syncedCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.ads.updateAdAccount(accountId, {
        status: 'error',
        sync_error: errorMessage,
      }, tx);

      logger.error({ accountId, error: errorMessage }, 'Failed to sync Google Ads campaigns');
      return { success: false, accountId, error: errorMessage };
    }
  }

  /**
   * Sync daily spend data from Google Ads
   */
  async syncSpendData(
    accountId: string,
    startDate: Date,
    endDate: Date,
    tx?: TransactionContext
  ): Promise<SyncResult> {
    const account = await this.ensureValidToken(accountId, tx);
    const config = this.getConfig();

    try {
      const spendData = await this.fetchSpendData(
        account.access_token_encrypted!,
        config.developerToken,
        account.account_id,
        startDate,
        endDate
      );

      let syncedCount = 0;
      for (const data of spendData) {
        // Convert cost from micros (1/1,000,000) to cents
        const spendCents = Math.round(parseInt(data.costMicros, 10) / 10000);

        await this.ads.upsertDailySpend({
          ad_account_id: accountId,
          platform_campaign_id: data.campaignId,
          date: new Date(data.date),
          spend_cents: spendCents,
          impressions: parseInt(data.impressions, 10) || 0,
          clicks: parseInt(data.clicks, 10) || 0,
          conversions: parseInt(data.conversions, 10) || 0,
          currency: account.currency,
        }, tx);
        syncedCount++;
      }

      // Update last sync time
      await this.ads.updateAdAccount(accountId, {
        last_sync_at: new Date(),
        sync_error: null,
      }, tx);

      logger.info({ accountId, recordCount: syncedCount }, 'Google Ads spend data synced');
      return { success: true, accountId, spendRecordsSynced: syncedCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.ads.updateAdAccount(accountId, {
        status: 'error',
        sync_error: errorMessage,
      }, tx);

      logger.error({ accountId, error: errorMessage }, 'Failed to sync Google Ads spend data');
      return { success: false, accountId, error: errorMessage };
    }
  }

  /**
   * Ensure the account has a valid access token, refreshing if necessary
   */
  private async ensureValidToken(accountId: string, tx?: TransactionContext): Promise<AdAccount> {
    const account = await this.ads.findAdAccountById(accountId, tx);
    if (!account) {
      throw new Error(`Ad account not found: ${accountId}`);
    }

    if (account.status === 'disconnected') {
      throw new Error('Account is disconnected. Please re-authorize.');
    }

    // Check if token is expired or will expire in the next 5 minutes
    const tokenExpiresAt = account.token_expires_at;
    const bufferMs = 5 * 60 * 1000; // 5 minutes

    if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now() + bufferMs) {
      return this.refreshAccessToken(accountId, tx);
    }

    return account;
  }

  /**
   * Fetch accessible customer accounts from Google Ads API
   */
  private async getCustomers(accessToken: string, developerToken: string): Promise<GoogleCustomer[]> {
    // In production, this would call the Google Ads API
    // For now, we'll use the /customers:listAccessibleCustomers endpoint

    const response = await fetch(
      'https://googleads.googleapis.com/v15/customers:listAccessibleCustomers',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list accessible customers: ${await response.text()}`);
    }

    const data = (await response.json()) as { resourceNames?: string[] };
    const resourceNames: string[] = data.resourceNames || [];

    // Fetch details for each customer
    const customers: GoogleCustomer[] = [];
    for (const resourceName of resourceNames) {
      const customerId = resourceName.replace('customers/', '');
      try {
        const customerDetails = await this.getCustomerDetails(accessToken, developerToken, customerId);
        if (customerDetails) {
          customers.push(customerDetails);
        }
      } catch (error) {
        logger.warn({ customerId, error }, 'Failed to get customer details');
      }
    }

    return customers;
  }

  /**
   * Get details for a specific customer account
   */
  private async getCustomerDetails(
    accessToken: string,
    developerToken: string,
    customerId: string
  ): Promise<GoogleCustomer | null> {
    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:searchStream`,
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
      return null;
    }

    const data = (await response.json()) as Array<{ results?: Array<{ customer: { id: string; descriptiveName: string; currencyCode: string; timeZone: string } }> }>;
    const results = data[0]?.results || [];
    if (results.length === 0) {
      return null;
    }

    const customer = results[0]!.customer;
    return {
      id: customer.id,
      descriptiveName: customer.descriptiveName,
      currencyCode: customer.currencyCode,
      timeZone: customer.timeZone,
    };
  }

  /**
   * Fetch campaigns from Google Ads API
   */
  private async fetchCampaigns(
    accessToken: string,
    developerToken: string,
    customerId: string
  ): Promise<GoogleCampaign[]> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:searchStream`,
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
      throw new Error(`Failed to fetch campaigns: ${await response.text()}`);
    }

    const data = (await response.json()) as Array<{ results?: Array<{ campaign: { id: string; name: string; status: string; advertisingChannelType?: string } }> }>;
    const results = data[0]?.results || [];

    return results.map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      advertisingChannelType: r.campaign.advertisingChannelType,
    }));
  }

  /**
   * Fetch spend data from Google Ads API
   */
  private async fetchSpendData(
    accessToken: string,
    developerToken: string,
    customerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<GoogleSpendData[]> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const query = `
      SELECT
        segments.date,
        campaign.id,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
        AND campaign.status != 'REMOVED'
    `;

    const response = await fetch(
      `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:searchStream`,
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
      throw new Error(`Failed to fetch spend data: ${await response.text()}`);
    }

    interface SpendResult {
      segments: { date: string };
      campaign: { id: string };
      metrics: { costMicros: string; impressions: string; clicks: string; conversions: string };
    }
    const data = (await response.json()) as Array<{ results?: SpendResult[] }>;
    const results = data[0]?.results || [];

    return results.map((r) => ({
      date: r.segments.date,
      campaignId: r.campaign.id,
      costMicros: r.metrics.costMicros || '0',
      impressions: r.metrics.impressions || '0',
      clicks: r.metrics.clicks || '0',
      conversions: r.metrics.conversions || '0',
    }));
  }
}

// ============================================================================
// Singleton
// ============================================================================

let googleAdsService: GoogleAdsService | null = null;

export function getGoogleAdsService(): GoogleAdsService {
  if (!googleAdsService) {
    googleAdsService = new GoogleAdsService();
  }
  return googleAdsService;
}
