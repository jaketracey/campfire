/**
 * Facebook Ads Service
 * OAuth integration and data sync with Facebook Marketing API.
 */

import { getAdsRepository } from '../repositories/ads.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import type { AdAccount, AdCampaign, AdSpendDaily } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Configuration
// ============================================================================

interface FacebookAdsConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

function getConfig(): FacebookAdsConfig {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  const redirectUri = env.FACEBOOK_ADS_REDIRECT_URI || 'http://localhost:3000/api/v1/admin/ads/callback/facebook';

  if (!appId || !appSecret) {
    throw new Error('Missing Facebook Ads configuration. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET');
  }

  return {
    appId,
    appSecret,
    redirectUri,
  };
}

// ============================================================================
// Types
// ============================================================================

interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface FacebookLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface FacebookAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_id: string;
}

interface FacebookCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

interface FacebookInsight {
  date_start: string;
  date_stop: string;
  campaign_id: string;
  spend: string;
  impressions: string;
  clicks: string;
  actions?: Array<{ action_type: string; value: string }>;
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

export class FacebookAdsService {
  private ads = getAdsRepository();
  private config: FacebookAdsConfig | null = null;
  private readonly apiVersion = 'v18.0';

  private getConfig(): FacebookAdsConfig {
    if (!this.config) {
      this.config = getConfig();
    }
    return this.config;
  }

  /**
   * Get the OAuth authorization URL for Facebook Ads
   */
  getAuthUrl(state?: string): string {
    const config = this.getConfig();
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      scope: 'ads_read,ads_management,business_management',
      response_type: 'code',
    });

    if (state) {
      params.set('state', state);
    }

    return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens and create ad account
   */
  async handleCallback(code: string, tx?: TransactionContext): Promise<AdAccount> {
    const config = this.getConfig();

    // Exchange code for short-lived token
    const tokenUrl = new URL(`https://graph.facebook.com/${this.apiVersion}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', config.appId);
    tokenUrl.searchParams.set('client_secret', config.appSecret);
    tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenResponse = await fetch(tokenUrl.toString());

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      logger.error({ error }, 'Failed to exchange Facebook OAuth code');
      throw new Error(`Failed to exchange code: ${error}`);
    }

    const tokens = (await tokenResponse.json()) as FacebookTokenResponse;

    // Exchange for long-lived token
    const longLivedToken = await this.exchangeForLongLivedToken(tokens.access_token);

    // Get available ad accounts
    const adAccounts = await this.getAdAccounts(longLivedToken.access_token);
    if (adAccounts.length === 0) {
      throw new Error('No Facebook Ad accounts found');
    }

    // Use the first accessible ad account
    const adAccount = adAccounts[0]!;

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + longLivedToken.expires_in * 1000);

    // Check if account already exists
    const existing = await this.ads.findAdAccountByPlatformId('facebook_ads', adAccount.account_id, tx);
    if (existing) {
      // Update existing account with new tokens
      return this.ads.updateAdAccount(existing.id, {
        account_name: adAccount.name,
        access_token_encrypted: longLivedToken.access_token, // Should encrypt in production
        token_expires_at: expiresAt,
        currency: adAccount.currency,
        timezone: adAccount.timezone_name,
        status: 'active',
        sync_error: null,
      }, tx);
    }

    // Create new account
    const account = await this.ads.createAdAccount({
      platform: 'facebook_ads',
      account_id: adAccount.account_id,
      account_name: adAccount.name,
      access_token_encrypted: longLivedToken.access_token, // Should encrypt in production
      token_expires_at: expiresAt,
      currency: adAccount.currency,
      timezone: adAccount.timezone_name,
      status: 'active',
    }, tx);

    logger.info({ accountId: account.id, facebookId: adAccount.account_id }, 'Facebook Ads account connected');
    return account;
  }

  /**
   * Refresh an expired access token
   * Note: Facebook long-lived tokens can be refreshed before they expire
   */
  async refreshAccessToken(accountId: string, tx?: TransactionContext): Promise<AdAccount> {
    const account = await this.ads.findAdAccountById(accountId, tx);

    if (!account) {
      throw new Error(`Ad account not found: ${accountId}`);
    }

    if (!account.access_token_encrypted) {
      throw new Error('No access token available');
    }

    try {
      // Exchange existing token for a new long-lived token
      const longLivedToken = await this.exchangeForLongLivedToken(account.access_token_encrypted);
      const expiresAt = new Date(Date.now() + longLivedToken.expires_in * 1000);

      const updated = await this.ads.updateAdAccount(accountId, {
        access_token_encrypted: longLivedToken.access_token,
        token_expires_at: expiresAt,
        sync_error: null,
      }, tx);

      logger.debug({ accountId }, 'Facebook Ads access token refreshed');
      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ accountId, error: errorMessage }, 'Failed to refresh Facebook OAuth token');

      // Mark account as disconnected
      await this.ads.updateAdAccount(accountId, {
        status: 'disconnected',
        sync_error: `Token refresh failed: ${errorMessage}`,
      }, tx);

      throw error;
    }
  }

  /**
   * Sync campaigns from Facebook Ads
   */
  async syncCampaigns(accountId: string, tx?: TransactionContext): Promise<SyncResult> {
    const account = await this.ensureValidToken(accountId, tx);

    try {
      const campaigns = await this.fetchCampaigns(
        account.access_token_encrypted!,
        account.account_id
      );

      let syncedCount = 0;
      for (const campaign of campaigns) {
        await this.ads.upsertCampaign({
          ad_account_id: accountId,
          platform_campaign_id: campaign.id,
          name: campaign.name,
          status: campaign.status.toLowerCase(),
          objective: campaign.objective || null,
        }, tx);
        syncedCount++;
      }

      // Update last sync time
      await this.ads.updateAdAccount(accountId, {
        last_sync_at: new Date(),
        sync_error: null,
      }, tx);

      logger.info({ accountId, campaignCount: syncedCount }, 'Facebook Ads campaigns synced');
      return { success: true, accountId, campaignsSynced: syncedCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.ads.updateAdAccount(accountId, {
        status: 'error',
        sync_error: errorMessage,
      }, tx);

      logger.error({ accountId, error: errorMessage }, 'Failed to sync Facebook Ads campaigns');
      return { success: false, accountId, error: errorMessage };
    }
  }

  /**
   * Sync daily spend data from Facebook Ads
   */
  async syncSpendData(
    accountId: string,
    startDate: Date,
    endDate: Date,
    tx?: TransactionContext
  ): Promise<SyncResult> {
    const account = await this.ensureValidToken(accountId, tx);

    try {
      const insights = await this.fetchInsights(
        account.access_token_encrypted!,
        account.account_id,
        startDate,
        endDate
      );

      let syncedCount = 0;
      for (const insight of insights) {
        // Convert spend from dollars to cents
        const spendCents = Math.round(parseFloat(insight.spend) * 100);

        // Extract conversions from actions array
        let conversions = 0;
        if (insight.actions) {
          const conversionAction = insight.actions.find(
            (a) => a.action_type === 'offsite_conversion' || a.action_type === 'purchase'
          );
          if (conversionAction) {
            conversions = parseInt(conversionAction.value, 10) || 0;
          }
        }

        await this.ads.upsertDailySpend({
          ad_account_id: accountId,
          platform_campaign_id: insight.campaign_id,
          date: new Date(insight.date_start),
          spend_cents: spendCents,
          impressions: parseInt(insight.impressions, 10) || 0,
          clicks: parseInt(insight.clicks, 10) || 0,
          conversions,
          currency: account.currency,
        }, tx);
        syncedCount++;
      }

      // Update last sync time
      await this.ads.updateAdAccount(accountId, {
        last_sync_at: new Date(),
        sync_error: null,
      }, tx);

      logger.info({ accountId, recordCount: syncedCount }, 'Facebook Ads spend data synced');
      return { success: true, accountId, spendRecordsSynced: syncedCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.ads.updateAdAccount(accountId, {
        status: 'error',
        sync_error: errorMessage,
      }, tx);

      logger.error({ accountId, error: errorMessage }, 'Failed to sync Facebook Ads spend data');
      return { success: false, accountId, error: errorMessage };
    }
  }

  /**
   * Exchange short-lived token for long-lived token
   */
  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<FacebookLongLivedTokenResponse> {
    const config = this.getConfig();

    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', config.appId);
    url.searchParams.set('client_secret', config.appSecret);
    url.searchParams.set('fb_exchange_token', shortLivedToken);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Failed to exchange for long-lived token: ${await response.text()}`);
    }

