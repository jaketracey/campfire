#!/usr/bin/env tsx
/**
 * Stripe Products Setup Script
 *
 * Creates token bundle products and prices in Stripe.
 * Run this script after configuring STRIPE_SECRET_KEY in your environment.
 *
 * Usage:
 *   tsx src/scripts/setup-stripe-products.ts
 */

import { getStripeClient, isStripeConfigured } from '../utils/stripe.js';
import { logger } from '../observability/logger.js';

interface TokenBundle {
  name: string;
  description: string;
  tokens: number;
  bonusTokens: number;
  priceCents: number;
  currency: string;
}

const TOKEN_BUNDLES: TokenBundle[] = [
  {
    name: 'Starter Pack',
    description: 'Perfect for trying out gifts with your companion.',
    tokens: 100,
    bonusTokens: 0,
    priceCents: 499,
    currency: 'usd',
  },
  {
    name: 'Popular Pack',
    description: 'Our most popular choice! Great value with bonus tokens.',
    tokens: 500,
    bonusTokens: 50,
    priceCents: 1999,
    currency: 'usd',
  },
  {
    name: 'Best Value',
    description: 'The best value for dedicated gift-givers.',
    tokens: 1200,
    bonusTokens: 200,
    priceCents: 3999,
    currency: 'usd',
  },
  {
    name: 'Ultimate Pack',
    description: 'For the ultimate companion experience. Maximum savings!',
    tokens: 3000,
    bonusTokens: 600,
    priceCents: 7999,
    currency: 'usd',
  },
];

async function setupStripeProducts() {
  if (!isStripeConfigured()) {
    console.error('❌ Stripe is not configured. Please set STRIPE_SECRET_KEY in your environment.');
    process.exit(1);
  }

  const stripe = getStripeClient();

  console.log('🚀 Setting up Stripe products for token bundles...\n');

  const results: Array<{
    name: string;
    productId: string;
    priceId: string;
    tokens: number;
    bonusTokens: number;
    priceCents: number;
  }> = [];

  for (const bundle of TOKEN_BUNDLES) {
    try {
      console.log(`📦 Creating product: ${bundle.name}...`);

      // Check if product already exists by name
      const existingProducts = await stripe.products.search({
        query: `name:'${bundle.name}'`,
      });

      let productId: string;

      if (existingProducts.data.length > 0) {
        productId = existingProducts.data[0]!.id;
        console.log(`   ✓ Product already exists: ${productId}`);
      } else {
        // Create product
        const product = await stripe.products.create({
          name: bundle.name,
          description: bundle.description,
          metadata: {
            tokens: bundle.tokens.toString(),
            bonusTokens: bundle.bonusTokens.toString(),
            totalTokens: (bundle.tokens + bundle.bonusTokens).toString(),
          },
        });

        productId = product.id;
        console.log(`   ✓ Product created: ${productId}`);
      }

      // Check if price already exists for this product
      const existingPrices = await stripe.prices.list({
        product: productId,
        active: true,
      });

      let priceId: string;

      const matchingPrice = existingPrices.data.find(
        (p) => p.unit_amount === bundle.priceCents && p.currency === bundle.currency
      );

      if (matchingPrice) {
        priceId = matchingPrice.id;
        console.log(`   ✓ Price already exists: ${priceId}`);
      } else {
        // Create price
        const price = await stripe.prices.create({
          product: productId,
          unit_amount: bundle.priceCents,
          currency: bundle.currency,
          metadata: {
            tokens: bundle.tokens.toString(),
            bonusTokens: bundle.bonusTokens.toString(),
          },
        });

        priceId = price.id;
        console.log(`   ✓ Price created: ${priceId} ($${(bundle.priceCents / 100).toFixed(2)})`);
      }

      results.push({
        name: bundle.name,
        productId,
        priceId,
        tokens: bundle.tokens,
        bonusTokens: bundle.bonusTokens,
        priceCents: bundle.priceCents,
      });

      console.log('');
    } catch (error) {
      console.error(`   ❌ Failed to create ${bundle.name}:`, error);
      process.exit(1);
    }
  }

  console.log('✅ All products and prices created successfully!\n');
  console.log('📋 Summary:');
  console.log('=' .repeat(80));

  for (const result of results) {
    const totalTokens = result.tokens + result.bonusTokens;
    console.log(`\n${result.name}`);
    console.log(`  Product ID: ${result.productId}`);
    console.log(`  Price ID:   ${result.priceId}`);
    console.log(`  Tokens:     ${result.tokens} + ${result.bonusTokens} bonus = ${totalTokens} total`);
    console.log(`  Price:      $${(result.priceCents / 100).toFixed(2)}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 Next steps:');
  console.log('   1. Update your seed file (packages/gateway/src/db/seed.ts) with these IDs');
  console.log('   2. Run: pnpm db:seed');
  console.log('   3. Configure webhook endpoint in Stripe Dashboard:');
  console.log('      - URL: https://your-domain.com/api/v1/gifts/tokens/webhook');
  console.log('      - Events: checkout.session.completed');
  console.log('   4. Set STRIPE_WEBHOOK_SECRET in your environment\n');

  // Generate seed file snippet
  console.log('📝 Copy this to your seed file:\n');
  console.log('const tokenBundles = [');
  for (const result of results) {
    const totalTokens = result.tokens + result.bonusTokens;
    console.log(`  {`);
    console.log(`    name: '${result.name}',`);
    console.log(`    description: '${TOKEN_BUNDLES.find(b => b.name === result.name)!.description}',`);
    console.log(`    tokens: ${result.tokens},`);
    console.log(`    price_cents: ${result.priceCents},`);
    console.log(`    currency: 'usd',`);
    console.log(`    stripe_price_id: '${result.priceId}',`);
    console.log(`    stripe_product_id: '${result.productId}',`);
    console.log(`    display_order: ${results.indexOf(result) + 1},`);
    console.log(`    bonus_tokens: ${result.bonusTokens},`);
    console.log(`  },`);
  }
  console.log('];\n');
}

setupStripeProducts().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
