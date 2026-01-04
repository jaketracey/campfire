/**
 * Ads API
 * Administrative operations for ad tracking and attribution.
 */

import { get, post, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type AdPlatform = 'google' | 'facebook';
export type AdAccountStatus = 'active' | 'disconnected' | 'error';

export interface AdAccount {
  id: string;
  platform: AdPlatform;
  accountId: string;
  accountName: string;
  status: AdAccountStatus;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdsOverview {
  period: { days: number };
  totalSpend: number;
  totalSignups: number;
  totalConversions: number;
  totalRevenue: number;
  roas: number;
  cpa: number;
  ltv: number;
  ltvCacRatio: number;
  platformBreakdown: {
    google: {
      spend: number;
      signups: number;
      conversions: number;
      revenue: number;
    };
    facebook: {
      spend: number;
      signups: number;
      conversions: number;
      revenue: number;
    };
  };
}

export interface CampaignMetric {
  id: string;
  platform: AdPlatform;
  campaignId: string;
  campaignName: string;
  spend: number;
  signups: number;
  conversions: number;
  revenue: number;
  cpa: number;
  roas: number;
  impressions?: number;
  clicks?: number;
}

export interface CampaignFilters {
  platform?: AdPlatform;
  days?: number;
  sortBy?: 'spend' | 'signups' | 'conversions' | 'revenue' | 'cpa' | 'roas';
  sortOrder?: 'asc' | 'desc';
}

export interface UtmStats {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  signups: number;
  conversions: number;
  revenue: number;
}

export interface SpendTrendPoint {
  date: string;
  googleSpend: number;
  facebookSpend: number;
  totalSpend: number;
  signups: number;
  conversions: number;
}

// ============================================================================
// Account Management API
// ============================================================================

/**
 * List all connected ad accounts
 */
export async function listAdAccounts(): Promise<{ success: boolean; data: { accounts: AdAccount[] } }> {
  return get('/admin/ads/accounts');
}

/**
 * Get Google Ads OAuth authorization URL
 */
export async function connectGoogleAds(): Promise<{ success: boolean; data: { authUrl: string } }> {
  return post('/admin/ads/accounts/google/connect');
}

/**
 * Get Facebook Ads OAuth authorization URL
 */
export async function connectFacebookAds(): Promise<{ success: boolean; data: { authUrl: string } }> {
  return post('/admin/ads/accounts/facebook/connect');
}

/**
 * Disconnect an ad account
 */
export async function disconnectAdAccount(id: string): Promise<{ success: boolean }> {
  return del(`/admin/ads/accounts/${id}`);
}

/**
 * Manually sync an ad account
 */
export async function syncAdAccount(id: string): Promise<{ success: boolean; data: { lastSyncAt: string } }> {
  return post(`/admin/ads/accounts/${id}/sync`);
}

// ============================================================================
// Analytics API
// ============================================================================

/**
 * Get ads overview metrics (spend, signups, conversions, revenue, ROAS, CPA, LTV)
 */
export async function getAdsOverview(
  days = 30
): Promise<{ success: boolean; data: AdsOverview }> {
  return get(`/admin/ads/overview?days=${days}`);
}

/**
 * Get campaign-level metrics
 */
export async function getCampaignMetrics(
  params?: CampaignFilters
): Promise<{ success: boolean; data: { campaigns: CampaignMetric[] } }> {
  const queryParams: Record<string, string | number | boolean | undefined> = {};
  if (params?.platform) queryParams.platform = params.platform;
  if (params?.days) queryParams.days = params.days;
  if (params?.sortBy) queryParams.sortBy = params.sortBy;
  if (params?.sortOrder) queryParams.sortOrder = params.sortOrder;
  return get('/admin/ads/campaigns', queryParams);
}

/**
 * Get UTM attribution statistics
 */
export async function getUtmStats(
  days = 30
): Promise<{ success: boolean; data: { stats: UtmStats[] } }> {
  return get(`/admin/ads/utm?days=${days}`);
}

/**
 * Get spend trend over time
 */
export async function getSpendTrend(
  days = 30
): Promise<{ success: boolean; data: { trend: SpendTrendPoint[] } }> {
  return get(`/admin/ads/trend?days=${days}`);
}
