/**
 * Billing Routes
 * Subscription management and payment processing via Stripe.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';
import { getUsersRepository } from '../repositories/index.js';
import { getAffiliatesService } from '../services/affiliates.js';
import {
  isStripeConfigured,
  createSubscriptionSession,
  verifyWebhookSignature,
} from '../utils/stripe.js';
import type Stripe from 'stripe';
import type { PlanTier } from '../db/types.js';

/**
 * Request schemas
 */
const CreateSessionSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

/**
 * Register billing routes
 */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /billing/session - Create a Stripe subscription session
   * Returns a sessionId and URL for redirecting to Stripe Checkout.
   */
  app.post('/session', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.createSession', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Validate request body
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

      const { priceId, successUrl, cancelUrl } = parseResult.data;

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

      logger.info(
        { userId: user.userId, priceId },
        'Subscription session creation requested'
      );

      // Create Stripe subscription session
      const referenceId = `sub_${nanoid()}`;
      const session = await createSubscriptionSession({
        priceId,
        customerEmail: user.email,
        successUrl,
        cancelUrl,
        metadata: {
          userId: user.userId,
          referenceId,
          priceId,
        },
      });

      span.setAttributes({
        'stripe.session_id': session.sessionId,
        'stripe.reference_id': referenceId,
      });

      // Emit billing.session_started event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: 'billing',
        turnId: null,
        traceId: request.id,
        type: 'billing.session_started',
        payload: {
          priceId,
          stripeSessionId: session.sessionId,
          referenceId,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      // Return session URL for redirect to Stripe Checkout
      return reply.status(201).send({
        success: true,
        data: {
          sessionId: session.sessionId,
          url: session.url,
          referenceId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        },
      });
    });
  });

  /**
   * POST /billing/webhook - Handle Stripe webhook events
   */
  app.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.handleWebhook', async (span) => {
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

      // Store webhook event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId: 'system',
        sessionId: 'billing',
        turnId: null,
        traceId: request.id,
        type: `stripe.${event.type}`,
        payload: event.data.object as unknown as Record<string, unknown>,
        version: '1.0',
        causationId: null,
        correlationId: event.id,
      });

      // Handle specific event types
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;

          // Check if this is a subscription (not a one-time payment)
          if (session.mode === 'subscription') {
            logger.info({ sessionId: session.id, subscriptionId: session.subscription }, 'Subscription created');

            // Handle affiliate conversion tracking
            const userId = session.metadata?.userId;
            const planTier = (session.metadata?.planTier || 'standard') as PlanTier;

            if (userId) {
              try {
                const usersRepo = getUsersRepository();
                const affiliateInfo = await usersRepo.getUserAffiliateInfo(userId);

                if (affiliateInfo?.affiliate_id) {
                  const affiliatesService = getAffiliatesService();
                  await affiliatesService.createConversion(
                    userId,
                    affiliateInfo.affiliate_id,
                    affiliateInfo.affiliate_click_id ?? null,
                    planTier,
                    session.id
                  );

                  logger.info(
                    { userId, affiliateId: affiliateInfo.affiliate_id, planTier },
                    'Affiliate conversion created from subscription'
                  );
                }
              } catch (convError) {
                // Don't fail webhook if conversion tracking fails
                logger.error({ error: convError, userId }, 'Failed to create affiliate conversion');
              }
            }
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice;
          logger.info({ invoiceId: invoice.id }, 'Subscription payment successful');
          break;
        }

        case 'customer.subscription.deleted':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          logger.info({ subscriptionId: subscription.id, status: subscription.status }, 'Subscription status changed');
          break;
        }

        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge;
          logger.warn({ chargeId: charge.id }, 'Charge refunded');
          break;
        }

        default:
          logger.debug({ eventType: event.type }, 'Unhandled Stripe event type');
      }

      // Acknowledge receipt
      return reply.send({ received: true });
    });
  });

  /**
   * GET /billing/subscription - Get current subscription status
   */
  app.get('/subscription', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.getSubscription', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // TODO: Fetch subscription from database
      // - Get subscription record for user
      // - Include plan details, status, period info

      logger.debug({ userId: user.userId }, 'Fetching subscription');

      // Stub response
      return reply.send({
        success: true,
        data: {
          id: null,
          status: 'free',
          plan: 'free',
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          usage: {
            conversations: 0,
            maxConversations: 10,
            tokens: 0,
            maxTokens: 50000,
          },
        },
      });
    });
  });

  /**
   * GET /billing/invoices - List user's invoices
   * Note: Flowguard doesn't have a built-in invoice API - this returns transaction history
   */
  app.get('/invoices', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.listInvoices', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { limit = '10' } = request.query as { limit?: string };

      // TODO: Fetch transaction history from database
      // - Get billing events for user
      // - Format as invoice-like entries

      logger.debug({ userId: user.userId }, 'Fetching invoices');

      // Stub response
      return reply.send({
        success: true,
        data: {
          items: [],
          hasMore: false,
        },
      });
    });
  });

  /**
   * GET /billing/usage - Get current usage statistics
   */
  app.get('/usage', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.getUsage', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // TODO: Calculate usage from event store
      // - Count sessions in current billing period
      // - Sum token usage
      // - Calculate costs

      logger.debug({ userId: user.userId }, 'Fetching usage');

      // Stub response
      return reply.send({
        success: true,
        data: {
          period: {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            end: new Date().toISOString(),
          },
          usage: {
            sessions: 0,
            messages: 0,
            inputTokens: 0,
            outputTokens: 0,
            audioMinutes: 0,
          },
          costs: {
            llm: 0,
            tts: 0,
            stt: 0,
            total: 0,
          },
        },
      });
    });
  });
}
