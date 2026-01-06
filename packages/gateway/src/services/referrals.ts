/**
 * Referrals Service
 * Handles referral code generation and tracking.
 */

import { getReferralsRepository, type ReferralStats, type ReferralWithUser } from '../repositories/index.js';
import { logger } from '../observability/logger.js';
import type { InviteCode, UserReferral } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';
import { env } from '../env.js';

// ============================================================================
// Types
// ============================================================================

export interface ReferralDashboardData {
  inviteCode: string;
  inviteUrl: string;
  totalReferrals: number;
  recentReferrals: ReferralWithUser[];
}

// ============================================================================
// Service
// ============================================================================

export class ReferralsService {
  private referrals = getReferralsRepository();

  /**
   * Get or create invite code for a user
   * Each user gets one unique code
   */
  async getOrCreateInviteCode(userId: string, tx?: TransactionContext): Promise<InviteCode> {
    return this.referrals.getOrCreateInviteCode(userId, tx);
  }

  /**
   * Get dashboard data for user's referral stats
   */
  async getDashboardData(userId: string, tx?: TransactionContext): Promise<ReferralDashboardData> {
    // Get or create user's invite code
    const inviteCode = await this.referrals.getOrCreateInviteCode(userId, tx);

    // Get recent referrals (last 5)
    const recentResult = await this.referrals.listReferralsByReferrer(userId, { limit: 5 }, tx);

    // Build invite URL
    const inviteUrl = `${env.WEB_URL}/signup?ref=${inviteCode.code}`;

    return {
      inviteCode: inviteCode.code,
      inviteUrl,
      totalReferrals: inviteCode.uses_count,
      recentReferrals: recentResult.data,
    };
  }

  /**
   * Record a referral when a user signs up with a referral code
   */
  async recordReferral(
    referredUserId: string,
    referralCode: string,
    tx?: TransactionContext
  ): Promise<UserReferral | null> {
    // Find the invite code
    const inviteCode = await this.referrals.findInviteCodeByCode(referralCode, tx);

    if (!inviteCode) {
      logger.warn({ code: referralCode }, 'Invalid referral code used');
      return null;
    }

    if (!inviteCode.is_active) {
      logger.warn({ code: referralCode }, 'Inactive referral code used');
      return null;
    }

    // Check max uses
    if (inviteCode.max_uses !== null && inviteCode.uses_count >= inviteCode.max_uses) {
      logger.warn({ code: referralCode }, 'Referral code max uses reached');
      return null;
    }

    // Check expiration
    if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
      logger.warn({ code: referralCode }, 'Expired referral code used');
      return null;
    }

    // Create the referral record (trigger will increment uses_count)
    const referral = await this.referrals.createReferral({
      referred_user_id: referredUserId,
      referrer_user_id: inviteCode.user_id,
      invite_code_id: inviteCode.id,
      code_used: referralCode,
    }, tx);

    logger.info(
      { referredUserId, referrerUserId: inviteCode.user_id, code: referralCode },
      'Referral recorded'
    );

    return referral;
  }

  /**
   * Validate a referral code without recording
   */
  async validateReferralCode(code: string, tx?: TransactionContext): Promise<boolean> {
    const inviteCode = await this.referrals.findInviteCodeByCode(code, tx);

    if (!inviteCode || !inviteCode.is_active) {
      return false;
    }

    if (inviteCode.max_uses !== null && inviteCode.uses_count >= inviteCode.max_uses) {
      return false;
    }

    if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
      return false;
    }

    return true;
  }

  /**
   * Get referral stats for a user
   */
  async getReferralStats(userId: string, tx?: TransactionContext): Promise<ReferralStats | null> {
    return this.referrals.getReferralStats(userId, tx);
  }

  /**
   * Mark a referred user as converted (e.g., became a paying customer)
   */
  async markConverted(referredUserId: string, tx?: TransactionContext): Promise<void> {
    await this.referrals.markReferralConverted(referredUserId, tx);
    logger.info({ userId: referredUserId }, 'Referral marked as converted');
  }
}

// Singleton
let referralsService: ReferralsService | null = null;

export function getReferralsService(): ReferralsService {
  if (!referralsService) {
    referralsService = new ReferralsService();
  }
  return referralsService;
}
