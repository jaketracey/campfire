/**
 * Migration: Update Pricing Tiers
 * Created: 2026-01-02
 *
 * Updates subscription_plan enum to add 'standard' and 'premium' tiers.
 * These are the new pricing tiers:
 * - Standard: $19.99/month
 * - Premium: $99.95/month
 *
 * Legacy tiers (free, starter, pro, enterprise) are kept for backward
 * compatibility but marked as deprecated in admin settings.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add new plan tiers to subscription_plan enum
  // PostgreSQL allows adding enum values but not removing them easily
  await sql`
    ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'standard'
  `;

  await sql`
    ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'premium'
  `;

  // Store the pricing configuration in admin_settings
  await sql`
    INSERT INTO admin_settings (key, value, description)
    VALUES (
      'pricing_tiers',
      ${JSON.stringify({
        standard: {
          name: 'Standard',
          price: 1999, // cents
          priceDisplay: '$19.99/month',
          stripePriceId: null, // Set this after creating Stripe price
          features: {
            companionLimit: 3,
            messageLimit: null, // unlimited
            voiceMinutesLimit: 60,
            imageLimit: 50,
          },
          affiliateCommission: 500, // $5.00 default
        },
        premium: {
          name: 'Premium',
          price: 9995, // cents
          priceDisplay: '$99.95/month',
          stripePriceId: null, // Set this after creating Stripe price
          features: {
            companionLimit: 10,
            messageLimit: null, // unlimited
            voiceMinutesLimit: null, // unlimited
            imageLimit: null, // unlimited
          },
          affiliateCommission: 2500, // $25.00 default
        },
        // Legacy tiers - kept for backward compatibility
        _legacyTiers: ['free', 'starter', 'pro', 'enterprise'],
        _activeTiers: ['standard', 'premium'],
      })}::jsonb,
      'Pricing tier configuration including features and affiliate commissions'
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description
  `;

  // Add comment for the new tiers
  await sql`
    COMMENT ON TYPE subscription_plan IS 'Active tiers: standard, premium. Legacy: free, starter, pro, enterprise'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove pricing configuration
  await sql`DELETE FROM admin_settings WHERE key = 'pricing_tiers'`;

  // Note: Cannot easily remove enum values in PostgreSQL
  // The 'standard' and 'premium' values will remain but be unused
}
