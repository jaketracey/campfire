/**
 * Gift Token Routes
 * Token balance, bundles, purchase sessions, and Stripe webhooks.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getEventStore } from '../db/event-store.js';
import {
  isStripeConfigured,
  createCheckoutSession,
  verifyWebhookSignature,
} from '../utils/stripe.js';
import type Stripe from 'stripe';

// ============================================================================
// Request Schemas
// ============================================================================

const CreateSessionSchema = z.object({
  bundleId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register gift token routes
 */
export async function giftTokensRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const eventStore = getEventStore();

  // ==========================================================================
  // Token Endpoints (User-facing)
  // ==========================================================================

  /**
   * GET /gifts/tokens/balance - Get user's token balance
   */
  app.get('/tokens/balance', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getTokenBalance', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const balance = await giftsRepo.getOrCreateTokenBalance(user.userId);

      return reply.send({
        success: true,
        data: {
          balance: balance.balance,
          lifetimePurchased: balance.lifetime_purchased,
          lifetimeBonus: balance.lifetime_bonus,
          lifetimeSpent: balance.lifetime_spent,
          currentPeriodBonus: balance.current_period_bonus,
          bonusGrantedAt: balance.bonus_granted_at?.toISOString() ?? null,
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/bundles - Get available token bundles
   */
  app.get('/tokens/bundles', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenBundles', async () => {
      const bundles = await giftsRepo.listActiveBundles();

      return reply.send({
        success: true,
        data: bundles.map(bundle => ({
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          tokens: bundle.tokens,
          priceCents: bundle.price_cents,
          currency: bundle.currency,
          bonusTokens: bundle.bonus_tokens,
          totalTokens: bundle.tokens + bundle.bonus_tokens,
          displayOrder: bundle.display_order,
        })),
      });
    });
  });

  /**
   * POST /gifts/tokens/session - Create Stripe Checkout Session for token purchase
   * Returns a sessionId and URL for redirecting to Stripe Checkout.
   */
  app.post('/tokens/session', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.createTokenSession', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = CreateSessionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { bundleId, successUrl, cancelUrl } = parseResult.data;

      // Get bundle
      const bundle = await giftsRepo.findBundleById(bundleId);
      if (!bundle) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'BUNDLE_NOT_FOUND',
            message: 'Token bundle not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!bundle.is_active) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BUNDLE_INACTIVE',
            message: 'Token bundle is no longer available',
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.info({ userId: user.userId, bundleId, tokens: bundle.tokens }, 'Token session requested');

      // Check if Stripe is configured
      if (!isStripeConfigured()) {
        logger.error('Stripe is not configured - STRIPE_SECRET_KEY missing');
        return reply.status(503).send({
          success: false,
          error: {
            code: 'PAYMENT_UNAVAILABLE',
            message: 'Payment processing is not available',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const totalTokens = bundle.tokens + bundle.bonus_tokens;

      // Verify bundle has Stripe price ID
      if (!bundle.stripe_price_id) {
        logger.error({ bundleId }, 'Bundle missing Stripe price ID');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'BUNDLE_NOT_CONFIGURED',
            message: 'Bundle is not configured for payment processing',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Create Stripe Checkout Session
      const referenceId = `tok_${nanoid()}`;
      const session = await createCheckoutSession({
        priceId: bundle.stripe_price_id,
        quantity: 1,
        successUrl,
        cancelUrl,
        customerEmail: user.email,
        metadata: {
          userId: user.userId,
          bundleId,
          referenceId,
          tokens: bundle.tokens.toString(),
          bonusTokens: bundle.bonus_tokens.toString(),
          totalTokens: totalTokens.toString(),
        },
      });

      span.setAttributes({
        'stripe.session_id': session.sessionId,
        'stripe.reference_id': referenceId,
        'bundle.tokens': bundle.tokens,
        'bundle.bonus_tokens': bundle.bonus_tokens,
      });

      // Emit session started event
      const sessionTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: sessionTraceId,
        type: 'gifts.session_started',
        payload: {
          bundleId,
          tokens: bundle.tokens,
          bonusTokens: bundle.bonus_tokens,
          priceCents: bundle.price_cents,
          stripeSessionId: session.sessionId,
          referenceId,
        },
        version: '1.0',
        causationId: null,
        correlationId: sessionTraceId,
      });

      logger.info(
        { userId: user.userId, bundleId, stripeSessionId: session.sessionId, totalTokens },
        'Stripe Checkout Session created'
      );

      // Return session URL for redirect to Stripe Checkout
      return reply.status(201).send({
        success: true,
        data: {
          sessionId: session.sessionId,
          url: session.url,
          referenceId,
          bundle: {
            id: bundle.id,
            name: bundle.name,
            tokens: bundle.tokens,
            bonusTokens: bundle.bonus_tokens,
            totalTokens,
            priceCents: bundle.price_cents,
          },
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/transactions - List user's token transactions
   */
  app.get('/tokens/transactions', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenTransactions', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      const result = await giftsRepo.listTokenTransactions(user.userId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data.map(tx => ({
            id: tx.id,
            type: tx.transaction_type,
            amount: tx.amount,
            balanceAfter: tx.balance_after,
            description: tx.description,
            giftId: tx.gift_id,
            createdAt: tx.created_at.toISOString(),
          })),
          hasMore: result.hasMore,
        },
      });
    });
  });

  /**
   * POST /gifts/tokens/webhook - Handle Stripe webhook for token purchases
   * This endpoint receives webhooks from Stripe when a purchase completes.
   * It verifies the signature and credits tokens to the user's account.
   */
  app.post('/tokens/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.handleTokenWebhook', async (span) => {
      // Get Stripe signature from headers
      const signature = request.headers['stripe-signature'] as string;
      if (!signature) {
        logger.warn('Missing Stripe signature header');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MISSING_SIGNATURE',
            message: 'Missing Stripe signature',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify webhook signature
      let event: Stripe.Event;
      try {
        const rawBody = (request as unknown as { rawBody: string | Buffer }).rawBody;
        event = verifyWebhookSignature(rawBody, signature);
      } catch (error) {
        logger.warn({ error }, 'Invalid webhook signature');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Invalid webhook signature',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({
        'stripe.event_type': event.type,
        'stripe.event_id': event.id,
      });

      logger.info(
        { eventType: event.type, eventId: event.id },
        'Stripe webhook received'
      );

      // Handle checkout.session.completed event
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        // Extract metadata
        const userId = session.metadata?.userId;
        const bundleId = session.metadata?.bundleId;
        const totalTokens = parseInt(session.metadata?.totalTokens ?? '0', 10);

        if (!userId || !bundleId || totalTokens === 0) {
          logger.warn({ sessionId: session.id, metadata: session.metadata }, 'Missing metadata in webhook');
          return reply.send({ received: true });
        }

        span.setAttributes({
          'user.id': userId,
          'bundle.id': bundleId,
          'tokens.total': totalTokens,
        });

        // Use session ID as idempotency key to prevent duplicate credits
        const idempotencyKey = `stripe_${session.id}`;

        try {
          // Credit tokens using existing repository function
          const result = await giftsRepo.creditTokens(
            userId,
            totalTokens,
            'purchase',
            {
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: session.payment_intent as string,
              description: `Token purchase: ${totalTokens} tokens`,
              idempotencyKey,
              metadata: {
                bundleId,
                sessionId: session.id,
              },
            }
          );

          if (result.wasDuplicate) {
            logger.info(
              { userId, sessionId: session.id },
              'Duplicate token credit ignored (already processed)'
            );
          } else {
            logger.info(
              { userId, tokensAdded: totalTokens, newBalance: result.newBalance, transactionId: result.transactionId },
              'Tokens credited from Stripe purchase'
            );

            // Emit event for audit trail
            const eventTraceId = crypto.randomUUID();
            await eventStore.append({
              eventId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              userId,
              sessionId: null,
              turnId: null,
              traceId: eventTraceId,
              type: 'gifts.tokens_purchased',
              payload: {
                bundleId,
                tokensAdded: totalTokens,
                newBalance: result.newBalance,
                transactionId: result.transactionId,
                stripeSessionId: session.id,
                stripePaymentIntentId: session.payment_intent,
              },
              version: '1.0',
              causationId: null,
              correlationId: session.id,
            });
          }
        } catch (error) {
          logger.error(
            { error, userId, sessionId: session.id },
            'Failed to credit tokens from webhook'
          );
          // Return 200 to acknowledge receipt - Stripe will retry if we return error
          // But we log the error for manual investigation
        }
      }

      // Acknowledge receipt
      return reply.send({ received: true });
    });
  });
}
