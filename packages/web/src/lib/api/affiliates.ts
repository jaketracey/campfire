/**
 * Affiliates API
 * Affiliate program management, portal, and tracking.
 */

import { get, post, patch, del, apiClient } from './client';

// ============================================================================
// Types
// ============================================================================

export type AffiliateStatus = 'active' | 'suspended' | 'inactive';
export type ConversionStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export type PlanTier = 'standard' | 'premium';

export interface PayoutInfo {
  type: 'paypal' | 'bank' | 'other';
  paypalEmail?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  notes?: string;
}

// Affiliate Portal Types
export interface AffiliateStats {
  totalClicks: number;
  totalConversions: number;
  pendingEarnings: number;
  totalEarned: number;
  totalPaid: number;
  conversionRate: number;
  pendingConversions: number;
}

export interface AffiliateProfile {
  id: string;
  name: string;
  email: string;
  code: string;
  status: AffiliateStatus;
  commissionStandard: number;
  commissionPremium: number;
  payoutInfo: PayoutInfo | null;
  createdAt: string;
}

export interface AffiliateConversion {
  id: string;
  affiliateId: string;
  userId: string;
  userEmail?: string;
  planTier: PlanTier;
  commissionAmount: number;
  status: ConversionStatus;
  rejectionReason?: string;
  paidAt: string | null;
  flowguardTransactionId?: string;
  createdAt: string;
}

export interface AffiliateClick {
  id: string;
  affiliateId: string;
  referrerUrl: string | null;
  landingPage: string | null;
  createdAt: string;
}

export interface AffiliateLink {
  code: string;
  url: string;
  shortUrl: string;
}