    return (await response.json()) as FacebookLongLivedTokenResponse;
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

    // Check if token is expired or will expire in the next day
    // Facebook tokens need to be refreshed before they fully expire
    const tokenExpiresAt = account.token_expires_at;
    const bufferMs = 24 * 60 * 60 * 1000; // 1 day

    if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now() + bufferMs) {
      return this.refreshAccessToken(accountId, tx);
    }

    return account;
  }

  /**
   * Get accessible ad accounts from Facebook API
   */
  private async getAdAccounts(accessToken: string): Promise<FacebookAdAccount[]> {
    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/me/adaccounts`);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fields', 'id,name,currency,timezone_name,account_id');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Failed to get ad accounts: ${await response.text()}`);
    }

    const data = (await response.json()) as { data?: FacebookAdAccount[] };
    return data.data || [];
  }

  /**
   * Fetch campaigns from Facebook Marketing API
   */
  private async fetchCampaigns(accessToken: string, adAccountId: string): Promise<FacebookCampaign[]> {
    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/act_${adAccountId}/campaigns`);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fields', 'id,name,status,objective');
    url.searchParams.set('limit', '500');

    const campaigns: FacebookCampaign[] = [];
    let nextUrl: string | null = url.toString();

    while (nextUrl) {
      const response = await fetch(nextUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch campaigns: ${await response.text()}`);
      }

      const data = (await response.json()) as { data?: FacebookCampaign[]; paging?: { next?: string } };
      campaigns.push(...(data.data || []));

      // Handle pagination
      nextUrl = data.paging?.next || null;
    }

    return campaigns;
  }

  /**
   * Fetch spend insights from Facebook Marketing API
   */
  private async fetchInsights(
    accessToken: string,
    adAccountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<FacebookInsight[]> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const url = new URL(`https://graph.facebook.com/${this.apiVersion}/act_${adAccountId}/insights`);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fields', 'campaign_id,spend,impressions,clicks,actions');
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('time_increment', '1'); // Daily breakdown
    url.searchParams.set('time_range', JSON.stringify({
      since: startStr,
      until: endStr,
    }));
    url.searchParams.set('limit', '500');

    const insights: FacebookInsight[] = [];
    let nextUrl: string | null = url.toString();

    while (nextUrl) {
      const response = await fetch(nextUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch insights: ${await response.text()}`);
      }

      const data = (await response.json()) as { data?: FacebookInsight[]; paging?: { next?: string } };
      insights.push(...(data.data || []));

      // Handle pagination
      nextUrl = data.paging?.next || null;
    }

    return insights;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let facebookAdsService: FacebookAdsService | null = null;

export function getFacebookAdsService(): FacebookAdsService {
  if (!facebookAdsService) {
    facebookAdsService = new FacebookAdsService();
  }
  return facebookAdsService;
}
