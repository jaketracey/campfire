/**
 * Gifts Routes
 * Token management, gift generation, and gift memory handling.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type Stripe from 'stripe';
import { requireAuth, requireInternalService } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getGiftTemplatesRepository } from '../repositories/gift-templates.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { getBillingRepository } from '../repositories/billing.js';
import { getEventStore } from '../db/event-store.js';
import { ValidationError } from '../repositories/errors.js';
import { enqueueGiftGenerationJob } from '../utils/queue.js';
import { getStripe, isStripeConfigured } from '../utils/stripe.js';
import type { JSONObject } from '../db/types.js';

// ============================================================================
// Request Schemas
// ============================================================================

const CreateCheckoutSchema = z.object({
  bundleId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const GenerateGiftSchema = z.object({
  companionId: z.string().uuid(),
  preferredCost: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

const GenerateGiftFullSchema = z.object({
  companionId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visualPrompt: z.string().max(2000).optional(),
  emotionalMeaning: z.string().max(1000).optional(),
  tokenCost: z.number().int().positive(),
  generationParams: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceTurnId: z.string().uuid().optional(),
});

// Token cost tiers for AI-generated gifts
const GIFT_COST_TIERS = {
  low: 10,
  medium: 25,
  high: 50,
} as const;

const GiveGiftSchema = z.object({
  memoryContent: z.string().min(1).max(2000).optional(),
});

const InternalGenerateSchema = z.object({
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  visualPrompt: z.string().max(2000),
  emotionalMeaning: z.string().max(1000).optional(),
  tokenCost: z.number().int().positive(),
  generationParams: z.record(z.unknown()).optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceTurnId: z.string().uuid().optional(),
});

const InternalReceiveSchema = z.object({
  giftId: z.string().uuid(),
  imageUrl: z.string().url(),
  s3Bucket: z.string(),
  s3Key: z.string(),
});

const InternalUpdateGiftSchema = z.object({
  giftId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000),
  visualPrompt: z.string().max(2000),
  emotionalMeaning: z.string().max(1000),
  imageUrl: z.string().url(),
  s3Bucket: z.string(),
  s3Key: z.string(),
});

const InternalRecallCandidateSchema = z.object({
  userId: z.string().uuid(),
  companionId: z.string().uuid(),
  embedding: z.array(z.number()),
  limit: z.number().int().positive().max(10).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
});

const InternalRecallSchema = z.object({
  cooldownHours: z.number().positive().optional(),
});

const UpdateEmbeddingSchema = z.object({
  embedding: z.array(z.number()).length(1536),
});

// Gift template schemas
const ListTemplatesQuerySchema = z.object({
  category: z.enum([
    'romantic', 'friendship', 'celebration', 'comfort', 'gratitude',
    'playful', 'thoughtful', 'mystical', 'nature', 'artistic', 'other'
  ]).optional(),
  tier: z.enum(['low', 'medium', 'high']).optional(),
  sort: z.enum(['popular', 'trending', 'recent']).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).optional(),
});

const SendFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  companionId: z.string().uuid(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register gifts routes
 */
