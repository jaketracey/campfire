/**
 * Ad Conversions Service
 * Business logic for tracking user conversions and calculating LTV for ad attribution.
 */

import { getAdsRepository } from '../repositories/ads.js';
import { getUsersRepository } from '../repositories/users.js';
import { getBillingRepository } from '../repositories/billing.js';
import { logger } from '../observability/logger.js';
import type { AdConversion, AdConversionType, AdPlatform, UserLtv } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';
import { sql } from '../db/pool.js';

// ============================================================================
// Types
// ============================================================================

export interface ConversionResult {
  conversion: AdConversion;
  isNew: boolean;
}

export interface LtvCalculation {
  totalPaymentsCents: number;
  subscriptionRevenueCents: number;
  tokenRevenueCents: number;
  ltvCents: number;
}

// ============================================================================
// Service
// ============================================================================

export class AdConversionsService {
  private ads = getAdsRepository();
  private users = getUsersRepository();
  private billing = getBillingRepository();

  /**
   * Record a signup conversion with UTM data from user
   * This should be called when a user completes registration
   */
  async recordSignupConversion(userId: string, tx?: TransactionContext): Promise<ConversionResult> {
    // Check if signup conversion already exists
    const existing = await this.ads.findConversionByUserAndType(userId, 'signup', tx);
    if (existing) {
      logger.debug({ userId }, 'Signup conversion already recorded');
      return { conversion: existing, isNew: false };
    }

    // Get user with UTM data
    const user = await this.users.findById(userId, tx);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Extract UTM data from user record
    // Note: UTM fields were added to users table in the migration
    const db = tx ?? sql();
    const userResult = await db`
      SELECT utm_source, utm_medium, utm_campaign, ad_click_platform
      FROM users
      WHERE id = ${userId}
    `;
    const userData = userResult[0];

    // Determine platform from ad_click_platform or utm_source
    let platform: AdPlatform | null = null;
    const adClickPlatform = userData?.ad_click_platform as string | null;
    const utmSource = userData?.utm_source as string | null;

    if (adClickPlatform === 'google' || utmSource?.toLowerCase().includes('google')) {
      platform = 'google_ads';
    } else if (adClickPlatform === 'facebook' || utmSource?.toLowerCase().includes('facebook') || utmSource?.toLowerCase().includes('fb')) {
      platform = 'facebook_ads';
    }

    const conversion = await this.ads.createConversion({
      user_id: userId,
      conversion_type: 'signup',
      platform,
      utm_source: utmSource,
      utm_medium: userData?.utm_medium as string | null,
      utm_campaign: userData?.utm_campaign as string | null,
      revenue_cents: 0,
      ltv_cents: 0,
      conversion_date: new Date(),
    }, tx);

    logger.info({ userId, conversionId: conversion.id, platform }, 'Signup conversion recorded');
    return { conversion, isNew: true };
  }

  /**
   * Record a payment conversion
   * This should be called when a user makes their first payment or subsequent payments
   */
  async recordPaymentConversion(
    userId: string,
    amountCents: number,
    type: 'first_payment' | 'subscription' | 'purchase',
    tx?: TransactionContext
  ): Promise<ConversionResult> {
    // Check if this conversion type already exists
    const existing = await this.ads.findConversionByUserAndType(userId, type, tx);
    if (existing) {
      logger.debug({ userId, type }, 'Payment conversion already recorded');
      return { conversion: existing, isNew: false };
    }

    // Get the signup conversion to inherit UTM data
    const signupConversion = await this.ads.findConversionByUserAndType(userId, 'signup', tx);

    const conversion = await this.ads.createConversion({
      user_id: userId,
      conversion_type: type,
      campaign_id: signupConversion?.campaign_id,
      platform_campaign_id: signupConversion?.platform_campaign_id,
      platform: signupConversion?.platform,
      utm_source: signupConversion?.utm_source,
      utm_medium: signupConversion?.utm_medium,
      utm_campaign: signupConversion?.utm_campaign,
      revenue_cents: amountCents,
      ltv_cents: 0, // Will be updated by calculateUserLtv
      conversion_date: new Date(),
    }, tx);

    logger.info(
      { userId, conversionId: conversion.id, type, amountCents },
      'Payment conversion recorded'
    );

    // Update LTV after recording payment
    await this.updateUserLtv(userId, tx);
    await this.updateConversionLtv(userId, tx);

    return { conversion, isNew: true };
  }

