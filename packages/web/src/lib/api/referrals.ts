/**
 * Referrals API
 * User referral code management and dashboard data.
 */

import { get } from './client';

// ============================================================================
// Types
// ============================================================================

export interface ReferralDashboardData {
  inviteCode: string;
  inviteUrl: string;
  stats: {
    totalReferrals: number;
  };
  recentReferrals: Array<{
    id: string;
    email: string;
    createdAt: string;
    converted: boolean;
  }>;
}

export interface ReferralDashboardResponse {
  success: boolean;
  data: ReferralDashboardData;
}

export interface InviteCodeData {
  code: string;
  inviteUrl: string;
  usesCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface InviteCodeResponse {
  success: boolean;
  data: InviteCodeData;
}

export interface ReferralStatsData {
  code: string | null;
  totalReferrals: number;
  isActive: boolean;
}

export interface ReferralStatsResponse {
  success: boolean;
  data: ReferralStatsData;
}

// ============================================================================
// API Methods
// ============================================================================

/**
 * Get user's referral dashboard data
 */
export function getReferralDashboard(): Promise<ReferralDashboardResponse> {
  return get<ReferralDashboardResponse>('/referrals/dashboard');
}

/**
 * Get user's invite code
 */
export function getInviteCode(): Promise<InviteCodeResponse> {
  return get<InviteCodeResponse>('/referrals/code');
}

/**
 * Get user's referral stats
 */
export function getReferralStats(): Promise<ReferralStatsResponse> {
  return get<ReferralStatsResponse>('/referrals/stats');
}

/**
 * Validate a referral code (public)
 */
export function validateReferralCode(code: string): Promise<{
  success: boolean;
  data: { code: string; valid: boolean };
}> {
  return get<{ success: boolean; data: { code: string; valid: boolean } }>(
    `/referrals/validate/${encodeURIComponent(code)}`
  );
}