// Admin Types
export interface AffiliateListItem {
  id: string;
  name: string;
  email: string;
  code: string;
  status: AffiliateStatus;
  commissionStandard: number;
  commissionPremium: number;
  totalClicks: number;
  totalConversions: number;
  totalEarned: number;
  totalPaid: number;
  pendingEarnings: number;
  pendingConversions: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AffiliateDetail extends AffiliateListItem {
  payoutInfo: PayoutInfo | null;
  notes: string | null;
  updatedAt: string;
}

export interface ConversionWithAffiliate extends AffiliateConversion {
  affiliateName: string;
  affiliateCode: string;
}

export interface PendingPayout {
  affiliateId: string;
  affiliateName: string;
  affiliateCode: string;
  affiliateEmail: string;
  payoutInfo: PayoutInfo | null;
  pendingAmount: number;
  pendingCount: number;
  conversions: Array<{
    id: string;
    planTier: PlanTier;
    commissionAmount: number;
    createdAt: string;
  }>;
}

// Request/Response Types
export interface AffiliateLoginRequest {
  email: string;
  password: string;
}

export interface AffiliateAuthResponse {
  success: boolean;
  data: {
    affiliate: {
      id: string;
      name: string;
      email: string;
      code: string;
    };
    token: string;
    expiresIn: number;
  };
}

export interface AffiliateSessionResponse {
  success: boolean;
  data: {
    affiliate: {
      id: string;
      name: string;
      email: string;
      code: string;
    };
  };
}

export interface CreateAffiliateRequest {
  name: string;
  email: string;
  password: string;
  code?: string;
  commissionStandard?: number;
  commissionPremium?: number;
  notes?: string;
}

export interface UpdateAffiliateRequest {
  name?: string;
  email?: string;
  password?: string;
  code?: string;
  commissionStandard?: number;
  commissionPremium?: number;
  status?: AffiliateStatus;
  notes?: string;
}

export interface UpdatePayoutInfoRequest {
  payoutInfo: PayoutInfo;
}

export interface UpdateConversionStatusRequest {
  status: ConversionStatus;
  rejectionReason?: string;
}

// List Response Types
export interface PaginatedResponse<T> {
  success: boolean;
  data: {
    items?: T[];
    affiliates?: T[];
    conversions?: T[];
    clicks?: T[];
    hasMore: boolean;
    total?: number;
    limit: number;
    offset: number;
  };
}

// ============================================================================
// Affiliate Auth API (separate from user auth)
// ============================================================================

/**
 * Login as an affiliate
 */
export function affiliateLogin(credentials: AffiliateLoginRequest): Promise<AffiliateAuthResponse> {
  return post<AffiliateAuthResponse>('/affiliate/auth/login', credentials);
}

/**
 * Logout affiliate session
 */
export function affiliateLogout(token: string): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>('/affiliate/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Get current affiliate session
 */
export function getAffiliateSession(token: string): Promise<AffiliateSessionResponse> {
  return apiClient<AffiliateSessionResponse>('/affiliate/auth/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============================================================================
// Affiliate Portal API (requires affiliate auth)
// ============================================================================

/**
 * Get affiliate dashboard stats
 */
export function getAffiliateStats(token: string): Promise<{ success: boolean; data: AffiliateStats }> {
  return apiClient<{ success: boolean; data: AffiliateStats }>('/affiliate/stats', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Get affiliate's conversions
 */
export function getAffiliateConversions(
  token: string,
  params?: { status?: ConversionStatus; limit?: number; offset?: number }
): Promise<PaginatedResponse<AffiliateConversion>> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.append('status', params.status);
  if (params?.limit) searchParams.append('limit', String(params.limit));
  if (params?.offset) searchParams.append('offset', String(params.offset));
  const query = searchParams.toString();

  return apiClient<PaginatedResponse<AffiliateConversion>>(
    `/affiliate/conversions${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

/**
 * Get affiliate's clicks
 */
export function getAffiliateClicks(
  token: string,
  params?: { limit?: number; offset?: number }
): Promise<PaginatedResponse<AffiliateClick>> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.append('limit', String(params.limit));
  if (params?.offset) searchParams.append('offset', String(params.offset));
  const query = searchParams.toString();

  return apiClient<PaginatedResponse<AffiliateClick>>(
    `/affiliate/clicks${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

/**
 * Get affiliate profile
 */
export function getAffiliateProfile(token: string): Promise<{ success: boolean; data: AffiliateProfile }> {
  return apiClient<{ success: boolean; data: AffiliateProfile }>('/affiliate/profile', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Update affiliate payout info
 */
export function updateAffiliatePayoutInfo(
  token: string,
  data: UpdatePayoutInfoRequest
): Promise<{ success: boolean; data: AffiliateProfile }> {
  return apiClient<{ success: boolean; data: AffiliateProfile }>('/affiliate/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

/**
 * Get affiliate referral link
 */
export function getAffiliateLink(token: string): Promise<{ success: boolean; data: AffiliateLink }> {
  return apiClient<{ success: boolean; data: AffiliateLink }>('/affiliate/link', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ============================================================================
// Admin Affiliates API (requires admin auth via normal user token)
// ============================================================================

/**
 * List all affiliates (admin)
 */
export function listAffiliates(params?: {
  status?: AffiliateStatus;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; data: { affiliates: AffiliateListItem[]; hasMore: boolean; total: number; limit: number; offset: number } }> {
  return get('/admin/affiliates', params);
}

/**
 * Get affiliate details (admin)
 */
export function getAffiliate(id: string): Promise<{ success: boolean; data: AffiliateDetail }> {
  return get(`/admin/affiliates/${id}`);
}

/**
 * Create a new affiliate (admin)
 */
export function createAffiliate(
  data: CreateAffiliateRequest
): Promise<{ success: boolean; data: AffiliateListItem }> {
  return post('/admin/affiliates', data);
}

/**
 * Update an affiliate (admin)
 */
export function updateAffiliate(
  id: string,
  data: UpdateAffiliateRequest
): Promise<{ success: boolean; data: AffiliateListItem }> {
  return patch(`/admin/affiliates/${id}`, data);
}

/**
 * Deactivate an affiliate (admin)
 */
export function deactivateAffiliate(id: string): Promise<{ success: boolean; message: string }> {
  return del(`/admin/affiliates/${id}`);
}

/**
 * Get affiliate's conversions (admin)
 */
export function getAffiliateConversionsAdmin(
  affiliateId: string,
  params?: { status?: ConversionStatus; limit?: number; offset?: number }
): Promise<PaginatedResponse<AffiliateConversion>> {
  return get(`/admin/affiliates/${affiliateId}/conversions`, params);
}

/**
 * List all conversions across affiliates (admin)
 */
export function listConversions(params?: {
  status?: ConversionStatus;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; data: { conversions: ConversionWithAffiliate[]; hasMore: boolean; limit: number; offset: number } }> {
  return get('/admin/affiliates/conversions', params);
}

/**
 * Update conversion status (admin)
 */
export function updateConversionStatus(
  conversionId: string,
  data: UpdateConversionStatusRequest
): Promise<{ success: boolean; data: { id: string; status: ConversionStatus; rejectionReason?: string; paidAt: string | null; updatedAt: string } }> {
  return patch(`/admin/affiliates/conversions/${conversionId}`, data);
}

/**
 * Mark conversion as paid (admin)
 */
export function markConversionPaid(
  conversionId: string
): Promise<{ success: boolean; data: { id: string; status: ConversionStatus; paidAt: string | null } }> {
  return post(`/admin/affiliates/conversions/${conversionId}/pay`);
}

/**
 * Get pending payouts summary (admin)
 */
export function getPendingPayouts(): Promise<{
  success: boolean;
  data: {
    payouts: PendingPayout[];
    totalPending: number;
    totalAffiliates: number;
  };
}> {
  return get('/admin/affiliates/payouts');
}

// ============================================================================
// Public Tracking API
// ============================================================================

/**
 * Validate an affiliate code (public)
 */
export function validateAffiliateCode(code: string): Promise<{
  success: boolean;
  data: { code: string; valid: boolean; affiliateName?: string };
}> {
  return post('/affiliate/validate', { code });
}
