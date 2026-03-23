# Stripe Migration Guide

## ✅ Completed

The codebase has been migrated from Flowguard to Stripe:

1. ✅ Installed Stripe SDK (`stripe` package)
2. ✅ Added Stripe environment variables to env schema
3. ✅ Created `/packages/gateway/src/utils/stripe.ts` - Stripe integration utility
4. ✅ Updated `/packages/gateway/src/routes/gift-tokens.ts` - Token purchases now use Stripe Checkout
5. ✅ Updated `/packages/gateway/src/routes/billing.ts` - Subscriptions now use Stripe
6. ✅ Updated `/packages/gateway/src/repositories/gifts.ts` - Database calls now use Stripe column names
7. ✅ Created setup script at `/packages/gateway/src/scripts/setup-stripe-products.ts`

## 🔧 Configuration Required

### 1. Set Stripe API Keys

Add these to your `.env` file (or environment):

```bash
# Get these from: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_...  # Use sk_live_... for production
STRIPE_PUBLISHABLE_KEY=pk_test_...  # For frontend (optional)

# Get this after creating webhook endpoint (step 3)
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 2. Create Stripe Products & Prices

Run the setup script to create your token bundle products in Stripe:

```bash
cd packages/gateway
tsx src/scripts/setup-stripe-products.ts
```

This will:
- Create 4 products (Starter Pack, Popular Pack, Best Value, Ultimate Pack)
- Create prices for each product
- Output the product/price IDs to update your seed file

### 3. Configure Stripe Webhooks

In your [Stripe Dashboard](https://dashboard.stripe.com/webhooks):

1. Click "Add endpoint"
2. Set endpoint URL:
   - **Development**: Use [Stripe CLI](https://stripe.com/docs/stripe-cli) for local testing
   - **Production**: `https://your-domain.com/api/v1/gifts/tokens/webhook`
3. Select events to listen to:
   - `checkout.session.completed` (for token purchases)
   - `customer.subscription.created` (for subscriptions)
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. Copy the webhook signing secret and set as `STRIPE_WEBHOOK_SECRET`

### 4. Update Seed File (Optional)

After running the setup script, update `/packages/gateway/src/db/seed.ts` with the real Stripe IDs.

The setup script will output the exact code to copy.

### 5. Test the Integration

#### Local Testing with Stripe CLI

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3001/api/v1/gifts/tokens/webhook

# Use test mode API keys in your .env
```

#### Test Token Purchase

```bash
# Create a test purchase session
curl -X POST http://localhost:3001/api/v1/gifts/tokens/session \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bundleId": "BUNDLE_UUID",
    "successUrl": "http://localhost:3000/success",
    "cancelUrl": "http://localhost:3000/cancel"
  }'

# This returns a Stripe Checkout Session URL
# Visit the URL and use test card: 4242 4242 4242 4242
```

#### Test Cards

- Success: `4242 4242 4242 4242`
- Declined: `4000 0000 0000 0002`
- Requires authentication: `4000 0025 0000 3155`

Any future expiry date and any CVC.

## 📊 Database Migration Status

The database was already migrated (migration 061):
- ✅ `stripe_checkout_session_id` column exists
- ✅ `stripe_payment_intent_id` column exists
- ✅ `stripe_product_id` column exists
- ✅ `stripe_price_id` column exists
- ✅ `credit_tokens()` function updated

## 🔄 API Changes

### Token Purchase Endpoint

**Before (Flowguard):**
```json
POST /api/v1/gifts/tokens/session
Response: {
  "sessionId": "fg_session_...",
  "referenceId": "tok_..."
}
```

**After (Stripe):**
```json
POST /api/v1/gifts/tokens/session
Response: {
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay/...",
  "referenceId": "tok_..."
}
```

**Frontend Change Required:**
- Old: Embedded Flowguard payment form
- New: Redirect to `session.url` for Stripe Checkout

### Webhook Endpoint

**Changed:**
- Old: `POST /api/v1/gifts/tokens/postback` (Flowguard)
- New: `POST /api/v1/gifts/tokens/webhook` (Stripe)

## 🚨 Known Issues Fixed

1. ✅ **500 Error on `/api/v1/gifts/tokens/session`**
   - **Cause**: Code was checking for `FLOWGUARD_SHOP_ID` which wasn't configured
   - **Fix**: Now checks for `STRIPE_SECRET_KEY` instead

2. ✅ **Database column mismatch**
   - **Cause**: DB had `stripe_*` columns but code was using `flowguard_*`
   - **Fix**: Updated repository and routes to use Stripe columns

## 📝 Next Steps

1. [ ] Set `STRIPE_SECRET_KEY` in your environment
2. [ ] Run `tsx src/scripts/setup-stripe-products.ts`
3. [ ] Update seed file with real Stripe IDs (output from script)
4. [ ] Configure Stripe webhook endpoint
5. [ ] Set `STRIPE_WEBHOOK_SECRET` in your environment
6. [ ] Update frontend to redirect to Stripe Checkout URL
7. [ ] Test token purchase flow end-to-end

## 💡 Production Deployment

When deploying to production:

1. Use live API keys (`sk_live_...` not `sk_test_...`)
2. Configure production webhook endpoint in Stripe Dashboard
3. Update `STRIPE_WEBHOOK_SECRET` with production webhook secret
4. Test with real card in test mode first!
5. Monitor Stripe Dashboard for successful payments

## 🔗 Resources

- [Stripe Checkout Documentation](https://stripe.com/docs/payments/checkout)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
- [Stripe Testing](https://stripe.com/docs/testing)