  /**
   * Calculate the lifetime value for a user by summing all payments
   */
  async calculateUserLtv(userId: string, tx?: TransactionContext): Promise<LtvCalculation> {
    const db = tx ?? sql();

    // Get subscription payments
    const subscriptionResult = await db`
      SELECT COALESCE(SUM(
        CASE
          WHEN plan = 'starter' THEN 999
          WHEN plan = 'pro' THEN 2999
          WHEN plan = 'enterprise' THEN 9999
          ELSE 0
        END
      ), 0)::INTEGER as total
      FROM subscriptions
      WHERE user_id = ${userId}
        AND status IN ('active', 'canceled', 'past_due')
    `;
    const subscriptionRevenueCents = subscriptionResult[0]?.total as number || 0;

    // Get token purchases
    const tokenResult = await db`
      SELECT COALESCE(SUM(
        CASE
          WHEN transaction_type = 'purchase' THEN amount
          ELSE 0
        END
      ), 0)::INTEGER as total
      FROM token_transactions
      WHERE user_id = ${userId}
        AND transaction_type = 'purchase'
    `;
    // Assume tokens are sold at $1 per 100 tokens, so we need to look at actual purchases
    // For now, estimate based on token count
    const tokensPurchased = tokenResult[0]?.total as number || 0;
    const tokenRevenueCents = Math.round(tokensPurchased / 100 * 100); // $1 per 100 tokens = 100 cents

    const totalPaymentsCents = subscriptionRevenueCents + tokenRevenueCents;
    const ltvCents = totalPaymentsCents; // Could add projections or multipliers here

    return {
      totalPaymentsCents,
      subscriptionRevenueCents,
      tokenRevenueCents,
      ltvCents,
    };
  }

  /**
   * Persist LTV calculation to user_ltv table
   */
  async updateUserLtv(userId: string, tx?: TransactionContext): Promise<UserLtv> {
    const ltv = await this.calculateUserLtv(userId, tx);
    const db = tx ?? sql();

    // Get first and last payment dates
    const paymentDates = await db`
      SELECT
        MIN(created_at) as first_payment,
        MAX(created_at) as last_payment
      FROM token_transactions
      WHERE user_id = ${userId}
        AND transaction_type = 'purchase'
    `;

    const userLtv = await this.ads.upsertUserLtv({
      user_id: userId,
      total_payments_cents: ltv.totalPaymentsCents,
      subscription_revenue_cents: ltv.subscriptionRevenueCents,
      token_revenue_cents: ltv.tokenRevenueCents,
      ltv_cents: ltv.ltvCents,
      first_payment_at: paymentDates[0]?.first_payment as Date | null,
      last_payment_at: paymentDates[0]?.last_payment as Date | null,
    }, tx);

    logger.debug({ userId, ltvCents: ltv.ltvCents }, 'User LTV updated');
    return userLtv;
  }

  /**
   * Update ltv_cents in all ad_conversions for a user
   */
  async updateConversionLtv(userId: string, tx?: TransactionContext): Promise<void> {
    const userLtv = await this.ads.getUserLtv(userId, tx);
    if (!userLtv) {
      return;
    }

    await this.ads.updateConversionLtv(userId, userLtv.ltv_cents, tx);
    logger.debug({ userId, ltvCents: userLtv.ltv_cents }, 'Conversion LTV updated');
  }

  /**
   * Get all conversions for a user
   */
  async getUserConversions(userId: string, tx?: TransactionContext): Promise<AdConversion[]> {
    return this.ads.getConversionsByUser(userId, tx);
  }

  /**
   * Get user LTV
   */
  async getUserLtv(userId: string, tx?: TransactionContext): Promise<UserLtv | null> {
    return this.ads.getUserLtv(userId, tx);
  }

  /**
   * Batch update LTV for all users with conversions
   * This is useful for a background job
   */
  async batchUpdateLtv(limit: number = 100, tx?: TransactionContext): Promise<number> {
    const db = tx ?? sql();

    // Get users with conversions that might need LTV updates
    const users = await db`
      SELECT DISTINCT c.user_id
      FROM ad_conversions c
      LEFT JOIN user_ltv l ON c.user_id = l.user_id
      WHERE l.user_id IS NULL
         OR l.updated_at < NOW() - INTERVAL '1 day'
      LIMIT ${limit}
    `;

    let updatedCount = 0;
    for (const row of users) {
      try {
        await this.updateUserLtv(row.user_id as string, tx);
        await this.updateConversionLtv(row.user_id as string, tx);
        updatedCount++;
      } catch (error) {
        logger.error(
          { userId: row.user_id, error: error instanceof Error ? error.message : 'Unknown' },
          'Failed to update LTV'
        );
      }
    }

    if (updatedCount > 0) {
      logger.info({ updatedCount }, 'Batch LTV update completed');
    }

    return updatedCount;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let adConversionsService: AdConversionsService | null = null;

export function getAdConversionsService(): AdConversionsService {
  if (!adConversionsService) {
    adConversionsService = new AdConversionsService();
  }
  return adConversionsService;
}
