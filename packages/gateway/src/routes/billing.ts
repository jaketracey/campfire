/**
 * Billing Routes
 * Subscription management and payment processing via Stripe.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';

/**
 * Request schemas
 */
const CreateCheckoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const WebhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});

/**
 * Register billing routes
 */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /billing/checkout - Create a Stripe checkout session
   */
  app.post('/checkout', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.createCheckout', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      // Validate request body
      const parseResult = CreateCheckoutSchema.safeParse(request.body);
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

      // TODO: Implement Stripe integration
      // - Get or create Stripe customer for user
      // - Create Stripe checkout session
      // - Return checkout URL

      logger.info(
        { userId: user.userId, priceId },
        'Checkout session creation requested'
      );

      // Emit billing.checkout_started event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: 'billing',
        turnId: null,
        traceId: request.id,
        type: 'billing.checkout_started',
        payload: {
          priceId,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      // Stub response - would return actual Stripe checkout URL
      return reply.status(201).send({
        success: true,
        data: {
          checkoutUrl: `https://checkout.stripe.com/c/pay/stub_${nanoid()}`,
          sessionId: `cs_${nanoid()}`,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        },
      });
    });
  });

  /**
   * POST /billing/webhook - Handle Stripe webhook events
   */
  app.post('/webhook', {
    config: {
      rawBody: true, // Need raw body for signature verification
    } as Record<string, unknown>,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.handleWebhook', async (span) => {
      // Verify Stripe signature
      const signature = request.headers['stripe-signature'] as string | undefined;
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

      // TODO: Verify signature with Stripe webhook secret
      // const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
      // const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);

      // Parse event payload
      const parseResult = WebhookEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.flatten() }, 'Invalid webhook payload');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid webhook payload',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const event = parseResult.data;
      span.setAttributes({ 'stripe.event_type': event.type, 'stripe.event_id': event.id });

      logger.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');

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
        payload: event.data.object,
        version: '1.0',
        causationId: null,
        correlationId: event.id,
      });

      // Handle specific event types
      switch (event.type) {
        case 'checkout.session.completed':
          // TODO: Activate subscription
          logger.info({ eventId: event.id }, 'Checkout completed');
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          // TODO: Update subscription status
          logger.info({ eventId: event.id }, 'Subscription updated');
          break;

        case 'customer.subscription.deleted':
          // TODO: Handle subscription cancellation
          logger.info({ eventId: event.id }, 'Subscription deleted');
          break;

        case 'invoice.paid':
          // TODO: Record payment
          logger.info({ eventId: event.id }, 'Invoice paid');
          break;

        case 'invoice.payment_failed':
          // TODO: Handle failed payment
          logger.warn({ eventId: event.id }, 'Payment failed');
          break;

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
   * POST /billing/portal - Create Stripe customer portal session
   */
  app.post('/portal', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.createPortal', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const schema = z.object({
        returnUrl: z.string().url(),
      });

      const parseResult = schema.safeParse(request.body);
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

      const { returnUrl } = parseResult.data;

      // TODO: Implement Stripe customer portal
      // - Get Stripe customer ID for user
      // - Create portal session
      // - Return portal URL

      logger.info({ userId: user.userId }, 'Customer portal requested');

      // Stub response
      return reply.send({
        success: true,
        data: {
          portalUrl: `https://billing.stripe.com/p/session/stub_${nanoid()}`,
        },
      });
    });
  });

  /**
   * GET /billing/invoices - List user's invoices
   */
  app.get('/invoices', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.listInvoices', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { limit = '10' } = request.query as { limit?: string };

      // TODO: Fetch invoices from Stripe
      // - Get Stripe customer ID for user
      // - List invoices from Stripe API

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