export async function giftsRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const templatesRepo = getGiftTemplatesRepository();
  const companionsRepo = getCompanionsRepository();
  const billingRepo = getBillingRepository();
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
   * POST /gifts/tokens/checkout - Create Stripe checkout session for token purchase
   */
  app.post('/tokens/checkout', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.createTokenCheckout', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

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

      logger.info({ userId: user.userId, bundleId, tokens: bundle.tokens }, 'Token checkout requested');

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

      // Validate bundle has Stripe price ID
      if (!bundle.stripe_price_id) {
        logger.error({ bundleId }, 'Bundle does not have Stripe price ID configured');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BUNDLE_NOT_CONFIGURED',
            message: 'Token bundle is not configured for purchase',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const stripe = getStripe();
      const totalTokens = bundle.tokens + bundle.bonus_tokens;

      // Get or create Stripe customer
      let stripeCustomerId: string;
      const existingSubscription = await billingRepo.findSubscriptionByUserId(user.userId);

      if (existingSubscription?.stripe_customer_id) {
        stripeCustomerId = existingSubscription.stripe_customer_id;
        span.setAttributes({ 'stripe.customer_id': stripeCustomerId, 'stripe.customer_new': false });
      } else {
        // Create new Stripe customer
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: {
            userId: user.userId,
            source: 'token_purchase',
          },
        });
        stripeCustomerId = customer.id;
        span.setAttributes({ 'stripe.customer_id': stripeCustomerId, 'stripe.customer_new': true });
        logger.info({ userId: user.userId, stripeCustomerId }, 'Created new Stripe customer for token purchase');
      }

      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price: bundle.stripe_price_id,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: user.userId,
          bundleId: bundle.id,
          tokens: bundle.tokens.toString(),
          bonusTokens: bundle.bonus_tokens.toString(),
          totalTokens: totalTokens.toString(),
          type: 'token_purchase',
        },
        payment_intent_data: {
          metadata: {
            userId: user.userId,
            bundleId: bundle.id,
            type: 'token_purchase',
          },
        },
      });

      span.setAttributes({
        'stripe.session_id': session.id,
        'bundle.tokens': bundle.tokens,
        'bundle.bonus_tokens': bundle.bonus_tokens,
      });

      // Emit checkout event
      const checkoutTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: checkoutTraceId,
        type: 'gifts.checkout_started',
        payload: {
          bundleId,
          tokens: bundle.tokens,
          bonusTokens: bundle.bonus_tokens,
          priceCents: bundle.price_cents,
          stripeSessionId: session.id,
          stripeCustomerId,
        },
        version: '1.0',
        causationId: null,
        correlationId: checkoutTraceId,
      });

      logger.info(
        { userId: user.userId, bundleId, stripeSessionId: session.id, totalTokens },
        'Stripe checkout session created'
      );

      return reply.status(201).send({
        success: true,
        data: {
          checkoutUrl: session.url,
          sessionId: session.id,
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
   * This endpoint receives webhooks from Stripe when a checkout session completes.
   * It verifies the signature and credits tokens to the user's account.
   */
  app.post('/tokens/webhook', {
    config: {
      rawBody: true,
    } as Record<string, unknown>,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.handleTokenWebhook', async (span) => {
      // Check if Stripe is configured
      if (!isStripeConfigured()) {
        logger.error('Stripe webhook received but Stripe is not configured');
        return reply.status(503).send({ error: 'Stripe not configured' });
      }

      const stripe = getStripe();
      const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

      if (!webhookSecret) {
        logger.error('STRIPE_WEBHOOK_SECRET not configured');
        return reply.status(500).send({ error: 'Webhook not configured' });
      }

      // Get Stripe signature header
      const signature = request.headers['stripe-signature'] as string | undefined;
      if (!signature) {
        logger.warn('Missing Stripe signature header');
        return reply.status(400).send({ error: 'Missing signature' });
      }

      // Verify signature and construct event
      let event: Stripe.Event;
      try {
        // Access raw body for signature verification
        const rawBody = (request as unknown as { rawBody: string | Buffer }).rawBody;
        if (!rawBody) {
          logger.error('Raw body not available for webhook verification');
          return reply.status(400).send({ error: 'Raw body not available' });
        }
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        logger.warn({ error: err }, 'Webhook signature verification failed');
        return reply.status(400).send({ error: 'Invalid signature' });
      }

      span.setAttributes({
        'stripe.event_type': event.type,
        'stripe.event_id': event.id,
      });

      logger.info({ eventType: event.type, eventId: event.id }, 'Token webhook received');

      // Handle checkout.session.completed event
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        // Only process payment mode sessions for token purchases
        if (session.mode !== 'payment') {
          logger.debug({ sessionId: session.id, mode: session.mode }, 'Ignoring non-payment checkout session');
          return reply.send({ received: true });
        }

        // Check if this is a token purchase (not a subscription)
        if (session.metadata?.type !== 'token_purchase') {
          logger.debug({ sessionId: session.id, type: session.metadata?.type }, 'Ignoring non-token checkout session');
          return reply.send({ received: true });
        }

        // Extract metadata
        const userId = session.metadata?.userId;
        const bundleId = session.metadata?.bundleId;
        const totalTokens = parseInt(session.metadata?.totalTokens ?? '0', 10);

        if (!userId || !bundleId || totalTokens === 0) {
          logger.warn({ sessionId: session.id, metadata: session.metadata }, 'Missing metadata in checkout session');
          return reply.send({ received: true });
        }

        span.setAttributes({
          'user.id': userId,
          'bundle.id': bundleId,
          'tokens.total': totalTokens,
        });

        // Use checkout session ID as idempotency key to prevent duplicate credits
        const idempotencyKey = `stripe_checkout_${session.id}`;

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
                checkoutSessionId: session.id,
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
              'Tokens credited from Stripe checkout'
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
                stripeCheckoutSessionId: session.id,
                stripePaymentIntentId: session.payment_intent,
              },
              version: '1.0',
              causationId: null,
              correlationId: event.id,
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

      // Return 200 to acknowledge receipt
      return reply.send({ received: true });
    });
  });

  // ==========================================================================
  // Gift Endpoints (User-facing)
  // ==========================================================================

  /**
   * POST /gifts/generate - Create a new AI-generated gift (starts generation)
   * This is the user-facing endpoint that takes just companionId and optional preferredCost.
   * The gift content will be AI-generated asynchronously.
   */
  app.post('/generate', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.generateGift', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = GenerateGiftSchema.safeParse(request.body);
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

      const { companionId, preferredCost = 'medium' } = parseResult.data;
      const tokenCost = GIFT_COST_TIERS[preferredCost];

      // Double-check UUID format (Zod should catch this, but be safe)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(companionId)) {
        logger.warn({ companionId }, 'Invalid companion ID format in generate gift request');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID format',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify companion ownership
      let companion;
      try {
        companion = await companionsRepo.findById(companionId);
      } catch (dbError) {
        // Handle ValidationError from repository (invalid UUID format)
        if (dbError instanceof ValidationError) {
          logger.warn({ companionId, error: dbError.message }, 'Invalid companion ID format in repository');
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_COMPANION_ID',
              message: 'Invalid companion ID format',
              timestamp: new Date().toISOString(),
            },
          });
        }
        logger.error({ companionId, error: dbError }, 'Database error looking up companion');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID',
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (!companion || companion.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Get companion name for placeholder
      const companionName = companion.spec?.identity?.name ?? 'your companion';

      // Check for existing generating gift for this user/companion
      const existingGifts = await giftsRepo.listUserGifts(user.userId, {
        companionId,
        status: ['generating'],
        limit: 1,
      });

      if (existingGifts.data.length > 0) {
        const existingGift = existingGifts.data[0];
        const ageMs = Date.now() - existingGift.created_at.getTime();
        const GENERATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

        if (ageMs < GENERATION_TIMEOUT_MS) {
          // Return the existing generating gift - don't create duplicates
          return reply.status(409).send({
            success: false,
            error: {
              code: 'GIFT_GENERATION_IN_PROGRESS',
              message: 'A gift is already being generated for this companion',
              timestamp: new Date().toISOString(),
            },
            data: {
              gift: {
                id: existingGift.id,
                status: existingGift.status,
                createdAt: existingGift.created_at.toISOString(),
              },
            },
          });
        } else {
          // Stale generation - mark as failed and allow new request
          logger.warn(
            { giftId: existingGift.id, ageMs },
            'Marking stale generating gift as failed'
          );
          await giftsRepo.updateGiftStatus(existingGift.id, 'failed');
        }
      }

      // Create the gift record with placeholder content (AI will generate the real content)
      const gift = await giftsRepo.createGift({
        user_id: user.userId,
        companion_id: companionId,
        name: `Gift for ${companionName}`,
        description: 'Generating your special gift...',
        visual_prompt: null,
        emotional_meaning: 'A heartfelt gift being created just for you',
        token_cost: tokenCost,
        status: 'generating',
        generation_params: { preferredCost, tier: preferredCost } as JSONObject,
        source_event_id: null,
        source_turn_id: null,
      });

      logger.info(
        { userId: user.userId, giftId: gift.id, companionId, tokenCost, tier: preferredCost },
        'Gift generation started'
      );

      // Emit gift.generation_started event (for audit trail)
      const eventTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: eventTraceId,
        type: 'gift.generation_started',
        payload: {
          giftId: gift.id,
          companionId,
          companionName,
          tokenCost,
          tier: preferredCost,
        },
        version: '1.0',
        causationId: null,
        correlationId: eventTraceId,
      });

      // Enqueue job for worker to generate gift content and image
      await enqueueGiftGenerationJob({
        giftId: gift.id,
        userId: user.userId,
        companionId,
        companionName,
        companionBackstory: undefined, // Backstory is stored in KG, not spec - worker can fetch if needed
        companionPersonality: companion.spec?.personality?.traits ?? undefined,
        tokenCost,
        tier: preferredCost,
      });

      // Return 202 Accepted - gift is being generated async
      // Client should poll GET /gifts/:giftId to check status
      return reply.status(202).send({
        success: true,
        data: {
          gift: {
            id: gift.id,
            name: gift.name,
            description: gift.description,
            tokenCost: gift.token_cost,
            status: gift.status,
            createdAt: gift.created_at.toISOString(),
          },
          message: 'Gift generation started. Poll GET /gifts/:giftId to check status.',
        },
      });
    });
  });

  /**
   * GET /gifts/internal - Internal: List gifts for a user-companion pair
   * NOTE: This route MUST be registered before /:giftId to avoid route conflicts
   */
  app.get('/internal', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.list', async (span) => {
      const { userId, companionId, limit = '5' } = request.query as {
        userId?: string;
        companionId?: string;
        limit?: string;
      };

      if (!userId || !companionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'userId and companionId are required',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      const result = await giftsRepo.getGiftHistory(userId, companionId, {
        limit: Math.min(parseInt(limit), 20),
        offset: 0,
      });

      const gifts = result.data.map(gift => ({
        id: gift.id,
        title: gift.name,
        description: gift.description,
        emotionalMeaning: gift.emotional_meaning,
        direction: 'from_user',
        giftType: 'generated',
        createdAt: gift.created_at.toISOString(),
        givenAt: gift.given_at?.toISOString(),
        emotionalSignificance: 0.5,
      }));

      return reply.send({
        success: true,
        data: { gifts },
      });
    });
  });

  /**
   * GET /gifts/:giftId - Get a specific gift
   */
  app.get('/:giftId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getGift', async (span) => {
      const user = request.user!;
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'user.id': user.userId, 'gift.id': giftId });

      const gift = await giftsRepo.findGiftByIdWithOwnerCheck(giftId, user.userId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: gift.id,
          name: gift.name,
          description: gift.description,
          visualPrompt: gift.visual_prompt,
          emotionalMeaning: gift.emotional_meaning,
          imageUrl: gift.image_url,
          companionId: gift.companion_id,
          status: gift.status,
          tokenCost: gift.token_cost,
          generationError: gift.generation_error,
          givenAt: gift.given_at?.toISOString() ?? null,
          createdAt: gift.created_at.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/:giftId/give - Give a gift to companion (deduct tokens, mark given, create memory)
   */
  app.post('/:giftId/give', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.giveGift', async (span) => {
      const user = request.user!;
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'user.id': user.userId, 'gift.id': giftId });

      const parseResult = GiveGiftSchema.safeParse(request.body ?? {});
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

      const { memoryContent: providedMemoryContent } = parseResult.data;

      // Get the gift
      const gift = await giftsRepo.findGiftByIdWithOwnerCheck(giftId, user.userId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Check gift status
      if (gift.status !== 'ready') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'GIFT_NOT_READY',
            message: `Gift is not ready to be given. Current status: ${gift.status}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Deduct tokens
      const deductResult = await giftsRepo.deductTokens(
        user.userId,
        gift.token_cost,
        gift.id,
        `Gift: ${gift.name}`
      );

      if (!deductResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TOKEN_DEDUCTION_FAILED',
            message: deductResult.errorMessage ?? 'Failed to deduct tokens',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Mark gift as given
      const updatedGift = await giftsRepo.markGiftGiven(giftId);

      // Generate memory content if not provided
      const memoryContent = providedMemoryContent ??
        `${gift.name}: ${gift.description ?? 'A special gift'}. ${gift.emotional_meaning ?? 'Given with love and care.'}`;

      // Create gift memory
      const memory = await giftsRepo.createGiftMemory({
        gift_id: giftId,
        user_id: user.userId,
        companion_id: gift.companion_id,
        memory_content: memoryContent,
      });

      logger.info(
        { userId: user.userId, giftId, companionId: gift.companion_id, tokensDeducted: gift.token_cost },
        'Gift given to companion'
      );

      // Emit gift.given event
      const giftGivenTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: giftGivenTraceId,
        type: 'gift.given',
        payload: {
          giftId,
          companionId: gift.companion_id,
          name: gift.name,
          tokenCost: gift.token_cost,
          memoryId: memory.id,
          newBalance: deductResult.newBalance,
        },
        version: '1.0',
        causationId: null,
        correlationId: giftGivenTraceId,
      });

      return reply.send({
        success: true,
        data: {
          gift: {
            id: updatedGift.id,
            name: updatedGift.name,
            status: updatedGift.status,
            givenAt: updatedGift.given_at?.toISOString(),
          },
          memory: {
            id: memory.id,
            content: memory.memory_content,
          },
          tokensDeducted: gift.token_cost,
          newBalance: deductResult.newBalance,
        },
      });
    });
  });

  /**
   * GET /gifts/history/:companionId - Get gift history with a companion
   */
  app.get('/history/:companionId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getGiftHistory', async (span) => {
      const user = request.user!;
      const { companionId } = request.params as { companionId: string };
      span.setAttributes({ 'user.id': user.userId, 'companion.id': companionId });

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(companionId)) {
        logger.warn({ companionId }, 'Invalid companion ID format in gift history request');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID format',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      // Verify companion ownership
      let companion;
      try {
        companion = await companionsRepo.findById(companionId);
      } catch (dbError) {
        // Handle ValidationError from repository (invalid UUID format)
        if (dbError instanceof ValidationError) {
          logger.warn({ companionId, error: dbError.message }, 'Invalid companion ID format in repository');
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_COMPANION_ID',
              message: 'Invalid companion ID format',
              timestamp: new Date().toISOString(),
            },
          });
        }
        logger.error({ companionId, error: dbError }, 'Database error looking up companion');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_COMPANION_ID',
            message: 'Invalid companion ID',
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (!companion || companion.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await giftsRepo.getGiftHistory(user.userId, companionId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data.map(gift => ({
            id: gift.id,
            name: gift.name,
            description: gift.description,
            emotionalMeaning: gift.emotional_meaning,
            imageUrl: gift.image_url,
            tokenCost: gift.token_cost,
            givenAt: gift.given_at?.toISOString(),
          })),
          hasMore: result.hasMore,
        },
      });
    });
  });

  // ==========================================================================
  // Internal Endpoints (Service-to-service)
  // ==========================================================================

  /**
   * POST /gifts/internal/generate - Internal: Create gift from orchestrator
   */
  app.post('/internal/generate', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.generate', async (span) => {
      const parseResult = InternalGenerateSchema.safeParse(request.body);
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

      const data = parseResult.data;
      span.setAttributes({ 'user.id': data.userId, 'companion.id': data.companionId });

      // Create the gift record
      const gift = await giftsRepo.createGift({
        user_id: data.userId,
        companion_id: data.companionId,
        name: data.name,
        description: data.description,
        visual_prompt: data.visualPrompt,
        emotional_meaning: data.emotionalMeaning,
        token_cost: data.tokenCost,
        status: 'generating',
        generation_params: (data.generationParams ?? null) as JSONObject | null,
        source_event_id: data.sourceEventId,
        source_turn_id: data.sourceTurnId,
      });

      logger.info({ giftId: gift.id, userId: data.userId }, 'Internal gift generation started');

      return reply.status(201).send({
        success: true,
        data: {
          id: gift.id,
          status: gift.status,
          visualPrompt: gift.visual_prompt,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/receive - Internal: Mark gift as received with image
   */
  app.post('/internal/receive', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.receive', async (span) => {
      const parseResult = InternalReceiveSchema.safeParse(request.body);
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

      const { giftId, imageUrl, s3Bucket, s3Key } = parseResult.data;
      span.setAttributes({ 'gift.id': giftId });

      const gift = await giftsRepo.findGiftById(giftId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedGift = await giftsRepo.setGiftImage(giftId, imageUrl, s3Bucket, s3Key);

      logger.info({ giftId }, 'Gift image received and saved');

      return reply.send({
        success: true,
        data: {
          id: updatedGift.id,
          status: updatedGift.status,
          imageUrl: updatedGift.image_url,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/update-gift - Internal: Update gift content and image
   * Used by workers to complete gift generation
   */
  app.post('/internal/update-gift', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.updateGift', async (span) => {
      const parseResult = InternalUpdateGiftSchema.safeParse(request.body);
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

      const { giftId, name, description, visualPrompt, emotionalMeaning, imageUrl, s3Bucket, s3Key } = parseResult.data;
      span.setAttributes({ 'gift.id': giftId });

      const gift = await giftsRepo.findGiftById(giftId);
      if (!gift) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'GIFT_NOT_FOUND',
            message: 'Gift not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedGift = await giftsRepo.updateGiftWithContent(giftId, {
        name,
        description,
        visualPrompt,
        emotionalMeaning,
        imageUrl,
        s3Bucket,
        s3Key,
      });

      logger.info({ giftId }, 'Gift generation completed');

      return reply.send({
        success: true,
        data: {
          id: updatedGift.id,
          name: updatedGift.name,
          description: updatedGift.description,
          status: updatedGift.status,
          imageUrl: updatedGift.image_url,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/recall-candidate - Internal: Find gift memories for recall
   */
  app.post('/internal/recall-candidate', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.recallCandidate', async (span) => {
      const parseResult = InternalRecallCandidateSchema.safeParse(request.body);
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

      const { userId, companionId, embedding, limit = 5, minSimilarity = 0.7 } = parseResult.data;
      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      const results = await giftsRepo.searchByEmbedding(
        userId,
        companionId,
        embedding,
        limit,
        minSimilarity
      );

      return reply.send({
        success: true,
        data: results.map(memory => ({
          id: memory.id,
          giftId: memory.gift_id,
          giftName: memory.giftName,
          giftImageUrl: memory.giftImageUrl,
          memoryContent: memory.memory_content,
          similarity: memory.similarity,
          timesRecalled: memory.times_recalled,
          lastRecalledAt: memory.last_recalled_at?.toISOString() ?? null,
        })),
      });
    });
  });

  /**
   * GET /gifts/internal/significant - Internal: Get significant gifts for a user-companion pair
   */
  app.get('/internal/significant', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.getSignificant', async (span) => {
      const { userId, companionId, limit = '5' } = request.query as {
        userId?: string;
        companionId?: string;
        limit?: string;
      };

      if (!userId || !companionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'userId and companionId are required',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      const gifts = await giftsRepo.getSignificantGifts(userId, companionId, parseInt(limit));

      return reply.send({
        success: true,
        data: gifts.map(gift => ({
          id: gift.id,
          name: gift.name,
          description: gift.description,
          emotionalMeaning: gift.emotional_meaning,
          imageUrl: gift.image_url,
          givenAt: gift.given_at?.toISOString(),
        })),
      });
    });
  });

  /**
   * POST /gifts/internal/:giftId/recall - Internal: Record a gift memory recall
   */
  app.post('/internal/:giftId/recall', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.recordRecall', async (span) => {
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'gift.id': giftId });

      const parseResult = InternalRecallSchema.safeParse(request.body);
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

      const { cooldownHours = 24 } = parseResult.data;

      // Find the memory for this gift
      const memory = await giftsRepo.findGiftMemoryByGiftId(giftId);
      if (!memory) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'MEMORY_NOT_FOUND',
            message: 'Gift memory not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedMemory = await giftsRepo.recordRecall(memory.id, cooldownHours);

      logger.debug({ giftId, memoryId: memory.id, timesRecalled: updatedMemory.times_recalled }, 'Gift memory recalled');

      return reply.send({
        success: true,
        data: {
          memoryId: updatedMemory.id,
          timesRecalled: updatedMemory.times_recalled,
          lastRecalledAt: updatedMemory.last_recalled_at?.toISOString(),
          recallCooldownUntil: updatedMemory.recall_cooldown_until?.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/internal/:giftId/embedding - Internal: Update gift memory embedding
   */
  app.post('/internal/:giftId/embedding', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.updateEmbedding', async (span) => {
      const { giftId } = request.params as { giftId: string };
      span.setAttributes({ 'gift.id': giftId });

      const parseResult = UpdateEmbeddingSchema.safeParse(request.body);
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

      const { embedding } = parseResult.data;

      // Find the memory for this gift
      const memory = await giftsRepo.findGiftMemoryByGiftId(giftId);
      if (!memory) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'MEMORY_NOT_FOUND',
            message: 'Gift memory not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updatedMemory = await giftsRepo.updateEmbedding(memory.id, embedding);

      logger.debug({ giftId, memoryId: memory.id }, 'Gift memory embedding updated');

      return reply.send({
        success: true,
        data: {
          memoryId: updatedMemory.id,
          hasEmbedding: updatedMemory.embedding !== null,
        },
      });
    });
  });


  /**
   * POST /gifts/internal/eligible-for-recall - Internal: Find gifts eligible for recall
   */
  app.post('/internal/eligible-for-recall', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.eligibleForRecall', async (span) => {
      const parseResult = z.object({
        userId: z.string().uuid(),
        companionId: z.string().uuid(),
        maxCreatedAt: z.string().optional(),
        context: z.string().optional(),
        limit: z.number().int().positive().max(20).optional(),
      }).safeParse(request.body);

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

      const { userId, companionId, limit = 5 } = parseResult.data;
      span.setAttributes({ 'user.id': userId, 'companion.id': companionId });

      // Get gift history - these are all "given" gifts eligible for recall
      const result = await giftsRepo.getGiftHistory(userId, companionId, {
        limit,
        offset: 0,
      });

      // Filter to gifts that haven't been recalled too recently
      // For now, return all given gifts - the orchestrator handles recall timing
      const gifts = result.data.map(gift => ({
        id: gift.id,
        title: gift.name,
        description: gift.description,
        emotionalMeaning: gift.emotional_meaning,
        direction: 'from_user',
        giftType: 'generated',
        createdAt: gift.created_at.toISOString(),
        givenAt: gift.given_at?.toISOString(),
        emotionalSignificance: 0.5,
      }));

      return reply.send({
        success: true,
        data: {
          gifts,
        },
      });
    });
  });

  /**
   * POST /gifts/internal/acknowledge - Internal: Acknowledge a gift from the user
   */
  app.post('/internal/acknowledge', { preHandler: requireInternalService }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.internal.acknowledge', async (span) => {
      const parseResult = z.object({
        userId: z.string().uuid(),
        companionId: z.string().uuid(),
        sessionId: z.string().uuid(),
        turnId: z.string().uuid(),
        giftDescription: z.string().min(1).max(2000),
        emotionalReaction: z.string(),
        emotionalIntensity: z.number().min(0).max(1),
        direction: z.string(),
      }).safeParse(request.body);

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

      const data = parseResult.data;
      span.setAttributes({ 'user.id': data.userId, 'companion.id': data.companionId });

      // Create a gift record for user-given gifts (acknowledged by companion)
      const gift = await giftsRepo.createGift({
        user_id: data.userId,
        companion_id: data.companionId,
        name: data.giftDescription.slice(0, 100),
        description: data.giftDescription,
        visual_prompt: null,
        emotional_meaning: `${data.emotionalReaction} (intensity: ${data.emotionalIntensity})`,
        token_cost: 0, // User-given gifts don't cost tokens
        status: 'given',
        generation_params: {
          direction: data.direction,
          sessionId: data.sessionId,
          turnId: data.turnId,
        } as JSONObject,
        source_event_id: null,
        source_turn_id: data.turnId,
      });

      // Mark as given immediately
      const givenGift = await giftsRepo.markGiftGiven(gift.id);

      logger.info(
        { giftId: gift.id, userId: data.userId, companionId: data.companionId },
        'Gift acknowledged from user'
      );

      // Emit gift.acknowledged event
      const eventTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: data.userId,
        sessionId: data.sessionId,
        turnId: data.turnId,
        traceId: eventTraceId,
        type: 'gift.acknowledged',
        payload: {
          giftId: gift.id,
          companionId: data.companionId,
          description: data.giftDescription,
          emotionalReaction: data.emotionalReaction,
          emotionalIntensity: data.emotionalIntensity,
          direction: data.direction,
        },
        version: '1.0',
        causationId: null,
        correlationId: eventTraceId,
      });

      return reply.status(201).send({
        success: true,
        data: {
          id: givenGift.id,
          name: givenGift.name,
          status: givenGift.status,
          givenAt: givenGift.given_at?.toISOString(),
        },
      });
    });
  });

  // ==========================================================================
  // Gift Template Endpoints (Global Library)
  // ==========================================================================

  /**
   * GET /gifts/templates - List gift templates from the global library
   */
  app.get('/templates', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTemplates', async (span) => {
      const parseResult = ListTemplatesQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: parseResult.error.flatten(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { category, tier, sort = 'popular', limit = 20, offset = 0 } = parseResult.data;
      span.setAttributes({
        'templates.category': category ?? 'all',
        'templates.tier': tier ?? 'all',
        'templates.sort': sort,
      });

      const result = await templatesRepo.listTemplates({
        category: category as import('../db/types.js').GiftTemplateCategory | undefined,
        tier,
        sort,
        limit: Math.min(limit, 50),
        offset,
      });

      return reply.send({
        success: true,
        data: {
          templates: result.data.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            emotionalMeaning: t.emotional_meaning,
            imageUrl: t.image_url,
            category: t.category,
            tokenCost: t.token_cost,
            tier: t.tier,
            totalSends: t.total_sends,
            sendsLast7Days: t.sends_last_7_days,
          })),
          hasMore: result.hasMore,
          total: result.total,
        },
      });
    });
  });

  /**
   * GET /gifts/templates/:templateId - Get a specific template
   */
  app.get('/templates/:templateId', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getTemplate', async (span) => {
      const { templateId } = request.params as { templateId: string };
      span.setAttributes({ 'template.id': templateId });

      const template = await templatesRepo.findById(templateId);
      if (!template) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Gift template not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: template.id,
          name: template.name,
          description: template.description,
          emotionalMeaning: template.emotional_meaning,
          imageUrl: template.image_url,
          category: template.category,
          tokenCost: template.token_cost,
          tier: template.tier,
          totalSends: template.total_sends,
          sendsLast7Days: template.sends_last_7_days,
          createdAt: template.created_at.toISOString(),
        },
      });
    });
  });

  /**
   * POST /gifts/from-template - Send a gift from a template (instant, no generation)
   */
  app.post('/from-template', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.sendFromTemplate', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = SendFromTemplateSchema.safeParse(request.body);
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

      const { templateId, companionId } = parseResult.data;
      span.setAttributes({ 'template.id': templateId, 'companion.id': companionId });

      // Verify template exists
      const template = await templatesRepo.findById(templateId);
      if (!template || template.status !== 'active') {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Gift template not found or unavailable',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify companion ownership
      const companion = await companionsRepo.findById(companionId);
      if (!companion || companion.user_id !== user.userId) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COMPANION_NOT_FOUND',
            message: 'Companion not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Create gift record from template
      const gift = await giftsRepo.createGift({
        user_id: user.userId,
        companion_id: companionId,
        name: template.name,
        description: template.description,
        visual_prompt: template.visual_prompt,
        emotional_meaning: template.emotional_meaning,
        token_cost: template.token_cost,
        status: 'ready',
        generation_params: { templateId } as JSONObject,
      });

      // Set the image from template and link to template
      await giftsRepo.setGiftImage(
        gift.id,
        template.image_url,
        template.s3_bucket ?? '',
        template.s3_key ?? ''
      );

      // Deduct tokens
      const deductResult = await giftsRepo.deductTokens(
        user.userId,
        template.token_cost,
        gift.id,
        `Gift: ${template.name}`
      );

      if (!deductResult.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TOKEN_DEDUCTION_FAILED',
            message: deductResult.errorMessage ?? 'Insufficient tokens',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Mark gift as given
      const givenGift = await giftsRepo.markGiftGiven(gift.id);

      // Increment template popularity
      await templatesRepo.incrementPopularity(templateId);

      // Create gift memory
      const memoryContent = `${template.name}: ${template.description ?? 'A special gift'}. ${template.emotional_meaning ?? 'Given with love and care.'}`;
      const memory = await giftsRepo.createGiftMemory({
        gift_id: gift.id,
        user_id: user.userId,
        companion_id: companionId,
        memory_content: memoryContent,
      });

      logger.info(
        { userId: user.userId, giftId: gift.id, templateId, companionId, tokensDeducted: template.token_cost },
        'Gift sent from template'
      );

      // Emit gift.given event
      const giftGivenTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: giftGivenTraceId,
        type: 'gift.given',
        payload: {
          giftId: gift.id,
          templateId,
          companionId,
          name: template.name,
          tokenCost: template.token_cost,
          memoryId: memory.id,
          newBalance: deductResult.newBalance,
        },
        version: '1.0',
        causationId: null,
        correlationId: giftGivenTraceId,
      });

      return reply.send({
        success: true,
        data: {
          gift: {
            id: givenGift.id,
            name: givenGift.name,
            status: givenGift.status,
            givenAt: givenGift.given_at?.toISOString(),
          },
          memory: {
            id: memory.id,
            content: memory.memory_content,
          },
          tokensDeducted: template.token_cost,
          newBalance: deductResult.newBalance,
        },
      });
    });
  });

  /**
   * GET /gifts/templates/categories/counts - Get template counts by category
   */
  app.get('/templates/categories/counts', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getCategoryCounts', async () => {
      const counts = await templatesRepo.getCountsByCategory();

      return reply.send({
        success: true,
        data: { counts },
      });
    });
  });
}
