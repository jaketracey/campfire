/**
 * Stripe Client
 * Payment processing integration for token purchases and subscriptions.
 */

import Stripe from 'stripe';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';

// ============================================================================
// Configuration
// ============================================================================

let stripeClient: Stripe | null = null;

/**
 * Get initialized Stripe client
 */
export function getStripeClient(): Stripe {
  if (!stripeClient) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }

  return stripeClient;
}

/**
 * Check if Stripe is configured (has required credentials).
 */
export function isStripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

// ============================================================================
// Checkout Sessions
// ============================================================================

export interface CreateCheckoutSessionParams {
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
  mode?: 'payment' | 'subscription';
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for one-time purchases
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  logger.info(
    { priceId: params.priceId, mode: params.mode || 'payment' },
    'Creating Stripe Checkout Session'
  );

  const session = await stripe.checkout.sessions.create({
    mode: params.mode || 'payment',
    line_items: [
      {
        price: params.priceId,
        quantity: params.quantity,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
    metadata: params.metadata,
    payment_intent_data: params.mode === 'payment' ? {
      metadata: params.metadata,
    } : undefined,
  });

  logger.info(
    { sessionId: session.id, priceId: params.priceId },
    'Stripe Checkout Session created'
  );

  return {
    sessionId: session.id,
    url: session.url!,
  };
}

// ============================================================================
// Subscriptions
// ============================================================================

export interface CreateSubscriptionParams {
  priceId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  trialPeriodDays?: number;
}

/**
 * Create a Stripe Checkout Session for subscription
 */
export async function createSubscriptionSession(
  params: CreateSubscriptionParams
): Promise<CheckoutSessionResult> {
  return createCheckoutSession({
    priceId: params.priceId,
    quantity: 1,
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    customerEmail: params.customerEmail,
    metadata: params.metadata,
    mode: 'subscription',
  });
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean = true
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();

  logger.info({ subscriptionId, cancelAtPeriodEnd }, 'Cancelling Stripe subscription');

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });

  logger.info({ subscriptionId, status: subscription.status }, 'Stripe subscription cancelled');

  return subscription;
}

// ============================================================================
// Products & Prices
// ============================================================================

export interface CreateProductParams {
  name: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface CreatePriceParams {
  productId: string;
  unitAmount: number;
  currency: string;
  metadata?: Record<string, string>;
  recurring?: {
    interval: 'month' | 'year';
    intervalCount?: number;
  };
}

/**
 * Create a Stripe product
 */
export async function createProduct(params: CreateProductParams): Promise<Stripe.Product> {
  const stripe = getStripeClient();

  logger.info({ name: params.name }, 'Creating Stripe product');

  const product = await stripe.products.create({
    name: params.name,
    description: params.description,
    metadata: params.metadata,
  });

  logger.info({ productId: product.id, name: params.name }, 'Stripe product created');

  return product;
}

/**
 * Create a Stripe price
 */
export async function createPrice(params: CreatePriceParams): Promise<Stripe.Price> {
  const stripe = getStripeClient();

  logger.info({ productId: params.productId, amount: params.unitAmount }, 'Creating Stripe price');

  const price = await stripe.prices.create({
    product: params.productId,
    unit_amount: params.unitAmount,
    currency: params.currency,
    metadata: params.metadata,
    recurring: params.recurring,
  });

  logger.info({ priceId: price.id, productId: params.productId }, 'Stripe price created');

  return price;
}

// ============================================================================
// Webhook Verification
// ============================================================================

/**
 * Verify a Stripe webhook signature
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripeClient();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for webhook verification');
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );

    logger.debug({ eventType: event.type, eventId: event.id }, 'Stripe webhook verified');

    return event;
  } catch (error) {
    logger.error({ error }, 'Stripe webhook signature verification failed');
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a Checkout Session by ID
 */
export async function getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Get a Payment Intent by ID
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Get a Subscription by ID
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * List all products
 */
export async function listProducts(): Promise<Stripe.Product[]> {
  const stripe = getStripeClient();
  const products = await stripe.products.list({ active: true });
  return products.data;
}

/**
 * List all prices for a product
 */
export async function listPrices(productId?: string): Promise<Stripe.Price[]> {
  const stripe = getStripeClient();
  const prices = await stripe.prices.list({
    active: true,
    product: productId,
  });
  return prices.data;
}
