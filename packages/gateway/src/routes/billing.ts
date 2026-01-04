/**
 * Billing Routes
 * Subscription management and payment processing via Flowguard.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getEventStore } from '../db/event-store.js';
import { getUsersRepository } from '../repositories/index.js';
import { getAffiliatesService } from '../services/affiliates.js';
import {
  isFlowguardConfigured,
  startSubscriptionSession,
  verifyPostbackSignature,
  parsePostback,
  type FlowguardPostback,
} from '../utils/flowguard.js';
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
   * POST /billing/session - Create a Flowguard subscription session
   * Returns a sessionId for use with the Flowguard frontend SDK.
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

      // Check if Flowguard is configured
      if (!isFlowguardConfigured()) {
        logger.error('Flowguard is not configured - FLOWGUARD_SHOP_ID or FLOWGUARD_SIGNATURE_KEY missing');
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

      // Create Flowguard subscription session
      const referenceId = `sub_${nanoid()}`;
      const apiBaseUrl = process.env.API_BASE_URL || 'https://ignite.cam';
      const postbackUrl = `${apiBaseUrl}/api/v1/billing/postback`;
      const session = await startSubscriptionSession({
        subscriptionType: 'recurring',
        period: 'P1M', // Monthly
        priceAmount: 9.99, // TODO: Look up from price catalog
        priceCurrency: 'USD',
        description: 'Campfire Premium Subscription',
        referenceId,
        custom1: user.userId,
        custom2: priceId,
        successUrl,
        declineUrl: cancelUrl,
        postbackUrl,
        email: user.email,
      });

      span.setAttributes({
        'flowguard.session_id': session.sessionId,
        'flowguard.reference_id': referenceId,
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
          flowguardSessionId: session.sessionId,
          referenceId,
        },
        version: '1.0',
        causationId: null,
        correlationId: request.id,
      });

      // Return sessionId for frontend SDK
      return reply.status(201).send({
        success: true,
        data: {
          sessionId: session.sessionId,
          referenceId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        },
      });
    });
  });

  /**
   * POST /billing/postback - Handle Flowguard postback events
   */
  app.post('/postback', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('billing.handlePostback', async (span) => {
      // Parse postback payload
      let postback: FlowguardPostback;
      try {
        postback = parsePostback(request.body as Record<string, unknown>);
      } catch (error) {
        logger.warn({ error, body: request.body }, 'Invalid postback payload');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid postback payload',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify signature
      if (!verifyPostbackSignature(postback)) {
        logger.warn({ transactionId: postback.transactionId }, 'Invalid postback signature');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Invalid postback signature',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({
        'flowguard.event': postback.event,
        'flowguard.transaction_id': postback.transactionId,
        'flowguard.subscription_id': postback.subscriptionId ?? 'none',
      });

      logger.info(
        { event: postback.event, transactionId: postback.transactionId, subscriptionId: postback.subscriptionId },
        'Flowguard postback received'
      );

      // Store postback event
      const eventStore = getEventStore();
      await eventStore.append({
        eventId: nanoid(),
        timestamp: new Date().toISOString(),
        userId: postback.custom1 ?? 'system', // custom1 contains userId
        sessionId: 'billing',
        turnId: null,
        traceId: request.id,
        type: `flowguard.${postback.event}`,
        payload: postback as unknown as Record<string, unknown>,
        version: '1.0',
        causationId: null,
        correlationId: postback.transactionId,
      });

      // Handle specific event types
      switch (postback.event) {
        case 'subscription:initial': {
          // New subscription created and initial payment successful
          logger.info({ transactionId: postback.transactionId, subscriptionId: postback.subscriptionId }, 'Subscription created');

          // Handle affiliate conversion tracking
          const userId = postback.custom1;
          const planTier = (postback.custom2 || 'standard') as PlanTier;

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
                  postback.transactionId
                );

                logger.info(
                  { userId, affiliateId: affiliateInfo.affiliate_id, planTier },
                  'Affiliate conversion created from subscription'
                );
              }
            } catch (convError) {
              // Don't fail postback if conversion tracking fails
              logger.error({ error: convError, userId }, 'Failed to create affiliate conversion');
            }
          }
          break;
        }

        case 'subscription:rebill':
          // Recurring payment successful
          logger.info({ transactionId: postback.transactionId, subscriptionId: postback.subscriptionId }, 'Subscription rebill successful');
          break;

        case 'subscription:cancel':
          // Subscription cancelled
          logger.info({ transactionId: postback.transactionId, subscriptionId: postback.subscriptionId }, 'Subscription cancelled');
          break;

        case 'subscription:expire':
          // Subscription expired
          logger.info({ transactionId: postback.transactionId, subscriptionId: postback.subscriptionId }, 'Subscription expired');
          break;

        case 'credit':
          // Refund/credit issued
          logger.warn({ transactionId: postback.transactionId }, 'Credit/refund issued');
          break;

        default:
          logger.debug({ event: postback.event }, 'Unhandled Flowguard event type');
      }

      // Acknowledge receipt - Flowguard expects "OK" response
      return reply.send({ received: true, status: 'OK' });
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
