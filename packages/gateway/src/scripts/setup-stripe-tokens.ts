/**
 * Setup Stripe Products and Prices for Token Bundles
 *
 * This script creates Stripe products and prices for token bundles
 * and updates the database with the real Stripe IDs.
 *
 * Usage:
 *   cd packages/gateway
 *   pnpm tsx src/scripts/setup-stripe-tokens.ts
 *
 * Prerequisites:
 *   - STRIPE_SECRET_KEY must be set in .env
 *   - Database must be running and seeded
 */

import 'dotenv/config';
import Stripe from 'stripe';
import postgres from 'postgres';

// Initialize Stripe
const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
if (!stripeSecretKey) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
});

// Initialize database connection
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 30,
});

interface TokenBundle {
  id: string;
  name: string;
  description: string | null;
  tokens: number;
  price_cents: number;
  currency: string;
  bonus_tokens: number;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
}

async function main() {
  console.log('🚀 Setting up Stripe products and prices for token bundles...\n');

  try {
    // Fetch all active token bundles from the database
    const bundles = await sql<TokenBundle[]>`
      SELECT id, name, description, tokens, price_cents, currency, bonus_tokens, stripe_price_id, stripe_product_id
      FROM token_bundles
      WHERE is_active = TRUE
      ORDER BY display_order ASC
    `;

    if (bundles.length === 0) {
      console.log('No token bundles found in database. Run seed first.');
      process.exit(1);
    }

    console.log(`Found ${bundles.length} token bundles to configure:\n`);

    for (const bundle of bundles) {
      console.log(`📦 Processing: ${bundle.name}`);
      console.log(`   Tokens: ${bundle.tokens} + ${bundle.bonus_tokens} bonus`);
      console.log(`   Price: $${(bundle.price_cents / 100).toFixed(2)} ${bundle.currency.toUpperCase()}`);

      // Check if this bundle already has valid Stripe IDs
      if (bundle.stripe_product_id?.startsWith('prod_') && bundle.stripe_price_id?.startsWith('price_')) {
        console.log(`   ✅ Already configured (product: ${bundle.stripe_product_id})`);
        console.log('');
        continue;
      }

      // Create Stripe product
      const product = await stripe.products.create({
        name: `${bundle.name} - ${bundle.tokens + bundle.bonus_tokens} Tokens`,
        description: bundle.description ?? `${bundle.tokens} tokens + ${bundle.bonus_tokens} bonus tokens`,
        metadata: {
          bundleId: bundle.id,
          tokens: bundle.tokens.toString(),
          bonusTokens: bundle.bonus_tokens.toString(),
          totalTokens: (bundle.tokens + bundle.bonus_tokens).toString(),
          type: 'token_bundle',
        },
      });

      console.log(`   Created product: ${product.id}`);

      // Create Stripe price
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: bundle.price_cents,
        currency: bundle.currency,
        metadata: {
          bundleId: bundle.id,
          tokens: bundle.tokens.toString(),
          bonusTokens: bundle.bonus_tokens.toString(),
        },
      });

      console.log(`   Created price: ${price.id}`);

      // Update database with real Stripe IDs
      await sql`
        UPDATE token_bundles
        SET
          stripe_product_id = ${product.id},
          stripe_price_id = ${price.id},
          updated_at = NOW()
        WHERE id = ${bundle.id}
      `;

      console.log(`   ✅ Database updated`);
      console.log('');
    }

    console.log('✨ All token bundles configured successfully!\n');

    // Print summary
    console.log('=== Summary ===');
    const updatedBundles = await sql<TokenBundle[]>`
      SELECT name, tokens, bonus_tokens, price_cents, stripe_price_id
      FROM token_bundles
      WHERE is_active = TRUE
      ORDER BY display_order ASC
    `;

    for (const bundle of updatedBundles) {
      const totalTokens = bundle.tokens + bundle.bonus_tokens;
      const pricePerToken = (bundle.price_cents / 100 / totalTokens).toFixed(4);
      console.log(`${bundle.name}: ${totalTokens} tokens @ $${pricePerToken}/token`);
      console.log(`  Stripe Price ID: ${bundle.stripe_price_id}`);
    }

    console.log('\n📋 Next steps:');
    console.log('1. Configure your Stripe webhook in the Stripe Dashboard:');
    console.log('   - Endpoint URL: https://your-domain.com/api/v1/gifts/tokens/webhook');
    console.log('   - Events to listen for: checkout.session.completed');
    console.log('2. Copy the webhook signing secret to STRIPE_WEBHOOK_SECRET in .env');
    console.log('3. Test with Stripe test mode before going live');

  } catch (error) {
    console.error('Error setting up Stripe products:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
